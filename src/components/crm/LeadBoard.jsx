import { useEffect, useState, useMemo } from 'react';
import { supabase } from '../../lib/supabase';

const STAGES = [
  { key: 'lead', label: 'New Lead', color: '#3b82f6' },
  { key: 'mql', label: 'Marketing Qualified', color: '#8b5cf6' },
  { key: 'sql', label: 'Sales Qualified', color: '#E8743C' },
];

const SOURCE_OPTIONS = ['website', 'referral', 'cold_outreach', 'event', 'social', 'inbound_call', 'inbound_email', 'other'];

export default function LeadBoard({ profile, onNavigate }) {
  const [companies, setCompanies] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [locations, setLocations] = useState([]);
  const [members, setMembers] = useState([]);
  const [associations, setAssociations] = useState([]);
  const [viewMode, setViewMode] = useState('board');
  const [showCreate, setShowCreate] = useState(false);
  const [newCompany, setNewCompany] = useState('');
  const [newContact, setNewContact] = useState({ first_name: '', last_name: '', email: '', phone: '' });
  const [newLocation, setNewLocation] = useState('');
  const [newSource, setNewSource] = useState('website');
  const [dragItem, setDragItem] = useState(null);

  const canWrite = profile.role === 'owner' || profile.role === 'editor';

  useEffect(() => { load(); }, []);

  const load = async () => {
    const [c, ct, l, m, a] = await Promise.all([
      supabase.from('companies').select('*').neq('lead_status', 'none').neq('lead_status', 'customer').neq('lead_status', 'deal_created').order('became_lead_at', { ascending: false }),
      supabase.from('contacts').select('*').neq('lead_status', 'none').neq('lead_status', 'customer').neq('lead_status', 'deal_created').order('became_lead_at', { ascending: false }),
      supabase.from('locations').select('*').order('name'),
      supabase.from('profiles').select('id, email, display_name'),
      supabase.from('associations').select('*'),
    ]);
    setCompanies(c.data || []);
    setContacts(ct.data || []);
    setLocations(l.data || []);
    setMembers(m.data || []);
    setAssociations(a.data || []);
  };

  // Build lead cards: one card per company (primary) with its contacts and locations
  const leads = useMemo(() => {
    const cards = [];

    // Companies as leads
    companies.forEach(co => {
      const coContacts = contacts.filter(ct => {
        return associations.some(a =>
          (a.from_type === 'contact' && a.from_id === ct.id && a.to_type === 'company' && a.to_id === co.id) ||
          (a.to_type === 'contact' && a.to_id === ct.id && a.from_type === 'company' && a.from_id === co.id)
        );
      });
      const coLocations = locations.filter(l => l.company_id === co.id);
      cards.push({
        id: co.id,
        type: 'company',
        name: co.name,
        stage: co.lead_status,
        source: co.lead_source,
        owner_id: co.owner_id,
        became_lead_at: co.became_lead_at,
        contacts: coContacts,
        locations: coLocations,
        domain: co.domain,
        record: co,
      });
    });

    // Contacts as leads that aren't linked to a lead company
    contacts.forEach(ct => {
      const linkedToLeadCompany = companies.some(co =>
        associations.some(a =>
          (a.from_type === 'contact' && a.from_id === ct.id && a.to_type === 'company' && a.to_id === co.id) ||
          (a.to_type === 'contact' && a.to_id === ct.id && a.from_type === 'company' && a.from_id === co.id)
        )
      );
      if (!linkedToLeadCompany) {
        cards.push({
          id: ct.id,
          type: 'contact',
          name: [ct.first_name, ct.last_name].filter(Boolean).join(' ') || ct.email,
          stage: ct.lead_status,
          source: ct.lead_source,
          owner_id: ct.owner_id,
          became_lead_at: ct.became_lead_at,
          contacts: [ct],
          locations: [],
          domain: null,
          record: ct,
        });
      }
    });

    return cards;
  }, [companies, contacts, locations, associations]);

  const leadsByStage = useMemo(() => {
    const map = {};
    STAGES.forEach(s => { map[s.key] = []; });
    leads.forEach(l => { if (map[l.stage]) map[l.stage].push(l); });
    return map;
  }, [leads]);

  const ownerName = (id) => {
    const m = members.find(u => u.id === id);
    return m ? (m.display_name || m.email.split('@')[0]) : '';
  };

  const moveStage = async (lead, toStage) => {
    if (lead.stage === toStage) return;
    const table = lead.type === 'company' ? 'companies' : 'contacts';
    await supabase.from(table).update({ lead_status: toStage }).eq('id', lead.id);
    load();
  };

  const convertToDeal = async (lead) => {
    const companyId = lead.type === 'company' ? lead.id : null;

    // Create deal
    const { data: deal } = await supabase.from('deals').insert({
      name: `Deal: ${lead.name}`,
      company_id: companyId,
      owner_id: lead.owner_id || profile.id,
      source: lead.source,
    }).select().single();

    if (deal) {
      // Write stage history
      await supabase.from('stage_history').insert({
        object_type: 'deal', object_id: deal.id, from_stage: null, to_stage: 'new_lead', changed_by: profile.id,
      });

      // Link contacts to deal
      for (const ct of lead.contacts) {
        await supabase.from('associations').insert({
          from_type: 'deal', from_id: deal.id, to_type: 'contact', to_id: ct.id, label: 'primary_contact',
        });
      }

      // Link locations to deal
      for (const loc of lead.locations) {
        await supabase.from('associations').insert({
          from_type: 'deal', from_id: deal.id, to_type: 'location', to_id: loc.id, label: 'affected_location',
        });
      }

      // Update lead status
      const table = lead.type === 'company' ? 'companies' : 'contacts';
      await supabase.from(table).update({ lead_status: 'deal_created' }).eq('id', lead.id);

      onNavigate?.('deal', deal.id);
    }
  };

  const createLead = async (e) => {
    e.preventDefault();
    if (!newCompany.trim()) return;

    // Create company as lead
    const { data: company } = await supabase.from('companies').insert({
      name: newCompany.trim(),
      lead_status: 'lead',
      lead_source: newSource,
      became_lead_at: new Date().toISOString(),
      owner_id: profile.id,
    }).select().single();

    if (company) {
      // Create contact if provided
      if (newContact.first_name || newContact.email) {
        const { data: contact } = await supabase.from('contacts').insert({
          first_name: newContact.first_name.trim() || null,
          last_name: newContact.last_name.trim() || null,
          email: newContact.email.trim() || null,
          phone: newContact.phone.trim() || null,
          lead_status: 'lead',
          lead_source: newSource,
          became_lead_at: new Date().toISOString(),
          owner_id: profile.id,
        }).select().single();

        if (contact) {
          await supabase.from('associations').insert({
            from_type: 'contact', from_id: contact.id, to_type: 'company', to_id: company.id, label: 'primary_contact',
          });
        }
      }

      // Create location if provided
      if (newLocation.trim()) {
        await supabase.from('locations').insert({
          company_id: company.id, name: newLocation.trim(), lead_status: 'lead', owner_id: profile.id,
        });
      }
    }

    setNewCompany(''); setNewContact({ first_name: '', last_name: '', email: '', phone: '' });
    setNewLocation(''); setNewSource('website'); setShowCreate(false);
    load();
  };

  const onDragStart = (e, lead) => { setDragItem(lead); e.dataTransfer.effectAllowed = 'move'; };
  const onDragOver = (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; };
  const onDrop = (e, stageKey) => {
    e.preventDefault();
    if (dragItem) moveStage(dragItem, stageKey);
    setDragItem(null);
  };

  const input = "w-full px-3 py-2 bg-card border border-bdr rounded-xl text-sm text-paper placeholder-dim focus:outline-none focus:border-ember";
  const label = "text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-dim mb-1 block";

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 py-4 border-b border-bdr flex items-center justify-between">
        <div>
          <div className="text-lg font-bold text-paper">Leads</div>
          <div className="text-[10px] text-dim font-mono uppercase tracking-[0.18em]">
            {leads.length} leads / {leadsByStage.lead?.length || 0} new / {leadsByStage.sql?.length || 0} qualified
          </div>
        </div>
        <div className="flex gap-2">
          <div className="flex bg-card border border-bdr rounded-xl">
            <button onClick={() => setViewMode('board')}
              className={`px-3 py-1 text-xs rounded-xl ${viewMode === 'board' ? 'text-paper bg-ink-soft' : 'text-muted'}`}>Board</button>
            <button onClick={() => setViewMode('list')}
              className={`px-3 py-1 text-xs rounded-xl ${viewMode === 'list' ? 'text-paper bg-ink-soft' : 'text-muted'}`}>List</button>
          </div>
          {canWrite && (
            <button onClick={() => setShowCreate(true)}
              className="px-3 py-1.5 bg-ember text-white text-sm font-semibold rounded-xl hover:bg-ember-deep transition">+ Add lead</button>
          )}
        </div>
      </div>

      {showCreate && (
        <div className="px-6 py-4 border-b border-bdr">
          <form onSubmit={createLead} className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className={label}>Company name *</label>
                <input className={input} value={newCompany} onChange={e => setNewCompany(e.target.value)} placeholder="Restaurant name" autoFocus />
              </div>
              <div>
                <label className={label}>Location name</label>
                <input className={input} value={newLocation} onChange={e => setNewLocation(e.target.value)} placeholder="Venue name (optional)" />
              </div>
              <div>
                <label className={label}>Source</label>
                <select className={input} value={newSource} onChange={e => setNewSource(e.target.value)}>
                  {SOURCE_OPTIONS.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-4 gap-3">
              <div><label className={label}>First name</label><input className={input} value={newContact.first_name} onChange={e => setNewContact({ ...newContact, first_name: e.target.value })} /></div>
              <div><label className={label}>Last name</label><input className={input} value={newContact.last_name} onChange={e => setNewContact({ ...newContact, last_name: e.target.value })} /></div>
              <div><label className={label}>Email</label><input className={input} value={newContact.email} onChange={e => setNewContact({ ...newContact, email: e.target.value })} /></div>
              <div><label className={label}>Phone</label><input className={input} value={newContact.phone} onChange={e => setNewContact({ ...newContact, phone: e.target.value })} /></div>
            </div>
            <div className="flex gap-2">
              <button type="submit" className="px-4 py-2 bg-ember text-white text-sm font-semibold rounded-xl">Create lead</button>
              <button type="button" onClick={() => setShowCreate(false)} className="px-4 py-2 text-sm text-muted border border-bdr rounded-xl">Cancel</button>
            </div>
          </form>
        </div>
      )}

      {viewMode === 'board' ? (
        <div className="flex-1 overflow-x-auto overflow-y-hidden">
          <div className="h-full flex gap-3 px-4 py-3 min-w-max">
            {STAGES.map(stage => (
              <div key={stage.key}
                className="w-72 shrink-0 flex flex-col glass-card rounded-2xl overflow-hidden"
                onDragOver={onDragOver} onDrop={e => onDrop(e, stage.key)}>
                <div className="px-3 py-2.5 border-b border-bdr" style={{ borderLeftColor: stage.color, borderLeftWidth: 3 }}>
                  <div className="text-[10px] font-bold uppercase tracking-wide text-paper">{stage.label}</div>
                  <div className="text-[9px] text-dim font-mono">{leadsByStage[stage.key]?.length || 0}</div>
                </div>
                <div className="flex-1 overflow-y-auto p-1.5 space-y-1.5">
                  {(leadsByStage[stage.key] || []).map(lead => (
                    <div key={lead.id}
                      draggable={canWrite}
                      onDragStart={e => onDragStart(e, lead)}
                      onClick={() => onNavigate?.(lead.type, lead.id)}
                      className="glass-inner rounded-2xl p-3 cursor-pointer">
                      <div className="text-sm font-semibold text-paper mb-1">{lead.name}</div>
                      {lead.domain && <div className="text-[10px] text-muted mb-1">{lead.domain}</div>}

                      {lead.contacts.length > 0 && (
                        <div className="space-y-0.5 mb-1.5">
                          {lead.contacts.slice(0, 2).map(ct => (
                            <div key={ct.id} className="text-[10px] text-muted">
                              {'\u{1F464}'} {[ct.first_name, ct.last_name].filter(Boolean).join(' ')}
                              {ct.email && <span className="text-dim"> {ct.email}</span>}
                            </div>
                          ))}
                        </div>
                      )}

                      {lead.locations.length > 0 && (
                        <div className="text-[10px] text-muted mb-1.5">
                          {'\u{1F4CD}'} {lead.locations.map(l => l.name).join(', ')}
                        </div>
                      )}

                      <div className="flex items-center gap-2">
                        {lead.source && <span className="px-1.5 py-0.5 text-[8px] bg-slate-100 text-slate-600 border border-slate-200 rounded">{lead.source.replace(/_/g, ' ')}</span>}
                        {stage.key === 'sql' && canWrite && (
                          <button onClick={(e) => { e.stopPropagation(); convertToDeal(lead); }}
                            className="ml-auto px-2 py-0.5 text-[9px] font-bold bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-lg hover:bg-emerald-200">
                            Convert to Deal
                          </button>
                        )}
                        {lead.owner_id && (
                          <span className="ml-auto w-5 h-5 rounded-full bg-ember text-white text-[9px] font-bold flex items-center justify-center"
                            title={ownerName(lead.owner_id)}>
                            {ownerName(lead.owner_id)[0]?.toUpperCase() || '?'}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}

            {/* Converted column (read-only) */}
            <div className="w-56 shrink-0 flex flex-col glass-card rounded-2xl overflow-hidden opacity-60">
              <div className="px-3 py-2.5 border-b border-bdr" style={{ borderLeftColor: '#10b981', borderLeftWidth: 3 }}>
                <div className="text-[10px] font-bold uppercase tracking-wide text-paper">Converted to Deal</div>
              </div>
              <div className="flex-1 overflow-y-auto p-2 text-xs text-dim text-center py-8">
                Leads that become deals move here automatically
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-bdr text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-dim">
                <th className="px-6 py-2.5 text-left">Name</th>
                <th className="px-3 py-2.5 text-left">Type</th>
                <th className="px-3 py-2.5 text-left">Stage</th>
                <th className="px-3 py-2.5 text-left">Source</th>
                <th className="px-3 py-2.5 text-left">Contact</th>
                <th className="px-3 py-2.5 text-left">Owner</th>
                <th className="px-3 py-2.5 text-left">Created</th>
                <th className="px-3 py-2.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {leads.map(lead => (
                <tr key={lead.id} onClick={() => onNavigate?.(lead.type, lead.id)}
                  className="border-b border-bdr hover:bg-card/50 cursor-pointer transition">
                  <td className="px-6 py-3 text-sm text-paper font-medium">{lead.name}</td>
                  <td className="px-3 py-3 text-xs text-muted capitalize">{lead.type}</td>
                  <td className="px-3 py-3">
                    <span className={`px-1.5 py-0.5 text-[9px] font-bold uppercase rounded ${
                      lead.stage === 'lead' ? 'bg-blue-100 text-blue-700' :
                      lead.stage === 'mql' ? 'bg-purple-100 text-purple-700' :
                      'bg-orange-100 text-orange-700'
                    }`}>{STAGES.find(s => s.key === lead.stage)?.label || lead.stage}</span>
                  </td>
                  <td className="px-3 py-3 text-xs text-muted">{lead.source?.replace(/_/g, ' ') || ''}</td>
                  <td className="px-3 py-3 text-xs text-muted">
                    {lead.contacts[0] ? [lead.contacts[0].first_name, lead.contacts[0].last_name].filter(Boolean).join(' ') : ''}
                  </td>
                  <td className="px-3 py-3 text-xs text-muted">{ownerName(lead.owner_id)}</td>
                  <td className="px-3 py-3 text-xs text-dim">
                    {lead.became_lead_at ? new Date(lead.became_lead_at).toLocaleDateString('en-GB', { day:'numeric', month:'short' }) : ''}
                  </td>
                  <td className="px-3 py-3 text-right">
                    {lead.stage === 'sql' && canWrite && (
                      <button onClick={(e) => { e.stopPropagation(); convertToDeal(lead); }}
                        className="px-2 py-1 text-[10px] font-bold bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-lg hover:bg-emerald-200">
                        Convert
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {leads.length === 0 && (
                <tr><td colSpan={8} className="px-6 py-8 text-center text-dim text-sm">No leads yet. Add one to get started.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
