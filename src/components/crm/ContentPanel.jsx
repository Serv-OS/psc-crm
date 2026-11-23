import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';

// Content autopilot (Peter, 23 Nov 2026: "fully automatic, 1 to 2 blogs and
// 3 socials a week"). Claude writes a few weeks ahead (content-plan, hourly)
// and content-publish puts posts live when due. This page is for looking,
// and for the odd change: pause, edit, delete, add a town to a project.

const PUB = `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/content/`;
const STATUS = {
  scheduled: 'bg-blue-100 text-blue-700 border-blue-200',
  published: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  paused: 'bg-slate-100 text-slate-600 border-slate-200',
  waiting: 'bg-amber-100 text-amber-700 border-amber-200',
  failed: 'bg-red-100 text-red-700 border-red-200',
};
const fmt = (d) => new Date(d).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const SITE = 'https://www.peninsulasidingcompany.com';

export default function ContentPanel({ profile }) {
  const [tab, setTab] = useState('calendar');
  const canEdit = profile?.role === 'owner' || profile?.role === 'editor';
  return (
    <div className="h-full flex flex-col">
      <div className="px-6 py-4 border-b border-bdr">
        <div className="text-xl font-bold text-paper">Content autopilot</div>
        <div className="text-xs text-muted">Blog posts and Facebook and Instagram posts, written ahead by Claude and published on their own.</div>
        <div className="flex gap-1 mt-3">
          {[['calendar', 'Calendar'], ['projects', 'Projects'], ['settings', 'Settings']].map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} className={`px-3 py-1.5 rounded-lg text-sm ${tab === k ? 'bg-ember text-white' : 'btn-ghost'}`}>{l}</button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-6">
        {tab === 'calendar' && <Calendar canEdit={canEdit} />}
        {tab === 'projects' && <Projects canEdit={canEdit} />}
        {tab === 'settings' && <Settings canEdit={canEdit} />}
      </div>
    </div>
  );
}

function Calendar({ canEdit }) {
  const [posts, setPosts] = useState([]);
  const [open, setOpen] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const load = async () => {
    const since = new Date(Date.now() - 21 * 86400000).toISOString();
    const { data } = await supabase.from('content_posts').select('*').gte('publish_at', since).order('publish_at');
    setPosts(data || []);
  };
  useEffect(() => { load(); }, []);

  const writeNow = async () => {
    setBusy(true); setMsg('Writing the next post. This takes about a minute…');
    const { data, error } = await supabase.functions.invoke('content-plan', { body: { fill: true } });
    setBusy(false);
    setMsg(error ? `Could not write: ${error.message}` : data?.full ? 'The calendar is already full for the weeks ahead.' : data?.made ? `Written: ${data.title || data.made}` : (data?.skipped || data?.error || 'Done'));
    load();
  };
  const setStatus = async (p, status) => { await supabase.from('content_posts').update({ status, updated_at: new Date().toISOString() }).eq('id', p.id); load(); };
  const remove = async (p) => { if (!window.confirm('Delete this post? A new one will be written for this slot.')) return; await supabase.from('content_posts').delete().eq('id', p.id); setOpen(null); load(); };

  const upcoming = posts.filter((p) => new Date(p.publish_at) >= new Date(Date.now() - 3600000) || p.status !== 'published');
  const past = posts.filter((p) => !upcoming.includes(p)).reverse();

  return (
    <div className="max-w-4xl space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        {canEdit && <button onClick={writeNow} disabled={busy} className="btn-glass px-4 py-2 rounded-xl text-sm disabled:opacity-50">{busy ? 'Writing…' : 'Write the next post now'}</button>}
        <span className="text-xs text-muted">{msg || 'New posts are written on their own every hour until the next few weeks are full.'}</span>
      </div>
      <Section title={`Coming up (${upcoming.length})`}>
        {upcoming.length === 0 && <div className="text-sm text-dim">Nothing scheduled yet. The first posts are written within the hour.</div>}
        {upcoming.map((p) => <PostRow key={p.id} p={p} open={open === p.id} onToggle={() => setOpen(open === p.id ? null : p.id)} canEdit={canEdit} setStatus={setStatus} remove={remove} reload={load} />)}
      </Section>
      {past.length > 0 && (
        <Section title="Recently published">
          {past.map((p) => <PostRow key={p.id} p={p} open={open === p.id} onToggle={() => setOpen(open === p.id ? null : p.id)} canEdit={canEdit} setStatus={setStatus} remove={remove} reload={load} />)}
        </Section>
      )}
    </div>
  );
}

