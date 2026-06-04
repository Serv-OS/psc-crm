import { useEffect, useState, useMemo } from 'react';
import { supabase } from '../../lib/supabase';
import SlaBadge from './SlaBadge.jsx';

const STAGE_STYLES = {
  new: 'bg-blue-100 text-blue-700 border border-blue-200',
  in_progress: 'bg-orange-100 text-orange-700 border border-orange-200',
  waiting_on_customer: 'bg-amber-100 text-amber-700 border border-amber-200',
  escalated: 'bg-red-100 text-red-700 border border-red-200',
  resolved: 'bg-emerald-100 text-emerald-700 border border-emerald-200',
  closed: 'bg-slate-100 text-slate-600 border border-slate-200',
};
const STAGE_LABELS = {
  new:'New', in_progress:'In Progress', waiting_on_customer:'Waiting',
  escalated:'Escalated', resolved:'Resolved', closed:'Closed',
};
const PRIORITY_STYLES = {
  P0: 'text-red-600', P1: 'text-orange-600', P2: 'text-blue-400', P3: 'text-slate-400',
};

export default function TicketList({ profile, onSelect, onNavigate }) {
  const [tickets, setTickets] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState({ status: 'open', search: '' });
  const [locations, setLocations] = useState([]);
  const [showCreate, setShowCreate] = useState(false);
  const [subject, setSubject] = useState('');
  const [newLocation, setNewLocation] = useState('');
  const [companyId, setCompanyId] = useState('');
  const [priority, setPriority] = useState('P2');
  const [ticketType, setTicketType] = useState('support');
  const [description, setDescription] = useState('');

  const canWrite = profile.role === 'owner' || profile.role === 'editor';

  useEffect(() => {
    load();
    // Realtime: auto-refresh when tickets change
    const ch = supabase.channel('tickets-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tickets' }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const load = async () => {
    setLoading(true);
    const [t, c, l, m] = await Promise.all([
      supabase.from('tickets').select('*').order('created_at', { ascending: false }),
      supabase.from('companies').select('id, name').order('name'),
      supabase.from('locations').select('id, name, company_id').order('name'),
      supabase.from('profiles').select('id, email, display_name'),
    ]);
    setTickets(t.data || []);
    setCompanies(c.data || []);
    setLocations(l.data || []);
    setMembers(m.data || []);
    setLoading(false);
  };

  const filtered = useMemo(() => {
    let result = tickets;
    if (filter.status === 'open') result = result.filter(t => !['resolved','closed'].includes(t.stage));
    else if (filter.status !== 'all') result = result.filter(t => t.stage === filter.status);
    if (filter.search) {
      const q = filter.search.toLowerCase();
      result = result.filter(t => t.subject.toLowerCase().includes(q) ||
        (companies.find(c => c.id === t.company_id)?.name || '').toLowerCase().includes(q));
    }
    return result;
  }, [tickets, filter, companies]);

  const companyName = (id) => companies.find(c => c.id === id)?.name || '';
  const ownerName = (id) => {
    const m = members.find(u => u.id === id);
    return m ? (m.display_name || m.email.split('@')[0]) : '';
  };

  const handleLocationChange = (locId) => {
    setNewLocation(locId);
    if (locId) {
      const loc = locations.find(l => l.id === locId);
      if (loc) setCompanyId(loc.company_id);
    }
  };

  const create = async (e) => {
    e.preventDefault();
    if (!subject.trim() || !companyId) return;
    const { data } = await supabase.from('tickets').insert({
      subject: subject.trim(),
      description: description.trim() || null,
      company_id: companyId,
      priority, ticket_type: ticketType, owner_id: profile.id,
    }).select().single();
    if (data) {
      await supabase.from('stage_history').insert({
        object_type: 'ticket', object_id: data.id, from_stage: null, to_stage: 'new', changed_by: profile.id,
      });
      if (newLocation) {
        await supabase.from('associations').insert({
          from_type: 'ticket', from_id: data.id, to_type: 'location', to_id: newLocation, label: 'affected_location',
        });
      }
    }
    setSubject(''); setDescription(''); setNewLocation(''); setCompanyId(''); setPriority('P2'); setTicketType('support'); setShowCreate(false);
    if (data) onSelect(data.id);
    else load();
  };

  const openCount = tickets.filter(t => !['resolved','closed'].includes(t.stage)).length;
  const escalatedCount = tickets.filter(t => t.stage === 'escalated').length;
  const input = "w-full px-3 py-2 bg-card border border-bdr rounded text-sm text-paper placeholder-dim focus:outline-none focus:border-ember";

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 py-4 border-b border-bdr flex items-center justify-between">
        <div>
          <div className="text-lg font-bold text-paper">Support Tickets</div>
          <div className="text-[10px] text-dim font-mono uppercase tracking-[0.18em]">
            {openCount} open{escalatedCount > 0 ? ` / ${escalatedCount} escalated` : ''} / {tickets.length} total
          </div>
        </div>
        {canWrite && (
          <button onClick={() => setShowCreate(true)}
            className="px-3 py-1.5 bg-ember text-ink text-sm font-semibold rounded hover:bg-ember-deep transition">+ New ticket</button>
        )}
      </div>

      <div className="px-6 py-3 border-b border-bdr flex items-center gap-2">
        <input value={filter.search} onChange={e => setFilter({ ...filter, search: e.target.value })}
          placeholder="Search tickets..." className="px-3 py-1.5 bg-card border border-bdr rounded text-sm text-paper placeholder-dim focus:outline-none focus:border-ember w-56" />
        <select value={filter.status} onChange={e => setFilter({ ...filter, status: e.target.value })}
          className="px-2 py-1.5 bg-card border border-bdr rounded text-sm text-paper focus:outline-none focus:border-ember">
          <option value="open">Open</option>
          <option value="all">All</option>
          {Object.entries(STAGE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>

      {showCreate && (
        <div className="px-6 py-3 border-b border-bdr">
          <form onSubmit={create} className="space-y-2">
            <input className={input} value={subject} onChange={e => setSubject(e.target.value)} placeholder="Ticket subject" autoFocus />
            <textarea className={input + ' resize-none'} rows={2} value={description} onChange={e => setDescription(e.target.value)} placeholder="Description (optional)" />
            <div className="flex gap-2 items-center flex-wrap">
              <select className={input + ' w-56'} value={newLocation} onChange={e => handleLocationChange(e.target.value)}>
                <option value="">Select location...</option>
                {locations.map(l => {
                  const co = companies.find(c => c.id === l.company_id);
                  return <option key={l.id} value={l.id}>{l.name} ({co?.name || '?'})</option>;
                })}
              </select>
              {companyId && (
                <span className="px-3 py-2 bg-slate-50 border border-slate-200 rounded text-xs text-slate-600 flex items-center gap-1.5">
                  {'\u{1F3E2}'} {companies.find(c => c.id === companyId)?.name || ''}
                </span>
              )}
              {!newLocation && (
                <select className={input + ' w-44'} value={companyId} onChange={e => setCompanyId(e.target.value)}>
                  <option value="">Or company...</option>
                  {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              )}
              <select className={input + ' w-24'} value={priority} onChange={e => setPriority(e.target.value)}>
                <option value="P0">P0</option><option value="P1">P1</option><option value="P2">P2</option><option value="P3">P3</option>
              </select>
              <select className={input + ' w-36'} value={ticketType} onChange={e => setTicketType(e.target.value)}>
                <option value="support">Support</option><option value="bug">Bug</option>
                <option value="feature_request">Feature Req</option><option value="billing">Billing</option><option value="other">Other</option>
              </select>
              <button type="submit" className="px-4 py-2 bg-ember text-white text-sm font-semibold rounded shrink-0">Create</button>
              <button type="button" onClick={() => { setShowCreate(false); setNewLocation(''); setCompanyId(''); setDescription(''); }}
                className="px-3 py-2 text-sm text-muted border border-bdr rounded shrink-0">Cancel</button>
            </div>
          </form>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {/* Mobile cards */}
        <div className="sm:hidden divide-y divide-bdr">
          {loading && <div className="px-4 py-8 text-center text-dim text-sm">Loading...</div>}
          {!loading && filtered.length === 0 && <div className="px-4 py-8 text-center text-dim text-sm">No tickets.</div>}
          {!loading && filtered.map(t => (
            <button key={t.id} onClick={() => onSelect(t.id)} className="w-full text-left px-4 py-3 active:bg-card/50">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-mono font-bold text-ember shrink-0">{t.ticket_number ? `#${t.ticket_number}` : '--'}</span>
                <span className="text-sm text-paper font-medium flex-1 min-w-0 truncate">{t.subject}</span>
                <span className={`text-xs font-bold ${PRIORITY_STYLES[t.priority]}`}>{t.priority}</span>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {companyName(t.company_id) && <span className="text-xs text-muted">{companyName(t.company_id)}</span>}
                <span className={`px-1.5 py-0.5 text-[9px] font-bold uppercase rounded ${STAGE_STYLES[t.stage]}`}>{STAGE_LABELS[t.stage] || t.stage}</span>
                <SlaBadge ticket={t} />
                <span className="text-[10px] text-dim ml-auto">{ownerName(t.owner_id)} · {new Date(t.created_at).toLocaleDateString('en-GB', { day:'numeric', month:'short' })}</span>
              </div>
            </button>
          ))}
        </div>

        <table className="w-full hidden sm:table">
          <thead>
            <tr className="border-b border-bdr text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-dim">
              <th className="px-6 py-2.5 text-left">Ticket</th>
              <th className="px-3 py-2.5 text-left">Subject</th>
              <th className="px-3 py-2.5 text-left">Company</th>
              <th className="px-3 py-2.5 text-center">Priority</th>
              <th className="px-3 py-2.5 text-left">Type</th>
              <th className="px-3 py-2.5 text-left">Stage</th>
              <th className="px-3 py-2.5 text-left">SLA</th>
              <th className="px-3 py-2.5 text-left">Owner</th>
              <th className="px-3 py-2.5 text-left">Created</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={9} className="px-6 py-8 text-center text-dim text-sm">Loading...</td></tr>}
            {!loading && filtered.map(t => (
              <tr key={t.id} onClick={() => onSelect(t.id)} className="border-b border-bdr hover:bg-card/50 cursor-pointer transition">
                <td className="px-6 py-3 text-xs font-mono font-bold text-ember">{t.ticket_number ? `#${t.ticket_number}` : '--'}</td>
                <td className="px-3 py-3 text-sm text-paper">{t.subject}</td>
                <td className="px-3 py-3 text-xs text-muted">{companyName(t.company_id)}</td>
                <td className={`px-3 py-3 text-xs font-bold text-center ${PRIORITY_STYLES[t.priority]}`}>{t.priority}</td>
                <td className="px-3 py-3 text-xs text-muted">{t.ticket_type}</td>
                <td className="px-3 py-3">
                  <span className={`px-1.5 py-0.5 text-[9px] font-bold uppercase rounded ${STAGE_STYLES[t.stage]}`}>
                    {STAGE_LABELS[t.stage] || t.stage}
                  </span>
                </td>
                <td className="px-3 py-3"><SlaBadge ticket={t} /></td>
                <td className="px-3 py-3 text-xs text-muted">{ownerName(t.owner_id)}</td>
                <td className="px-3 py-3 text-xs text-dim">{new Date(t.created_at).toLocaleDateString('en-GB', { day:'numeric', month:'short' })}</td>
              </tr>
            ))}
            {!loading && filtered.length === 0 && (
              <tr><td colSpan={9} className="px-6 py-8 text-center text-dim text-sm">No tickets.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
