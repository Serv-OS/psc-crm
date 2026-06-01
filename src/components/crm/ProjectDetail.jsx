import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

const STATUS_STYLES = {
  todo: 'bg-blue-500/20 text-blue-300',
  in_progress: 'bg-orange-500/20 text-orange-300',
  blocked: 'bg-red-500/20 text-red-300',
  done: 'bg-green-500/20 text-green-300',
};

export default function ProjectDetail({ projectId, profile, onClose, onSelectTask }) {
  const [project, setProject] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [members, setMembers] = useState([]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({});
  const [newTask, setNewTask] = useState('');
  const [newPriority, setNewPriority] = useState('P2');

  const canWrite = profile.role === 'owner' || profile.role === 'editor';

  useEffect(() => { load(); }, [projectId]);

  const load = async () => {
    const [p, t, m] = await Promise.all([
      supabase.from('crm_projects').select('*').eq('id', projectId).single(),
      supabase.from('tasks').select('*').eq('project_id', projectId).is('parent_task_id', null).order('sort_order'),
      supabase.from('profiles').select('id, email, display_name'),
    ]);
    setProject(p.data);
    setTasks(t.data || []);
    setMembers(m.data || []);
  };

  const startEdit = () => { setDraft({ ...project }); setEditing(true); };

  const save = async () => {
    const { id, created_at, updated_at, ...patch } = draft;
    await supabase.from('crm_projects').update(patch).eq('id', projectId);
    setEditing(false);
    load();
  };

  const set = (k, v) => setDraft({ ...draft, [k]: v });

  const addTask = async (e) => {
    e.preventDefault();
    if (!newTask.trim()) return;
    await supabase.from('tasks').insert({
      title: newTask.trim(),
      project_id: projectId,
      priority: newPriority,
      sort_order: tasks.length,
    });
    setNewTask('');
    load();
  };

  const toggleTask = async (task) => {
    const newStatus = task.status === 'done' ? 'todo' : 'done';
    await supabase.from('tasks').update({
      status: newStatus,
      completed_at: newStatus === 'done' ? new Date().toISOString() : null,
    }).eq('id', task.id);
    load();
  };

  if (!project) return <div className="h-full flex items-center justify-center text-dim text-sm">Loading...</div>;

  const ownerName = (id) => {
    const m = members.find(u => u.id === id);
    return m ? (m.display_name || m.email.split('@')[0]) : '';
  };

  const openTasks = tasks.filter(t => t.status !== 'done');
  const doneTasks = tasks.filter(t => t.status === 'done');
  const pct = tasks.length ? Math.round((doneTasks.length / tasks.length) * 100) : 0;

  const input = "w-full px-3 py-2 bg-card border border-bdr rounded text-sm text-paper placeholder-dim focus:outline-none focus:border-ember";
  const label = "text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-dim mb-1 block";

  const PROJECT_STATUSES = ['active', 'completed', 'cancelled'];

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 py-4 border-b border-bdr flex items-center gap-3">
        <button onClick={onClose} className="text-muted hover:text-paper text-sm">&larr;</button>
        <div className="flex-1 min-w-0">
          <div className="text-lg font-bold text-paper truncate">{project.name}</div>
          <div className="text-[10px] text-dim font-mono uppercase tracking-[0.18em]">
            {project.status} / {doneTasks.length}/{tasks.length} tasks done ({pct}%)
          </div>
        </div>
        {canWrite && !editing && (
          <button onClick={startEdit} className="px-3 py-1.5 bg-card border border-bdr rounded text-xs text-muted hover:text-paper">Edit</button>
        )}
      </div>

      {/* Progress bar */}
      {tasks.length > 0 && (
        <div className="px-6 py-2 border-b border-bdr">
          <div className="h-2 bg-ink rounded-full overflow-hidden">
            <div className="h-full bg-ember rounded-full transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-3xl space-y-6">

          {editing ? (
            <div className="space-y-3">
              <div><label className={label}>Name</label><input className={input} value={draft.name || ''} onChange={e => set('name', e.target.value)} /></div>
              <div><label className={label}>Description</label><textarea className={input + ' resize-none'} rows={3} value={draft.description || ''} onChange={e => set('description', e.target.value)} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={label}>Status</label>
                  <select className={input} value={draft.status} onChange={e => set('status', e.target.value)}>
                    {PROJECT_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className={label}>Owner</label>
                  <select className={input} value={draft.owner_id || ''} onChange={e => set('owner_id', e.target.value || null)}>
                    <option value="">Unassigned</option>
                    {members.map(m => <option key={m.id} value={m.id}>{m.display_name || m.email}</option>)}
                  </select>
                </div>
                <div><label className={label}>Due date</label><input className={input} type="date" value={draft.due_date || ''} onChange={e => set('due_date', e.target.value || null)} /></div>
              </div>
              <div className="flex gap-2 pt-1">
                <button onClick={save} className="px-4 py-2 bg-ember text-ink text-sm font-semibold rounded">Save</button>
                <button onClick={() => setEditing(false)} className="px-4 py-2 text-sm text-muted border border-bdr rounded">Cancel</button>
              </div>
            </div>
          ) : (
            <>
              {project.description && (
                <div className="text-sm text-muted">{project.description}</div>
              )}

              {/* Open tasks */}
              <div>
                <div className={label}>Open ({openTasks.length})</div>
                <div className="space-y-1">
                  {openTasks.map(t => (
                    <div key={t.id} className="flex items-center gap-2 py-2 px-3 bg-card/50 border border-bdr rounded-lg group">
                      {canWrite && (
                        <button onClick={() => toggleTask(t)}
                          className="w-4 h-4 rounded border border-bdr hover:border-ember shrink-0" />
                      )}
                      <span className="text-sm text-paper flex-1 cursor-pointer hover:text-ember"
                        onClick={() => onSelectTask?.(t.id)}>{t.title}</span>
                      <span className={`px-1 py-0.5 text-[8px] font-bold rounded ${STATUS_STYLES[t.status]}`}>{t.status.replace('_',' ')}</span>
                      {t.due_date && (
                        <span className={`text-[10px] ${new Date(t.due_date) < new Date() ? 'text-red-400' : 'text-dim'}`}>
                          {new Date(t.due_date).toLocaleDateString('en-GB', { day:'numeric', month:'short' })}
                        </span>
                      )}
                      {t.owner_id && (
                        <span className="w-5 h-5 rounded-full bg-ember text-ink text-[9px] font-bold flex items-center justify-center shrink-0">
                          {ownerName(t.owner_id)[0]?.toUpperCase() || '?'}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Add task */}
              {canWrite && (
                <form onSubmit={addTask} className="flex gap-2">
                  <input className={input + ' flex-1'} value={newTask} onChange={e => setNewTask(e.target.value)}
                    placeholder="Add a task..." />
                  <select className="px-2 py-2 bg-card border border-bdr rounded text-sm text-paper"
                    value={newPriority} onChange={e => setNewPriority(e.target.value)}>
                    <option value="P0">P0</option><option value="P1">P1</option>
                    <option value="P2">P2</option><option value="P3">P3</option>
                  </select>
                  <button type="submit" disabled={!newTask.trim()}
                    className="px-3 py-2 bg-ember text-ink text-xs font-semibold rounded disabled:opacity-50">Add</button>
                </form>
              )}

              {/* Done tasks */}
              {doneTasks.length > 0 && (
                <div>
                  <div className={label}>Completed ({doneTasks.length})</div>
                  <div className="space-y-1">
                    {doneTasks.map(t => (
                      <div key={t.id} className="flex items-center gap-2 py-1.5 px-3 bg-card/30 border border-bdr rounded-lg">
                        {canWrite && (
                          <button onClick={() => toggleTask(t)}
                            className="w-4 h-4 rounded bg-green-500/30 border border-green-500 text-green-300 text-[10px] flex items-center justify-center shrink-0">&#x2713;</button>
                        )}
                        <span className="text-sm text-dim line-through flex-1">{t.title}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
