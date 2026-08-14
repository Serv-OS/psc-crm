/* Construction quote engine — config-driven, ported faithfully from the working
 * calculator in index.html (recalcAll). Prices and rates come from the DB-backed
 * catalogue (quote_config_* tables) so they are fully editable; the math is fixed.
 *
 * Math notes (kept byte-for-byte with the source tool):
 *  - Per product: material = unit_cost × qty, install = install_rate × qty.
 *  - Siding subtotal in the project total is MATERIAL ONLY; per-product install
 *    is rolled up separately as "Install Labor" (matches the source sheet D29).
 *  - Install-material qty = (sqft / divisor) × stories × mult, ROUNDED to 1 dp,
 *    then lineTotal = cost × roundedQty.  (index.html rounds; do not remove it.)
 *  - Permits = sqft × permitsPerSqft, Debris = sqft × debrisPerSqft.
 *  - Demo = sqft × demoRate when a demo type is selected.
 *  - Total cost = sidingMaterial + installMaterials + (labor + demo + permits + debris).
 *  - Sale price = totalCost × markup; profit = sale − cost; margin = profit / sale.
 */

function num(v, d = 0) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : d;
}

/** Map raw DB rows (quote_config_* tables) into the engine's working config. */
export function buildEngineConfig({ config = {}, products = [], installMaterials = [], demoRates = [] } = {}) {
  return {
    markupDefault: num(config.markup_default, 1.6),
    permitsPerSqft: num(config.permits_per_sqft, 0.96),
    debrisPerSqft: num(config.debris_per_sqft, 2),
    installMatDivisor: num(config.install_mat_divisor, 1000) || 1000,
    currency: config.currency || 'USD',
    products: (products || [])
      .filter((p) => p.active !== false)
      .map((p) => ({
        id: p.id,
        name: p.name,
        type: p.type || 'sqft',
        cost: num(p.unit_cost),
        installRate: num(p.install_rate),
        unit: p.unit_label || '',
      })),
    installMaterials: (installMaterials || [])
      .filter((m) => m.active !== false)
      .map((m) => ({ id: m.id, name: m.name, cost: num(m.cost), multiplier: num(m.mult) })),
    demoRates: (demoRates || [])
      .filter((d) => d.active !== false)
      .map((d) => ({ id: d.id, label: d.label, ratePerSqft: num(d.rate_per_sqft) })),
  };
}

/**
 * Compute a full quote breakdown.
 * @param cfg     output of buildEngineConfig
 * @param inputs  { totalSqft, numStories, demoType, markup, qty:{[productId]:n}, customItems:[{id,name,cost,installRate,qty,unit}] }
 */
