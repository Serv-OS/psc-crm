// ms-check — polls the connected Microsoft 365 SUPPORT mailbox for new mail and
// creates/threads support tickets. Triggered by pg_cron every minute.
// Mirror of gmail-check, using Microsoft Graph. Threads by conversationId,
// dedups by internetMessageId. Microsoft rotates refresh tokens, so we persist
// the new one on every refresh.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { graph, msTokenFromRefresh } from "../_shared/microsoft.ts";
import { isOpenNow } from "../_shared/hours.ts";
import { b64ToBytes, storeAttachment } from "../_shared/attachments.ts";

// Fetch a message's real file attachments via Graph, skipping tiny inline images
// (signature logos / tracking pixels). Falls back to /$value when the collection
// omits contentBytes for a large file.
async function fetchMsAttachments(accessToken: string, msgId: string): Promise<{ name: string; mime: string; bytes: Uint8Array }[]> {
  const list = await graph(accessToken, `/me/messages/${msgId}/attachments?$select=id,name,contentType,size,isInline,contentBytes`) as { value?: any[] };
  const out: { name: string; mime: string; bytes: Uint8Array }[] = [];
  for (const a of (list?.value || [])) {
    if (!String(a["@odata.type"] || "").includes("fileAttachment")) continue; // skip item/reference attachments
    const mime = a.contentType || "application/octet-stream";
    const isImage = mime.startsWith("image/");
    if (a.isInline && isImage && (a.size || 0) < 12000) continue; // skip signature/pixel images
    let bytes: Uint8Array | null = a.contentBytes ? b64ToBytes(a.contentBytes) : null;
    if (!bytes) {
      const raw = await fetch(`https://graph.microsoft.com/v1.0/me/messages/${msgId}/attachments/${a.id}/$value`, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (raw.ok) bytes = new Uint8Array(await raw.arrayBuffer());
    }
    if (bytes?.length) out.push({ name: a.name || "file", mime, bytes });
  }
  return out;
}

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

function stripHtml(s: string) {
  return s.replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: conn } = await supabase.from("microsoft_connections")
      .select("id, email, refresh_token, last_polled_at").eq("is_active", true)
      .order("updated_at", { ascending: false }).limit(1).maybeSingle();
    if (!conn?.refresh_token) return json({ success: true, processed: 0, note: "No Microsoft mailbox connected" });

    // Refresh the access token (and persist the rotated refresh token).
    const tok = await msTokenFromRefresh(conn.refresh_token);
    const accessToken = tok.access_token;
    await supabase.from("microsoft_connections").update({
      access_token: accessToken,
      token_expires_at: new Date(Date.now() + (tok.expires_in || 3600) * 1000).toISOString(),
      ...(tok.refresh_token ? { refresh_token: tok.refresh_token } : {}),
    }).eq("id", conn.id);

    // Internal senders never become tickets: connected mailboxes + staff + own domain.
    const internal = new Set<string>();
    const [{ data: conns }, { data: profs }] = await Promise.all([
      supabase.from("microsoft_connections").select("email"),
      supabase.from("profiles").select("email"),
    ]);
    (conns || []).forEach((c: { email?: string }) => c.email && internal.add(c.email.toLowerCase()));
    (profs || []).forEach((p: { email?: string }) => p.email && internal.add(p.email.toLowerCase()));
    const ownDomain = (conn.email || "").toLowerCase().split("@")[1] || "";
    const isInternal = (e: string) => {
      e = (e || "").toLowerCase().trim();
      if (!e) return true;
      if (internal.has(e)) return true;
      return !!ownDomain && e.split("@")[1] === ownDomain;
    };

    // Mail since the watermark (5-min overlap; message-id dedup covers it).
    const sinceMs = conn.last_polled_at ? new Date(conn.last_polled_at).getTime() : Date.now();
    const since = new Date(sinceMs - 5 * 60 * 1000).toISOString();
    const runStarted = new Date().toISOString();
    const path = `/me/mailFolders/inbox/messages?$filter=receivedDateTime ge ${since}` +
      `&$orderby=receivedDateTime desc&$top=30&$select=id,internetMessageId,conversationId,subject,from,receivedDateTime,body,hasAttachments`;
    const list = await graph(accessToken, path) as { value?: any[] };
    const messages = list?.value || [];
    let processed = 0;

    for (const m of messages) {
      const messageId = m.internetMessageId || m.id;
      const conversationId = m.conversationId || m.id;
      const subject = m.subject || "";
      const senderEmail = (m.from?.emailAddress?.address || "").toLowerCase();
      const senderName = m.from?.emailAddress?.name || "";
      if (isInternal(senderEmail)) continue;

      // Dedup across overlapping polls.
      const { data: dup } = await supabase.from("crm_activities").select("id").eq("message_id", messageId).limit(1);
      if (dup && dup.length) continue;

      // Thread match by conversationId.
      let ticketId: string | null = null;
      const { data: tm } = await supabase.from("ticket_email_threads").select("ticket_id").eq("email_thread_id", conversationId).limit(1);
      if (tm && tm.length) {
        ticketId = tm[0].ticket_id;
        const { data: t } = await supabase.from("tickets").select("stage").eq("id", ticketId).single();
        if (t && ["resolved", "closed"].includes(t.stage)) {
          await supabase.from("tickets").update({ stage: "in_progress" }).eq("id", ticketId);
          await supabase.from("stage_history").insert({ object_type: "ticket", object_id: ticketId, from_stage: t.stage, to_stage: "in_progress" });
        }
      }

      // Match sender -> contact (+ company via associations).
      let contactId: string | null = null, companyId: string | null = null;
      const { data: contacts } = await supabase.from("contacts").select("id").ilike("email", senderEmail).limit(1);
      if (contacts && contacts.length) {
        contactId = contacts[0].id;
        const { data: a } = await supabase.from("associations").select("to_id").eq("from_type", "contact").eq("from_id", contactId).eq("to_type", "company").limit(1);
        if (a && a.length) companyId = a[0].to_id;
      }

      // New ticket if no thread match.
      if (!ticketId) {
        const td: Record<string, unknown> = { subject: subject || `Email from ${senderEmail}`, channel: "email", customer_email: senderEmail, contact_id: contactId, source: "email" };
        if (companyId) td.company_id = companyId;
        const { data: nt } = await supabase.from("tickets").insert(td).select().single();
        if (nt) {
          ticketId = nt.id;
          await supabase.from("stage_history").insert({ object_type: "ticket", object_id: ticketId, from_stage: null, to_stage: "new" });
          if (contactId) await supabase.from("associations").insert({ from_type: "ticket", from_id: ticketId, to_type: "contact", to_id: contactId, label: "primary_contact" });
          await supabase.from("ticket_email_threads").insert({ ticket_id: ticketId, email_thread_id: conversationId });

          // Auto-reply on first contact only (threaded reply via Graph).
          try {
            const { data: vs } = await supabase.from("support_settings")
              .select("auto_reply_email_enabled, auto_reply_email_subject, auto_reply_email_message, after_hours_email_subject, after_hours_email_message, business_hours_enabled, business_timezone, business_hours").eq("id", 1).single();
            if (vs?.auto_reply_email_enabled) {
              // Out of hours (if hours are configured + an after-hours message is set), send that instead.
              const afterHours = !isOpenNow(vs) && !!(vs.after_hours_email_message || "").trim();
              const tmpl = afterHours ? vs.after_hours_email_message : vs.auto_reply_email_message;
              const subj = afterHours ? (vs.after_hours_email_subject || vs.auto_reply_email_subject) : vs.auto_reply_email_subject;
              const replyBody = (tmpl || "")
                .replace(/\{\{\s*contact_name\s*\}\}/g, senderName || "there")
                .replace(/\{\{\s*ticket_number\s*\}\}/g, nt.ticket_number ? `#${nt.ticket_number}` : "");
              await graph(accessToken, `/me/messages/${m.id}/reply`, { method: "POST", body: JSON.stringify({ comment: replyBody }) });
              await supabase.from("crm_activities").insert({
                type: "email", subject: subj || `Re: ${subject}`, body: replyBody,
                subject_type: "ticket", subject_id: ticketId, direction: "outbound", is_internal: false,
                thread_id: conversationId, channel_metadata: { auto_reply: true, after_hours: afterHours, to: senderEmail },
              });
            }
          } catch (e) { console.error("MS auto-reply failed:", (e as Error).message); }
        }
      }

      // Log the inbound email as an activity.
      if (ticketId) {
        const isHtml = m.body?.contentType === "html";
        const rawHtml = isHtml ? (m.body?.content || "") : null;
        const bodyText = isHtml ? stripHtml(m.body?.content || "") : (m.body?.content || "");
        const { data: inboundAct } = await supabase.from("crm_activities").insert({
          type: "email", subject, body: bodyText.slice(0, 10000),
          subject_type: "ticket", subject_id: ticketId, direction: "inbound", contact_id: contactId,
          message_id: messageId, thread_id: conversationId, is_internal: false,
          channel_metadata: { from: senderEmail, ms_message_id: m.id, conversation_id: conversationId, ...(rawHtml ? { html: rawHtml.slice(0, 200000) } : {}) },
          occurred_at: m.receivedDateTime ? new Date(m.receivedDateTime).toISOString() : new Date().toISOString(),
        }).select("id").single();

        // Store any email attachments (screenshots, photos, PDFs) against the ticket.
        if (m.hasAttachments) {
          try {
            const atts = await fetchMsAttachments(accessToken, m.id);
            for (const a of atts) {
              await storeAttachment(supabase, {
                ticketId, activityId: inboundAct?.id || null,
                name: a.name, mime: a.mime, bytes: a.bytes, source: "inbound_email",
              });
            }
          } catch (e) { console.error("MS attachment store failed:", (e as Error).message); }
        }
        processed++;
      }
    }

    await supabase.from("microsoft_connections").update({ last_polled_at: runStarted }).eq("id", conn.id);
    return json({ success: true, processed, total: messages.length, mailbox: conn.email });
  } catch (e) {
    console.error("ms-check error:", (e as Error).message);
    return json({ error: (e as Error).message }, 500);
  }
});
