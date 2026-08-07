// Construction quote engine — a faithful TypeScript port of src/lib/quoteEngine.js.
//
// The whole point of the sales chat is that it prices with the SAME math and the
// SAME catalogue a salesperson uses, so a figure a visitor is told on the website
// cannot drift from the quote that follows. Any change to src/lib/quoteEngine.js
// must be mirrored here.
//
// Math notes (kept byte-for-byte with the source tool):
//  - Per product: material = unit_cost x qty, install = install_rate x qty.
//  - Siding subtotal in the project total is MATERIAL ONLY; per-product install
//    is rolled up separately as "Install Labor".
//  - Install-material qty = (sqft / divisor) x stories x mult, ROUNDED to 1 dp,
//    then lineTotal = cost x roundedQty. The rounding is deliberate.
//  - Permits = sqft x permitsPerSqft, Debris = sqft x debrisPerSqft.
//  - Demo = sqft x demoRate when a demo type is selected.
//  - Total cost = sidingMaterial + installMaterials + (labor + demo + permits + debris).
//  - Sale price = totalCost x markup.

export function num(v: unknown, d = 0): number {
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : d;
}

export interface EngineConfig {
  markupDefault: number;
  permitsPerSqft: number;
  debrisPerSqft: number;
  installMatDivisor: number;
  currency: string;
  products: Array<{ id: string; name: string; type: string; cost: number; installRate: number; unit: string }>;
  installMaterials: Array<{ id: string; name: string; cost: number; multiplier: number }>;
  demoRates: Array<{ id: string; label: string; ratePerSqft: number }>;
}

/** Map raw DB rows (quote_config_* tables) into the engine's working config. */
export function buildEngineConfig(
  { config = {} as any, products = [] as any[], installMaterials = [] as any[], demoRates = [] as any[] } = {},
): EngineConfig {
  return {
    markupDefault: num(config.markup_default, 1.6),
    permitsPerSqft: num(config.permits_per_sqft, 0.96),
    debrisPerSqft: num(config.debris_per_sqft, 2),
    installMatDivisor: num(config.install_mat_divisor, 1000) || 1000,
    currency: config.currency || "USD",
    products: (products || []).filter((p: any) => p.active !== false).map((p: any) => ({
      id: p.id,
      name: p.name,
      type: p.type || "sqft",
      cost: num(p.unit_cost),
      installRate: num(p.install_rate),
      unit: p.unit_label || "",
    })),
    installMaterials: (installMaterials || []).filter((m: any) => m.active !== false).map((m: any) => ({
      id: m.id, name: m.name, cost: num(m.cost), multiplier: num(m.mult),
    })),
    demoRates: (demoRates || []).filter((d: any) => d.active !== false).map((d: any) => ({
      id: d.id, label: d.label, ratePerSqft: num(d.rate_per_sqft),
    })),
  };
}

export function computeQuote(cfg: EngineConfig, inputs: any = {}) {
  const totalSqft = num(inputs.totalSqft);
  const numStories = num(inputs.numStories);
  const demoType = inputs.demoType || "";
  const markup = num(inputs.markup, cfg.markupDefault) || cfg.markupDefault;
  const qty = inputs.qty || {};
  const customItems = inputs.customItems || [];

  let sidingMaterialSum = 0;
  let sidingInstallSum = 0;
  const productRows = cfg.products.map((p) => {
    const q = num(qty[p.id]);
    const material = p.cost * q;
    const install = p.installRate * q;
    sidingMaterialSum += material;
    sidingInstallSum += install;
    return { ...p, qty: q, material, install, lineTotal: material + install };
  });

  const customRows = (customItems as any[]).map((c) => {
    const q = num(c.qty);
    const cost = num(c.cost);
    const installRate = num(c.installRate);
    const material = cost * q;
    const install = installRate * q;
    sidingMaterialSum += material;
    sidingInstallSum += install;
    return {
      id: c.id, name: c.name || "Custom item", unit: c.unit || "", cost, installRate,
      qty: q, material, install, lineTotal: material + install, custom: true,
    };
  });

  let installSum = 0;
  const installMatRows = cfg.installMaterials.map((m) => {
    const rawQty = (totalSqft / cfg.installMatDivisor) * numStories * m.multiplier;
    const q = Math.round(rawQty * 10) / 10;   // 1 decimal — matches the source tool
    const lineTotal = m.cost * q;
    installSum += lineTotal;
    return { ...m, qty: q, lineTotal };
  });

  const laborCost = sidingInstallSum;
  const demo = cfg.demoRates.find((d) => d.label === demoType || d.id === demoType);
  const demoRate = demo ? demo.ratePerSqft : 0;
  const demoCost = demoType && demoRate ? totalSqft * demoRate : 0;
  const permitsCost = totalSqft * cfg.permitsPerSqft;
  const debrisCost = totalSqft * cfg.debrisPerSqft;
  const additionalTotal = laborCost + demoCost + permitsCost + debrisCost;

  const sidingSum = sidingMaterialSum;   // material only; install is in labor
  const totalCost = sidingSum + installSum + additionalTotal;
  const salePrice = totalCost * markup;
  const profit = salePrice - totalCost;
  const margin = salePrice > 0 ? (profit / salePrice) * 100 : 0;

  return {
    productRows, customRows, installMatRows,
    sidingMaterialSum, sidingInstallSum, installSum,
    laborCost, demoCost, demoRate, demoType, permitsCost, debrisCost, additionalTotal,
    sidingSum, totalCost, salePrice, profit, margin, markup, totalSqft, numStories,
  };
}

