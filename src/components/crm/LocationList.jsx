import { useEffect, useState, useMemo } from 'react';
import { supabase } from '../../lib/supabase';
import LeadBadge from './LeadBadge.jsx';
import { primaryLead, LEAD_STAGES } from '../../lib/leadStages';
import { ListContainer, RecordCard, CardHead, Chip, ChipRow } from './cardKit.jsx';

const STATUS_COLORS = {
  prospect: 'bg-blue-100 text-blue-700 border border-blue-200',
  onboarding: 'bg-orange-100 text-orange-700 border border-orange-200',
  live: 'bg-emerald-100 text-emerald-700 border border-emerald-200',
  churned: 'bg-red-100 text-red-700 border border-red-200',
};

export default function LocationList({ profile, onSelect, onNavigate }) {
  const [locations, setLocations] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [leads, setLeads] = useState([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [leadFilter, setLeadFilter] = useState('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => { load(); }, []);

  const load = async () => {
    setLoading(true);
    const [l, c, ld] = await Promise.all([
      supabase.from('locations').select('*').order('name'),
      supabase.from('companies').select('id, name'),
      supabase.from('leads').select('id, location_id, stage, name'),
    ]);
    setLocations(l.data || []);
    setCompanies(c.data || []);
    setLeads(ld.data || []);
    setLoading(false);
  };

  const leadFor = (locationId) => primaryLead(leads.filter(l => l.location_id === locationId));

  const filtered = useMemo(() => {
    let result = locations;
    if (statusFilter !== 'all') result = result.filter(l => l.status === statusFilter);
    if (leadFilter !== 'all') {
      result = result.filter(l => {
        const pl = leadFor(l.id);
        if (leadFilter === 'any') return !!pl;
        if (leadFilter === 'none') return !pl;
        return pl?.stage === leadFilter;
      });
    }
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(l =>
        l.name.toLowerCase().includes(q) ||
        (l.city || '').toLowerCase().includes(q) ||
        (companies.find(c => c.id === l.company_id)?.name || '').toLowerCase().includes(q)
      );
    }
    return result;
  }, [locations, companies, leads, search, statusFilter, leadFilter]);

  const companyName = (id) => companies.find(c => c.id === id)?.name || '';

  const counts = useMemo(() => {
    const m = { prospect: 0, onboarding: 0, live: 0, churned: 0 };
    locations.forEach(l => { if (m[l.status] !== undefined) m[l.status]++; });
    return m;
  }, [locations]);

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 py-4 border-b border-bdr">
        <div className="text-lg font-bold text-paper">Locations</div>
        <div className="text-[10px] text-dim font-mono uppercase tracking-[0.18em]">
          {locations.length} total / {counts.live} live / {counts.onboarding} onboarding / {counts.prospect} prospect
        </div>
      </div>

      <div className="px-6 py-3 border-b border-bdr flex items-center gap-2">
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search locations..."
          className="px-3 py-1.5 bg-card border border-bdr rounded text-sm text-paper placeholder-dim focus:outline-none focus:border-ember w-72" />
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          className="px-2 py-1.5 bg-card border border-bdr rounded text-sm text-paper focus:outline-none focus:border-ember">
          <option value="all">All statuses</option>
          <option value="prospect">Prospect</option>
          <option value="onboarding">Onboarding</option>
          <option value="live">Live</option>
          <option value="churned">Churned</option>
        </select>
        <select value={leadFilter} onChange={e => setLeadFilter(e.target.value)}
          className="px-2 py-1.5 bg-card border border-bdr rounded text-sm text-paper focus:outline-none focus:border-ember">
          <option value="all">All leads</option>
          <option value="any">Has a lead</option>
          <option value="none">No lead</option>
          {LEAD_STAGES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
      </div>

      <ListContainer>
        {loading && <div className="py-8 text-center text-dim text-sm">Loading...</div>}
        {!loading && filtered.length === 0 && (
          <div className="py-8 text-center text-dim text-sm">{search || statusFilter !== 'all' ? 'No locations match your filters.' : 'No locations yet.'}</div>
        )}
        {!loading && filtered.map(l => {
          const lead = leadFor(l.id);
          return (
            <RecordCard key={l.id} onClick={() => onSelect(l.id)}>
              <CardHead title={l.name} badge={
                <span className="flex items-center gap-1.5">
                  {lead && <LeadBadge stage={lead.stage} />}
                  <span className={`px-2 py-0.5 text-[9px] font-bold uppercase rounded ${STATUS_COLORS[l.status] || 'bg-card text-dim'}`}>{l.status}</span>
                </span>
              } />
              <ChipRow>
                <Chip tone="slate" icon={'\u{1F3E2}'}>{companyName(l.company_id)}</Chip>
                <Chip icon={'\u{1F4CD}'}>{l.city}</Chip>
                <Chip>{l.venue_type}</Chip>
                <Chip>{l.covers ? `${l.covers} covers` : ''}</Chip>
              </ChipRow>
            </RecordCard>
          );
        })}
      </ListContainer>
    </div>
  );
}
