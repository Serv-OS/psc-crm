// Stripe webhook: on checkout.session.completed, mark the quote paid and
// execute it (close the deal -> create onboarding).
//
// Required secrets: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@14?target=deno";
import { invoiceEmailHtml, sendInvoiceEmail } from "../_shared/invoiceEmail.ts";

// Quote paid -> raise a PAID invoice (receipt), copy the one-off lines (or a
// single deposit line for part-payment), and email it to the signing contact.
async function createPaidInvoiceForQuote(supabase: any, quoteId: string, paidAmount: number) {
  const { data: q } = await supabase.from("quotes").select("*").eq("id", quoteId).maybeSingle();
  if (!q) return;
  // Don't duplicate if a receipt already exists for this quote
  const { data: existing } = await supabase.from("invoices").select("id").eq("quote_id", quoteId).limit(1);
  if (existing?.length) return;

  const today = new Date().toISOString().slice(0, 10);
  const fullPayment = paidAmount >= Number(q.one_off_total || 0) - 0.01;

  const { data: inv, error } = await supabase.from("invoices").insert({
    quote_id: q.id, company_id: q.company_id, location_id: q.location_id, contact_id: q.contact_id,
    status: "paid", issue_date: today, due_date: today,
    tax_rate: fullPayment ? q.tax_rate : 0,
    subtotal: fullPayment ? q.one_off_subtotal : paidAmount,
    tax_amount: fullPayment ? q.tax_amount : 0,
    total: fullPayment ? q.one_off_total : paidAmount,
    paid_at: new Date().toISOString(), amount_paid: paidAmount,
    notes: fullPayment
      ? `Payment received in full for quote Q-${q.quote_number}.`
      : `Deposit received for quote Q-${q.quote_number}. Remaining balance to follow.`,
    created_by: q.created_by,
  }).select().single();
  if (error || !inv) return;

  if (fullPayment) {
    const { data: lines } = await supabase.from("quote_line_items")
      .select("*").eq("quote_id", q.id).eq("billing_type", "one_off").order("sort");
    if (lines?.length) {
      await supabase.from("invoice_line_items").insert(lines.map((l: any, i: number) => ({
        invoice_id: inv.id, name: l.name, description: l.description,
        qty: Number(l.qty) || 1,
        unit_price: (Number(l.unit_price) || 0) * (1 - (Number(l.discount) || 0) / 100),
        sort: i,
      })));
    }
  } else {
    await supabase.from("invoice_line_items").insert({
      invoice_id: inv.id, name: `Deposit on quote Q-${q.quote_number}`,
      description: q.deposit_percent ? `${q.deposit_percent}% deposit` : null,
      qty: 1, unit_price: paidAmount, sort: 0,
    });
  }

  // Email the receipt to the customer (best effort)
  let recipient = "";
  if (q.contact_id) {
    const { data: c } = await supabase.from("contacts").select("email").eq("id", q.contact_id).maybeSingle();
    recipient = c?.email || "";
  }
  if (recipient) {
    const { data: seller } = await supabase.from("support_settings")
      .select("business_name, business_email, business_phone, quote_accent, logo_url").eq("id", 1).maybeSingle();
    const appUrl = Deno.env.get("APP_URL") || "https://posupject.vercel.app";
    const { subject, html } = invoiceEmailHtml(inv, seller || {}, `${appUrl}/i/${inv.public_token}`, { paid: true });
    await sendInvoiceEmail(supabase, recipient, subject, html);
    await supabase.from("invoices").update({ sent_at: new Date().toISOString(), email_to: recipient }).eq("id", inv.id);
  }
}

serve(async (req) => {
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: conn } = await supabase.from("stripe_connection").select("secret_key, webhook_secret").eq("id", 1).maybeSingle();
  const stripeKey = conn?.secret_key || Deno.env.get("STRIPE_SECRET_KEY");
  const webhookSecret = conn?.webhook_secret || Deno.env.get("STRIPE_WEBHOOK_SECRET");
  if (!stripeKey || !webhookSecret) return new Response("Stripe not configured", { status: 503 });

  const stripe = new Stripe(stripeKey, { apiVersion: "2023-10-16", httpClient: Stripe.createFetchHttpClient() });

  const sig = req.headers.get("stripe-signature");
  const raw = await req.text();
  let event;
  try {
    event = await stripe.webhooks.constructEventAsync(raw, sig!, webhookSecret, undefined, Stripe.createSubtleCryptoProvider());
  } catch (e) {
    return new Response(`Webhook signature failed: ${(e as Error).message}`, { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as any;
    const quoteId = session.metadata?.quote_id;
    if (quoteId) {
      await supabase.from("quotes").update({
        status: "paid",
        paid_at: new Date().toISOString(),
        amount_paid: (session.amount_total || 0) / 100,
        stripe_payment_intent: session.payment_intent || null,
      }).eq("id", quoteId);
      // Close the deal + create onboarding
      await supabase.rpc("execute_quote", { p_quote_id: quoteId });
      // Generate a PAID invoice (receipt) for the payment and email it
      try {
        await createPaidInvoiceForQuote(supabase, quoteId, (session.amount_total || 0) / 100);
      } catch (e) {
        console.error("receipt invoice failed:", (e as Error).message);
      }
    }
    // Invoice payments (one-off + recurring)
    const invoiceId = session.metadata?.invoice_id;
    if (invoiceId) {
      await supabase.from("invoices").update({
        status: "paid",
        paid_at: new Date().toISOString(),
        amount_paid: (session.amount_total || 0) / 100,
      }).eq("id", invoiceId);
    }
  }

  return new Response(JSON.stringify({ received: true }), { headers: { "Content-Type": "application/json" } });
});
