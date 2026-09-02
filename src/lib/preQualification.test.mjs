/* The intro call and the website chat must grade identically. If they do not, a
 * lead is hot or cold depending on which door it came through.
 *
 *   node --test src/lib/preQualification.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SECTIONS, missingRequired, summarize, toQualification } from './preQualification.js';

const out = join(mkdtempSync(join(tmpdir(), 'pq-')), 'score.mjs');
execFileSync('npx', ['esbuild', 'supabase/functions/_shared/leadScore.ts',
  '--format=esm', '--platform=neutral', `--outfile=${out}`], { stdio: 'pipe' });
const { scoreLead, wantsVisit } = await import(out);

// The call in the scanned sheet, answered as the estimator wrote it.
const REAL_CALL = {
  who:    { is_owner: 'Yes', in_service_area: 'Yes' },
  why:    { motivation: 'Whole house and garage. Plus door and window work.',
            damage_signs: ['Cracked'] },
  work:   { scope: 'Whole home plus garage', areas: 'Front and sides are the worst',
            wants_insulation: 'None — interested', other_items: 'Windows and doors' },
  timing: { timeline: 'As soon as possible', part_of_renovation: 'Not yet' },
  product:{ material_preference: 'Hardie', profile_preference: 'Lap', finish_preference: 'Prefinished',
            seen_manufacturer_site: 'Yes', seen_our_site: 'Yes' },
  matters:{ wants_workmanship_warranty: 'Yes', wants_certified_installers: 'Yes' },
  visit:  { preferred_times: 'Mornings' },
};

test('the paper sheet maps onto the scorer and comes out hot', () => {
  const q = toQualification(REAL_CALL);
  assert.equal(q.is_owner, true);
  assert.equal(q.has_damage, true);          // cracked counts
  assert.equal(q.timeline, 'asap');
  assert.equal(q.scope, 'Whole home plus garage');
  assert.equal(wantsVisit(q), true);         // mornings is enough to book
  assert.equal(scoreLead(q).score, 'hot');
});

test('a call and a chat with the same facts score the same', () => {
  const fromCall = toQualification(REAL_CALL);
  const fromChat = {                          // what the website assistant writes
    is_owner: true, in_service_area: true, has_damage: true, timeline: 'asap',
    preferred_times: 'Mornings',
  };
  assert.equal(scoreLead(fromCall).score, scoreLead(fromChat).score);
});

test('"none noticed" is an answer, not a blank', () => {
  const q = toQualification({ why: { damage_signs: ['None noticed'] } });
  assert.equal(q.has_damage, false);          // asked and cleared
  const unasked = toQualification({});
  assert.equal(unasked.has_damage, null);     // never asked
});

test('a renter with no owner contact is disqualified', () => {
  const q = toQualification({
    who: { is_owner: 'No — renter', in_service_area: 'Yes' },
    timing: { timeline: 'As soon as possible' },
  });
  assert.equal(q.is_owner, false);
  assert.equal(scoreLead(q).score, 'disqualify');
});

test('just researching is nurture, not hot, even with damage', () => {
  const q = toQualification({
    who: { is_owner: 'Yes', in_service_area: 'Yes' },
    why: { damage_signs: ['Rot'] },
    timing: { timeline: 'Just researching' },
  });
  assert.equal(scoreLead(q).score, 'nurture');
});

test('budget survives being typed as money', () => {
  assert.equal(toQualification({ timing: { budget_max: '$25,000' } }).budget_max, 25000);
  assert.equal(toQualification({ timing: { budget_max: '' } }).budget_max, null);
});

test('only five questions block the call', () => {
  const missing = missingRequired({});
  assert.equal(missing.length, 5);
  // Everything the scorer needs, and nothing that stalls a live conversation.
  const labels = missing.map(m => m.field).join(' | ');
  for (const need of ['homeowner', 'service area', 'primary reason', 'areas of the home', 'looking to start']) {
    assert.ok(labels.toLowerCase().includes(need.toLowerCase()), `expected a required question about "${need}"`);
  }
});

test('the summary reads as the call, in the order it was asked', () => {
  const text = summarize(REAL_CALL);
  assert.ok(text.startsWith('Intro call — pre-qualification'));
  assert.ok(text.indexOf('1 · Who we are speaking to') < text.indexOf('7 · Booking the estimate'));
  assert.ok(text.includes('Whole house and garage'));
  assert.ok(!text.includes('undefined'));
});

test('every question has a label and a usable type', () => {
  for (const s of SECTIONS) {
    for (const f of s.fields) {
      assert.ok(f.label && f.key, `${s.key}: field missing key or label`);
      assert.ok(['text', 'choice', 'multi'].includes(f.type), `${s.key}.${f.key}: bad type ${f.type}`);
      if (f.type !== 'text') assert.ok((f.options || []).length, `${s.key}.${f.key}: no options`);
    }
  }
});
