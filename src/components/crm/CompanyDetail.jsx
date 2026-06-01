import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import AssociationManager from './AssociationManager.jsx';
import ActivityTimeline from './ActivityTimeline.jsx';

export default function CompanyDetail({ companyId, profile, onClose, onNavigate }) {
  const [company, setCompany] = useState(null);
  const [locations, setLocations] = useState([]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({});
  const [members, setMembers] = useState([]);
  const [tab, setTab] = useState('overview');

  const canWrite = profile.role === 'owner' || profile.role === 'editor';

  useEffect(() => { load(); }, [companyId]);

  const load = async () => {
    const [c, l, m] = await Promise.all([
      supabase.from('companies').select('*').eq('id', companyId).single(),
      supabase.from('locations').select('*').eq('company_id', companyId).order('name'),
      supabase.from('profiles').select('id, email, display_name'),
    ]);
    setCompany(c.data);
    setLocations(l.data || []);
    setMembers(m.data || []);
  };

  const startEdit = () => {
    setDraft({ ...company });
    setEditing(true);
  };

  const save = async () => {
    const { id, created_at, updated_at, ...patch } = draft;
    await supabase.from('companies').update(patch).eq('id', companyId);
    setEditing(false);
    load();
  };

  const set = (k, v) => setDraft({ ...draft, [k]: v });

  const addLocation = async () => {
    const name = prompt('Location name:');
    if (!name?.trim()) return;
    await supabase.from('locations').insert({
      company_id: companyId,
      name: name.trim(),
      owner_id: profile.id,
    });
    load();
  };

  if (!company) return (
    <div className="h-full flex items-center justify-center text-dim text-sm">Loading...</div>
  );

  const ownerName = (id) => {
    const m = members.find(u => u.id === id);
    return m ? (m.display_name || m.email.split('@')[0]) : 'Unassigned';
  };

  const input = "w-full px-3 py-2 bg-card border border-bdr rounded text-sm text-paper placeholder-dim focus:outline-none focus:border-ember";
  const label = "text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-dim mb-1 block";
  const tabBtn = (t, lbl) => (
    <button onClick={() => setTab(t)}
      className={`px-3 py-1.5 text-xs font-medium rounded transition ${tab === t ? 'bg-card text-paper' : 'text-muted hover:text-paper'}`}>
      {lbl}
    </button>
  );

  const STATUS_COLORS = {
    prospect: 'bg-blue-500/20 text-blue-300',
    onboarding: 'bg-orange-500/20 text-orange-300',
    live: 'bg-green-500/20 text-green-300',
    churned: 'bg-red-500/20 text-red-300',
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-6 py-4 border-b border-bdr flex items-center gap-3">
        <button onClick={onClose} className="text-muted hover:text-paper text-sm">&larr;</button>
        <div className="flex-1 min-w-0">
          <div className="text-lg font-bold text-paper truncate">{company.name}</div>
          <div className="text-[10px] text-dim font-mono uppercase tracking-[0.18em]">
            {company.domain || 'No domain'} / {locations.length} location{locations.length !== 1 ? 's' : ''} / Owner: {ownerName(company.owner_id)}
          </div>
        </div>
        {canWrite && !editing && (
          <button onClick={startEdit}
            className="px-3 py-1.5 bg-card border border-bdr rounded text-xs text-muted hover:text-paper">Edit</button>
        )}
      </div>

      {/* Tabs */}
      <div className="px-6 py-2 border-b border-bdr flex gap-1">
        {tabBtn('overview', 'Overview')}
        {tabBtn('contacts', 'Contacts')}
        {tabBtn('locations', 'Locations')}
        {tabBtn('activity', 'Activity')}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-3xl">

          {tab === 'overview' && !editing && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <Field label="Phone" value={company.phone} />
                <Field label="Email" value={company.email} />
                <Field label="Website" value={company.website} />
                <Field label="Industry" value={company.industry} />
                <Field label="Address" value={[company.address, company.city, company.postcode].filter(Boolean).join(', ')} />
                <Field label="Employees" value={company.employee_count} />
                <Field label="Source" value={company.source} />
                <Field label="Owner" value={ownerName(company.owner_id)} />
              </div>
              {company.notes && (
                <div>
                  <div className={label}>Notes</div>
                  <div className="text-sm text-paper whitespace-pre-wrap">{company.notes}</div>
                </div>
              )}
            </div>
          )}

          {tab === 'overview' && editing && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div><label className={label}>Name</label><input className={input} value={draft.name || ''} onChange={e => set('name', e.target.value)} /></div>
                <div><label className={label}>Domain</label><input className={input} value={draft.domain || ''} onChange={e => set('domain', e.target.value)} /></div>
                <div><label className={label}>Phone</label><input className={input} value={draft.phone || ''} onChange={e => set('phone', e.target.value)} /></div>
                <div><label className={label}>Email</label><input className={input} value={draft.email || ''} onChange={e => set('email', e.target.value)} /></div>
                <div><label className={label}>Website</label><input className={input} value={draft.website || ''} onChange={e => set('website', e.target.value)} /></div>
                <div><label className={label}>Industry</label><input className={input} value={draft.industry || ''} onChange={e => set('industry', e.target.value)} /></div>
                <div><label className={label}>Address</label><input className={input} value={draft.address || ''} onChange={e => set('address', e.target.value)} /></div>
                <div><label className={label}>City</label><input className={input} value={draft.city || ''} onChange={e => set('city', e.target.value)} /></div>
                <div><label className={label}>Postcode</label><input className={input} value={draft.postcode || ''} onChange={e => set('postcode', e.target.value)} /></div>
                <div><label className={label}>Employees</label><input className={input} type="number" value={draft.employee_count || ''} onChange={e => set('employee_count', e.target.value ? parseInt(e.target.value) : null)} /></div>
                <div><label className={label}>Source</label><input className={input} value={draft.source || ''} onChange={e => set('source', e.target.value)} /></div>
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
            <AssociationManager
              subjectType="company"
              subjectId={companyId}
              targetType="contact"
              profile={profile}
              onNavigate={onNavigate}
            />
          )}

          {tab === 'locations' && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className={label + ' mb-0'}>Locations ({locations.length})</div>
                {canWrite && (
                  <button onClick={addLocation} className="px-2 py-1 text-xs text-ember hover:text-ember-deep">+ Add location</button>
                )}
              </div>
              <div className="space-y-1.5">
                {locations.map(l => (
                  <div key={l.id}
                    onClick={() => onNavigate?.('location', l.id)}
                    className="flex items-center gap-3 py-2.5 px-3 bg-card/50 border border-bdr rounded-lg cursor-pointer hover:border-dim transition">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-paper">{l.name}</div>
                      <div className="text-xs text-dim">{[l.venue_type, l.city].filter(Boolean).join(' / ') || 'No details'}</div>
                    </div>
                    <span className={`px-1.5 py-0.5 text-[9px] font-bold uppercase rounded ${STATUS_COLORS[l.status] || 'bg-card text-dim'}`}>
                      {l.status}
                    </span>
                    {l.covers && <span className="text-xs text-dim">{l.covers} covers</span>}
                  </div>
                ))}
                {locations.length === 0 && (
                  <div className="text-xs text-dim italic py-4 text-center">No locations yet.</div>
                )}
              </div>
            </div>
          )}

          {tab === 'activity' && (
            <ActivityTimeline subjectType="company" subjectId={companyId} profile={profile} />
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
