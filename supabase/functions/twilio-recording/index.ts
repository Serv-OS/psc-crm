// Twilio recording handler.
//   POST (recordingStatusCallback) -> attach a finished call recording to its
//        call activity (matched by CallSid).
//   GET  ?sid=RExxxx -> stream the recording audio (Twilio media needs auth,
//        so we proxy it for in-app playback).
//
// Required secrets: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID")!;
  const authToken = Deno.env.get("TWILIO_AUTH_TOKEN")!;

  // ---- GET: stream a recording for in-app playback ----
  if (req.method === "GET") {
    const sid = new URL(req.url).searchParams.get("sid");
    if (!sid) return new Response("Missing sid", { status: 400, headers: cors });
    const mediaUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Recordings/${sid}.mp3`;
    const auth = "Basic " + btoa(`${accountSid}:${authToken}`);
    const upstream = await fetch(mediaUrl, { headers: { Authorization: auth } });
    if (!upstream.ok) return new Response("Recording unavailable", { status: upstream.status, headers: cors });
    return new Response(upstream.body, {
      headers: { ...cors, "Content-Type": "audio/mpeg", "Cache-Control": "private, max-age=3600" },
    });
  }

  // ---- POST: recordingStatusCallback -> attach to the call activity ----
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const form = await req.formData();
    const callSid = form.get("CallSid") as string;
    const recordingSid = form.get("RecordingSid") as string;
    const recordingDuration = parseInt((form.get("RecordingDuration") as string) || "0");

    if (callSid && recordingSid) {
      const { data: activity } = await supabase
        .from("crm_activities")
        .select("id, channel_metadata")
        .eq("message_id", callSid)
        .limit(1)
        .single();
      if (activity) {
        const md = activity.channel_metadata || {};
        md.recording_sid = recordingSid;
        md.recording_duration = recordingDuration;
        await supabase.from("crm_activities").update({ channel_metadata: md }).eq("id", activity.id);
      }
    }
    return new Response("ok", { headers: cors });
  } catch (e) {
    console.error("recording callback error:", e);
    return new Response("ok", { headers: cors });
  }
});
