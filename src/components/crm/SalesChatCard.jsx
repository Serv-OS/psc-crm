import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

// Website sales-chat settings: the embeds (site keys), what the assistant asks,
// what it is allowed to state as fact, and how it prices.
// See SALES_CHATBOT_PLAN.md.

const lines = (a) => (a || []).join('\n');
const toArr = (s) => (s || '').split('\n').map(x => x.trim()).filter(Boolean);
const newKey = () => 'chat_' + Array.from(crypto.getRandomValues(new Uint8Array(10)))
  .map(b => b.toString(16).padStart(2, '0')).join('');

export default function SalesChatCard({ profile }) {
  const [pb, setPb] = useState(null);
  const [sites, setSites] = useState([]);
  const [adding, setAdding] = useState(null);
  const [docs, setDocs] = useState([]);
  const [showDocs, setShowDocs] = useState(false);
  const [teach, setTeach] = useState({ url: '', text: '' });
  const [teaching, setTeaching] = useState(false);
  const [learned, setLearned] = useState('');
  const [sessions, setSessions] = useState([]);
  const [copied, setCopied] = useState('');
  const [err, setErr] = useState('');

  const canWrite = profile.role === 'owner' || profile.role === 'editor';
  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  useEffect(() => { load(); }, []);

  const load = async () => {
    const [p, s, d, c] = await Promise.all([
      supabase.from('chat_playbook').select('*').eq('id', 1).maybeSingle(),
      supabase.from('chat_sites').select('*').order('created_at'),
      supabase.from('kb_docs').select('id,title,question,category,source,active')
        .order('created_at', { ascending: false }).limit(200),
      supabase.from('chat_sessions')
        .select('id,status,visitor_name,visitor_email,estimate,lead_id,lead_score,last_at')
        .order('last_at', { ascending: false }).limit(10),
    ]);
    if (p.error) setErr(p.error.message);
    setPb(p.data || null);
    setSites(s.data || []);
    setDocs(d.data || []);
    setSessions(c.data || []);
  };

  const savePb = async (patch) => {
    const next = { ...pb, ...patch };
    setPb(next);
    const { error } = await supabase.from('chat_playbook').update({
      ...patch, updated_at: new Date().toISOString(),
    }).eq('id', 1);
    if (error) setErr(error.message);
  };

  const setStage = (i, patch) =>
    setPb(p => ({ ...p, question_stages: (p.question_stages || []).map((x, j) => j === i ? { ...x, ...patch } : x) }));
  const setPoint = (i, patch) =>
    setPb(p => ({ ...p, talking_points: (p.talking_points || []).map((x, j) => j === i ? { ...x, ...patch } : x) }));

  const saveSite = async (id, patch) => {
    setSites(ss => ss.map(s => s.id === id ? { ...s, ...patch } : s));
    const { error } = await supabase.from('chat_sites').update(patch).eq('id', id);
    if (error) setErr(error.message);
  };

  const addSite = async () => {
    if (!adding?.label?.trim()) { setErr('Give the embed a name.'); return; }
    const { error } = await supabase.from('chat_sites').insert({
      site_key: newKey(), label: adding.label.trim(),
      allowed_origins: toArr(adding.origins), mode: 'popup',
    });
    if (error) { setErr(error.message); return; }
    setAdding(null); setErr(''); load();
  };

  const removeSite = async (s) => {
    if (!confirm(`Delete the "${s.label}" embed?\n\nAny page still using this key will stop working.`)) return;
    await supabase.from('chat_sites').delete().eq('id', s.id);
    load();
  };

  const teachFrom = async () => {
    if (!teach.url.trim() && !teach.text.trim()) { setErr('Paste a link or the text itself.'); return; }
    setTeaching(true); setLearned(''); setErr('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/kb-learn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ url: teach.url.trim() || undefined, text: teach.text.trim() || undefined }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Could not read that.');
      setLearned(d.learned
        ? `Learned ${d.learned} answer${d.learned === 1 ? '' : 's'}.` +
          (d.dropped ? ` ${d.dropped} skipped for containing prices.` : '')
        : (d.note || 'Nothing useful found there.'));
      setTeach({ url: '', text: '' });
      load();
    } catch (e) { setErr(e.message); }
    setTeaching(false);
  };

  const saveDoc = async (id, patch) => {
    setDocs(ds => ds.map(d => d.id === id ? { ...d, ...patch } : d));
    const { error } = await supabase.from('kb_docs').update(patch).eq('id', id);
    if (error) setErr(error.message);
  };
  const removeDoc = async (d) => {
    if (!confirm(`Delete "${d.title || d.question}"?`)) return;
    await supabase.from('kb_docs').delete().eq('id', d.id);
    load();
  };

  const copy = (text, tag) => {
    navigator.clipboard?.writeText(text);
    setCopied(tag);
    setTimeout(() => setCopied(''), 1800);
  };

  const snippet = (s) => `<script src="${origin}/chat.js" data-site-key="${s.site_key}" defer></script>`;
  const pageLink = (s) => `${origin}/sales-chat.html?key=${s.site_key}`;

  const input = "w-full px-3 py-2 bg-card border border-bdr rounded-xl text-sm text-paper placeholder-dim focus:outline-none focus:border-ember disabled:opacity-60";
  const label = "text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-dim mb-1 block";

  if (!pb) {
    return (
      <div className="glass-card rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-bdr flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-ember/15 border border-ember/25 flex items-center justify-center text-lg">{'\u{1F4AC}'}</div>
          <div><div className="text-base font-bold text-paper">Sales chat</div>
            <div className="text-xs text-muted">{err ? 'Not set up yet — run migration 077.' : 'Loading…'}</div></div>
        </div>
        {err && <div className="p-5 text-xs text-red-600">{err}</div>}
      </div>
    );
  }

  return (
    <div className="glass-card rounded-2xl overflow-hidden">
      <div className="px-5 py-4 border-b border-bdr flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-ember/15 border border-ember/25 flex items-center justify-center text-lg">{'\u{1F4AC}'}</div>
        <div className="flex-1">
          <div className="text-base font-bold text-paper">Sales chat</div>
          <div className="text-xs text-muted">Qualifies a website enquiry, prices it, and books it into the pipeline</div>
        </div>
        <button type="button" disabled={!canWrite} onClick={() => savePb({ enabled: !pb.enabled })}
          className="flex items-center gap-2 disabled:opacity-60" title={pb.enabled ? 'Turn chat off' : 'Turn chat on'}>
          <span className={`text-[10px] font-bold uppercase ${pb.enabled ? 'text-emerald-600' : 'text-dim'}`}>{pb.enabled ? 'On' : 'Off'}</span>
          <div className={`relative w-10 h-6 rounded-full transition ${pb.enabled ? 'bg-emerald-500' : 'bg-slate-300'}`}>
            <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${pb.enabled ? 'left-[18px]' : 'left-0.5'}`} />
          </div>
        </button>
      </div>

      <div className="p-5 space-y-6">
        {err && <div className="text-xs text-red-600">{err}</div>}

        {/* ── Embeds ─────────────────────────────────────────────────────── */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <div className="text-sm font-medium text-paper">Embeds</div>
            <span className="text-xs text-dim font-mono">({sites.length})</span>
            {canWrite && !adding && (
              <button onClick={() => setAdding({ label: '', origins: '' })}
                className="ml-auto text-xs text-ember hover:text-ember-deep font-medium">+ New embed</button>
            )}
          </div>

          {adding && (
            <div className="glass-inner rounded-xl p-3 space-y-2 mb-3">
              <div><label className={label}>Name</label>
                <input className={input} value={adding.label} placeholder="e.g. Main website"
                  onChange={e => setAdding({ ...adding, label: e.target.value })} /></div>
              <div><label className={label}>Allowed domains — one per line (blank = any)</label>
                <textarea rows={2} className={input + ' resize-none font-mono text-xs'} value={adding.origins}
                  placeholder={'peninsulasidingcompany.com\nwww.peninsulasidingcompany.com'}
                  onChange={e => setAdding({ ...adding, origins: e.target.value })} /></div>
              <div className="flex gap-2">
                <button onClick={addSite} className="btn-glass px-4 py-2 rounded-xl text-sm font-semibold">Create</button>
                <button onClick={() => { setAdding(null); setErr(''); }} className="btn-ghost px-4 py-2 rounded-xl text-sm">Cancel</button>
              </div>
            </div>
          )}

          <div className="space-y-2">
            {sites.length === 0 && !adding && (
              <div className="text-xs text-dim italic py-3 text-center">No embeds yet — create one to get your website snippet.</div>
            )}
            {sites.map(s => (
              <div key={s.id} className="glass-inner rounded-xl p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <input className={input + ' !py-1 flex-1 font-medium'} value={s.label} disabled={!canWrite}
                    onChange={e => setSites(ss => ss.map(x => x.id === s.id ? { ...x, label: e.target.value } : x))}
                    onBlur={e => saveSite(s.id, { label: e.target.value })} />
                  <button onClick={() => saveSite(s.id, { active: !s.active })} disabled={!canWrite}
                    className={`px-2 py-1 text-[10px] font-bold uppercase rounded-lg shrink-0 ${s.active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}>
                    {s.active ? 'Live' : 'Paused'}
                  </button>
                  {canWrite && <button onClick={() => removeSite(s)} className="text-red-500 hover:text-red-600 text-sm shrink-0" title="Delete">×</button>}
                </div>
                <div><label className={label}>Allowed domains</label>
                  <textarea rows={2} className={input + ' !py-1 resize-none font-mono text-[11px]'} disabled={!canWrite}
                    value={lines(s.allowed_origins)} placeholder="blank = any"
                    onChange={e => setSites(ss => ss.map(x => x.id === s.id ? { ...x, allowed_origins: e.target.value.split('\n') } : x))}
                    onBlur={e => saveSite(s.id, { allowed_origins: toArr(e.target.value) })} /></div>
                <div className="flex flex-wrap gap-2 pt-1">
                  <button onClick={() => copy(snippet(s), 'w' + s.id)}
                    className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-ember/15 text-ember-deep border border-ember/25 hover:bg-ember/25">
                    {copied === 'w' + s.id ? '✓ Copied' : 'Copy website snippet'}
                  </button>
                  <button onClick={() => copy(pageLink(s), 'p' + s.id)}
                    className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-card border border-bdr text-muted hover:text-paper">
                    {copied === 'p' + s.id ? '✓ Copied' : 'Copy full-page link'}
                  </button>
                  <a href={pageLink(s)} target="_blank" rel="noreferrer"
                    className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-card border border-bdr text-muted hover:text-paper">Open ↗</a>
                  <span className="text-[10px] text-dim font-mono self-center ml-auto">{s.site_key}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Pricing ────────────────────────────────────────────────────── */}
        <div className="pt-1 border-t border-bdr">
          <div className="flex items-center gap-2 mt-4 mb-1">
            <div className="text-sm font-medium text-paper">What it can quote</div>
            <button type="button" disabled={!canWrite} onClick={() => savePb({ estimates_enabled: !pb.estimates_enabled })}
              className="ml-auto flex items-center gap-2 disabled:opacity-60">
              <span className={`text-[10px] font-bold uppercase ${pb.estimates_enabled ? 'text-emerald-600' : 'text-dim'}`}>
                {pb.estimates_enabled ? 'Gives ranges' : 'No figures'}
              </span>
              <div className={`relative w-10 h-6 rounded-full transition ${pb.estimates_enabled ? 'bg-emerald-500' : 'bg-slate-300'}`}>
                <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${pb.estimates_enabled ? 'left-[18px]' : 'left-0.5'}`} />
              </div>
            </button>
          </div>
          <div className="text-xs text-muted mb-2">
            Figures come from your live catalogue and the same engine the quote builder uses, then widen
            into a range. The assistant cannot say a number that didn't come from it.
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div><label className={label}>Range width (±%)</label>
              <input type="number" min="0" max="100" className={input} disabled={!canWrite}
                value={Math.round((pb.estimate_band ?? 0.15) * 100)}
                onChange={e => setPb({ ...pb, estimate_band: (Number(e.target.value) || 0) / 100 })}
                onBlur={e => savePb({ estimate_band: Math.min(1, Math.max(0, (Number(e.target.value) || 0) / 100)) })} />
              <div className="text-[10px] text-dim mt-0.5">15% either side of the engine price.</div></div>
            <div><label className={label}>Round to nearest</label>
              <input type="number" min="1" className={input} disabled={!canWrite}
                value={pb.estimate_rounding ?? 500}
                onChange={e => setPb({ ...pb, estimate_rounding: Number(e.target.value) })}
                onBlur={e => savePb({ estimate_rounding: Math.max(1, Number(e.target.value) || 500) })} /></div>
            <div><label className={label}>Priceable sq ft</label>
              <div className="flex gap-1">
                <input type="number" className={input} disabled={!canWrite} value={pb.min_sqft ?? 100}
                  onChange={e => setPb({ ...pb, min_sqft: Number(e.target.value) })}
                  onBlur={e => savePb({ min_sqft: Number(e.target.value) || 0 })} />
                <input type="number" className={input} disabled={!canWrite} value={pb.max_sqft ?? 25000}
                  onChange={e => setPb({ ...pb, max_sqft: Number(e.target.value) })}
                  onBlur={e => savePb({ max_sqft: Number(e.target.value) || 25000 })} />
              </div>
              <div className="text-[10px] text-dim mt-0.5">Outside this it hands over.</div></div>
          </div>
          <div className="grid grid-cols-2 gap-2 mt-2">
            <button type="button" disabled={!canWrite} onClick={() => savePb({ contact_first: !pb.contact_first })}
              className="flex items-center gap-3 p-2.5 glass-inner rounded-xl text-left disabled:opacity-60">
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium text-paper">Contact details first</div>
                <div className="text-[10px] text-muted">Captures before they drop off</div>
              </div>
              <div className={`relative w-9 h-5 rounded-full transition shrink-0 ${pb.contact_first ? 'bg-emerald-500' : 'bg-slate-300'}`}>
                <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${pb.contact_first ? 'left-[18px]' : 'left-0.5'}`} />
              </div>
            </button>
            <button type="button" disabled={!canWrite} onClick={() => savePb({ booking_enabled: !pb.booking_enabled })}
              className="flex items-center gap-3 p-2.5 glass-inner rounded-xl text-left disabled:opacity-60">
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium text-paper">Always close on booking</div>
                <div className="text-[10px] text-muted">Offers the free on-site estimate</div>
              </div>
              <div className={`relative w-9 h-5 rounded-full transition shrink-0 ${pb.booking_enabled ? 'bg-emerald-500' : 'bg-slate-300'}`}>
                <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${pb.booking_enabled ? 'left-[18px]' : 'left-0.5'}`} />
              </div>
            </button>
          </div>
          <div className="mt-2"><label className={label}>Nurture below this budget ($)</label>
            <input type="number" className={input} disabled={!canWrite} value={pb.nurture_budget_floor ?? 5000}
              onChange={e => setPb({ ...pb, nurture_budget_floor: Number(e.target.value) })}
              onBlur={e => savePb({ nurture_budget_floor: Number(e.target.value) || 0 })} />
            <div className="text-[10px] text-dim mt-1">
              A stated budget ceiling under this scores the lead nurture, even with damage and a rush —
              an unaffordable job is not a rep's next call.
            </div></div>
          <div className="mt-2"><label className={label}>Measuring tool link</label>
            <input className={input} disabled={!canWrite} value={pb.measure_tool_url || ''}
              placeholder="https://peninsulasidingcompany.com/instant-quote"
              onChange={e => setPb({ ...pb, measure_tool_url: e.target.value })}
              onBlur={e => savePb({ measure_tool_url: e.target.value.trim() || null })} />
            <div className="text-[10px] text-dim mt-1">
              Where it sends anyone who doesn't know their wall area. It keeps the conversation going and
              still captures the lead either way.
            </div></div>
        </div>

        {/* ── Knowledge ──────────────────────────────────────────────────── */}
        <div className="pt-1 border-t border-bdr">
          <div className="flex items-center gap-2 mt-4 mb-1">
            <div className="text-sm font-medium text-paper">What it may state as fact</div>
            <span className="text-xs text-dim font-mono">({docs.length})</span>
          </div>
          <div className="text-xs text-muted">
            Process, materials, warranty, service area. Anything not in here it will not answer — it says so
            and hands over. Prices are refused on the way in; those only ever come from the quote engine.
          </div>
          {learned && <div className="text-xs text-emerald-600 mt-1">{learned}</div>}

          {docs.length > 0 && (
            <div className="mt-2">
              <button onClick={() => setShowDocs(v => !v)} className="text-xs text-ember hover:text-ember-deep font-medium">
                {showDocs ? 'Hide' : 'Review'} what it knows ({docs.length})
              </button>
              {showDocs && (
                <div className="mt-2 max-h-72 overflow-y-auto space-y-1">
                  {docs.map(d => (
                    <div key={d.id} className="glass-inner rounded-xl px-3 py-2 flex items-center gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="text-xs text-paper truncate">{d.title || d.question}</div>
                        <div className="text-[10px] text-dim truncate">
                          {[d.category, d.source === 'doc' ? 'from a page' : 'added by hand'].filter(Boolean).join(' · ')}
                        </div>
                      </div>
                      <button onClick={() => saveDoc(d.id, { active: !d.active })} disabled={!canWrite}
                        className={`px-2 py-0.5 text-[9px] font-bold uppercase rounded shrink-0 ${d.active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}>
                        {d.active ? 'In use' : 'Off'}
                      </button>
                      {canWrite && <button onClick={() => removeDoc(d)} className="text-red-500 hover:text-red-600 text-xs shrink-0">×</button>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {canWrite && (
            <div className="glass-inner rounded-xl p-3 mt-3 space-y-2">
              <div className="text-xs font-medium text-paper">Teach it</div>
              <input className={input + ' !py-1.5 text-xs'} placeholder="https://… a page on your site, or a manufacturer spec page"
                value={teach.url} onChange={e => setTeach({ ...teach, url: e.target.value })} />
              <textarea rows={3} className={input + ' resize-none text-xs'}
                placeholder="…or paste your own notes: how the process works, what the warranty covers, which towns you cover"
                value={teach.text} onChange={e => setTeach({ ...teach, text: e.target.value })} />
              <div className="flex items-center gap-2">
                <button onClick={teachFrom} disabled={teaching}
                  className="btn-glass px-4 py-1.5 rounded-xl text-xs font-semibold disabled:opacity-50">
                  {teaching ? 'Reading…' : 'Learn from this'}
                </button>
                <span className="text-[10px] text-dim">Anything with a price in it is skipped on purpose.</span>
              </div>
            </div>
          )}
        </div>

        {/* ── Playbook ───────────────────────────────────────────────────── */}
        <div className="pt-1 border-t border-bdr">
          <div className="text-sm font-medium text-paper mt-4 mb-2">What it says</div>
          <div className="space-y-2">
            <div><label className={label}>Who you are</label>
              <textarea rows={2} className={input + ' resize-none'} value={pb.business_context || ''} disabled={!canWrite}
                placeholder="e.g. You work for Peninsula Siding Company, a James Hardie installer on the SF Peninsula."
                onChange={e => setPb({ ...pb, business_context: e.target.value })}
                onBlur={e => savePb({ business_context: e.target.value })} />
              <div className="text-[10px] text-dim mt-1">Stops it inventing a company or claiming to be a manufacturer.</div></div>
            <div><label className={label}>Service area</label>
              <input className={input} value={pb.service_area || ''} disabled={!canWrite}
                placeholder="e.g. San Mateo and Santa Clara counties"
                onChange={e => setPb({ ...pb, service_area: e.target.value })}
                onBlur={e => savePb({ service_area: e.target.value })} />
              <div className="text-[10px] text-dim mt-1">Anyone outside it is told kindly, instead of being qualified for nothing.</div></div>
            <div><label className={label}>Greeting</label>
              <input className={input} value={pb.greeting || ''} disabled={!canWrite}
                onChange={e => setPb({ ...pb, greeting: e.target.value })}
                onBlur={e => savePb({ greeting: e.target.value })} /></div>
            <div><label className={label}>Tone</label>
              <input className={input} value={pb.tone || ''} disabled={!canWrite}
                onChange={e => setPb({ ...pb, tone: e.target.value })}
                onBlur={e => savePb({ tone: e.target.value })} /></div>
            <div>
              <label className={label}>What it asks, stage by stage</label>
              <div className="text-[10px] text-dim mb-2">
                Worked through in order, one question at a time, never as a form. Stage 1 is required —
                a conversation with no contact details is a lost lead. The rest are skippable.
              </div>
              <div className="space-y-2">
                {(pb.question_stages || []).map((st, i) => (
                  <div key={st.stage ?? i} className="glass-inner rounded-xl p-3">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="w-5 h-5 rounded-full bg-ember text-white text-[10px] font-bold flex items-center justify-center shrink-0">{st.stage ?? i + 1}</span>
                      <input className={input + ' !py-1 flex-1 text-xs font-semibold'} value={st.title || ''} disabled={!canWrite}
                        onChange={e => setStage(i, { title: e.target.value })}
                        onBlur={() => savePb({ question_stages: pb.question_stages })} />
                      <button type="button" disabled={!canWrite} onClick={() => { setStage(i, { required: !st.required }); savePb({ question_stages: (pb.question_stages || []).map((x, j) => j === i ? { ...x, required: !x.required } : x) }); }}
                        className={`px-2 py-0.5 text-[9px] font-bold uppercase rounded shrink-0 ${st.required ? 'bg-amber-500 text-white' : 'bg-card text-dim border border-bdr'}`}>
                        {st.required ? 'Required' : 'Skippable'}
                      </button>
                    </div>
                    <textarea rows={Math.max(2, (st.questions || []).length)} disabled={!canWrite}
                      className={input + ' resize-none text-[11px]'}
                      value={lines(st.questions)}
                      onChange={e => setStage(i, { questions: e.target.value.split('\n') })}
                      onBlur={e => savePb({ question_stages: (pb.question_stages || []).map((x, j) => j === i ? { ...x, questions: toArr(e.target.value) } : x) })} />
                    {st.note && <div className="text-[10px] text-dim mt-1 italic">{st.note}</div>}
                  </div>
                ))}
              </div>
            </div>

            <div>
              <label className={label}>What it states — never asks</label>
              <div className="text-[10px] text-dim mb-2">
                "Is a workmanship warranty important to you?" is a leading question no customer says no to.
                These are said at the right moment instead, once each.
              </div>
              <div className="space-y-1.5">
                {(pb.talking_points || []).map((tp, i) => (
                  <div key={i} className="glass-inner rounded-xl p-2 space-y-1">
                    <input className={input + ' !py-1 text-xs'} value={tp.point || ''} disabled={!canWrite}
                      onChange={e => setPoint(i, { point: e.target.value })}
                      onBlur={() => savePb({ talking_points: pb.talking_points })} />
                    <div className="flex items-center gap-1.5">
                      <span className="text-[9px] font-mono uppercase text-dim shrink-0">when</span>
                      <input className={input + ' !py-1 text-[11px]'} value={tp.when || ''} disabled={!canWrite}
                        onChange={e => setPoint(i, { when: e.target.value })}
                        onBlur={() => savePb({ talking_points: pb.talking_points })} />
                      {canWrite && (
                        <button onClick={() => savePb({ talking_points: (pb.talking_points || []).filter((_, j) => j !== i) })}
                          className="text-red-500 hover:text-red-600 text-xs shrink-0">×</button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              {canWrite && (
                <button onClick={() => savePb({ talking_points: [...(pb.talking_points || []), { point: '', when: '' }] })}
                  className="mt-1.5 text-xs text-ember hover:text-ember-deep font-medium">+ Add a talking point</button>
              )}
            </div>
            <div><label className={label}>When it doesn't know</label>
              <textarea rows={2} className={input + ' resize-none'} value={pb.unknown_reply || ''} disabled={!canWrite}
                onChange={e => setPb({ ...pb, unknown_reply: e.target.value })}
                onBlur={e => savePb({ unknown_reply: e.target.value })} /></div>
            <div><label className={label}>Names it can use — one per line</label>
              <textarea rows={3} className={input + ' resize-none'} value={lines(pb.persona_names)} disabled={!canWrite}
                placeholder={'Dave\nMaria\nTom'}
                onChange={e => setPb({ ...pb, persona_names: e.target.value.split('\n') })}
                onBlur={e => savePb({ persona_names: toArr(e.target.value) })} /></div>
          </div>

          <div className="text-sm font-medium text-paper mt-5 mb-2">What it must not do</div>
          <div className="grid grid-cols-2 gap-2">
            <div><label className={label}>Never answer — hand to a person</label>
              <textarea rows={4} className={input + ' resize-none text-xs'} value={lines(pb.never_answer)} disabled={!canWrite}
                placeholder={'warranty claim\nlawsuit\nrefund'}
                onChange={e => setPb({ ...pb, never_answer: e.target.value.split('\n') })}
                onBlur={e => savePb({ never_answer: toArr(e.target.value) })} /></div>
            <div><label className={label}>Urgent — hand over immediately</label>
              <textarea rows={4} className={input + ' resize-none text-xs'} value={lines(pb.always_escalate)} disabled={!canWrite}
                placeholder={'storm damage\nwater coming in\ninsurance claim'}
                onChange={e => setPb({ ...pb, always_escalate: e.target.value.split('\n') })}
                onBlur={e => savePb({ always_escalate: toArr(e.target.value) })} /></div>
          </div>
          <div className="text-[11px] text-dim mt-1">Matched against what the visitor types. A hit means the AI is never even asked.</div>
        </div>

        {/* ── Recent conversations ───────────────────────────────────────── */}
        {sessions.length > 0 && (
          <div className="pt-1 border-t border-bdr">
            <div className="text-sm font-medium text-paper mt-4 mb-2">Recent conversations</div>
            <div className="space-y-1">
              {sessions.map(s => (
                <div key={s.id} className="glass-inner rounded-xl px-3 py-2 flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-paper truncate">{s.visitor_name || s.visitor_email || 'Anonymous visitor'}</div>
                    <div className="text-[10px] text-dim">
                      {new Date(s.last_at).toLocaleString('en-US', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      {s.estimate ? ` · quoted $${Math.round(s.estimate.low).toLocaleString('en-US')}–$${Math.round(s.estimate.high).toLocaleString('en-US')}` : ''}
                    </div>
                  </div>
                  <span className={`px-2 py-0.5 text-[9px] font-bold uppercase rounded shrink-0 ${
                    s.lead_score === 'hot' ? 'bg-red-100 text-red-700'
                    : s.lead_score === 'warm' ? 'bg-amber-100 text-amber-700'
                    : s.lead_score === 'nurture' ? 'bg-blue-100 text-blue-700'
                    : s.lead_score === 'disqualify' ? 'bg-slate-200 text-slate-500'
                    : s.status === 'handed_over' ? 'bg-amber-100 text-amber-700'
                    : 'bg-slate-200 text-slate-600'}`}>
                    {s.lead_score || (s.status === 'handed_over' ? 'Handed over' : 'Open')}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
