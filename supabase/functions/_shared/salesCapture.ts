// Turn a qualified enquiry into pipeline records: contact -> property ->
// lead -> deal -> DRAFT quote, round-robin assigned to the least loaded rep.
//
// This is the same sequence the website instant-quote form performs, kept here
// so the chat assistant produces a lead a rep cannot tell apart from a form
// submission. (instant-quote/index.ts still carries its own inline copy; if that
// function is ever revisited it should import from here instead.)
//
// Everything after the lead is best-effort: a failure building the quote must
// never cost us the lead itself.

import {
  buildEngineConfig, computeQuote, buildEstimateRecord, buildCustomerLines,
  PRODUCT_NAMES, BATTEN_NAMES, DEMO_LABELS, num,
} from "./quoteEngine.ts";

export interface CaptureInput {
  name: string;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  zip?: string | null;
  /** Free text for the rep — timeline, motivation, anything the bot learned. */
  notes?: string | null;
  source?: string;
  /** Priced inputs, when the conversation got far enough to produce a range. */
  project?: {
    sqft?: number;
    stories?: number;
    demoKey?: string;
    profileKey?: string;
    finishKey?: string;
    battenBoards?: number;
    estimateLow?: number;
    estimateHigh?: number;
  } | null;
}

export interface CaptureResult {
  contact_id: string | null;
  location_id: string | null;
  lead_id: string | null;
  deal_id: string | null;
  quote_id: string | null;
  quote_number: number | null;
  value: number;
}

/** The least loaded owner/editor, by open deal count. */
async function roundRobinOwner(supabase: any): Promise<string | null> {
  const { data: reps } = await supabase.from("profiles").select("id").in("role", ["owner", "editor"]);
  if (!reps?.length) return null;
  let best = reps[0].id;
  let bestCount = Infinity;
  for (const r of reps) {
    const { count } = await supabase.from("deals").select("id", { count: "exact", head: true })
      .eq("owner_id", r.id).not("stage", "in", '("closed_won","closed_lost")');
    if ((count ?? 0) < bestCount) { bestCount = count ?? 0; best = r.id; }
  }
  return best;
}

