/* The definition of "completed" for the lead-creation gate. If this drifts,
 * either un-qualified leads slip through or the form demands answers to
 * questions that aren't visible.
 *
 *   node --test src/lib/scopeQuestionnaire.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SECTIONS, missingRequired, summarize } from './scopeQuestionnaire.js';

const COMPLETE = {
  goals: { reasons: ['Damage', 'Water intrusion'], look: 'Change the appearance', scope_area: 'Entire house' },
  existing: { current_type: 'Stucco', remove: 'Yes' },
  selection: { style: 'Lap', finish: 'Prefinished', supplied_by: 'Contractor' },
  condition: { known_damage: 'Yes', damage_notes: 'Rot at NW corner', sheathing: 'Allowance / unit price' },
  windows: { staying: 'Yes', trim: 'Replace' },
  weatherproofing: { housewrap: 'Yes', flashing: 'Yes' },
  disposal: { existing_material: 'Remove & dispose' },
  approvals: { hoa: 'No', historic: 'Unknown' },
  expectations: { success: 'Straight lines, clean site, matches the render.' },
};

test('a fully answered questionnaire is complete', () => {
  assert.deepEqual(missingRequired(COMPLETE), []);
});

test('an empty questionnaire is missing every required question', () => {
  const missing = missingRequired({});
  const requiredCount = SECTIONS.flatMap(s => s.fields).filter(f => f.required).length;
  // showIf-gated required fields don't count when hidden — none are required, so:
  assert.equal(missing.length, requiredCount);
  assert.ok(missing.length >= 15, `expected a substantial gate, got ${missing.length}`);
});

test('dropping one required answer reopens the gate with the right name', () => {
  const partial = structuredClone(COMPLETE);
  delete partial.approvals.hoa;
  const missing = missingRequired(partial);
  assert.equal(missing.length, 1);
  assert.match(missing[0].field, /HOA/);
});

test('conditional detail fields are not demanded when hidden', () => {
  // known_damage 'No' hides damage_notes; the gate must not ask for it.
  const a = structuredClone(COMPLETE);
  a.condition = { known_damage: 'No', sheathing: 'Yes' };
  assert.deepEqual(missingRequired(a), []);
});

test('the expectations question is genuinely required', () => {
  const a = structuredClone(COMPLETE);
  a.expectations = { success: '   ' };
  const missing = missingRequired(a);
  assert.equal(missing.length, 1);
  assert.match(missing[0].section, /expectations/i);
});

test('the summary carries answers and skips unanswered sections', () => {
  const text = summarize(COMPLETE);
  assert.match(text, /Project goals/);
  assert.match(text, /Damage, Water intrusion/);
  assert.match(text, /Rot at NW corner/);
  assert.ok(!/Hidden \/ additional/.test(text), 'unanswered sections stay out');
});
