import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

const CHANNEL_STYLES = {
  any: 'bg-slate-100 text-slate-600 border border-slate-200',
  email: 'bg-purple-100 text-purple-700 border border-purple-200',
  sms: 'bg-blue-100 text-blue-700 border border-blue-200',
};

const blank = { name: '', channel: 'any', subject: '', body: '' };

export default function TemplatesPanel({ profile }) {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // id | 'new' | null
  const [draft, setDraft] = useState(blank);

  const canWrite = profile.role === 'owner' || profile.role === 'editor';

  useEffect(() => { load(); }, []);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase.from('templates').select('*').order('channel').order('name');
    setTemplates(data || []);
    setLoading(false);
  };

  const startNew = () => { setDraft(blank); setEditing('new'); };
  const startEdit = (t) => { setDraft({ name: t.name, channel: t.channel, subject: t.subject || '', body: t.body }); setEditing(t.id); };

  const save = async () => {
    if (!draft.name.trim() || !draft.body.trim()) { alert('Name and body are required.'); return; }
    const payload = {
      name: draft.name.trim(), channel: draft.channel,
      subject: draft.channel === 'sms' ? null : (draft.subject.trim() || null),
      body: draft.body,
    };
    if (editing === 'new') {
      await supabase.from('templates').insert({ ...payload, created_by: profile.id });
    } else {
      await supabase.from('templates').update(payload).eq('id', editing);
    }
    setEditing(null); load();
  };

  const remove = async (t) => {
    if (!confirm(`Delete template "${t.name}"?`)) return;
    await supabase.from('templates').delete().eq('id', t.id);
    load();
  };

  const input = "w-full px-3 py-2 bg-card border border-bdr rounded-xl text-sm text-paper placeholder-dim focus:outline-none focus:border-ember";
  const label = "text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-dim mb-1 block";

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 py-4 border-b border-bdr flex items-center justify-between">
        <div>
          <div className="text-lg font-bold text-paper">Templates</div>
          <div className="text-[10px] text-dim font-mono uppercase tracking-[0.18em]">{templates.length} canned responses</div>
        </div>
        {canWrite && editing === null && (
          <button onClick={startNew} className="px-3 py-1.5 bg-ember text-white text-sm font-semibold rounded-xl hover:bg-ember-deep transition">+ New template</button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-3xl space-y-3">
          {editing !== null && (
            <div className="glass-card rounded-2xl p-5 space-y-3">
              <div className="text-sm font-bold text-paper">{editing === 'new' ? 'New template' : 'Edit template'}</div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={label}>Name</label><input className={input} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. Acknowledge" autoFocus /></div>
                <div><label className={label}>Channel</label>
                  <select className={input} value={draft.channel} onChange={e => setDraft({ ...draft, channel: e.target.value })}>
                    <option value="any">Any</option><option value="email">Email</option><option value="sms">SMS</option>
                  </select></div>
              </div>
              {draft.channel !== 'sms' && (
                <div><label className={label}>Subject (email)</label><input className={input} value={draft.subject} onChange={e => setDraft({ ...draft, subject: e.target.value })} placeholder="Email subject line" /></div>
              )}
              <div><label className={label}>Body</label>
                <textarea className={input + ' resize-none font-mono text-xs'} rows={6} value={draft.body} onChange={e => setDraft({ ...draft, body: e.target.value })} placeholder="Message body" /></div>
              <div className="text-[11px] text-dim">Placeholders: <code className="bg-slate-100 px-1 rounded">{'{{contact_name}}'}</code> <code className="bg-slate-100 px-1 rounded">{'{{ticket_number}}'}</code> <code className="bg-slate-100 px-1 rounded">{'{{company}}'}</code> <code className="bg-slate-100 px-1 rounded">{'{{agent_name}}'}</code></div>
              <div className="flex gap-2">
                <button onClick={save} className="px-4 py-2 bg-ember text-white text-sm font-semibold rounded-xl">Save</button>
                <button onClick={() => setEditing(null)} className="px-4 py-2 text-sm text-muted border border-bdr rounded-xl">Cancel</button>
              </div>
            </div>
          )}

          {loading && <div className="py-8 text-center text-dim text-sm">Loading…</div>}
          {!loading && templates.length === 0 && editing === null && (
            <div className="py-12 text-center text-dim text-sm">No templates yet. Create one to speed up replies.</div>
          )}
          {!loading && templates.map(t => (
            <div key={t.id} className="glass-card rounded-2xl p-4">
              <div className="flex items-center gap-2 mb-1">
                <div className="text-sm font-bold text-paper">{t.name}</div>
                <span className={`px-1.5 py-0.5 text-[9px] font-bold uppercase rounded ${CHANNEL_STYLES[t.channel]}`}>{t.channel}</span>
                {canWrite && (
                  <div className="ml-auto flex gap-2">
                    <button onClick={() => startEdit(t)} className="text-xs text-ember hover:text-ember-deep">Edit</button>
                    <button onClick={() => remove(t)} className="text-xs text-red-600 hover:text-red-700">Delete</button>
                  </div>
                )}
              </div>
              {t.subject && <div className="text-xs text-muted mb-1">Subject: {t.subject}</div>}
              <div className="text-xs text-paper whitespace-pre-wrap line-clamp-3">{t.body}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
