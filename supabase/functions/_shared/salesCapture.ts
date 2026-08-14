// Turn a qualified enquiry into pipeline records: contact -> property ->
// lead -> deal -> DRAFT quote, round-robin assigned to the least loaded rep.
//
// This is the same sequence the website instant-quote form performs, kept here
// so the chat assistant produces a lead a rep cannot tell apart from a form
// submission. (instant-quote/index.ts now imports the same shared engine — its
// old inline copy silently missed the batten rule.)
//
// Everything after the lead is best-effort: a failure building the quote must
// never cost us the lead itself.

import {
  buildEngineConfig, computeQuote, buildEstimateRecord, buildCustomerLines,
  PRODUCT_NAMES, DEMO_LABELS, num,
} from "./quoteEngine.ts";
import { scoreLead, qualificationSummary, painPoints, type Qualification } from "./leadScore.ts";

export interface CaptureInput {
  name: string;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  zip?: string | null;
  /** Free text for the rep — anything the bot learned that has no field. */
  notes?: string | null;
  source?: string;
  /** The staged pre-qualification answers. Drives scoring and the lead notes. */
  qualification?: Qualification | null;
  /** A stated budget ceiling under this marks the lead nurture rather than warm. */
  budgetFloor?: number;
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
  score: "hot" | "warm" | "nurture" | "disqualify";
  score_reason: string;
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

/**
 * Build the draft quote with the real engine and catalogue, and hang it off the
 * deal. Shared by the first save and by any later enrichment, because the square
 * footage often only turns up after the lead already exists.
 */
export async function buildDraftQuote(
  supabase: any,
  args: {
    dealId: string;
    contactId: string | null;
    locationId: string | null;
    ownerId: string | null;
    project: CaptureInput["project"];
  },
): Promise<{ quoteId: string | null; quoteNumber: number | null; total: number }> {
  const p = args.project || {};
  const sqft = num(p.sqft);
  if (!(sqft > 0)) return { quoteId: null, quoteNumber: null, total: 0 };

  const profileKey = String(p.profileKey || "lap");
  const finishKey = String(p.finishKey || "colorplus") === "primed" ? "primed" : "colorplus";
  const demoKey = String(p.demoKey || "siding");

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
  // p.battenBoards is deliberately NOT written into qty: it is always a
  // machine-derived (or model-guessed, pre-rule) count, and an explicit qty is
  // a MANUAL override in the engine — persisting it would freeze battens on
  // the drafted quote so they stop tracking sqft edits in the QuoteBuilder.
  // The engine derives battens itself: one every 12 inches of panel,
  // finish-matched. Only a human typing in the QuoteBuilder overrides that.

  const result = computeQuote(cfg, {
    totalSqft: sqft, numStories: num(p.stories, 1),
    demoType: DEMO_LABELS[demoKey] || "", markup: cfg.markupDefault, qty,
  });

  const taxRate = 0;                       // US — sales adjusts on review
  const salePrice = result.salePrice;
  const taxAmount = salePrice * taxRate / 100;
  const total = salePrice + taxAmount;

  const { data: q } = await supabase.from("quotes").insert({
    deal_id: args.dealId, contact_id: args.contactId, location_id: args.locationId, status: "draft",
    valid_until: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
    payment_terms: "pay_now", tax_rate: taxRate,
    one_off_subtotal: salePrice, tax_amount: taxAmount, one_off_total: total, recurring_arr: 0,
    notes: "Auto-drafted from a website chat. The visitor was given a range, not this figure — review before sending.",
    created_by: args.ownerId,
  }).select("id, quote_number").single();
  const quoteId = q?.id ?? null;

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
    await supabase.from("deals").update({ value: total, currency: "USD" }).eq("id", args.dealId);
  }

  return { quoteId, quoteNumber: q?.quote_number ?? null, total };
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
  const sqft = num(input.project?.sqft);
  const q = input.qualification || {};
  const scored = scoreLead(q, { budgetFloor: input.budgetFloor });

  const { data: lead } = await supabase.from("leads").insert({
    name, source,
    location_id: locationId, contact_id: contactId, owner_id: ownerId,
    ...leadFieldsFor(q, scored, input.project, input.notes),
  }).select("id").single();
  if (lead) {
    await supabase.from("stage_history").insert({
      object_type: "lead", object_id: lead.id, from_stage: null, to_stage: scored.stage, changed_by: ownerId,
    });
  }

  // Out of area, or a renter we cannot reach an owner through: recorded so
  // marketing can see it, but no deal and no quote.
  if (scored.score === "disqualify") {
    return {
      score: scored.score, score_reason: scored.reason,
      contact_id: contactId, location_id: locationId, lead_id: lead?.id ?? null,
      deal_id: null, quote_id: null, quote_number: null, value: 0,
    };
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
    if (lead) await supabase.from("leads").update({ deal_id: dealId }).eq("id", lead.id);
  }

