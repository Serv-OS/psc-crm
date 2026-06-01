import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import AssociationManager from './AssociationManager.jsx';
import ActivityTimeline from './ActivityTimeline.jsx';

const STATUS_COLORS = {
  prospect: 'bg-blue-500/20 text-blue-300',
  onboarding: 'bg-orange-500/20 text-orange-300',
  live: 'bg-green-500/20 text-green-300',
  churned: 'bg-red-500/20 text-red-300',
};

export default function CompanyDetail({ companyId, profile, onClose, onNavigate }) {
  const [company, setCompany] = useState(null);
  const [locations, setLocations] = useState([]);
  const [deals, setDeals] = useState([]);
  const [onboardings, setOnboardings] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({});
  const [members, setMembers] = useState([]);

  const canWrite = profile.role === 'owner' || profile.role === 'editor';

  useEffect(() => { load(); }, [companyId]);

  const load = async () => {
    const [c, l, m, d, ob, t] = await Promise.all([
      supabase.from('companies').select('*').eq('id', companyId).single(),
      supabase.from('locations').select('*').eq('company_id', companyId).order('name'),
      supabase.from('profiles').select('id, email, display_name'),
      supabase.from('deals').select('*').eq('company_id', companyId).order('created_at', { ascending: false }),
      supabase.from('onboardings').select('*').eq('company_id', companyId).order('created_at', { ascending: false }),
      supabase.from('tickets').select('*').eq('company_id', companyId).order('created_at', { ascending: false }),
    ]);
    setCompany(c.data);
    setLocations(l.data || []);
    setMembers(m.data || []);
    setDeals(d.data || []);
    setOnboardings(ob.data || []);
    setTickets(t.data || []);
  };

  const startEdit = () => { setDraft({ ...company }); setEditing(true); };
  const save = async () => {
    const { id, created_at, updated_at, ...patch } = draft;
    await supabase.from('companies').update(patch).eq('id', companyId);
    setEditing(false); load();
  };
  const set = (k, v) => setDraft({ ...draft, [k]: v });

  const addLocation = async () => {
    const name = prompt('Location name:');
    if (!name?.trim()) return;
    await supabase.from('locations').insert({ company_id: companyId, name: name.trim(), owner_id: profile.id });
    load();
  };

  if (!company) return <div className="h-full flex items-center justify-center text-dim text-sm">Loading...</div>;

  const ownerName = (id) => { const m = members.find(u => u.id === id); return m ? (m.display_name || m.email.split('@')[0]) : 'Unassigned'; };

  const input = "w-full px-3 py-2 bg-card border border-bdr rounded text-sm text-paper placeholder-dim focus:outline-none focus:border-ember";
  const label = "text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-dim mb-1 block";

  const DEAL_STAGES = { new_lead:'New Lead', contacted:'Contacted', qualified:'Qualified', demo_booked:'Demo Booked', demo_done:'Demo Done', proposal_sent:'Proposal', negotiation:'Negotiation', closed_won:'Won', closed_lost:'Lost' };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-6 py-4 border-b border-bdr flex items-center gap-3">
        <button onClick={onClose} className="text-muted hover:text-paper text-lg">&larr;</button>
        <div className="flex-1 min-w-0">
          <div className="text-xl font-bold text-paper truncate">{company.name}</div>
          <div className="text-xs text-muted mt-0.5">
            {company.domain && <span className="text-ember">{company.domain}</span>}
            {company.domain && ' / '}
            {locations.length} location{locations.length !== 1 ? 's' : ''}
            {' / '}Owner: {ownerName(company.owner_id)}
          </div>
        </div>
        {canWrite && !editing && (
          <button onClick={startEdit} className="px-4 py-2 bg-card border border-bdr rounded text-sm text-muted hover:text-paper transition">Edit</button>
        )}
      </div>

      {/* Card grid - everything visible at once */}
      <div className="flex-1 overflow-y-auto p-6">
        {editing ? (
          <div className="max-w-4xl">
            <Card title="Edit Company">
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

            {/* LEFT COLUMN: Key Info + Locations */}
            <div className="col-span-4 space-y-4">

              <Card title="Key Info">
                <div className="space-y-3">
                  <Field label="Phone" value={company.phone} />
                  <Field label="Email" value={company.email} />
                  <Field label="Website" value={company.website} link />
                  <Field label="Industry" value={company.industry} />
                  <Field label="Address" value={[company.address, company.city, company.postcode].filter(Boolean).join(', ')} />
                  <Field label="Employees" value={company.employee_count} />
                  <Field label="Source" value={company.source} />
                  <Field label="Owner" value={ownerName(company.owner_id)} />
                  {company.notes && <Field label="Notes" value={company.notes} />}
                </div>
              </Card>

              <Card title="Locations" count={locations.length}
                action={canWrite ? { label: '+ Add', onClick: addLocation } : null}>
                {locations.length > 0 ? (
                  <div className="space-y-2">
                    {locations.map(l => (
                      <div key={l.id} onClick={() => onNavigate?.('location', l.id)}
                        className="flex items-center gap-3 p-3 bg-ink-soft border border-bdr rounded-lg cursor-pointer hover:border-ember transition">
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-paper">{l.name}</div>
                          <div className="text-xs text-muted">{[l.venue_type, l.city].filter(Boolean).join(' / ')}</div>
                        </div>
                        <span className={`px-2 py-0.5 text-[10px] font-bold uppercase rounded ${STATUS_COLORS[l.status] || 'bg-card text-dim'}`}>{l.status}</span>
                      </div>
                    ))}
                  </div>
                ) : <Empty>No locations yet</Empty>}
              </Card>
            </div>

            {/* MIDDLE COLUMN: Activity + Contacts */}
            <div className="col-span-4 space-y-4">

              <Card title="Activity">
                <ActivityTimeline subjectType="company" subjectId={companyId} profile={profile} />
              </Card>

              <Card title="Contacts">
                <AssociationManager subjectType="company" subjectId={companyId} targetType="contact" profile={profile} onNavigate={onNavigate} />
              </Card>
            </div>

            {/* RIGHT COLUMN: Deals + Onboardings + Tickets */}
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
                ) : <Empty>No deals yet</Empty>}
              </Card>

              <Card title="Onboardings" count={onboardings.length}>
                {onboardings.length > 0 ? (
                  <div className="space-y-2">
                    {onboardings.map(o => (
                      <div key={o.id} onClick={() => onNavigate?.('onboarding', o.id)}
                        className="p-3 bg-ink-soft border border-bdr rounded-lg cursor-pointer hover:border-ember transition">
                        <div className="text-sm font-medium text-paper">Onboarding</div>
                        <div className="text-xs text-muted mt-0.5">{o.stage.replace(/_/g, ' ')}</div>
                      </div>
                    ))}
                  </div>
                ) : <Empty>No onboardings</Empty>}
              </Card>

              <Card title="Tickets" count={tickets.length}>
                {tickets.length > 0 ? (
                  <div className="space-y-2">
                    {tickets.slice(0, 5).map(t => (
                      <div key={t.id} onClick={() => onNavigate?.('ticket', t.id)}
                        className="p-3 bg-ink-soft border border-bdr rounded-lg cursor-pointer hover:border-ember transition">
                        <div className="text-sm text-paper">{t.subject}</div>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-[10px] text-muted uppercase">{t.stage.replace(/_/g, ' ')}</span>
                          <span className="text-[10px] font-bold text-dim">{t.priority}</span>
                        </div>
                      </div>
                    ))}
                    {tickets.length > 5 && <div className="text-xs text-muted text-center py-1">+{tickets.length - 5} more</div>}
                  </div>
                ) : <Empty>No tickets</Empty>}
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
        {action && (
          <button onClick={action.onClick} className="text-xs text-ember hover:text-ember-deep font-medium">{action.label}</button>
        )}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function Field({ label, value, link }) {
  const display = value || <span className="text-dim italic">--</span>;
  return (
    <div>
      <div className="text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-dim mb-0.5">{label}</div>
      <div className="text-sm text-paper break-words">
        {link && value ? <a href={value.startsWith('http') ? value : `https://${value}`} target="_blank" rel="noopener noreferrer" className="text-ember hover:underline">{value}</a> : display}
      </div>
    </div>
  );
}

function Empty({ children }) {
  return <div className="text-xs text-dim italic py-3 text-center">{children}</div>;
}
