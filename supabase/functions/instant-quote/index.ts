// Public instant-quote ingest (no auth). The website's /instant-quote form POSTs
// the measurement + siding selection here and we build the full sales artifact:
//   contact -> location (property) -> lead -> deal -> DRAFT quote (line items +
//   internal cost/margin estimate), round-robin assigned to a rep who is notified.
//
// The quote is built with the SAME engine + catalogue (quote_config_*) a salesperson
// uses — imported from _shared/quoteEngine.ts, the maintained port of
// src/lib/quoteEngine.js — so the auto-draft is identical to one built by hand
// (battens auto-derive, one every 12 inches) and sales just reviews and sends.
// (This file used to carry its own inline copy of the engine; that copy silently
// missed the batten rule, which is exactly why it now imports the shared one.)
//
// Optional shared secret: if INSTANT_QUOTE_SECRET is set in the function env, callers
// must send the same value in `secret`. Honeypot (`company`) + field validation always on.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { graph, msTokenFromRefresh } from "../_shared/microsoft.ts";
import {
  buildEngineConfig, computeQuote, buildEstimateRecord, buildCustomerLines,
  PRODUCT_NAMES, DEMO_LABELS, num,
} from "../_shared/quoteEngine.ts";

// New-lead alert recipient (Peter). Email needs a connected Microsoft mailbox
// (microsoft_connections); SMS needs Twilio secrets + an approved A2P registration.
// Both are best-effort and never block lead/deal/quote creation.
const ALERT_EMAIL = "peter@posup.co.uk";
const ALERT_SMS = "+16503985153";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
// Best-effort new-lead alert to Peter — email (Microsoft Graph, if a mailbox is
// connected) + SMS (Twilio, subject to A2P). Never throws into the caller.
async function notifyOwner(supabase: any, info: { name: string; line: string; address: string; total: number; quoteNumber: number | null }) {
  const money = "$" + Math.round(info.total || 0).toLocaleString("en-US");
  const subject = `New website lead — ${info.name} (${money})`;
  const text = `New instant-quote lead from the website.\n\n${info.name}\n${info.line}\n${info.address || ""}\nEstimate: ${money}${info.quoteNumber ? `\nDraft quote #${info.quoteNumber} (status: draft)` : ""}\n\nOpen it in the CRM — Deals → "Estimate / Quote".`;
  // Email via the connected Microsoft mailbox
  try {
    const { data: conn } = await supabase.from("microsoft_connections")
      .select("id, refresh_token").eq("is_active", true).order("updated_at", { ascending: false }).limit(1).maybeSingle();
    if (conn?.refresh_token) {
      const tok = await msTokenFromRefresh(conn.refresh_token);
      await supabase.from("microsoft_connections").update({
        access_token: tok.access_token,
        token_expires_at: new Date(Date.now() + (tok.expires_in || 3600) * 1000).toISOString(),
        ...(tok.refresh_token ? { refresh_token: tok.refresh_token } : {}),
      }).eq("id", conn.id);
      await graph(tok.access_token, "/me/sendMail", {
        method: "POST",
        body: JSON.stringify({ message: { subject, body: { contentType: "Text", content: text }, toRecipients: [{ emailAddress: { address: ALERT_EMAIL } }] }, saveToSentItems: false }),
      });
    } else {
      console.log("alert email skipped — no Microsoft mailbox connected");
    }
  } catch (e) { console.error("alert email failed", e); }
  // SMS via Twilio
  try {
    const sid = Deno.env.get("TWILIO_ACCOUNT_SID");
    const authTok = Deno.env.get("TWILIO_AUTH_TOKEN");
    const from = Deno.env.get("TWILIO_FROM_NUMBER");
    if (sid && authTok && from) {
      const params = new URLSearchParams({ From: from, To: ALERT_SMS, Body: `New website lead: ${info.name} — ${info.line}. Est ${money}.${info.quoteNumber ? ` Quote #${info.quoteNumber} drafted.` : ""}` });
      const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
        method: "POST",
        headers: { Authorization: "Basic " + btoa(`${sid}:${authTok}`), "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
      });
      if (!r.ok) console.error("alert SMS failed", r.status, await r.text());
    } else {
      console.log("alert SMS skipped — Twilio not configured");
    }
  } catch (e) { console.error("alert SMS failed", e); }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  // Honeypot + optional shared secret
  if (body?.company) return json({ ok: true });
  const secret = Deno.env.get("INSTANT_QUOTE_SECRET");
  if (secret && body?.secret !== secret) return json({ error: "Unauthorized" }, 401);

  const c = body?.customer || {};
  const name = String(c.name || "").trim();
  const email = String(c.email || "").trim();
  const phone = String(c.phone || "").trim();
  if (!name || !EMAIL_RE.test(email) || !phone) return json({ error: "name, valid email and phone are required" }, 422);

  const sel = body?.selection || {};
  const proj = body?.project || {};
  const profileKey = String(sel.profileKey || "lap");
  const finishKey = String(sel.finishKey || "colorplus") === "primed" ? "primed" : "colorplus";
  const demoKey = String(proj.demoKey || "siding");
  const sqft = num(proj.sqft);
  const stories = num(proj.stories, 1);
  // proj.battenBoards is deliberately ignored: the engine derives battens
  // itself (one every 12 inches of panel, finish-matched), so the website's
  // own count can never undercut the rule.

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const parts = name.split(/\s+/);
  const first_name = parts[0] || "";
  const last_name = parts.slice(1).join(" ") || null;
  const address = c.address ? String(c.address).trim() : null;

  try {
    // ── round-robin: least-loaded sales rep (owner/editor) ──
    let ownerId: string | null = null;
    const { data: reps } = await supabase.from("profiles").select("id").in("role", ["owner", "editor"]);
    if (reps?.length) {
      let best = reps[0].id, bestCount = Infinity;
      for (const r of reps) {
        const { count } = await supabase.from("deals").select("id", { count: "exact", head: true })
          .eq("owner_id", r.id).not("stage", "in", '("closed_won","closed_lost")');
        if ((count ?? 0) < bestCount) { bestCount = count ?? 0; best = r.id; }
      }
      ownerId = best;
    }

    // ── contact (resolve by email, else create) ──
    let contactId: string | null = null;
    const { data: existing } = await supabase.from("contacts").select("id").ilike("email", email).limit(1);
    if (existing?.length) {
      contactId = existing[0].id;
      await supabase.from("contacts").update({ phone: phone || undefined, first_name, last_name }).eq("id", contactId);
    } else {
      const { data: ct } = await supabase.from("contacts").insert({ first_name, last_name, email, phone, source: "instant-quote", owner_id: ownerId }).select("id").single();
      contactId = ct?.id ?? null;
    }

    // ── location (property) ──
    const { data: loc } = await supabase.from("locations").insert({
      name: address || `${name} — property`, address, city: c.city || null, postcode: c.zip || null, country: "US",
      status: "prospect", owner_id: ownerId,
    }).select("id").single();
    const locationId = loc?.id ?? null;

    // link contact <-> location
    if (contactId && locationId) {
      await supabase.from("associations").insert({ from_type: "contact", from_id: contactId, to_type: "location", to_id: locationId, label: "primary_contact" });
    }

    const profileLabel = sel.profile || profileKey;
    const finishLabel = finishKey === "primed" ? "Primed for paint" : `ColorPlus ${sel.color || ""}`.trim();
    const notes = [
      `Instant website quote.`,
      `Siding: ${profileLabel}${sel.texture ? " · " + sel.texture : ""} · ${finishLabel}`,
      `Project: ~${Math.round(sqft).toLocaleString("en-US")} sq ft · ${stories} storey · replacing ${DEMO_LABELS[demoKey] || demoKey}`,
      proj.perimeterFt ? `Footprint perimeter ${Math.round(num(proj.perimeterFt)).toLocaleString("en-US")} ft` : "",
      body?.estimate ? `Customer saw estimate ${body.estimate.low ? "$" + Math.round(body.estimate.low).toLocaleString("en-US") : ""}–${body.estimate.high ? "$" + Math.round(body.estimate.high).toLocaleString("en-US") : ""}` : "",
      c.notes || "",
    ].filter(Boolean).join("\n");

    // ── lead ──
    const { data: lead } = await supabase.from("leads").insert({
      name, stage: "new_lead", source: "instant-quote", priority: "warm", location_id: locationId, contact_id: contactId, notes, owner_id: ownerId,
    }).select("id, stage").single();
    if (lead) await supabase.from("stage_history").insert({ object_type: "lead", object_id: lead.id, from_stage: null, to_stage: "new_lead", changed_by: ownerId });

    // ── deal (stage 'estimate' — first pipeline column; a draft quote is ready) ──
    const { data: deal, error: dealErr } = await supabase.from("deals").insert({
      name: `${name} — ${profileLabel} siding`, stage: "estimate", source: "instant-quote", currency: "USD", owner_id: ownerId,
    }).select("id").single();
    if (dealErr) console.error("deal insert failed", dealErr);
    const dealId = deal?.id ?? null;
    if (dealId) {
      await supabase.from("stage_history").insert({ object_type: "deal", object_id: dealId, from_stage: null, to_stage: "estimate", changed_by: ownerId });
      if (contactId) await supabase.from("associations").insert({ from_type: "deal", from_id: dealId, to_type: "contact", to_id: contactId, label: "primary_contact" });
      if (locationId) await supabase.from("associations").insert({ from_type: "deal", from_id: dealId, to_type: "location", to_id: locationId, label: "affected_location" });
      if (lead) await supabase.from("leads").update({ stage: "qualified", deal_id: dealId }).eq("id", lead.id);
    }

    // ── build + attach the DRAFT quote (best-effort; never lose the lead/deal) ──
    let quoteId: string | null = null;
    let quoteNumber: number | null = null;
    let customerTotal = 0;
    try {
      if (dealId && sqft > 0) {
        const [{ data: cfgRow }, { data: prods }, { data: instMats }, { data: demoRates }] = await Promise.all([
          supabase.from("quote_config").select("*").eq("id", 1).maybeSingle(),
          supabase.from("quote_config_products").select("*").eq("active", true).order("sort"),
          supabase.from("quote_config_install_materials").select("*").eq("active", true).order("sort"),
          supabase.from("quote_config_demo_rates").select("*").eq("active", true).order("sort"),
        ]);
        const cfg = buildEngineConfig({ config: cfgRow || {}, products: prods || [], installMaterials: instMats || [], demoRates: demoRates || [] });

        const findProduct = (target: string) => cfg.products.find((p: any) => p.name === target)
          || cfg.products.find((p: any) => p.name.toLowerCase().includes(profileKey) && p.name.toLowerCase().includes(finishKey === "primed" ? "primed" : "colorplus"));
        const mainName = (PRODUCT_NAMES[profileKey] || PRODUCT_NAMES.lap)[finishKey];
        const mainProd = findProduct(mainName);
        const qty: Record<string, number> = {};
        if (mainProd) qty[mainProd.id] = sqft;
        const result = computeQuote(cfg, { totalSqft: sqft, numStories: stories, demoType: DEMO_LABELS[demoKey] || "", markup: cfg.markupDefault, qty });

        const taxRate = 0; // US — no tax on the auto-draft; sales can adjust
        const salePrice = result.salePrice;
        const taxAmount = salePrice * taxRate / 100;
        customerTotal = salePrice + taxAmount;
        const validUntil = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

        const { data: q } = await supabase.from("quotes").insert({
          deal_id: dealId, contact_id: contactId, location_id: locationId, status: "draft",
          valid_until: validUntil, payment_terms: "pay_now", tax_rate: taxRate,
          one_off_subtotal: salePrice, tax_amount: taxAmount, one_off_total: customerTotal, recurring_arr: 0,
          notes: `Auto-generated from the website instant quote (${profileLabel} · ${finishLabel}). Review and send.`,
          created_by: ownerId,
        }).select("id, quote_number").single();
        quoteId = q?.id ?? null;
        quoteNumber = q?.quote_number ?? null;

        if (quoteId) {
          const lines = buildCustomerLines(result, taxRate).map((l) => ({ ...l, quote_id: quoteId }));
          if (lines.length) await supabase.from("quote_line_items").insert(lines);
          await supabase.from("quote_estimates").insert({
            quote_id: quoteId, total_sqft: result.totalSqft, num_stories: result.numStories,
            demo_type: result.demoType || null, markup: result.markup,
            inputs: { totalSqft: result.totalSqft, numStories: result.numStories, demoType: result.demoType, markup: result.markup, qty, customItems: [] },
            siding_material: result.sidingMaterialSum, siding_install: result.sidingInstallSum, install_mat_sum: result.installSum,
            demo_cost: result.demoCost, permits_cost: result.permitsCost, debris_cost: result.debrisCost,
            total_cost: result.totalCost, sale_price: result.salePrice, profit: result.profit, margin: result.margin,
            breakdown: buildEstimateRecord(result, cfg),
          });
          await supabase.from("deals").update({ value: customerTotal, currency: "USD" }).eq("id", dealId);
        }
      }
    } catch (e) {
      console.error("quote build failed (lead/deal kept)", e);
    }

    // Best-effort new-lead alert to Peter (email + SMS) — never blocks the response.
    if (lead || dealId) {
      const line = `${profileLabel}${sel.texture ? " · " + sel.texture : ""} (${finishLabel}) · ~${Math.round(sqft).toLocaleString("en-US")} sq ft · replacing ${DEMO_LABELS[demoKey] || demoKey}`;
      try { await notifyOwner(supabase, { name, line, address: address || "", total: customerTotal, quoteNumber }); }
      catch (e) { console.error("notifyOwner failed", e); }
    }

    return json({ ok: true, lead_id: lead?.id ?? null, deal_id: dealId, quote_id: quoteId, value: customerTotal });
  } catch (e) {
    console.error("instant-quote ingest failed", e);
    return json({ error: "ingest failed" }, 500);
  }
});
