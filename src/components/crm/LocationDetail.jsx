import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import AssociationManager from './AssociationManager.jsx';
import ActivityTimeline from './ActivityTimeline.jsx';

const STATUS_OPTIONS = ['prospect', 'onboarding', 'live', 'churned'];
const STATUS_COLORS = {
  prospect: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  onboarding: 'bg-orange-500/20 text-orange-300 border-orange-500/30',
  live: 'bg-green-500/20 text-green-300 border-green-500/30',
  churned: 'bg-red-500/20 text-red-300 border-red-500/30',
};

export default function LocationDetail({ locationId, profile, onClose, onNavigate }) {
  const [location, setLocation] = useState(null);
  const [company, setCompany] = useState(null);
  const [deals, setDeals] = useState([]);
  const [onboardings, setOnboardings] = useState([]);
  const [locationModules, setLocationModules] = useState([]);
  const [modules, setModules] = useState([]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({});
  const [members, setMembers] = useState([]);

  const canWrite = profile.role === 'owner' || profile.role === 'editor';

  useEffect(() => { load(); }, [locationId]);

  const load = async () => {
    const [l, m, mods, lm] = await Promise.all([
      supabase.from('locations').select('*').eq('id', locationId).single(),
      supabase.from('profiles').select('id, email, display_name'),
      supabase.from('modules').select('*').order('sort_order'),
      supabase.from('location_modules').select('*').eq('location_id', locationId),
    ]);
    setLocation(l.data);
    setMembers(m.data || []);
    setModules(mods.data || []);
    setLocationModules(lm.data || []);
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

  const ownerName = (id) => { const m = members.find(u => u.id === id); return m ? (m.display_name || m.email.split('@')[0]) : 'Unassigned'; };

  if (!location) return <div className="h-full flex items-center justify-center text-dim text-sm">Loading...</div>;

  const input = "w-full px-3 py-2 bg-card border border-bdr rounded text-sm text-paper placeholder-dim focus:outline-none focus:border-ember";
  const label = "text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-dim mb-1 block";

  const MODULE_STATUS = { quoted:'bg-slate-500/20 text-slate-300', included:'bg-blue-500/20 text-blue-300', enabling:'bg-orange-500/20 text-orange-300', live:'bg-green-500/20 text-green-300', disabled:'bg-red-500/20 text-red-300' };
  const DEAL_STAGES = { new_lead:'New Lead', contacted:'Contacted', qualified:'Qualified', demo_booked:'Demo Booked', demo_done:'Demo Done', proposal_sent:'Proposal', negotiation:'Negotiation', closed_won:'Won', closed_lost:'Lost' };
  const OB_STAGES = { kickoff:'Kickoff', hardware_ordered:'HW Ordered', hardware_shipped:'HW Shipped', account_menu_config:'Config', staff_training:'Training', go_live_scheduled:'Go-Live', live:'Live', handover_to_support:'Handover' };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-6 py-4 border-b border-bdr flex items-center gap-3">
        <button onClick={onClose} className="text-muted hover:text-paper text-lg">&larr;</button>
        <div className="flex-1 min-w-0">
          <div className="text-xl font-bold text-paper truncate">{location.name}</div>
          <div className="text-xs text-muted mt-0.5">
            <span className="text-ember cursor-pointer hover:underline" onClick={() => onNavigate?.('company', location.company_id)}>{company?.name}</span>
            {' / '}{location.venue_type || 'No type'}
            {' / '}<span className={`px-1.5 py-0.5 text-[10px] font-bold uppercase rounded ${STATUS_COLORS[location.status] || ''}`}>{location.status}</span>
          </div>
        </div>
        {canWrite && !editing && (
          <button onClick={startEdit} className="px-4 py-2 bg-card border border-bdr rounded text-sm text-muted hover:text-paper transition">Edit</button>
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
                <div><label className={label}>Venue type</label><input className={input} value={draft.venue_type || ''} onChange={e => set('venue_type', e.target.value)} placeholder="restaurant, bar, cafe..." /></div>
                <div><label className={label}>Covers</label><input className={input} type="number" value={draft.covers || ''} onChange={e => set('covers', e.target.value ? parseInt(e.target.value) : null)} /></div>
                <div><label className={label}>Address</label><input className={input} value={draft.address || ''} onChange={e => set('address', e.target.value)} /></div>
                <div><label className={label}>City</label><input className={input} value={draft.city || ''} onChange={e => set('city', e.target.value)} /></div>
                <div><label className={label}>Postcode</label><input className={input} value={draft.postcode || ''} onChange={e => set('postcode', e.target.value)} /></div>
                <div><label className={label}>Phone</label><input className={input} value={draft.phone || ''} onChange={e => set('phone', e.target.value)} /></div>
                <div><label className={label}>Email</label><input className={input} value={draft.email || ''} onChange={e => set('email', e.target.value)} /></div>
                <div><label className={label}>Go-live date</label><input className={input} type="date" value={draft.go_live_date || ''} onChange={e => set('go_live_date', e.target.value || null)} /></div>
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

            {/* LEFT: Key Info + Modules */}
            <div className="col-span-4 space-y-4">
              <Card title="Key Info">
                <div className="space-y-3">
                  <Field label="Address" value={[location.address, location.city, location.postcode].filter(Boolean).join(', ')} />
                  <Field label="Phone" value={location.phone} />
                  <Field label="Email" value={location.email} />
                  <Field label="Venue Type" value={location.venue_type} />
                  <Field label="Covers" value={location.covers} />
                  <Field label="Status" value={location.status} badge={STATUS_COLORS[location.status]} />
                  <Field label="Go-live Date" value={location.go_live_date ? new Date(location.go_live_date).toLocaleDateString('en-GB') : null} />
                  <Field label="Owner" value={ownerName(location.owner_id)} />
                  {location.notes && <Field label="Notes" value={location.notes} />}
                </div>
              </Card>

              <Card title="Modules" count={locationModules.length}>
                {locationModules.length > 0 ? (
                  <div className="space-y-1.5">
                    {locationModules.map(lm => {
                      const mod = modules.find(m => m.id === lm.module_id);
                      return (
                        <div key={lm.id} className="flex items-center justify-between py-1.5 px-3 bg-ink-soft border border-bdr rounded-lg">
                          <span className="text-sm text-paper">{mod?.name || 'Unknown'}</span>
                          <span className={`px-2 py-0.5 text-[10px] font-bold uppercase rounded ${MODULE_STATUS[lm.status] || ''}`}>{lm.status}</span>
                        </div>
                      );
                    })}
                  </div>
                ) : <Empty>No modules enabled</Empty>}
              </Card>
            </div>

            {/* MIDDLE: Activity + Contacts */}
            <div className="col-span-4 space-y-4">
              <Card title="Activity">
                <ActivityTimeline subjectType="location" subjectId={locationId} profile={profile} />
              </Card>

              <Card title="Contacts">
                <AssociationManager subjectType="location" subjectId={locationId} targetType="contact" profile={profile} onNavigate={onNavigate} />
              </Card>
            </div>

            {/* RIGHT: Deals + Onboardings + Projects */}
            <div className="col-span-4 space-y-4">
              <Card title="Deals" count={deals.length}>
                {deals.length > 0 ? (
                  <div className="space-y-2">
                    {deals.map(d => (
                      <div key={d.id} onClick={() => onNavigate?.('deal', d.id)}
                        className="p-3 bg-ink-soft border border-bdr rounded-lg cursor-pointer hover:border-ember transition">
                        <div className="text-sm font-medium text-paper">{d.name}</div>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-xs text-ember font-mono font-bold">{d.value ? `£${Number(d.value).toLocaleString()}` : ''}</span>
                          <span className="text-[10px] text-muted uppercase">{DEAL_STAGES[d.stage] || d.stage}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : <Empty>No deals</Empty>}
              </Card>

              <Card title="Onboardings" count={onboardings.length}>
                {onboardings.length > 0 ? (
                  <div className="space-y-2">
                    {onboardings.map(o => (
                      <div key={o.id} onClick={() => onNavigate?.('onboarding', o.id)}
                        className="p-3 bg-ink-soft border border-bdr rounded-lg cursor-pointer hover:border-ember transition">
                        <div className="text-sm font-medium text-paper">Onboarding</div>
                        <div className="text-xs text-muted mt-0.5">{OB_STAGES[o.stage] || o.stage}</div>
                      </div>
                    ))}
                  </div>
                ) : <Empty>No onboardings</Empty>}
              </Card>

              <Card title="Projects">
                <Empty>Link projects from the Projects view</Empty>
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
