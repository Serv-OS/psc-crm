import { useEffect, useState, useMemo } from 'react';
import { supabase } from '../../lib/supabase';

const STATUS_STYLES = {
  todo: 'bg-blue-500/20 text-blue-300',
  in_progress: 'bg-orange-500/20 text-orange-300',
  blocked: 'bg-red-500/20 text-red-300',
  done: 'bg-green-500/20 text-green-300',
};
const PRIORITY_STYLES = {
  P0: 'bg-red-500/20 text-red-300 border-red-500/30',
  P1: 'bg-orange-500/20 text-orange-300 border-orange-500/30',
  P2: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  P3: 'bg-slate-500/20 text-slate-300 border-slate-500/30',
};

export default function TaskList({ profile, onSelect }) {
  const [tasks, setTasks] = useState([]);
  const [members, setMembers] = useState([]);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState({ status: 'open', assignee: 'all', search: '' });
  const [showCreate, setShowCreate] = useState(false);
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState('P2');
  const [assignee, setAssignee] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [projectId, setProjectId] = useState('');

  const canWrite = profile.role === 'owner' || profile.role === 'editor';

  useEffect(() => { load(); }, []);

  const load = async () => {
    setLoading(true);
    const [t, m, p] = await Promise.all([
      supabase.from('tasks').select('*').is('parent_task_id', null).order('sort_order'),
      supabase.from('profiles').select('id, email, display_name'),
      supabase.from('crm_projects').select('id, name').eq('status', 'active').order('name'),
    ]);
    setTasks(t.data || []);
    setMembers(m.data || []);
    setProjects(p.data || []);
    setLoading(false);
  };

  const filtered = useMemo(() => {
    let result = tasks;
    if (filter.status === 'open') result = result.filter(t => t.status !== 'done');
    else if (filter.status !== 'all') result = result.filter(t => t.status === filter.status);
    if (filter.assignee === 'me') result = result.filter(t => t.owner_id === profile.id);
    if (filter.assignee === 'unassigned') result = result.filter(t => !t.owner_id);
    if (filter.search) {
      const q = filter.search.toLowerCase();
      result = result.filter(t => t.title.toLowerCase().includes(q));
    }
    return result;
  }, [tasks, filter, profile.id]);

  const ownerName = (id) => {
    const m = members.find(u => u.id === id);
    return m ? (m.display_name || m.email.split('@')[0]) : '';
  };

  const projectName = (id) => projects.find(p => p.id === id)?.name || '';

  const create = async (e) => {
    e.preventDefault();
    if (!title.trim()) return;
    const { data } = await supabase.from('tasks').insert({
      title: title.trim(),
      priority,
      owner_id: assignee || null,
      due_date: dueDate || null,
      project_id: projectId || null,
    }).select().single();
    setTitle(''); setPriority('P2'); setAssignee(''); setDueDate(''); setProjectId('');
    setShowCreate(false);
    if (data) onSelect(data.id);
    else load();
  };

  const toggleDone = async (e, task) => {
    e.stopPropagation();
    const newStatus = task.status === 'done' ? 'todo' : 'done';
    await supabase.from('tasks').update({
      status: newStatus,
      completed_at: newStatus === 'done' ? new Date().toISOString() : null,
    }).eq('id', task.id);
    load();
  };

  const isOverdue = (t) => t.due_date && t.status !== 'done' && new Date(t.due_date) < new Date();

  const input = "w-full px-3 py-2 bg-card border border-bdr rounded text-sm text-paper placeholder-dim focus:outline-none focus:border-ember";

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 py-4 border-b border-bdr flex items-center justify-between">
        <div>
          <div className="text-lg font-bold text-paper">Tasks</div>
          <div className="text-[10px] text-dim font-mono uppercase tracking-[0.18em]">
            {tasks.filter(t => t.status !== 'done').length} open / {tasks.filter(t => t.status === 'done').length} done
          </div>
        </div>
        {canWrite && (
          <button onClick={() => setShowCreate(true)}
            className="px-3 py-1.5 bg-ember text-ink text-sm font-semibold rounded hover:bg-ember-deep transition">
            + Add task
          </button>
        )}
      </div>

      <div className="px-6 py-3 border-b border-bdr flex items-center gap-2 flex-wrap">
        <input value={filter.search} onChange={e => setFilter({ ...filter, search: e.target.value })}
          placeholder="Search tasks..."
          className="px-3 py-1.5 bg-card border border-bdr rounded text-sm text-paper placeholder-dim focus:outline-none focus:border-ember w-56" />
        <select value={filter.status} onChange={e => setFilter({ ...filter, status: e.target.value })}
          className="px-2 py-1.5 bg-card border border-bdr rounded text-sm text-paper focus:outline-none focus:border-ember">
          <option value="open">Open</option>
          <option value="all">All</option>
          <option value="todo">To do</option>
          <option value="in_progress">In progress</option>
          <option value="blocked">Blocked</option>
          <option value="done">Done</option>
        </select>
        <select value={filter.assignee} onChange={e => setFilter({ ...filter, assignee: e.target.value })}
          className="px-2 py-1.5 bg-card border border-bdr rounded text-sm text-paper focus:outline-none focus:border-ember">
          <option value="all">Everyone</option>
          <option value="me">My tasks</option>
          <option value="unassigned">Unassigned</option>
        </select>
      </div>

      {showCreate && (
        <div className="px-6 py-3 border-b border-bdr">
          <form onSubmit={create} className="space-y-2">
            <div className="flex gap-2">
              <input className={input + ' flex-1'} value={title} onChange={e => setTitle(e.target.value)}
                placeholder="Task title" autoFocus />
              <select className="px-2 py-2 bg-card border border-bdr rounded text-sm text-paper" value={priority} onChange={e => setPriority(e.target.value)}>
                <option value="P0">P0</option><option value="P1">P1</option>
                <option value="P2">P2</option><option value="P3">P3</option>
              </select>
            </div>
            <div className="flex gap-2">
              <select className={input + ' w-40'} value={assignee} onChange={e => setAssignee(e.target.value)}>
                <option value="">Unassigned</option>
                {members.map(m => <option key={m.id} value={m.id}>{m.display_name || m.email}</option>)}
              </select>
              <input type="date" className={input + ' w-40'} value={dueDate} onChange={e => setDueDate(e.target.value)} />
              <select className={input + ' w-48'} value={projectId} onChange={e => setProjectId(e.target.value)}>
                <option value="">No project</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <button type="submit" className="px-4 py-2 bg-ember text-ink text-sm font-semibold rounded shrink-0">Create</button>
              <button type="button" onClick={() => setShowCreate(false)}
                className="px-3 py-2 text-sm text-muted border border-bdr rounded shrink-0">Cancel</button>
            </div>
          </form>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {loading && <div className="px-6 py-8 text-center text-dim text-sm">Loading...</div>}
        {!loading && filtered.map(t => (
          <div key={t.id}
            onClick={() => onSelect(t.id)}
            className="px-6 py-3 border-b border-bdr hover:bg-card/50 cursor-pointer transition flex items-center gap-3">
            {canWrite && (
              <button onClick={(e) => toggleDone(e, t)}
                className={`w-5 h-5 rounded border-2 shrink-0 flex items-center justify-center transition ${
                  t.status === 'done' ? 'bg-green-500/30 border-green-500 text-green-300' : 'border-bdr hover:border-ember'
                }`}>
                {t.status === 'done' && <span className="text-xs">&#x2713;</span>}
              </button>
            )}
            <div className="flex-1 min-w-0">
              <div className={`text-sm ${t.status === 'done' ? 'text-dim line-through' : 'text-paper'}`}>{t.title}</div>
              <div className="flex items-center gap-2 mt-0.5 text-xs text-dim">
                {projectName(t.project_id) && <span>{projectName(t.project_id)}</span>}
                {t.subject_type && <span>{t.subject_type}</span>}
              </div>
            </div>
            <span className={`px-1.5 py-0.5 text-[9px] font-bold rounded border ${PRIORITY_STYLES[t.priority]}`}>{t.priority}</span>
            <span className={`px-1.5 py-0.5 text-[9px] font-bold uppercase rounded ${STATUS_STYLES[t.status]}`}>{t.status.replace('_', ' ')}</span>
            {t.due_date && (
              <span className={`text-xs ${isOverdue(t) ? 'text-red-400 font-bold' : 'text-dim'}`}>
                {new Date(t.due_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
              </span>
            )}
            {t.owner_id && (
              <span className="w-6 h-6 rounded-full bg-ember text-ink text-[10px] font-bold flex items-center justify-center shrink-0"
                title={ownerName(t.owner_id)}>
                {ownerName(t.owner_id)[0]?.toUpperCase() || '?'}
              </span>
            )}
          </div>
        ))}
        {!loading && filtered.length === 0 && (
          <div className="px-6 py-8 text-center text-dim text-sm">
            {filter.search || filter.status !== 'open' || filter.assignee !== 'all'
              ? 'No tasks match your filters.' : 'No tasks yet.'}
          </div>
        )}
      </div>
    </div>
  );
}
