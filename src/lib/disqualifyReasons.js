// disqualifyReasons.js
// Why a lead is disqualified (Peter, 12 Nov 2026: "when we disqualify a lead it needs a drop
// down of reasons - pick 5 reasons for construction companies and then other which needs a
// typed box"). Five fixed reasons for a construction company, then Other with typed words.
//
// Stored in leads.disqualified_reason (text, already on both databases): the reason's label,
// or for Other the typed words, so reports can group the fixed five and read the rest.
// Pure: no React, no Supabase. Tests: disqualifyReasons.test.mjs.

export const OTHER = 'other';

export const DISQUALIFY_REASONS = Object.freeze([
  { key: 'out_of_area',       label: 'Outside our service area' },
  { key: 'budget',            label: 'Budget does not fit the job' },
  { key: 'another_contractor', label: 'Went with another contractor' },
  { key: 'no_response',       label: 'Could not reach them after follow ups' },
  { key: 'wrong_work',        label: 'Not the kind of work we do' },
  { key: OTHER,               label: 'Other' },
]);

/** The words saved on the lead, or null when the choice is not complete yet. */
export function disqualifyReasonText({ reason, other } = {}) {
  const r = DISQUALIFY_REASONS.find((x) => x.key === reason);
  if (!r) return null;
  if (r.key !== OTHER) return r.label;
  const words = String(other || '').trim().replace(/\s+/g, ' ');
  return words ? words.slice(0, 300) : null;
}

/** Group saved reasons for a report: the fixed five by label, everything else under Other. */
export function reasonBucket(savedText) {
  const t = String(savedText || '').trim();
  if (!t) return null;
  const hit = DISQUALIFY_REASONS.find((x) => x.key !== OTHER && x.label === t);
  return hit ? hit.key : OTHER;
}
