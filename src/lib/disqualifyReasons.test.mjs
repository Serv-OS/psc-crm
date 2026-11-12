/* Disqualify reasons: five fixed reasons for a construction company, then Other with typed words.
 *
 *   node --test src/lib/disqualifyReasons.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DISQUALIFY_REASONS, OTHER, disqualifyReasonText, reasonBucket } from './disqualifyReasons.js';

test('five fixed reasons, then Other, each with its own key', () => {
  assert.equal(DISQUALIFY_REASONS.length, 6);
  assert.equal(DISQUALIFY_REASONS[5].key, OTHER);
  assert.equal(new Set(DISQUALIFY_REASONS.map((r) => r.key)).size, 6);
  for (const r of DISQUALIFY_REASONS) assert.ok(r.label.length > 3 && !/[–—]/.test(r.label), r.key);
});

test('a fixed reason saves its label; Other saves the typed words, tidied, never empty', () => {
  assert.equal(disqualifyReasonText({ reason: 'budget' }), 'Budget does not fit the job');
  assert.equal(disqualifyReasonText({ reason: 'budget', other: 'ignored' }), 'Budget does not fit the job');
  assert.equal(disqualifyReasonText({ reason: OTHER, other: '  moved   house ' }), 'moved house');
  assert.equal(disqualifyReasonText({ reason: OTHER, other: '   ' }), null, 'Other needs words');
  assert.equal(disqualifyReasonText({ reason: OTHER }), null);
  assert.equal(disqualifyReasonText({ reason: 'made_up' }), null);
  assert.equal(disqualifyReasonText(), null);
  assert.equal(disqualifyReasonText({ reason: OTHER, other: 'x'.repeat(400) }).length, 300);
});

test('a saved reason reads back into its bucket; anything typed is Other', () => {
  assert.equal(reasonBucket('Outside our service area'), 'out_of_area');
  assert.equal(reasonBucket('moved house'), OTHER);
  assert.equal(reasonBucket(''), null);
  assert.equal(reasonBucket(null), null);
});

test('both lead screens use the dialog and no browser prompt is left; a disqualify writes stage history', () => {
  for (const f of ['../components/crm/LeadDetail.jsx', '../components/crm/LeadBoard.jsx']) {
    const src = fs.readFileSync(new URL(f, import.meta.url), 'utf8');
    assert.ok(!/prompt\('Disqualification reason/.test(src), `${f}: the old prompt is gone`);
    assert.match(src, /<DisqualifyDialog/, `${f} opens the dialog`);
    assert.match(src, /stage: 'disqualified', disqualified_reason: reason/, `${f} saves the reason`);
    assert.match(src, /to_stage: 'disqualified'/, `${f} records the stage change`);
  }
});
