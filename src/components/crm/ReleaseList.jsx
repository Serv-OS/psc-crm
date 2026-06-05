import { useEffect, useState, useMemo } from 'react';
import { supabase } from '../../lib/supabase';

const STATUS_STYLES = {
  planned: 'bg-blue-100 text-blue-700 border border-blue-200',
  in_dev: 'bg-orange-100 text-orange-700 border border-orange-200',
  released: 'bg-emerald-100 text-emerald-700 border border-emerald-200',
};

export default function ReleaseList({ profile, onSelect }) {
  const [releases, setReleases] = useState([]);
  const [backlogItems, setBacklogItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [showCreate, setShowCreate] = useState(false);
  const [version, setVersion] = useState('');
  const [name, setName] = useState('');
  const [product, setProduct] = useState('pos');

  const canWrite = profile.role === 'owner' || profile.role === 'editor';

  useEffect(() => { load(); }, []);

  const load = async () => {
    setLoading(true);
    const [r, bi] = await Promise.all([
      supabase.from('releases').select('*').order('created_at', { ascending: false }),
      supabase.from('backlog_items').select('id, target_release_id, released_in_release_id, type'),
    ]);
    setReleases(r.data || []);
    setBacklogItems(bi.data || []);
    setLoading(false);
  };

  const filtered = useMemo(() => {
    if (filter === 'all') return releases;
    return releases.filter(r => r.status === filter);
  }, [releases, filter]);

  const itemCounts = (releaseId) => {
    const targeted = backlogItems.filter(i => i.target_release_id === releaseId);
    const shipped = backlogItems.filter(i => i.released_in_release_id === releaseId);
    return { targeted: targeted.length, shipped: shipped.length,
      bugs: targeted.filter(i => i.type === 'bug').length,
      features: targeted.filter(i => i.type === 'feature').length };
  };

  const create = async (e) => {
    e.preventDefault();
    if (!version.trim()) return;
    const { data } = await supabase.from('releases').insert({
      product, version: version.trim(), name: name.trim() || null,
    }).select().single();
    setVersion(''); setName(''); setProduct('pos'); setShowCreate(false);
    if (data) onSelect(data.id);
    else load();
  };

  const input = "w-full px-3 py-2 bg-card border border-bdr rounded text-sm text-paper placeholder-dim focus:outline-none focus:border-ember";

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 py-4 border-b border-bdr flex items-center justify-between">
        <div>
          <div className="text-lg font-bold text-paper">Releases</div>
          <div className="text-[10px] text-dim font-mono uppercase tracking-[0.18em]">
            {releases.filter(r => r.status === 'released').length} released / {releases.filter(r => r.status === 'in_dev').length} in dev / {releases.filter(r => r.status === 'planned').length} planned
          </div>
        </div>
        {canWrite && (
          <button onClick={() => setShowCreate(true)}
            className="px-3 py-1.5 bg-ember text-ink text-sm font-semibold rounded hover:bg-ember-deep transition">+ New release</button>
        )}
      </div>

      <div className="px-6 py-3 border-b border-bdr flex gap-2">
        {['all', 'planned', 'in_dev', 'released'].map(s => (
          <button key={s} onClick={() => setFilter(s)}
            className={`px-2 py-1 text-xs rounded ${filter === s ? 'bg-card text-paper' : 'text-muted hover:text-paper'}`}>
            {s === 'all' ? 'All' : s === 'in_dev' ? 'In Dev' : s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      {showCreate && (
        <div className="px-6 py-3 border-b border-bdr max-h-[70vh] overflow-y-auto">
          <form onSubmit={create} className="flex gap-2 items-end">
            <select className="px-2 py-2 bg-card border border-bdr rounded text-sm text-paper" value={product} onChange={e => setProduct(e.target.value)}>
              <option value="pos">POS</option><option value="crm">CRM</option>
            </select>
            <input className={input + ' w-32'} value={version} onChange={e => setVersion(e.target.value)} placeholder="e.g. 4.6.70" autoFocus />
            <input className={input + ' flex-1'} value={name} onChange={e => setName(e.target.value)} placeholder="Release name (optional)" />
            <button type="submit" className="px-4 py-2 bg-ember text-ink text-sm font-semibold rounded">Create</button>
            <button type="button" onClick={() => setShowCreate(false)} className="px-3 py-2 text-sm text-muted border border-bdr rounded">Cancel</button>
          </form>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-4xl space-y-2">
          {loading && <div className="py-8 text-center text-dim text-sm">Loading...</div>}
          {!loading && filtered.map(r => {
            const counts = itemCounts(r.id);
            return (
              <div key={r.id} onClick={() => onSelect(r.id)}
                className="bg-card/50 border border-bdr rounded-xl p-4 cursor-pointer hover:border-dim transition">
                <div className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-mono font-bold text-ember uppercase">{r.product}</span>
                      <span className="text-sm font-bold text-paper">{r.version}</span>
                      {r.name && <span className="text-sm text-muted">{r.name}</span>}
                    </div>
                    {r.released_at && (
                      <div className="text-xs text-dim mt-0.5">
                        Released {new Date(r.released_at).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' })}
                      </div>
                    )}
                  </div>
                  <span className={`px-1.5 py-0.5 text-[9px] font-bold uppercase rounded ${STATUS_STYLES[r.status]}`}>{r.status === 'in_dev' ? 'In Dev' : r.status}</span>
                  {counts.targeted > 0 && (
                    <div className="text-right">
                      <div className="text-xs text-paper font-mono">{counts.targeted} items</div>
                      <div className="text-[9px] text-dim">{counts.bugs} bugs / {counts.features} features</div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {!loading && filtered.length === 0 && <div className="py-8 text-center text-dim text-sm">No releases.</div>}
        </div>
      </div>
    </div>
  );
}
