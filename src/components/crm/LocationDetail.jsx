import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import TimerButton from './TimerButton.jsx';
import AssociationManager from './AssociationManager.jsx';
import { PROPERTY_TYPES, propertyTypeLabel } from '../../lib/propertyTypes';
import { BUILD_STAGE_LABELS } from '../../lib/buildStages';
import ActivityTimeline from './ActivityTimeline.jsx';
import CallButton from '../CallButton.jsx';
import LeadBadge from './LeadBadge.jsx';
import LeadsCard from './LeadsCard.jsx';
import ProcessingRatesCard from './ProcessingRatesCard.jsx';
import HardwareCard from './HardwareCard.jsx';
import InvoicesCard from './InvoicesCard.jsx';
import { primaryLead } from '../../lib/leadStages';

const STATUS_OPTIONS = ['prospect', 'onboarding', 'live', 'churned'];
const STATUS_COLORS = {
  prospect: 'bg-blue-100 text-blue-700 border border-blue-200 border-blue-500/30',
  onboarding: 'bg-orange-100 text-orange-700 border border-orange-200 border-orange-500/30',
  live: 'bg-emerald-100 text-emerald-700 border border-emerald-200 border-green-500/30',
  churned: 'bg-red-100 text-red-700 border border-red-200 border-red-500/30',
};

