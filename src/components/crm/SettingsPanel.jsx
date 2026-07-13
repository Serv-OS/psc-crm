import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { TEAM_OPTIONS, TEAM_LABELS } from '../UsersPanel.jsx';
import AiSettingsCard from './AiSettingsCard.jsx';
import BrandingCard from './BrandingCard.jsx';
import { connectMicrosoft, useMicrosoftSupportConnection, clearMicrosoftConfigCache } from '../../lib/useMicrosoft.js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

export default function SettingsPanel({ profile }) {
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState(null);
  const [agentCounts, setAgentCounts] = useState({});
  const [stripe, setStripe] = useState(null);
  const [stripeKey, setStripeKey] = useState('');
  const [stripeBusy, setStripeBusy] = useState(false);
  const msSupport = useMicrosoftSupportConnection();

  const isOwner = profile.role === 'owner';

  useEffect(() => { load(); }, []);

  const load = async () => {
    setLoading(true);
    const [ss, profs] = await Promise.all([
      supabase.from('support_settings').select('*').eq('id', 1).maybeSingle(),
      supabase.from('profiles').select('teams'),
    ]);
    setSettings(ss.data || { auto_assign_enabled: true, assign_team: 'support', prefer_online: true });
    // Count members per team for the helper text
    const counts = {};
    (profs.data || []).forEach(p => (p.teams || []).forEach(t => { counts[t] = (counts[t] || 0) + 1; }));
    setAgentCounts(counts);
    setLoading(false);
  };

  const saveSettings = async (patch) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    await supabase.from('support_settings').upsert({
      id: 1,
      auto_assign_enabled: next.auto_assign_enabled,
      assign_team: next.assign_team,
      prefer_online: next.prefer_online,
      voice_greeting: next.voice_greeting ?? null,
      voicemail_prompt: next.voicemail_prompt ?? null,
      voice_id: next.voice_id ?? null,
      auto_reply_email_enabled: next.auto_reply_email_enabled ?? false,
      auto_reply_email_subject: next.auto_reply_email_subject ?? null,
      auto_reply_email_message: next.auto_reply_email_message ?? null,
      auto_reply_sms_enabled: next.auto_reply_sms_enabled ?? false,
      auto_reply_sms_message: next.auto_reply_sms_message ?? null,
      business_hours_enabled: next.business_hours_enabled ?? false,
      business_timezone: next.business_timezone ?? null,
      business_hours: next.business_hours ?? null,
      after_hours_email_subject: next.after_hours_email_subject ?? null,
      after_hours_email_message: next.after_hours_email_message ?? null,
      after_hours_voicemail_prompt: next.after_hours_voicemail_prompt ?? null,
      quote_terms: next.quote_terms ?? null,
      invoice_terms: next.invoice_terms ?? null,
      business_name: next.business_name ?? null,
      business_address: next.business_address ?? null,
      business_email: next.business_email ?? null,
      business_phone: next.business_phone ?? null,
      quote_accent: next.quote_accent ?? null,
      logo_url: next.logo_url ?? null,
      logo_url_dark: next.logo_url_dark ?? null,
      twilio_number: next.twilio_number ?? null,
      microsoft_client_id: next.microsoft_client_id ?? null,
      microsoft_tenant_id: next.microsoft_tenant_id ?? null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'id' });
    clearMicrosoftConfigCache();
  };

  const uploadLogo = async (e, field = 'logo_url') => {
    const file = e.target.files?.[0];
    if (!file) return;
    const ext = (file.name.split('.').pop() || 'png').toLowerCase();
    const path = `${field === 'logo_url_dark' ? 'logo-dark' : 'logo'}-${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from('branding').upload(path, file, { upsert: true, contentType: file.type });
    if (error) { alert('Upload failed: ' + error.message); return; }
    const { data } = supabase.storage.from('branding').getPublicUrl(path);
    setSettings(s => ({ ...s, [field]: data.publicUrl }));
    saveSettings({ [field]: data.publicUrl });
  };
  const clearLogo = (field) => { setSettings(s => ({ ...s, [field]: null })); saveSettings({ [field]: null }); };

  const fnUrl = (p) => `${SUPABASE_URL}/functions/v1/${p}`;
  const authHeader = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    return { Authorization: `Bearer ${session?.access_token}` };
  };

  useEffect(() => { (async () => {
    try {
      const res = await fetch(fnUrl('stripe-connect'), { headers: await authHeader() });
      if (res.ok) setStripe(await res.json());
    } catch { /* ignore */ }
  })(); }, []);

  const connectStripe = async () => {
    if (!stripeKey.trim()) return;
    setStripeBusy(true);
    const res = await fetch(fnUrl('stripe-connect'), {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
      body: JSON.stringify({ secret_key: stripeKey.trim() }),
    });
    const d = await res.json();
    setStripeBusy(false);
    if (!res.ok) { alert(d.error || 'Could not connect Stripe'); return; }
    setStripeKey(''); setStripe({ connected: true, account_name: d.account_name, livemode: d.livemode });
  };

  const disconnectStripe = async () => {
    if (!confirm('Disconnect Stripe? Quotes will no longer be able to take payment.')) return;
    await fetch(fnUrl('stripe-connect'), { method: 'DELETE', headers: await authHeader() });
    setStripe({ connected: false });
  };


  return (
    <div className="h-full flex flex-col">
      <div className="px-6 py-5 border-b border-bdr">
        <div className="text-xl font-bold text-paper">Settings</div>
        <div className="text-xs text-muted">Integrations and configuration</div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-3xl space-y-6">

          {/* Branding & white-label */}
          <BrandingCard profile={profile} />

          {/* AI Assistant (Claude) */}
          <AiSettingsCard profile={profile} />

          {/* Payments (Stripe) */}
          <div className="glass-card rounded-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-bdr flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-200 flex items-center justify-center text-lg">{'\u{1F4B3}'}</div>
              <div className="flex-1">
                <div className="text-base font-bold text-paper">Payments (Stripe)</div>
                <div className="text-xs text-muted">Take payment when customers accept a quote</div>
              </div>
              {stripe?.connected && <span className={`px-2 py-0.5 text-[9px] font-bold uppercase rounded ${stripe.livemode ? 'bg-emerald-100 text-emerald-700 border border-emerald-200' : 'bg-amber-100 text-amber-700 border border-amber-200'}`}>{stripe.livemode ? 'Live' : 'Test'}</span>}
            </div>
            <div className="p-5">
              {stripe?.connected ? (
                <div className="flex items-center gap-3 p-3 glass-inner rounded-xl">
                  <div className="w-8 h-8 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center text-sm font-bold">{'\u{2713}'}</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-paper">{stripe.account_name || 'Stripe account'}</div>
                    <div className="text-xs text-muted">Connected · webhook configured automatically</div>
                  </div>
                  {isOwner && <button onClick={disconnectStripe} className="px-2 py-1 text-xs text-red-600 border border-red-200 rounded-xl hover:bg-red-50">Disconnect</button>}
                </div>
              ) : isOwner ? (
                <div className="space-y-2">
                  <div className="text-sm text-muted">Paste your Stripe <strong>secret key</strong> — we'll verify it and set up the payment webhook for you. No other steps.</div>
                  <div className="flex gap-2">
                    <input type="password" value={stripeKey} onChange={e => setStripeKey(e.target.value)} placeholder="sk_live_… or sk_test_…"
                      className="flex-1 px-3 py-2 bg-card border border-bdr rounded-xl text-sm text-paper placeholder-dim focus:outline-none focus:border-ember font-mono" />
                    <button onClick={connectStripe} disabled={stripeBusy || !stripeKey.trim()} className="btn-glass px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-50">{stripeBusy ? 'Connecting…' : 'Connect'}</button>
                  </div>
                  <div className="text-[11px] text-dim">Find it in Stripe → Developers → API keys. Use a test key first if you want to trial it. The key is stored securely server-side and never shown in the browser.</div>
                </div>
              ) : (
                <div className="text-sm text-dim">Not connected. Ask an owner to connect Stripe.</div>
              )}
            </div>
          </div>

          {/* Ticket auto-assignment */}
          {settings && (
            <div className="glass-card rounded-2xl overflow-hidden">
              <div className="px-5 py-4 border-b border-bdr flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-ember/15 border border-ember/25 flex items-center justify-center text-lg">{'\u{1F39F}'}</div>
                <div className="flex-1">
                  <div className="text-base font-bold text-paper">Ticket auto-assignment</div>
                  <div className="text-xs text-muted">Route new tickets to a team automatically</div>
                </div>
              </div>
              <div className="p-5 space-y-4">
                <button type="button" disabled={!isOwner}
                  onClick={() => saveSettings({ auto_assign_enabled: !settings.auto_assign_enabled })}
                  className="w-full flex items-center gap-3 p-3 glass-inner rounded-xl text-left disabled:opacity-60">
                  <div className="flex-1">
                    <div className="text-sm font-medium text-paper">Enable auto-assignment</div>
                    <div className="text-xs text-muted">New tickets get an owner the moment they arrive</div>
                  </div>
                  <div className={`relative w-10 h-6 rounded-full transition shrink-0 ${settings.auto_assign_enabled ? 'bg-emerald-500' : 'bg-slate-300'}`}>
                    <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${settings.auto_assign_enabled ? 'left-[18px]' : 'left-0.5'}`} />
                  </div>
                </button>

                <div className={settings.auto_assign_enabled ? '' : 'opacity-50 pointer-events-none'}>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-dim mb-1 block">Assign to team</label>
                      <select disabled={!isOwner} value={settings.assign_team}
                        onChange={e => saveSettings({ assign_team: e.target.value })}
                        className="w-full px-3 py-2 bg-card border border-bdr rounded-xl text-sm text-paper focus:outline-none focus:border-ember">
                        {TEAM_OPTIONS.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
                      </select>
                      <div className="text-[11px] text-dim mt-1">
                        {agentCounts[settings.assign_team] || 0} {TEAM_LABELS[settings.assign_team] || settings.assign_team} member{(agentCounts[settings.assign_team] || 0) !== 1 ? 's' : ''}
                        {(agentCounts[settings.assign_team] || 0) === 0 && ' — add some in Users'}
                      </div>
                    </div>
                    <button type="button" disabled={!isOwner}
                      onClick={() => saveSettings({ prefer_online: !settings.prefer_online })}
                      className="flex items-center gap-3 p-3 glass-inner rounded-xl text-left h-fit self-end disabled:opacity-60">
                      <div className="flex-1">
                        <div className="text-sm font-medium text-paper">Prefer online agents</div>
                        <div className="text-xs text-muted">Route to whoever's available first</div>
                      </div>
                      <div className={`relative w-10 h-6 rounded-full transition shrink-0 ${settings.prefer_online ? 'bg-emerald-500' : 'bg-slate-300'}`}>
                        <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${settings.prefer_online ? 'left-[18px]' : 'left-0.5'}`} />
                      </div>
                    </button>
                  </div>
                  <div className="text-xs text-muted mt-3 pt-3 border-t border-bdr leading-relaxed">
                    Tickets are given to the {TEAM_LABELS[settings.assign_team] || settings.assign_team} agent with the fewest open tickets{settings.prefer_online ? ', preferring those currently online' : ''}. Works for tickets from SMS, email, calls and the New ticket form. The assigned agent gets a notification.
                  </div>
                </div>
                {!isOwner && <div className="text-[11px] text-dim">Only owners can change these settings.</div>}
              </div>
            </div>
          )}

          {/* Phone greeting & voicemail */}
          {settings && (
            <div className="glass-card rounded-2xl overflow-hidden">
              <div className="px-5 py-4 border-b border-bdr flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-center text-lg">{'\u{1F4DE}'}</div>
                <div className="flex-1">
                  <div className="text-base font-bold text-paper">Phone &amp; voicemail</div>
                  <div className="text-xs text-muted">What callers hear, spoken by an automated voice</div>
                </div>
              </div>
              <div className="p-5 space-y-4">
                <div>
                  <label className="text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-dim mb-1 block">Voice (how greetings &amp; voicemail sound)</label>
                  <select disabled={!isOwner}
                    className="w-full px-3 py-2 bg-card border border-bdr rounded-xl text-sm text-paper focus:outline-none focus:border-ember disabled:opacity-60"
                    value={settings.voice_id || 'Polly.Amy-Neural'}
                    onChange={e => { setSettings(s => ({ ...s, voice_id: e.target.value })); saveSettings({ voice_id: e.target.value }); }}>
                    <option value="Polly.Amy-Neural">Amy — British, female (natural)</option>
                    <option value="Polly.Emma-Neural">Emma — British, female (warm)</option>
                    <option value="Polly.Brian-Neural">Brian — British, male</option>
                    <option value="Polly.Joanna-Neural">Joanna — US, female</option>
                    <option value="Polly.Danielle-Neural">Danielle — US, female (natural)</option>
                    <option value="Polly.Matthew-Neural">Matthew — US, male</option>
                  </select>
                  <div className="text-[11px] text-dim mt-1">Natural neural voices — replaces the old robotic default. Applies to the next call.</div>
                </div>
                <div>
                  <label className="text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-dim mb-1 block">Greeting (while connecting to an agent)</label>
                  <textarea disabled={!isOwner} rows={2}
                    className="w-full px-3 py-2 bg-card border border-bdr rounded-xl text-sm text-paper placeholder-dim focus:outline-none focus:border-ember resize-none disabled:opacity-60"
                    value={settings.voice_greeting || ''}
                    onChange={e => setSettings(s => ({ ...s, voice_greeting: e.target.value }))}
                    onBlur={e => saveSettings({ voice_greeting: e.target.value })}
                    placeholder="Please hold while we connect you to an agent." />
                </div>
                <div>
                  <label className="text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-dim mb-1 block">Voicemail message (before the beep)</label>
                  <textarea disabled={!isOwner} rows={3}
                    className="w-full px-3 py-2 bg-card border border-bdr rounded-xl text-sm text-paper placeholder-dim focus:outline-none focus:border-ember resize-none disabled:opacity-60"
                    value={settings.voicemail_prompt || ''}
                    onChange={e => setSettings(s => ({ ...s, voicemail_prompt: e.target.value }))}
                    onBlur={e => saveSettings({ voicemail_prompt: e.target.value })}
                    placeholder="Sorry, we can't take your call right now. Please leave a message after the beep." />
                </div>
                <div className="text-[11px] text-dim leading-relaxed pt-1 border-t border-bdr">
                  The greeting plays when a call comes in and agents are online. The voicemail message plays when no one is available or the call isn't answered — the caller's message is then recorded, transcribed and attached to a support ticket.
                  {!isOwner && <span className="block mt-1">Only owners can edit these.</span>}
                </div>
              </div>
            </div>
          )}

          {/* Microsoft 365 email */}
          {settings && (
            <div className="glass-card rounded-2xl overflow-hidden">
              <div className="px-5 py-4 border-b border-bdr flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-center text-lg">{'✉️'}</div>
                <div className="flex-1">
                  <div className="text-base font-bold text-paper">Microsoft 365 email</div>
                  <div className="text-xs text-muted">Support mailbox — inbound mail becomes tickets, replies send from it</div>
                </div>
                {msSupport.connected
                  ? <span className="text-xs font-semibold text-emerald-600">{'●'} {msSupport.connected.email}</span>
                  : <span className="text-xs text-muted">Not connected</span>}
              </div>
              <div className="p-5 space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-dim mb-1 block">Application (client) ID</label>
                    <input disabled={!isOwner}
                      className="w-full px-3 py-2 bg-card border border-bdr rounded-xl text-sm text-paper placeholder-dim focus:outline-none focus:border-ember disabled:opacity-60"
                      value={settings.microsoft_client_id || ''}
                      onChange={e => setSettings(s => ({ ...s, microsoft_client_id: e.target.value }))}
                      onBlur={e => saveSettings({ microsoft_client_id: e.target.value.trim() || null })}
                      placeholder="00000000-0000-0000-0000-000000000000" />
                  </div>
                  <div>
                    <label className="text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-dim mb-1 block">Directory (tenant) ID</label>
                    <input disabled={!isOwner}
                      className="w-full px-3 py-2 bg-card border border-bdr rounded-xl text-sm text-paper placeholder-dim focus:outline-none focus:border-ember disabled:opacity-60"
                      value={settings.microsoft_tenant_id || ''}
                      onChange={e => setSettings(s => ({ ...s, microsoft_tenant_id: e.target.value }))}
                      onBlur={e => saveSettings({ microsoft_tenant_id: e.target.value.trim() || null })}
                      placeholder="your tenant id (or 'common')" />
                  </div>
                </div>
                <div className="flex items-center gap-3 flex-wrap">
                  <button type="button" disabled={!isOwner || !settings.microsoft_client_id} onClick={() => connectMicrosoft(false)}
                    className="btn-glass px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-50">
                    {msSupport.connected ? 'Reconnect support mailbox' : 'Connect support mailbox'}
                  </button>
                  <span className="text-[11px] text-dim">New mail is checked every minute and turned into Support tickets.</span>
                </div>
                <div className="text-[11px] text-dim leading-relaxed">
                  Create an Entra ID app registration with Microsoft Graph <strong>Mail.ReadWrite</strong> + <strong>Mail.Send</strong> (delegated) + <strong>offline_access</strong>, paste its Application &amp; Directory IDs above, then connect the support mailbox.
                </div>
              </div>
            </div>
          )}

          {/* Auto-reply */}
          {settings && (
            <div className="glass-card rounded-2xl overflow-hidden">
              <div className="px-5 py-4 border-b border-bdr flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-center text-lg">{'\u{1F916}'}</div>
                <div className="flex-1">
                  <div className="text-base font-bold text-paper">Auto-reply</div>
                  <div className="text-xs text-muted">Acknowledge inbound email &amp; SMS automatically (first message only)</div>
                </div>
              </div>
              <div className="p-5 space-y-5">
                {/* Email auto-reply */}
                <div>
                  <button type="button" disabled={!isOwner}
                    onClick={() => saveSettings({ auto_reply_email_enabled: !settings.auto_reply_email_enabled })}
                    className="w-full flex items-center gap-3 p-3 glass-inner rounded-xl text-left disabled:opacity-60">
                    <div className="flex-1">
                      <div className="text-sm font-medium text-paper">Email auto-reply</div>
                      <div className="text-xs text-muted">Sent from the connected support mailbox</div>
                    </div>
                    <div className={`relative w-10 h-6 rounded-full transition shrink-0 ${settings.auto_reply_email_enabled ? 'bg-emerald-500' : 'bg-slate-300'}`}>
                      <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${settings.auto_reply_email_enabled ? 'left-[18px]' : 'left-0.5'}`} />
                    </div>
                  </button>
                  <div className={`mt-2 space-y-2 ${settings.auto_reply_email_enabled ? '' : 'opacity-50 pointer-events-none'}`}>
                    <input disabled={!isOwner}
                      className="w-full px-3 py-2 bg-card border border-bdr rounded-xl text-sm text-paper placeholder-dim focus:outline-none focus:border-ember disabled:opacity-60"
                      value={settings.auto_reply_email_subject || ''}
                      onChange={e => setSettings(s => ({ ...s, auto_reply_email_subject: e.target.value }))}
                      onBlur={e => saveSettings({ auto_reply_email_subject: e.target.value })}
                      placeholder="Subject line" />
                    <textarea disabled={!isOwner} rows={4}
                      className="w-full px-3 py-2 bg-card border border-bdr rounded-xl text-sm text-paper placeholder-dim focus:outline-none focus:border-ember resize-none disabled:opacity-60"
                      value={settings.auto_reply_email_message || ''}
                      onChange={e => setSettings(s => ({ ...s, auto_reply_email_message: e.target.value }))}
                      onBlur={e => saveSettings({ auto_reply_email_message: e.target.value })}
                      placeholder="Auto-reply message" />
                    <div className="pt-2 mt-1 border-t border-bdr">
                      <div className="text-[11px] font-semibold text-muted mb-1">Out-of-hours reply — sent instead when you're closed (needs Business hours on)</div>
                      <input disabled={!isOwner}
                        className="w-full px-3 py-2 bg-card border border-bdr rounded-xl text-sm text-paper placeholder-dim focus:outline-none focus:border-ember disabled:opacity-60 mb-2"
                        value={settings.after_hours_email_subject || ''}
                        onChange={e => setSettings(s => ({ ...s, after_hours_email_subject: e.target.value }))}
                        onBlur={e => saveSettings({ after_hours_email_subject: e.target.value })}
                        placeholder="Out-of-hours subject (optional)" />
                      <textarea disabled={!isOwner} rows={3}
                        className="w-full px-3 py-2 bg-card border border-bdr rounded-xl text-sm text-paper placeholder-dim focus:outline-none focus:border-ember resize-none disabled:opacity-60"
                        value={settings.after_hours_email_message || ''}
                        onChange={e => setSettings(s => ({ ...s, after_hours_email_message: e.target.value }))}
                        onBlur={e => saveSettings({ after_hours_email_message: e.target.value })}
                        placeholder="e.g. Thanks for your message — our office is currently closed. We'll get back to you when we reopen." />
                    </div>
                  </div>
                </div>

                {/* SMS auto-reply */}
                <div className="pt-1 border-t border-bdr">
                  <button type="button" disabled={!isOwner}
                    onClick={() => saveSettings({ auto_reply_sms_enabled: !settings.auto_reply_sms_enabled })}
                    className="w-full flex items-center gap-3 p-3 mt-3 glass-inner rounded-xl text-left disabled:opacity-60">
                    <div className="flex-1">
                      <div className="text-sm font-medium text-paper">SMS auto-reply</div>
                      <div className="text-xs text-muted">Texted back from the support number</div>
                    </div>
                    <div className={`relative w-10 h-6 rounded-full transition shrink-0 ${settings.auto_reply_sms_enabled ? 'bg-emerald-500' : 'bg-slate-300'}`}>
                      <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${settings.auto_reply_sms_enabled ? 'left-[18px]' : 'left-0.5'}`} />
                    </div>
                  </button>
                  <div className={`mt-2 ${settings.auto_reply_sms_enabled ? '' : 'opacity-50 pointer-events-none'}`}>
                    <textarea disabled={!isOwner} rows={2}
                      className="w-full px-3 py-2 bg-card border border-bdr rounded-xl text-sm text-paper placeholder-dim focus:outline-none focus:border-ember resize-none disabled:opacity-60"
                      value={settings.auto_reply_sms_message || ''}
                      onChange={e => setSettings(s => ({ ...s, auto_reply_sms_message: e.target.value }))}
                      onBlur={e => saveSettings({ auto_reply_sms_message: e.target.value })}
                      placeholder="Auto-reply text message" />
                  </div>
                </div>

                <div className="text-[11px] text-dim leading-relaxed pt-1 border-t border-bdr">
                  Only the first message on a new ticket gets an auto-reply (no loops). Use <code className="bg-slate-100 px-1 rounded">{'{{contact_name}}'}</code> and <code className="bg-slate-100 px-1 rounded">{'{{ticket_number}}'}</code> as placeholders. Email auto-reply needs a connected support mailbox.
                </div>
              </div>
            </div>
          )}

{/* Business hours */}
          {settings && (
            <div className="glass-card rounded-2xl overflow-hidden">
              <div className="px-5 py-4 border-b border-bdr flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-center text-lg">{'\u{1F551}'}</div>
                <div className="flex-1">
                  <div className="text-base font-bold text-paper">Business hours</div>
                  <div className="text-xs text-muted">Out-of-hours calls → voicemail → ticket · out-of-hours emails get the out-of-hours reply</div>
                </div>
              </div>
              <div className="p-5 space-y-4">
                <button type="button" disabled={!isOwner}
                  onClick={() => saveSettings({ business_hours_enabled: !settings.business_hours_enabled })}
                  className="w-full flex items-center gap-3 p-3 glass-inner rounded-xl text-left disabled:opacity-60">
                  <div className="flex-1">
                    <div className="text-sm font-medium text-paper">Enforce business hours</div>
                    <div className="text-xs text-muted">When off, calls ring agents as normal and emails always get the standard reply</div>
                  </div>
                  <div className={`relative w-10 h-6 rounded-full transition shrink-0 ${settings.business_hours_enabled ? 'bg-emerald-500' : 'bg-slate-300'}`}>
                    <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${settings.business_hours_enabled ? 'left-[18px]' : 'left-0.5'}`} />
                  </div>
                </button>
                <div className={settings.business_hours_enabled ? '' : 'opacity-50 pointer-events-none'}>
                  <label className="text-[11px] font-semibold text-muted block mb-1">Timezone</label>
                  <select disabled={!isOwner} value={settings.business_timezone || 'UTC'}
                    onChange={e => { setSettings(s => ({ ...s, business_timezone: e.target.value })); saveSettings({ business_timezone: e.target.value }); }}
                    className="w-full px-3 py-2 bg-card border border-bdr rounded-xl text-sm text-paper focus:outline-none focus:border-ember disabled:opacity-60 mb-3">
                    {[...new Set([settings.business_timezone, 'America/Los_Angeles', 'America/Denver', 'America/Chicago', 'America/New_York', 'Europe/London', 'Europe/Dublin', 'Australia/Sydney', 'UTC'])].filter(Boolean).map(tz => <option key={tz} value={tz}>{tz}</option>)}
                  </select>
                  <div className="space-y-1.5">
                    {['mon','tue','wed','thu','fri','sat','sun'].map(d => {
                      const bh = settings.business_hours || {};
                      const day = bh[d] || {};
                      const upd = (patch) => {
                        const next = { ...bh, [d]: { ...day, ...patch } };
                        setSettings(s => ({ ...s, business_hours: next }));
                        saveSettings({ business_hours: next });
                      };
                      return (
                        <div key={d} className="flex items-center gap-2 text-sm">
                          <span className="w-9 uppercase text-[11px] font-mono text-muted">{d}</span>
                          <label className="flex items-center gap-1.5 text-xs text-muted w-16">
                            <input type="checkbox" checked={!day.closed} disabled={!isOwner}
                              onChange={e => upd({ closed: !e.target.checked })} />
                            {day.closed ? 'Closed' : 'Open'}
                          </label>
                          <input type="time" disabled={!isOwner || day.closed} value={day.open || '09:00'}
                            onChange={e => upd({ open: e.target.value })}
                            className="px-2 py-1 bg-card border border-bdr rounded text-sm text-paper focus:outline-none focus:border-ember disabled:opacity-40" />
                          <span className="text-muted">–</span>
                          <input type="time" disabled={!isOwner || day.closed} value={day.close || '17:00'}
                            onChange={e => upd({ close: e.target.value })}
                            className="px-2 py-1 bg-card border border-bdr rounded text-sm text-paper focus:outline-none focus:border-ember disabled:opacity-40" />
                        </div>
                      );
                    })}
                  </div>
                  <div className="pt-3 mt-2 border-t border-bdr">
                    <label className="text-[11px] font-semibold text-muted block mb-1">Out-of-hours voicemail greeting (optional)</label>
                    <textarea disabled={!isOwner} rows={2}
                      className="w-full px-3 py-2 bg-card border border-bdr rounded-xl text-sm text-paper placeholder-dim focus:outline-none focus:border-ember resize-none disabled:opacity-60"
                      value={settings.after_hours_voicemail_prompt || ''}
                      onChange={e => setSettings(s => ({ ...s, after_hours_voicemail_prompt: e.target.value }))}
                      onBlur={e => saveSettings({ after_hours_voicemail_prompt: e.target.value })}
                      placeholder="Played to callers when you're closed, before the beep. Falls back to the normal voicemail prompt if blank." />
                  </div>
                </div>
              </div>
            </div>
          )}

                    {/* Quote branding / company details */}
          {settings && (
            <div className="glass-card rounded-2xl overflow-hidden">
              <div className="px-5 py-4 border-b border-bdr flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-ember/15 border border-ember/25 flex items-center justify-center text-lg">{'\u{1F3F7}\u{FE0F}'}</div>
                <div className="flex-1">
                  <div className="text-base font-bold text-paper">Quote branding</div>
                  <div className="text-xs text-muted">Your company details shown as the seller on every quote</div>
                </div>
              </div>
              <div className="p-5 space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Light-mode logo */}
                  <div className="flex items-center gap-3">
                    <div className="w-16 h-16 rounded-xl bg-white border border-bdr flex items-center justify-center overflow-hidden shrink-0">
                      {settings.logo_url ? <img src={settings.logo_url} alt="Light logo" className="w-full h-full object-contain" /> : <span className="text-[10px] text-dim text-center">No logo</span>}
                    </div>
                    <div className="min-w-0">
                      <label className="text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-dim mb-1 block">Light-mode logo</label>
                      {isOwner && <input type="file" accept="image/*" onChange={e => uploadLogo(e, 'logo_url')} className="text-xs text-paper file:mr-2 file:px-2 file:py-1 file:rounded-lg file:border-0 file:bg-ember file:text-white file:text-xs file:font-semibold w-full" />}
                      {isOwner && settings.logo_url && <button onClick={() => clearLogo('logo_url')} className="text-[11px] text-red-600 hover:underline mt-1">Remove</button>}
                    </div>
                  </div>
                  {/* Dark-mode logo */}
                  <div className="flex items-center gap-3">
                    <div className="w-16 h-16 rounded-xl bg-slate-800 border border-bdr flex items-center justify-center overflow-hidden shrink-0">
                      {settings.logo_url_dark ? <img src={settings.logo_url_dark} alt="Dark logo" className="w-full h-full object-contain" /> : <span className="text-[10px] text-slate-400 text-center">No logo</span>}
                    </div>
                    <div className="min-w-0">
                      <label className="text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-dim mb-1 block">Dark-mode logo</label>
                      {isOwner && <input type="file" accept="image/*" onChange={e => uploadLogo(e, 'logo_url_dark')} className="text-xs text-paper file:mr-2 file:px-2 file:py-1 file:rounded-lg file:border-0 file:bg-ember file:text-white file:text-xs file:font-semibold w-full" />}
                      {isOwner && settings.logo_url_dark && <button onClick={() => clearLogo('logo_url_dark')} className="text-[11px] text-red-600 hover:underline mt-1">Remove</button>}
                    </div>
                  </div>
                </div>
                <div className="text-[11px] text-dim">Shown in the app sidebar (per theme). PNG/SVG with a transparent background works best. If no dark logo is set, the light one is used.</div>
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-dim mb-1 block">Business name</label>
                    <input disabled={!isOwner} className="w-full px-3 py-2 bg-card border border-bdr rounded-xl text-sm text-paper focus:outline-none focus:border-ember disabled:opacity-60"
                      value={settings.business_name || ''} onChange={e => setSettings(s => ({ ...s, business_name: e.target.value }))} onBlur={e => saveSettings({ business_name: e.target.value })} placeholder="ServOS Ltd" /></div>
                  <div><label className="text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-dim mb-1 block">Accent colour</label>
                    <div className="flex gap-2 items-center">
                      <input type="color" disabled={!isOwner} value={settings.quote_accent || '#E8743C'} onChange={e => { setSettings(s => ({ ...s, quote_accent: e.target.value })); saveSettings({ quote_accent: e.target.value }); }} className="w-10 h-9 rounded border border-bdr bg-card" />
                      <input disabled={!isOwner} className="flex-1 px-3 py-2 bg-card border border-bdr rounded-xl text-sm text-paper font-mono focus:outline-none focus:border-ember disabled:opacity-60"
                        value={settings.quote_accent || '#E8743C'} onChange={e => setSettings(s => ({ ...s, quote_accent: e.target.value }))} onBlur={e => saveSettings({ quote_accent: e.target.value })} /></div></div>
                  <div><label className="text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-dim mb-1 block">Email</label>
                    <input disabled={!isOwner} className="w-full px-3 py-2 bg-card border border-bdr rounded-xl text-sm text-paper focus:outline-none focus:border-ember disabled:opacity-60"
                      value={settings.business_email || ''} onChange={e => setSettings(s => ({ ...s, business_email: e.target.value }))} onBlur={e => saveSettings({ business_email: e.target.value })} placeholder="sales@serv-os.app" /></div>
                  <div><label className="text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-dim mb-1 block">Phone</label>
                    <input disabled={!isOwner} className="w-full px-3 py-2 bg-card border border-bdr rounded-xl text-sm text-paper focus:outline-none focus:border-ember disabled:opacity-60"
                      value={settings.business_phone || ''} onChange={e => setSettings(s => ({ ...s, business_phone: e.target.value }))} onBlur={e => saveSettings({ business_phone: e.target.value })} placeholder="+44 7576 562085" /></div>
                </div>
                <div><label className="text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-dim mb-1 block">Address</label>
                  <textarea disabled={!isOwner} rows={2} className="w-full px-3 py-2 bg-card border border-bdr rounded-xl text-sm text-paper resize-none focus:outline-none focus:border-ember disabled:opacity-60"
                    value={settings.business_address || ''} onChange={e => setSettings(s => ({ ...s, business_address: e.target.value }))} onBlur={e => saveSettings({ business_address: e.target.value })} placeholder="Company address shown on quotes" /></div>
              </div>
            </div>
          )}

          {/* Quote terms */}
          {settings && (
            <div className="glass-card rounded-2xl overflow-hidden">
              <div className="px-5 py-4 border-b border-bdr flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-ember/15 border border-ember/25 flex items-center justify-center text-lg">{'\u{1F4DC}'}</div>
                <div className="flex-1">
                  <div className="text-base font-bold text-paper">Quote terms &amp; conditions</div>
                  <div className="text-xs text-muted">Default T&amp;Cs shown on every quote (a quote can override its own)</div>
                </div>
              </div>
              <div className="p-5">
                <textarea disabled={!isOwner} rows={6}
                  className="w-full px-3 py-2 bg-card border border-bdr rounded-xl text-sm text-paper placeholder-dim focus:outline-none focus:border-ember resize-none disabled:opacity-60"
                  value={settings.quote_terms || ''}
                  onChange={e => setSettings(s => ({ ...s, quote_terms: e.target.value }))}
                  onBlur={e => saveSettings({ quote_terms: e.target.value })}
                  placeholder="e.g. Prices exclude sales tax where applicable. Payment terms as per contract…" />
                {!isOwner && <div className="text-[11px] text-dim mt-1">Only owners can edit these.</div>}
              </div>
            </div>
          )}

          {/* Invoice terms */}
          {settings && (
            <div className="glass-card rounded-2xl overflow-hidden">
              <div className="px-5 py-4 border-b border-bdr flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-ember/15 border border-ember/25 flex items-center justify-center text-lg">{'\u{1F9FE}'}</div>
                <div className="flex-1">
                  <div className="text-base font-bold text-paper">Invoice terms</div>
                  <div className="text-xs text-muted">Default terms shown on every invoice (an invoice can override its own)</div>
                </div>
              </div>
              <div className="p-5">
                <textarea disabled={!isOwner} rows={5}
                  className="w-full px-3 py-2 bg-card border border-bdr rounded-xl text-sm text-paper placeholder-dim focus:outline-none focus:border-ember resize-none disabled:opacity-60"
                  value={settings.invoice_terms || ''}
                  onChange={e => setSettings(s => ({ ...s, invoice_terms: e.target.value }))}
                  onBlur={e => saveSettings({ invoice_terms: e.target.value })}
                  placeholder="e.g. Payment due within 14 days. Late payments may incur interest at 8% above the Bank of England base rate…" />
                {!isOwner && <div className="text-[11px] text-dim mt-1">Only owners can edit these.</div>}
              </div>
            </div>
          )}

          {/* Twilio SMS Integration */}
          <div className="glass-card rounded-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-bdr flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-center text-lg">
                {'\u{1F4AC}'}
              </div>
              <div className="flex-1">
                <div className="text-base font-bold text-paper">Twilio SMS / Phone</div>
                <div className="text-xs text-muted">SMS support and phone calls via Twilio</div>
              </div>
            </div>
            <div className="p-5">
              <div className="p-3 glass-inner rounded-xl flex items-center gap-3 mb-4">
                <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-sm font-bold">
                  {'\u{1F4F1}'}
                </div>
                <div className="flex-1">
                  <input className="w-full bg-transparent text-sm font-medium text-paper outline-none placeholder:text-dim"
                    value={settings?.twilio_number || ''}
                    onChange={e => setSettings(s => ({ ...s, twilio_number: e.target.value }))}
                    onBlur={e => saveSettings({ twilio_number: e.target.value.trim() || null })}
                    placeholder="No number connected — enter your Twilio number" />
                  <div className="text-xs text-muted">Support SMS number (unique per instance)</div>
                </div>
                {settings?.twilio_number
                  ? <span className="px-2 py-0.5 text-[9px] font-bold uppercase rounded bg-blue-100 text-blue-700 border border-blue-200">Configured</span>
                  : <span className="px-2 py-0.5 text-[9px] font-bold uppercase rounded bg-amber-100 text-amber-700 border border-amber-200">Not set</span>}
              </div>

              <div className="text-xs text-muted leading-relaxed">
                <strong>How it works:</strong> When a customer texts {settings?.twilio_number || 'your Twilio number'}, a support ticket is automatically created in the CRM.
                Agents reply from the SMS tab in the ticket, and the reply is sent from the same number.
                The customer sees a normal text conversation.
              </div>

              <div className="mt-4 pt-3 border-t border-bdr">
                <div className="text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-dim mb-2">Setup</div>
                <div className="text-xs text-muted space-y-1">
                  <div>1. Buy a dedicated number in the Twilio console (each CRM instance needs its own)</div>
                  <div>2. Add Twilio secrets in Supabase: <code className="bg-slate-100 px-1 rounded">TWILIO_ACCOUNT_SID</code>, <code className="bg-slate-100 px-1 rounded">TWILIO_AUTH_TOKEN</code>, <code className="bg-slate-100 px-1 rounded">TWILIO_FROM_NUMBER</code></div>
                  <div>3. In Twilio console, set the SMS webhook URL for the number to:</div>
                  <div className="bg-slate-50 border border-slate-200 rounded p-2 font-mono text-[10px] break-all mt-1">
                    {import.meta.env.VITE_SUPABASE_URL}/functions/v1/twilio-inbound-sms
                  </div>
                </div>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}

