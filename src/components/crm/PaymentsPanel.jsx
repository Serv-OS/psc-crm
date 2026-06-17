import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { CreditCard, Plus, X, TrendingUp, Banknote } from 'lucide-react';
import ProcessingAccountDrawer from './ProcessingAccountDrawer.jsx';
import TwilioBillingCard from './TwilioBillingCard.jsx';

export const gbp0 = (n) => '$' + (Number(n) || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });

// Card scheme × presentment categories
export const RATE_CATEGORIES = [
  { key: 'visa_mc_cp', label: 'Visa / Mastercard — Card present' },
  { key: 'visa_mc_cnp', label: 'Visa / Mastercard — Card not present' },
  { key: 'amex', label: 'American Express' },
];

// Blended (averaged) value of a per-category rate field across defined lines.
// Falls back to the legacy account-level field when no category rates exist.
export const blendedRate = (a, field) => {
  const rows = (a.rates || []).filter(r => r[field] != null && r[field] !== '');
  if (rows.length) return rows.reduce((s, r) => s + Number(r[field]), 0) / rows.length;
  return a[field] != null ? Number(a[field]) : null;
};
export const marginPct = (a) => {
  const rows = (a.rates || []).filter(r => r.our_rate_pct != null && r.buy_rate_pct != null);
  if (rows.length) return rows.reduce((s, r) => s + (Number(r.our_rate_pct) - Number(r.buy_rate_pct)), 0) / rows.length;
  return Number(a.our_rate_pct || 0) - Number(a.buy_rate_pct || 0);
};
export const marginTxn = (a) => Number(a.our_txn_fee || 0) - Number(a.buy_txn_fee || 0);
export const revenueOf = (a, v) =>
  v.our_revenue != null ? Number(v.our_revenue)
    : Number(v.amount_processed || 0) * marginPct(a) / 100 + Number(v.transactions || 0) * marginTxn(a);

const thisMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
const periodOf = (m) => `${m}-01`;
const STATUS_STYLE = { prospect: 'bg-amber-100 text-amber-700', live: 'bg-emerald-100 text-emerald-700', churned: 'bg-slate-200 text-slate-500' };

