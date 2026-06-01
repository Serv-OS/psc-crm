import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import AssociationManager from './AssociationManager.jsx';
import ActivityTimeline from './ActivityTimeline.jsx';

const STATUS_OPTIONS = ['prospect', 'onboarding', 'live', 'churned'];

export default function LocationDetail({ locationId, profile, onClose, onNavigate }) {
  const [location, setLocation] = useState(null);
  const [company, setCompany] = useState(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({});
  const [members, setMembers] = useState([]);
  const [tab, setTab] = useState('overview');

  const canWrite = profile.role === 'owner' || profile.role === 'editor';

  useEffect(() => { load(); }, [locationId]);

  const load = async () => {
    const [l, m] = await Promise.all([
      supabase.from('locations').select('*').eq('id', locationId).single(),
      supabase.from('profiles').select('id, email, display_name'),
    ]);
    setLocation(l.data);
    setMembers(m.data || []);
    if (l.data?.company_id) {
      const { data: c } = await supabase.from('companies').select('id, name').eq('id', l.data.company_id).single();
      setCompany(c);
    }
  };

  const startEdit = () => { setDraft({ ...location }); setEditing(true); };

  const save = async () => {
    const { id, created_at, updated_at, ...patch } = draft;
    await supabase.from('locations').update(patch).eq('id', locationId);
    setEditing(false);
    load();
  };

  const set = (k, v) => setDraft({ ...draft, [k]: v });

  if (!location) return <div className="h-full flex items-center justify-center text-dim text-sm">Loading...</div>;

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
          <div className="text-lg font-bold text-paper truncate">{location.name}</div>
          <div className="text-[10px] text-dim font-mono uppercase tracking-[0.18em]">
            <span className="text-ember cursor-pointer hover:underline" onClick={() => onNavigate?.('company', location.company_id)}>
              {company?.name || 'Unknown company'}
            </span>
            {' / '}{location.venue_type || 'No type'}{' / '}{location.status}
          </div>
        </div>
        {canWrite && !editing && (
          <button onClick={startEdit} className="px-3 py-1.5 bg-card border border-bdr rounded text-xs text-muted hover:text-paper">Edit</button>
        )}
      </div>

      <div className="px-6 py-2 border-b border-bdr flex gap-1">
        {tabBtn('overview', 'Overview')}
        {tabBtn('contacts', 'Contacts')}
        {tabBtn('activity', 'Activity')}
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-3xl">
          {tab === 'overview' && !editing && (
            <div className="grid grid-cols-2 gap-4">
              <Field label="Address" value={[location.address, location.city, location.postcode].filter(Boolean).join(', ')} />
              <Field label="Phone" value={location.phone} />
              <Field label="Email" value={location.email} />
              <Field label="Venue type" value={location.venue_type} />
              <Field label="Covers" value={location.covers} />
              <Field label="Status" value={location.status} />
              <Field label="Go-live date" value={location.go_live_date} />
              {location.notes && (
                <div className="col-span-2">
                  <div className={label}>Notes</div>
                  <div className="text-sm text-paper whitespace-pre-wrap">{location.notes}</div>
                </div>
              )}
            </div>
          )}

          {tab === 'overview' && editing && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div><label className={label}>Name</label><input className={input} value={draft.name || ''} onChange={e => set('name', e.target.value)} /></div>
                <div>
                  <label className={label}>Status</label>
                  <select className={input} value={draft.status} onChange={e => set('status', e.target.value)}>
                    {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div><label className={label}>Venue type</label><input className={input} value={draft.venue_type || ''} onChange={e => set('venue_type', e.target.value)} placeholder="restaurant, bar, cafe..." /></div>
                <div><label className={label}>Covers</label><input className={input} type="number" value={draft.covers || ''} onChange={e => set('covers', e.target.value ? parseInt(e.target.value) : null)} /></div>
                <div><label className={label}>Address</label><input className={input} value={draft.address || ''} onChange={e => set('address', e.target.value)} /></div>
                <div><label className={label}>City</label><input className={input} value={draft.city || ''} onChange={e => set('city', e.target.value)} /></div>
                <div><label className={label}>Postcode</label><input className={input} value={draft.postcode || ''} onChange={e => set('postcode', e.target.value)} /></div>
                <div><label className={label}>Phone</label><input className={input} value={draft.phone || ''} onChange={e => set('phone', e.target.value)} /></div>
                <div><label className={label}>Email</label><input className={input} value={draft.email || ''} onChange={e => set('email', e.target.value)} /></div>
                <div><label className={label}>Go-live date</label><input className={input} type="date" value={draft.go_live_date || ''} onChange={e => set('go_live_date', e.target.value || null)} /></div>
                <div>
                  <label className={label}>Owner</label>
                  <select className={input} value={draft.owner_id || ''} onChange={e => set('owner_id', e.target.value || null)}>
                    <option value="">Unassigned</option>
                    {members.map(m => <option key={m.id} value={m.id}>{m.display_name || m.email}</option>)}
                  </select>
                </div>
              </div>
              <div><label className={label}>Notes</label><textarea className={input + ' resize-none'} rows={3} value={draft.notes || ''} onChange={e => set('notes', e.target.value)} /></div>
              <div className="flex gap-2 pt-1">
                <button onClick={save} className="px-4 py-2 bg-ember text-ink text-sm font-semibold rounded">Save</button>
                <button onClick={() => setEditing(false)} className="px-4 py-2 text-sm text-muted border border-bdr rounded">Cancel</button>
              </div>
            </div>
          )}

          {tab === 'contacts' && (
            <AssociationManager subjectType="location" subjectId={locationId} targetType="contact" profile={profile} onNavigate={onNavigate} />
          )}

          {tab === 'activity' && (
            <ActivityTimeline subjectType="location" subjectId={locationId} profile={profile} />
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
