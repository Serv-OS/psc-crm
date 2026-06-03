import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { LogoLockup } from './ServOSLogo.jsx';

export default function Sidebar({ profile, projects, activeProject, setActiveProject, view, setView, onSignOut, onRefresh }) {
  const [adding, setAdding] = useState(false);
  const [name, setName]     = useState('');
  const [icon, setIcon]     = useState('📦');
  const [defaultType, setDefaultType] = useState('task');
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName]   = useState('');
  const [editIcon, setEditIcon]   = useState('');
  const [menuId, setMenuId]       = useState(null);
  const isOwner  = profile.role === 'owner';
  const canWrite = profile.role === 'owner' || profile.role === 'editor';

  const create = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'') + '-' + Math.random().toString(36).slice(2,6);
    const { data: p } = await supabase.from('backlog_projects').insert({
      name: name.trim(),
      slug, icon,
      default_item_type: defaultType,
      created_by: profile.id,
    }).select().single();
    if (p) {
      const defaults = [
        { name: 'Backlog',     position: 0, color: '#948A7A', is_done: false },
        { name: 'In Progress', position: 1, color: '#E8743C', is_done: false },
        { name: 'Testing',     position: 2, color: '#C75A29', is_done: false },
        { name: 'Shipped',     position: 3, color: '#6B6359', is_done: true  },
      ];
      await supabase.from('buckets').insert(defaults.map(b => ({ ...b, backlog_project_id: p.id })));
      setActiveProject(p);
    }
    setName(''); setIcon('📦'); setDefaultType('task'); setAdding(false); onRefresh?.();
  };

  const startEdit = (p) => {
    setEditingId(p.id);
    setEditName(p.name);
    setEditIcon(p.icon || '📦');
    setMenuId(null);
  };

  const saveEdit = async (e) => {
    e?.preventDefault();
    if (!editName.trim()) return;
    await supabase.from('backlog_projects').update({
      name: editName.trim(),
      icon: editIcon || '📦',
    }).eq('id', editingId);
    setEditingId(null); setEditName(''); setEditIcon('');
    onRefresh?.();
  };

  const cancelEdit = () => {
    setEditingId(null); setEditName(''); setEditIcon('');
  };

  const deleteProject = async (p) => {
    setMenuId(null);
    const first = confirm(`Delete project "${p.name}"?\n\nThis permanently removes the project, all its buckets, items, comments, and activity history.\n\nClick OK to continue, then you'll be asked to confirm one more time.`);
    if (!first) return;
    const confirmText = prompt(`Type the project name to confirm deletion:\n\n${p.name}`);
    if (confirmText !== p.name) {
      alert('Project name did not match. Deletion cancelled.');
      return;
    }
    const { error } = await supabase.from('backlog_projects').delete().eq('id', p.id);
    if (error) { alert('Delete failed: ' + error.message); return; }
    if (activeProject?.id === p.id) setActiveProject(null);
    onRefresh?.();
  };

  return (
    <aside className="w-64 shrink-0 glass border-r border-bdr flex flex-col">
      <div className="px-4 py-4 border-b border-bdr">
        <LogoLockup size={24}/>
        <div className="text-[9px] font-mono uppercase tracking-[0.18em] text-dim mt-1.5">Posupject</div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-3" onClick={() => setMenuId(null)}>
        <div className="flex items-center justify-between px-2 mb-2">
          <div className="text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-dim">Projects</div>
          {canWrite && !adding && (
            <button onClick={(e) => { e.stopPropagation(); setAdding(true); }} className="text-muted hover:text-paper text-sm" title="New project">+</button>
          )}
        </div>

        {adding && (
          <form onSubmit={create} className="mb-2 space-y-2 px-2" onClick={e => e.stopPropagation()}>
            <div className="flex gap-2">
              <input value={icon} onChange={e => setIcon(e.target.value)} maxLength={2}
                className="w-10 px-2 py-1.5 bg-card border border-bdr rounded text-sm text-center text-paper"/>
              <input value={name} onChange={e => setName(e.target.value)} autoFocus placeholder="Project name"
                className="flex-1 px-2 py-1.5 bg-card border border-bdr rounded text-sm text-paper placeholder-dim"/>
            </div>
            <div>
              <label className="text-[9px] font-mono uppercase tracking-[0.18em] text-dim mb-1 block">Default item type</label>
              <select value={defaultType} onChange={e => setDefaultType(e.target.value)}
                className="w-full px-2 py-1.5 bg-card border border-bdr rounded text-sm text-paper">
                <option value="feature">Feature</option>
                <option value="bug">Bug</option>
                <option value="task">Task</option>
                <option value="chore">Chore</option>
              </select>
            </div>
            <div className="flex gap-2">
              <button type="submit" className="flex-1 px-2 py-1.5 bg-ember text-ink rounded text-xs font-semibold">Create</button>
              <button type="button" onClick={() => { setAdding(false); setName(''); }} className="flex-1 px-2 py-1.5 bg-card border border-bdr rounded text-xs text-muted">Cancel</button>
            </div>
          </form>
        )}

        <div className="space-y-0.5">
          {projects.map(p => {
            const active = activeProject?.id === p.id && view === 'board';
            const isEditing = editingId === p.id;

            if (isEditing) {
              return (
                <form key={p.id} onSubmit={saveEdit} className="px-2 py-1 space-y-1.5" onClick={e => e.stopPropagation()}>
                  <div className="flex gap-1.5">
                    <input value={editIcon} onChange={e => setEditIcon(e.target.value)} maxLength={2}
                      className="w-9 px-1.5 py-1 bg-card border border-ember rounded text-sm text-center text-paper"/>
                    <input value={editName} onChange={e => setEditName(e.target.value)} autoFocus
                      onKeyDown={e => { if (e.key === 'Escape') cancelEdit(); }}
                      className="flex-1 px-2 py-1 bg-card border border-ember rounded text-sm text-paper"/>
                  </div>
                  <div className="flex gap-1.5">
                    <button type="submit" className="flex-1 px-2 py-1 bg-ember text-ink rounded text-[11px] font-semibold">Save</button>
                    <button type="button" onClick={cancelEdit} className="flex-1 px-2 py-1 bg-card border border-bdr rounded text-[11px] text-muted">Cancel</button>
                  </div>
                </form>
              );
            }

            return (
              <div key={p.id} className="relative group">
                <button onClick={() => { setActiveProject(p); setView('board'); }}
                  className={`w-full px-3 py-2 text-left rounded-xl text-sm flex items-center gap-2 transition ${
                    active ? 'bg-card text-paper' : 'text-muted hover:bg-card hover:text-paper'
                  }`}>
                  <span>{p.icon}</span>
                  <span className="truncate flex-1">{p.name}</span>
                </button>
                {canWrite && (
                  <button
                    onClick={(e) => { e.stopPropagation(); setMenuId(menuId === p.id ? null : p.id); }}
                    className={`absolute right-1 top-1/2 -translate-y-1/2 w-6 h-6 rounded flex items-center justify-center text-muted hover:text-paper hover:bg-ink-soft ${
                      menuId === p.id ? 'opacity-100 bg-ink-soft text-paper' : 'opacity-0 group-hover:opacity-100'
                    }`}
                    title="Project options">
                    &#x22EF;
                  </button>
                )}
                {menuId === p.id && (
                  <div className="absolute right-1 top-full mt-0.5 z-10 w-36 bg-card border border-bdr rounded-xl shadow-lg overflow-hidden"
                    onClick={e => e.stopPropagation()}>
                    <button onClick={() => startEdit(p)}
                      className="w-full px-3 py-2 text-left text-xs text-paper hover:bg-ink-soft flex items-center gap-2">
                      Rename
                    </button>
                    <button onClick={() => deleteProject(p)}
                      className="w-full px-3 py-2 text-left text-xs text-red-600 hover:bg-red-500/10 flex items-center gap-2 border-t border-bdr">
                      Delete
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {projects.length === 0 && !adding && (
          <div className="px-3 py-4 text-xs text-dim italic text-center">
            No projects yet. {canWrite && 'Click + to create one.'}
          </div>
        )}

        <div className="border-t border-bdr my-4"/>

        <div className="px-2 mb-2">
          <div className="text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-dim">CRM</div>
        </div>

        {[
          { key: 'companies',        icon: '\u{1F3E2}', label: 'Companies' },
          { key: 'locations',        icon: '\u{1F4CD}', label: 'Locations' },
          { key: 'contacts',         icon: '\u{1F464}', label: 'Contacts' },
          { key: 'leads',            icon: '\u{1F3AF}', label: 'Leads' },
          { key: 'deals',            icon: '\u{1F4B0}', label: 'Deals' },
          { key: 'onboarding',       icon: '\u{1F680}', label: 'Onboarding' },
          { key: 'projects',         icon: '\u{1F4C1}', label: 'Projects' },
          { key: 'tasks',            icon: '\u{2611}',  label: 'Tasks' },
          { key: 'tickets',          icon: '\u{1F3AB}', label: 'Support' },
          { key: 'modules',          icon: '\u{1F9E9}', label: 'Modules' },
          { key: 'feature_requests', icon: '\u{1F4A1}', label: 'Feature Requests' },
          { key: 'releases',         icon: '\u{1F4E6}', label: 'Releases' },
          { key: 'reporting',        icon: '\u{1F4CA}', label: 'Reporting' },
          { key: 'settings',         icon: '\u{2699}',  label: 'Settings' },
        ].map(item => (
          <button key={item.key} onClick={() => setView(item.key)}
            className={`w-full px-3 py-2 text-left rounded-xl text-sm flex items-center gap-2 ${
              view === item.key || view === item.key.slice(0, -1) + '_detail'
                ? 'bg-card text-paper' : 'text-muted hover:bg-card hover:text-paper'
            }`}>
            <span>{item.icon}</span>
            <span>{item.label}</span>
          </button>
        ))}

        <div className="border-t border-bdr my-4"/>

        <div className="px-2 mb-2">
          <div className="text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-dim">Backlog</div>
        </div>

        {activeProject && canWrite && (
          <button onClick={() => setView('features')}
            className={`w-full px-3 py-2 text-left rounded-xl text-sm flex items-center gap-2 ${
              view === 'features' ? 'bg-card text-paper' : 'text-muted hover:bg-card hover:text-paper'
            }`}>
            <span className="text-ember">&#x25C6;</span>
            <span>Features</span>
          </button>
        )}

        <div className="border-t border-bdr my-4"/>

        {isOwner && (
          <button onClick={() => setView('users')}
            className={`w-full px-3 py-2 text-left rounded-xl text-sm flex items-center gap-2 ${
              view === 'users' ? 'bg-card text-paper' : 'text-muted hover:bg-card hover:text-paper'
            }`}>
            <span>&#x1F465;</span>
            <span>Users</span>
          </button>
        )}
      </div>

      <div className="px-3 py-3 border-t border-bdr">
        <div className="flex items-center gap-2 mb-2">
          <div className="w-7 h-7 rounded-full bg-ember flex items-center justify-center text-ink text-xs font-bold">
            {(profile.display_name || profile.email)[0].toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs text-paper truncate">{profile.display_name || profile.email}</div>
            <div className="text-[10px] text-dim font-mono uppercase tracking-[0.18em]">{profile.role}</div>
          </div>
        </div>
        <button onClick={onSignOut} className="w-full px-2 py-1.5 text-xs btn-ghost rounded-xl">
          Sign out
        </button>
      </div>
    </aside>
  );
}
