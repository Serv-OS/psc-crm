import { useEffect, useState, useMemo } from 'react';
import { supabase } from '../../lib/supabase';
import { handleClosedWon } from '../../lib/dealHelpers';

const CAT_LABEL = { hardware: 'Hardware', services: 'Services', saas: 'SaaS', payments: 'Payments' };
const STATUS_STYLES = {
  draft: 'bg-slate-100 text-slate-600 border border-slate-200',
  sent: 'bg-blue-100 text-blue-700 border border-blue-200',
  viewed: 'bg-indigo-100 text-indigo-700 border border-indigo-200',
  signed: 'bg-purple-100 text-purple-700 border border-purple-200',
  paid: 'bg-emerald-100 text-emerald-700 border border-emerald-200',
  won: 'bg-emerald-100 text-emerald-700 border border-emerald-200',
  declined: 'bg-red-100 text-red-700 border border-red-200',
  expired: 'bg-slate-100 text-slate-500 border border-slate-200',
  void: 'bg-slate-100 text-slate-500 border border-slate-200',
};

const lineTotal = (it) => (Number(it.qty) || 0) * (Number(it.unit_price) || 0) * (1 - (Number(it.discount) || 0) / 100);
const money = (v) => `$${Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function QuoteBuilder({ quoteId, profile, onClose, onNavigate }) {
  const [quote, setQuote] = useState(null);
  const [items, setItems] = useState([]);
  const [products, setProducts] = useState([]);
  const [location, setLocation] = useState(null);
  const [contact, setContact] = useState(null);
  const [locations, setLocations] = useState([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const canWrite = profile.role === 'owner' || profile.role === 'editor';

  useEffect(() => { load(); }, [quoteId]);

  const load = async () => {
    const [q, li, pr] = await Promise.all([
      supabase.from('quotes').select('*').eq('id', quoteId).single(),
      supabase.from('quote_line_items').select('*').eq('quote_id', quoteId).order('sort'),
      supabase.from('products').select('*').eq('active', true).order('category').order('name'),
    ]);
    setQuote(q.data);
    setItems((li.data || []).map(x => ({ ...x })));
    setProducts(pr.data || []);
    supabase.from('locations').select('id, name, city').order('name').limit(200).then(r => setLocations(r.data || []));
    if (q.data?.location_id) supabase.from('locations').select('id, name, city').eq('id', q.data.location_id).single().then(r => setLocation(r.data));
    else setLocation(null);
    if (q.data?.contact_id) supabase.from('contacts').select('id, first_name, last_name, email').eq('id', q.data.contact_id).single().then(r => setContact(r.data));
  };

  const setQ = (k, v) => setQuote(prev => ({ ...prev, [k]: v }));
  const updateItem = (idx, patch) => setItems(items.map((it, i) => i === idx ? { ...it, ...patch } : it));
  const removeItem = (idx) => setItems(items.filter((_, i) => i !== idx));
  const addCustom = () => setItems([...items, { product_id: null, name: '', description: '', category: 'hardware', billing_type: 'one_off', qty: 1, unit_price: 0, discount: 0, tax_rate: 0 }]);
  const addProduct = (p) => setItems([...items, {
    product_id: p.id, name: p.name, description: p.description || '', category: p.category,
    billing_type: p.billing_type, qty: 1, unit_price: p.default_price, discount: 0, tax_rate: 0,
  }]);

  const totals = useMemo(() => {
    let oneOff = 0, tax = 0, saasArr = 0, paymentsArr = 0;
    items.forEach(it => {
      const lt = lineTotal(it);
      if (it.category === 'saas') saasArr += it.billing_type === 'monthly' ? lt * 12 : lt;
      else if (it.category === 'payments') paymentsArr += lt;
      else if (it.billing_type === 'one_off') { oneOff += lt; tax += lt * (Number(it.tax_rate) || 0) / 100; }
    });
    return { oneOff, tax, oneOffTotal: oneOff + tax, saasArr, paymentsArr, recurringArr: saasArr + paymentsArr };
  }, [items]);

  const save = async () => {
    setSaving(true); setSaved(false);
    // Persist quote fields + totals
    await supabase.from('quotes').update({
      valid_until: quote.valid_until || null, go_live_date: quote.go_live_date || null,
      payment_terms: quote.payment_terms, deposit_percent: Number(quote.deposit_percent) || 0,
      tax_rate: Number(quote.tax_rate) || 0, terms: quote.terms || null, notes: quote.notes || null,
      status: quote.status, location_id: quote.location_id || null,
      one_off_subtotal: totals.oneOff, tax_amount: totals.tax, one_off_total: totals.oneOffTotal,
      recurring_arr: totals.recurringArr,
    }).eq('id', quoteId);
    // Replace line items
    await supabase.from('quote_line_items').delete().eq('quote_id', quoteId);
    if (items.length) {
      await supabase.from('quote_line_items').insert(items.map((it, i) => ({
        quote_id: quoteId, product_id: it.product_id || null, name: it.name || 'Item',
        description: it.description || null, category: it.category, billing_type: it.billing_type,
        qty: Number(it.qty) || 0, unit_price: Number(it.unit_price) || 0, discount: Number(it.discount) || 0,
        tax_rate: Number(it.tax_rate) || 0, line_total: lineTotal(it), sort: i,
      })));
    }
    setSaving(false); setSaved(true); setTimeout(() => setSaved(false), 2500);
    load();
  };

  // Mark the quote won -> close the deal -> auto onboarding (interim manual path until Stripe phase)
  const markWon = async () => {
    if (!confirm('Mark this quote as Won? This closes the deal and starts onboarding.')) return;
    await save();
    await supabase.from('quotes').update({ status: 'won' }).eq('id', quoteId);
    if (quote.deal_id) {
      await supabase.from('deals').update({ stage: 'closed_won', closed_at: new Date().toISOString() }).eq('id', quote.deal_id);
      await supabase.from('stage_history').insert({ object_type: 'deal', object_id: quote.deal_id, to_stage: 'closed_won', changed_by: profile.id });
      try { await handleClosedWon(quote.deal_id, profile.id); } catch (e) { console.error(e); }
    }
    load();
  };

  const publicUrl = quote ? `${window.location.origin}/q/${quote.public_token}` : '';
  const copyLink = () => { navigator.clipboard.writeText(publicUrl); alert('Quote link copied'); };

  if (!quote) return <div className="h-full flex items-center justify-center text-dim text-sm">Loading...</div>;

  const input = "w-full px-3 py-2 bg-card border border-bdr rounded-xl text-sm text-paper placeholder-dim focus:outline-none focus:border-ember";
  const label = "text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-dim mb-1 block";
  const cell = "px-2 py-1.5 bg-card border border-bdr rounded-lg text-sm text-paper focus:outline-none focus:border-ember";

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-6 py-4 border-b border-bdr flex items-center gap-3 flex-wrap">
        <button onClick={onClose} className="text-muted hover:text-paper text-lg">&larr;</button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <div className="text-xl font-bold text-paper">Quote #{quote.quote_number}</div>
            <span className={`px-2 py-0.5 text-[10px] font-bold uppercase rounded ${STATUS_STYLES[quote.status]}`}>{quote.status}</span>
          </div>
          <div className="text-xs text-muted mt-0.5">
            {location?.name || 'No location'}{contact ? ` · ${[contact.first_name, contact.last_name].filter(Boolean).join(' ')}` : ''}
          </div>
        </div>
        {canWrite && (
          <div className="flex items-center gap-2">
            {saved && <span className="text-sm text-emerald-600 font-medium">✓ Saved</span>}
            <button onClick={save} disabled={saving} className="btn-glass px-5 py-2 rounded-xl text-sm font-semibold disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button>
            {quote.status !== 'won' && <button onClick={markWon} className="px-4 py-2 text-sm font-semibold rounded-xl bg-emerald-100 text-emerald-700 border border-emerald-200 hover:bg-emerald-200">Mark Won</button>}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="grid grid-cols-12 gap-4 max-w-[1200px]">
          {/* Line items */}
          <div className="col-span-8 space-y-4">
            <div className="glass-card rounded-2xl overflow-hidden">
              <div className="px-4 py-3 border-b border-bdr flex items-center gap-2">
                <h3 className="text-sm font-bold text-paper">Line items</h3>
                {canWrite && (
                  <div className="ml-auto flex items-center gap-2">
                    <select className={cell + ' text-xs'} value="" onChange={e => { const p = products.find(x => x.id === e.target.value); if (p) addProduct(p); e.target.value = ''; }}>
                      <option value="">+ Add product…</option>
                      {products.map(p => <option key={p.id} value={p.id}>{CAT_LABEL[p.category]}: {p.name} ({money(p.default_price)})</option>)}
                    </select>
                    <button onClick={addCustom} className="text-xs text-ember hover:text-ember-deep font-medium">+ Custom</button>
                  </div>
                )}
              </div>
              <div className="p-3 space-y-2">
                {items.length === 0 && <div className="text-xs text-dim italic py-4 text-center">No line items yet. Add products from your catalogue.</div>}
                {items.map((it, idx) => (
                  <div key={idx} className="glass-inner rounded-xl p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <input className={cell + ' flex-1'} value={it.name} onChange={e => updateItem(idx, { name: e.target.value })} placeholder="Item name" />
                      <button onClick={() => removeItem(idx)} className="text-red-500 hover:text-red-600 text-sm shrink-0">×</button>
                    </div>
                    <input className={cell + ' w-full text-xs'} value={it.description || ''} onChange={e => updateItem(idx, { description: e.target.value })} placeholder="Description (shown on the quote)" />
                    <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                      <div><span className="text-[9px] text-dim block">Category</span>
                        <select className={cell + ' w-full text-xs'} value={it.category} onChange={e => updateItem(idx, { category: e.target.value })}>
                          {Object.entries(CAT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
                      <div><span className="text-[9px] text-dim block">Billing</span>
                        <select className={cell + ' w-full text-xs'} value={it.billing_type} onChange={e => updateItem(idx, { billing_type: e.target.value })}>
                          <option value="one_off">One-off</option><option value="monthly">Monthly</option><option value="annual">Annual</option><option value="usage">Usage</option></select></div>
                      <div><span className="text-[9px] text-dim block">Qty</span><input type="number" className={cell + ' w-full'} value={it.qty} onChange={e => updateItem(idx, { qty: e.target.value })} /></div>
                      <div><span className="text-[9px] text-dim block">Unit £</span><input type="number" className={cell + ' w-full'} value={it.unit_price} onChange={e => updateItem(idx, { unit_price: e.target.value })} /></div>
                      <div><span className="text-[9px] text-dim block">Disc %</span><input type="number" className={cell + ' w-full'} value={it.discount} onChange={e => updateItem(idx, { discount: e.target.value })} /></div>
                      <div><span className="text-[9px] text-dim block">Sales Tax %</span><input type="number" className={cell + ' w-full'} value={it.tax_rate ?? 0} onChange={e => updateItem(idx, { tax_rate: e.target.value })} disabled={it.category === 'saas' || it.category === 'payments'} /></div>
                    </div>
                    <div className="text-right text-xs text-muted">Line total: <span className="text-paper font-mono font-semibold">{money(lineTotal(it))}</span>{it.billing_type === 'monthly' ? '/mo' : it.category === 'payments' ? '/yr' : ''}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="glass-card rounded-2xl p-4 space-y-2">
              <div className="text-sm font-bold text-paper mb-1">Terms &amp; notes</div>
              <textarea className={input + ' resize-none'} rows={2} value={quote.terms || ''} onChange={e => setQ('terms', e.target.value)} placeholder="Terms & conditions shown on the quote" />
              <textarea className={input + ' resize-none'} rows={2} value={quote.notes || ''} onChange={e => setQ('notes', e.target.value)} placeholder="Internal notes (not shown to customer)" />
            </div>
          </div>

          {/* Sidebar: totals + settings */}
          <div className="col-span-4 space-y-4">
            <div className="glass-card rounded-2xl p-4">
              <div className="text-sm font-bold text-paper mb-3">Totals</div>
              <Row k="One-off subtotal" v={money(totals.oneOff)} />
              <Row k="Sales Tax" v={money(totals.tax)} />
              <Row k="One-off total" v={money(totals.oneOffTotal)} bold />
              <div className="border-t border-bdr my-2" />
              <Row k="SaaS (ARR)" v={money(totals.saasArr)} sub />
              <Row k="Payments (ARR)" v={money(totals.paymentsArr)} sub />
              <Row k="Recurring ARR" v={money(totals.recurringArr)} bold />
              <div className="text-[10px] text-dim mt-2 leading-relaxed">SaaS &amp; payments are the plan the customer agrees to (forecast ARR on the deal) — not charged here. One-off total is what Stripe captures.</div>
            </div>

            <div className="glass-card rounded-2xl p-4 space-y-3">
              <div className="text-sm font-bold text-paper">Settings</div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={label}>Status</label><select className={input} value={quote.status} onChange={e => setQ('status', e.target.value)}>
                  {['draft','sent','viewed','signed','paid','won','declined','expired','void'].map(s => <option key={s} value={s}>{s}</option>)}</select></div>
                <div className="col-span-2"><label className={label}>Location (install site)</label>
                  <select className={input} value={quote.location_id || ''} onChange={e => setQ('location_id', e.target.value || null)}>
                    <option value="">— None —</option>
                    {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select></div>
                <div><label className={label}>Valid until</label><input type="date" className={input} value={quote.valid_until || ''} onChange={e => setQ('valid_until', e.target.value)} /></div>
                <div><label className={label}>Go-live date</label><input type="date" className={input} value={quote.go_live_date || ''} onChange={e => setQ('go_live_date', e.target.value)} /></div>
                <div><label className={label}>Payment terms</label><select className={input} value={quote.payment_terms} onChange={e => setQ('payment_terms', e.target.value)}>
                  <option value="pay_now">Charge full now</option><option value="deposit">Deposit</option><option value="invoice_later">Invoice later</option></select></div>
                {quote.payment_terms === 'deposit' && <div><label className={label}>Deposit %</label><input type="number" className={input} value={quote.deposit_percent || 0} onChange={e => setQ('deposit_percent', e.target.value)} /></div>}
              </div>
            </div>

            <div className="glass-card rounded-2xl p-4">
              <div className="text-sm font-bold text-paper mb-2">Customer link</div>
              <div className="flex gap-2">
                <input readOnly value={publicUrl} className={input + ' font-mono text-[10px]'} onFocus={e => e.target.select()} />
                <button onClick={copyLink} className="px-2 py-1 text-xs btn-ghost rounded-xl shrink-0">Copy</button>
              </div>
              <div className="text-[10px] text-dim mt-1">The sign &amp; pay page activates with the Stripe phase.</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ k, v, bold, sub }) {
  return (
    <div className="flex justify-between py-1 text-sm">
      <span className={sub ? 'text-muted text-xs' : 'text-muted'}>{k}</span>
      <span className={`font-mono ${bold ? 'text-paper font-bold' : sub ? 'text-muted text-xs' : 'text-paper'}`}>{v}</span>
    </div>
  );
}
