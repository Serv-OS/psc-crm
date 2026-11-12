import { useState } from 'react';
import { DISQUALIFY_REASONS, OTHER, disqualifyReasonText } from '../../lib/disqualifyReasons';

/**
 * Why is this lead out? Five reasons for a construction company and Other with a typed box
 * (Peter, 12 Nov 2026). Replaces the browser prompt. Confirm stays off until a reason is
 * picked, and for Other until something is typed. onConfirm gets the words to save.
 */
export default function DisqualifyDialog({ leadName, onCancel, onConfirm }) {
  const [reason, setReason] = useState('');
  const [other, setOther] = useState('');
  const [busy, setBusy] = useState(false);
  const text = disqualifyReasonText({ reason, other });

  const confirm = async () => {
    if (!text || busy) return;
    setBusy(true);
    try { await onConfirm(text); } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      onClick={e => e.target === e.currentTarget && !busy && onCancel()}>
      <div className="glass-card rounded-2xl w-full max-w-md flex flex-col overflow-hidden">
        <div className="px-5 py-4 border-b border-bdr">
          <div className="text-base font-bold text-paper">Disqualify lead</div>
          <div className="text-xs text-muted">
            {leadName ? <>Why is <span className="text-paper font-medium">{leadName}</span> out?</> : 'Why is this lead out?'}
          </div>
        </div>

        <div className="px-5 py-4 flex flex-col gap-1.5">
          {DISQUALIFY_REASONS.map((r) => (
            <label key={r.key} className={`flex items-center gap-3 px-3 py-2 rounded-xl cursor-pointer border transition ${reason === r.key ? 'border-ember bg-ember/10 text-paper' : 'border-bdr text-dim hover:text-paper'}`}>
              <input type="radio" name="disqualify_reason" value={r.key} checked={reason === r.key}
                onChange={() => setReason(r.key)} className="accent-ember" />
              <span className="text-sm">{r.label}</span>
            </label>
          ))}
          {reason === OTHER && (
            <textarea autoFocus value={other} onChange={e => setOther(e.target.value)} rows={3} maxLength={300}
              placeholder="Type the reason"
              className="mt-1 w-full px-3 py-2 text-sm rounded-xl bg-card border border-bdr text-paper placeholder:text-dim focus:outline-none focus:border-ember" />
          )}
        </div>

        <div className="px-5 py-3 border-t border-bdr flex justify-end gap-2">
          <button type="button" onClick={onCancel} disabled={busy}
            className="px-3 py-1.5 text-[11px] font-bold text-dim hover:text-paper rounded-lg">Cancel</button>
          <button type="button" onClick={confirm} disabled={!text || busy}
            className="px-3 py-1.5 text-[11px] font-bold text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed">
            {busy ? 'Saving' : 'Disqualify'}
          </button>
        </div>
      </div>
    </div>
  );
}
