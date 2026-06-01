import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

const STATUS_OPTIONS = ['todo', 'in_progress', 'blocked', 'done'];
const STATUS_STYLES = {
  todo: 'bg-blue-500/20 text-blue-300',
  in_progress: 'bg-orange-500/20 text-orange-300',
  blocked: 'bg-red-500/20 text-red-300',
  done: 'bg-green-500/20 text-green-300',
};

export default function TaskDetail({ taskId, profile, onClose }) {
  const [task, setTask] = useState(null);
  const [subtasks, setSubtasks] = useState([]);
  const [members, setMembers] = useState([]);
  const [projects, setProjects] = useState([]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({});
  const [newSubtask, setNewSubtask] = useState('');

  const canWrite = profile.role === 'owner' || profile.role === 'editor';

  useEffect(() => { load(); }, [taskId]);

  const load = async () => {
    const [t, st, m, p] = await Promise.all([
      supabase.from('tasks').select('*').eq('id', taskId).single(),
      supabase.from('tasks').select('*').eq('parent_task_id', taskId).order('sort_order'),
      supabase.from('profiles').select('id, email, display_name'),
      supabase.from('crm_projects').select('id, name').order('name'),
    ]);
    setTask(t.data);
    setSubtasks(st.data || []);
    setMembers(m.data || []);
    setProjects(p.data || []);
  };

  const startEdit = () => { setDraft({ ...task }); setEditing(true); };

  const save = async () => {
    const { id, created_at, updated_at, ...patch } = draft;
    if (patch.status === 'done' && task.status !== 'done') patch.completed_at = new Date().toISOString();
    if (patch.status !== 'done') patch.completed_at = null;
    await supabase.from('tasks').update(patch).eq('id', taskId);
    setEditing(false);
    load();
  };

  const set = (k, v) => setDraft({ ...draft, [k]: v });

  const addSubtask = async (e) => {
    e.preventDefault();
    if (!newSubtask.trim()) return;
    await supabase.from('tasks').insert({
      title: newSubtask.trim(),
      parent_task_id: taskId,
      project_id: task.project_id,
      subject_type: task.subject_type,
      subject_id: task.subject_id,
      sort_order: subtasks.length,
    });
    setNewSubtask('');
    load();
  };

  const toggleSubtask = async (st) => {
    const newStatus = st.status === 'done' ? 'todo' : 'done';
    await supabase.from('tasks').update({
      status: newStatus,
      completed_at: newStatus === 'done' ? new Date().toISOString() : null,
    }).eq('id', st.id);
    load();
  };

  const deleteTask = async () => {
    const openSubs = subtasks.filter(s => s.status !== 'done').length;
    let msg = 'Delete this task?';
    if (openSubs > 0) msg += `\n\n${openSubs} open subtask${openSubs > 1 ? 's' : ''} will also be deleted.`;
    if (!confirm(msg)) return;
    await supabase.from('tasks').delete().eq('id', taskId);
    onClose();
  };

  const changeStatus = async (status) => {
    const patch = { status };
    if (status === 'done') {
      const openSubs = subtasks.filter(s => s.status !== 'done').length;
      if (openSubs > 0 && !confirm(`${openSubs} subtask${openSubs > 1 ? 's are' : ' is'} still open. Complete anyway?`)) return;
      patch.completed_at = new Date().toISOString();
    } else {
      patch.completed_at = null;
    }
    await supabase.from('tasks').update(patch).eq('id', taskId);
    load();
  };

  if (!task) return <div className="h-full flex items-center justify-center text-dim text-sm">Loading...</div>;

  const ownerName = (id) => {
    const m = members.find(u => u.id === id);
    return m ? (m.display_name || m.email.split('@')[0]) : 'Unassigned';
  };

  const input = "w-full px-3 py-2 bg-card border border-bdr rounded text-sm text-paper placeholder-dim focus:outline-none focus:border-ember";
  const label = "text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-dim mb-1 block";

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 py-4 border-b border-bdr flex items-center gap-3">
        <button onClick={onClose} className="text-muted hover:text-paper text-sm">&larr;</button>
        <div className="flex-1 min-w-0">
          <div className={`text-lg font-bold truncate ${task.status === 'done' ? 'text-dim line-through' : 'text-paper'}`}>{task.title}</div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className={`px-1.5 py-0.5 text-[9px] font-bold uppercase rounded ${STATUS_STYLES[task.status]}`}>
              {task.status.replace('_', ' ')}
            </span>
            <span className="text-[10px] text-dim font-mono">{task.priority}</span>
            {task.due_date && (
              <span className={`text-[10px] ${new Date(task.due_date) < new Date() && task.status !== 'done' ? 'text-red-400' : 'text-dim'}`}>
                Due {new Date(task.due_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
              </span>
            )}
          </div>
        </div>
        <div className="flex gap-1.5 shrink-0">
          {canWrite && !editing && (
            <>
              {STATUS_OPTIONS.filter(s => s !== task.status).map(s => (
                <button key={s} onClick={() => changeStatus(s)}
                  className={`px-2 py-1 text-[10px] font-bold uppercase rounded border ${STATUS_STYLES[s]} border-current/20 hover:opacity-80`}>
                  {s === 'done' ? 'Complete' : s.replace('_', ' ')}
                </button>
              ))}
              <button onClick={startEdit} className="px-2 py-1 text-xs text-muted border border-bdr rounded hover:text-paper">Edit</button>
              <button onClick={deleteTask} className="px-2 py-1 text-xs text-red-400 border border-red-500/30 rounded hover:bg-red-500/10">Delete</button>
            </>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-3xl space-y-6">

          {!editing ? (
            <>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Assignee" value={ownerName(task.owner_id)} />
                <Field label="Priority" value={task.priority} />
                <Field label="Project" value={projects.find(p => p.id === task.project_id)?.name} />
                <Field label="Due date" value={task.due_date ? new Date(task.due_date).toLocaleDateString('en-GB') : null} />
                {task.subject_type && <Field label="Related to" value={`${task.subject_type} ${task.subject_id?.slice(0, 8)}`} />}
                {task.completed_at && <Field label="Completed" value={new Date(task.completed_at).toLocaleDateString('en-GB')} />}
              </div>
              {task.description && (
                <div>
                  <div className={label}>Description</div>
                  <div className="text-sm text-paper whitespace-pre-wrap">{task.description}</div>
                </div>
              )}
            </>
          ) : (
            <div className="space-y-3">
              <div><label className={label}>Title</label><input className={input} value={draft.title || ''} onChange={e => set('title', e.target.value)} /></div>
              <div><label className={label}>Description</label><textarea className={input + ' resize-none'} rows={4} value={draft.description || ''} onChange={e => set('description', e.target.value)} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={label}>Status</label>
                  <select className={input} value={draft.status} onChange={e => set('status', e.target.value)}>
                    {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                  </select>
                </div>
                <div>
                  <label className={label}>Priority</label>
                  <select className={input} value={draft.priority} onChange={e => set('priority', e.target.value)}>
                    <option value="P0">P0</option><option value="P1">P1</option>
                    <option value="P2">P2</option><option value="P3">P3</option>
                  </select>
                </div>
                <div>
                  <label className={label}>Assignee</label>
                  <select className={input} value={draft.owner_id || ''} onChange={e => set('owner_id', e.target.value || null)}>
                    <option value="">Unassigned</option>
                    {members.map(m => <option key={m.id} value={m.id}>{m.display_name || m.email}</option>)}
                  </select>
                </div>
                <div><label className={label}>Due date</label><input className={input} type="date" value={draft.due_date || ''} onChange={e => set('due_date', e.target.value || null)} /></div>
                <div>
                  <label className={label}>Project</label>
                  <select className={input} value={draft.project_id || ''} onChange={e => set('project_id', e.target.value || null)}>
                    <option value="">No project</option>
                    {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
              </div>
              <div className="flex gap-2 pt-1">
                <button onClick={save} className="px-4 py-2 bg-ember text-ink text-sm font-semibold rounded">Save</button>
                <button onClick={() => setEditing(false)} className="px-4 py-2 text-sm text-muted border border-bdr rounded">Cancel</button>
              </div>
            </div>
          )}

          {/* Subtasks */}
          <div>
            <div className={label}>Subtasks ({subtasks.length})</div>
            <div className="space-y-1 mb-2">
              {subtasks.map(st => (
                <div key={st.id} className="flex items-center gap-2 py-1.5 px-3 bg-card/50 border border-bdr rounded-lg">
                  {canWrite && (
                    <button onClick={() => toggleSubtask(st)}
                      className={`w-4 h-4 rounded border shrink-0 flex items-center justify-center text-[10px] ${
                        st.status === 'done' ? 'bg-green-500/30 border-green-500 text-green-300' : 'border-bdr hover:border-ember'
                      }`}>
                      {st.status === 'done' && '✓'}
                    </button>
                  )}
                  <span className={`text-sm flex-1 ${st.status === 'done' ? 'text-dim line-through' : 'text-paper'}`}>{st.title}</span>
                  {st.owner_id && (
                    <span className="text-[10px] text-dim">{ownerName(st.owner_id)}</span>
                  )}
                </div>
              ))}
            </div>
            {canWrite && (
              <form onSubmit={addSubtask} className="flex gap-2">
                <input className={input + ' flex-1'} value={newSubtask} onChange={e => setNewSubtask(e.target.value)}
                  placeholder="Add subtask..." />
                <button type="submit" disabled={!newSubtask.trim()}
                  className="px-3 py-2 bg-ember text-ink text-xs font-semibold rounded disabled:opacity-50 shrink-0">Add</button>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value }) {
  return (
    <div>
      <div className="text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-dim mb-0.5">{label}</div>
      <div className="text-sm text-paper">{value || <span className="text-dim italic">--</span>}</div>
    </div>
  );
}
