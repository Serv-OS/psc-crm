// Twilio Usage Sync — pulls real usage + cost from the Twilio Usage Records API
// and upserts a monthly row into public.twilio_usage (used by the back-office
// "Phone (Twilio)" billing panel to compute the marked-up bill to the client).
//
// Auth: callable by an owner/editor (user JWT) via the "Sync now" button, OR by
// a cron/server caller presenting the service-role key as the Bearer token.
//
// Dormant-safe: if the Twilio secrets are not set it returns {configured:false}
// and writes nothing — so it can be deployed before Twilio is connected.
//
// Required Supabase Secrets (once Twilio is live): TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Leaf usage categories we sum — chosen so they never overlap hierarchically
// (no double counting). `phonenumbers` is the monthly number rental.
const CALL_IN = "calls-inbound";
const CALL_OUT = "calls-outbound";
const SMS_IN = "sms-inbound";
const SMS_OUT = "sms-outbound";
const NUMBERS = "phonenumbers";
const COST_LEAVES = [CALL_IN, CALL_OUT, SMS_IN, SMS_OUT, NUMBERS, "recordings", "recordingstorage", "transcriptions", "mms-inbound", "mms-outbound"];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Fetch one period subresource (ThisMonth / LastMonth) and reduce to a row.
async function fetchPeriod(accountSid: string, authToken: string, sub: "ThisMonth" | "LastMonth") {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Usage/Records/${sub}.json?PageSize=1000`;
  const res = await fetch(url, {
    headers: { Authorization: `Basic ${btoa(`${accountSid}:${authToken}`)}` },
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Twilio ${sub} ${res.status}: ${detail.slice(0, 300)}`);
  }
  const data = await res.json();
  const records: any[] = data.usage_records || [];
  const by: Record<string, any> = {};
  for (const r of records) by[r.category] = r;

  const num = (cat: string, field: "price" | "count" | "usage") => Number(by[cat]?.[field] || 0);

  // Period = first of the month from any record's start_date (fallback: derive).
  const start = records[0]?.start_date || null;
  const period = start ? start.slice(0, 8) + "01" : null;

  const number_cost = num(NUMBERS, "price");
  let total_cost = 0;
  const breakdown: Record<string, number> = {};
  for (const cat of COST_LEAVES) {
    const p = num(cat, "price");
    if (p) breakdown[cat] = p;
    total_cost += p;
  }

  return {
    period,
    inbound_calls: Math.round(num(CALL_IN, "count")),
    outbound_calls: Math.round(num(CALL_OUT, "count")),
    call_minutes: num(CALL_IN, "usage") + num(CALL_OUT, "usage"),
    inbound_sms: Math.round(num(SMS_IN, "count")),
    outbound_sms: Math.round(num(SMS_OUT, "count")),
    number_count: Math.round(num(NUMBERS, "count")),
    usage_cost: total_cost - number_cost,
    number_cost,
    total_cost,
    currency: (records[0]?.price_unit || "usd").toLowerCase(),
    breakdown,
    source: "twilio_api",
    synced_at: new Date().toISOString(),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // --- Auth: service-role (cron) OR owner/editor user JWT ---
    const token = (req.headers.get("Authorization") || "").replace("Bearer ", "").trim();
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    let allowed = false;
    if (token && token === serviceKey) {
      allowed = true; // cron / server-to-server
    } else if (token) {
      const { data: { user } } = await supabase.auth.getUser(token);
      if (user) {
        const { data: prof } = await supabase.from("profiles").select("role").eq("id", user.id).single();
        if (prof && (prof.role === "owner" || prof.role === "editor")) allowed = true;
      }
    }
    if (!allowed) return json({ error: "Unauthorized" }, 401);

    // --- Twilio config (dormant-safe) ---
    const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
    const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
    if (!accountSid || !authToken) {
      return json({ configured: false, message: "Twilio is not connected yet (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN not set)." });
    }

    // Sync the current month and the previous full month.
    const periods = ["ThisMonth", "LastMonth"] as const;
    const rows = [];
    for (const sub of periods) {
      const row = await fetchPeriod(accountSid, authToken, sub);
      if (!row.period) continue;
      const { error } = await supabase.from("twilio_usage").upsert(row, { onConflict: "period" });
      if (error) throw new Error(`upsert ${sub}: ${error.message}`);
      rows.push(row);
    }

    return json({ configured: true, synced: rows.length, periods: rows.map(r => ({ period: r.period, total_cost: r.total_cost })) });
  } catch (e) {
    console.error("twilio-usage-sync error:", e);
    return json({ error: (e as Error).message }, 500);
  }
});
