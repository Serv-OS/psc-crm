/* The Homeowner Siding Scope-of-Work Questionnaire, as data.
 *
 * Faithful to the paper form estimators already use (12 sections, from Project
 * Goals to Scope Classification). One schema drives everything: the popup that
 * gates lead creation, the validation of what "completed" means, the structured
 * card on the lead record, and the plain-text summary written into the lead's
 * activity feed.
 *
 * Storage: a crm_activities row on the lead —
 *   { type:'note', subject_type:'lead', channel_metadata:{ kind:'scope_questionnaire', answers } }
 * with the readable summary as the body. No schema change, versioned by
 * insertion: the newest row wins, older ones remain as history.
 *
 * "Completed" = every field marked required is answered. Free-text lines from
 * the paper form stay optional — you cannot force prose — with one exception:
 * the homeowner-expectations question, which is the whole point of the form.
 */

export const SCOPE_KIND = 'scope_questionnaire';

export const SECTIONS = [
  {
    key: 'goals', title: '1 · Project goals',
    fields: [
      { key: 'reasons', label: 'Why are they considering replacing the siding?', type: 'multi', required: true,
        options: ['Age', 'Damage', 'Water intrusion', 'Appearance', 'Energy efficiency', 'Other'] },
      { key: 'reasons_other', label: 'Other reason', type: 'text', showIf: a => (a.reasons || []).includes('Other') },
      { key: 'look', label: 'Change the appearance, or replicate the existing look?', type: 'choice', required: true,
        options: ['Change the appearance', 'Replicate existing look', 'Undecided'] },
      { key: 'scope_area', label: 'Entire house, or certain elevations/areas?', type: 'choice', required: true,
        options: ['Entire house', 'Certain elevations / areas'] },
      { key: 'areas', label: 'Which elevations / areas', type: 'text', showIf: a => a.scope_area === 'Certain elevations / areas' },
    ],
  },
  {
    key: 'existing', title: '2 · Existing siding',
    fields: [
      { key: 'current_type', label: 'What type of siding is currently installed?', type: 'text', required: true },
      { key: 'remove', label: 'Is the existing siding to be removed?', type: 'choice', required: true, options: ['Yes', 'No', 'Discuss'] },
      { key: 'resided_before', label: 'Has the home been re-sided previously?', type: 'choice', options: ['Yes', 'No', 'Unknown'] },
      { key: 'problem_areas', label: 'Known problem areas or previous repairs', type: 'textarea' },
    ],
  },
  {
    key: 'selection', title: '3 · New siding selection',
    fields: [
      { key: 'manufacturer', label: 'Manufacturer / product', type: 'text' },
      { key: 'profile_width', label: 'Profile / width', type: 'text' },
      { key: 'style', label: 'Style', type: 'choice', required: true,
        options: ['Lap', 'Shingle', 'Board-and-batten', 'Vertical', 'Shake', 'Other'] },
      { key: 'style_other', label: 'Other style', type: 'text', showIf: a => a.style === 'Other' },
      { key: 'finish', label: 'Finish', type: 'choice', required: true, options: ['Primed', 'Prefinished'] },
      { key: 'color', label: 'Color', type: 'text' },
      { key: 'supplied_by', label: 'Material supplied by', type: 'choice', required: true, options: ['Contractor', 'Homeowner', 'Other'] },
    ],
  },
  {
    key: 'condition', title: '4 · Condition under existing siding',
    fields: [
      { key: 'known_damage', label: 'Any known rot, soft spots, leaks, or water damage?', type: 'choice', required: true, options: ['Yes', 'No', 'Unknown'] },
      { key: 'damage_notes', label: 'Details', type: 'textarea', showIf: a => a.known_damage === 'Yes' },
      { key: 'attention_areas', label: 'Areas around windows, doors, decks, corners or rooflines needing attention', type: 'textarea' },
      { key: 'sheathing', label: 'Replace damaged sheathing/framing as discovered?', type: 'choice', required: true,
        options: ['Yes', 'No', 'Allowance / unit price'] },
      { key: 'repair_notes', label: 'Notes / known repairs', type: 'textarea' },
    ],
  },
  {
    key: 'windows', title: '5 · Windows & doors',
    fields: [
      { key: 'staying', label: 'Are windows/doors staying?', type: 'choice', required: true, options: ['Yes', 'No', 'Some being replaced'] },
      { key: 'trim', label: 'Exterior trim', type: 'choice', required: true,
        options: ['Existing to remain', 'Replace', 'Replicate existing', 'New design'] },
      { key: 'flashing_work', label: 'Include sill / casing / flashing / waterproofing work?', type: 'choice', options: ['Yes', 'No', 'Discuss'] },
      { key: 'special', label: 'Special window or door details', type: 'textarea' },
    ],
  },
  {
    key: 'exterior', title: '6 · Exterior details',
    fields: [
      { key: 'items', label: 'Items involved', type: 'multi',
        options: ['Fascia', 'Soffits', 'Gutters/downspouts', 'Exterior lights', 'Hose bibs', 'Electrical outlets',
                  'Dryer vents', 'Mailbox', 'House numbers', 'Shutters', 'Deck/railings', 'Chimney', 'Garage trim'] },
      { key: 'items_other', label: 'Other exterior items', type: 'text' },
    ],
  },
  {
    key: 'weatherproofing', title: '7 · Weatherproofing',
    fields: [
      { key: 'housewrap', label: 'New housewrap / water-resistive barrier?', type: 'choice', required: true, options: ['Yes', 'No'] },
      { key: 'flashing', label: 'New flashing at windows/doors?', type: 'choice', required: true, options: ['Yes', 'No'] },
      { key: 'kickout', label: 'Kick-out flashing / Z-flashing where required?', type: 'choice', options: ['Yes', 'No'] },
      { key: 'rain_screen', label: 'Rain-screen / ventilated cavity?', type: 'choice', options: ['Yes', 'No', 'Discuss'] },
      { key: 'other', label: 'Other waterproofing requirements', type: 'textarea' },
    ],
  },
  {
    key: 'disposal', title: '8 · Removal, disposal & protection',
    fields: [
      { key: 'existing_material', label: 'Existing material', type: 'choice', required: true,
        options: ['Remove & dispose', 'Salvage', 'Leave in place in specified areas'] },
      { key: 'protection', label: 'Protection required (landscaping, decks, patios, walkways…)', type: 'textarea' },
      { key: 'access', label: 'Special access or staging concerns', type: 'textarea' },
    ],
  },
  {
    key: 'approvals', title: '9 · Approvals / restrictions',
    fields: [
      { key: 'hoa', label: 'HOA approval required?', type: 'choice', required: true, options: ['Yes', 'No', 'Unknown'] },
      { key: 'historic', label: 'Historic / architectural restrictions?', type: 'choice', required: true, options: ['Yes', 'No', 'Unknown'] },
      { key: 'requirements', label: 'Specific color, material, or profile requirements', type: 'textarea' },
    ],
  },
  {
    key: 'expectations', title: '10 · Homeowner expectations',
    fields: [
      { key: 'success', label: 'What would make them say the project was completed exactly the way they wanted?', type: 'textarea', required: true },
    ],
  },
  {
    key: 'hidden', title: '11 · Hidden / additional work',
    fields: [
      { key: 'known_additional', label: 'Anything they already know needs attention, even if not technically part of the siding', type: 'textarea' },
    ],
  },
  {
    key: 'classification', title: '12 · Scope classification',
    hint: 'Confirm allowances, unit prices, exclusions and concealed-condition work are clearly explained before the proposal is accepted.',
    fields: [
      { key: 'base_scope', label: 'Base scope — included in quoted price', type: 'textarea' },
      { key: 'allowances', label: 'Known allowances / unit prices (rot, sheathing, framing…)', type: 'textarea' },
      { key: 'optional_work', label: 'Optional work', type: 'textarea' },
      { key: 'exclusions', label: 'Exclusions', type: 'textarea' },
      { key: 'estimator_notes', label: 'Estimator notes / measurements', type: 'textarea' },
    ],
  },
];

const answered = (field, a) => {
  const v = (a[field.key] ?? '');
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
 *  rendering isn't available. Answered questions only. */
export function summarize(answersBySection) {
  const lines = ['Scope-of-work questionnaire'];
  for (const s of SECTIONS) {
    const a = answersBySection[s.key] || {};
    const rows = s.fields.filter(f => visible(f, a) && answered(f, a));
    if (!rows.length) continue;
    lines.push('', s.title.replace(/^\d+ · /, (m) => m)); // keep numbering
    for (const f of rows) {
      const v = f.type === 'multi' ? (a[f.key] || []).join(', ') : String(a[f.key]).trim();
      lines.push(`  ${f.label}: ${v}`);
    }
  }
  return lines.join('\n');
}