  // ── Draft quote — only when we actually have a square footage ─────────────
  let quoteId: string | null = null;
  let quoteNumber: number | null = null;
  let customerTotal = 0;
  if (dealId && sqft > 0) {
    try {
      const built = await buildDraftQuote(supabase, {
        dealId, contactId, locationId, ownerId, project: input.project,
      });
      quoteId = built.quoteId; quoteNumber = built.quoteNumber; customerTotal = built.total;
    } catch (e) {
      console.error("sales capture: quote build failed (lead and deal kept)", e);
    }
  }

  return {
    score: scored.score, score_reason: scored.reason,
    contact_id: contactId, location_id: locationId, lead_id: lead?.id ?? null,
    deal_id: dealId, quote_id: quoteId, quote_number: quoteNumber, value: customerTotal,
  };
}


/** The lead fields that are recomputed every time we learn something new. */
function leadFieldsFor(
  q: Qualification,
  scored: ReturnType<typeof scoreLead>,
  project: CaptureInput["project"],
  extraNotes?: string | null,
) {
  const p = project || {};
  const sqft = num(p.sqft);
  const money = (v?: number) => (v ? "$" + Math.round(v).toLocaleString("en-US") : "");
  const availability = [q.preferred_days, q.preferred_times].filter(Boolean).join(", ");

  const notes = [
    `Captured by the website sales assistant — scored ${scored.score.toUpperCase()}.`,
    `Why: ${scored.reason}`,
    "",
    qualificationSummary(q) || "Nothing established beyond contact details.",
    "",
    sqft > 0
      ? `Project: ~${Math.round(sqft).toLocaleString("en-US")} sq ft · ${num(p.stories, 1)} storey · ${p.profileKey || "lap"} · ${p.finishKey || "colorplus"}`
      : "Square footage not established.",
    p.estimateLow && p.estimateHigh ? `Guidance range given in chat: ${money(p.estimateLow)}–${money(p.estimateHigh)}` : "",
    extraNotes ? `\nFrom the conversation:\n${extraNotes}` : "",
  ].join("\n").replace(/\n{3,}/g, "\n\n").trim();

  return {
    stage: scored.stage,
    priority: scored.priority,
    notes,
    pain_points: painPoints(q),
    next_action: scored.score === "disqualify"
      ? null
      : availability ? `Book the on-site estimate — they suggested ${availability}` : "Call to book the on-site estimate",
    disqualified_reason: scored.score === "disqualify" ? scored.reason : null,
  };
}

export interface EnrichInput {
  leadId: string;
  dealId?: string | null;
  contactId?: string | null;
  locationId?: string | null;
  quoteId?: string | null;
  qualification?: Qualification | null;
  project?: CaptureInput["project"];
  notes?: string | null;
  budgetFloor?: number;
  /** Newly learned address details, if the visitor gave them after the first save. */
  address?: string | null;
  city?: string | null;
  zip?: string | null;
}

/**
 * Update a lead the assistant already created.
 *
 * Contact details come first in the script, so the lead is saved long before the
 * qualification is finished. Without this, everything learned after that first
 * save — the damage, the timeline, when they can meet — never reached the CRM,
 * and a genuinely hot lead landed scored "nurture, no timeline given".
 */
export async function enrichSalesLead(supabase: any, input: EnrichInput): Promise<CaptureResult> {
  const q = input.qualification || {};
  const scored = scoreLead(q, { budgetFloor: input.budgetFloor });

  await supabase.from("leads")
    .update(leadFieldsFor(q, scored, input.project, input.notes))
    .eq("id", input.leadId);

  // A property address that only came out later.
  if (input.locationId && (input.address || input.city || input.zip)) {
    const patch: Record<string, unknown> = {};
    if (input.address) { patch.address = input.address; patch.name = input.address; }
    if (input.city) patch.city = input.city;
    if (input.zip) patch.postcode = input.zip;
    if (Object.keys(patch).length) await supabase.from("locations").update(patch).eq("id", input.locationId);
  }

  // Out of area after the fact: park the deal rather than leave it in the pipeline.
  if (scored.score === "disqualify" && input.dealId) {
    await supabase.from("deals").update({ stage: "closed_lost" }).eq("id", input.dealId);
  }

  // The estimate may only have arrived after the lead was saved.
  let quoteId = input.quoteId ?? null;
  let quoteNumber: number | null = null;
  let value = 0;
  if (!quoteId && input.dealId && scored.score !== "disqualify" && num(input.project?.sqft) > 0) {
    try {
      const built = await buildDraftQuote(supabase, {
        dealId: input.dealId, contactId: input.contactId ?? null, locationId: input.locationId ?? null,
        ownerId: null, project: input.project,
      });
      quoteId = built.quoteId; quoteNumber = built.quoteNumber; value = built.total;
    } catch (e) {
      console.error("sales enrich: quote build failed (lead kept)", e);
    }
  }

  return {
    score: scored.score, score_reason: scored.reason,
    contact_id: input.contactId ?? null, location_id: input.locationId ?? null,
    lead_id: input.leadId, deal_id: input.dealId ?? null,
    quote_id: quoteId, quote_number: quoteNumber, value,
  };
}