export default function LocationDetail({ locationId, profile, onClose, onNavigate, onCreateLead }) {
  const [location, setLocation] = useState(null);
  const [company, setCompany] = useState(null);
  const [deals, setDeals] = useState([]);
  const [onboardings, setOnboardings] = useState([]);
  const [projects, setProjects] = useState([]);
  const [locationModules, setLocationModules] = useState([]);
  const [modules, setModules] = useState([]);
  const [leads, setLeads] = useState([]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({});
  const [members, setMembers] = useState([]);

  const canWrite = profile.role === 'owner' || profile.role === 'editor';

  useEffect(() => { load(); }, [locationId]);

  const load = async () => {
    const [l, m, mods, lm, prj, ld] = await Promise.all([
      supabase.from('locations').select('*').eq('id', locationId).single(),
      supabase.from('profiles').select('id, email, display_name'),
      supabase.from('modules').select('*').order('sort_order'),
      supabase.from('location_modules').select('*').eq('location_id', locationId),
      supabase.from('crm_projects').select('*').eq('subject_type', 'location').eq('subject_id', locationId).order('created_at', { ascending: false }),
      supabase.from('leads').select('*').eq('location_id', locationId).order('created_at', { ascending: false }),
    ]);
    setLocation(l.data);
    setMembers(m.data || []);
    setModules(mods.data || []);
    setLocationModules(lm.data || []);
    setProjects(prj.data || []);
    setLeads(ld.data || []);
    if (l.data?.company_id) {
      const [c, d, ob] = await Promise.all([
        supabase.from('companies').select('id, name').eq('id', l.data.company_id).single(),
        supabase.from('deals').select('*').eq('company_id', l.data.company_id).order('created_at', { ascending: false }),
        supabase.from('onboardings').select('*').eq('company_id', l.data.company_id).order('created_at', { ascending: false }),
      ]);
      setCompany(c.data);
      setDeals(d.data || []);
      setOnboardings(ob.data || []);
    }
  };

  const startEdit = () => { setDraft({ ...location }); setEditing(true); };
  const save = async () => {
    const { id, created_at, updated_at, ...patch } = draft;
    await supabase.from('locations').update(patch).eq('id', locationId);
    setEditing(false); load();
  };
  const set = (k, v) => setDraft({ ...draft, [k]: v });

  // Unlink this location from its company (e.g. ownership changed). Keeps the
  // location + its history; only clears the company link.
  const unlinkCompany = async () => {
    if (!confirm(`Unlink "${location?.name}" from ${company?.name || 'this company'}?\n\nThe location and its history stay — only the company link is removed.`)) return;
    await supabase.from('locations').update({ company_id: null }).eq('id', locationId);
    load();
  };

  const deleteRecord = async () => {
    if (!confirm(`Delete location "${location?.name}"?\n\nThis cannot be undone.`)) return;
    await supabase.from('locations').delete().eq('id', locationId);
    onClose();
  };

  const createLinkedProject = async () => {
    const name = prompt(`Project name for ${location?.name}:`);
    if (!name?.trim()) return;
    const { data } = await supabase.from('crm_projects').insert({
      name: name.trim(),
      subject_type: 'location',
      subject_id: locationId,
      owner_id: profile.id,
    }).select().single();
    if (data) onNavigate?.('project', data.id);
    else load();
  };

  const ownerName = (id) => { const m = members.find(u => u.id === id); return m ? (m.display_name || m.email.split('@')[0]) : 'Unassigned'; };

  if (!location) return <div className="h-full flex items-center justify-center text-dim text-sm">Loading...</div>;

  const input = "w-full px-3 py-2 bg-card border border-bdr rounded text-sm text-paper placeholder-dim focus:outline-none focus:border-ember";
  const label = "text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-dim mb-1 block";

  const MODULE_STATUS = { quoted:'bg-slate-100 text-slate-600 border border-slate-200', included:'bg-blue-100 text-blue-700 border border-blue-200', enabling:'bg-orange-100 text-orange-700 border border-orange-200', live:'bg-emerald-100 text-emerald-700 border border-emerald-200', disabled:'bg-red-100 text-red-700 border border-red-200' };
  const DEAL_STAGES = { new_lead:'New Lead', contacted:'Contacted', qualified:'Qualified', demo_booked:'Demo Booked', demo_done:'Demo Done', proposal_sent:'Proposal', negotiation:'Negotiation', closed_won:'Won', closed_lost:'Lost' };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-6 py-5 border-b border-bdr flex items-center gap-4">
        <button onClick={onClose} className="text-muted hover:text-paper text-lg">&larr;</button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 mb-1.5">
            <div className="text-xl font-bold text-paper truncate">{location.name}</div>
            <span className={`badge-status ${STATUS_COLORS[location.status] || ''}`}>{location.status}</span>
            {primaryLead(leads) && <LeadBadge stage={primaryLead(leads).stage} full />}
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            {location.company_id && (
              <span className="badge-company inline-flex items-center gap-1.5">
                <span className="cursor-pointer" onClick={() => onNavigate?.('company', location.company_id)}>
                  {'\u{1F3E2}'} {company?.name || 'Unknown company'}
                </span>
                {canWrite && (
                  <button onClick={unlinkCompany} title="Unlink from company (e.g. ownership changed)"
                    className="text-red-500 hover:text-red-700 font-bold leading-none">×</button>
                )}
              </span>
            )}
            {location.venue_type && <span className="text-xs text-muted">{propertyTypeLabel(location.venue_type)}</span>}
            {location.covers && <span className="text-xs text-muted">{location.covers} covers</span>}
          </div>
        </div>
        {!editing && <TimerButton subjectType="location" subjectId={locationId} label={location.name} profile={profile} />}
        {!editing && location.phone && (
          <CallButton number={location.phone} className="px-3 py-2 text-sm" />
        )}
        {canWrite && !editing && (
          <div className="flex gap-2">
            <button onClick={() => onCreateLead?.({ locationId, companyId: location.company_id })} className="px-3 py-2 text-xs font-semibold rounded-xl bg-ember/15 text-ember-deep border border-ember/25 hover:bg-ember/25">+ Lead</button>
            <button onClick={startEdit} className="btn-ghost px-4 py-2 rounded-xl text-sm">Edit</button>
            {profile.role === 'owner' && (
              <button onClick={deleteRecord} className="px-3 py-2 text-xs text-red-600 border border-red-200 rounded-xl hover:bg-red-50 transition">Delete</button>
            )}
          </div>
        )}
      </div>

      {/* Card grid */}
      <div className="flex-1 overflow-y-auto p-6">
        {editing ? (
          <div className="max-w-4xl">
            <Card title="Edit Location">
              <div className="grid grid-cols-2 gap-3">
                <div><label className={label}>Name</label><input className={input} value={draft.name || ''} onChange={e => set('name', e.target.value)} /></div>
                <div><label className={label}>Status</label><select className={input} value={draft.status} onChange={e => set('status', e.target.value)}>
                  {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}</select></div>
                <div><label className={label}>Property type</label>
                  <select className={input} value={draft.venue_type || ''} onChange={e => set('venue_type', e.target.value)}>
                    <option value="">Select…</option>
                    {PROPERTY_TYPES.map(([v, lbl]) => <option key={v} value={v}>{lbl}</option>)}
                  </select></div>
                <div><label className={label}>Covers</label><input className={input} type="number" value={draft.covers || ''} onChange={e => set('covers', e.target.value ? parseInt(e.target.value) : null)} /></div>
                <div><label className={label}>Address</label><input className={input} value={draft.address || ''} onChange={e => set('address', e.target.value)} /></div>
                <div><label className={label}>City</label><input className={input} value={draft.city || ''} onChange={e => set('city', e.target.value)} /></div>
                <div><label className={label}>Postcode</label><input className={input} value={draft.postcode || ''} onChange={e => set('postcode', e.target.value)} /></div>
                <div><label className={label}>Phone</label><input className={input} value={draft.phone || ''} onChange={e => set('phone', e.target.value)} /></div>
                <div><label className={label}>Email</label><input className={input} value={draft.email || ''} onChange={e => set('email', e.target.value)} /></div>
                <div><label className={label}>Kickoff call</label><input className={input} type="datetime-local" value={(draft.kickoff_at || '').slice(0, 16)} onChange={e => set('kickoff_at', e.target.value || null)} /></div>
                <div><label className={label}>Expected install date</label><input className={input} type="date" value={draft.expected_install_date || ''} onChange={e => set('expected_install_date', e.target.value || null)} /></div>
                <div><label className={label}>Actual install date</label><input className={input} type="date" value={draft.actual_install_date || ''} onChange={e => set('actual_install_date', e.target.value || null)} /></div>
                <div><label className={label}>Go-live date</label><input className={input} type="date" value={draft.go_live_date || ''} onChange={e => set('go_live_date', e.target.value || null)} /></div>
                <div><label className={label}>Activation date</label><input className={input} type="date" value={draft.activation_date || ''} onChange={e => set('activation_date', e.target.value || null)} /></div>
                <div><label className={label}>Owner</label><select className={input} value={draft.owner_id || ''} onChange={e => set('owner_id', e.target.value || null)}>
                  <option value="">Unassigned</option>{members.map(m => <option key={m.id} value={m.id}>{m.display_name || m.email}</option>)}</select></div>
              </div>
              <div className="mt-3"><label className={label}>Notes</label><textarea className={input + ' resize-none'} rows={3} value={draft.notes || ''} onChange={e => set('notes', e.target.value)} /></div>
              <div className="flex gap-2 mt-4">
                <button onClick={save} className="px-5 py-2 bg-ember text-ink text-sm font-semibold rounded hover:bg-ember-deep">Save</button>
                <button onClick={() => setEditing(false)} className="px-4 py-2 text-sm text-muted border border-bdr rounded">Cancel</button>
              </div>
            </Card>
          </div>
        ) : (
          <div className="grid grid-cols-12 gap-4 max-w-[1400px]">

            {/* LEFT: Key Info */}
            <div className="col-span-4 space-y-4">
              <Card title="Key Info">
                <div className="space-y-3">
                  <Field label="Address" value={[location.address, location.city, location.postcode].filter(Boolean).join(', ')} />
                  <Field label="Property Type" value={propertyTypeLabel(location.venue_type)} />
                  <Field label="Status" value={location.status} badge={STATUS_COLORS[location.status]} />
                  <Field label="Owner" value={ownerName(location.owner_id)} />
                  {location.notes && <Field label="Notes" value={location.notes} />}
                </div>
              </Card>
            </div>

            {/* MIDDLE: Activity + Contacts */}
            <div className="col-span-4 space-y-4">
              <Card title="Activity">
                <ActivityTimeline subjectType="location" subjectId={locationId} profile={profile} contactEmail={location?.email} />
              </Card>

              <Card title="Contacts">
                <AssociationManager subjectType="location" subjectId={locationId} targetType="contact" profile={profile} onNavigate={onNavigate} />
              </Card>
            </div>

            {/* RIGHT: Deals + Onboardings + Projects */}
            <div className="col-span-4 space-y-4">
              <LeadsCard leads={leads} />
              <Card title="Deals">
                <AssociationManager subjectType="location" subjectId={locationId} targetType="deal" profile={profile} onNavigate={onNavigate} />
              </Card>

              <InvoicesCard locationId={locationId} profile={profile} onNavigate={onNavigate} />

              <Card title="Build Stages" count={onboardings.length}>
                {onboardings.length > 0 ? (
                  <div className="space-y-2">
                    {onboardings.map(o => (
                      <div key={o.id} onClick={() => onNavigate?.('onboarding', o.id)}
                        className="p-3 glass-inner rounded-xl cursor-pointer">
                        <div className="text-sm font-medium text-paper">Build Stage</div>
                        <div className="text-xs text-muted mt-0.5">{BUILD_STAGE_LABELS[o.stage] || o.stage}</div>
                      </div>
                    ))}
                  </div>
                ) : <Empty>No build stages</Empty>}
              </Card>

              <Card title="Projects" count={projects.length}
                action={canWrite ? { label: '+ Create', onClick: createLinkedProject } : null}>
                {projects.length > 0 ? (
                  <div className="space-y-2">
                    {projects.map(p => (
                      <div key={p.id} onClick={() => onNavigate?.('project', p.id)}
                        className="p-3 glass-inner rounded-xl cursor-pointer">
                        <div className="text-sm font-medium text-paper">{p.name}</div>
                        <div className="text-xs text-muted mt-0.5">{p.status}</div>
                      </div>
                    ))}
                  </div>
                ) : <Empty>No projects linked</Empty>}
              </Card>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Card({ title, count, action, children }) {
  return (
    <div className="glass-card rounded-2xl overflow-hidden">
      <div className="px-4 py-3 border-b border-bdr flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-bold text-paper">{title}</h3>
          {count !== undefined && <span className="text-xs text-dim font-mono">({count})</span>}
        </div>
        {action && <button onClick={action.onClick} className="text-xs text-ember hover:text-ember-deep font-medium">{action.label}</button>}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function Field({ label, value, badge }) {
  const display = value || <span className="text-dim italic">--</span>;
  return (
    <div>
      <div className="text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-dim mb-0.5">{label}</div>
      {badge ? (
        <span className={`px-2 py-0.5 text-xs font-bold uppercase rounded ${badge}`}>{value}</span>
      ) : (
        <div className="text-sm text-paper break-words">{display}</div>
      )}
    </div>
  );
}

function Empty({ children }) {
  return <div className="text-xs text-dim italic py-3 text-center">{children}</div>;
}
