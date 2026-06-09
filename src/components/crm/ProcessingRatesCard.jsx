import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { CreditCard } from 'lucide-react';
import { RATE_CATEGORIES, marginPct, blendedRate, gbp0 } from './PaymentsPanel.jsx';

// Shows the card-processing rates assigned to a company or a specific location.
// Renders nothing if there's no processing account, to avoid clutter.
export default function ProcessingRatesCard({ companyId, locationId, onNavigate }) {
  const [accounts, setAccounts] = useState(null);

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [companyId, locationId]);

  const load = async () => {
    let q = supabase.from('processing_accounts').select('*, location:locations(name)');
    if (companyId) q = q.eq('company_id', companyId);          // company owns the location
    else if (locationId) q = q.eq('location_id', locationId);
    else { setAccounts([]); return; }
    let { data: accs } = await q;
    accs = accs || [];
    // On a location record: show this location's account + any company-wide one (no location set)
    if (locationId) accs = accs.filter(a => a.location_id === locationId || a.location_id == null);
    const ids = accs.map(a => a.id);
    let rates = [], vols = [];
    if (ids.length) {
      const [r, v] = await Promise.all([
        supabase.from('processing_rates').select('*').in('account_id', ids),
        supabase.from('processing_volumes').select('*').in('account_id', ids).order('period', { ascending: false }),
      ]);
      rates = r.data || []; vols = v.data || [];
    }
    setAccounts((accs || []).map(a => ({
      ...a,
      rates: rates.filter(x => x.account_id === a.id),
      latestVol: vols.find(x => x.account_id === a.id) || null,
    })));
  };

  if (!accounts || accounts.length === 0) return null;

  const pct = (v) => v != null ? `${Number(v).toFixed(2)}%` : '—';

  return (
    <div className="glass-card rounded-2xl overflow-hidden">
      <div className="px-4 py-3 border-b border-bdr flex items-center gap-2">
        <CreditCard size={15} className="text-ember" />
        <h3 className="text-sm font-bold text-paper">Card Processing</h3>
        <span className="text-xs text-dim font-mono">({accounts.length})</span>
        {onNavigate && <button onClick={() => onNavigate('processing')} className="ml-auto text-xs text-ember hover:text-ember-deep font-medium">Open</button>}
      </div>
      <div className="divide-y divide-bdr">
        {accounts.map(a => (
          <div key={a.id} className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${a.status === 'live' ? 'bg-emerald-100 text-emerald-700' : a.status === 'churned' ? 'bg-slate-200 text-slate-500' : 'bg-amber-100 text-amber-700'}`}>{a.status}</span>
              {/* Company card: which location each account covers. Location card: flag the company-wide one */}
              {!locationId
                ? <span className="text-xs text-muted">{a.location?.name || a.label || 'All locations'}</span>
                : (a.location_id == null && <span className="text-xs text-muted">Company-wide</span>)}
              <span className="text-[11px] text-emerald-600 font-semibold ml-auto">{marginPct(a).toFixed(2)}% margin</span>
            </div>

            <div className="space-y-1">
              <div className="flex text-[9px] font-mono font-bold uppercase tracking-[0.12em] text-dim">
                <span className="flex-1">Card type</span><span className="w-12 text-right">Their</span><span className="w-12 text-right">Our</span>
              </div>
              {RATE_CATEGORIES.map(c => {
                const r = a.rates.find(x => x.category === c.key) || {};
                const [scheme, present] = c.label.split(' — ');
                return (
                  <div key={c.key} className="flex items-center text-xs">
                    <span className="flex-1 text-paper">{scheme}{present ? <span className="text-dim"> · {present.replace('Card ', '')}</span> : ''}</span>
                    <span className="w-12 text-right tabular-nums text-muted">{pct(r.current_rate_pct)}</span>
                    <span className="w-12 text-right tabular-nums text-paper font-medium">{pct(r.our_rate_pct)}</span>
                  </div>
                );
              })}
            </div>

            <div className="text-[11px] text-dim mt-2">
              Per-txn: their £{Number(a.current_txn_fee || 0).toFixed(2)} · our £{Number(a.our_txn_fee || 0).toFixed(2)}
            </div>
            {a.latestVol && (
              <div className="text-[11px] text-muted mt-1">
                {new Date(a.latestVol.period).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' })}: {gbp0(a.latestVol.amount_processed)} processed
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
