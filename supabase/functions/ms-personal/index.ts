// Per-user personal Microsoft 365 / Outlook triage. The caller's JWT identifies
// the user_integrations row (provider='microsoft') whose token we use. Mirror of
// gmail-personal, using Microsoft Graph. Actions:
//   { action:'list', pageToken? }                 -> recent inbox (metadata)
//   { action:'get', id }                           -> full message (body)
//   { action:'send', to, subject, body, replyToId? } -> compose / threaded reply
//   { action:'modify', id, archive?, markRead?, markUnread? }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { graph, msTokenFromRefresh, MS_GRAPH } from "../_shared/microsoft.ts";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

function stripHtml(s: string) {
  return s.replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\n{3,}/g, "\n\n").trim();
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const auth = req.headers.get("Authorization")?.replace("Bearer ", "");
  if (!auth) return json({ error: "Unauthorized" }, 401);
  const { data: { user } } = await supabase.auth.getUser(auth);
  if (!user) return json({ error: "Unauthorized" }, 401);

  const { data: integ } = await supabase.from("user_integrations").select("*").eq("profile_id", user.id).maybeSingle();
  if (!integ?.refresh_token || integ.provider !== "microsoft") {
    return json({ error: "Connect your Outlook account first (My Account → Connect Microsoft)." }, 400);
  }

  // Fresh access token (persist the rotated refresh token).
  let accessToken = integ.access_token;
  if (!accessToken || !integ.token_expires_at || new Date(integ.token_expires_at).getTime() - Date.now() < 60000) {
    const tok = await msTokenFromRefresh(integ.refresh_token);
    accessToken = tok.access_token;
    await supabase.from("user_integrations").update({
      access_token: accessToken, token_expires_at: new Date(Date.now() + (tok.expires_in || 3600) * 1000).toISOString(),
      ...(tok.refresh_token ? { refresh_token: tok.refresh_token } : {}), updated_at: new Date().toISOString(),
    }).eq("id", integ.id);
  }

  try {
    const reqBody = await req.json();
    const action = reqBody.action;

    if (action === "list") {
      const url = reqBody.pageToken ||
        `${MS_GRAPH}/me/mailFolders/inbox/messages?$top=25&$orderby=receivedDateTime desc&$select=id,conversationId,subject,from,toRecipients,receivedDateTime,bodyPreview,isRead`;
      const data = await graph(accessToken, url) as { value?: any[]; "@odata.nextLink"?: string };
      const messages = (data.value || []).map((m) => ({
        id: m.id, threadId: m.conversationId,
        from: m.from?.emailAddress ? `${m.from.emailAddress.name || ""} <${m.from.emailAddress.address}>`.trim() : "",
        to: (m.toRecipients || []).map((r: any) => r.emailAddress?.address).filter(Boolean).join(", "),
        subject: m.subject || "", date: m.receivedDateTime, snippet: m.bodyPreview || "", unread: m.isRead === false,
      }));
      return json({ messages, nextPageToken: data["@odata.nextLink"] || null });
    }

    // ---- THREAD: every message in a conversation, NEW content only ----
    // uniqueBody returns just this message's text (no quoted history), so the
    // thread reads like a real email client instead of each reply re-quoting
    // everything above it.
    if (action === "thread") {
      const cid = reqBody.threadId;
      if (!cid) return json({ error: "Missing threadId" }, 422);
      const filter = encodeURIComponent(`conversationId eq '${String(cid).replace(/'/g, "''")}'`);
      const select = encodeURIComponent("id,conversationId,subject,from,toRecipients,receivedDateTime,internetMessageId,isRead,uniqueBody,bodyPreview");
      const data = await graph(accessToken, `${MS_GRAPH}/me/messages?$filter=${filter}&$top=50&$select=${select}`) as { value?: any[] };
      const messages = (data.value || [])
        .sort((a, b) => new Date(a.receivedDateTime || 0).getTime() - new Date(b.receivedDateTime || 0).getTime())
        .map((m) => {
          const ub = m.uniqueBody || {};
          const isHtml = ub.contentType === "html";
          return {
            id: m.id, threadId: m.conversationId, messageId: m.internetMessageId,
            from: m.from?.emailAddress ? `${m.from.emailAddress.name || ""} <${m.from.emailAddress.address}>`.trim() : "",
            to: (m.toRecipients || []).map((r: any) => r.emailAddress?.address).filter(Boolean).join(", "),
            subject: m.subject || "", date: m.receivedDateTime, unread: m.isRead === false,
            text: isHtml ? stripHtml(ub.content || "") : (ub.content || m.bodyPreview || ""),
            html: isHtml ? ub.content : "",
          };
        });
      return json({ messages, subject: messages[messages.length - 1]?.subject || "" });
    }

    if (action === "get") {
      if (!reqBody.id) return json({ error: "Missing id" }, 422);
      const m = await graph(accessToken, `/me/messages/${reqBody.id}?$select=id,conversationId,subject,from,toRecipients,ccRecipients,receivedDateTime,internetMessageId,body,isRead`) as any;
      if (m.isRead === false) {
        await graph(accessToken, `/me/messages/${reqBody.id}`, { method: "PATCH", body: JSON.stringify({ isRead: true }) }).catch(() => {});
      }
      const isHtml = m.body?.contentType === "html";
      return json({
        id: m.id, threadId: m.conversationId,
        from: m.from?.emailAddress ? `${m.from.emailAddress.name || ""} <${m.from.emailAddress.address}>`.trim() : "",
        to: (m.toRecipients || []).map((r: any) => r.emailAddress?.address).join(", "),
        cc: (m.ccRecipients || []).map((r: any) => r.emailAddress?.address).join(", "),
        subject: m.subject || "", date: m.receivedDateTime, messageId: m.internetMessageId,
        text: isHtml ? stripHtml(m.body?.content || "") : (m.body?.content || ""), html: isHtml ? m.body?.content : "",
      });
    }

    if (action === "send") {
      const { to, subject, body: text, html, replyToId } = reqBody;
      if (!to || !text) return json({ error: "Missing recipient or body" }, 422);
      const recipients = String(to).split(/[,;]/).map((a) => ({ emailAddress: { address: a.trim() } })).filter((r) => r.emailAddress.address);
      const content = html || text;
      const contentType = html ? "HTML" : "Text";
      // Reply onto the original thread when Exchange lets us, but never at the
      // cost of the message. A stored id goes stale the moment the mail is
      // moved or filed (404 ErrorItemNotFound), and some items refuse a reply
      // outright (400 ErrorInvalidReferenceItem — drafts, non-mail items, a
      // message since replaced). Either way the send used to die with it.
      let threaded = false;
      if (replyToId) {
        try {
          await graph(accessToken, `/me/messages/${replyToId}/reply`, { method: "POST", body: JSON.stringify({ message: { toRecipients: recipients }, comment: content }) });
          threaded = true;
        } catch (e) {
          console.warn("threaded reply refused, sending standalone:", String((e as Error)?.message || "").slice(0, 200));
        }
      }
      if (!threaded) {
        await graph(accessToken, `/me/sendMail`, { method: "POST", body: JSON.stringify({ message: { subject: subject || "(no subject)", body: { contentType, content }, toRecipients: recipients }, saveToSentItems: true }) });
      }
      return json({ success: true });
    }

    if (action === "modify") {
      if (!reqBody.id) return json({ error: "Missing id" }, 422);
      if (reqBody.markRead || reqBody.markUnread) {
        await graph(accessToken, `/me/messages/${reqBody.id}`, { method: "PATCH", body: JSON.stringify({ isRead: !!reqBody.markRead }) });
      }
      if (reqBody.archive) {
        await graph(accessToken, `/me/messages/${reqBody.id}/move`, { method: "POST", body: JSON.stringify({ destinationId: "archive" }) });
      }
      return json({ success: true });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
