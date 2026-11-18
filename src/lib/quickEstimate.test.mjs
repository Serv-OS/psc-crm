// node --test src/lib/quickEstimate.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEngineConfig, computeQuote } from './quoteEngine.js';
import { pickOptions, picksToQty, qtyToPicks, quickLines, autoTrimLengths } from './quickEstimate.js';

// Shaped like the live PSC catalogue on 18 Nov 2026.
const products = [
  { id: 'lap', name: 'Hardie ColorPlus Lap 8.25" x 12\'', type: 'sqft', unit_label: 'SQFT', unit_cost: 4.65, install_rate: 5.5, estimate_group: 'siding' },
  { id: 'panel', name: "Hardie 4'x10' Primed Panel", type: 'sqft', unit_label: 'SQFT', unit_cost: 14.25, install_rate: 5.5, estimate_group: 'siding' },
  { id: 'batten', name: 'Hardie Primed Battens', type: 'batten', unit_label: 'Per batten', unit_cost: 14, install_rate: 0 },
  { id: 'trim', name: 'Hardie Color Trim 3.5', type: 'length', unit_label: 'Per length', unit_cost: 39, install_rate: 0, estimate_group: 'trim' },
  { id: 'lead', name: 'Lead Test', type: 'sqft', unit_label: 'Item', unit_cost: 900, install_rate: 0, estimate_group: 'extra' },
  { id: 'ply', name: 'Plywood Material and Install', type: 'sqft', unit_label: 'SQFT', unit_cost: 3.5, install_rate: 2.2, estimate_group: 'extra' },
  { id: 'jack', name: 'Pump Jack Rental', type: 'each', unit_label: 'Each', unit_cost: 1500, install_rate: 0, estimate_group: 'extra' },
  { id: 'old', name: 'Old siding', type: 'sqft', unit_cost: 1, install_rate: 1, estimate_group: 'siding', active: false },
];
const cfg = buildEngineConfig({
  config: { markup_default: 1.45, permits_per_sqft: 0.96, debris_per_sqft: 1.25, install_mat_divisor: 1000 },
  products, installMaterials: [{ id: 'm', name: 'Wrap', cost: 312.5, mult: 1 }],
  demoRates: [{ id: 'd', label: 'Demo Siding and Trim', rate_per_sqft: 2.6 }],
});

test('the dropdowns hold only their own active products', () => {
  const o = pickOptions(products);
  assert.deepEqual(o.siding.map(p => p.id), ['lap', 'panel']);
  assert.deepEqual(o.trim.map(p => p.id), ['trim']);
  assert.deepEqual(o.extra.map(p => p.id), ['lead', 'ply', 'jack']);
});

test('sq ft fills the siding, trim lengths and sq ft extras; flat items count one', () => {
  const q = picksToQty({ siding: 'lap', trim: 'trim', trimLengths: '', extras: { lead: '', ply: '', jack: '' } }, products, 1000, 25);
  assert.deepEqual(q, { lap: 1000, trim: 40, lead: 1, ply: 1000, jack: 1 });
  assert.equal(autoTrimLengths(1100, 25), 44);
});

test('a typed number beats the rule', () => {
  const q = picksToQty({ siding: 'lap', trim: 'trim', trimLengths: '30', extras: { ply: '400' } }, products, 1000, 25);
  assert.equal(q.trim, 30);
  assert.equal(q.ply, 400);
});

test('one line per pick, and the lines add up to the whole cost', () => {
  const picks = { siding: 'panel', trim: 'trim', trimLengths: '', extras: { lead: '', jack: '' } };
  const r = computeQuote(cfg, { totalSqft: 1000, demoType: 'Demo Siding and Trim', qty: picksToQty(picks, products, 1000, 25) });
  const lines = quickLines(r, picks, products);
  assert.deepEqual(lines.map(l => l.key), ['siding', 'trim', 'demo', 'x:lead', 'x:jack']);
  const sum = lines.reduce((s, l) => s + l.cost, 0);
  assert.ok(Math.abs(sum - r.totalCost) < 1e-6);
  // Battens are derived from the panel and ride on the siding line.
  assert.equal(r.productRows.find(x => x.id === 'batten').qty, 100);
  assert.equal(lines.find(l => l.key === 'trim').cost, 40 * 39);
  assert.equal(lines.find(l => l.key === 'x:jack').cost, 1500);
  assert.equal(lines[0].name, "Install Siding Product: Hardie 4'x10' Primed Panel");
});

test('an old detailed quote becomes picks', () => {
  assert.deepEqual(qtyToPicks({ lap: '1000', trim: '40', lead: '1', batten: '' }, products),
    { siding: 'lap', trim: 'trim', trimLengths: '40', extras: { lead: '' } });
});
