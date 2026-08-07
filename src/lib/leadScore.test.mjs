/* Lead scoring is a commercial rule, so it lives in code and is tested, rather
 * than being re-judged by the model on every conversation.
 *
 *   node --test src/lib/leadScore.test.mjs
 *
 * Rules, from the pre-qualification spec:
 *   Hot         owner + damage/water + start ASAP or 1-3 months + booked
 *   Warm        owner + 3-6 months, or no appointment booked yet
 *   Nurture     just researching, no timeline, or budget far below range
 *   Disqualify  outside service area, or renter with no owner contact
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const out = join(mkdtempSync(join(tmpdir(), 'ls-')), 'score.mjs');
execFileSync('npx', [
  'esbuild', 'supabase/functions/_shared/leadScore.ts',
  '--format=esm', '--platform=neutral', `--outfile=${out}`,
], { stdio: 'pipe' });
const { scoreLead, qualificationSummary, painPoints, wantsVisit } = await import(out);

const HOT = {
  is_owner: true, has_damage: true, timeline: 'asap',
  preferred_days: 'Tue or Thu', preferred_times: 'morning',
};

test('hot: owner + damage + soon + availability', () => {
  const r = scoreLead(HOT);
  assert.equal(r.score, 'hot');
  assert.equal(r.priority, 'hot');
  assert.equal(r.stage, 'qualified');
});

test('hot also fires on water intrusion and a 1-3 month timeline', () => {
  const r = scoreLead({ ...HOT, has_damage: false, water_intrusion: true, timeline: '1_3_months' });
  assert.equal(r.score, 'hot');
  assert.match(r.reason, /water getting in/);
});

test('warm: everything hot needs, minus the availability', () => {
  const { preferred_days, preferred_times, ...noBooking } = HOT;
  const r = scoreLead(noBooking);
  assert.equal(r.score, 'warm');
  assert.match(r.reason, /no visit booked yet/);
});

test('warm: owner on a 3-6 month timeline', () => {
  const r = scoreLead({ is_owner: true, timeline: '3_6_months', preferred_days: 'weekends' });
  assert.equal(r.score, 'warm');
  assert.equal(r.priority, 'warm');
});

test('warm: damage and soon, but a tenant who gave the owner', () => {
  const r = scoreLead({ ...HOT, is_owner: false, owner_contact: 'Jane Diaz 650 555 0101' });
  assert.equal(r.score, 'warm', 'not hot — hot requires the owner themselves');
});

test('nurture: just researching, even with damage and availability', () => {
  const r = scoreLead({ ...HOT, timeline: 'researching' });
  assert.equal(r.score, 'nurture');
  assert.equal(r.priority, 'cold');
  assert.equal(r.stage, 'new_lead');
});

test('nurture: no timeline given at all', () => {
  const r = scoreLead({ is_owner: true, has_damage: true });
  assert.equal(r.score, 'nurture');
  assert.match(r.reason, /No timeline/);
});

test('nurture: budget ceiling under the floor', () => {
  const r = scoreLead({ ...HOT, budget_max: 3000 }, { budgetFloor: 5000 });
  assert.equal(r.score, 'nurture');
  assert.match(r.reason, /\$5,000/);
});

test('a budget at or above the floor does not demote', () => {
  assert.equal(scoreLead({ ...HOT, budget_max: 5000 }, { budgetFloor: 5000 }).score, 'hot');
  assert.equal(scoreLead({ ...HOT, budget_max: 40000 }, { budgetFloor: 5000 }).score, 'hot');
});

test('disqualify: outside the service area beats everything', () => {
  const r = scoreLead({ ...HOT, in_service_area: false });
  assert.equal(r.score, 'disqualify');
  assert.equal(r.stage, 'disqualified');
  assert.match(r.reason, /outside the service area/);
});

test('disqualify: renter with no owner contact', () => {
  const r = scoreLead({ ...HOT, is_owner: false });
  assert.equal(r.score, 'disqualify');
  assert.match(r.reason, /no owner/);
});

test('a renter WITH an owner contact is not disqualified', () => {
  assert.notEqual(scoreLead({ ...HOT, is_owner: false, owner_contact: 'Jane, 650 555 0101' }).score, 'disqualify');
});

test('"not asked" is never read as "no"', () => {
  // is_owner undefined must not be treated as a renter and disqualified.
  const r = scoreLead({ has_damage: true, timeline: 'asap', preferred_days: 'Mon' });
  assert.notEqual(r.score, 'disqualify');
  assert.equal(r.score, 'warm', 'ownership unknown cannot be hot, but is a live lead');
});

test('an empty conversation scores nurture, not disqualify', () => {
  const r = scoreLead({});
  assert.equal(r.score, 'nurture');
});

test('wantsVisit needs a day or a time', () => {
  assert.equal(wantsVisit({}), false);
  assert.equal(wantsVisit({ preferred_days: '  ' }), false);
  assert.equal(wantsVisit({ preferred_times: 'afternoon' }), true);
});

test('the summary is readable and omits what was never asked', () => {
  const text = qualificationSummary({
    is_owner: true, timeline: '1_3_months', has_damage: true, water_intrusion: true,
    current_material: 'vinyl', wants_insulation: true, preferred_days: 'Tue', preferred_times: 'am',
    heard_about_us: 'referral',
  });
  assert.match(text, /Owner: yes/);
  assert.match(text, /Damage: yes, including water getting in/);
  assert.match(text, /Timeline: 1-3 months/);
  assert.match(text, /Availability: Tue, am/);
  assert.ok(!text.includes('not asked'), 'unanswered fields must be left out entirely');
  assert.ok(!/Budget/.test(text), 'no budget was given, so no budget line');
});

test('pain points carry the reason they are looking', () => {
  assert.equal(painPoints({ motivation: 'preparing to sell', water_intrusion: true }),
    'preparing to sell; water getting in');
  assert.equal(painPoints({}), null);
});
