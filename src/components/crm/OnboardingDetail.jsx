import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import AssociationManager from './AssociationManager.jsx';
import ActivityTimeline from './ActivityTimeline.jsx';

const STAGES = [
  'kickoff','hardware_ordered','hardware_shipped','account_menu_config',
  'staff_training','go_live_scheduled','live','handover_to_support'
];
const STAGE_LABELS = {
  kickoff:'Kickoff', hardware_ordered:'HW Ordered', hardware_shipped:'HW Shipped',
  account_menu_config:'Config', staff_training:'Training', go_live_scheduled:'Go-Live Sched.',
  live:'Live', handover_to_support:'Handover',
};

export default function OnboardingDetail({ onboardingId, profile, onClose, onNavigate }) {
  const [ob, setOb] = useState(null);
  const [company, setCompany] = useState(null);
  const [members, setMembers] = useState([]);
  const [history, setHistory] = useState([]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({});
  const [tab, setTab] = useState('overview');

  const canWrite = profile.role === 'owner' || profile.role === 'editor';

  useEffect(() => { load(); }, [onboardingId]);

  const load = async () => {
    const [o, m, h] = await Promise.all([
      supabase.from('onboardings').select('*').eq('id', onboardingId).single(),
      supabase.from('profiles').select('id, email, display_name'),
      supabase.from('stage_history').select('*').eq('object_type', 'onboarding').eq('object_id', onboardingId).order('changed_at', { ascending: false }),
    ]);
    setOb(o.data);
    setMembers(m.data || []);
    setHistory(h.data || []);
    if (o.data?.company_id) {
      const { data: c } = await supabase.from('companies').select('id, name').eq('id', o.data.company_id).single();
      setCompany(c);
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
    setEditing(false);
    load();
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

  if (!ob) return <div className="h-full flex items-center justify-center text-dim text-sm">Loading...</div>;

  const ownerName = (id) => {
    const m = members.find(u => u.id === id);
    return m ? (m.display_name || m.email.split('@')[0]) : 'Unassigned';
  };

  const input = "w-full px-3 py-2 bg-card border border-bdr rounded text-sm text-paper placeholder-dim focus:outline-none focus:border-ember";
  const label = "text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-dim mb-1 block";
  const tabBtn = (t, lbl) => (
    <button onClick={() => setTab(t)}
      className={`px-3 py-1.5 text-xs font-medium rounded transition ${tab === t ? 'bg-card text-paper' : 'text-muted hover:text-paper'}`}>
      {lbl}
    </button>
  );

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 py-4 border-b border-bdr flex items-center gap-3">
        <button onClick={onClose} className="text-muted hover:text-paper text-sm">&larr;</button>
        <div className="flex-1 min-w-0">
          <div className="text-lg font-bold text-paper truncate">
            <span className="text-ember cursor-pointer hover:underline" onClick={() => onNavigate?.('company', ob.company_id)}>
              {company?.name || 'Unknown'}
            </span>
            {' '}Onboarding
          </div>
          <div className="text-[10px] text-dim font-mono uppercase tracking-[0.18em]">
            {STAGE_LABELS[ob.stage]} / Owner: {ownerName(ob.owner_id)}
          </div>
        </div>
        {canWrite && !editing && (
          <button onClick={startEdit} className="px-3 py-1.5 bg-card border border-bdr rounded text-xs text-muted hover:text-paper">Edit</button>
        )}
      </div>

      {canWrite && (
        <div className="px-6 py-2 border-b border-bdr flex gap-0.5 overflow-x-auto">
          {STAGES.map((s, i) => {
            const isActive = ob.stage === s;
            const isPast = STAGES.indexOf(ob.stage) > i;
            return (
              <button key={s} onClick={() => changeStage(s)}
                className={`px-2 py-1 text-[9px] font-bold uppercase rounded transition whitespace-nowrap ${
                  isActive ? 'bg-ember text-ink' : isPast ? 'bg-ember/20 text-ember' : 'bg-card text-dim hover:text-paper'
                }`}>
                {STAGE_LABELS[s]}
              </button>
            );
          })}
        </div>
      )}

      <div className="px-6 py-2 border-b border-bdr flex gap-1">
        {tabBtn('overview', 'Overview')}
        {tabBtn('contacts', 'Contacts')}
        {tabBtn('history', 'Stage History')}
        {tabBtn('activity', 'Activity')}
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-3xl">
          {tab === 'overview' && !editing && (
            <div className="grid grid-cols-2 gap-4">
              <Field label="Stage" value={STAGE_LABELS[ob.stage]} />
              <Field label="Owner" value={ownerName(ob.owner_id)} />
              {ob.notes && <div className="col-span-2"><div className={label}>Notes</div><div className="text-sm text-paper whitespace-pre-wrap">{ob.notes}</div></div>}
            </div>
          )}

          {tab === 'overview' && editing && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div><label className={label}>Stage</label>
                  <select className={input} value={draft.stage} onChange={e => set('stage', e.target.value)}>
                    {STAGES.map(s => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}
                  </select>
                </div>
                <div><label className={label}>Owner</label>
                  <select className={input} value={draft.owner_id || ''} onChange={e => set('owner_id', e.target.value || null)}>
                    <option value="">Unassigned</option>
                    {members.map(m => <option key={m.id} value={m.id}>{m.display_name || m.email}</option>)}
                  </select>
                </div>
              </div>
              <div><label className={label}>Notes</label><textarea className={input + ' resize-none'} rows={3} value={draft.notes || ''} onChange={e => set('notes', e.target.value)} /></div>
              <div className="flex gap-2"><button onClick={save} className="px-4 py-2 bg-ember text-ink text-sm font-semibold rounded">Save</button>
                <button onClick={() => setEditing(false)} className="px-4 py-2 text-sm text-muted border border-bdr rounded">Cancel</button></div>
            </div>
          )}

          {tab === 'contacts' && <AssociationManager subjectType="onboarding" subjectId={onboardingId} targetType="contact" profile={profile} onNavigate={onNavigate} />}

          {tab === 'history' && (
            <div>
              <div className={label + ' mb-3'}>Stage history ({history.length})</div>
              <div className="space-y-2">
                {history.map(h => (
                  <div key={h.id} className="flex items-center gap-3 text-xs py-2 border-b border-bdr last:border-b-0">
                    <span className="text-muted">{ownerName(h.changed_by)}</span>
                    <span className="text-dim">{h.from_stage ? STAGE_LABELS[h.from_stage] : 'Created'} &rarr; {STAGE_LABELS[h.to_stage]}</span>
                    <span className="text-dim ml-auto">{new Date(h.changed_at).toLocaleDateString('en-GB', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' })}</span>
                  </div>
                ))}
                {history.length === 0 && <div className="text-xs text-dim italic py-3">No history.</div>}
              </div>
            </div>
          )}

          {tab === 'activity' && <ActivityTimeline subjectType="onboarding" subjectId={onboardingId} profile={profile} />}
        </div>
      </div>
    </div>
  );
}

function Field({ label, value }) {
  return (<div><div className="text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-dim mb-0.5">{label}</div>
    <div className="text-sm text-paper">{value || <span className="text-dim italic">--</span>}</div></div>);
}
