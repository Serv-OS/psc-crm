// Recurring invoice generator. Called by pg_cron. Two passes, deliberately split:
//   1. generation — for every active schedule whose next_run is due, create the
//      invoice from the template lines and advance next_run. Cheap: no PDF, no email.
//   2. sending — pick up recurring drafts that still need emailing and send at
//      most SEND_PER_RUN of them (PDF building is what costs the CPU).
// Splitting them is not cosmetic: building PDFs inline killed the worker
// (WORKER_RESOURCE_LIMIT) partway through the loop, so the remaining schedules
// were never even CREATED and customers went un-invoiced, not merely un-emailed.
// Idempotent: next_run moves forward after generation, so repeat calls no-op.
// Deployed --no-verify-jwt (cron has no JWT); uses the service role internally.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { invoiceEmailHtml, sendInvoiceEmail, money } from "../_shared/invoiceEmail.ts";
import { buildInvoicePdfBytes } from "../_shared/invoicePdf.ts";

const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

// Next occurrence: advance by the frequency, clamped to day_of_month (1-28).
function advance(fromIso: string, frequency: string, dayOfMonth: number): string {
  const d = new Date(fromIso + "T00:00:00Z");
  const months = frequency === "annual" ? 12 : frequency === "quarterly" ? 3 : 1;
  const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, Math.min(dayOfMonth, 28)));
  return next.toISOString().slice(0, 10);
}

serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    const todayIso = new Date().toISOString().slice(0, 10);
    const { data: due } = await supabase.from("recurring_invoices")
      .select("*").eq("active", true).lte("next_run", todayIso);

    const results: any[] = [];
    for (const sched of (due || [])) {
      try {
        const lines = Array.isArray(sched.lines) ? sched.lines : [];
        const subtotal = lines.reduce((s: number, l: any) => s + (Number(l.qty) || 1) * (Number(l.unit_price) || 0), 0);
        const taxAmount = lines.reduce((s: number, l: any) =>
          s + (Number(l.qty) || 1) * (Number(l.unit_price) || 0) * (Number(l.tax_rate ?? sched.tax_rate) || 0) / 100, 0);
        const total = subtotal + taxAmount;

        const dueDate = new Date(Date.now() + (Number(sched.due_days) || 14) * 86400000).toISOString().slice(0, 10);

        const { data: inv, error: invErr } = await supabase.from("invoices").insert({
          company_id: sched.company_id, location_id: sched.location_id, contact_id: sched.contact_id,
          recurring_id: sched.id, status: "draft", issue_date: todayIso, due_date: dueDate,
          tax_rate: sched.tax_rate, subtotal, tax_amount: taxAmount, total,
          terms: sched.terms, notes: sched.notes, email_to: sched.email_to,
          created_by: sched.created_by,
        }).select().single();
        if (invErr) throw invErr;

        if (lines.length) {
          await supabase.from("invoice_line_items").insert(lines.map((l: any, i: number) => ({
            invoice_id: inv.id, name: l.name || "Item", description: l.description || null,
            qty: Number(l.qty) || 1, unit_price: Number(l.unit_price) || 0,
            tax_rate: Number(l.tax_rate ?? sched.tax_rate) || 0, sort: i,
          })));
        }

        // NOTE: generation is deliberately CHEAP — no PDF, no email. Building a
        // PDF costs more CPU than an edge function is allowed for a whole
        // invocation, so doing it inline killed the worker after roughly one
        // invoice and the remaining schedules were never even created. Sending
        // happens in its own capped pass below.

        // Advance the schedule so repeat runs don't duplicate
        await supabase.from("recurring_invoices").update({
          next_run: advance(sched.next_run, sched.frequency, sched.day_of_month),
          last_run_at: new Date().toISOString(),
        }).eq("id", sched.id);

        results.push({ schedule: sched.id, invoice: inv.invoice_number });
      } catch (e) {
        results.push({ schedule: sched.id, error: (e as Error).message });
      }
    }

    // ── Pass 2: send, a few at a time ──────────────────────────────────────
    // Every due invoice now EXISTS and is dated correctly, which is the part
    // that must not slip. Emailing is what costs CPU, so it is capped: whatever
    // is left is picked up by the next run rather than killing this one.
    // ONE. Two PDFs in a single invocation still trips WORKER_RESOURCE_LIMIT.
    // One PDF is what an edge function can afford, and a frequent cron drains
    // any backlog in hours.
    const SEND_PER_RUN = 1;
    const sends: any[] = [];
    try {
      const { data: pending } = await supabase.from("invoices")
        .select("*, recurring:recurring_invoices!inner(auto_send, email_to, contact_id)")
        .eq("status", "draft").not("recurring_id", "is", null).is("sent_at", null)
        .order("invoice_number", { ascending: true }).limit(SEND_PER_RUN * 4);

      for (const inv of (pending || [])) {
        if (sends.length >= SEND_PER_RUN) break;
        const sched: any = (inv as any).recurring;
        if (!sched?.auto_send) continue;
        let recipient = (sched.email_to || "").trim();
        if (!recipient && sched.contact_id) {
          const { data: c } = await supabase.from("contacts").select("email").eq("id", sched.contact_id).maybeSingle();
          recipient = c?.email || "";
        }
        if (!recipient) continue;               // stays a draft for a human to send
        try {
          const { data: lines } = await supabase.from("invoice_line_items").select("*").eq("invoice_id", inv.id).order("sort");
          const { data: seller } = await supabase.from("support_settings")
            .select("business_name, business_email, business_phone, quote_accent, logo_url, logo_pdf_data").eq("id", 1).maybeSingle();
          const appUrl = Deno.env.get("APP_URL") || "https://psc-crm.vercel.app";
          const { subject, html } = invoiceEmailHtml(inv, seller || {}, `${appUrl}/i/${inv.public_token}`);

          // Bill-to parties for the PDF (contact is the customer; company/location shown when linked).
          const [{ data: contact }, { data: company }, { data: location }] = await Promise.all([
            inv.contact_id ? supabase.from("contacts").select("first_name, last_name, email").eq("id", inv.contact_id).maybeSingle() : Promise.resolve({ data: null }),
            inv.company_id ? supabase.from("companies").select("name").eq("id", inv.company_id).maybeSingle() : Promise.resolve({ data: null }),
            inv.location_id ? supabase.from("locations").select("name").eq("id", inv.location_id).maybeSingle() : Promise.resolve({ data: null }),
          ]);
          const contactName = contact ? [(contact as any).first_name, (contact as any).last_name].filter(Boolean).join(" ") : "";
          const pdfBytes = await buildInvoicePdfBytes({
            inv, lines: lines || [],
            totals: { subtotal: inv.subtotal, tax: inv.tax_amount, total: inv.total },
            seller: { name: (seller as any)?.business_name, email: (seller as any)?.business_email, phone: (seller as any)?.business_phone, accent: (seller as any)?.quote_accent, logo_url: (seller as any)?.logo_url, logo_data: (seller as any)?.logo_pdf_data },
            billTo: { companyName: (company as any)?.name || "", contactName, contactEmail: recipient, locationName: (location as any)?.name || "" },
            fmt: money,
          });

          await sendInvoiceEmail(supabase, recipient, subject, html, { filename: `INV-${inv.invoice_number}.pdf`, bytes: pdfBytes });
          await supabase.from("invoices").update({ status: "sent", sent_at: new Date().toISOString(), email_to: recipient }).eq("id", inv.id);
          sends.push({ invoice: inv.invoice_number, to: recipient, sent: true });
        } catch (e) {
          // Leave it a draft: the next run retries it, and a human can send it.
          sends.push({ invoice: inv.invoice_number, sent: false, error: (e as Error).message });
        }
      }
    } catch (e) {
      sends.push({ error: (e as Error).message });
    }

    return json({ generated: results.length, results, sent: sends.length, sends });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
