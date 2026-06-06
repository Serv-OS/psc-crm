// Per-user personal Gmail triage. The caller's JWT identifies the
// user_integrations row whose Google token we use. Actions:
//   { action:'list', q?, pageToken? }        -> recent inbox messages (metadata)
//   { action:'get', id }                      -> full message (decoded body)
//   { action:'send', to, subject, body, threadId?, inReplyTo?, references? }
//   { action:'modify', id, archive?, markRead? }
// Read+reply+link-to-CRM lives in the frontend; this just brokers Gmail.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";

async function freshAccessToken(supabase: any, integ: any): Promise<string | null> {
  if (integ.access_token && integ.token_expires_at && new Date(integ.token_expires_at).getTime() - Date.now() > 60000) {
    return integ.access_token;
  }
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: Deno.env.get("GMAIL_CLIENT_ID")!,
      client_secret: Deno.env.get("GMAIL_CLIENT_SECRET")!,
      refresh_token: integ.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  const t = await res.json();
  if (!t.access_token) return null;
  await supabase.from("user_integrations").update({
    access_token: t.access_token,
    token_expires_at: new Date(Date.now() + t.expires_in * 1000).toISOString(),
  }).eq("id", integ.id);
  return t.access_token;
}

// base64url -> string (utf-8 safe)
function b64urlDecode(data: string): string {
  const b64 = data.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 ? "=".repeat(4 - (b64.length % 4)) : "";
  const bin = atob(b64 + pad);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder("utf-8").decode(bytes);
}

// string -> base64url (utf-8 safe)
function b64urlEncode(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function header(headers: any[], name: string): string {
  return headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || "";
}

// Walk MIME parts; prefer text/plain, fall back to text/html (stripped).
function extractBody(payload: any): { text: string; html: string } {
  let text = "", html = "";
  const walk = (part: any) => {
    if (!part) return;
    const mime = part.mimeType || "";
    if (part.body?.data) {
      if (mime === "text/plain") text += b64urlDecode(part.body.data);
      else if (mime === "text/html") html += b64urlDecode(part.body.data);
    }
    (part.parts || []).forEach(walk);
  };
  walk(payload);
  return { text, html };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const auth = req.headers.get("Authorization")?.replace("Bearer ", "");
  if (!auth) return json({ error: "Unauthorized" }, 401);
  const { data: { user } } = await supabase.auth.getUser(auth);
  if (!user) return json({ error: "Unauthorized" }, 401);

  const { data: integ } = await supabase.from("user_integrations").select("*").eq("profile_id", user.id).maybeSingle();
  if (!integ?.refresh_token) return json({ error: "Connect your Google account first (My Account → Connect Google)." }, 400);

  const accessToken = await freshAccessToken(supabase, integ);
  if (!accessToken) return json({ error: "Google session expired — reconnect in My Account." }, 401);
  const H = { Authorization: `Bearer ${accessToken}` };

  try {
    const body = await req.json();
    const action = body.action;

    // ---- LIST: recent inbox messages with metadata ----
    if (action === "list") {
      const q = body.q || "in:inbox";
      const params = new URLSearchParams({ maxResults: "25", q });
      if (body.pageToken) params.set("pageToken", body.pageToken);
      const lr = await fetch(`${GMAIL}/messages?${params}`, { headers: H });
      const list = await lr.json();
      if (!lr.ok) return json({ error: list.error?.message || "Could not load inbox." }, 400);

      const ids: { id: string }[] = list.messages || [];
      const messages = await Promise.all(ids.map(async (m) => {
        const mp = new URLSearchParams({ format: "metadata" });
        ["From", "Subject", "Date", "To"].forEach((h) => mp.append("metadataHeaders", h));
        const r = await fetch(`${GMAIL}/messages/${m.id}?${mp}`, { headers: H });
        const d = await r.json();
        const hs = d.payload?.headers || [];
        return {
          id: d.id,
          threadId: d.threadId,
          from: header(hs, "From"),
          to: header(hs, "To"),
          subject: header(hs, "Subject"),
          date: header(hs, "Date"),
          snippet: d.snippet || "",
          unread: (d.labelIds || []).includes("UNREAD"),
        };
      }));
      return json({ messages, nextPageToken: list.nextPageToken || null });
    }

    // ---- GET: full message with decoded body ----
    if (action === "get") {
      if (!body.id) return json({ error: "Missing id" }, 422);
      const r = await fetch(`${GMAIL}/messages/${body.id}?format=full`, { headers: H });
      const d = await r.json();
      if (!r.ok) return json({ error: d.error?.message || "Could not load message." }, 400);
      const hs = d.payload?.headers || [];
      const { text, html } = extractBody(d.payload);
      // mark read on open
      if ((d.labelIds || []).includes("UNREAD")) {
        await fetch(`${GMAIL}/messages/${body.id}/modify`, {
          method: "POST", headers: { ...H, "Content-Type": "application/json" },
          body: JSON.stringify({ removeLabelIds: ["UNREAD"] }),
        });
      }
      return json({
        id: d.id, threadId: d.threadId,
        from: header(hs, "From"), to: header(hs, "To"), cc: header(hs, "Cc"),
        subject: header(hs, "Subject"), date: header(hs, "Date"),
        messageId: header(hs, "Message-ID") || header(hs, "Message-Id"),
        references: header(hs, "References"),
        text, html,
      });
    }

    // ---- SEND: compose / reply ----
    if (action === "send") {
      const { to, subject, body: text, threadId, inReplyTo, references } = body;
      if (!to || !text) return json({ error: "Missing recipient or body" }, 422);
      const fromEmail = integ.email;
      const lines = [
        `From: ${fromEmail}`,
        `To: ${to}`,
        `Subject: ${subject || "(no subject)"}`,
        "Content-Type: text/plain; charset=UTF-8",
        "MIME-Version: 1.0",
      ];
      if (inReplyTo) lines.push(`In-Reply-To: ${inReplyTo}`);
      if (references || inReplyTo) lines.push(`References: ${[references, inReplyTo].filter(Boolean).join(" ")}`);
      const raw = b64urlEncode(lines.join("\r\n") + "\r\n\r\n" + text);
      const payload: Record<string, unknown> = { raw };
      if (threadId) payload.threadId = threadId;
      const r = await fetch(`${GMAIL}/messages/send`, {
        method: "POST", headers: { ...H, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const d = await r.json();
      if (!r.ok) return json({ error: d.error?.message || "Could not send." }, 400);
      return json({ success: true, id: d.id, threadId: d.threadId });
    }

    // ---- MODIFY: archive / mark read ----
    if (action === "modify") {
      if (!body.id) return json({ error: "Missing id" }, 422);
      const removeLabelIds: string[] = [];
      const addLabelIds: string[] = [];
      if (body.archive) removeLabelIds.push("INBOX");
      if (body.markRead) removeLabelIds.push("UNREAD");
      if (body.markUnread) addLabelIds.push("UNREAD");
      const r = await fetch(`${GMAIL}/messages/${body.id}/modify`, {
        method: "POST", headers: { ...H, "Content-Type": "application/json" },
        body: JSON.stringify({ removeLabelIds, addLabelIds }),
      });
      const d = await r.json();
      if (!r.ok) return json({ error: d.error?.message || "Could not update message." }, 400);
      return json({ success: true });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
