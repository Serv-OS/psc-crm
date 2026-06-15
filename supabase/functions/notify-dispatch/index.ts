// Delivers a notification to its recipient via email and/or SMS, respecting
// notification_preferences. Invoked by a DB trigger (pg_net) on INSERT into
// public.notifications — fire and forget.
//
// Email: sent from the connected support mailbox (gmail_connections).
// SMS: Twilio using TWILIO_FROM_NUMBER. UK 07… numbers are normalised to E.164.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendInvoiceEmail } from "../_shared/invoiceEmail.ts";

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

const TYPE_PREF: Record<string, string> = {
  mention: "notify_on_mention",
  assignment: "notify_on_assignment",
  reply: "notify_on_reply",
  // 'system' (e.g. new support ticket) always delivers — vital for support
};

function e164(raw: string): string | null {
  let n = (raw || "").replace(/[\s()-]/g, "");
  if (!n) return null;
  if (n.startsWith("+")) return n;
  if (n.startsWith("07")) return "+44" + n.slice(1);
  if (n.startsWith("447")) return "+" + n;
  if (n.startsWith("0044")) return "+" + n.slice(2);
  return null;
}

function inQuietHours(start: string | null, end: string | null): boolean {
  if (!start || !end) return false;
  const now = new Date().toLocaleTimeString("en-GB", { hour12: false, timeZone: "Europe/London" }).slice(0, 5);
  return start < end ? (now >= start && now < end) : (now >= start || now < end);
}

// Post a notification to a Google Chat space via its incoming webhook.
async function postToChat(webhookUrl: string, title: string, body: string, appUrl: string): Promise<void> {
  const text = `*${title || "CRM notification"}*${body ? `\n${body}` : ""}\n<${appUrl}|Open CRM>`;
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error(`Chat webhook HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

serve(async (req) => {
  try {
    const payload = await req.json().catch(() => ({}));
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const appUrl = Deno.env.get("APP_URL") || "https://posupject.vercel.app";

    // Test path: Settings "Send test" button -> post a sample to the Chat space.
    if (payload.test_chat) {
      const { data: s } = await supabase.from("support_settings")
        .select("chat_webhook_url").eq("id", 1).maybeSingle();
      if (!s?.chat_webhook_url) return json({ error: "No Chat webhook URL saved" }, 400);
      try {
        await postToChat(s.chat_webhook_url, "Test notification",
          "If you can see this, Google Chat notifications are working. \u{1F389}", appUrl);
        return json({ ok: true, chat: "sent" });
      } catch (e) { return json({ error: (e as Error).message }, 502); }
    }

    const notification_id = payload.notification_id;
    if (!notification_id) return json({ error: "notification_id required" }, 400);

    const { data: n } = await supabase.from("notifications").select("*").eq("id", notification_id).maybeSingle();
    if (!n) return json({ error: "not found" }, 404);
    if (n.emailed_at || n.smsed_at || n.chatted_at) return json({ skipped: "already delivered" });

    const { data: p } = await supabase.from("profiles")
      .select("email, phone, mobile, display_name").eq("id", n.recipient_id).maybeSingle();
    if (!p) return json({ skipped: "no profile" });

    const { data: prefs } = await supabase.from("notification_preferences")
      .select("*").eq("profile_id", n.recipient_id).maybeSingle();
    const emailOn = prefs ? !!prefs.email_enabled : true;   // default: email on
    const smsOn = prefs ? !!prefs.sms_enabled : false;      // default: sms off
    const typePref = TYPE_PREF[n.type];
    if (typePref && prefs && prefs[typePref] === false) return json({ skipped: "type disabled" });
    const quiet = inQuietHours(prefs?.quiet_hours_start || null, prefs?.quiet_hours_end || null);

    const updates: Record<string, string> = {};
    const results: Record<string, string> = {};

    if (emailOn && p.email) {
      try {
        const html = `
<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px">
  <div style="font-size:13px;color:#777;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">CRM notification</div>
  <div style="font-size:18px;font-weight:700;color:#111;margin-bottom:6px">${n.title || "Notification"}</div>
  ${n.body ? `<div style="font-size:14px;color:#444;margin-bottom:18px">${n.body}</div>` : ""}
  <a href="${appUrl}" style="display:inline-block;background:#15C26A;color:#fff;font-weight:600;font-size:14px;padding:10px 22px;border-radius:8px;text-decoration:none">Open CRM</a>
  <div style="font-size:11px;color:#999;margin-top:20px">You can change notification preferences in your account settings.</div>
</div>`;
        await sendInvoiceEmail(supabase, p.email, n.title || "CRM notification", html);
        updates.emailed_at = new Date().toISOString();
        results.email = "sent";
      } catch (e) { results.email = "failed: " + (e as Error).message; }
    }

    if (smsOn && !quiet) {
      const to = e164(p.mobile || p.phone || "");
      const sid = Deno.env.get("TWILIO_ACCOUNT_SID");
      const tok = Deno.env.get("TWILIO_AUTH_TOKEN");
      const from = Deno.env.get("TWILIO_FROM_NUMBER");
      if (to && sid && tok && from) {
        try {
          const body = `${n.title || "CRM notification"}${n.body ? " — " + n.body : ""}`.slice(0, 150);
          const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
            method: "POST",
            headers: {
              Authorization: "Basic " + btoa(`${sid}:${tok}`),
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({ From: from, To: to, Body: body }),
          });
          if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.message || `HTTP ${res.status}`);
          updates.smsed_at = new Date().toISOString();
          results.sms = "sent";
        } catch (e) { results.sms = "failed: " + (e as Error).message; }
      } else {
        results.sms = to ? "twilio not configured" : "no mobile number on profile";
      }
    } else if (smsOn && quiet) {
      results.sms = "skipped: quiet hours";
    }

    // Google Chat (team space). Instance-level, not per-user: one shared feed.
    // A single event fans out to N recipient rows, so dedupe to one Chat post
    // by skipping if a sibling notification (same title+link, created within
    // 30s) already went to Chat.
    const { data: cfg } = await supabase.from("support_settings")
      .select("chat_webhook_url, chat_notify_enabled").eq("id", 1).maybeSingle();
    if (cfg?.chat_notify_enabled && cfg.chat_webhook_url) {
      const since = new Date(new Date(n.created_at).getTime() - 30000).toISOString();
      let q = supabase.from("notifications")
        .select("id").eq("title", n.title).not("chatted_at", "is", null)
        .gte("created_at", since).neq("id", n.id);
      q = n.link_id ? q.eq("link_id", n.link_id) : q.is("link_id", null);
      const { data: sibling } = await q.limit(1);
      if ((sibling || []).length > 0) {
        results.chat = "skipped: already posted for this event";
      } else {
        try {
          await postToChat(cfg.chat_webhook_url, n.title, n.body, appUrl);
          updates.chatted_at = new Date().toISOString();
          results.chat = "sent";
        } catch (e) { results.chat = "failed: " + (e as Error).message; }
      }
    }

    if (Object.keys(updates).length) await supabase.from("notifications").update(updates).eq("id", n.id);
    return json({ ok: true, ...results });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
