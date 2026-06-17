// Twilio Usage Sync — meters ONE phone number's usage + cost from the Twilio
// Calls and Messages APIs and upserts a monthly row into public.twilio_usage.
// The account is shared across clients, so we filter by the number stored in
// support_settings.twilio_number (NOT account-wide usage). The monthly number
// rental is a config value (support_settings.twilio_number_rental) since the
// per-number rental isn't exposed in the usage APIs.
//
// Used by the back-office "Phone (Twilio)" panel to compute the marked-up bill.
//
// Auth: owner/editor user JWT (the "Sync now" button) OR service-role key (cron).
// Dormant-safe: returns {configured:false} if the Twilio secrets aren't set.
//
// Required Supabase Secrets (once Twilio is live): TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// First-of-month + last-of-month (UTC) for the current month (off=0) or a prior month.
function monthRange(off: number) {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + off, 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + off + 1, 0));
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { period: fmt(start), start: fmt(start), end: fmt(end) };
}

const abs = (v: unknown) => Math.abs(Number(v) || 0);

async function twilioGet(sid: string, token: string, url: string) {
  const res = await fetch(url, { headers: { Authorization: `Basic ${btoa(`${sid}:${token}`)}` } });
  if (!res.ok) throw new Error(`Twilio ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // --- Auth: service-role (cron) OR owner/editor user JWT ---
    const tokenHdr = (req.headers.get("Authorization") || "").replace("Bearer ", "").trim();
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    let allowed = false;
    if (tokenHdr && tokenHdr === serviceKey) {
      allowed = true;
    } else if (tokenHdr) {
      const { data: { user } } = await supabase.auth.getUser(tokenHdr);
      if (user) {
        const { data: prof } = await supabase.from("profiles").select("role").eq("id", user.id).single();
        if (prof && (prof.role === "owner" || prof.role === "editor")) allowed = true;
      }
    }
    if (!allowed) return json({ error: "Unauthorized" }, 401);

    // --- Config ---
    const sid = Deno.env.get("TWILIO_ACCOUNT_SID");
    const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
    if (!sid || !authToken) {
      return json({ configured: false, message: "Twilio is not connected yet (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN not set)." });
    }

    const { data: cfg } = await supabase
      .from("support_settings")
      .select("twilio_number, twilio_number_rental")
      .eq("id", 1)
      .maybeSingle();
    const number = cfg?.twilio_number || Deno.env.get("TWILIO_FROM_NUMBER");
    if (!number) return json({ configured: true, message: "No twilio_number set in Settings yet." });
    const rental = Number(cfg?.twilio_number_rental ?? 1.15);

    const enc = encodeURIComponent;
    const base = `https://api.twilio.com/2010-04-01/Accounts/${sid}`;

    const rows = [];
    for (const off of [0, -1]) {
      const { period, start, end } = monthRange(off);

      // Calls: StartTime range, filtered by From (outbound) / To (inbound).
      const callsUrl = (dir: "From" | "To") =>
        `${base}/Calls.json?${dir}=${enc(number)}&StartTime%3E=${start}&StartTime%3C=${end}&PageSize=1000`;
      // Messages: DateSent range, filtered by From / To.
      const msgsUrl = (dir: "From" | "To") =>
        `${base}/Messages.json?${dir}=${enc(number)}&DateSent%3E=${start}&DateSent%3C=${end}&PageSize=1000`;

      const [outCalls, inCalls, outMsgs, inMsgs] = await Promise.all([
        twilioGet(sid, authToken, callsUrl("From")),
        twilioGet(sid, authToken, callsUrl("To")),
        twilioGet(sid, authToken, msgsUrl("From")),
        twilioGet(sid, authToken, msgsUrl("To")),
      ]);

      // Exclude internal browser/WebRTC ("client:") legs — only meter real PSTN
      // legs. An inbound call routed to the softphone otherwise shows up twice
      // (the inbound leg + the dial-to-client leg), doubling the count and cost.
      const isPstn = (c: any) => {
        const f = String(c.from || ""), t = String(c.to || "");
        return !f.startsWith("client:") && !t.startsWith("client:");
      };
      const outboundCalls: any[] = (outCalls.calls || []).filter(isPstn);
      const inboundCalls: any[] = (inCalls.calls || []).filter(isPstn);
      const outboundMsgs: any[] = outMsgs.messages || [];
      const inboundMsgs: any[] = inMsgs.messages || [];

      let seconds = 0, callCost = 0, smsCost = 0, currency = "usd";
      for (const c of [...outboundCalls, ...inboundCalls]) { seconds += Number(c.duration) || 0; callCost += abs(c.price); if (c.price_unit) currency = String(c.price_unit).toLowerCase(); }
      for (const m of [...outboundMsgs, ...inboundMsgs]) { smsCost += abs(m.price); if (m.price_unit) currency = String(m.price_unit).toLowerCase(); }

      const usage_cost = callCost + smsCost;
      // Flag if any list hit the page cap (would mean we under-counted — unlikely at SMB volume).
      const truncated = [outCalls, inCalls, outMsgs, inMsgs].some((r: any) => r.next_page_uri);

      const row = {
        period,
        inbound_calls: inboundCalls.length,
        outbound_calls: outboundCalls.length,
        call_minutes: Math.round((seconds / 60) * 10) / 10,
        inbound_sms: inboundMsgs.length,
        outbound_sms: outboundMsgs.length,
        number_count: 1,
        usage_cost,
        number_cost: rental,
        total_cost: usage_cost + rental,
        currency,
        breakdown: { calls: callCost, sms: smsCost, rental, number, truncated },
        source: "twilio_api",
        synced_at: new Date().toISOString(),
      };
      const { error } = await supabase.from("twilio_usage").upsert(row, { onConflict: "period" });
      if (error) throw new Error(`upsert ${period}: ${error.message}`);
      rows.push(row);
    }

    return json({ configured: true, number, synced: rows.length, periods: rows.map(r => ({ period: r.period, usage_cost: r.usage_cost, total_cost: r.total_cost })) });
  } catch (e) {
    console.error("twilio-usage-sync error:", e);
    return json({ error: (e as Error).message }, 500);
  }
});