export default function PaymentsPanel({ profile, onNavigate }) {
  const [accounts, setAccounts] = useState([]);
  const [volumes, setVolumes] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [locations, setLocations] = useState([]);
  const [month, setMonth] = useState(thisMonth());
  const [selected, setSelected] = useState(null);
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);
  const canWrite = profile.role === 'owner' || profile.role === 'editor';

  const load = useCallback(async () => {
    setLoading(true);
    const [a, v, c, l, r] = await Promise.all([
      supabase.from('processing_accounts').select('*, company:companies(name), location:locations(name)').order('created_at', { ascending: false }),
      supabase.from('processing_volumes').select('*'),
      supabase.from('companies').select('id, name').order('name'),
      supabase.from('locations').select('id, name, company_id').order('name'),
      supabase.from('processing_rates').select('*'),
    ]);
    const rates = r.data || [];
    const accts = (a.data || []).map(acc => ({ ...acc, rates: rates.filter(x => x.account_id === acc.id) }));
    setAccounts(accts); setVolumes(v.data || []); setCompanies(c.data || []); setLocations(l.data || []);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const period = periodOf(month);
  const volFor = (accId) => volumes.find(v => v.account_id === accId && v.period === period);

  // headline totals for the selected month
  let totalProcessed = 0, totalRevenue = 0;
  for (const acc of accounts) {
    const v = volFor(acc.id);
    if (v) { totalProcessed += Number(v.amount_processed || 0); totalRevenue += revenueOf(acc, v); }
  }
  const liveCount = accounts.filter(a => a.status === 'live').length;

  const accName = (a) => a.label || a.location?.name || a.company?.name || 'Unnamed account';

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 py-5 border-b border-bdr flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2.5">
          <CreditCard size={20} className="text-ember" />
          <div>
            <div className="text-xl font-bold text-paper">Billing &amp; Margins</div>
            <div className="text-xs text-muted">Card processing and telephony — your cost and what to bill the client</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <input type="month" value={month} onChange={e => setMonth(e.target.value)}
            className="px-3 py-2 bg-card border border-bdr rounded-xl text-sm text-paper" />
          {canWrite && <button onClick={() => setCreating(true)} className="btn-glass px-4 py-2 rounded-xl text-sm font-semibold flex items-center gap-1.5"><Plus size={15} /> Add account</button>}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-[1200px] mx-auto space-y-5">

          {/* Headline */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Headline icon={<Banknote size={18} />} value={gbp0(totalProcessed)} label="Amount processed" sub={`in ${new Date(period).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`} accent />
            <Headline icon={<TrendingUp size={18} />} value={gbp0(totalRevenue)} label="Our revenue" sub="margin this month" accent />
            <Headline value={liveCount} label="Live accounts" sub={`${accounts.length} total`} />
            <Headline value={totalProcessed > 0 ? ((totalRevenue / totalProcessed) * 100).toFixed(2) + '%' : '—'} label="Effective margin" sub="revenue ÷ processed" />
          </div>

          {/* Accounts */}
          <div className="glass-card rounded-2xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-bdr flex items-center gap-2">
              <h3 className="text-[13px] font-bold text-paper">Accounts</h3>
              <span className="text-xs text-dim font-mono">({accounts.length})</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[820px]">
                <thead>
                  <tr className="text-[10px] font-mono font-bold uppercase tracking-[0.14em] text-dim border-b border-bdr">
                    <th className="text-left px-5 py-2 font-bold">Customer</th>
                    <th className="text-left px-3 py-2 font-bold">Status</th>
                    <th className="text-right px-3 py-2 font-bold">Their rate</th>
                    <th className="text-right px-3 py-2 font-bold">Our rate</th>
                    <th className="text-right px-3 py-2 font-bold">Margin</th>
                    <th className="text-right px-3 py-2 font-bold">Processed</th>
                    <th className="text-right px-5 py-2 font-bold">Our revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? <tr><td colSpan={7} className="px-5 py-8 text-center text-dim">Loading…</td></tr>
                    : accounts.length === 0 ? <tr><td colSpan={7} className="px-5 py-8 text-center text-dim italic">No processing accounts yet.</td></tr>
                    : accounts.map(a => {
                      const v = volFor(a.id);
                      return (
                        <tr key={a.id} onClick={() => setSelected(a)} className="border-b border-bdr/60 hover:bg-card/50 cursor-pointer">
                          <td className="px-5 py-2.5">
                            <div className="text-paper font-medium">{accName(a)}</div>
                            {a.location?.name && a.company?.name && <div className="text-[11px] text-dim">{a.company.name}</div>}
                          </td>
                          <td className="px-3 py-2.5"><span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-lg ${STATUS_STYLE[a.status]}`}>{a.status}</span></td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-muted">{blendedRate(a, 'current_rate_pct') != null ? `${blendedRate(a, 'current_rate_pct').toFixed(2)}%` : '—'}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-paper">{blendedRate(a, 'our_rate_pct') != null ? `${blendedRate(a, 'our_rate_pct').toFixed(2)}%` : '—'}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-emerald-600 font-semibold">{marginPct(a).toFixed(2)}%</td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-paper">{v ? gbp0(v.amount_processed) : '—'}</td>
                          <td className="px-5 py-2.5 text-right tabular-nums font-semibold text-paper">{v ? gbp0(revenueOf(a, v)) : '—'}</td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Telephony reseller billing */}
          <TwilioBillingCard profile={profile} />

        </div>
      </div>

      {creating && <AccountModal companies={companies} locations={locations} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); load(); }} />}
      {selected && <ProcessingAccountDrawer account={selected} profile={profile} onNavigate={onNavigate}
        companies={companies} locations={locations}
        onClose={() => setSelected(null)} onChanged={() => { load(); }} />}
    </div>
  );
}

function Headline({ icon, value, label, sub, accent }) {
  return (
    <div className="glass-card rounded-2xl p-4">
      <div className="flex items-center gap-2 mb-1">
        {icon && <span className={accent ? 'text-ember' : 'text-dim'}>{icon}</span>}
        <span className="text-[10px] font-mono font-bold uppercase tracking-[0.14em] text-dim">{label}</span>
      </div>
      <div className={`text-2xl font-bold tabular-nums ${accent ? 'text-paper' : 'text-paper'}`}>{value}</div>
      {sub && <div className="text-[11px] text-dim mt-0.5">{sub}</div>}
    </div>
  );
}

const input = "w-full px-3 py-2 bg-card border border-bdr rounded-xl text-sm text-paper focus:outline-none focus:border-ember";
const label = "text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-dim mb-1 block";

const emptyRates = () => Object.fromEntries(RATE_CATEGORIES.map(c => [c.key, { current_rate_pct: '', our_rate_pct: '', buy_rate_pct: '' }]));

export function AccountModal({ account, companies, locations, onClose, onSaved }) {
  const a = account || {};
  const [f, setF] = useState({
    company_id: a.company_id || '', location_id: a.location_id || '', label: a.label || '', status: a.status || 'prospect',
    current_monthly_volume: a.current_monthly_volume ?? '',
    current_txn_fee: a.current_txn_fee ?? '', our_txn_fee: a.our_txn_fee ?? '', buy_txn_fee: a.buy_txn_fee ?? '',
    partner: a.partner || '', merchant_ref: a.merchant_ref || '',
  });
  const [rates, setRates] = useState(emptyRates());
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));
  const setRate = (cat, field, v) => setRates(p => ({ ...p, [cat]: { ...p[cat], [field]: v } }));
  const num = (v) => v === '' || v == null ? null : Number(v);
  const locs = locations.filter(l => l.company_id === f.company_id);

  useEffect(() => {
    if (!a.id) return;
    supabase.from('processing_rates').select('*').eq('account_id', a.id).then(({ data }) => {
      if (!data?.length) return;
      setRates(prev => {
        const next = { ...prev };
        data.forEach(r => { next[r.category] = { current_rate_pct: r.current_rate_pct ?? '', our_rate_pct: r.our_rate_pct ?? '', buy_rate_pct: r.buy_rate_pct ?? '' }; });
        return next;
      });
    });
  }, [a.id]);

  const save = async () => {
    if (!f.company_id) { alert('Pick a customer (company)'); return; }
    const row = {
      company_id: f.company_id, location_id: f.location_id || null, label: f.label.trim() || null, status: f.status,
      current_monthly_volume: num(f.current_monthly_volume),
      current_txn_fee: num(f.current_txn_fee), our_txn_fee: num(f.our_txn_fee), buy_txn_fee: num(f.buy_txn_fee),
      partner: f.partner.trim() || null, merchant_ref: f.merchant_ref.trim() || null, updated_at: new Date().toISOString(),
    };
    let accId = a.id;
    if (a.id) await supabase.from('processing_accounts').update(row).eq('id', a.id);
    else { const { data } = await supabase.from('processing_accounts').insert(row).select('id').single(); accId = data?.id; }
    if (accId) {
      for (const c of RATE_CATEGORIES) {
        const r = rates[c.key];
        const has = [r.current_rate_pct, r.our_rate_pct, r.buy_rate_pct].some(v => v !== '' && v != null);
        if (has) {
          await supabase.from('processing_rates').upsert({
            account_id: accId, category: c.key,
            current_rate_pct: num(r.current_rate_pct), our_rate_pct: num(r.our_rate_pct), buy_rate_pct: num(r.buy_rate_pct),
          }, { onConflict: 'account_id,category' });
        } else {
          await supabase.from('processing_rates').delete().eq('account_id', accId).eq('category', c.key);
        }
      }
    }
    onSaved();
  };

  const cell = "w-full px-2 py-1.5 bg-card border border-bdr rounded-lg text-sm text-paper text-right focus:outline-none focus:border-ember";

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="glass-card rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-bdr flex items-center justify-between sticky top-0 glass-card z-10">
          <div className="text-base font-bold text-paper">{a.id ? 'Edit account' : 'New processing account'}</div>
          <button onClick={onClose} className="text-muted hover:text-paper"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div><label className={label}>Customer</label>
              <select className={input} value={f.company_id} onChange={e => { set('company_id', e.target.value); set('location_id', ''); }}>
                <option value="">Select…</option>{companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select></div>
            <div><label className={label}>Location (optional)</label>
              <select className={input} value={f.location_id} onChange={e => set('location_id', e.target.value)}>
                <option value="">All / not set</option>{locs.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={label}>Label (optional)</label><input className={input} value={f.label} onChange={e => set('label', e.target.value)} placeholder="Merchant name" /></div>
            <div><label className={label}>Status</label><select className={input} value={f.status} onChange={e => set('status', e.target.value)}>
              <option value="prospect">Prospect</option><option value="live">Live</option><option value="churned">Churned</option></select></div>
          </div>

          {/* Per-category rate grid: scheme × presentment */}
          <Group title="Processing rates by card type">
            <table className="w-full">
              <thead>
                <tr className="text-[10px] font-mono font-bold uppercase tracking-[0.12em] text-dim">
                  <th className="text-left font-bold pb-1.5">Card type</th>
                  <th className="font-bold pb-1.5 px-1">Their %</th>
                  <th className="font-bold pb-1.5 px-1">Our %</th>
                  <th className="font-bold pb-1.5 px-1">Buy %</th>
                  <th className="font-bold pb-1.5 pl-2 text-right">Margin</th>
                </tr>
              </thead>
              <tbody>
                {RATE_CATEGORIES.map(c => {
                  const r = rates[c.key];
                  const m = Number(r.our_rate_pct || 0) - Number(r.buy_rate_pct || 0);
                  const [scheme, present] = c.label.split(' — ');
                  return (
                    <tr key={c.key}>
                      <td className="py-1 pr-2"><div className="text-sm text-paper leading-tight">{scheme}</div><div className="text-[10px] text-dim">{present}</div></td>
                      <td className="px-1"><input className={cell} value={r.current_rate_pct} onChange={e => setRate(c.key, 'current_rate_pct', e.target.value)} placeholder="—" /></td>
                      <td className="px-1"><input className={cell} value={r.our_rate_pct} onChange={e => setRate(c.key, 'our_rate_pct', e.target.value)} placeholder="—" /></td>
                      <td className="px-1"><input className={cell} value={r.buy_rate_pct} onChange={e => setRate(c.key, 'buy_rate_pct', e.target.value)} placeholder="—" /></td>
                      <td className="pl-2 text-right text-sm font-semibold tabular-nums text-emerald-600">{m.toFixed(2)}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Group>

          <Group title="Per-transaction fees ($) — all card types">
            <Three a={['current_txn_fee', 'Their / txn', '0.05']} b={['our_txn_fee', 'Our / txn', '0.03']} c={['buy_txn_fee', 'Buy / txn', '0.02']} f={f} set={set} />
          </Group>

          <div className="grid grid-cols-3 gap-3">
            <div><label className={label}>Monthly volume $</label><input className={input} value={f.current_monthly_volume} onChange={e => set('current_monthly_volume', e.target.value)} placeholder="40000" /></div>
            <div><label className={label}>Processing partner</label><input className={input} value={f.partner} onChange={e => set('partner', e.target.value)} placeholder="e.g. Adyen" /></div>
            <div><label className={label}>Merchant ref</label><input className={input} value={f.merchant_ref} onChange={e => set('merchant_ref', e.target.value)} placeholder="MID" /></div>
          </div>

          <div className="flex gap-2 pt-1"><button onClick={save} className="btn-glass px-5 py-2 rounded-xl text-sm font-semibold">Save</button>
            <button onClick={onClose} className="btn-ghost px-4 py-2 rounded-xl text-sm">Cancel</button></div>
        </div>
      </div>
    </div>
  );
}

function Group({ title, children }) {
  return <div className="glass-inner rounded-xl p-3"><div className="text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-dim mb-2">{title}</div>{children}</div>;
}
function Field({ k, lbl, ph, f, set }) {
  return <div><label className={label}>{lbl}</label><input className={input} value={f[k]} onChange={e => set(k, e.target.value)} placeholder={ph} /></div>;
}
function Two({ a, b, f, set }) { return <div className="grid grid-cols-2 gap-3"><Field k={a[0]} lbl={a[1]} ph={a[2]} f={f} set={set} /><Field k={b[0]} lbl={b[1]} ph={b[2]} f={f} set={set} /></div>; }
function Three({ a, b, c, f, set }) { return <div className="grid grid-cols-3 gap-3"><Field k={a[0]} lbl={a[1]} ph={a[2]} f={f} set={set} /><Field k={b[0]} lbl={b[1]} ph={b[2]} f={f} set={set} /><Field k={c[0]} lbl={c[1]} ph={c[2]} f={f} set={set} /></div>; }
