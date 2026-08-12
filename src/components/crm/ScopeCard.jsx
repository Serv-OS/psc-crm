import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import ScopeQuestionnaireModal from './ScopeQuestionnaireModal.jsx';
import { SECTIONS, SCOPE_KIND, summarize, missingRequired } from '../../lib/scopeQuestionnaire';

// The scope-of-work questionnaire on the lead record: answered questions only,
// grouped as on the paper form, yes/no as badges and multi-selects as chips —
// not a wall of key:value text. Editing opens the same modal that gated
// creation and saves a NEW version; older versions stay in the activity feed
// as history of what the homeowner said when.
//
// Older leads (and the website/chat ones) predate the gate, so a lead without
// a questionnaire shows a prompt to complete it rather than pretending the
// section doesn't exist.

const YES_NO_TONE = {
  Yes: 'bg-emerald-100 text-emerald-700',
  No: 'bg-slate-200 text-slate-600',
  Unknown: 'bg-amber/15 text-amber',
  Discuss: 'bg-amber/15 text-amber',
};

export default function ScopeCard({ leadId, leadName, profile }) {
  const [row, setRow] = useState(null);      // latest questionnaire activity
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [open, setOpen] = useState(true);
  const canWrite = profile.role === 'owner' || profile.role === 'editor';

  const load = async () => {
    const { data } = await supabase.from('crm_activities')
      .select('id, body, channel_metadata, occurred_at')
      .eq('subject_type', 'lead').eq('subject_id', leadId)
      .eq('channel_metadata->>kind', SCOPE_KIND)
      .order('occurred_at', { ascending: false }).limit(1);
    setRow(data?.[0] || null);
    setLoaded(true);
  };
  useEffect(() => { load(); }, [leadId]);

  const save = async (answers) => {
    setEditing(false);
    const { error } = await supabase.from('crm_activities').insert({
      type: 'note', subject_type: 'lead', subject_id: leadId,
      actor_id: profile.id, is_internal: true,
      body: summarize(answers),
      channel_metadata: { kind: SCOPE_KIND, answers, completed_by: profile.id, completed_at: new Date().toISOString() },
    });
    if (error) { alert('Could not save the questionnaire: ' + error.message); return; }
    load();
  };

  const answers = row?.channel_metadata?.answers || null;
  const missing = answers ? missingRequired(answers).length : null;

  return (
    <div className="glass-card rounded-2xl overflow-hidden">
      <div className="px-5 py-3.5 border-b border-bdr flex items-center gap-2">
        <h3 className="text-[13px] font-bold text-paper">Scope of work</h3>
        {answers && (
          <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${missing === 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-amber/15 text-amber'}`}>
            {missing === 0 ? 'Complete' : `${missing} required missing`}
          </span>
        )}
        {row && <span className="text-[10px] text-dim">{new Date(row.occurred_at).toLocaleDateString('en-US', { day: 'numeric', month: 'short' })}</span>}
        <div className="ml-auto flex items-center gap-2">
          {canWrite && answers && (
            <button onClick={() => setEditing(true)} className="text-xs text-ember hover:text-ember-deep font-medium">Edit</button>
          )}
          {answers && (
            <button onClick={() => setOpen(v => !v)} className="text-xs text-muted hover:text-paper">{open ? 'Collapse' : 'Expand'}</button>
          )}
        </div>
      </div>

      {!loaded ? (
        <div className="p-5 text-xs text-dim italic">Loading…</div>
      ) : !answers ? (
        <div className="p-5 text-center space-y-2">
          <div className="text-xs text-muted">No scope questionnaire on this lead — it predates the checklist, or arrived from the website.</div>
          {canWrite && (
            <button onClick={() => setEditing(true)} className="btn-glass px-4 py-1.5 rounded-xl text-xs font-semibold">
              Complete it now
            </button>
          )}
        </div>
      ) : open && (
        <div className="p-4 space-y-3 max-h-[520px] overflow-y-auto">
          {SECTIONS.map(sec => {
            const a = answers[sec.key] || {};
            const rows = sec.fields.filter(f => (!f.showIf || f.showIf(a)) &&
              (f.type === 'multi' ? (a[f.key] || []).length : String(a[f.key] ?? '').trim()));
            if (!rows.length) return null;
            return (
              <div key={sec.key}>
                <div className="text-[10px] font-mono font-bold uppercase tracking-[0.14em] text-dim mb-1.5">{sec.title}</div>
                <div className="space-y-1.5">
                  {rows.map(f => {
                    const v = a[f.key];
                    return (
                      <div key={f.key} className="flex items-start gap-2 text-xs">
                        <span className="text-muted w-44 shrink-0">{f.label}</span>
                        {f.type === 'multi' ? (
                          <span className="flex flex-wrap gap-1">
                            {v.map(x => <span key={x} className="px-1.5 py-0.5 rounded bg-ember/10 text-ember-deep text-[10px] font-medium">{x}</span>)}
                          </span>
                        ) : YES_NO_TONE[v] ? (
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${YES_NO_TONE[v]}`}>{v}</span>
                        ) : (
                          <span className="text-paper whitespace-pre-wrap">{String(v)}</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editing && (
        <ScopeQuestionnaireModal
          leadName={leadName}
          initial={answers || undefined}
          onComplete={save}
          onCancel={() => setEditing(false)}
        />
      )}
    </div>
  );
}
