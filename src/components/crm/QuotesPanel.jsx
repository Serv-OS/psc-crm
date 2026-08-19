import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { FileSignature, Plus, X } from 'lucide-react';
import { money } from './InvoicesPanel.jsx';

const fmtD = (d) => d ? new Date(d).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: '2-digit' }) : '—';

// Effective display status: stale sent/viewed quotes past their validity = expired
export const quoteStatus = (q) => {
  if (['sent', 'viewed', 'draft'].includes(q.status) && q.valid_until &&
      new Date(q.valid_until) < new Date(new Date().toDateString())) return 'expired';
  return q.status;
};

export const QUOTE_BADGE = {
  draft: 'bg-slate-200 text-slate-600', sent: 'bg-blue-100 text-blue-700', viewed: 'bg-indigo-100 text-indigo-700',
  signed: 'bg-violet-100 text-violet-700', paid: 'bg-emerald-100 text-emerald-700', won: 'bg-emerald-100 text-emerald-700',
  declined: 'bg-red-100 text-red-700', expired: 'bg-amber-100 text-amber-700', void: 'bg-slate-100 text-slate-400',
};

const STATUSES = ['draft', 'sent', 'viewed', 'signed', 'paid', 'won', 'declined', 'expired', 'void'];

export default function QuotesPanel({ profile, onNavigate }) {
  const [quotes, setQuotes] = useState([]);
  const [locations, setLocations] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [statusFilter, setStatusFilter] = useState('all');
  const [creating, setCreating] = useState(false);
  const [newLocation, setNewLocation] = useState('');
  const [newContact, setNewContact] = useState('');
  const [loading, setLoading] = useState(true);
  const canWrite = profile.role === 'owner' || profile.role === 'editor';

  const load = useCallback(async () => {
    setLoading(true);
    const [q, c, ct] = await Promise.all([
      supabase.from('quotes').select('*, contact:contacts(first_name, last_name), location:locations(name, city)')
        .order('created_at', { ascending: false }),
      supabase.from('locations').select('id, name, city').order('name'),
      supabase.from('contacts').select('id, first_name, last_name, email').order('last_name'),
    ]);
    setQuotes(q.data || []); setLocations(c.data || []); setContacts(ct.data || []);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const deleteQuote = async (e, q) => {
    e.stopPropagation();
    if (!confirm(`Delete Quote #${q.quote_number}? This removes its estimate, line items and payment schedule. Any invoices raised from it are kept (unlinked). This cannot be undone.`)) return;
    const { error } = await supabase.from('quotes').delete().eq('id', q.id);
    if (error) { alert('Could not delete: ' + error.message); return; }
    load();
  };

  const createQuote = async () => {
    const { data, error } = await supabase.from('quotes').insert({
      status: 'draft', created_by: profile.id,
      location_id: newLocation || null, contact_id: newContact || null,
      valid_until: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
    }).select('id').single();
    if (error) { alert(error.message); return; }
    setCreating(false); setNewLocation(''); setNewContact('');
    onNavigate?.('quote', data.id);
  };

  const openCount = quotes.filter(q => ['sent', 'viewed'].includes(quoteStatus(q))).length;
  const openValue = quotes.filter(q => ['sent', 'viewed'].includes(quoteStatus(q)))
    .reduce((s, q) => s + Number(q.one_off_total || 0), 0);
  const mStart = new Date(); mStart.setDate(1); mStart.setHours(0, 0, 0, 0);
  const wonThisMonth = quotes.filter(q => ['won', 'paid'].includes(q.status) &&
    (q.paid_at || q.signed_at || q.updated_at) && new Date(q.paid_at || q.signed_at || q.updated_at) >= mStart)
    .reduce((s, q) => s + Number(q.one_off_total || 0), 0);

  const filtered = statusFilter === 'all' ? quotes : quotes.filter(q => quoteStatus(q) === statusFilter);

  const input = "px-3 py-2 bg-card border border-bdr rounded-xl text-sm text-paper focus:outline-none focus:border-ember";
  const contactName = (q) => q.contact ? [q.contact.first_name, q.contact.last_name].filter(Boolean).join(' ') : '';

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 py-5 border-b border-bdr flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2.5">
          <FileSignature size={20} className="text-ember" />
          <div>
            <div className="text-xl font-bold text-paper">Quotes</div>
            <div className="text-xs text-muted">Every quote, from draft to signed and paid</div>
          </div>
        </div>
        {canWrite && (
          <button onClick={() => setCreating(true)} className="btn-glass px-4 py-2 rounded-xl text-sm font-semibold flex items-center gap-1.5">
            <Plus size={15} /> New quote
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-[1100px] mx-auto space-y-4">

          {/* Stats */}
          <div className="grid grid-cols-3 gap-3">
            <div className="glass-card rounded-2xl px-4 py-3">
              <div className="text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-dim">Awaiting customer</div>
              <div className="text-lg font-bold text-paper">{openCount} <span className="text-sm font-medium text-muted">· {money(openValue)}</span></div>
            </div>
            <div className="glass-card rounded-2xl px-4 py-3">
              <div className="text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-dim">Won this month</div>
              <div className="text-lg font-bold text-emerald-600">{money(wonThisMonth)}</div>
            </div>
            <div className="glass-card rounded-2xl px-4 py-3">
              <div className="text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-dim">Total quotes</div>
              <div className="text-lg font-bold text-paper">{quotes.length}</div>
            </div>
          </div>

          {/* New quote inline form */}
          {creating && (
            <div className="glass-card rounded-2xl p-4 flex items-end gap-3 flex-wrap">
              <div className="flex-1 min-w-44">
                <label className="text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-dim mb-1 block">Location</label>
                <select className={input + ' w-full'} value={newLocation} onChange={e => setNewLocation(e.target.value)}>
                  <option value="">— Optional —</option>
                  {locations.map(l => <option key={l.id} value={l.id}>{l.name}{l.city ? ` (${l.city})` : ''}</option>)}
                </select>
              </div>
              <div className="flex-1 min-w-44">
                <label className="text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-dim mb-1 block">Contact</label>
                <select className={input + ' w-full'} value={newContact} onChange={e => setNewContact(e.target.value)}>
                  <option value="">— Optional —</option>
                  {contacts.map(c => <option key={c.id} value={c.id}>{[c.first_name, c.last_name].filter(Boolean).join(' ') || c.email}</option>)}
                </select>
              </div>
              <button onClick={createQuote} className="btn-glass px-4 py-2 rounded-xl text-sm font-semibold">Create</button>
              <button onClick={() => setCreating(false)} className="p-2 text-muted hover:text-paper"><X size={16} /></button>
            </div>
          )}

          {/* Status filter */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {['all', ...STATUSES].map(s => (
              <button key={s} onClick={() => setStatusFilter(s)}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold capitalize transition ${statusFilter === s ? 'bg-ember text-white' : 'bg-card text-muted hover:text-paper'}`}>
                {s}{s !== 'all' && <span className="ml-1 opacity-60">{quotes.filter(q => quoteStatus(q) === s).length}</span>}
              </button>
            ))}
          </div>

          {/* List */}
          <div className="glass-card rounded-2xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-dim border-b border-bdr">
                  <th className="text-left px-4 py-2.5">Quote</th>
                  <th className="text-left px-4 py-2.5">Customer</th>
                  <th className="text-left px-4 py-2.5 hidden md:table-cell">Created</th>
                  <th className="text-left px-4 py-2.5 hidden md:table-cell">Valid until</th>
                  <th className="text-right px-4 py-2.5">One-off total</th>
                  <th className="text-right px-4 py-2.5 hidden lg:table-cell">ARR</th>
                  <th className="text-left px-4 py-2.5">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(q => {
                  const st = quoteStatus(q);
                  return (
                    <tr key={q.id} onClick={() => onNavigate?.('quote', q.id)}
                      className="border-b border-bdr/50 last:border-0 cursor-pointer hover:bg-card/60 transition">
                      <td className="px-4 py-3 font-semibold text-paper">Q-{q.quote_number}</td>
                      <td className="px-4 py-3">
                        <div className="text-paper">{q.location?.name || contactName(q) || '—'}</div>
                        <div className="text-xs text-dim">{q.location?.city || contactName(q)}</div>
                      </td>
                      <td className="px-4 py-3 text-muted hidden md:table-cell">{fmtD(q.created_at)}</td>
                      <td className="px-4 py-3 text-muted hidden md:table-cell">{fmtD(q.valid_until)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-paper">{money(q.one_off_total)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-muted hidden lg:table-cell">{Number(q.recurring_arr) ? money(q.recurring_arr) : '—'}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className={`px-2 py-0.5 text-[10px] font-bold uppercase rounded ${QUOTE_BADGE[st] || 'bg-slate-100 text-slate-500'}`}>{st}</span>
                          {profile.role === 'owner' && <button onClick={e => deleteQuote(e, q)} title="Delete quote" className="ml-auto text-dim hover:text-red-600 text-sm leading-none px-1">×</button>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {!filtered.length && (
                  <tr><td colSpan={7} className="px-4 py-10 text-center text-dim text-xs italic">
                    {loading ? 'Loading…' : statusFilter === 'all' ? 'No quotes yet — create one or raise one from a deal.' : `No ${statusFilter} quotes.`}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>

        </div>
      </div>
    </div>
  );
}
