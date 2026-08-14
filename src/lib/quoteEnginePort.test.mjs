/* Port fidelity: the edge-function quote engine (TypeScript, used by the sales
 * chat) must produce the same numbers as src/lib/quoteEngine.js (used by the
 * quote builder). A drift here means the website tells someone one figure and
 * the quote that follows says another.
 *
 *   node --test src/lib/quoteEnginePort.test.mjs
 *
 * The TS file is transpiled on the fly with esbuild, so there is nothing to
 * keep in sync by hand.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import * as js from './quoteEngine.js';

const out = join(mkdtempSync(join(tmpdir(), 'qe-')), 'engine.mjs');
execFileSync('npx', [
  'esbuild', 'supabase/functions/_shared/quoteEngine.ts',
  '--format=esm', '--platform=neutral', `--outfile=${out}`,
], { stdio: 'pipe' });
const ts = await import(out);

// A catalogue shaped like the quote_config_* tables, with awkward numbers so a
// rounding difference cannot hide behind clean figures.
const rows = {
  config: {
    markup_default: 1.63, permits_per_sqft: 0.96,
    debris_per_sqft: 2.15, install_mat_divisor: 1000, currency: 'USD',
  },
  products: [
    { id: 'p1', name: 'Hardie ColorPlus Lap 8.25" x 12\'', type: 'sqft', unit_cost: 3.47, install_rate: 4.21, unit_label: 'sq ft', active: true },
    { id: 'p2', name: 'Hardie ColorPlus Battens', type: 'each', unit_cost: 11.9, install_rate: 6.5, unit_label: 'boards', active: true },
    { id: 'p3', name: 'Inactive product', type: 'sqft', unit_cost: 99, install_rate: 99, active: false },
  ],
  installMaterials: [
    { id: 'm1', name: 'House wrap', cost: 187.33, mult: 1.4, active: true },
    { id: 'm2', name: 'Fasteners', cost: 62.5, mult: 2.7, active: true },
  ],
  demoRates: [
    { id: 'd1', label: 'Demo Siding and Trim', rate_per_sqft: 1.37, active: true },
    { id: 'd2', label: 'Demo Stucco', rate_per_sqft: 3.05, active: true },
  ],
};

const CASES = [
  { name: 'typical two-storey re-side', totalSqft: 2450, numStories: 2, demoType: 'Demo Siding and Trim', qty: { p1: 2450 } },
  { name: 'stucco strip, single storey', totalSqft: 1180, numStories: 1, demoType: 'Demo Stucco', qty: { p1: 1180 } },
  { name: 'new build, no demo', totalSqft: 3310, numStories: 2, demoType: '', qty: { p1: 3310 } },
  { name: 'board and batten', totalSqft: 1975, numStories: 1, demoType: 'Demo Siding and Trim', qty: { p1: 1975, p2: 46 } },
  { name: 'awkward fractional sqft', totalSqft: 1333.7, numStories: 3, demoType: 'Demo Siding and Trim', qty: { p1: 1333.7 } },
  { name: 'zero sqft', totalSqft: 0, numStories: 1, demoType: '', qty: {} },
];

test('buildEngineConfig agrees', () => {
  assert.deepEqual(ts.buildEngineConfig(rows), js.buildEngineConfig(rows));
});

test('computeQuote agrees on every case', () => {
  const cfgTs = ts.buildEngineConfig(rows);
  const cfgJs = js.buildEngineConfig(rows);
  for (const c of CASES) {
    const inputs = { totalSqft: c.totalSqft, numStories: c.numStories, demoType: c.demoType, qty: c.qty };
    const a = ts.computeQuote(cfgTs, inputs);
    const b = js.computeQuote(cfgJs, inputs);
    for (const k of ['totalCost', 'salePrice', 'profit', 'margin', 'installSum', 'demoCost', 'permitsCost', 'debrisCost', 'laborCost']) {
      assert.equal(a[k], b[k], `${c.name}: ${k} drifted (${a[k]} vs ${b[k]})`);
    }
  }
});

test('buildEstimateRecord agrees', () => {
  const cfgTs = ts.buildEngineConfig(rows);
  const cfgJs = js.buildEngineConfig(rows);
  const inputs = { totalSqft: 2450, numStories: 2, demoType: 'Demo Siding and Trim', qty: { p1: 2450 } };
  assert.deepEqual(
    ts.buildEstimateRecord(ts.computeQuote(cfgTs, inputs), cfgTs),
    js.buildEstimateRecord(js.computeQuote(cfgJs, inputs), cfgJs),
  );
});

// ── Board-and-batten derivation ─────────────────────────────────────────────
// The rule: one batten every 12 inches — one batten per 10 sqft on the 4'x10'
// panels, finish-matched, Sierra excluded, an explicit qty overrides. This
// catalogue mirrors the LIVE quote_config_products rows (type 'batten').
const battenRows = {
  config: rows.config,
  products: [
    { id: 'pp', name: "Hardie 4'x10' Primed Panel", type: 'sqft', unit_cost: 2.4, install_rate: 5.5, unit_label: 'SQFT', active: true },
    { id: 'cp', name: "Hardie 4'x10' ColorPlus Panel", type: 'sqft', unit_cost: 5, install_rate: 5.5, unit_label: 'SQFT', active: true },
    { id: 'sp', name: "Hardie 4'x10' Primed Panel Sierra 8", type: 'sqft', unit_cost: 3.85, install_rate: 5.5, unit_label: 'SQFT', active: true },
    { id: 'lap', name: 'Hardie Primed Lap 8.25" x 12\'', type: 'sqft', unit_cost: 2.6, install_rate: 4.5, unit_label: 'SQFT', active: true },
    { id: 'bp', name: 'Hardie Primed Battens', type: 'batten', unit_cost: 14, install_rate: 0, unit_label: 'Per batten', active: true },
    { id: 'bc', name: 'Hardie ColorPlus Battens', type: 'batten', unit_cost: 21, install_rate: 0, unit_label: 'Per batten', active: true },
  ],
  installMaterials: rows.installMaterials,
  demoRates: rows.demoRates,
};
const battenCfg = js.buildEngineConfig(battenRows);
const rowFor = (res, id) => res.productRows.find((r) => r.id === id);

test('battens derive at one per 12 inches (quote #1054 scenario)', () => {
  // 1900 sqft of ColorPlus panel — the quote that shipped WITHOUT battens.
  const res = js.computeQuote(battenCfg, { totalSqft: 1900, numStories: 1, qty: { cp: 1900 } });
  const bc = rowFor(res, 'bc');
  assert.equal(bc.qty, 190, '1900 sqft of 4x10 panel needs 190 battens');
  assert.equal(bc.auto, true);
  assert.equal(bc.material, 190 * 21);
  assert.equal(rowFor(res, 'bp').qty, 0, 'primed battens stay off a ColorPlus job');
});

test('batten finish matches the panel finish, and partial coverage rounds up', () => {
  const res = js.computeQuote(battenCfg, { totalSqft: 2435, numStories: 1, qty: { pp: 535, cp: 1900 } });
  assert.equal(rowFor(res, 'bp').qty, 54, '535 sqft primed panel → ceil(53.5) primed battens');
  assert.equal(rowFor(res, 'bc').qty, 190);
});

test('grooved Sierra panels and lap take no battens', () => {
  const res = js.computeQuote(battenCfg, { totalSqft: 1800, numStories: 1, qty: { sp: 800, lap: 1000 } });
  assert.equal(rowFor(res, 'bp').qty, 0);
  assert.equal(rowFor(res, 'bc').qty, 0);
});

test('an explicit batten qty overrides the rule — including zero', () => {
  const fifty = js.computeQuote(battenCfg, { totalSqft: 1900, numStories: 1, qty: { cp: 1900, bc: 50 } });
  assert.equal(rowFor(fifty, 'bc').qty, 50);
  assert.equal(rowFor(fifty, 'bc').auto, false);
  const none = js.computeQuote(battenCfg, { totalSqft: 1900, numStories: 1, qty: { cp: 1900, bc: 0 } });
  assert.equal(rowFor(none, 'bc').qty, 0);
  // …but an EMPTY string (a cleared qty box) means "back to auto".
  const cleared = js.computeQuote(battenCfg, { totalSqft: 1900, numStories: 1, qty: { cp: 1900, bc: '' } });
  assert.equal(rowFor(cleared, 'bc').qty, 190);
});

test('derived battens land in the estimate record and the totals', () => {
  const res = js.computeQuote(battenCfg, { totalSqft: 1900, numStories: 1, qty: { cp: 1900 } });
  const rec = js.buildEstimateRecord(res, battenCfg);
  const line = rec.products.find((r) => r.id === 'bc');
  assert.equal(line.qty, 190);
  assert.equal(line.auto, true);
  assert.equal(res.sidingMaterialSum, 1900 * 5 + 190 * 21);
});

test('the TS port derives battens identically', () => {
  const cfgTs = ts.buildEngineConfig(battenRows);
  const inputsList = [
    { totalSqft: 1900, numStories: 1, qty: { cp: 1900 } },
    { totalSqft: 2435, numStories: 2, qty: { pp: 535, cp: 1900 } },
    { totalSqft: 1800, numStories: 1, qty: { sp: 800, lap: 1000 } },
    { totalSqft: 1900, numStories: 1, qty: { cp: 1900, bc: 50 } },
    { totalSqft: 1900, numStories: 1, qty: { cp: 1900, bc: 0 } },
    { totalSqft: 1900, numStories: 1, qty: { cp: 1900, bc: '' } },   // cleared box → derive
    { totalSqft: 1900, numStories: 1, qty: { cp: 1900, bc: '  ' } }, // whitespace → derive
    { totalSqft: 1900, numStories: 1, qty: { cp: 1900, bc: null } }, // null → derive
  ];
  for (const inputs of inputsList) {
    const a = ts.computeQuote(cfgTs, inputs);
    const b = js.computeQuote(battenCfg, inputs);
    for (const id of ['bp', 'bc']) {
      assert.equal(rowFor(a, id).qty, rowFor(b, id).qty, `${id} qty drifted`);
      assert.equal(rowFor(a, id).auto, rowFor(b, id).auto, `${id} auto flag drifted`);
    }
    for (const k of ['totalCost', 'salePrice', 'profit', 'margin', 'sidingMaterialSum']) {
      assert.equal(a[k], b[k], `${k} drifted`);
    }
  }
});

// The range the visitor is shown must bracket the engine price, and must never
// be presented as a single number.
test('guidance range brackets the engine price and rounds outward', () => {
  const cfg = ts.buildEngineConfig(rows);
  const res = ts.computeQuote(cfg, { totalSqft: 2450, numStories: 2, demoType: 'Demo Siding and Trim', qty: { p1: 2450 } });
  const band = 0.15, step = 500;
  const low = Math.floor((res.salePrice * (1 - band)) / step) * step;
  const high = Math.ceil((res.salePrice * (1 + band)) / step) * step;

  assert.ok(low < res.salePrice, 'low must sit below the engine price');
  assert.ok(high > res.salePrice, 'high must sit above the engine price');
  assert.equal(low % step, 0);
  assert.equal(high % step, 0);
  assert.ok(low >= res.salePrice * (1 - band) - step, 'low rounded further than one step');
});
