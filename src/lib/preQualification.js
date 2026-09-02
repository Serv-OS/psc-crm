/* The intro call sheet, as data.
 *
 * This is the PRE-qualification: the questions asked on the phone before anyone
 * drives out. It is not the scope of work, which is the estimator's document
 * and belongs on site with a tape measure. Those two had been collapsed into
 * one 12-section form, so booking a call meant filling in a survey.
 *
 * Faithful to the paper sheet, in the order it is actually asked, so someone
 * reading down the page and someone reading down the screen stay in step.
 *
 * The field keys deliberately match the Qualification type in
 * supabase/functions/_shared/leadScore.ts, which the website sales chat already
 * fills in. A call and a chat therefore produce the SAME shape, so scoreLead()
 * grades both identically and a lead is not hot or cold depending on which door
 * it came through.
 *
 * Storage matches the scope questionnaire: a crm_activities row on the lead with
 * channel_metadata { kind:'pre_qualification', answers }. No schema change,
 * versioned by insertion, older answers kept as history of what was said when.
 */

export const PREQUAL_KIND = 'pre_qualification';

export const SECTIONS = [
  {
    key: 'who', title: '1 · Who we are speaking to',
    fields: [
      { key: 'is_owner', label: 'Are they the homeowner?', type: 'choice', required: true,
        options: ['Yes', 'No — renter', 'No — agent or family'] },
      { key: 'owner_contact', label: 'Who is the owner, and how do we reach them?', type: 'text',
        showIf: a => String(a.is_owner || '').startsWith('No') },
      { key: 'in_service_area', label: 'Is the property in our service area?', type: 'choice', required: true,
        options: ['Yes', 'No', 'Not sure — check'] },
      { key: 'home_age', label: 'Roughly what year was the home built?', type: 'text' },
    ],
  },
  {
    key: 'why', title: '2 · Why they are calling',
    fields: [
      // Paper Q1. Free text on purpose: the reason in their own words is what
      // the estimator reads back to them on the doorstep.
      { key: 'motivation', label: 'What is the primary reason for wanting new siding?', type: 'text', required: true },
      // Paper Q2, split so the scorer can read damage without parsing prose.
      { key: 'damage_signs', label: 'Any leaks, mold or rot? Cracked or warped siding?', type: 'multi',
        options: ['Leaks', 'Mold', 'Rot', 'Cracked', 'Warped', 'None noticed', 'Not sure'] },
      { key: 'current_material', label: 'What siding is on the house now?', type: 'text' },
    ],
  },
  {
    key: 'work', title: '3 · What they want done',
    fields: [
      { key: 'scope', label: 'What areas of the home?', type: 'choice', required: true,
        options: ['Whole home', 'Whole home plus garage', 'Certain elevations only'] },
      { key: 'areas', label: 'Which elevations, and which are worst?', type: 'text' },
      // Paper Q4 is two questions in one. Three options answer both at once.
      { key: 'wants_insulation', label: 'Insulation on the areas we are working?', type: 'choice',
        options: ['Already insulated', 'None — interested', 'None — not interested', 'Not sure'] },
      { key: 'other_items', label: 'Any other improvements or repairs? Windows, doors, trim', type: 'text' },
    ],
  },
  {
    key: 'timing', title: '4 · Timing and budget',
    fields: [
      { key: 'timeline', label: 'When are they looking to start?', type: 'choice', required: true,
        options: ['As soon as possible', '1-3 months', '3-6 months', 'Just researching'] },
      { key: 'budget_max', label: 'Budget they want to stay within', type: 'text' },
      { key: 'wants_financing', label: 'Do they need financing?', type: 'choice', options: ['Yes', 'No', 'Wants to hear options'] },
      { key: 'part_of_renovation', label: 'Coordinating with any other renovations?', type: 'text' },
    ],
  },
  {
    key: 'product', title: '5 · Product preference',
    fields: [
      { key: 'material_preference', label: 'Brand they have in mind', type: 'text' },
      { key: 'profile_preference', label: 'Style', type: 'choice',
        options: ['Lap', 'Panel', 'Shingle', 'Artisan', 'Undecided'] },
      { key: 'finish_preference', label: 'Primed or prefinished?', type: 'choice',
        options: ['Prefinished', 'Primed', 'Undecided'] },
      { key: 'seen_manufacturer_site', label: 'Been to the Hardie website?', type: 'choice', options: ['Yes', 'No'] },
      { key: 'seen_our_site', label: 'Been to ours?', type: 'choice', options: ['Yes', 'No'] },
    ],
  },
  {
    key: 'matters', title: '6 · What matters to them',
    fields: [
      // Paper Q11 and Q12. Both are buying signals worth capturing as answers
      // rather than losing in a notes box: they tell the estimator what to lead
      // with, and they are the difference between competing on price and not.
      { key: 'wants_workmanship_warranty', label: 'Do they want a workmanship warranty on top of the manufacturer one?', type: 'choice',
        options: ['Yes', 'No', 'Not important to them'] },
      { key: 'wants_certified_installers', label: 'Is it important the installers are Hardie certified?', type: 'choice',
        options: ['Yes', 'No', 'Not important to them'] },
    ],
  },
  {
    key: 'visit', title: '7 · Booking the estimate',
    fields: [
      { key: 'preferred_days', label: 'Which days suit them?', type: 'multi',
        options: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] },
      { key: 'preferred_times', label: 'What time of day?', type: 'choice',
        options: ['Mornings', 'Afternoons', 'Evenings', 'Flexible'] },
      { key: 'access_notes', label: 'Anything about access, dogs, gates, parking', type: 'text' },
      { key: 'heard_about_us', label: 'How did they hear about us?', type: 'text' },
      { key: 'extra_notes', label: 'Anything else they would like to share?', type: 'text' },
    ],
  },
];

