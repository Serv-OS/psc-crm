import { useEffect, useState, useMemo } from 'react';
import { supabase } from '../../lib/supabase';
import LeadBadge from './LeadBadge.jsx';
import { primaryLead, LEAD_STAGES } from '../../lib/leadStages';

export default function CompanyList({ profile, onSelect }) {
  const [companies, setCompanies] = useState([]);
  const [locations, setLocations] = useState([]);
  const [members, setMembers] = useState([]);
  const [leads, setLeads] = useState([]);
  const [search, setSearch] = useState('');
  const [leadFilter, setLeadFilter] = useState('all');
  const [loading, setLoading] = useState(true);

  const canWrite = profile.role === 'owner' || profile.role === 'editor';

  useEffect(() => { load(); }, []);

  const load = async () => {
    setLoading(true);
    const [c, l, m, ld] = await Promise.all([
      supabase.from('companies').select('*').order('name'),
      supabase.from('locations').select('id, company_id, status'),
      supabase.from('profiles').select('id, email, display_name'),
      supabase.from('leads').select('id, company_id, stage, name'),
    ]);
    setCompanies(c.data || []);
    setLocations(l.data || []);
    setMembers(m.data || []);
    setLeads(ld.data || []);
    setLoading(false);
  };

  const leadFor = (companyId) => primaryLead(leads.filter(l => l.company_id === companyId));

  const filtered = useMemo(() => {
    let result = companies;
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
        c.name.toLowerCase().includes(q) ||
        (c.domain || '').toLowerCase().includes(q) ||
        (c.city || '').toLowerCase().includes(q)
      );
    }
    return result;
  }, [companies, leads, search, leadFilter]);

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

      <div className="px-6 py-3 border-b border-bdr flex items-center gap-2">
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search companies..."
          className="px-3 py-1.5 bg-card border border-bdr rounded text-sm text-paper placeholder-dim focus:outline-none focus:border-ember w-72" />
        <select value={leadFilter} onChange={e => setLeadFilter(e.target.value)}
          className="px-2 py-1.5 bg-card border border-bdr rounded text-sm text-paper focus:outline-none focus:border-ember">
          <option value="all">All companies</option>
          <option value="any">Has a lead</option>
          <option value="none">No lead</option>
          {LEAD_STAGES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
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
        {/* Mobile cards */}
        <div className="sm:hidden divide-y divide-bdr">
          {loading && <div className="px-4 py-8 text-center text-dim text-sm">Loading...</div>}
          {!loading && filtered.length === 0 && <div className="px-4 py-8 text-center text-dim text-sm">{search ? 'No companies match.' : 'No companies yet.'}</div>}
          {!loading && filtered.map(c => (
            <button key={c.id} onClick={() => onSelect(c.id)} className="w-full text-left px-4 py-3 active:bg-card/50">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-sm text-paper font-medium flex-1 min-w-0 truncate">{c.name}</span>
                {leadFor(c.id) && <LeadBadge stage={leadFor(c.id).stage} />}
              </div>
              <div className="text-xs text-muted truncate">{[c.domain, c.city].filter(Boolean).join(' · ')}</div>
              <div className="text-[10px] text-dim">{locCount(c.id)} location{locCount(c.id) !== 1 ? 's' : ''} · {liveCount(c.id)} live · {ownerName(c.owner_id)}</div>
            </button>
          ))}
        </div>

        <table className="w-full hidden sm:table">
          <thead>
            <tr className="border-b border-bdr text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-dim">
              <th className="px-6 py-2.5 text-left">Company</th>
              <th className="px-3 py-2.5 text-left">Lead</th>
              <th className="px-3 py-2.5 text-left">Domain</th>
              <th className="px-3 py-2.5 text-left">City</th>
              <th className="px-3 py-2.5 text-center">Locations</th>
              <th className="px-3 py-2.5 text-center">Live</th>
              <th className="px-3 py-2.5 text-left">Owner</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={7} className="px-6 py-8 text-center text-dim text-sm">Loading...</td></tr>
            )}
            {!loading && filtered.map(c => (
              <tr key={c.id}
                onClick={() => onSelect(c.id)}
                className="border-b border-bdr hover:bg-card/50 cursor-pointer transition">
                <td className="px-6 py-3">
                  <div className="text-sm text-paper font-medium">{c.name}</div>
                  {c.industry && <div className="text-xs text-dim">{c.industry}</div>}
                </td>
                <td className="px-3 py-3">
                  {leadFor(c.id) ? <LeadBadge stage={leadFor(c.id).stage} /> : <span className="text-dim text-xs">--</span>}
                </td>
                <td className="px-3 py-3 text-xs text-muted">{c.domain || ''}</td>
                <td className="px-3 py-3 text-xs text-muted">{c.city || ''}</td>
                <td className="px-3 py-3 text-xs text-muted text-center">{locCount(c.id)}</td>
                <td className="px-3 py-3 text-xs text-center">
                  {liveCount(c.id) > 0
                    ? <span className="text-emerald-600">{liveCount(c.id)}</span>
                    : <span className="text-dim">0</span>}
                </td>
                <td className="px-3 py-3 text-xs text-muted">{ownerName(c.owner_id)}</td>
              </tr>
            ))}
            {!loading && filtered.length === 0 && (
              <tr><td colSpan={7} className="px-6 py-8 text-center text-dim text-sm">
                {search ? 'No companies match your search.' : 'No companies yet. Add one to get started.'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
