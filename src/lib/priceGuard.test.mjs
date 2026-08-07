/* The price guard decides whether a reply is quoting a project price. If it
 * misses one, the assistant can put an invented figure in front of a customer;
 * if it fires too easily, ordinary sentences get replaced with a fallback.
 *
 *   node --test src/lib/priceGuard.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const out = join(mkdtempSync(join(tmpdir(), 'pg-')), 'guard.mjs');
execFileSync('npx', [
  'esbuild', 'supabase/functions/_shared/priceGuard.ts',
  '--format=esm', '--platform=neutral', `--outfile=${out}`,
], { stdio: 'pipe' });
const { mentionsPrice, moneyFigures } = await import(out);

test('catches what a bot would actually say', () => {
  const quoting = [
    'Somewhere around $28,000 for a job that size.',
    'I would budget $25k to $30k.',
    'Roughly $18,500 all in.',
    'It usually lands between $22,000 and $27,500.',
    'about $9,800',
    'Expect $1.2m for the whole terrace.',
    'Ballpark: $45000.',
    'That would be $ 12,400 or so.',
  ];
  for (const s of quoting) assert.equal(mentionsPrice(s), true, `missed: ${s}`);
});

test('ignores small change and non-money numbers', () => {
  const innocent = [
    'There is $0 to pay up front.',
    'We take a $50 holding deposit.',
    'That is about 2,450 square feet.',
    'Call us on 650 398 5153.',
    'We have been going since 1998.',
    'It is a 2 storey property with 30 windows.',
    'No cost to you for the survey.',
    '',
  ];
  for (const s of innocent) assert.equal(mentionsPrice(s), false, `false alarm: ${s}`);
});

test('parses figures correctly', () => {
  assert.deepEqual(moneyFigures('$25k to $30k'), [25000, 30000]);
  assert.deepEqual(moneyFigures('$28,000'), [28000]);
  assert.deepEqual(moneyFigures('$1.2m'), [1200000]);
  assert.deepEqual(moneyFigures('no money here'), []);
});

test('a real engine-backed range is still flagged (the session check is what allows it)', () => {
  // The guard only asks "is this a price?" — whether it is allowed is decided by
  // whether the session has an estimate. So a legitimate range must flag true.
  assert.equal(mentionsPrice('Based on that, somewhere between $24,500 and $33,000.'), true);
});