export async function captureSalesLead(supabase: any, input: CaptureInput): Promise<CaptureResult> {
  const name = String(input.name || "").trim() || "Website enquiry";
  const email = (input.email || "").trim();
  const phone = (input.phone || "").trim();
  const address = (input.address || "").trim() || null;
  const source = input.source || "sales-chat";

  const parts = name.split(/\s+/);
  const first_name = parts[0] || "";
  const last_name = parts.slice(1).join(" ") || null;

  const ownerId = await roundRobinOwner(supabase);

  // ── Contact: resolve on email, else create ────────────────────────────────
  let contactId: string | null = null;
  if (email) {
    const { data: existing } = await supabase.from("contacts").select("id").ilike("email", email).limit(1);
    if (existing?.length) {
      contactId = existing[0].id;
      const patch: Record<string, unknown> = { first_name, last_name };
      if (phone) patch.phone = phone;
      await supabase.from("contacts").update(patch).eq("id", contactId);
    }
  }
  if (!contactId) {
    const { data: ct } = await supabase.from("contacts").insert({
      first_name, last_name, email: email || null, phone: phone || null,
      source, owner_id: ownerId,
    }).select("id").single();
    contactId = ct?.id ?? null;
  }

  // ── Property ──────────────────────────────────────────────────────────────
  const { data: loc } = await supabase.from("locations").insert({
    name: address || `${name} — property`,
    address, city: input.city || null, postcode: input.zip || null, country: "US",
    status: "prospect", owner_id: ownerId,
  }).select("id").single();
  const locationId = loc?.id ?? null;

  if (contactId && locationId) {
    await supabase.from("associations").insert({
      from_type: "contact", from_id: contactId, to_type: "location", to_id: locationId, label: "primary_contact",
    });
  }

  // ── Lead ──────────────────────────────────────────────────────────────────
  const p = input.project || {};
  const sqft = num(p.sqft);
  const profileKey = String(p.profileKey || "lap");
  const finishKey = String(p.finishKey || "colorplus") === "primed" ? "primed" : "colorplus";
  const demoKey = String(p.demoKey || "siding");
  const money = (v?: number) => (v ? "$" + Math.round(v).toLocaleString("en-US") : "");

  const notes = [
    "Captured by the website sales assistant.",
    input.notes || "",
    sqft > 0
      ? `Project: ~${Math.round(sqft).toLocaleString("en-US")} sq ft · ${num(p.stories, 1)} storey · ${profileKey} · ${finishKey} · replacing ${DEMO_LABELS[demoKey] || demoKey || "n/a"}`
      : "Square footage not established — visitor did not know it.",
    p.estimateLow && p.estimateHigh
      ? `Guidance range given in chat: ${money(p.estimateLow)}–${money(p.estimateHigh)}`
      : "",
  ].filter(Boolean).join("\n");

  const { data: lead } = await supabase.from("leads").insert({
    name, stage: "new_lead", source, priority: "warm",
    location_id: locationId, contact_id: contactId, notes, owner_id: ownerId,
  }).select("id").single();
  if (lead) {
    await supabase.from("stage_history").insert({
      object_type: "lead", object_id: lead.id, from_stage: null, to_stage: "new_lead", changed_by: ownerId,
    });
  }

  // ── Deal ──────────────────────────────────────────────────────────────────
  const { data: deal, error: dealErr } = await supabase.from("deals").insert({
    name: `${name} — siding`, stage: "estimate", source, currency: "USD", owner_id: ownerId,
  }).select("id").single();
  if (dealErr) console.error("sales capture: deal insert failed", dealErr);
  const dealId = deal?.id ?? null;

  if (dealId) {
    await supabase.from("stage_history").insert({
      object_type: "deal", object_id: dealId, from_stage: null, to_stage: "estimate", changed_by: ownerId,
    });
    if (contactId) {
      await supabase.from("associations").insert({
        from_type: "deal", from_id: dealId, to_type: "contact", to_id: contactId, label: "primary_contact",
      });
    }
    if (locationId) {
      await supabase.from("associations").insert({
        from_type: "deal", from_id: dealId, to_type: "location", to_id: locationId, label: "affected_location",
      });
    }
    if (lead) await supabase.from("leads").update({ stage: "qualified", deal_id: dealId }).eq("id", lead.id);
  }

  // ── Draft quote — only when we actually have a square footage ─────────────
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
      const cfg = buildEngineConfig({
        config: cfgRow || {}, products: prods || [],
        installMaterials: instMats || [], demoRates: demoRates || [],
      });

      const mainName = (PRODUCT_NAMES[profileKey] || PRODUCT_NAMES.lap)[finishKey];
      const mainProd = cfg.products.find((x) => x.name === mainName)
        || cfg.products.find((x) => x.name.toLowerCase().includes(profileKey)
          && x.name.toLowerCase().includes(finishKey === "primed" ? "primed" : "colorplus"));
      const qty: Record<string, number> = {};
      if (mainProd) qty[mainProd.id] = sqft;
      const battenBoards = num(p.battenBoards);
      if (profileKey === "panel" && battenBoards > 0) {
        const battenProd = cfg.products.find((x) => x.name === BATTEN_NAMES[finishKey]);
        if (battenProd) qty[battenProd.id] = battenBoards;
      }

      const result = computeQuote(cfg, {
        totalSqft: sqft, numStories: num(p.stories, 1),
        demoType: DEMO_LABELS[demoKey] || "", markup: cfg.markupDefault, qty,
      });

      const taxRate = 0;                       // US — sales adjusts on review
      const salePrice = result.salePrice;
      const taxAmount = salePrice * taxRate / 100;
      customerTotal = salePrice + taxAmount;

      const { data: q } = await supabase.from("quotes").insert({
        deal_id: dealId, contact_id: contactId, location_id: locationId, status: "draft",
        valid_until: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
        payment_terms: "pay_now", tax_rate: taxRate,
        one_off_subtotal: salePrice, tax_amount: taxAmount, one_off_total: customerTotal, recurring_arr: 0,
        notes: "Auto-drafted from a website chat. The visitor was given a range, not this figure — review before sending.",
        created_by: ownerId,
      }).select("id, quote_number").single();
      quoteId = q?.id ?? null;
      quoteNumber = q?.quote_number ?? null;

      if (quoteId) {
        const lines = buildCustomerLines(result, taxRate).map((l: any) => ({ ...l, quote_id: quoteId }));
        if (lines.length) await supabase.from("quote_line_items").insert(lines);
        await supabase.from("quote_estimates").insert({
          quote_id: quoteId, total_sqft: result.totalSqft, num_stories: result.numStories,
          demo_type: result.demoType || null, markup: result.markup,
          inputs: {
            totalSqft: result.totalSqft, numStories: result.numStories,
            demoType: result.demoType, markup: result.markup, qty, customItems: [],
          },
          siding_material: result.sidingMaterialSum, siding_install: result.sidingInstallSum,
          install_mat_sum: result.installSum, demo_cost: result.demoCost,
          permits_cost: result.permitsCost, debris_cost: result.debrisCost,
          total_cost: result.totalCost, sale_price: result.salePrice,
          profit: result.profit, margin: result.margin,
          breakdown: buildEstimateRecord(result, cfg),
        });
        await supabase.from("deals").update({ value: customerTotal, currency: "USD" }).eq("id", dealId);
      }
    }
  } catch (e) {
    console.error("sales capture: quote build failed (lead and deal kept)", e);
  }

  return {
    contact_id: contactId, location_id: locationId, lead_id: lead?.id ?? null,
    deal_id: dealId, quote_id: quoteId, quote_number: quoteNumber, value: customerTotal,
  };
}