function PostRow({ p, open, onToggle, canEdit, setStatus, remove, reload }) {
  const [draft, setDraft] = useState(null);
  const save = async () => {
    const patch = p.kind === 'blog' ? { title: draft.title, excerpt: draft.excerpt } : { caption: draft.caption };
    if (draft.when) patch.publish_at = new Date(draft.when).toISOString();
    await supabase.from('content_posts').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', p.id);
    setDraft(null); reload();
  };
  const thumb = p.image_paths?.[0];
  return (
    <div className="glass-inner rounded-xl overflow-hidden">
      <button onClick={onToggle} className="w-full flex items-center gap-3 p-3 text-left">
        {thumb ? <img src={PUB + thumb} alt="" className="w-14 h-14 rounded-lg object-cover shrink-0" /> : <div className="w-14 h-14 rounded-lg bg-slate-100 shrink-0" />}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase">
            <span className={p.kind === 'blog' ? 'text-indigo-600' : 'text-pink-600'}>{p.kind === 'blog' ? 'Blog' : 'Facebook + Instagram'}</span>
            <span className={`px-1.5 py-0.5 rounded border ${STATUS[p.status]}`}>{p.status === 'waiting' ? 'waiting for Meta access' : p.status}</span>
          </div>
          <div className="text-sm font-semibold text-paper truncate">{p.kind === 'blog' ? p.title : (p.caption || '').split('\n')[0]}</div>
          <div className="text-xs text-muted">{fmt(p.publish_at)}</div>
        </div>
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-3 text-sm">
          {p.image_paths?.length > 1 && <div className="flex gap-2 overflow-x-auto">{p.image_paths.map((x) => <img key={x} src={PUB + x} alt="" className="h-24 rounded-lg" />)}</div>}
          {draft ? (
            <div className="space-y-2">
              {p.kind === 'blog' ? (
                <>
                  <input className="w-full px-2.5 py-2 border border-bdr rounded-lg" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
                  <textarea className="w-full px-2.5 py-2 border border-bdr rounded-lg" rows={2} value={draft.excerpt} onChange={(e) => setDraft({ ...draft, excerpt: e.target.value })} />
                </>
              ) : (
                <textarea className="w-full px-2.5 py-2 border border-bdr rounded-lg" rows={6} value={draft.caption} onChange={(e) => setDraft({ ...draft, caption: e.target.value })} />
              )}
              <label className="block text-xs text-muted">Publish at <input type="datetime-local" className="ml-2 px-2 py-1 border border-bdr rounded" value={draft.when} onChange={(e) => setDraft({ ...draft, when: e.target.value })} /></label>
              <div className="flex gap-2"><button onClick={save} className="btn-glass px-3 py-1.5 rounded-lg text-xs">Save</button><button onClick={() => setDraft(null)} className="btn-ghost px-3 py-1.5 rounded-lg text-xs">Cancel</button></div>
            </div>
          ) : p.kind === 'blog' ? (
            <>
              <div className="text-muted">{p.excerpt}</div>
              <BlogBody body={p.body} images={p.image_paths} />
              {p.status !== 'paused' && new Date(p.publish_at) <= new Date() && <a href={`${SITE}/resources/${p.slug}`} target="_blank" rel="noreferrer" className="text-ember text-xs hover:underline">Open on the website</a>}
            </>
          ) : (
            <div className="whitespace-pre-wrap text-paper">{p.caption}{p.link_url ? `\n\n${p.link_url}` : ''}</div>
          )}
          {p.error && <div className="text-xs text-amber-700">{p.error}</div>}
          {canEdit && !draft && (
            <div className="flex gap-2 flex-wrap">
              <button onClick={() => {
                const d = new Date(p.publish_at); const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
                setDraft({ title: p.title || '', excerpt: p.excerpt || '', caption: p.caption || '', when: local });
              }} className="btn-ghost px-3 py-1.5 rounded-lg text-xs">Edit</button>
              {p.status === 'paused'
                ? <button onClick={() => setStatus(p, 'scheduled')} className="btn-ghost px-3 py-1.5 rounded-lg text-xs">Resume</button>
                : p.status !== 'published' && <button onClick={() => setStatus(p, 'paused')} className="btn-ghost px-3 py-1.5 rounded-lg text-xs">Pause</button>}
              {p.status === 'failed' && <button onClick={() => setStatus(p, 'scheduled')} className="btn-ghost px-3 py-1.5 rounded-lg text-xs">Try again</button>}
              {p.status !== 'published' && <button onClick={() => remove(p)} className="px-3 py-1.5 rounded-lg text-xs text-red-600 border border-red-200">Delete</button>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function BlogBody({ body, images }) {
  if (!Array.isArray(body)) return null;
  return (
    <div className="space-y-2 max-h-96 overflow-y-auto border border-bdr rounded-lg p-3 bg-white">
      {body.map((b, i) => {
        if (b.type === 'h2') return <div key={i} className="font-bold text-paper mt-2">{b.text}</div>;
        if (b.type === 'h3') return <div key={i} className="font-semibold text-paper">{b.text}</div>;
        if (b.type === 'ul') return <ul key={i} className="list-disc pl-5">{(b.items || []).map((x, j) => <li key={j}>{x}</li>)}</ul>;
        if (b.type === 'quote') return <blockquote key={i} className="border-l-2 border-ember pl-3 italic">{b.text}</blockquote>;
        if (b.type === 'img') { const src = images?.[b.photo]; return src ? <img key={i} src={PUB + src} alt={b.alt || ''} className="rounded-lg max-h-48" /> : null; }
        return <p key={i} className="text-paper">{b.text}</p>;
      })}
    </div>
  );
}

function Projects({ canEdit }) {
  const [rows, setRows] = useState([]);
  const [photos, setPhotos] = useState({});
  const [filter, setFilter] = useState('');
  const load = async () => {
    const [{ data: p }, { data: ph }] = await Promise.all([
      supabase.from('content_projects').select('*').order('key'),
      supabase.from('content_photos').select('project_key, path, label').order('path'),
    ]);
    setRows(p || []);
    const by = {}; for (const x of ph || []) (by[x.project_key] ||= []).push(x);
    setPhotos(by);
  };
  useEffect(() => { load(); }, []);
  const save = async (key, patch) => { await supabase.from('content_projects').update(patch).eq('key', key); setRows((r) => r.map((x) => (x.key === key ? { ...x, ...patch } : x))); };
  const shown = useMemo(() => rows.filter((r) => !filter || (filter === 'notown' ? !r.town : true)), [rows, filter]);
  const noTown = rows.filter((r) => !r.town).length;
  return (
    <div className="max-w-5xl space-y-3">
      <div className="text-xs text-muted">
        Finished jobs in the photo library. Posts name the <b>town</b> when it is filled in, which helps local Google searches. The project name is only for us and never appears in a post.
        {noTown > 0 && <> <button onClick={() => setFilter(filter ? '' : 'notown')} className="text-ember hover:underline">{filter ? 'Show all' : `${noTown} have no town yet`}</button></>}
      </div>
      {shown.map((r) => {
        const ph = photos[r.key] || [];
        const after = ph.find((x) => x.label === 'after');
        return (
          <div key={r.key} className="glass-inner rounded-xl p-3 flex items-center gap-3">
            {after ? <img src={PUB + after.path} alt="" className="w-20 h-16 object-cover rounded-lg shrink-0" /> : <div className="w-20 h-16 bg-slate-100 rounded-lg shrink-0" />}
            <div className="w-28 shrink-0">
              <div className="text-sm font-semibold text-paper capitalize">{r.key}</div>
              <div className="text-[11px] text-muted">{ph.length} photos{ph.some((x) => x.label === 'before') ? ', has before' : ''}</div>
            </div>
            <input disabled={!canEdit} defaultValue={r.town || ''} placeholder="Town, e.g. San Mateo" onBlur={(e) => e.target.value !== (r.town || '') && save(r.key, { town: e.target.value.trim() || null })} className="flex-1 min-w-0 px-2.5 py-1.5 border border-bdr rounded-lg text-sm" />
            <input disabled={!canEdit} defaultValue={r.colour || ''} placeholder="Colour" onBlur={(e) => e.target.value !== (r.colour || '') && save(r.key, { colour: e.target.value.trim() || null })} className="w-40 px-2.5 py-1.5 border border-bdr rounded-lg text-sm" />
            <label className="text-xs text-muted flex items-center gap-1"><input type="checkbox" disabled={!canEdit} checked={r.active} onChange={(e) => save(r.key, { active: e.target.checked })} /> Use</label>
          </div>
        );
      })}
    </div>
  );
}

function Settings({ canEdit }) {
  const [s, setS] = useState(null);
  const [saved, setSaved] = useState(false);
  const [topic, setTopic] = useState('');
  useEffect(() => { supabase.from('content_settings').select('*').eq('id', 1).maybeSingle().then(({ data }) => setS(data)); }, []);
  if (!s) return <div className="text-sm text-dim">Loading…</div>;
  const set = (k, v) => { setS({ ...s, [k]: v }); setSaved(false); };
  const save = async () => {
    const { error } = await supabase.from('content_settings').update({
      enabled: s.enabled, blogs_per_week: Number(s.blogs_per_week), socials_per_week: Number(s.socials_per_week),
      post_hour: Number(s.post_hour), weeks_ahead: Number(s.weeks_ahead), guide_topics: s.guide_topics, brand_notes: s.brand_notes, updated_at: new Date().toISOString(),
    }).eq('id', 1);
    if (error) alert(error.message); else setSaved(true);
  };
  const topics = s.guide_topics || [];
  const input = 'px-2.5 py-1.5 border border-bdr rounded-lg text-sm';
  return (
    <div className="max-w-2xl space-y-4 text-sm">
      <label className="flex items-center gap-2"><input type="checkbox" disabled={!canEdit} checked={s.enabled} onChange={(e) => set('enabled', e.target.checked)} /> <b>Autopilot on</b> <span className="text-muted">(off stops writing and publishing)</span></label>
      <div className="grid grid-cols-2 gap-3">
        <label>Blogs a week <input type="number" min="0" max="7" disabled={!canEdit} className={`${input} w-20 ml-2`} value={s.blogs_per_week} onChange={(e) => set('blogs_per_week', e.target.value)} /></label>
        <label>Social posts a week <input type="number" min="0" max="14" disabled={!canEdit} className={`${input} w-20 ml-2`} value={s.socials_per_week} onChange={(e) => set('socials_per_week', e.target.value)} /></label>
        <label>Post at (hour, Pacific) <input type="number" min="0" max="23" disabled={!canEdit} className={`${input} w-20 ml-2`} value={s.post_hour} onChange={(e) => set('post_hour', e.target.value)} /></label>
        <label>Write ahead (weeks) <input type="number" min="1" max="8" disabled={!canEdit} className={`${input} w-20 ml-2`} value={s.weeks_ahead} onChange={(e) => set('weeks_ahead', e.target.value)} /></label>
      </div>
      <div>
        <div className="font-semibold text-paper mb-1">Business facts Claude may use</div>
        <textarea disabled={!canEdit} rows={5} className={`${input} w-full`} value={s.brand_notes || ''} onChange={(e) => set('brand_notes', e.target.value)} />
      </div>
      <div>
        <div className="font-semibold text-paper mb-1">Guide topics (blogs alternate between these and finished projects)</div>
        <div className="space-y-1">
          {topics.map((t, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className={t.done ? 'line-through text-dim flex-1' : 'flex-1'}>{t.topic}</span>
              {canEdit && <button onClick={() => set('guide_topics', topics.filter((_, j) => j !== i))} className="text-xs text-red-600">Remove</button>}
            </div>
          ))}
        </div>
        {canEdit && (
          <div className="flex gap-2 mt-2">
            <input className={`${input} flex-1`} placeholder="Add a topic…" value={topic} onChange={(e) => setTopic(e.target.value)} />
            <button onClick={() => { if (topic.trim()) { set('guide_topics', [...topics, { topic: topic.trim() }]); setTopic(''); } }} className="btn-ghost px-3 py-1.5 rounded-lg text-xs">Add</button>
          </div>
        )}
      </div>
      {canEdit && <div className="flex items-center gap-3"><button onClick={save} className="btn-glass px-4 py-2 rounded-xl">Save settings</button>{saved && <span className="text-xs text-emerald-600">Saved</span>}</div>}
      <div className="text-xs text-muted border-t border-bdr pt-3">Facebook and Instagram: posts are written now and go out once Meta access is connected. Until then they show as "waiting for Meta access".</div>
    </div>
  );
}

function Section({ title, children }) {
  return <div className="space-y-2"><div className="text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-dim">{title}</div>{children}</div>;
}
