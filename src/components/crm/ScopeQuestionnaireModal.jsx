import { useMemo, useState } from 'react';
import { SECTIONS, missingRequired } from '../../lib/scopeQuestionnaire';

// The gate on manual lead creation: the Homeowner Siding Scope-of-Work
// Questionnaire as a popup. Save stays disabled until every required question
// is answered, and the sidebar shows exactly which sections still owe answers —
// a blocked save with no explanation is how forms get abandoned.
//
// The same modal edits an existing questionnaire: pass `initial` and the
// answers arrive pre-filled.

export default function ScopeQuestionnaireModal({ leadName, initial, onComplete, onCancel }) {
  const [answers, setAnswers] = useState(() => initial || {});
  const [active, setActive] = useState(SECTIONS[0].key);
  const [showMissing, setShowMissing] = useState(false);

  const set = (sectionKey, fieldKey, value) =>
    setAnswers(prev => ({ ...prev, [sectionKey]: { ...(prev[sectionKey] || {}), [fieldKey]: value } }));

  const missing = useMemo(() => missingRequired(answers), [answers]);
  const missingBySection = useMemo(() => {
    const m = {};
    for (const x of missing) m[x.section] = (m[x.section] || 0) + 1;
    return m;
  }, [missing]);
  const complete = missing.length === 0;

  const section = SECTIONS.find(s => s.key === active) || SECTIONS[0];
  const a = answers[section.key] || {};

  const input = "w-full px-3 py-2 bg-card border border-bdr rounded-xl text-sm text-paper placeholder-dim focus:outline-none focus:border-ember";
  const chip = (on) => `px-3 py-1.5 rounded-xl text-xs font-medium border transition ${
    on ? 'bg-ember text-white border-ember' : 'bg-card text-muted border-bdr hover:text-paper'}`;

  const renderField = (f) => {
    if (f.showIf && !f.showIf(a)) return null;
    const v = a[f.key] ?? (f.type === 'multi' ? [] : '');
    return (
      <div key={f.key}>
        <div className="text-xs text-paper mb-1.5">
          {f.label}
          {f.required && <span className="text-ember ml-1">*</span>}
        </div>
        {f.type === 'choice' && (
          <div className="flex flex-wrap gap-1.5">
            {f.options.map(o => (
              <button key={o} type="button" className={chip(v === o)}
                onClick={() => set(section.key, f.key, v === o ? '' : o)}>{o}</button>
            ))}
          </div>
        )}
        {f.type === 'multi' && (
          <div className="flex flex-wrap gap-1.5">
            {f.options.map(o => {
              const on = v.includes(o);
              return (
                <button key={o} type="button" className={chip(on)}
                  onClick={() => set(section.key, f.key, on ? v.filter(x => x !== o) : [...v, o])}>{o}</button>
              );
            })}
          </div>
        )}
        {f.type === 'text' && (
          <input className={input} value={v} onChange={e => set(section.key, f.key, e.target.value)} />
        )}
        {f.type === 'textarea' && (
          <textarea rows={3} className={input + ' resize-none'} value={v}
            onChange={e => set(section.key, f.key, e.target.value)} />
        )}
      </div>
    );
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      onClick={e => e.target === e.currentTarget && onCancel()}>
      <div className="glass-card rounded-2xl w-full max-w-3xl h-[85vh] flex flex-col overflow-hidden">

        <div className="px-5 py-4 border-b border-bdr flex items-center gap-3 shrink-0">
          <div>
            <div className="text-base font-bold text-paper">Scope-of-work questionnaire</div>
            <div className="text-xs text-muted">
              {leadName ? <>Required before <span className="text-paper font-medium">{leadName}</span> can be created — </> : null}
              establishes expectations and separates included work from allowances and exclusions.
            </div>
          </div>
          <div className={`ml-auto text-xs font-mono px-2.5 py-1 rounded-lg shrink-0 ${
            complete ? 'bg-emerald-100 text-emerald-700' : 'bg-amber/15 text-amber'}`}>
            {complete ? 'Complete' : `${missing.length} required left`}
          </div>
        </div>

        <div className="flex-1 min-h-0 flex">
          {/* Section rail — where you are, and what still owes answers */}
          <div className="w-56 shrink-0 border-r border-bdr overflow-y-auto p-2 space-y-0.5">
            {SECTIONS.map(s => {
              const owed = missingBySection[s.title] || 0;
              return (
                <button key={s.key} onClick={() => setActive(s.key)}
                  className={`w-full text-left px-3 py-2 rounded-xl text-xs transition flex items-center gap-2 ${
                    active === s.key ? 'bg-ember/10 text-ember-deep font-semibold' : 'text-muted hover:text-paper hover:bg-card'}`}>
                  <span className="flex-1 min-w-0 truncate">{s.title}</span>
                  {owed > 0
                    ? <span className="shrink-0 w-4 h-4 rounded-full bg-amber text-white text-[9px] font-bold flex items-center justify-center">{owed}</span>
                    : <span className="shrink-0 text-emerald-600 text-[10px]">✓</span>}
                </button>
              );
            })}
          </div>

          {/* The active section */}
          <div className="flex-1 min-w-0 overflow-y-auto p-5 space-y-4">
            <div className="text-sm font-bold text-paper">{section.title}</div>
            {section.hint && <div className="text-[11px] text-dim -mt-2">{section.hint}</div>}
            {section.fields.map(renderField)}
          </div>
        </div>

        <div className="px-5 py-3.5 border-t border-bdr flex items-center gap-2 shrink-0">
          {!complete && showMissing && (
            <div className="absolute bottom-16 left-5 right-5 max-h-48 overflow-y-auto glass-raised rounded-xl shadow-xl p-3 text-xs space-y-1 z-10">
              {missing.map((m, i) => (
                <div key={i} className="flex gap-2"><span className="text-dim shrink-0">{m.section}</span>
                  <span className="text-paper">{m.field}</span></div>
              ))}
            </div>
          )}
          <button onClick={onCancel} className="btn-ghost px-4 py-2 rounded-xl text-sm">Cancel</button>
          {!complete && (
            <button onClick={() => setShowMissing(v => !v)}
              className="text-xs text-amber hover:underline underline-offset-2">
              {showMissing ? 'Hide' : 'Show'} what's missing
            </button>
          )}
          <button disabled={!complete} onClick={() => onComplete(answers)}
            className="ml-auto btn-glass px-5 py-2 rounded-xl text-sm font-semibold disabled:opacity-40">
            {initial ? 'Save changes' : 'Complete & create lead'}
          </button>
        </div>
      </div>
    </div>
  );
}
