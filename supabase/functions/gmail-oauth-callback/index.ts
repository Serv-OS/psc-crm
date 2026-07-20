// Gmail OAuth Callback - Exchanges auth code for tokens and stores in database
// Called by the OAuth redirect after user signs in with Google
//
// Required Supabase Secrets: GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state"); // contains the user's JWT
  const error = url.searchParams.get("error");

  const appUrl = Deno.env.get("APP_URL") || "https://psc-crm.vercel.app";

  if (error) {
    return new Response(redirectHtml(appUrl, false, error), {
      headers: { "Content-Type": "text/html" },
    });
  }

  if (!code) {
    return new Response(redirectHtml(appUrl, false, "No authorization code"), {
      headers: { "Content-Type": "text/html" },
    });
  }

  try {
    const clientId = Deno.env.get("GMAIL_CLIENT_ID")!;
    const clientSecret = Deno.env.get("GMAIL_CLIENT_SECRET")!;
    const redirectUri = `${Deno.env.get("SUPABASE_URL")}/functions/v1/gmail-oauth-callback`;

    // Exchange code for tokens
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    const tokens = await tokenRes.json();

    if (!tokens.access_token || !tokens.refresh_token) {
      return new Response(
        redirectHtml(appUrl, false, "Failed to get tokens: " + JSON.stringify(tokens)),
        { headers: { "Content-Type": "text/html" } }
      );
    }

    // Get the Gmail user's email address
    const profileRes = await fetch("https://www.googleapis.com/gmail/v1/users/me/profile", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const profile = await profileRes.json();
    const email = profile.emailAddress;

    // Store in database
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // state may be "personal:<jwt>" (per-user inbox/calendar) or just "<jwt>" (shared support inbox)
    let mode = "support";
    let jwt = state || "";
    if (state && state.startsWith("personal:")) { mode = "personal"; jwt = state.slice("personal:".length); }

    let connectedBy = null;
    if (jwt) {
      try { const { data: { user } } = await supabase.auth.getUser(jwt); connectedBy = user?.id || null; } catch {}
    }

    if (mode === "personal") {
      if (!connectedBy) {
        return new Response(redirectHtml(appUrl, false, "Not signed in", "google-oauth-result"), { headers: { "Content-Type": "text/html" } });
      }
      const { error: uiError } = await supabase.from("user_integrations").upsert({
        profile_id: connectedBy,
        provider: "google",
        email,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
        scope: tokens.scope || null,
        updated_at: new Date().toISOString(),
      }, { onConflict: "profile_id" });
      if (uiError) {
        return new Response(redirectHtml(appUrl, false, `Could not save connection: ${uiError.message}`, "google-oauth-result"), { headers: { "Content-Type": "text/html" } });
      }
      return new Response(redirectHtml(appUrl, true, email, "google-oauth-result"), { headers: { "Content-Type": "text/html" } });
    }

    // Shared support inbox (unchanged)
    const { error: gcError } = await supabase.from("gmail_connections").upsert({
      email,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      connected_by: connectedBy,
      is_active: true,
      updated_at: new Date().toISOString(),
    }, { onConflict: "email" });
    if (gcError) {
      return new Response(redirectHtml(appUrl, false, `Could not save connection: ${gcError.message}`), { headers: { "Content-Type": "text/html" } });
    }

    return new Response(redirectHtml(appUrl, true, email), {
      headers: { "Content-Type": "text/html" },
    });
  } catch (err) {
    return new Response(
      redirectHtml(appUrl, false, err.message),
      { headers: { "Content-Type": "text/html" } }
    );
  }
});

function redirectHtml(appUrl: string, success: boolean, detail: string, messageType = "gmail-oauth-result"): string {
  return `<!DOCTYPE html>
<html>
<head><title>Google Connection</title></head>
<body>
<script>
  if (window.opener) {
    window.opener.postMessage({
      type: '${messageType}',
      success: ${success},
      detail: '${detail.replace(/'/g, "\\'")}'
    }, '${appUrl}');
    window.close();
  } else {
    window.location.href = '${appUrl}';
  }
</script>
<p>${success ? 'Gmail connected successfully! You can close this window.' : 'Error: ' + detail}</p>
</body>
</html>`;
}
