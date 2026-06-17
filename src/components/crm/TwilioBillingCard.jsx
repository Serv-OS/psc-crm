import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { Phone, RefreshCw } from 'lucide-react';

// Back-office reseller billing for the Twilio phone number.
// Pulls real monthly cost (synced from Twilio via the twilio-usage-sync fn),
// applies a markup %, and shows the "bill the client" figure per month.
const usd = (n) => '$' + (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const monthLabel = (period) => new Date(period).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });

export default function TwilioBillingCard({ profile }) {
  const canWrite = profile.role === 'owner' || profile.role === 'editor';
  const [cfg, setCfg] = useState(null);
  const [rows, setRows] = useState([]);
  const [markup, setMarkup] = useState('');
  const [billTo, setBillTo] = useState('');
  const [savingCfg, setSavingCfg] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [msg, setMsg] = useState(null);

  const load = useCallback(async () => {
    const [s, u] = await Promise.all([
      supabase.from('support_settings').select('twilio_number, twilio_markup_pct, twilio_bill_to').eq('id', 1).maybeSingle(),
      supabase.from('twilio_usage').select('*').order('period', { ascending: false }).limit(12),
    ]);
    setCfg(s.data || {});
    setMarkup(s.data?.twilio_markup_pct != null ? String(s.data.twilio_markup_pct) : '');
    setBillTo(s.data?.twilio_bill_to || '');
    setRows(u.data || []);
  }, []);
  useEffect(() => { load(); }, [load]);

  const markupPct = Number(markup) || 0;
  const billOf = (r) => Number(r.total_cost || 0) * (1 + markupPct / 100);

  const saveCfg = async () => {
    setSavingCfg(true);
    await supabase.from('support_settings').update({
      twilio_markup_pct: markup === '' ? 0 : Number(markup),
      twilio_bill_to: billTo.trim() || null,
    }).eq('id', 1);
    setSavingCfg(false);
    setMsg('Saved');
    setTimeout(() => setMsg(null), 1500);
    load();
  };

  const syncNow = async () => {
    setSyncing(true);
    setMsg(null);
    try {
      const { data, error } = await supabase.functions.invoke('twilio-usage-sync');
      if (error) throw error;
      if (data?.configured === false) setMsg('Twilio not connected yet — set the Twilio secrets first.');
      else { setMsg(`Synced ${data?.synced ?? 0} month(s)`); await load(); }
    } catch (e) {
      setMsg('Sync failed: ' + (e.message || 'unknown error'));
    } finally {
      setSyncing(false);
      setTimeout(() => setMsg(null), 4000);
    }
  };

  const current = rows[0];

  return (
    <div className="glass-card rounded-2xl overflow-hidden">
      <div className="px-5 py-3.5 border-b border-bdr flex items-center gap-2 flex-wrap">
        <Phone size={16} className="text-ember" />
        <h3 className="text-[13px] font-bold text-paper">Phone (Twilio)</h3>
        <span className="text-xs text-dim font-mono">{cfg?.twilio_number || 'no number set'}</span>
        <div className="ml-auto flex items-center gap-2">
          {msg && <span className="text-[11px] text-muted">{msg}</span>}
          {canWrite && (
            <button onClick={syncNow} disabled={syncing}
              className="btn-ghost px-3 py-1.5 rounded-xl text-xs flex items-center gap-1.5 disabled:opacity-50">
              <RefreshCw size={13} className={syncing ? 'animate-spin' : ''} /> {syncing ? 'Syncing…' : 'Sync now'}
            </button>
          )}
        </div>
      </div>

      {/* Markup config + current-month headline */}
      <div className="px-5 py-4 border-b border-bdr grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
        <div>
          <label className="text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-dim mb-1 block">Markup %</label>
          <input type="number" value={markup} onChange={e => setMarkup(e.target.value)} disabled={!canWrite}
            placeholder="30" className="w-full px-3 py-2 bg-card border border-bdr rounded-xl text-sm text-paper focus:outline-none focus:border-ember" />
        </div>
        <div>
          <label className="text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-dim mb-1 block">Bill to</label>
          <input value={billTo} onChange={e => setBillTo(e.target.value)} disabled={!canWrite}
            placeholder="Client name" className="w-full px-3 py-2 bg-card border border-bdr rounded-xl text-sm text-paper focus:outline-none focus:border-ember" />
        </div>
        <div>
          {canWrite && <button onClick={saveCfg} disabled={savingCfg} className="btn-glass px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-50">{savingCfg ? 'Saving…' : 'Save markup'}</button>}
        </div>
        <div className="text-right">
          <div className="text-[10px] font-mono font-bold uppercase tracking-[0.14em] text-dim">This month — bill</div>
          <div className="text-2xl font-bold tabular-nums text-paper">{current ? usd(billOf(current)) : '—'}</div>
          {current && <div className="text-[11px] text-dim">cost {usd(current.total_cost)} + {markupPct}%</div>}
        </div>
      </div>

      {/* Monthly table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[760px]">
          <thead>
            <tr className="text-[10px] font-mono font-bold uppercase tracking-[0.14em] text-dim border-b border-bdr">
              <th className="text-left px-5 py-2 font-bold">Month</th>
              <th className="text-right px-3 py-2 font-bold">Calls (in/out)</th>
              <th className="text-right px-3 py-2 font-bold">Mins</th>
              <th className="text-right px-3 py-2 font-bold">SMS (in/out)</th>
              <th className="text-right px-3 py-2 font-bold">Number</th>
              <th className="text-right px-3 py-2 font-bold">Usage cost</th>
              <th className="text-right px-3 py-2 font-bold">Your cost</th>
              <th className="text-right px-5 py-2 font-bold">Bill client</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={8} className="px-5 py-8 text-center text-dim italic">No usage synced yet. Connect Twilio, then hit “Sync now”.</td></tr>
            ) : rows.map(r => (
              <tr key={r.id} className="border-b border-bdr/60">
                <td className="px-5 py-2.5 text-paper font-medium">{monthLabel(r.period)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-muted">{r.inbound_calls}/{r.outbound_calls}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-muted">{Math.round(Number(r.call_minutes) || 0)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-muted">{r.inbound_sms}/{r.outbound_sms}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-muted">{usd(r.number_cost)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-muted">{usd(r.usage_cost)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-paper">{usd(r.total_cost)}</td>
                <td className="px-5 py-2.5 text-right tabular-nums font-semibold text-emerald-600">{usd(billOf(r))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
