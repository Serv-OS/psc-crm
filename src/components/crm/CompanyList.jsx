import { useEffect, useState, useMemo } from 'react';
import { supabase } from '../../lib/supabase';

export default function CompanyList({ profile, onSelect }) {
  const [companies, setCompanies] = useState([]);
  const [locations, setLocations] = useState([]);
  const [members, setMembers] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const canWrite = profile.role === 'owner' || profile.role === 'editor';

  useEffect(() => { load(); }, []);

  const load = async () => {
    setLoading(true);
    const [c, l, m] = await Promise.all([
      supabase.from('companies').select('*').order('name'),
      supabase.from('locations').select('id, company_id, status'),
      supabase.from('profiles').select('id, email, display_name'),
    ]);
    setCompanies(c.data || []);
    setLocations(l.data || []);
    setMembers(m.data || []);
    setLoading(false);
  };

  const filtered = useMemo(() => {
    if (!search) return companies;
    const q = search.toLowerCase();
    return companies.filter(c =>
      c.name.toLowerCase().includes(q) ||
      (c.domain || '').toLowerCase().includes(q) ||
      (c.city || '').toLowerCase().includes(q)
    );
  }, [companies, search]);

  const locCount = (companyId) => locations.filter(l => l.company_id === companyId).length;
  const liveCount = (companyId) => locations.filter(l => l.company_id === companyId && l.status === 'live').length;
  const ownerName = (id) => {
    const m = members.find(u => u.id === id);
    return m ? (m.display_name || m.email.split('@')[0]) : '';
  };

  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');

  const create = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    const { data } = await supabase.from('companies').insert({
      name: name.trim(),
      domain: domain.trim() || null,
      owner_id: profile.id,
    }).select().single();
    setName(''); setDomain(''); setShowCreate(false);
    if (data) onSelect(data.id);
    else load();
  };

  const input = "w-full px-3 py-2 bg-card border border-bdr rounded text-sm text-paper placeholder-dim focus:outline-none focus:border-ember";

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 py-4 border-b border-bdr flex items-center justify-between">
        <div>
          <div className="text-lg font-bold text-paper">Companies</div>
          <div className="text-[10px] text-dim font-mono uppercase tracking-[0.18em]">
            {companies.length} companies / {locations.length} locations
          </div>
        </div>
        {canWrite && (
          <button onClick={() => setShowCreate(true)}
            className="px-3 py-1.5 bg-ember text-ink text-sm font-semibold rounded hover:bg-ember-deep transition">
            + Add company
          </button>
        )}
      </div>

      <div className="px-6 py-3 border-b border-bdr">
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search companies..."
          className="px-3 py-1.5 bg-card border border-bdr rounded text-sm text-paper placeholder-dim focus:outline-none focus:border-ember w-72" />
      </div>

      {showCreate && (
        <div className="px-6 py-3 border-b border-bdr">
          <form onSubmit={create} className="flex gap-2 items-end">
            <div className="flex-1">
              <input className={input} value={name} onChange={e => setName(e.target.value)}
                placeholder="Company name" autoFocus />
            </div>
            <div className="w-48">
              <input className={input} value={domain} onChange={e => setDomain(e.target.value)}
                placeholder="Domain (optional)" />
            </div>
            <button type="submit" className="px-4 py-2 bg-ember text-ink text-sm font-semibold rounded">Create</button>
            <button type="button" onClick={() => setShowCreate(false)}
              className="px-3 py-2 text-sm text-muted border border-bdr rounded">Cancel</button>
          </form>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-bdr text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-dim">
              <th className="px-6 py-2.5 text-left">Company</th>
              <th className="px-3 py-2.5 text-left">Domain</th>
              <th className="px-3 py-2.5 text-left">City</th>
              <th className="px-3 py-2.5 text-center">Locations</th>
              <th className="px-3 py-2.5 text-center">Live</th>
              <th className="px-3 py-2.5 text-left">Owner</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={6} className="px-6 py-8 text-center text-dim text-sm">Loading...</td></tr>
            )}
            {!loading && filtered.map(c => (
              <tr key={c.id}
                onClick={() => onSelect(c.id)}
                className="border-b border-bdr hover:bg-card/50 cursor-pointer transition">
                <td className="px-6 py-3">
                  <div className="text-sm text-paper font-medium">{c.name}</div>
                  {c.industry && <div className="text-xs text-dim">{c.industry}</div>}
                </td>
                <td className="px-3 py-3 text-xs text-muted">{c.domain || ''}</td>
                <td className="px-3 py-3 text-xs text-muted">{c.city || ''}</td>
                <td className="px-3 py-3 text-xs text-muted text-center">{locCount(c.id)}</td>
                <td className="px-3 py-3 text-xs text-center">
                  {liveCount(c.id) > 0
                    ? <span className="text-green-400">{liveCount(c.id)}</span>
                    : <span className="text-dim">0</span>}
                </td>
                <td className="px-3 py-3 text-xs text-muted">{ownerName(c.owner_id)}</td>
              </tr>
            ))}
            {!loading && filtered.length === 0 && (
              <tr><td colSpan={6} className="px-6 py-8 text-center text-dim text-sm">
                {search ? 'No companies match your search.' : 'No companies yet. Add one to get started.'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
