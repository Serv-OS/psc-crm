import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import ScopeQuestionnaireModal from './ScopeQuestionnaireModal.jsx';

// One card for both questionnaires: the intro call and the scope of work.
//
// The old layout put the question in a fixed 176px column with the answer
// beside it. Real questions do not fit in 176px, so they wrapped onto two or
// three lines while the one-word answer sat alone at the top right, miles from
// the text it belonged to. The eye had to jump a gap that changed size on every
// row, which is exactly the thing that makes a page tiring to read.
//
// So the answer now sits directly UNDER its question, question quiet and small,
// answer loud. Nothing has to line up, so nothing can fail to line up. On a wide
// screen the pairs flow into two columns to keep the card from becoming a
// scroll, and a long text answer takes the full width rather than being squeezed
// into half of one.

const YES_NO_TONE = {
  Yes: 'bg-emerald-100 text-emerald-700',
  No: 'bg-slate-200 text-slate-600',
  Unknown: 'bg-amber/15 text-amber',
  'Not sure': 'bg-amber/15 text-amber',
  Discuss: 'bg-amber/15 text-amber',
  'Not important to them': 'bg-slate-200 text-slate-600',
};

export default function QuestionnaireCard({
  leadId, leadName, profile,
  sections, kind, missingFn, summarizeFn,
  title, subtitle, emptyHint,
}) {
  const [row, setRow] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [open, setOpen] = useState(true);
  const canWrite = profile.role === 'owner' || profile.role === 'editor';

  const load = async () => {
    const { data } = await supabase.from('crm_activities')
      .select('id, body, channel_metadata, occurred_at')
      .eq('subject_type', 'lead').eq('subject_id', leadId)
      .eq('channel_metadata->>kind', kind)
      .order('occurred_at', { ascending: false }).limit(1);
    setRow(data?.[0] || null);
    setLoaded(true);
  };
  useEffect(() => { load(); }, [leadId, kind]);

  const save = async (answers) => {
    setEditing(false);
    const { error } = await supabase.from('crm_activities').insert({
      type: 'note', subject_type: 'lead', subject_id: leadId,
      actor_id: profile.id, is_internal: true,
      body: summarizeFn(answers),
      channel_metadata: { kind, answers, completed_by: profile.id, completed_at: new Date().toISOString() },
    });
    if (error) { alert('Could not save: ' + error.message); return; }
    load();
  };

  const answers = row?.channel_metadata?.answers || null;
  const missing = answers ? missingFn(answers).length : null;

  const answered = (f, a) => f.type === 'multi'
    ? (a[f.key] || []).length > 0
    : String(a[f.key] ?? '').trim() !== '';

  return (
    <div className="glass-card rounded-2xl overflow-hidden">
      <div className="px-5 py-3.5 border-b border-bdr flex items-center gap-2 flex-wrap">
        <h3 className="text-[13px] font-bold text-paper">{title}</h3>
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
          <div className="text-xs text-muted">{emptyHint}</div>
          {canWrite && (
            <button onClick={() => setEditing(true)} className="btn-glass px-4 py-1.5 rounded-xl text-xs font-semibold">
              Complete it now
            </button>
          )}
        </div>
      ) : open && (
        <div className="p-5 space-y-5 max-h-[560px] overflow-y-auto">
          {sections.map(sec => {
            const a = answers[sec.key] || {};
            const rows = sec.fields.filter(f => (!f.showIf || f.showIf(a)) && answered(f, a));
            if (!rows.length) return null;
            return (
              <div key={sec.key}>
                <div className="text-[10px] font-mono font-bold uppercase tracking-[0.14em] text-ember mb-2.5 pb-1.5 border-b border-bdr">
                  {sec.title}
                </div>
                <div className="grid sm:grid-cols-2 gap-x-6 gap-y-3.5">
                  {rows.map(f => {
                    const v = a[f.key];
                    // Prose gets the whole width. A sentence reflowed into a
                    // half-column is the other way a form becomes unreadable.
                    const wide = f.type === 'text' && String(v).length > 45;
                    return (
                      <div key={f.key} className={wide ? 'sm:col-span-2' : ''}>
                        <div className="text-[11px] text-muted leading-snug mb-1">{f.label}</div>
                        {f.type === 'multi' ? (
                          <div className="flex flex-wrap gap-1">
                            {(v || []).map(x => (
                              <span key={x} className="px-2 py-0.5 rounded-lg bg-ember/10 text-ember-deep text-[11px] font-medium">{x}</span>
                            ))}
                          </div>
                        ) : YES_NO_TONE[v] ? (
                          <span className={`inline-block px-2 py-0.5 rounded-lg text-[10px] font-bold uppercase ${YES_NO_TONE[v]}`}>{v}</span>
                        ) : (
                          <div className="text-sm text-paper font-medium whitespace-pre-wrap leading-snug">{String(v)}</div>
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
          sections={sections}
          missingFn={missingFn}
          title={title}
          subtitle={subtitle}
          onComplete={save}
          onCancel={() => setEditing(false)}
        />
      )}
    </div>
  );
}
