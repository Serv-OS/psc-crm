import { useEffect, useState, useMemo } from 'react';
import { supabase } from '../../lib/supabase';
import LeadBadge from './LeadBadge.jsx';
import { primaryLead, LEAD_STAGES } from '../../lib/leadStages';
import { ListContainer, RecordCard, CardHead, Chip, ChipRow } from './cardKit.jsx';

export default function ContactList({ profile, onSelect }) {
  const [contacts, setContacts] = useState([]);
  const [associations, setAssociations] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [leads, setLeads] = useState([]);
  const [search, setSearch] = useState('');
  const [leadFilter, setLeadFilter] = useState('all');
  const [loading, setLoading] = useState(true);

  const canWrite = profile.role === 'owner' || profile.role === 'editor';

  useEffect(() => { load(); }, []);

  const load = async () => {
    setLoading(true);
    const [c, a, co, ld] = await Promise.all([
      supabase.from('contacts').select('*').order('last_name'),
      supabase.from('associations').select('*').eq('from_type', 'contact'),
      supabase.from('companies').select('id, name'),
      supabase.from('leads').select('id, contact_id, stage, name'),
    ]);
    setContacts(c.data || []);
    setAssociations(a.data || []);
    setCompanies(co.data || []);
    setLeads(ld.data || []);
    setLoading(false);
  };

  const leadFor = (contactId) => primaryLead(leads.filter(l => l.contact_id === contactId));

  const filtered = useMemo(() => {
    let result = contacts;
    if (leadFilter !== 'all') {
      result = result.filter(c => {
        const pl = leadFor(c.id);
        if (leadFilter === 'any') return !!pl;
        if (leadFilter === 'none') return !pl;
        return pl?.stage === leadFilter;
      });
    }
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(c =>
        (c.first_name || '').toLowerCase().includes(q) ||
        (c.last_name || '').toLowerCase().includes(q) ||
        (c.email || '').toLowerCase().includes(q) ||
        (c.phone || '').toLowerCase().includes(q)
      );
    }
    return result;
  }, [contacts, leads, search, leadFilter]);

  const getCompanyNames = (contactId) => {
    const linked = associations
      .filter(a => a.from_id === contactId && a.to_type === 'company')
      .map(a => companies.find(c => c.id === a.to_id)?.name)
      .filter(Boolean);
    return linked.join(', ');
  };

  const [showCreate, setShowCreate] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');

  const create = async (e) => {
    e.preventDefault();
    if (!firstName.trim() && !email.trim()) return;
    const { data } = await supabase.from('contacts').insert({
      first_name: firstName.trim() || null,
      last_name: lastName.trim() || null,
      email: email.trim() || null,
      owner_id: profile.id,
    }).select().single();
    setFirstName(''); setLastName(''); setEmail(''); setShowCreate(false);
    if (data) onSelect(data.id);
    else load();
  };

  const input = "w-full px-3 py-2 bg-card border border-bdr rounded text-sm text-paper placeholder-dim focus:outline-none focus:border-ember";

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 py-4 border-b border-bdr flex items-center justify-between">
        <div>
          <div className="text-lg font-bold text-paper">Contacts</div>
          <div className="text-[10px] text-dim font-mono uppercase tracking-[0.18em]">{contacts.length} contacts</div>
        </div>
        {canWrite && (
          <button onClick={() => setShowCreate(true)}
            className="px-3 py-1.5 bg-ember text-ink text-sm font-semibold rounded hover:bg-ember-deep transition">
            + Add contact
          </button>
        )}
      </div>

      <div className="px-6 py-3 border-b border-bdr flex items-center gap-2">
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search contacts..."
          className="px-3 py-1.5 bg-card border border-bdr rounded text-sm text-paper placeholder-dim focus:outline-none focus:border-ember w-72" />
        <select value={leadFilter} onChange={e => setLeadFilter(e.target.value)}
          className="px-2 py-1.5 bg-card border border-bdr rounded text-sm text-paper focus:outline-none focus:border-ember">
          <option value="all">All contacts</option>
          <option value="any">Has a lead</option>
          <option value="none">No lead</option>
          {LEAD_STAGES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
      </div>

      {showCreate && (
        <div className="px-6 py-3 border-b border-bdr">
          <form onSubmit={create} className="flex gap-2 items-end">
            <div className="w-40"><input className={input} value={firstName} onChange={e => setFirstName(e.target.value)} placeholder="First name" autoFocus /></div>
            <div className="w-40"><input className={input} value={lastName} onChange={e => setLastName(e.target.value)} placeholder="Last name" /></div>
            <div className="flex-1"><input className={input} value={email} onChange={e => setEmail(e.target.value)} placeholder="Email" type="email" /></div>
            <button type="submit" className="px-4 py-2 bg-ember text-ink text-sm font-semibold rounded">Create</button>
            <button type="button" onClick={() => setShowCreate(false)} className="px-3 py-2 text-sm text-muted border border-bdr rounded">Cancel</button>
          </form>
        </div>
      )}

      <ListContainer>
        {loading && <div className="py-8 text-center text-dim text-sm">Loading...</div>}
        {!loading && filtered.length === 0 && (
          <div className="py-8 text-center text-dim text-sm">{search ? 'No contacts match your search.' : 'No contacts yet.'}</div>
        )}
        {!loading && filtered.map(c => {
          const lead = leadFor(c.id);
          const fullName = [c.first_name, c.last_name].filter(Boolean).join(' ') || 'No name';
          return (
            <RecordCard key={c.id} onClick={() => onSelect(c.id)}>
              <CardHead title={fullName} subtitle={c.job_title} badge={lead && <LeadBadge stage={lead.stage} />} />
              <ChipRow>
                <Chip icon={'\u{1F4E7}'}>{c.email}</Chip>
                <Chip icon={'\u{1F4F1}'}>{c.phone}</Chip>
                <Chip tone="slate" icon={'\u{1F3E2}'}>{getCompanyNames(c.id)}</Chip>
              </ChipRow>
            </RecordCard>
          );
        })}
      </ListContainer>
    </div>
  );
}
