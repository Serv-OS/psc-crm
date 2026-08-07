// Lead scoring, decided by code rather than by the model.
//
// The assistant reports what it was told — owner or tenant, damage or not, when
// they want to start. Turning that into hot/warm/nurture is a commercial rule,
// and a rule a rep acts on should be the same every time, not a judgement the
// model re-makes on each conversation.
//
// Rules, in the order they are applied:
//   Disqualify  outside the service area, or a renter with no owner contact
//   Hot         owner + damage + starting within 3 months + happy to book
//   Nurture     just researching, no timeline at all, or a budget well under
//               what a project of this kind costs
//   Warm        everything else — typically an owner 3-6 months out, or someone
//               who has not committed to a visit yet

export type LeadScore = "hot" | "warm" | "nurture" | "disqualify";

export type Timeline = "asap" | "1_3_months" | "3_6_months" | "researching" | "";

export interface Qualification {
  /** Stage 1 */
  is_owner?: boolean | null;
  owner_contact?: string | null;
  in_service_area?: boolean | null;
  /** Stage 2 */
  motivation?: string | null;
  has_damage?: boolean | null;
  water_intrusion?: boolean | null;
  scope?: string | null;
  areas?: string | null;
  home_age?: string | null;
  current_material?: string | null;
  wants_insulation?: boolean | null;
  other_items?: string | null;
  /** Stage 3 */
  timeline?: Timeline | null;
  budget_max?: number | null;
  wants_financing?: boolean | null;
  part_of_renovation?: string | null;
  /** Stage 4 */
  material_preference?: string | null;
  finish_preference?: string | null;
  /** Stage 5 */
  preferred_days?: string | null;
  preferred_times?: string | null;
  access_notes?: string | null;
  heard_about_us?: string | null;
}

/** Did they give us enough to actually book a visit? */
export function wantsVisit(q: Qualification): boolean {
  return !!((q.preferred_days || "").trim() || (q.preferred_times || "").trim());
}

export interface ScoreResult {
  score: LeadScore;
  /** Plain-English reason, written into the lead so a rep sees the logic. */
  reason: string;
  /** leads.priority */
  priority: "hot" | "warm" | "medium" | "cold";
  /** leads.stage */
  stage: "new_lead" | "qualified" | "disqualified";
}

export function scoreLead(q: Qualification, opts: { budgetFloor?: number } = {}): ScoreResult {
  const budgetFloor = typeof opts.budgetFloor === "number" ? opts.budgetFloor : 5000;

  // ── Disqualify ────────────────────────────────────────────────────────────
  if (q.in_service_area === false) {
    return {
      score: "disqualify", priority: "cold", stage: "disqualified",
      reason: "Property is outside the service area.",
    };
  }
  if (q.is_owner === false && !(q.owner_contact || "").trim()) {
    return {
      score: "disqualify", priority: "cold", stage: "disqualified",
      reason: "Not the owner, and no owner or decision-maker contact was given.",
    };
  }

  const soon = q.timeline === "asap" || q.timeline === "1_3_months";
  const damage = q.has_damage === true || q.water_intrusion === true;
  const booking = wantsVisit(q);

  // ── Nurture on budget, checked BEFORE hot ─────────────────────────────────
  // Urgency does not make an unaffordable job a hot lead. Someone with water
  // coming in who can spend $3,000 on a re-side is a nurture, not a rep's next
  // call, and sending a rep out to that is a wasted afternoon.
  if (typeof q.budget_max === "number" && q.budget_max > 0 && q.budget_max < budgetFloor) {
    return {
      score: "nurture", priority: "cold", stage: "new_lead",
      reason: `Stated budget ceiling is under $${budgetFloor.toLocaleString("en-US")}.`,
    };
  }

  // ── Hot ───────────────────────────────────────────────────────────────────
  if (q.is_owner === true && damage && soon && booking) {
    return {
      score: "hot", priority: "hot", stage: "qualified",
      reason: `Owner, ${q.water_intrusion ? "water getting in" : "damage reported"}, ` +
        `wants to start ${q.timeline === "asap" ? "as soon as possible" : "within 1-3 months"}, ` +
        `and gave availability for a visit.`,
    };
  }

  // ── Nurture on timeline ───────────────────────────────────────────────────
  if (q.timeline === "researching" || !q.timeline) {
    return {
      score: "nurture", priority: "cold", stage: "new_lead",
      reason: q.timeline === "researching" ? "Just researching for now." : "No timeline given.",
    };
  }

  // ── Warm ──────────────────────────────────────────────────────────────────
  const bits: string[] = [];
  if (q.is_owner === true) bits.push("owner");
  if (q.timeline === "3_6_months") bits.push("3-6 month timeline");
  else if (soon) bits.push(q.timeline === "asap" ? "wants to start soon" : "1-3 month timeline");
  if (!booking) bits.push("no visit booked yet");
  return {
    score: "warm", priority: "warm", stage: "qualified",
    reason: bits.length ? bits.join(", ") + "." : "Qualified, nothing blocking.",
  };
}

const yesNo = (v: boolean | null | undefined) => v === true ? "yes" : v === false ? "no" : "not asked";

/** The qualification as a rep wants to read it, straight into lead.notes. */
export function qualificationSummary(q: Qualification): string {
  const rows: Array<[string, string | null | undefined]> = [
    ["Owner", q.is_owner === null || q.is_owner === undefined ? "not established" : (q.is_owner ? "yes" : `no — ${q.owner_contact || "no owner contact given"}`)],
    ["In service area", yesNo(q.in_service_area)],
    ["Why now", q.motivation],
    ["Damage", q.has_damage === true ? (q.water_intrusion ? "yes, including water getting in" : "yes") : yesNo(q.has_damage)],
    ["Scope", q.scope ? `${q.scope}${q.areas ? ` — ${q.areas}` : ""}` : null],
    ["Home age", q.home_age],
    ["Current siding", q.current_material],
    ["Insulation wanted", yesNo(q.wants_insulation)],
    ["Other exterior work", q.other_items],
    ["Timeline", ({ asap: "as soon as possible", "1_3_months": "1-3 months", "3_6_months": "3-6 months", researching: "just researching" } as Record<string, string>)[q.timeline || ""] || null],
    ["Budget", typeof q.budget_max === "number" && q.budget_max > 0 ? `up to about $${Math.round(q.budget_max).toLocaleString("en-US")}` : null],
    ["Financing", yesNo(q.wants_financing)],
    ["Part of a renovation", q.part_of_renovation],
    ["Material preference", q.material_preference],
    ["Finish preference", q.finish_preference],
    ["Availability", [q.preferred_days, q.preferred_times].filter(Boolean).join(", ") || null],
    ["Site notes", q.access_notes],
    ["Heard about us", q.heard_about_us],
  ];
  return rows
    .filter(([, v]) => v && String(v).trim() && v !== "not asked")
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
}

/** leads.pain_points — the reason they are actually looking. */
export function painPoints(q: Qualification): string | null {
  const bits = [
    q.motivation,
    q.water_intrusion ? "water getting in" : q.has_damage ? "damage to existing siding" : null,
  ].filter(Boolean);
  return bits.length ? bits.join("; ") : null;
}
