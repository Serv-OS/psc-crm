import { useEffect, useState, useMemo } from 'react';
import { supabase } from '../../lib/supabase';

export default function ProjectList({ profile, onSelect }) {
  const [projects, setProjects] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('active');
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  const canWrite = profile.role === 'owner' || profile.role === 'editor';

  useEffect(() => { load(); }, []);

  const load = async () => {
    setLoading(true);
    const [p, t, m] = await Promise.all([
      supabase.from('crm_projects').select('*').order('created_at', { ascending: false }),
      supabase.from('tasks').select('id, project_id, status'),
      supabase.from('profiles').select('id, email, display_name'),
    ]);
    setProjects(p.data || []);
    setTasks(t.data || []);
    setMembers(m.data || []);
    setLoading(false);
  };

  const filtered = useMemo(() => {
    if (filter === 'all') return projects;
    return projects.filter(p => p.status === filter);
  }, [projects, filter]);

  const taskStats = (projectId) => {
    const pt = tasks.filter(t => t.project_id === projectId);
    return { total: pt.length, done: pt.filter(t => t.status === 'done').length };
  };

  const ownerName = (id) => {
    const m = members.find(u => u.id === id);
    return m ? (m.display_name || m.email.split('@')[0]) : '';
  };

  const create = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    const { data } = await supabase.from('crm_projects').insert({
      name: name.trim(),
      description: description.trim() || null,
      owner_id: profile.id,
    }).select().single();
    setName(''); setDescription(''); setShowCreate(false);
    if (data) onSelect(data.id);
    else load();
  };

  const STATUS_BADGE = {
    active: 'bg-green-500/20 text-green-300',
    completed: 'bg-blue-500/20 text-blue-300',
    cancelled: 'bg-red-500/20 text-red-300',
  };

  const input = "w-full px-3 py-2 bg-card border border-bdr rounded text-sm text-paper placeholder-dim focus:outline-none focus:border-ember";

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 py-4 border-b border-bdr flex items-center justify-between">
        <div>
          <div className="text-lg font-bold text-paper">Projects</div>
          <div className="text-[10px] text-dim font-mono uppercase tracking-[0.18em]">
            {projects.filter(p => p.status === 'active').length} active / {projects.length} total
          </div>
        </div>
        {canWrite && (
          <button onClick={() => setShowCreate(true)}
            className="px-3 py-1.5 bg-ember text-ink text-sm font-semibold rounded hover:bg-ember-deep transition">
            + New project
          </button>
        )}
      </div>

      <div className="px-6 py-3 border-b border-bdr flex gap-2">
        {['active', 'completed', 'cancelled', 'all'].map(s => (
          <button key={s} onClick={() => setFilter(s)}
            className={`px-2 py-1 text-xs rounded ${filter === s ? 'bg-card text-paper' : 'text-muted hover:text-paper'}`}>
            {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      {showCreate && (
        <div className="px-6 py-3 border-b border-bdr">
          <form onSubmit={create} className="space-y-2">
            <input className={input} value={name} onChange={e => setName(e.target.value)}
              placeholder="Project name" autoFocus />
            <div className="flex gap-2">
              <input className={input + ' flex-1'} value={description} onChange={e => setDescription(e.target.value)}
                placeholder="Description (optional)" />
              <button type="submit" className="px-4 py-2 bg-ember text-ink text-sm font-semibold rounded shrink-0">Create</button>
              <button type="button" onClick={() => setShowCreate(false)}
                className="px-3 py-2 text-sm text-muted border border-bdr rounded shrink-0">Cancel</button>
            </div>
          </form>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-4xl space-y-2">
          {loading && <div className="py-8 text-center text-dim text-sm">Loading...</div>}
          {!loading && filtered.map(p => {
            const stats = taskStats(p.id);
            const pct = stats.total ? Math.round((stats.done / stats.total) * 100) : 0;
            return (
              <div key={p.id}
                onClick={() => onSelect(p.id)}
                className="bg-card/50 border border-bdr rounded-xl p-4 cursor-pointer hover:border-dim transition">
                <div className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-paper">{p.name}</div>
                    {p.description && <div className="text-xs text-muted mt-0.5 truncate">{p.description}</div>}
                  </div>
                  <span className={`px-1.5 py-0.5 text-[9px] font-bold uppercase rounded ${STATUS_BADGE[p.status]}`}>{p.status}</span>
                  {p.owner_id && <span className="text-xs text-dim">{ownerName(p.owner_id)}</span>}
                </div>
                {stats.total > 0 && (
                  <div className="mt-3 flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-ink rounded-full overflow-hidden">
                      <div className="h-full bg-ember rounded-full transition-all" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-[10px] text-dim font-mono">{stats.done}/{stats.total}</span>
                  </div>
                )}
              </div>
            );
          })}
          {!loading && filtered.length === 0 && (
            <div className="py-8 text-center text-dim text-sm">No projects found.</div>
          )}
        </div>
      </div>
    </div>
  );
}
