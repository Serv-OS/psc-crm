// ms-send — sends a support reply from a ticket via the connected Microsoft 365
// support mailbox. Mirror of gmail-send, using Microsoft Graph. Threads the
// reply onto the original conversation when we have the source message.
// Called by the frontend with the agent's JWT.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { graph, msTokenFromRefresh } from "../_shared/microsoft.ts";
import { bytesToB64, loadAttachmentsForSend, storeAttachment } from "../_shared/attachments.ts";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const auth = req.headers.get("Authorization")?.replace("Bearer ", "");
    if (!auth) return json({ error: "Unauthorized" }, 401);
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: { user } } = await supabase.auth.getUser(auth);
    if (!user) return json({ error: "Unauthorized" }, 401);

    const { ticket_id, to, subject, body, cc, attachments } = await req.json();
    if (!ticket_id || !to || !body) return json({ error: "Missing ticket_id, to or body" }, 400);

    // Pull any composer-uploaded files out of storage → Graph file attachments.
    const outAtts = await loadAttachmentsForSend(supabase, Array.isArray(attachments) ? attachments : []);
    const graphAtts = outAtts.map((a) => ({
      "@odata.type": "#microsoft.graph.fileAttachment", name: a.name, contentType: a.mime, contentBytes: bytesToB64(a.bytes),
    }));

    // Connected support mailbox → fresh access token (persist rotated refresh token).
    const { data: conn } = await supabase.from("microsoft_connections")
      .select("id, email, refresh_token").eq("is_active", true).order("updated_at", { ascending: false }).limit(1).maybeSingle();
    if (!conn?.refresh_token) return json({ error: "No Microsoft support mailbox connected. Connect one in Settings." }, 503);
    const tok = await msTokenFromRefresh(conn.refresh_token);
    const accessToken = tok.access_token;
    await supabase.from("microsoft_connections").update({
      access_token: accessToken, token_expires_at: new Date(Date.now() + (tok.expires_in || 3600) * 1000).toISOString(),
      ...(tok.refresh_token ? { refresh_token: tok.refresh_token } : {}),
    }).eq("id", conn.id);

    const { data: ticket } = await supabase.from("tickets").select("id, subject, stage").eq("id", ticket_id).single();
    const { data: tm } = await supabase.from("ticket_email_threads").select("email_thread_id").eq("ticket_id", ticket_id).limit(1);
    const conversationId = tm?.[0]?.email_thread_id || null;

    // The Graph id of the most recent inbound message lets us thread the reply.
    const { data: lastIn } = await supabase.from("crm_activities")
      .select("channel_metadata").eq("subject_type", "ticket").eq("subject_id", ticket_id)
      .eq("type", "email").eq("direction", "inbound").order("occurred_at", { ascending: false }).limit(1);
    const srcMsgId = (lastIn?.[0]?.channel_metadata as { ms_message_id?: string } | null)?.ms_message_id || null;

    const emailSubject = subject || (ticket?.subject ? `Re: ${ticket.subject}` : "Support reply");
    const recipients = [{ emailAddress: { address: to } }];
    const ccRecipients = cc ? [{ emailAddress: { address: cc } }] : undefined;

    if (srcMsgId) {
      // Threaded reply onto the original message.
      await graph(accessToken, `/me/messages/${srcMsgId}/reply`, {
        method: "POST",
        body: JSON.stringify({ message: { toRecipients: recipients, ccRecipients, ...(graphAtts.length ? { attachments: graphAtts } : {}) }, comment: body }),
      });
    } else {
      // No prior inbound — start a fresh message.
      await graph(accessToken, `/me/sendMail`, {
        method: "POST",
        body: JSON.stringify({
          message: { subject: emailSubject, body: { contentType: "Text", content: body }, toRecipients: recipients, ccRecipients, ...(graphAtts.length ? { attachments: graphAtts } : {}) },
          saveToSentItems: true,
        }),
      });
    }

    const newMessageId = `<${crypto.randomUUID()}@${(conn.email || "support").split("@")[1] || "psc"}>`;
    const { data: activity } = await supabase.from("crm_activities").insert({
      type: "email", subject: emailSubject, body, subject_type: "ticket", subject_id: ticket_id,
      direction: "outbound", actor_id: user.id, message_id: newMessageId, thread_id: conversationId,
      is_internal: false, channel_metadata: { to, cc: cc || null, from: conn.email },
    }).select().single();

    // Record sent attachments against the new activity so they show on the ticket.
    for (const a of outAtts) {
      await storeAttachment(supabase, {
        ticketId: ticket_id, activityId: activity?.id || null,
        name: a.name, mime: a.mime, bytes: a.bytes, source: "outbound_email", uploadedBy: user.id,
      });
    }

    if (ticket?.stage === "new") {
      await supabase.from("tickets").update({ stage: "waiting_on_customer" }).eq("id", ticket_id);
      await supabase.from("stage_history").insert({ object_type: "ticket", object_id: ticket_id, from_stage: "new", to_stage: "waiting_on_customer", changed_by: user.id });
    }

    return json({ success: true, activity_id: activity?.id });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
