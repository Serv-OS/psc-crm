import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

// Settings card for the Claude support assistant. The API key is write-only:
// we store it, confirm presence, but never display it back.
export default function AiSettingsCard({ profile }) {
  const [cfg, setCfg] = useState(null);
  const [keyInput, setKeyInput] = useState('');
  const [tone, setTone] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  const isOwner = profile.role === 'owner';

  useEffect(() => { load(); }, []);

  const load = async () => {
    try {
      const { data } = await supabase.from('ai_settings').select('model, tone, enabled, api_key').eq('id', 1).maybeSingle();
      setCfg(data || {});
      setTone(data?.tone || 'friendly, concise and professional');
      setEnabled(data?.enabled ?? true);
    } catch {
      setCfg({});
    }
  };

  const hasKey = !!cfg?.api_key;

  const save = async () => {
    setError(''); setSaving(true); setSaved(false);
    const patch = { id: 1, tone: tone.trim() || null, enabled, updated_at: new Date().toISOString() };
    if (keyInput.trim()) patch.api_key = keyInput.trim();
    const { error: e } = await supabase.from('ai_settings').upsert(patch, { onConflict: 'id' });
    setSaving(false);
    if (e) { setError(e.message); return; }
    setKeyInput('');
    setSaved(true); setTimeout(() => setSaved(false), 2500);
    load();
  };

  const input = "w-full px-3 py-2 bg-card border border-bdr rounded-xl text-sm text-paper placeholder-dim focus:outline-none focus:border-ember";
  const label = "text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-dim mb-1 block";

  if (cfg === null) return null;

  return (
    <div className="glass-card rounded-2xl overflow-hidden">
      <div className="px-5 py-4 border-b border-bdr flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-ember/15 border border-ember/25 flex items-center justify-center text-lg">✨</div>
        <div className="flex-1">
          <div className="text-base font-bold text-paper">AI Assistant (Claude)</div>
          <div className="text-xs text-muted">One-click AI reply drafts on support tickets — any channel</div>
        </div>
        {hasKey && <span className="text-xs font-semibold text-emerald-600">Configured</span>}
      </div>

      <div className="p-5 space-y-4">
        {!isOwner ? (
          <div className="text-sm text-muted">An owner manages the AI assistant configuration.</div>
        ) : (
          <>
            <div>
              <label className={label}>Anthropic API key</label>
              <input className={input} type="password" autoComplete="off"
                value={keyInput} onChange={e => setKeyInput(e.target.value)}
                placeholder={hasKey ? '•••••••••••• (saved — paste a new key to replace)' : 'sk-ant-...'} />
              <div className="text-[11px] text-dim mt-1">
                Stored securely server-side and used only to draft replies. Create one at console.anthropic.com → API keys.
              </div>
            </div>

            <div>
              <label className={label}>Reply tone</label>
              <input className={input} value={tone} onChange={e => setTone(e.target.value)}
                placeholder="friendly, concise and professional" />
            </div>

            <button type="button" onClick={() => setEnabled(!enabled)}
              className="w-full flex items-center gap-3 p-3 glass-inner rounded-xl text-left">
              <div className="flex-1">
                <div className="text-sm font-medium text-paper">AI drafting enabled</div>
                <div className="text-xs text-muted">Show the “✨ AI reply” button on tickets</div>
              </div>
              <div className={`relative w-10 h-6 rounded-full transition shrink-0 ${enabled ? 'bg-emerald-500' : 'bg-slate-300'}`}>
                <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${enabled ? 'left-[18px]' : 'left-0.5'}`} />
              </div>
            </button>

            {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{error}</div>}

            <div className="flex items-center gap-3">
              <button onClick={save} disabled={saving}
                className="btn-glass px-5 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50">
                {saving ? 'Saving…' : 'Save'}
              </button>
              {saved && <span className="text-sm text-emerald-600 font-medium">✓ Saved</span>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
