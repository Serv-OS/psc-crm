/* Quick estimate (Steve, 18 Nov 2026): type the sq ft, pick from dropdowns,
 * and the estimate shows one total per pick.
 *
 * This sits ON TOP of quoteEngine.js and never changes its maths: the picks
 * are turned into the same quantity map the detailed table fills in by hand,
 * the engine prices it, and the result is regrouped into one customer line
 * per dropdown.
 *
 *   Install Siding Product   the siding, its battens (auto for panels), the
 *                            install materials, permits and debris removal
 *   Demo                     the demo type picked (already a dropdown)
 *   Install Siding Trim      trim lengths: typed, or sq ft / sqft-per-length
 *   Other items              each one its own line; sq ft items cover the
 *                            whole wall unless a sq ft is typed, each items 1
 */

const num = (v, d = 0) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : d;
};
const typed = (v) => !(v === undefined || v === null || String(v).trim() === '');

export const GROUPS = [
  { key: 'siding', label: 'Install Siding Product' },
  { key: 'trim', label: 'Install Siding Trim' },
  { key: 'extra', label: 'Other items' },
];

/** The catalogue rows sorted into the three dropdowns. Inactive rows are left out. */
export function pickOptions(rawProducts = []) {
  const out = { siding: [], trim: [], extra: [] };
  for (const p of rawProducts) {
    if (p.active === false || !out[p.estimate_group]) continue;
    out[p.estimate_group].push(p);
  }
  return out;
}

/** Sq ft items cover the wall; everything else (each, length, Item) counts one. */
export const isPerSqft = (p) => (p?.type || 'sqft') === 'sqft' && !/^(each|item)$/i.test(String(p?.unit_label || '').trim());

export function autoTrimLengths(totalSqft, sqftPerLength) {
  const sq = num(totalSqft), per = num(sqftPerLength, 25) || 25;
  return sq > 0 ? Math.ceil(sq / per) : 0;
}

/**
 * picks = { siding: id|'', trim: id|'', trimLengths: ''|n, extras: { [id]: ''|n } }
 * Returns the engine's qty map. Battens are left out on purpose: the engine
 * derives them from the panel sq ft.
 */
export function picksToQty(picks = {}, rawProducts = [], totalSqft = 0, sqftPerLength = 25) {
  const byId = Object.fromEntries(rawProducts.map((p) => [p.id, p]));
  const sq = num(totalSqft);
  const qty = {};
  if (picks.siding && byId[picks.siding]) qty[picks.siding] = sq;
  if (picks.trim && byId[picks.trim]) {
    qty[picks.trim] = typed(picks.trimLengths) ? num(picks.trimLengths) : autoTrimLengths(sq, sqftPerLength);
  }
  for (const [id, v] of Object.entries(picks.extras || {})) {
    const p = byId[id];
    if (!p) continue;
    qty[id] = typed(v) ? num(v) : (isPerSqft(p) ? sq : 1);
  }
  return qty;
}

/** Best guess of the picks from a detailed quantity map (switching an old quote over). */
export function qtyToPicks(qty = {}, rawProducts = []) {
  const opts = pickOptions(rawProducts);
  const has = (p) => num(qty[p.id]) > 0;
  const siding = opts.siding.find(has);
  const trim = opts.trim.find(has);
  const extras = {};
  for (const p of opts.extra.filter(has)) extras[p.id] = '';
  return { siding: siding?.id || '', trim: trim?.id || '', trimLengths: trim ? String(num(qty[trim.id])) : '', extras };
}

/**
 * One line per pick, as COST (the caller multiplies by markup). The lines add
 * up to result.totalCost exactly: anything the engine priced that is not a
 * pick (battens, install materials, permits, debris) rides on the siding line.
 */
export function quickLines(result, picks = {}, rawProducts = []) {
  const byId = Object.fromEntries(rawProducts.map((p) => [p.id, p]));
  const rowCost = (id) => result.productRows.find((r) => r.id === id)?.lineTotal || 0;
  const lines = [];
  let accounted = 0;

  const push = (key, name, cost) => {
    lines.push({ key, name, cost });
    accounted += cost;
  };

  const siding = byId[picks.siding];
  if (picks.trim && byId[picks.trim]) push('trim', `Install Siding Trim: ${byId[picks.trim].name.trim()}`, rowCost(picks.trim));
  if (result.demoCost > 0) push('demo', `Demo: ${result.demoType}`, result.demoCost);
  for (const id of Object.keys(picks.extras || {})) {
    if (byId[id]) push(`x:${id}`, byId[id].name.trim(), rowCost(id));
  }
  for (const c of result.customRows || []) push(`c:${c.name}`, c.name, c.lineTotal);

  // Everything else: the siding itself plus what goes with any siding job.
  const rest = result.totalCost - accounted;
  if (siding || rest > 0.005) {
    lines.unshift({ key: 'siding', name: siding ? `Install Siding Product: ${siding.name.trim()}` : 'Install Siding Product', cost: rest });
  }
  return lines;
}