const answered = (field, a) => {
  const v = a[field.key] ?? '';
  if (field.type === 'multi') return Array.isArray(v) && v.length > 0;
  return String(v).trim() !== '';
};
const visible = (field, a) => !field.showIf || field.showIf(a);

/** Required questions still unanswered, as [{section, field}]. Empty = complete. */
export function missingRequired(answersBySection) {
  const out = [];
  for (const s of SECTIONS) {
    const a = answersBySection[s.key] || {};
    for (const f of s.fields) {
      if (f.required && visible(f, a) && !answered(f, a)) out.push({ section: s.title, field: f.label });
    }
  }
  return out;
}

/** Plain-text summary — the activity body, and the fallback anywhere structured
 *  rendering is not available. Answered questions only. */
export function summarize(answersBySection) {
  const lines = ['Intro call — pre-qualification'];
  for (const s of SECTIONS) {
    const a = answersBySection[s.key] || {};
    const rows = s.fields.filter(f => visible(f, a) && answered(f, a));
    if (!rows.length) continue;
    lines.push('', s.title);
    for (const f of rows) {
      const v = f.type === 'multi' ? (a[f.key] || []).join(', ') : String(a[f.key]).trim();
      lines.push(`  ${f.label}: ${v}`);
    }
  }
  return lines.join('\n');
}

/* Flatten the sectioned answers into the flat Qualification shape that
 * scoreLead() and the sales chat both speak, so a phone call and a website chat
 * are graded by the same rules. Without this the CRM would collect the same
 * facts and still be unable to say whether the lead was hot. */
export function toQualification(answersBySection = {}) {
  const g = (sec, key) => (answersBySection[sec] || {})[key];
  const signs = g('why', 'damage_signs') || [];
  const hasSign = (x) => signs.includes(x);
  const money = String(g('timing', 'budget_max') || '').replace(/[^0-9.]/g, '');

  return {
    is_owner: g('who', 'is_owner') ? g('who', 'is_owner') === 'Yes' : null,
    owner_contact: g('who', 'owner_contact') || null,
    in_service_area: g('who', 'in_service_area') === 'Yes' ? true
      : g('who', 'in_service_area') === 'No' ? false : null,
    home_age: g('who', 'home_age') || null,

    motivation: g('why', 'motivation') || null,
    // "None noticed" is an answer, not a blank: it means asked and cleared.
    has_damage: signs.length === 0 ? null
      : hasSign('None noticed') ? false
      : ['Leaks', 'Mold', 'Rot', 'Cracked', 'Warped'].some(hasSign) ? true : null,
    water_intrusion: hasSign('Leaks') || hasSign('Mold') || hasSign('Rot') || null,
    current_material: g('why', 'current_material') || null,

    scope: g('work', 'scope') || null,
    areas: g('work', 'areas') || null,
    wants_insulation: g('work', 'wants_insulation') === 'None — interested' ? true
      : g('work', 'wants_insulation') === 'None — not interested' ? false : null,
    other_items: g('work', 'other_items') || null,

    timeline: ({ 'As soon as possible': 'asap', '1-3 months': '1_3_months',
      '3-6 months': '3_6_months', 'Just researching': 'researching' })[g('timing', 'timeline')] || '',
    budget_max: money ? Number(money) : null,
    wants_financing: g('timing', 'wants_financing') === 'Yes' ? true
      : g('timing', 'wants_financing') === 'No' ? false : null,
    part_of_renovation: g('timing', 'part_of_renovation') || null,

    material_preference: g('product', 'material_preference') || null,
    profile_preference: g('product', 'profile_preference') || null,
    finish_preference: g('product', 'finish_preference') || null,

    preferred_days: (g('visit', 'preferred_days') || []).join(', ') || null,
    preferred_times: g('visit', 'preferred_times') || null,
    access_notes: g('visit', 'access_notes') || null,
    heard_about_us: g('visit', 'heard_about_us') || null,
  };
}