export function computeQuote(cfg, inputs = {}) {
  const totalSqft = num(inputs.totalSqft);
  const numStories = num(inputs.numStories);
  const demoType = inputs.demoType || '';
  const markup = num(inputs.markup, cfg.markupDefault) || cfg.markupDefault;
  const qty = inputs.qty || {};
  const customItems = inputs.customItems || [];

  // === Board-and-batten: battens are DERIVED, never guessed ===
  // The rule: one batten every 12 inches. Panels are 4' wide and full-height,
  // so a batten covers a 1-ft-wide strip the height of the panel — one batten
  // per 10 sqft on the 4'x10' panels (the height is read from the product name
  // when it states one). Finish is matched: ColorPlus panels take ColorPlus
  // battens, primed panels take primed battens. Grooved Sierra panels make the
  // vertical look without battens, so they are excluded. Typing ANY quantity
  // on a batten line (0 included) overrides the rule — an estimator can still
  // correct it, but can no longer forget it.
  const autoBattens = {};
  for (const b of cfg.products) {
    if (b.type !== 'batten') continue;
    const provided = qty[b.id];
    if (!(provided === undefined || provided === null || String(provided).trim() === '')) continue;
    const wantsColor = /colorplus/i.test(b.name);
    let strips = 0;
    for (const p of cfg.products) {
      if (!/panel/i.test(p.name) || /sierra/i.test(p.name)) continue;
      if (/colorplus/i.test(p.name) !== wantsColor) continue;
      const sq = num(qty[p.id]);
      if (!(sq > 0)) continue;
      const hm = p.name.match(/x\s*(\d+)\s*'/i);
      const heightFt = hm ? num(hm[1], 10) : 10;
      strips += sq / (heightFt > 0 ? heightFt : 10);
    }
    if (strips > 0) autoBattens[b.id] = Math.ceil(strips);
  }

  // === Siding products (material + per-product install) ===
  let sidingMaterialSum = 0;
  let sidingInstallSum = 0;
  const productRows = cfg.products.map((p) => {
    const auto = autoBattens[p.id] !== undefined;
    const q = auto ? autoBattens[p.id] : num(qty[p.id]);
    const material = p.cost * q;
    const install = p.installRate * q;
    sidingMaterialSum += material;
    sidingInstallSum += install;
    return { ...p, qty: q, auto, material, install, lineTotal: material + install };
  });

  // === Custom (ad-hoc) siding items ===
  const customRows = customItems.map((c) => {
    const q = num(c.qty);
    const cost = num(c.cost);
    const installRate = num(c.installRate);
    const material = cost * q;
    const install = installRate * q;
    sidingMaterialSum += material;
    sidingInstallSum += install;
    return {
      id: c.id,
      name: c.name || 'Custom item',
      unit: c.unit || '',
      cost,
      installRate,
      qty: q,
      material,
      install,
      lineTotal: material + install,
      custom: true,
    };
  });

  // === Install materials (auto-calculated qty, rounded to 1 dp) ===
  let installSum = 0;
  const installMatRows = cfg.installMaterials.map((m) => {
    const rawQty = (totalSqft / cfg.installMatDivisor) * numStories * m.multiplier;
    const q = Math.round(rawQty * 10) / 10; // 1 decimal — matches source tool
    const lineTotal = m.cost * q;
    installSum += lineTotal;
    return { ...m, qty: q, lineTotal };
  });

  // === Additional costs ===
  const laborCost = sidingInstallSum;
  const demo = cfg.demoRates.find((d) => d.label === demoType || d.id === demoType);
  const demoRate = demo ? demo.ratePerSqft : 0;
  const demoCost = demoType && demoRate ? totalSqft * demoRate : 0;
  const permitsCost = totalSqft * cfg.permitsPerSqft;
  const debrisCost = totalSqft * cfg.debrisPerSqft;
  const additionalTotal = laborCost + demoCost + permitsCost + debrisCost;

  // === Grand totals ===
  const sidingSum = sidingMaterialSum; // material only; install is in labor
  const totalCost = sidingSum + installSum + additionalTotal;
  const salePrice = totalCost * markup;
  const profit = salePrice - totalCost;
  const margin = salePrice > 0 ? (profit / salePrice) * 100 : 0;

  return {
    productRows,
    customRows,
    installMatRows,
    sidingMaterialSum,
    sidingInstallSum,
    installSum,
    laborCost,
    demoCost,
    demoRate,
    demoType,
    permitsCost,
    debrisCost,
    additionalTotal,
    sidingSum,
    totalCost,
    salePrice,
    profit,
    margin,
    markup,
    totalSqft,
    numStories,
  };
}

/** Build the durable internal record (stored in quote_estimates.breakdown jsonb). */
export function buildEstimateRecord(result, cfg) {
  return {
    currency: cfg.currency,
    products: result.productRows
      .filter((r) => r.qty > 0)
      .map((r) => ({ id: r.id, name: r.name, unit: r.unit, cost: r.cost, installRate: r.installRate, qty: r.qty, auto: r.auto === true, material: r.material, install: r.install, lineTotal: r.lineTotal })),
    customItems: result.customRows.map((r) => ({ name: r.name, unit: r.unit, cost: r.cost, installRate: r.installRate, qty: r.qty, material: r.material, install: r.install, lineTotal: r.lineTotal })),
    installMaterials: result.installMatRows
      .filter((r) => r.qty > 0)
      .map((r) => ({ name: r.name, cost: r.cost, multiplier: r.multiplier, qty: r.qty, lineTotal: r.lineTotal })),
    additional: {
      labor: result.laborCost,
      demo: result.demoCost,
      demoType: result.demoType,
      permits: result.permitsCost,
      debris: result.debrisCost,
    },
    totals: {
      sidingMaterial: result.sidingMaterialSum,
      sidingInstall: result.sidingInstallSum,
      installMaterials: result.installSum,
      totalCost: result.totalCost,
      markup: result.markup,
      salePrice: result.salePrice,
      profit: result.profit,
      margin: result.margin,
    },
  };
}
