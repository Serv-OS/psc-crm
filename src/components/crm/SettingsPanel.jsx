import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

const GMAIL_CLIENT_ID = '836252293153-ekl6o41r2kra549aqnjr9bvpiq2t4nfg.apps.googleusercontent.com';
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const REDIRECT_URI = `${SUPABASE_URL}/functions/v1/gmail-oauth-callback`;
const SCOPES = 'https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/gmail.send';

export default function SettingsPanel({ profile }) {
  const [connections, setConnections] = useState([]);
  const [loading, setLoading] = useState(true);

  const isOwner = profile.role === 'owner';

  useEffect(() => {
    load();
    // Listen for OAuth popup result
    const handler = (event) => {
      if (event.data?.type === 'gmail-oauth-result') {
        if (event.data.success) {
          load(); // Refresh connections
        } else {
          alert('Gmail connection failed: ' + event.data.detail);
        }
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase.from('gmail_connections').select('*').order('created_at', { ascending: false });
    setConnections(data || []);
    setLoading(false);
  };

  const connectGmail = async () => {
    // Get current session token to pass as state
    const { data: { session } } = await supabase.auth.getSession();
    const state = session?.access_token || '';

    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
      `client_id=${encodeURIComponent(GMAIL_CLIENT_ID)}` +
      `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
      `&response_type=code` +
      `&scope=${encodeURIComponent(SCOPES)}` +
      `&access_type=offline` +
      `&prompt=consent` +
      `&state=${encodeURIComponent(state)}`;

    // Open popup
    const w = 500, h = 600;
    const left = (screen.width - w) / 2;
    const top = (screen.height - h) / 2;
    window.open(authUrl, 'gmail-oauth', `width=${w},height=${h},left=${left},top=${top}`);
  };

  const disconnectGmail = async (id) => {
    if (!confirm('Disconnect this Gmail account? Support email will stop working.')) return;
    await supabase.from('gmail_connections').update({ is_active: false }).eq('id', id);
    load();
  };

  const reactivate = async (id) => {
    await supabase.from('gmail_connections').update({ is_active: true }).eq('id', id);
    load();
  };

  const activeConnections = connections.filter(c => c.is_active);
  const inactiveConnections = connections.filter(c => !c.is_active);

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 py-5 border-b border-bdr">
        <div className="text-xl font-bold text-paper">Settings</div>
        <div className="text-xs text-muted">Integrations and configuration</div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-3xl space-y-6">

          {/* Gmail Integration */}
          <div className="glass-card rounded-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-bdr flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-red-50 border border-red-200 flex items-center justify-center">
                <svg width="20" height="16" viewBox="0 0 20 16" fill="none">
                  <path d="M18 0H2C0.9 0 0 0.9 0 2V14C0 15.1 0.9 16 2 16H18C19.1 16 20 15.1 20 14V2C20 0.9 19.1 0 18 0Z" fill="#EA4335"/>
                  <path d="M18 2L10 7L2 2" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
              </div>
              <div className="flex-1">
                <div className="text-base font-bold text-paper">Gmail Integration</div>
                <div className="text-xs text-muted">Connect a Gmail account for support email</div>
              </div>
              {isOwner && (
                <button onClick={connectGmail}
                  className="btn-glass px-4 py-2 rounded-xl text-sm">
                  {activeConnections.length > 0 ? 'Add another' : 'Connect Gmail'}
                </button>
              )}
            </div>
            <div className="p-5">
              {loading && <div className="text-xs text-dim italic py-4 text-center">Loading...</div>}

              {!loading && activeConnections.length > 0 && (
                <div className="space-y-2 mb-4">
                  {activeConnections.map(c => (
                    <div key={c.id} className="flex items-center gap-3 p-3 glass-inner rounded-xl">
                      <div className="w-8 h-8 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center text-sm font-bold">
                        {'\u{2713}'}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-paper">{c.email}</div>
                        <div className="text-xs text-muted">
                          Connected {new Date(c.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' })}
                          {c.token_expires_at && ` / Token refreshes automatically`}
                        </div>
                      </div>
                      <span className="px-2 py-0.5 text-[9px] font-bold uppercase rounded bg-emerald-100 text-emerald-700 border border-emerald-200">Active</span>
                      {isOwner && (
                        <button onClick={() => disconnectGmail(c.id)}
                          className="px-2 py-1 text-xs text-red-600 border border-red-200 rounded-xl hover:bg-red-50">Disconnect</button>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {!loading && activeConnections.length === 0 && (
                <div className="text-center py-6">
                  <div className="text-3xl mb-2">{'\u{1F4E7}'}</div>
                  <div className="text-sm text-paper font-medium mb-1">No Gmail account connected</div>
                  <div className="text-xs text-muted mb-3">Connect a Gmail account to receive and send support emails from within the CRM.</div>
                  {isOwner && (
                    <button onClick={connectGmail}
                      className="btn-glass px-5 py-2 rounded-xl text-sm">Connect Gmail</button>
                  )}
                </div>
              )}

              {!loading && inactiveConnections.length > 0 && (
                <div className="border-t border-bdr pt-3 mt-3">
                  <div className="text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-dim mb-2">Disconnected</div>
                  {inactiveConnections.map(c => (
                    <div key={c.id} className="flex items-center gap-3 p-2 opacity-50">
                      <div className="text-sm text-muted">{c.email}</div>
                      {isOwner && (
                        <button onClick={() => reactivate(c.id)}
                          className="px-2 py-0.5 text-xs text-muted border border-bdr rounded hover:text-paper">Reactivate</button>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <div className="text-xs text-muted mt-4 pt-3 border-t border-bdr leading-relaxed">
                <strong>How it works:</strong> When a customer emails the connected address, a support ticket is automatically created.
                When you reply from the Email tab in a ticket, the reply is sent from the connected Gmail account.
                Conversations are threaded so the customer sees a normal email thread.
              </div>
            </div>
          </div>

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
                  <div className="text-sm font-medium text-paper">+44 7576 562085</div>
                  <div className="text-xs text-muted">Support SMS number</div>
                </div>
                <span className="px-2 py-0.5 text-[9px] font-bold uppercase rounded bg-blue-100 text-blue-700 border border-blue-200">Configured</span>
              </div>

              <div className="text-xs text-muted leading-relaxed">
                <strong>How it works:</strong> When a customer texts +44 7576 562085, a support ticket is automatically created in the CRM.
                Agents reply from the SMS tab in the ticket, and the reply is sent from the same number.
                The customer sees a normal text conversation.
              </div>

              <div className="mt-4 pt-3 border-t border-bdr">
                <div className="text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-dim mb-2">Setup</div>
                <div className="text-xs text-muted space-y-1">
                  <div>1. Add Twilio secrets in Supabase: <code className="bg-slate-100 px-1 rounded">TWILIO_ACCOUNT_SID</code>, <code className="bg-slate-100 px-1 rounded">TWILIO_AUTH_TOKEN</code>, <code className="bg-slate-100 px-1 rounded">TWILIO_FROM_NUMBER</code></div>
                  <div>2. In Twilio console, set the SMS webhook URL for +447576562085 to:</div>
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
