import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import TimerButton from './TimerButton.jsx';
import AssociationManager from './AssociationManager.jsx';
import ActivityTimeline from './ActivityTimeline.jsx';
import { BUILD_STAGE_KEYS as STAGES, BUILD_STAGE_LABELS as STAGE_LABELS } from '../../lib/buildStages';

export default function OnboardingDetail({ onboardingId, profile, onClose, onNavigate }) {
  const [ob, setOb] = useState(null);
  const [members, setMembers] = useState([]);
  const [history, setHistory] = useState([]);
  const [projects, setProjects] = useState([]);
  const [deal, setDeal] = useState(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({});
  const [templates, setTemplates] = useState([]);
  const [jobTypes, setJobTypes] = useState([]);
  const [showNewProject, setShowNewProject] = useState(false);
  const [applying, setApplying] = useState(false);

  const canWrite = profile.role === 'owner' || profile.role === 'editor';

  useEffect(() => { load(); }, [onboardingId]);

  const load = async () => {
    const [o, m, h, prj, tpl, autos] = await Promise.all([
      supabase.from('onboardings').select('*').eq('id', onboardingId).single(),
      supabase.from('profiles').select('id, email, display_name'),
      supabase.from('stage_history').select('*').eq('object_type', 'onboarding').eq('object_id', onboardingId).order('changed_at', { ascending: false }),
      supabase.from('crm_projects').select('*').eq('subject_type', 'onboarding').eq('subject_id', onboardingId).order('created_at', { ascending: false }),
      supabase.from('project_templates').select('id, name, description').order('name'),
      supabase.from('automations').select('condition'),
    ]);
    setOb(o.data);
    setMembers(m.data || []);
    setHistory(h.data || []);
    setProjects(prj.data || []);
    setTemplates(tpl.data || []);
    setJobTypes([...new Set((autos.data || []).map(a => a.condition?.job_type).filter(Boolean))].sort());
    if (o.data?.deal_id) {
      const { data: d } = await supabase.from('deals').select('*').eq('id', o.data.deal_id).single();
      setDeal(d);
    }
  };

  const startEdit = () => { setDraft({ ...ob }); setEditing(true); };
  const save = async () => {
    const oldStage = ob.stage;
    const { id, created_at, updated_at, ...patch } = draft;
    await supabase.from('onboardings').update(patch).eq('id', onboardingId);
    if (patch.stage !== oldStage) {
      await supabase.from('stage_history').insert({
        object_type: 'onboarding', object_id: onboardingId,
        from_stage: oldStage, to_stage: patch.stage, changed_by: profile.id,
      });
    }
    setEditing(false); load();
  };
  const set = (k, v) => setDraft({ ...draft, [k]: v });

  const changeStage = async (newStage) => {
    if (newStage === ob.stage) return;
    await supabase.from('onboardings').update({ stage: newStage }).eq('id', onboardingId);
    await supabase.from('stage_history').insert({
      object_type: 'onboarding', object_id: onboardingId,
      from_stage: ob.stage, to_stage: newStage, changed_by: profile.id,
    });
    load();
  };

  const deleteRecord = async () => {
    if (!confirm('Delete this onboarding record?\n\nThis cannot be undone.')) return;
    await supabase.from('onboardings').delete().eq('id', onboardingId);
    onClose();
  };

  const createBlankProject = async () => {
    const name = prompt(`Project name for ${deal?.name || 'this'} build stage:`);
    if (!name?.trim()) return;
    setShowNewProject(false);
    const { data, error } = await supabase.from('crm_projects').insert({
      name: name.trim(), subject_type: 'onboarding', subject_id: onboardingId, owner_id: profile.id,
    }).select().single();
    if (error || !data) { alert('Could not create project: ' + (error?.message || 'unknown error')); return; }
    setProjects(p => [data, ...p]);   // show it on the build stage immediately
  };

  // Stamp a template onto this job via the 076 engine (dedupes server-side).
  const applyTemplate = async (templateId) => {
    setApplying(true);
    const { data, error } = await supabase.rpc('apply_project_template_rpc', {
      p_template_id: templateId, p_subject_type: 'onboarding', p_subject_id: onboardingId,
      p_owner: ob.owner_id || profile.id,
    });
    setApplying(false);
    if (error) { alert('Could not apply template: ' + error.message); return; }
    setShowNewProject(false);
    load();
  };

  if (!ob) return <div className="h-full flex items-center justify-center text-dim text-sm">Loading...</div>;

  const ownerName = (id) => { const m = members.find(u => u.id === id); return m ? (m.display_name || m.email.split('@')[0]) : 'Unassigned'; };

  const input = "w-full px-3 py-2 bg-card border border-bdr rounded-xl text-sm text-paper placeholder-dim focus:outline-none focus:border-ember";
  const label = "text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-dim mb-1 block";

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-6 py-5 border-b border-bdr flex items-center gap-4">
        <button onClick={onClose} className="text-muted hover:text-paper text-lg">&larr;</button>
        <div className="flex-1 min-w-0">
          <div className="text-xl font-bold text-paper truncate">
            {deal?.name || 'Build Stage'}
          </div>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <span className="badge-status bg-orange-100 text-orange-700 border border-orange-200">{STAGE_LABELS[ob.stage]}</span>
            <span className="text-xs text-muted">Owner: {ownerName(ob.owner_id)}</span>
          </div>
        </div>
        {!editing && <TimerButton subjectType="onboarding" subjectId={onboardingId} label={deal?.name || 'Build Stage'} profile={profile} />}
        {canWrite && !editing && (
          <div className="flex gap-2">
            <button onClick={startEdit} className="btn-ghost px-4 py-2 rounded-xl text-sm">Edit</button>
            {profile.role === 'owner' && (
              <button onClick={deleteRecord} className="px-3 py-2 text-xs text-red-600 border border-red-200 rounded-xl hover:bg-red-50 transition">Delete</button>
            )}
          </div>
        )}
      </div>

      {/* Stage progress bar */}
      {canWrite && (
        <div className="px-6 py-2 border-b border-bdr flex gap-0.5 overflow-x-auto">
          {STAGES.map((s, i) => {
            const isActive = ob.stage === s;
            const isPast = STAGES.indexOf(ob.stage) > i;
            return (
              <button key={s} onClick={() => changeStage(s)}
                className={`px-2.5 py-1.5 text-[9px] font-bold uppercase rounded-xl transition whitespace-nowrap ${
                  isActive ? 'bg-ember text-white' : isPast ? 'bg-ember/20 text-ember' : 'bg-card text-dim hover:text-paper'
                }`}>
                {STAGE_LABELS[s]}
              </button>
            );
          })}
        </div>
      )}

      {/* Card grid - everything visible */}
      <div className="flex-1 overflow-y-auto p-6">
        {editing ? (
          <div className="max-w-3xl">
            <Card title="Edit Build Stage">
              <div className="grid grid-cols-2 gap-3">
                <div><label className={label}>Stage</label>
                  <select className={input} value={draft.stage} onChange={e => set('stage', e.target.value)}>
                    {STAGES.map(s => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}
                  </select></div>
                <div><label className={label}>Owner</label>
                  <select className={input} value={draft.owner_id || ''} onChange={e => set('owner_id', e.target.value || null)}>
                    <option value="">Unassigned</option>
                    {members.map(m => <option key={m.id} value={m.id}>{m.display_name || m.email}</option>)}
                  </select></div>
                <div><label className={label}>Job type</label>
                  <select className={input} value={draft.job_type || ''} onChange={e => set('job_type', e.target.value || null)}>
                    <option value="">— None —</option>
                    {[...new Set([...jobTypes, ...(draft.job_type ? [draft.job_type] : [])])].sort().map(jt => (
                      <option key={jt} value={jt}>{jt}</option>
                    ))}
                  </select>
                  <div className="text-[10px] text-dim mt-1">Types come from your template auto-rules (Project templates screen). Picking one auto-creates its projects.</div></div>
              </div>
              <div className="grid grid-cols-2 gap-3 mt-3">
                <div><label className={label}>Expected install date</label>
                  <input type="date" className={input} value={draft.expected_install_date || ''} onChange={e => set('expected_install_date', e.target.value || null)} /></div>
                <div><label className={label}>Hardware delivery date</label>
                  <input type="date" className={input} value={draft.hardware_delivery_date || ''} onChange={e => set('hardware_delivery_date', e.target.value || null)} /></div>
                <div><label className={label}>Demo/Install start date</label>
                  <input type="date" className={input} value={draft.demo_install_start_date || ''} onChange={e => set('demo_install_start_date', e.target.value || null)} /></div>
                <div><label className={label}>Expected completion date</label>
                  <input type="date" className={input} value={draft.expected_completion_date || ''} onChange={e => set('expected_completion_date', e.target.value || null)} /></div>
              </div>
              <div className="mt-3"><label className={label}>Notes</label><textarea className={input + ' resize-none'} rows={3} value={draft.notes || ''} onChange={e => set('notes', e.target.value)} /></div>
              <div className="flex gap-2 mt-4">
                <button onClick={save} className="btn-glass px-5 py-2 rounded-xl text-sm">Save</button>
                <button onClick={() => setEditing(false)} className="btn-ghost px-4 py-2 rounded-xl text-sm">Cancel</button>
              </div>
            </Card>
          </div>
        ) : (
          <div className="grid grid-cols-12 gap-4 max-w-[1400px]">

            {/* LEFT: Key Info + Install Dates + From Deal */}
            <div className="col-span-4 space-y-4">
              <Card title="Key Info">
                <div className="space-y-3">
                  <Field label="Stage" value={STAGE_LABELS[ob.stage]} />
                  <Field label="Owner" value={ownerName(ob.owner_id)} />
                  <Field label="Job type" value={ob.job_type} />
                  <Field label="Created" value={new Date(ob.created_at).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: '2-digit' })} />
                  {ob.notes && <Field label="Notes" value={ob.notes} />}
                </div>
              </Card>

              <Card title="Install Dates">
                <div className="space-y-3">
                  <Field label="Expected install" value={ob.expected_install_date ? new Date(ob.expected_install_date).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: '2-digit' }) : null} />
                  <Field label="Hardware delivery" value={ob.hardware_delivery_date ? new Date(ob.hardware_delivery_date).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: '2-digit' }) : null} />
                  <Field label="Demo/Install start" value={ob.demo_install_start_date ? new Date(ob.demo_install_start_date).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: '2-digit' }) : null} />
                  <Field label="Expected completion" value={ob.expected_completion_date ? new Date(ob.expected_completion_date).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: '2-digit' }) : null} />
                </div>
              </Card>

              {deal && (
                <Card title="From Deal">
                  <div onClick={() => onNavigate?.('deal', deal.id)}
                    className="p-3 glass-inner rounded-xl cursor-pointer">
                    <div className="text-sm font-medium text-paper">{deal.name}</div>
                    <div className="flex items-center gap-2 mt-1">
                      {deal.value && <span className="text-xs text-ember font-mono">${Number(deal.value).toLocaleString('en-US')}</span>}
                      <span className="text-xs text-muted">{deal.stage?.replace(/_/g, ' ')}</span>
                    </div>
                  </div>
                </Card>
              )}
            </div>

            {/* MIDDLE: Activity + Contacts */}
            <div className="col-span-4 space-y-4">
              <Card title="Activity">
                <ActivityTimeline subjectType="onboarding" subjectId={onboardingId} profile={profile} />
              </Card>

              <Card title="Contacts">
                <AssociationManager subjectType="onboarding" subjectId={onboardingId} targetType="contact" profile={profile} onNavigate={onNavigate} />
              </Card>
            </div>

            {/* RIGHT: Projects + Stage History */}
            <div className="col-span-4 space-y-4">
              <Card title="Projects" count={projects.length}
                action={canWrite ? { label: '+ Create', onClick: () => setShowNewProject(true) } : null}>
                {projects.length > 0 ? (
                  <div className="space-y-2">
                    {projects.map(p => (
                      <div key={p.id} onClick={() => onNavigate?.('project', p.id)}
                        className="p-3 glass-inner rounded-xl cursor-pointer">
                        <div className="text-sm font-medium text-paper">{p.name}</div>
                        <div className="text-xs text-muted mt-0.5">{p.status}</div>
                      </div>
                    ))}
                  </div>
                ) : <Empty>No projects linked</Empty>}
              </Card>

              <Card title="Stage History" count={history.length}>
                {history.length > 0 ? (
                  <div className="space-y-2">
                    {history.map(h => (
                      <div key={h.id} className="flex items-center gap-3 text-xs py-1.5">
                        <span className="text-paper">{ownerName(h.changed_by)}</span>
                        <span className="text-muted">{h.from_stage ? STAGE_LABELS[h.from_stage] : 'Created'} &rarr; {STAGE_LABELS[h.to_stage]}</span>
                        <span className="text-dim ml-auto text-[10px]">
                          {new Date(h.changed_at).toLocaleDateString('en-US', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' })}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : <Empty>No stage changes</Empty>}
              </Card>
            </div>
          </div>
        )}
      </div>

      {/* New project chooser: blank, or stamp from a template */}
      {showNewProject && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-6" onClick={() => setShowNewProject(false)}>
          <div className="glass-card rounded-2xl w-full max-w-md max-h-[70vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="px-4 py-3 border-b border-bdr flex items-center justify-between">
              <h3 className="text-sm font-bold text-paper">New project for this job</h3>
              <button onClick={() => setShowNewProject(false)} className="text-muted hover:text-paper">&times;</button>
            </div>
            <div className="p-4 space-y-2">
              <button onClick={createBlankProject} disabled={applying}
                className="w-full text-left p-3 glass-inner rounded-xl hover:border-ember/30 border border-transparent transition">
                <div className="text-sm font-semibold text-paper">Blank project</div>
                <div className="text-[11px] text-dim">Start from scratch and add tasks yourself.</div>
              </button>
              {templates.length > 0 && (
                <div className="text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-dim pt-2">From template</div>
              )}
              {templates.map(t => (
                <button key={t.id} onClick={() => applyTemplate(t.id)} disabled={applying}
                  className="w-full text-left p-3 glass-inner rounded-xl hover:border-ember/30 border border-transparent transition disabled:opacity-50">
                  <div className="text-sm font-semibold text-paper">{'\u{1F4CB}'} {t.name}</div>
                  {t.description && <div className="text-[11px] text-dim line-clamp-2">{t.description}</div>}
                </button>
              ))}
              {applying && <div className="text-xs text-dim text-center py-1">Creating project…</div>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Card({ title, count, action, children }) {
  return (
    <div className="glass-card rounded-2xl overflow-hidden">
      <div className="px-4 py-3 border-b border-bdr flex items-center gap-2">
        <h3 className="text-sm font-bold text-paper">{title}</h3>
        {count !== undefined && <span className="text-xs text-dim font-mono">({count})</span>}
        {action && <button onClick={action.onClick} className="ml-auto text-xs text-ember hover:text-ember-deep font-medium">{action.label}</button>}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function Field({ label, value }) {
  return (
    <div>
      <div className="text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-dim mb-0.5">{label}</div>
      <div className="text-sm text-paper break-words">{value || <span className="text-dim italic">--</span>}</div>
    </div>
  );
}

function Empty({ children }) {
  return <div className="text-xs text-dim italic py-3 text-center">{children}</div>;
}
