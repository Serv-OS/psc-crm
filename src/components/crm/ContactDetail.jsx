import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import AssociationManager from './AssociationManager.jsx';
import ActivityTimeline from './ActivityTimeline.jsx';

export default function ContactDetail({ contactId, profile, onClose, onNavigate }) {
  const [contact, setContact] = useState(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({});
  const [members, setMembers] = useState([]);
  const [tab, setTab] = useState('overview');

  const canWrite = profile.role === 'owner' || profile.role === 'editor';

  useEffect(() => { load(); }, [contactId]);

  const load = async () => {
    const [c, m] = await Promise.all([
      supabase.from('contacts').select('*').eq('id', contactId).single(),
      supabase.from('profiles').select('id, email, display_name'),
    ]);
    setContact(c.data);
    setMembers(m.data || []);
  };

  const startEdit = () => { setDraft({ ...contact }); setEditing(true); };

  const save = async () => {
    const { id, created_at, updated_at, ...patch } = draft;
    await supabase.from('contacts').update(patch).eq('id', contactId);
    setEditing(false);
    load();
  };

  const set = (k, v) => setDraft({ ...draft, [k]: v });

  if (!contact) return <div className="h-full flex items-center justify-center text-dim text-sm">Loading...</div>;

  const fullName = [contact.first_name, contact.last_name].filter(Boolean).join(' ') || 'Unnamed contact';

  const input = "w-full px-3 py-2 bg-card border border-bdr rounded text-sm text-paper placeholder-dim focus:outline-none focus:border-ember";
  const label = "text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-dim mb-1 block";
  const tabBtn = (t, lbl) => (
    <button onClick={() => setTab(t)}
      className={`px-3 py-1.5 text-xs font-medium rounded transition ${tab === t ? 'bg-card text-paper' : 'text-muted hover:text-paper'}`}>
      {lbl}
    </button>
  );

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 py-4 border-b border-bdr flex items-center gap-3">
        <button onClick={onClose} className="text-muted hover:text-paper text-sm">&larr;</button>
        <div className="flex-1 min-w-0">
          <div className="text-lg font-bold text-paper truncate">{fullName}</div>
          <div className="text-[10px] text-dim font-mono uppercase tracking-[0.18em]">
            {contact.email || 'No email'} {contact.phone ? ' / ' + contact.phone : ''}
          </div>
        </div>
        {canWrite && !editing && (
          <button onClick={startEdit} className="px-3 py-1.5 bg-card border border-bdr rounded text-xs text-muted hover:text-paper">Edit</button>
        )}
      </div>

      <div className="px-6 py-2 border-b border-bdr flex gap-1">
        {tabBtn('overview', 'Overview')}
        {tabBtn('companies', 'Companies')}
        {tabBtn('locations', 'Locations')}
        {tabBtn('activity', 'Activity')}
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-3xl">
          {tab === 'overview' && !editing && (
            <div className="grid grid-cols-2 gap-4">
              <Field label="First name" value={contact.first_name} />
              <Field label="Last name" value={contact.last_name} />
              <Field label="Email" value={contact.email} />
              <Field label="Phone" value={contact.phone} />
              <Field label="Job title" value={contact.job_title} />
              <Field label="Source" value={contact.source} />
              <Field label="Marketing opt-in" value={contact.marketing_opt_in ? 'Yes' : 'No'} />
              {contact.notes && (
                <div className="col-span-2">
                  <div className={label}>Notes</div>
                  <div className="text-sm text-paper whitespace-pre-wrap">{contact.notes}</div>
                </div>
              )}
            </div>
          )}

          {tab === 'overview' && editing && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div><label className={label}>First name</label><input className={input} value={draft.first_name || ''} onChange={e => set('first_name', e.target.value)} /></div>
                <div><label className={label}>Last name</label><input className={input} value={draft.last_name || ''} onChange={e => set('last_name', e.target.value)} /></div>
                <div><label className={label}>Email</label><input className={input} value={draft.email || ''} onChange={e => set('email', e.target.value)} type="email" /></div>
                <div><label className={label}>Phone</label><input className={input} value={draft.phone || ''} onChange={e => set('phone', e.target.value)} /></div>
                <div><label className={label}>Job title</label><input className={input} value={draft.job_title || ''} onChange={e => set('job_title', e.target.value)} /></div>
                <div><label className={label}>Source</label><input className={input} value={draft.source || ''} onChange={e => set('source', e.target.value)} /></div>
                <div>
                  <label className={label}>Owner</label>
                  <select className={input} value={draft.owner_id || ''} onChange={e => set('owner_id', e.target.value || null)}>
                    <option value="">Unassigned</option>
                    {members.map(m => <option key={m.id} value={m.id}>{m.display_name || m.email}</option>)}
                  </select>
                </div>
                <div className="flex items-end">
                  <label className="flex items-center gap-2 cursor-pointer py-2">
                    <input type="checkbox" checked={draft.marketing_opt_in || false} onChange={e => set('marketing_opt_in', e.target.checked)} className="accent-ember" />
                    <span className="text-sm text-paper">Marketing opt-in</span>
                  </label>
                </div>
              </div>
              <div><label className={label}>Notes</label><textarea className={input + ' resize-none'} rows={3} value={draft.notes || ''} onChange={e => set('notes', e.target.value)} /></div>
              <div className="flex gap-2 pt-1">
                <button onClick={save} className="px-4 py-2 bg-ember text-ink text-sm font-semibold rounded">Save</button>
                <button onClick={() => setEditing(false)} className="px-4 py-2 text-sm text-muted border border-bdr rounded">Cancel</button>
              </div>
            </div>
          )}

          {tab === 'companies' && (
            <AssociationManager subjectType="contact" subjectId={contactId} targetType="company" profile={profile} onNavigate={onNavigate} />
          )}

          {tab === 'locations' && (
            <AssociationManager subjectType="contact" subjectId={contactId} targetType="location" profile={profile} onNavigate={onNavigate} />
          )}

          {tab === 'activity' && (
            <ActivityTimeline subjectType="contact" subjectId={contactId} profile={profile} />
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, value }) {
  return (
    <div>
      <div className="text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-dim mb-0.5">{label}</div>
      <div className="text-sm text-paper">{value || <span className="text-dim italic">--</span>}</div>
    </div>
  );
}
