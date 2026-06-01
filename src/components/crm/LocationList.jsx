import { useEffect, useState, useMemo } from 'react';
import { supabase } from '../../lib/supabase';

const STATUS_COLORS = {
  prospect: 'bg-blue-500/20 text-blue-300',
  onboarding: 'bg-orange-500/20 text-orange-300',
  live: 'bg-green-500/20 text-green-300',
  churned: 'bg-red-500/20 text-red-300',
};

export default function LocationList({ profile, onSelect, onNavigate }) {
  const [locations, setLocations] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => { load(); }, []);

  const load = async () => {
    setLoading(true);
    const [l, c] = await Promise.all([
      supabase.from('locations').select('*').order('name'),
      supabase.from('companies').select('id, name'),
    ]);
    setLocations(l.data || []);
    setCompanies(c.data || []);
    setLoading(false);
  };

  const filtered = useMemo(() => {
    let result = locations;
    if (statusFilter !== 'all') result = result.filter(l => l.status === statusFilter);
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(l =>
        l.name.toLowerCase().includes(q) ||
        (l.city || '').toLowerCase().includes(q) ||
        (companies.find(c => c.id === l.company_id)?.name || '').toLowerCase().includes(q)
      );
    }
    return result;
  }, [locations, companies, search, statusFilter]);

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
      </div>

      <div className="flex-1 overflow-y-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-bdr text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-dim">
              <th className="px-6 py-2.5 text-left">Location</th>
              <th className="px-3 py-2.5 text-left">Company</th>
              <th className="px-3 py-2.5 text-left">City</th>
              <th className="px-3 py-2.5 text-left">Type</th>
              <th className="px-3 py-2.5 text-center">Covers</th>
              <th className="px-3 py-2.5 text-left">Status</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={6} className="px-6 py-8 text-center text-dim text-sm">Loading...</td></tr>
            )}
            {!loading && filtered.map(l => (
              <tr key={l.id}
                onClick={() => onSelect(l.id)}
                className="border-b border-bdr hover:bg-card/50 cursor-pointer transition">
                <td className="px-6 py-3 text-sm text-paper font-medium">{l.name}</td>
                <td className="px-3 py-3 text-xs text-ember cursor-pointer hover:underline"
                  onClick={(e) => { e.stopPropagation(); onNavigate?.('company', l.company_id); }}>
                  {companyName(l.company_id)}
                </td>
                <td className="px-3 py-3 text-xs text-muted">{l.city || ''}</td>
                <td className="px-3 py-3 text-xs text-muted">{l.venue_type || ''}</td>
                <td className="px-3 py-3 text-xs text-muted text-center">{l.covers || ''}</td>
                <td className="px-3 py-3">
                  <span className={`px-1.5 py-0.5 text-[9px] font-bold uppercase rounded ${STATUS_COLORS[l.status] || 'bg-card text-dim'}`}>
                    {l.status}
                  </span>
                </td>
              </tr>
            ))}
            {!loading && filtered.length === 0 && (
              <tr><td colSpan={6} className="px-6 py-8 text-center text-dim text-sm">
                {search || statusFilter !== 'all' ? 'No locations match your filters.' : 'No locations yet.'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