/** The durable internal record stored in quote_estimates.breakdown. */
export function buildEstimateRecord(result: any, cfg: EngineConfig) {
  return {
    currency: cfg.currency,
    products: result.productRows.filter((r: any) => r.qty > 0).map((r: any) => ({
      id: r.id, name: r.name, unit: r.unit, cost: r.cost, installRate: r.installRate,
      qty: r.qty, material: r.material, install: r.install, lineTotal: r.lineTotal,
    })),
    customItems: result.customRows.map((r: any) => ({
      name: r.name, unit: r.unit, cost: r.cost, installRate: r.installRate,
      qty: r.qty, material: r.material, install: r.install, lineTotal: r.lineTotal,
    })),
    installMaterials: result.installMatRows.filter((r: any) => r.qty > 0).map((r: any) => ({
      name: r.name, cost: r.cost, multiplier: r.multiplier, qty: r.qty, lineTotal: r.lineTotal,
    })),
    additional: {
      labor: result.laborCost, demo: result.demoCost, demoType: result.demoType,
      permits: result.permitsCost, debris: result.debrisCost,
    },
    totals: {
      sidingMaterial: result.sidingMaterialSum, sidingInstall: result.sidingInstallSum,
      installMaterials: result.installSum, totalCost: result.totalCost, markup: result.markup,
      salePrice: result.salePrice, profit: result.profit, margin: result.margin,
    },
  };
}

/** Customer-facing quote lines — the same shape the instant-quote form produces. */
export const SITE_WORKS_LABEL = "Site preparation, materials, permits & debris removal";

export function buildCustomerLines(res: any, taxRate: number) {
  const mk = res.markup;
  const lines: any[] = [];
  let sort = 0;
  res.productRows.filter((r: any) => r.qty > 0).forEach((r: any) => {
    const lineCustomer = r.lineTotal * mk;
    lines.push({
      product_id: null, name: r.name, description: r.unit ? `${r.qty} ${r.unit}` : null,
      category: "services", billing_type: "one_off", qty: r.qty,
      unit_price: r.qty ? lineCustomer / r.qty : lineCustomer,
      discount: 0, tax_rate: taxRate, line_total: lineCustomer, sort: sort++,
    });
  });
  const siteWorks = (res.installSum + res.demoCost + res.permitsCost + res.debrisCost) * mk;
  if (siteWorks > 0) {
    lines.push({
      product_id: null, name: SITE_WORKS_LABEL,
      description: "Underlayment & install materials, building permits, demolition and debris removal",
      category: "services", billing_type: "one_off", qty: 1, unit_price: siteWorks,
      discount: 0, tax_rate: taxRate, line_total: siteWorks, sort: sort++,
    });
  }
  return lines;
}

// Website vocabulary -> exact catalogue product name (quote_config_products).
export const PRODUCT_NAMES: Record<string, Record<string, string>> = {
  lap: { colorplus: 'Hardie ColorPlus Lap 8.25" x 12\'', primed: 'Hardie Primed Lap 8.25" x 12\'' },
  panel: { colorplus: "Hardie 4'x10' ColorPlus Panel", primed: "Hardie 4'x10' Primed Panel" },
  shingle: { colorplus: "Straight Edge Shingles ColorPlus", primed: "Straight Edge Shingles Primed" },
  artisan: { colorplus: "Hardie Artisan V Rustic", primed: "Hardie Artisan V Rustic" },
};
export const BATTEN_NAMES: Record<string, string> = {
  colorplus: "Hardie ColorPlus Battens",
  primed: "Hardie Primed Battens",
};
export const DEMO_LABELS: Record<string, string> = {
  siding: "Demo Siding and Trim",
  stucco: "Demo Stucco",
  trim: "Demo Trim",
  newbuild: "",
};
