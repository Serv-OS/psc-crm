import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

/* Pricing catalogue — the editable line-item prices that feed the quote estimator.
 * Replaces the legacy inventory/products screen. Changes here change every new quote's
 * costs; existing saved estimates keep their own snapshot. */

const TABS = [
  ['products', 'Siding products'],
  ['materials', 'Install materials'],
  ['demo', 'Demo rates'],
  ['rates', 'Rates & markup'],
];

const money = (v) => `$${Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function PricingCatalogue({ profile }) {
  const [tab, setTab] = useState('products');
  const [config, setConfig] = useState(null);
  const [products, setProducts] = useState([]);
  const [materials, setMaterials] = useState([]);
  const [demo, setDemo] = useState([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);

  const canWrite = profile.role === 'owner' || profile.role === 'editor';

  useEffect(() => { load(); }, []);

  const load = async () => {
    setLoading(true);
    const [c, p, m, d] = await Promise.all([
      supabase.from('quote_config').select('*').eq('id', 1).maybeSingle(),
      supabase.from('quote_config_products').select('*').order('sort'),
      supabase.from('quote_config_install_materials').select('*').order('sort'),
      supabase.from('quote_config_demo_rates').select('*').order('sort'),
    ]);
    setConfig(c.data || { id: 1, markup_default: 1.6, permits_per_sqft: 0.96, debris_per_sqft: 2, install_mat_divisor: 1000 });
    setProducts(p.data || []);
    setMaterials(m.data || []);
    setDemo(d.data || []);
    setLoading(false);
  };

  const upd = (setter, list, idx, patch) => setter(list.map((r, i) => i === idx ? { ...r, ...patch } : r));

  const addProduct = () => setProducts([...products, { _new: true, name: '', type: 'sqft', unit_cost: 0, install_rate: 0, unit_label: 'SQFT', sort: products.length, active: true }]);
  const addMaterial = () => setMaterials([...materials, { _new: true, name: '', cost: 0, mult: 1, sort: materials.length, active: true }]);
  const addDemo = () => setDemo([...demo, { _new: true, label: '', rate_per_sqft: 0, sort: demo.length, active: true }]);

  const clean = (rows, fields) => rows.map((r, i) => {
    const out = { sort: i };
    fields.forEach(f => { out[f] = r[f]; });
    if (!r._new && r.id) out.id = r.id;
    return out;
  });

  const save = async () => {
    setSaving(true); setSaved(false);
    await supabase.from('quote_config').upsert({
      id: 1,
      markup_default: Number(config.markup_default) || 1.6,
      permits_per_sqft: Number(config.permits_per_sqft) || 0,
      debris_per_sqft: Number(config.debris_per_sqft) || 0,
      install_mat_divisor: Number(config.install_mat_divisor) || 1000,
      updated_at: new Date().toISOString(),
    });
    await supabase.from('quote_config_products').upsert(clean(products, ['name', 'type', 'unit_cost', 'install_rate', 'unit_label', 'active']).map(r => ({ ...r, unit_cost: Number(r.unit_cost) || 0, install_rate: Number(r.install_rate) || 0 })), { onConflict: 'id' });
    await supabase.from('quote_config_install_materials').upsert(clean(materials, ['name', 'cost', 'mult', 'active']).map(r => ({ ...r, cost: Number(r.cost) || 0, mult: Number(r.mult) || 0 })), { onConflict: 'id' });
    await supabase.from('quote_config_demo_rates').upsert(clean(demo, ['label', 'rate_per_sqft', 'active']).map(r => ({ ...r, rate_per_sqft: Number(r.rate_per_sqft) || 0 })), { onConflict: 'id' });
    setSaving(false); setSaved(true); setTimeout(() => setSaved(false), 2500);
    load();
  };

  const input = "w-full px-3 py-2 bg-card border border-bdr rounded-xl text-sm text-paper placeholder-dim focus:outline-none focus:border-ember";
  const cell = "px-2 py-1.5 bg-card border border-bdr rounded-lg text-sm text-paper focus:outline-none focus:border-ember";
  const label = "text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-dim mb-1 block";

  if (loading) return <div className="h-full flex items-center justify-center text-dim text-sm">Loading…</div>;

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 py-4 border-b border-bdr flex items-center gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="text-xl font-bold text-paper">Pricing catalogue</div>
          <div className="text-xs text-muted mt-0.5">Line-item prices &amp; rates that feed the quote estimator</div>
        </div>
        {canWrite && (
          <div className="flex items-center gap-2">
            {saved && <span className="text-sm text-emerald-600 font-medium">✓ Saved</span>}
            <button onClick={save} disabled={saving} className="btn-glass px-5 py-2 rounded-xl text-sm font-semibold disabled:opacity-50">{saving ? 'Saving…' : 'Save changes'}</button>
          </div>
        )}
      </div>

      <div className="px-6 pt-4 flex gap-1 border-b border-bdr">
        {TABS.map(([k, lbl]) => (
          <button key={k} onClick={() => setTab(k)} className={`px-3 py-2 text-sm font-medium rounded-t-lg border-b-2 -mb-px ${tab === k ? 'border-ember text-paper' : 'border-transparent text-muted hover:text-paper'}`}>{lbl}</button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-[1100px]">
          {tab === 'products' && (
            <div className="glass-card rounded-2xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-[10px] uppercase tracking-wider text-dim border-b border-bdr">
                    <th className="text-left px-3 py-2">Product</th><th className="px-2 py-2 w-24">Unit</th>
                    <th className="text-right px-2 py-2 w-28">Unit cost</th><th className="text-right px-2 py-2 w-28">Install/unit</th>
                    <th className="text-center px-2 py-2 w-20">Active</th>
                  </tr></thead>
                  <tbody>
                    {products.map((p, i) => (
                      <tr key={p.id || `n${i}`} className={`border-b border-bdr/50 ${p.active === false ? 'opacity-50' : ''}`}>
                        <td className="px-3 py-2"><input className={cell + ' w-full'} value={p.name} onChange={e => upd(setProducts, products, i, { name: e.target.value })} placeholder="Product name" disabled={!canWrite} /></td>
                        <td className="px-2 py-2"><input className={cell + ' w-20'} value={p.unit_label || ''} onChange={e => upd(setProducts, products, i, { unit_label: e.target.value })} placeholder="SQFT" disabled={!canWrite} /></td>
                        <td className="px-2 py-2"><input type="number" step="0.01" className={cell + ' w-24 text-right'} value={p.unit_cost} onChange={e => upd(setProducts, products, i, { unit_cost: e.target.value })} disabled={!canWrite} /></td>
                        <td className="px-2 py-2"><input type="number" step="0.01" className={cell + ' w-24 text-right'} value={p.install_rate} onChange={e => upd(setProducts, products, i, { install_rate: e.target.value })} disabled={!canWrite} /></td>
                        <td className="px-2 py-2 text-center"><input type="checkbox" checked={p.active !== false} onChange={e => upd(setProducts, products, i, { active: e.target.checked })} disabled={!canWrite} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {canWrite && <div className="p-3 border-t border-bdr"><button onClick={addProduct} className="text-xs text-ember hover:text-ember-deep font-medium">+ Add product</button></div>}
            </div>
          )}

          {tab === 'materials' && (
            <div className="glass-card rounded-2xl overflow-hidden">
              <div className="px-4 py-3 text-[11px] text-dim border-b border-bdr">Quantities auto-calculate as <span className="font-mono">(sq ft ÷ {config.install_mat_divisor}) × stories × multiplier</span> (rounded to 1 dp).</div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-[10px] uppercase tracking-wider text-dim border-b border-bdr">
                    <th className="text-left px-3 py-2">Material</th><th className="text-right px-2 py-2 w-28">Cost</th>
                    <th className="text-right px-2 py-2 w-28">Multiplier</th><th className="text-center px-2 py-2 w-20">Active</th>
                  </tr></thead>
                  <tbody>
                    {materials.map((m, i) => (
                      <tr key={m.id || `n${i}`} className={`border-b border-bdr/50 ${m.active === false ? 'opacity-50' : ''}`}>
                        <td className="px-3 py-2"><input className={cell + ' w-full'} value={m.name} onChange={e => upd(setMaterials, materials, i, { name: e.target.value })} placeholder="Material name" disabled={!canWrite} /></td>
                        <td className="px-2 py-2"><input type="number" step="0.01" className={cell + ' w-24 text-right'} value={m.cost} onChange={e => upd(setMaterials, materials, i, { cost: e.target.value })} disabled={!canWrite} /></td>
                        <td className="px-2 py-2"><input type="number" step="0.01" className={cell + ' w-24 text-right'} value={m.mult} onChange={e => upd(setMaterials, materials, i, { mult: e.target.value })} disabled={!canWrite} /></td>
                        <td className="px-2 py-2 text-center"><input type="checkbox" checked={m.active !== false} onChange={e => upd(setMaterials, materials, i, { active: e.target.checked })} disabled={!canWrite} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {canWrite && <div className="p-3 border-t border-bdr"><button onClick={addMaterial} className="text-xs text-ember hover:text-ember-deep font-medium">+ Add material</button></div>}
            </div>
          )}

          {tab === 'demo' && (
            <div className="glass-card rounded-2xl overflow-hidden">
              <div className="px-4 py-3 text-[11px] text-dim border-b border-bdr">Demo cost = total sq ft × rate per sq ft.</div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-[10px] uppercase tracking-wider text-dim border-b border-bdr">
                    <th className="text-left px-3 py-2">Demo type</th><th className="text-right px-2 py-2 w-32">Rate / sq ft</th><th className="text-center px-2 py-2 w-20">Active</th>
                  </tr></thead>
                  <tbody>
                    {demo.map((d, i) => (
                      <tr key={d.id || `n${i}`} className={`border-b border-bdr/50 ${d.active === false ? 'opacity-50' : ''}`}>
                        <td className="px-3 py-2"><input className={cell + ' w-full'} value={d.label} onChange={e => upd(setDemo, demo, i, { label: e.target.value })} placeholder="e.g. Demo Siding and Trim" disabled={!canWrite} /></td>
                        <td className="px-2 py-2"><input type="number" step="0.01" className={cell + ' w-28 text-right'} value={d.rate_per_sqft} onChange={e => upd(setDemo, demo, i, { rate_per_sqft: e.target.value })} disabled={!canWrite} /></td>
                        <td className="px-2 py-2 text-center"><input type="checkbox" checked={d.active !== false} onChange={e => upd(setDemo, demo, i, { active: e.target.checked })} disabled={!canWrite} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {canWrite && <div className="p-3 border-t border-bdr"><button onClick={addDemo} className="text-xs text-ember hover:text-ember-deep font-medium">+ Add demo type</button></div>}
            </div>
          )}

          {tab === 'rates' && (
            <div className="glass-card rounded-2xl p-5 space-y-4 max-w-md">
              <div className="text-sm font-bold text-paper">Project rates &amp; default markup</div>
              <div><label className={label}>Default markup ×</label><input type="number" step="0.05" min="1" className={input} value={config.markup_default} onChange={e => setConfig({ ...config, markup_default: e.target.value })} disabled={!canWrite} />
                <div className="text-[10px] text-dim mt-1">Sale price = total cost × markup. Quoters can override per quote.</div></div>
              <div><label className={label}>Permits per sq ft</label><input type="number" step="0.01" className={input} value={config.permits_per_sqft} onChange={e => setConfig({ ...config, permits_per_sqft: e.target.value })} disabled={!canWrite} /></div>
              <div><label className={label}>Debris removal per sq ft</label><input type="number" step="0.01" className={input} value={config.debris_per_sqft} onChange={e => setConfig({ ...config, debris_per_sqft: e.target.value })} disabled={!canWrite} /></div>
              <div><label className={label}>Install-material divisor</label><input type="number" className={input} value={config.install_mat_divisor} onChange={e => setConfig({ ...config, install_mat_divisor: e.target.value })} disabled={!canWrite} />
                <div className="text-[10px] text-dim mt-1">Material qty = (sq ft ÷ divisor) × stories × multiplier.</div></div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
