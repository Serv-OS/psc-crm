import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

const TYPE_ICON = { call: '\u{1F4DE}', email: '\u{1F4E7}', sms: '\u{1F4AC}', note: '\u{1F4DD}', meeting: '\u{1F91D}', whatsapp: '\u{1F4F2}' };
const TYPE_LABEL = { call: 'Call', email: 'Email', sms: 'SMS', note: 'Note', meeting: 'Meeting', whatsapp: 'WhatsApp' };

export default function ActivityTimeline({ subjectType, subjectId, profile }) {
  const [activities, setActivities] = useState([]);
  const [members, setMembers] = useState([]);
  const [adding, setAdding] = useState(false);
  const [type, setType] = useState('note');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [direction, setDirection] = useState('outbound');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');

  const canWrite = profile.role === 'owner' || profile.role === 'editor';

  const generateDraft = async () => {
    setAdding(true); setAiLoading(true); setAiError('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ ticket_id: subjectId }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Could not generate a draft.');
      setBody(d.draft || '');
      if (d.suggested_type) setType(d.suggested_type);
      if (d.suggested_subject && !subject.trim()) setSubject(d.suggested_subject);
      setDirection('outbound');
    } catch (e) {
      setAiError(e.message);
    }
    setAiLoading(false);
  };

  useEffect(() => { load(); }, [subjectType, subjectId]);

  const load = async () => {
    const [a, m] = await Promise.all([
      supabase.from('crm_activities')
        .select('*')
        .eq('subject_type', subjectType)
        .eq('subject_id', subjectId)
        .order('occurred_at', { ascending: false }),
      supabase.from('profiles').select('id, email, display_name'),
    ]);
    setActivities(a.data || []);
    setMembers(m.data || []);
  };

  const save = async (e) => {
    e.preventDefault();
    if (!body.trim() && !subject.trim()) return;
    await supabase.from('crm_activities').insert({
      type,
      subject: subject.trim() || null,
      body: body.trim() || null,
      subject_type: subjectType,
      subject_id: subjectId,
      direction: type === 'note' ? null : direction,
      actor_id: profile.id,
    });
    setType('note'); setSubject(''); setBody(''); setAdding(false);
    load();
  };

  const getName = (id) => {
    const m = members.find(u => u.id === id);
    return m ? (m.display_name || m.email.split('@')[0]) : 'Unknown';
  };

  const input = "w-full px-3 py-2 bg-card border border-bdr rounded text-sm text-paper placeholder-dim focus:outline-none focus:border-ember";
  const label = "text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-dim mb-1 block";

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className={label + ' mb-0'}>Activity ({activities.length})</div>
        <div className="flex items-center gap-2">
          {canWrite && subjectType === 'ticket' && (
            <button onClick={generateDraft} disabled={aiLoading}
              className="px-2 py-1 text-xs font-semibold rounded-lg bg-ember/15 text-ember-deep border border-ember/25 hover:bg-ember/25 disabled:opacity-50">
              {aiLoading ? 'Generating…' : '✨ AI reply'}</button>
          )}
          {canWrite && !adding && (
            <button onClick={() => setAdding(true)}
              className="px-2 py-1 text-xs text-ember hover:text-ember-deep">+ Log activity</button>
          )}
        </div>
      </div>

      {adding && (
        <form onSubmit={save} className="bg-card border border-bdr rounded-lg p-4 mb-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label}>Type</label>
              <select className={input} value={type} onChange={e => setType(e.target.value)}>
                {Object.entries(TYPE_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
            {type !== 'note' && (
              <div>
                <label className={label}>Direction</label>
                <select className={input} value={direction} onChange={e => setDirection(e.target.value)}>
                  <option value="outbound">Outbound</option>
                  <option value="inbound">Inbound</option>
                </select>
              </div>
            )}
          </div>
          <div>
            <label className={label}>Subject</label>
            <input className={input} value={subject} onChange={e => setSubject(e.target.value)} placeholder="Brief summary" />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className={label + ' mb-0'}>Details</label>
              {subjectType === 'ticket' && (
                <button type="button" onClick={generateDraft} disabled={aiLoading}
                  className="text-[11px] font-semibold text-ember hover:text-ember-deep disabled:opacity-50">
                  {aiLoading ? 'Generating…' : '✨ Draft with AI'}</button>
              )}
            </div>
            <textarea className={input + ' resize-none'} rows={4} value={body} onChange={e => setBody(e.target.value)} placeholder="Notes, details..." />
            {aiError && <div className="text-[11px] text-red-600 mt-1">{aiError}</div>}
            {body && subjectType === 'ticket' && <div className="text-[10px] text-dim mt-1">AI draft — review &amp; edit before saving.</div>}
          </div>
          <div className="flex gap-2">
            <button type="submit" className="px-3 py-1.5 bg-ember text-ink text-xs font-semibold rounded hover:bg-ember-deep">Save</button>
            <button type="button" onClick={() => setAdding(false)} className="px-3 py-1.5 text-xs text-muted border border-bdr rounded">Cancel</button>
          </div>
        </form>
      )}

      <div className="space-y-2">
        {activities.map(a => (
          <div key={a.id} className="flex gap-3 py-2 border-b border-bdr last:border-b-0">
            <div className="text-base mt-0.5">{TYPE_ICON[a.type] || '\u{1F4DD}'}</div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 text-xs">
                <span className="text-paper font-medium">{getName(a.actor_id)}</span>
                <span className="text-dim">{TYPE_LABEL[a.type] || a.type}</span>
                {a.direction && <span className="text-dim">{a.direction === 'inbound' ? '← in' : '→ out'}</span>}
                <span className="text-dim ml-auto">{timeAgo(a.occurred_at)}</span>
              </div>
              {a.subject && <div className="text-sm text-paper mt-0.5">{a.subject}</div>}
              {a.body && <div className="text-xs text-muted mt-1 whitespace-pre-wrap">{a.body}</div>}
            </div>
          </div>
        ))}
        {activities.length === 0 && (
          <div className="text-xs text-dim italic py-4 text-center">No activity yet.</div>
        )}
      </div>
    </div>
  );
}

function timeAgo(ts) {
  const d = (Date.now() - new Date(ts).getTime()) / 1000;
  if (d < 60) return 'just now';
  if (d < 3600) return Math.floor(d / 60) + 'm ago';
  if (d < 86400) return Math.floor(d / 3600) + 'h ago';
  if (d < 2592000) return Math.floor(d / 86400) + 'd ago';
  return new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' });
}
