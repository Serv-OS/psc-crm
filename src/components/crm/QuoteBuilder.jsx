import { useEffect, useState, useMemo } from 'react';
import { supabase } from '../../lib/supabase';
import { handleClosedWon } from '../../lib/dealHelpers';
import { buildEngineConfig, computeQuote, buildEstimateRecord } from '../../lib/quoteEngine';

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

const money = (v) => `$${Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const SITE_WORKS_LABEL = 'Site preparation, materials, permits & debris removal';

export default function QuoteBuilder({ quoteId, profile, onClose, onNavigate }) {
  const [quote, setQuote] = useState(null);
  const [location, setLocation] = useState(null);
  const [contact, setContact] = useState(null);
  const [locations, setLocations] = useState([]);
  const [cfg, setCfg] = useState(null); // engine config built from the catalogue
  const [saving, setSaving] = useState(false);
  const [loadingTerms, setLoadingTerms] = useState(false);
  const [saved, setSaved] = useState(false);

  // Estimator inputs
  const [totalSqft, setTotalSqft] = useState('');
  const [numStories, setNumStories] = useState('');
  const [demoType, setDemoType] = useState('');
  const [markup, setMarkup] = useState('');
  const [qty, setQty] = useState({}); // { [productId]: value }
  const [customItems, setCustomItems] = useState([]); // [{ key, name, unit, cost, installRate, qty }]
  const [stages, setStages] = useState([]); // payment schedule: [{ key, id?, name, basis, value, is_deposit, status?, invoice? }]

  const canWrite = profile.role === 'owner' || profile.role === 'editor';

  useEffect(() => { load(); }, [quoteId]);

  const load = async () => {
    const [q, conf, prods, mats, demos] = await Promise.all([
      supabase.from('quotes').select('*').eq('id', quoteId).single(),
      supabase.from('quote_config').select('*').eq('id', 1).maybeSingle(),
      supabase.from('quote_config_products').select('*').eq('active', true).order('sort'),
      supabase.from('quote_config_install_materials').select('*').eq('active', true).order('sort'),
      supabase.from('quote_config_demo_rates').select('*').eq('active', true).order('sort'),
    ]);
    setQuote(q.data);
    const engineCfg = buildEngineConfig({
      config: conf.data || {}, products: prods.data || [],
      installMaterials: mats.data || [], demoRates: demos.data || [],
    });
    setCfg(engineCfg);

    supabase.from('locations').select('id, name, city').order('name').limit(200).then(r => setLocations(r.data || []));
    if (q.data?.location_id) supabase.from('locations').select('id, name, city').eq('id', q.data.location_id).single().then(r => setLocation(r.data));
    else setLocation(null);
    if (q.data?.contact_id) supabase.from('contacts').select('id, first_name, last_name, email').eq('id', q.data.contact_id).single().then(r => setContact(r.data));

    // Restore any saved estimate inputs for this quote
    const { data: est } = await supabase.from('quote_estimates').select('*').eq('quote_id', quoteId).order('created_at', { ascending: false }).limit(1).maybeSingle();
    const inp = est?.inputs || {};
    setTotalSqft(inp.totalSqft != null ? String(inp.totalSqft) : (est?.total_sqft ? String(est.total_sqft) : ''));
    setNumStories(inp.numStories != null ? String(inp.numStories) : (est?.num_stories ? String(est.num_stories) : ''));
    setDemoType(inp.demoType ?? est?.demo_type ?? '');
    setMarkup(inp.markup != null ? String(inp.markup) : (est?.markup ? String(est.markup) : String(engineCfg.markupDefault)));
    // Battens auto-derive when their qty is empty (one every 12 inches of
    // panel). A quote that has already gone to the customer must NOT reprice
    // itself just because it was reopened: on non-draft quotes, a batten row
    // the engine would NEWLY derive (empty qty, and the saved breakdown never
    // priced that batten) gets an explicit 0, freezing the agreed total.
    // Quotes whose saved breakdown already carried the batten line stay on
    // auto — re-deriving reproduces the same number. Clearing the 0 is the
    // deliberate way to reprice an old quote under the rule.
    const restoredQty = { ...(inp.qty || {}) };
    if (est && q.data && q.data.status !== 'draft') {
      const savedLines = est.breakdown?.products || [];
      for (const p of engineCfg.products) {
        if (p.type !== 'batten') continue;
        const v = restoredQty[p.id];
        const isEmpty = v === undefined || v === null || String(v).trim() === '';
        const wasPriced = savedLines.some(r => r.id === p.id && r.qty > 0);
        if (isEmpty && !wasPriced) restoredQty[p.id] = '0';
      }
    }
    setQty(restoredQty);
    setCustomItems((inp.customItems || []).map((c, i) => ({ key: `c${i}`, name: c.name || '', unit: c.unit || '', cost: c.cost ?? '', installRate: c.installRate ?? '', qty: c.qty ?? '' })));

    // Payment schedule (staged billing) + each stage's invoice/charge status
    const { data: st } = await supabase.from('payment_stages').select('*').eq('quote_id', quoteId).order('sort');
    const { data: invs } = await supabase.from('invoices').select('id, invoice_number, status, total, public_token, stage_id').eq('quote_id', quoteId);
    setStages((st || []).map((s, i) => ({
      key: s.id, id: s.id, name: s.name, basis: s.basis,
      value: s.basis === 'percent' ? String(s.percent ?? '') : String(s.amount ?? ''),
      is_deposit: s.is_deposit, status: s.status,
      invoice: (invs || []).find(iv => iv.stage_id === s.id) || null,
    })));
  };

  const setQ = (k, v) => setQuote(prev => ({ ...prev, [k]: v }));

  // Pull the standard terms in rather than making anyone paste a contract.
  const loadStandardTerms = async () => {
    if (quote.terms && !confirm('Replace the terms on this quote with the standard terms?')) return;
    setLoadingTerms(true);
    const { data, error } = await supabase.from('quote_config').select('default_terms').eq('id', 1).maybeSingle();
    setLoadingTerms(false);
    if (error || !data?.default_terms) { alert('No standard terms are saved yet.'); return; }
    setQ('terms', data.default_terms);
  };

  const result = useMemo(() => {
    if (!cfg) return null;
    return computeQuote(cfg, { totalSqft, numStories, demoType, markup, qty, customItems });
  }, [cfg, totalSqft, numStories, demoType, markup, qty, customItems]);

  const termsWords = (quote?.terms || '').trim() ? (quote.terms.trim().split(/\s+/).length) : 0;
  const taxRate = Number(quote?.tax_rate) || 0;
  const salePrice = result?.salePrice || 0;
  const taxAmount = salePrice * taxRate / 100;
  const customerTotal = salePrice + taxAmount;

  const addCustom = () => setCustomItems([...customItems, { key: `c${Date.now()}`, name: '', unit: '', cost: '', installRate: '', qty: '' }]);
  const updateCustom = (key, patch) => setCustomItems(customItems.map(c => c.key === key ? { ...c, ...patch } : c));
  const removeCustom = (key) => setCustomItems(customItems.filter(c => c.key !== key));

  // ── Payment schedule (staged billing) ──
  const stageAmount = (s) => s.basis === 'percent' ? customerTotal * (Number(s.value) || 0) / 100 : (Number(s.value) || 0);
  const stagesTotal = stages.reduce((a, s) => a + stageAmount(s), 0);
  const stagesRemainder = customerTotal - stagesTotal;
  const stagesReconciled = stages.length > 0 && Math.abs(stagesRemainder) < 0.01;
  const stagesLocked = stages.some(s => s.status && s.status !== 'pending'); // a stage already invoiced/charged → don't let edits desync money
  const addStage = (preset) => setStages([...stages, {
    key: `s${Date.now()}`, name: preset?.name || (stages.length === 0 ? 'Deposit' : `Stage ${stages.length + 1}`),
    basis: preset?.basis || 'percent', value: preset?.value ?? '', is_deposit: stages.length === 0, status: 'pending', invoice: null,
  }]);
  const seedSchedule = () => setStages([
    { key: `s${Date.now()}`, name: 'Deposit', basis: 'percent', value: '40', is_deposit: true, status: 'pending', invoice: null },
    { key: `s${Date.now() + 1}`, name: 'Mid-project', basis: 'percent', value: '30', is_deposit: false, status: 'pending', invoice: null },
    { key: `s${Date.now() + 2}`, name: 'On completion', basis: 'percent', value: '30', is_deposit: false, status: 'pending', invoice: null },
  ]);
  const updateStage = (key, patch) => setStages(stages.map(s => s.key === key ? { ...s, ...patch } : s));
  const removeStage = (key) => setStages(stages.filter(s => s.key !== key).map((s, i) => ({ ...s, is_deposit: i === 0 })));

  // Build the customer-facing line items (no costs — price = cost × markup, sums exactly to sale price)
  const buildCustomerLines = (res) => {
    const mk = res.markup;
    const lines = [];
    let sort = 0;
    res.productRows.filter(r => r.qty > 0).forEach(r => {
      const lineCustomer = r.lineTotal * mk;
      lines.push({
        // product_id stays null — the estimator catalogue lives in quote_config_products,
        // not the legacy `products` table that quote_line_items.product_id FKs to. The real
        // catalogue id is preserved in the internal estimate breakdown instead.
        product_id: null, name: r.name,
        description: r.unit ? `${r.qty} ${r.unit}` : null,
        category: 'services', billing_type: 'one_off',
        qty: r.qty, unit_price: r.qty ? lineCustomer / r.qty : lineCustomer,
        discount: 0, tax_rate: taxRate, line_total: lineCustomer, sort: sort++,
      });
    });
    res.customRows.forEach(r => {
      const lineCustomer = r.lineTotal * mk;
      lines.push({
        product_id: null, name: r.name,
        description: r.unit ? `${r.qty} ${r.unit}` : null,
        category: 'services', billing_type: 'one_off',
        qty: r.qty, unit_price: r.qty ? lineCustomer / r.qty : lineCustomer,
        discount: 0, tax_rate: taxRate, line_total: lineCustomer, sort: sort++,
      });
    });
    const siteWorks = (res.installSum + res.demoCost + res.permitsCost + res.debrisCost) * mk;
    if (siteWorks > 0) {
      lines.push({
        product_id: null, name: SITE_WORKS_LABEL,
        description: 'Underlayment & install materials, building permits, demolition and debris removal',
        category: 'services', billing_type: 'one_off',
        qty: 1, unit_price: siteWorks, discount: 0, tax_rate: taxRate, line_total: siteWorks, sort: sort++,
      });
    }
    return lines;
  };

  const save = async () => {
    if (!result) return;
    // Staged quotes must be fully configured before they can be saved (and thus
    // sent/signed) — no under/over-collection, and never an empty schedule.
    if (quote.payment_terms === 'staged' && !stagesLocked) {
      if (!stages.length) { alert('Add a payment schedule (a deposit + milestones), or change the payment terms.'); return; }
      if (!stagesReconciled) { alert(`The payment stages must total the customer price of ${money(customerTotal)} before saving.`); return; }
    }
    setSaving(true); setSaved(false);
    const now = new Date().toISOString();

    // 1) Quote header + totals (authoritative from the engine)
    await supabase.from('quotes').update({
      valid_until: quote.valid_until || null, go_live_date: quote.go_live_date || null,
      payment_terms: quote.payment_terms, deposit_percent: Number(quote.deposit_percent) || 0,
      tax_rate: taxRate, terms: quote.terms || null, notes: quote.notes || null,
      status: quote.status, location_id: quote.location_id || null,
      one_off_subtotal: salePrice, tax_amount: taxAmount, one_off_total: customerTotal,
      recurring_arr: 0, updated_at: now,
    }).eq('id', quoteId);

    // Keep the linked deal's contract value in lock-step with the quote total
    // so the deal/pipeline/revenue always show the same number as the quote.
    if (quote.deal_id) {
      await supabase.from('deals').update({ value: customerTotal, currency: 'USD' }).eq('id', quote.deal_id);
    }

    // 2) Customer-facing line items (replace) — never carry cost/margin
    await supabase.from('quote_line_items').delete().eq('quote_id', quoteId);
    const lines = buildCustomerLines(result);
    if (lines.length) {
      await supabase.from('quote_line_items').insert(lines.map(l => ({ ...l, quote_id: quoteId })));
    }

    // 3) Internal estimate record (full cost breakdown — for us & the installer)
    await supabase.from('quote_estimates').delete().eq('quote_id', quoteId);
    await supabase.from('quote_estimates').insert({
      quote_id: quoteId,
      total_sqft: result.totalSqft, num_stories: result.numStories,
      demo_type: result.demoType || null, markup: result.markup,
      inputs: { totalSqft: result.totalSqft, numStories: result.numStories, demoType: result.demoType, markup: result.markup, qty, customItems: customItems.map(c => ({ name: c.name, unit: c.unit, cost: Number(c.cost) || 0, installRate: Number(c.installRate) || 0, qty: Number(c.qty) || 0 })) },
      siding_material: result.sidingMaterialSum, siding_install: result.sidingInstallSum, install_mat_sum: result.installSum,
      demo_cost: result.demoCost, permits_cost: result.permitsCost, debris_cost: result.debrisCost,
      total_cost: result.totalCost, sale_price: result.salePrice, profit: result.profit, margin: result.margin,
      breakdown: buildEstimateRecord(result, cfg), updated_at: now,
    });

    // 4) Payment schedule (staged billing). Locked once any stage is invoiced/charged
    // so edits can never desync money already in flight. Re-check the lock against
    // FRESH DB state to avoid wiping a schedule signed in another tab/session.
    if (!stagesLocked) {
      const { data: freshStages } = await supabase.from('payment_stages').select('status').eq('quote_id', quoteId);
      const freshLocked = (freshStages || []).some(s => s.status && s.status !== 'pending');
      if (!freshLocked) {
        await supabase.from('payment_stages').delete().eq('quote_id', quoteId);
        if (quote.payment_terms === 'staged' && stages.length) {
          // Integer-cent allocation: percent stages round to cents, the LAST stage
          // absorbs the remainder so the stages always sum to the customer total exactly.
          const totalCents = Math.round(customerTotal * 100);
          let allocated = 0;
          const rows = stages.map((s, i) => {
            let cents;
            if (i === stages.length - 1) cents = totalCents - allocated;
            else {
              cents = s.basis === 'percent' ? Math.round(totalCents * (Number(s.value) || 0) / 100) : Math.round((Number(s.value) || 0) * 100);
              allocated += cents;
            }
            return {
              quote_id: quoteId, name: s.name || `Stage ${i + 1}`, sort: i, basis: s.basis,
              percent: s.basis === 'percent' ? (Number(s.value) || 0) : 0,
              amount: cents / 100, is_deposit: i === 0, status: 'pending',
            };
          });
          await supabase.from('payment_stages').insert(rows);
        }
      }
    }

    setSaving(false); setSaved(true); setTimeout(() => setSaved(false), 2500);
    load();
  };

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

  // Delete the quote. Cascades remove its line items, estimate and payment
  // schedule; any invoices already raised are kept (their quote link is cleared).
  const deleteQuote = async () => {
    const { count } = await supabase.from('invoices').select('id', { count: 'exact', head: true }).eq('quote_id', quoteId);
    const warn = count ? `\n\n${count} invoice(s) were raised from this quote — they will be kept but unlinked.` : '';
    if (!confirm(`Delete Quote #${quote.quote_number}? This removes the estimate, line items and payment schedule.${warn}\n\nThis cannot be undone.`)) return;
    const { error } = await supabase.from('quotes').delete().eq('id', quoteId);
    if (error) { alert('Could not delete: ' + error.message); return; }
    onClose();
  };

  const publicUrl = quote ? `${window.location.origin}/q/${quote.public_token}` : '';
  const copyLink = () => { navigator.clipboard.writeText(publicUrl); alert('Quote link copied'); };

  if (!quote || !cfg || !result) return <div className="h-full flex items-center justify-center text-dim text-sm">Loading…</div>;

  const input = "w-full px-3 py-2 bg-card border border-bdr rounded-xl text-sm text-paper placeholder-dim focus:outline-none focus:border-ember";
  const label = "text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-dim mb-1 block";
  const cell = "px-2 py-1.5 bg-card border border-bdr rounded-lg text-sm text-paper focus:outline-none focus:border-ember";
  const ro = (v) => <span className="font-mono text-paper">{money(v)}</span>;

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
            {profile.role === 'owner' && <button onClick={deleteQuote} title="Delete quote" className="px-3 py-2 text-sm font-semibold rounded-xl text-red-600 border border-red-200 hover:bg-red-50">Delete</button>}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="grid grid-cols-12 gap-4 max-w-[1280px]">
          {/* Left: estimator inputs */}
          <div className="col-span-12 lg:col-span-8 space-y-4">
            {/* Payment schedule (staged billing) — top of the column so it's easy to find */}
            {quote.payment_terms === 'staged' && (
              <div className="glass-card rounded-2xl overflow-hidden border-l-2 border-ember">
                <div className="px-4 py-3 border-b border-bdr flex items-center gap-2">
                  <h3 className="text-sm font-bold text-paper">Payment schedule</h3>
                  <span className="text-[10px] text-dim">Deposit + milestones — charged manually as the build progresses</span>
                  {canWrite && !stagesLocked && stages.length > 0 && <button onClick={() => addStage()} className="ml-auto text-xs text-ember hover:text-ember-deep font-medium">+ Add stage</button>}
                </div>
                {stages.length === 0 ? (
                  <div className="p-5 text-center">
                    <div className="text-xs text-dim mb-2">No stages yet — split the {money(customerTotal)} into a deposit + milestones.</div>
                    {canWrite && <div className="flex gap-2 justify-center"><button onClick={seedSchedule} className="text-xs btn-glass px-3 py-1.5 rounded-lg font-medium">Deposit + 2 stages (40 / 30 / 30)</button><button onClick={() => addStage()} className="text-xs btn-ghost px-3 py-1.5 rounded-lg">+ Add one stage</button></div>}
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead><tr className="text-[10px] uppercase tracking-wider text-dim border-b border-bdr">
                        <th className="text-left px-3 py-2">Stage</th><th className="px-2 py-2 w-16">Basis</th>
                        <th className="text-right px-2 py-2 w-20">Value</th><th className="text-right px-3 py-2">Amount</th>
                        <th className="px-2 py-2 w-24">Status</th><th className="w-8"></th>
                      </tr></thead>
                      <tbody>
                        {stages.map((s, i) => (
                          <tr key={s.key} className="border-b border-bdr/50 align-top">
                            <td className="px-3 py-2">
                              <input className={cell + ' w-full'} value={s.name} onChange={e => updateStage(s.key, { name: e.target.value })} disabled={!canWrite || stagesLocked} placeholder="Stage name" />
                              {i === 0 && <span className="block text-[9px] text-ember font-bold uppercase mt-0.5">Deposit · charged at signing</span>}
                            </td>
                            <td className="px-2 py-2"><select className={cell + ' w-14'} value={s.basis} onChange={e => updateStage(s.key, { basis: e.target.value })} disabled={!canWrite || stagesLocked}><option value="percent">%</option><option value="fixed">$</option></select></td>
                            <td className="px-2 py-2 text-right"><input type="number" className={cell + ' w-16 text-right'} value={s.value} onChange={e => updateStage(s.key, { value: e.target.value })} disabled={!canWrite || stagesLocked} placeholder="0" /></td>
                            <td className="px-3 py-2 text-right font-mono text-paper">{money(stageAmount(s))}</td>
                            <td className="px-2 py-2">
                              {s.status && s.status !== 'pending'
                                ? <span className={`text-[10px] font-bold uppercase ${s.status === 'paid' ? 'text-emerald-600' : s.status === 'failed' ? 'text-red-600' : 'text-blue-600'}`}>{s.status}</span>
                                : <span className="text-[10px] text-dim">pending</span>}
                              {s.invoice && <span className="block text-[9px] text-dim">INV-{s.invoice.invoice_number}</span>}
                            </td>
                            <td className="px-2 py-2 text-center">{canWrite && !stagesLocked && <button onClick={() => removeStage(s.key)} className="text-red-500 hover:text-red-600">×</button>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {stages.length > 0 && (
                  <div className={`px-4 py-3 border-t border-bdr flex items-center justify-between text-xs ${stagesReconciled ? 'text-emerald-600' : 'text-amber-600'}`}>
                    <span>{stagesReconciled ? '✓ Stages total the customer price' : (stagesRemainder >= 0 ? `${money(stagesRemainder)} still unallocated` : `${money(-stagesRemainder)} over the total`)}</span>
                    <span className="font-mono">{money(stagesTotal)} / {money(customerTotal)}</span>
                  </div>
                )}
                {stagesLocked && <div className="px-4 py-2 text-[10px] text-dim border-t border-bdr">Schedule locked — a stage has been invoiced or charged, so amounts can't change.</div>}
              </div>
            )}
            {/* Project details */}
            <div className="glass-card rounded-2xl p-4">
              <div className="text-sm font-bold text-paper mb-3">Project details</div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div><label className={label}>Total sq ft</label><input type="number" min="0" className={input} value={totalSqft} onChange={e => setTotalSqft(e.target.value)} placeholder="0" disabled={!canWrite} /></div>
                <div><label className={label}>Stories</label>
                  <select className={input} value={numStories} onChange={e => setNumStories(e.target.value)} disabled={!canWrite}>
                    <option value="">—</option>{[1, 2, 3, 4].map(n => <option key={n} value={n}>{n}</option>)}
                  </select></div>
                <div><label className={label}>Demo required</label>
                  <select className={input} value={demoType} onChange={e => setDemoType(e.target.value)} disabled={!canWrite}>
                    <option value="">None</option>
                    {cfg.demoRates.map(d => <option key={d.id} value={d.label}>{d.label}</option>)}
                  </select></div>
                <div><label className={label}>Markup ×</label><input type="number" min="1" step="0.05" className={input} value={markup} onChange={e => setMarkup(e.target.value)} placeholder={String(cfg.markupDefault)} disabled={!canWrite} /></div>
              </div>
            </div>

            {/* Siding products */}
            <div className="glass-card rounded-2xl overflow-hidden">
              <div className="px-4 py-3 border-b border-bdr flex items-center gap-2">
                <h3 className="text-sm font-bold text-paper">Siding products</h3>
                <span className="text-[10px] text-dim">Enter quantities — prices come from the pricing catalogue</span>
                {canWrite && <button onClick={addCustom} className="ml-auto text-xs text-ember hover:text-ember-deep font-medium">+ Custom line</button>}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-[10px] uppercase tracking-wider text-dim border-b border-bdr">
                    <th className="text-left px-3 py-2 font-semibold">Product</th>
                    <th className="text-right px-2 py-2 font-semibold">Unit cost</th>
                    <th className="text-right px-2 py-2 font-semibold">Install/unit</th>
                    <th className="text-right px-2 py-2 font-semibold w-24">Qty</th>
                    <th className="text-right px-3 py-2 font-semibold">Line cost</th>
                  </tr></thead>
                  <tbody>
                    {cfg.products.map(p => {
                      const row = result.productRows.find(r => r.id === p.id) || { material: 0, install: 0, lineTotal: 0 };
                      const autoRow = row.auto && row.qty > 0; // battens derived by the engine: 1 per 12" of panel
                      return (
                        <tr key={p.id} className="border-b border-bdr/50">
                          <td className="px-3 py-2"><div className="text-paper">{p.name}</div><div className="text-[10px] text-dim">{p.unit}</div>
                            {autoRow && <div className="text-[10px] text-ember font-semibold">auto: {row.qty} battens — 1 per 12&quot; of panel. Type a qty to override.</div>}</td>
                          <td className="px-2 py-2 text-right font-mono text-muted">{money(p.cost)}</td>
                          <td className="px-2 py-2 text-right font-mono text-muted">{p.installRate ? money(p.installRate) : '—'}</td>
                          <td className="px-2 py-2 text-right"><input type="number" min="0" className={cell + ' w-20 text-right'} value={qty[p.id] ?? ''} onChange={e => setQty({ ...qty, [p.id]: e.target.value })} disabled={!canWrite} placeholder={autoRow ? String(row.qty) : '0'} /></td>
                          <td className="px-3 py-2 text-right font-mono text-paper">{row.qty > 0 ? money(row.lineTotal) : '—'}</td>
                        </tr>
                      );
                    })}
                    {customItems.map(c => {
                      const cost = Number(c.cost) || 0, ins = Number(c.installRate) || 0, q = Number(c.qty) || 0;
                      return (
                        <tr key={c.key} className="border-b border-bdr/50 bg-card/40">
                          <td className="px-3 py-2"><input className={cell + ' w-full'} value={c.name} onChange={e => updateCustom(c.key, { name: e.target.value })} placeholder="Custom item" disabled={!canWrite} />
                            <input className={cell + ' w-full mt-1 text-xs'} value={c.unit} onChange={e => updateCustom(c.key, { unit: e.target.value })} placeholder="Unit (e.g. SQFT)" disabled={!canWrite} /></td>
                          <td className="px-2 py-2 text-right"><input type="number" className={cell + ' w-20 text-right'} value={c.cost} onChange={e => updateCustom(c.key, { cost: e.target.value })} placeholder="0" disabled={!canWrite} /></td>
                          <td className="px-2 py-2 text-right"><input type="number" className={cell + ' w-20 text-right'} value={c.installRate} onChange={e => updateCustom(c.key, { installRate: e.target.value })} placeholder="0" disabled={!canWrite} /></td>
                          <td className="px-2 py-2 text-right"><input type="number" className={cell + ' w-20 text-right'} value={c.qty} onChange={e => updateCustom(c.key, { qty: e.target.value })} placeholder="0" disabled={!canWrite} /></td>
                          <td className="px-3 py-2 text-right font-mono text-paper">{q > 0 ? money((cost + ins) * q) : '—'}<button onClick={() => removeCustom(c.key)} className="ml-2 text-red-500 hover:text-red-600">×</button></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Install materials (auto) */}
            <div className="glass-card rounded-2xl overflow-hidden">
              <div className="px-4 py-3 border-b border-bdr flex items-center gap-2">
                <h3 className="text-sm font-bold text-paper">Install materials</h3>
                <span className="text-[10px] text-dim">Auto-calculated from sq ft × stories</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <tbody>
                    {result.installMatRows.map(m => (
                      <tr key={m.id} className="border-b border-bdr/50">
                        <td className="px-3 py-2 text-paper">{m.name}</td>
                        <td className="px-2 py-2 text-right font-mono text-muted">{money(m.cost)}</td>
                        <td className="px-2 py-2 text-right text-muted">{m.qty} units</td>
                        <td className="px-3 py-2 text-right font-mono text-paper">{m.qty > 0 ? money(m.lineTotal) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Terms & notes. The terms are a full contract, not a sentence:
                a 2-row box with resizing disabled made them impossible to read
                or paste into, which is why they were empty on every quote. */}
            <div className="glass-card rounded-2xl p-4 space-y-2">
              <div className="flex items-center gap-2 mb-1">
                <div className="text-sm font-bold text-paper">Terms &amp; conditions</div>
                <span className="text-[10px] text-dim">{termsWords} words · shown to the customer</span>
                {canWrite && (
                  <button onClick={loadStandardTerms} disabled={loadingTerms}
                    className="ml-auto text-xs text-ember hover:text-ember-deep font-medium disabled:opacity-50">
                    {loadingTerms ? 'Loading…' : quote.terms ? 'Reset to standard terms' : 'Use standard terms'}
                  </button>
                )}
              </div>
              <textarea className={input + ' resize-y font-mono text-[11px] leading-relaxed'} rows={16}
                value={quote.terms || ''} onChange={e => setQ('terms', e.target.value)}
                placeholder="Terms & conditions shown on the quote" disabled={!canWrite} />

              <div className="text-sm font-bold text-paper pt-2">Internal notes</div>
              <textarea className={input + ' resize-y'} rows={3} value={quote.notes || ''} onChange={e => setQ('notes', e.target.value)}
                placeholder="Internal notes (not shown to customer)" disabled={!canWrite} />
            </div>

          </div>

          {/* Right: internal breakdown + customer total + settings */}
          <div className="col-span-12 lg:col-span-4 space-y-4">
            {/* Internal cost breakdown — staff & installer only, never on the public quote */}
            <div className="glass-card rounded-2xl p-4 border-l-2 border-amber-300">
              <div className="flex items-center gap-2 mb-3">
                <div className="text-sm font-bold text-paper">Internal breakdown</div>
                <span className="text-[9px] uppercase font-bold tracking-wider text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">Staff only</span>
              </div>
              <Row k="Siding material" v={ro(result.sidingMaterialSum)} />
              <Row k="Install labor" v={ro(result.sidingInstallSum)} />
              <Row k="Install materials" v={ro(result.installSum)} />
              {result.demoCost > 0 && <Row k={`Demo (${result.demoType})`} v={ro(result.demoCost)} />}
              <Row k="Permits" v={ro(result.permitsCost)} />
              <Row k="Debris removal" v={ro(result.debrisCost)} />
              <div className="border-t border-bdr my-2" />
              <Row k="Total cost" v={ro(result.totalCost)} bold />
              <Row k={`Markup ×${result.markup}`} v={<span className="font-mono text-paper">{money(result.salePrice)}</span>} />
              <div className="border-t border-bdr my-2" />
              <Row k="Profit" v={<span className={`font-mono font-bold ${result.profit < 0 ? 'text-red-600' : 'text-emerald-600'}`}>{money(result.profit)}</span>} />
              <Row k="Margin" v={<span className={`font-mono font-bold ${result.profit < 0 ? 'text-red-600' : 'text-emerald-600'}`}>{result.margin.toFixed(1)}%</span>} />
            </div>

            {/* Customer total */}
            <div className="glass-card rounded-2xl p-4">
              <div className="text-sm font-bold text-paper mb-3">Customer quote</div>
              <Row k="Quote subtotal" v={ro(salePrice)} />
              <Row k={`Sales tax (${taxRate}%)`} v={ro(taxAmount)} />
              <div className="border-t border-bdr my-2" />
              <Row k="Customer total" v={<span className="font-mono text-paper font-bold text-base">{money(customerTotal)}</span>} bold />
              <div className="text-[10px] text-dim mt-2 leading-relaxed">The customer sees scope lines priced at the marked-up rate — never the costs or margin above.</div>
            </div>

            {/* Settings */}
            <div className="glass-card rounded-2xl p-4 space-y-3">
              <div className="text-sm font-bold text-paper">Settings</div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={label}>Status</label><select className={input} value={quote.status} onChange={e => setQ('status', e.target.value)} disabled={!canWrite}>
                  {['draft', 'sent', 'viewed', 'signed', 'paid', 'won', 'declined', 'expired', 'void'].map(s => <option key={s} value={s}>{s}</option>)}</select></div>
                <div><label className={label}>Sales Tax %</label><input type="number" min="0" step="0.01" className={input} value={quote.tax_rate ?? 0} onChange={e => setQ('tax_rate', e.target.value)} disabled={!canWrite} /></div>
                <div className="col-span-2"><label className={label}>Location (install site)</label>
                  <select className={input} value={quote.location_id || ''} onChange={e => setQ('location_id', e.target.value || null)} disabled={!canWrite}>
                    <option value="">— None —</option>
                    {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select></div>
                <div><label className={label}>Valid until</label><input type="date" className={input} value={quote.valid_until || ''} onChange={e => setQ('valid_until', e.target.value)} disabled={!canWrite} /></div>
                <div><label className={label}>Install date</label><input type="date" className={input} value={quote.go_live_date || ''} onChange={e => setQ('go_live_date', e.target.value)} disabled={!canWrite} /></div>
                <div className="col-span-2"><label className={label}>Payment terms</label><select className={input} value={quote.payment_terms} onChange={e => setQ('payment_terms', e.target.value)} disabled={!canWrite}>
                  <option value="pay_now">Charge full now</option><option value="deposit">Deposit</option><option value="staged">Staged (deposit + milestones)</option><option value="invoice_later">Invoice later</option></select>
                  {quote.payment_terms === 'staged' && <div className="text-[10px] text-dim mt-1">Set up the deposit + milestones in the <span className="text-ember font-semibold">Payment schedule</span> panel at the top of the quote.</div>}</div>
                {quote.payment_terms === 'deposit' && <div className="col-span-2"><label className={label}>Deposit %</label><input type="number" className={input} value={quote.deposit_percent || 0} onChange={e => setQ('deposit_percent', e.target.value)} disabled={!canWrite} /></div>}
              </div>
            </div>

            {/* Customer link */}
            <div className="glass-card rounded-2xl p-4">
              <div className="text-sm font-bold text-paper mb-2">Customer link</div>
              <div className="flex gap-2">
                <input readOnly value={publicUrl} className={input + ' font-mono text-[10px]'} onFocus={e => e.target.select()} />
                <button onClick={copyLink} className="px-2 py-1 text-xs btn-ghost rounded-xl shrink-0">Copy</button>
              </div>
              <div className="text-[10px] text-dim mt-1">Save first so the customer sees the latest scope &amp; price.</div>
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
      <span className={`${bold ? 'font-bold' : ''}`}>{v}</span>
    </div>
  );
}
