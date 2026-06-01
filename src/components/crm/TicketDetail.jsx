import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import AssociationManager from './AssociationManager.jsx';
import ActivityTimeline from './ActivityTimeline.jsx';

const STAGES = ['new','in_progress','waiting_on_customer','escalated','resolved','closed'];
const STAGE_LABELS = { new:'New', in_progress:'In Progress', waiting_on_customer:'Waiting on Customer', escalated:'Escalated', resolved:'Resolved', closed:'Closed' };
const STAGE_STYLES = {
  new:'bg-blue-500/20 text-blue-300', in_progress:'bg-orange-500/20 text-orange-300',
  waiting_on_customer:'bg-yellow-500/20 text-yellow-300', escalated:'bg-red-500/20 text-red-300',
  resolved:'bg-green-500/20 text-green-300', closed:'bg-slate-500/20 text-slate-300',
};

export default function TicketDetail({ ticketId, profile, onClose, onNavigate }) {
  const [ticket, setTicket] = useState(null);
  const [company, setCompany] = useState(null);
  const [members, setMembers] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [history, setHistory] = useState([]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({});
  const [tab, setTab] = useState('overview');

  const canWrite = profile.role === 'owner' || profile.role === 'editor';

  useEffect(() => { load(); }, [ticketId]);

  const load = async () => {
    const [t, m, c, h] = await Promise.all([
      supabase.from('tickets').select('*').eq('id', ticketId).single(),
      supabase.from('profiles').select('id, email, display_name'),
      supabase.from('companies').select('id, name').order('name'),
      supabase.from('stage_history').select('*').eq('object_type', 'ticket').eq('object_id', ticketId).order('changed_at', { ascending: false }),
    ]);
    setTicket(t.data);
    setMembers(m.data || []);
    setCompanies(c.data || []);
    setHistory(h.data || []);
    if (t.data?.company_id) setCompany(c.data?.find(co => co.id === t.data.company_id) || null);
  };

  const startEdit = () => { setDraft({ ...ticket }); setEditing(true); };

  const save = async () => {
    const oldStage = ticket.stage;
    const { id, created_at, updated_at, ...patch } = draft;
    if (patch.stage === 'resolved' && !ticket.resolved_at) patch.resolved_at = new Date().toISOString();
    if (patch.stage === 'closed') patch.closed_at = new Date().toISOString();
    await supabase.from('tickets').update(patch).eq('id', ticketId);
    if (patch.stage !== oldStage) {
      await supabase.from('stage_history').insert({
        object_type: 'ticket', object_id: ticketId, from_stage: oldStage, to_stage: patch.stage, changed_by: profile.id,
      });
    }
    setEditing(false); load();
  };

  const set = (k, v) => setDraft({ ...draft, [k]: v });

  const changeStage = async (newStage) => {
    if (newStage === ticket.stage) return;
    const patch = { stage: newStage };
    if (newStage === 'resolved') patch.resolved_at = new Date().toISOString();
    if (newStage === 'closed') patch.closed_at = new Date().toISOString();
    await supabase.from('tickets').update(patch).eq('id', ticketId);
    await supabase.from('stage_history').insert({
      object_type: 'ticket', object_id: ticketId, from_stage: ticket.stage, to_stage: newStage, changed_by: profile.id,
    });
    load();
  };

  if (!ticket) return <div className="h-full flex items-center justify-center text-dim text-sm">Loading...</div>;

  const ownerName = (id) => { const m = members.find(u => u.id === id); return m ? (m.display_name || m.email.split('@')[0]) : 'Unassigned'; };

  const input = "w-full px-3 py-2 bg-card border border-bdr rounded text-sm text-paper placeholder-dim focus:outline-none focus:border-ember";
  const label = "text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-dim mb-1 block";
  const tabBtn = (t, lbl) => (
    <button onClick={() => setTab(t)} className={`px-3 py-1.5 text-xs font-medium rounded transition ${tab === t ? 'bg-card text-paper' : 'text-muted hover:text-paper'}`}>{lbl}</button>
  );

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 py-4 border-b border-bdr flex items-center gap-3">
        <button onClick={onClose} className="text-muted hover:text-paper text-sm">&larr;</button>
        <div className="flex-1 min-w-0">
          <div className="text-lg font-bold text-paper truncate">{ticket.subject}</div>
          <div className="text-[10px] text-dim font-mono uppercase tracking-[0.18em]">
            <span className="text-ember cursor-pointer hover:underline" onClick={() => onNavigate?.('company', ticket.company_id)}>{company?.name}</span>
            {' / '}{ticket.ticket_type}{' / '}{ticket.priority}
          </div>
        </div>
        <span className={`px-2 py-1 text-[10px] font-bold uppercase rounded ${STAGE_STYLES[ticket.stage]}`}>{STAGE_LABELS[ticket.stage]}</span>
        {canWrite && !editing && (
          <button onClick={startEdit} className="px-3 py-1.5 bg-card border border-bdr rounded text-xs text-muted hover:text-paper">Edit</button>
        )}
      </div>

      {canWrite && (
        <div className="px-6 py-2 border-b border-bdr flex gap-0.5 overflow-x-auto">
          {STAGES.map((s, i) => {
            const isActive = ticket.stage === s;
            const isPast = STAGES.indexOf(ticket.stage) > i;
            return (
              <button key={s} onClick={() => changeStage(s)}
                className={`px-2 py-1 text-[9px] font-bold uppercase rounded transition whitespace-nowrap ${
                  isActive ? 'bg-ember text-ink' : isPast ? 'bg-ember/20 text-ember' : 'bg-card text-dim hover:text-paper'
                }`}>{STAGE_LABELS[s]}</button>
            );
          })}
        </div>
      )}

      <div className="px-6 py-2 border-b border-bdr flex gap-1">
        {tabBtn('overview', 'Overview')}
        {tabBtn('contacts', 'Contacts')}
        {tabBtn('history', 'History')}
        {tabBtn('activity', 'Activity')}
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-3xl">
          {tab === 'overview' && !editing && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <Field label="Priority" value={ticket.priority} />
                <Field label="Type" value={ticket.ticket_type} />
                <Field label="Owner" value={ownerName(ticket.owner_id)} />
                <Field label="Source" value={ticket.source} />
                {ticket.resolved_at && <Field label="Resolved" value={new Date(ticket.resolved_at).toLocaleDateString('en-GB')} />}
              </div>
              {ticket.description && (
                <div><div className={label}>Description</div><div className="text-sm text-paper whitespace-pre-wrap">{ticket.description}</div></div>
              )}
              {ticket.notes && (
                <div><div className={label}>Notes</div><div className="text-sm text-paper whitespace-pre-wrap">{ticket.notes}</div></div>
              )}
            </div>
          )}

          {tab === 'overview' && editing && (
            <div className="space-y-3">
              <div><label className={label}>Subject</label><input className={input} value={draft.subject || ''} onChange={e => set('subject', e.target.value)} /></div>
              <div><label className={label}>Description</label><textarea className={input + ' resize-none'} rows={4} value={draft.description || ''} onChange={e => set('description', e.target.value)} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={label}>Stage</label><select className={input} value={draft.stage} onChange={e => set('stage', e.target.value)}>
                  {STAGES.map(s => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}</select></div>
                <div><label className={label}>Priority</label><select className={input} value={draft.priority} onChange={e => set('priority', e.target.value)}>
                  <option value="P0">P0</option><option value="P1">P1</option><option value="P2">P2</option><option value="P3">P3</option></select></div>
                <div><label className={label}>Type</label><select className={input} value={draft.ticket_type || 'support'} onChange={e => set('ticket_type', e.target.value)}>
                  <option value="support">Support</option><option value="bug">Bug</option><option value="feature_request">Feature Request</option><option value="billing">Billing</option><option value="other">Other</option></select></div>
                <div><label className={label}>Owner</label><select className={input} value={draft.owner_id || ''} onChange={e => set('owner_id', e.target.value || null)}>
                  <option value="">Unassigned</option>{members.map(m => <option key={m.id} value={m.id}>{m.display_name || m.email}</option>)}</select></div>
                <div><label className={label}>Company</label><select className={input} value={draft.company_id} onChange={e => set('company_id', e.target.value)}>
                  {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
              </div>
              <div><label className={label}>Notes</label><textarea className={input + ' resize-none'} rows={2} value={draft.notes || ''} onChange={e => set('notes', e.target.value)} /></div>
              <div className="flex gap-2"><button onClick={save} className="px-4 py-2 bg-ember text-ink text-sm font-semibold rounded">Save</button>
                <button onClick={() => setEditing(false)} className="px-4 py-2 text-sm text-muted border border-bdr rounded">Cancel</button></div>
            </div>
          )}

          {tab === 'contacts' && <AssociationManager subjectType="ticket" subjectId={ticketId} targetType="contact" profile={profile} onNavigate={onNavigate} />}

          {tab === 'history' && (
            <div>
              <div className={label + ' mb-3'}>Stage history ({history.length})</div>
              <div className="space-y-2">
                {history.map(h => (
                  <div key={h.id} className="flex items-center gap-3 text-xs py-2 border-b border-bdr last:border-b-0">
                    <span className="text-muted">{ownerName(h.changed_by)}</span>
                    <span className="text-dim">{h.from_stage ? STAGE_LABELS[h.from_stage] : 'Created'} &rarr; {STAGE_LABELS[h.to_stage]}</span>
                    <span className="text-dim ml-auto">{new Date(h.changed_at).toLocaleDateString('en-GB', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' })}</span>
                  </div>
                ))}
                {history.length === 0 && <div className="text-xs text-dim italic py-3">No history.</div>}
              </div>
            </div>
          )}

          {tab === 'activity' && <ActivityTimeline subjectType="ticket" subjectId={ticketId} profile={profile} />}
        </div>
      </div>
    </div>
  );
}

function Field({ label, value }) {
  return (<div><div className="text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-dim mb-0.5">{label}</div>
    <div className="text-sm text-paper">{value || <span className="text-dim italic">--</span>}</div></div>);
}
