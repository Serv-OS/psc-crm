import { useState, useEffect, useCallback } from 'react';
import { supabase } from './supabase';

// Microsoft 365 (Outlook/Exchange via Graph) connection — mirrors useGoogle.
// `state` carries the user's JWT; a "personal:" prefix routes to the per-user
// mailbox (user_integrations), no prefix to the shared support mailbox.
const REDIRECT_URI = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ms-oauth-callback`;
const SCOPES = 'offline_access openid email profile User.Read Mail.ReadWrite Mail.Send Calendars.ReadWrite';

let _cfg = null;
export async function getMicrosoftConfig() {
  if (_cfg) return _cfg;
  const { data } = await supabase.from('support_settings').select('microsoft_client_id, microsoft_tenant_id').eq('id', 1).maybeSingle();
  _cfg = { clientId: data?.microsoft_client_id || '', tenant: data?.microsoft_tenant_id || 'common' };
  return _cfg;
}
export function clearMicrosoftConfigCache() { _cfg = null; }

/** Open the Microsoft OAuth popup. personal=true connects the signed-in user's
 *  own Outlook; personal=false connects the shared support mailbox. */
export async function connectMicrosoft(personal = false) {
  // Open the popup synchronously (inside the click gesture) BEFORE any await, or
  // the browser blocks it as an unsolicited popup. We point it at the auth URL
  // once the async session/config work resolves.
  const w = 520, h = 680;
  const popup = window.open('', 'ms-oauth', `width=${w},height=${h},left=${(screen.width - w) / 2},top=${(screen.height - h) / 2}`);
  const { data: { session } } = await supabase.auth.getSession();
  const { clientId, tenant } = await getMicrosoftConfig();
  if (!clientId) { popup?.close(); alert('Add your Microsoft Application (client) ID in Settings first.'); return; }
  const state = (personal ? 'personal:' : '') + (session?.access_token || '');
  const url = `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/authorize?` +
    `client_id=${encodeURIComponent(clientId)}` +
    `&response_type=code&response_mode=query` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&scope=${encodeURIComponent(SCOPES)}` +
    `&prompt=select_account` +
    `&state=${encodeURIComponent(state)}`;
  if (popup) popup.location.href = url; else window.location.href = url;
}

/** Per-user personal Outlook connection status. */
export function useMicrosoftConnection(profileId) {
  const [connected, setConnected] = useState(null);
  const refresh = useCallback(() => {
    if (!profileId) return;
    supabase.from('user_integrations').select('email, provider').eq('profile_id', profileId).maybeSingle()
      .then(r => setConnected(r.data?.provider === 'microsoft' ? r.data : false));
  }, [profileId]);
  useEffect(() => {
    refresh();
    const handler = (e) => { if (e.data?.type === 'ms-oauth-result' && e.data.success) setTimeout(refresh, 500); };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [profileId, refresh]);
  return { connected, connect: () => connectMicrosoft(true), refresh };
}

/** Shared support-mailbox connection status (owner-managed in Settings). */
export function useMicrosoftSupportConnection() {
  const [connected, setConnected] = useState(null);
  const refresh = useCallback(() => {
    supabase.from('microsoft_connections').select('email, is_active').eq('is_active', true)
      .order('updated_at', { ascending: false }).limit(1).maybeSingle()
      .then(r => setConnected(r.data || false));
  }, []);
  useEffect(() => {
    refresh();
    const handler = (e) => { if (e.data?.type === 'ms-oauth-result' && e.data.success) setTimeout(refresh, 500); };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [refresh]);
  return { connected, connect: () => connectMicrosoft(false), refresh };
}
