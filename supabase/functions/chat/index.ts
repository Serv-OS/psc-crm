// chat — the sales assistant behind the embeddable website widget.
//
// Runs as service_role (the chat_* tables carry no anon policy on purpose), so
// every request is validated here: the site key must exist and be active, and
// the caller's Origin must be in that site's allow-list.
//
// DESIGN — the model runs the conversation, the code owns the money.
//
// A sales bot that invents prices is worse than no sales bot, so the model is
// never asked for a number. It calls `estimate_project`, which runs the real
// quote engine over the live catalogue and returns a widened range; and
// `capture_lead`, which writes the pipeline records. Code enforces:
//
//   1. Every figure the visitor sees came from the engine. A reply containing
//      an unbacked price is replaced, not sent.
//   2. Internal cost, markup and margin are never put in front of the model.
//   3. No lead is created without a way to reach the person.
//   4. Forbidden and urgent topics never reach the model at all.
//   5. A conversation that gets away from it still ends as a captured lead.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildEngineConfig, computeQuote, PRODUCT_NAMES, DEMO_LABELS, num } from "../_shared/quoteEngine.ts";
import { captureSalesLead, enrichSalesLead } from "../_shared/salesCapture.ts";
import { mentionsPrice } from "../_shared/priceGuard.ts";
import type { Qualification } from "../_shared/leadScore.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const MAX_TURNS = 40;
const HISTORY_TURNS = 16;
const MAX_TOOL_ROUNDS = 4;

const looksLikeEmail = (s: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test((s || "").trim());
const looksLikePhone = (s: string) => (s || "").replace(/\D/g, "").length >= 9;

/** Whole-word keyword match, so "lien" can never fire inside "client". */
function hitsKeyword(text: string, list: string[]): string | null {
  const low = ` ${(text || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ")} `;
  for (const raw of list || []) {
    const k = (raw || "").toLowerCase().trim().replace(/\s+/g, " ");
    if (!k) continue;
    if (low.includes(` ${k} `)) return raw;
  }
  return null;
}

function originAllowed(origin: string | null, allowed: string[]): boolean {
  if (!allowed?.length) return true;
  if (!origin) return false;
  let host = origin;
  try { host = new URL(origin).host; } catch { /* keep raw */ }
  return allowed.some((a) => {
    const clean = a.trim().replace(/^https?:\/\//, "").replace(/\/$/, "").toLowerCase();
    return !!clean && (host.toLowerCase() === clean || host.toLowerCase().endsWith("." + clean));
  });
}

const money = (v: number) => "$" + Math.round(v).toLocaleString("en-US");

/** The widget renders replies as plain text, so markdown arrives as literal
 *  characters — a visitor was shown "**$43,500 to $59,500**". Strip the few
 *  things a model reaches for out of habit. */
function plainText(t: string): string {
  return (t || "")
    .replace(/\*\*(.+?)\*\*/g, "$1")     // **bold**
    .replace(/(^|\s)\*(\S[^*]*?)\*(?=\s|$|[.,!?])/g, "$1$2")   // *italic*
    .replace(/(^|\s)__(.+?)__(?=\s|$|[.,!?])/g, "$1$2")
    .replace(/^\s*[-*•]\s+/gm, "")        // bullet leaders
    .replace(/^#{1,6}\s+/gm, "")           // headings
    .trim();
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const { site_key, session_id, message, visitor } = (await req.json()) || {};
    if (!site_key) return json({ error: "Missing site_key" }, 422);

    const { data: site } = await supabase.from("chat_sites")
      .select("*").eq("site_key", site_key).eq("active", true).maybeSingle();
    if (!site) return json({ error: "Unknown or inactive site key" }, 403);

    const { data: pbRow } = await supabase.from("chat_playbook").select("*").eq("id", 1).maybeSingle();
    const pb = (pbRow || {}) as any;

    // The back office previews an embed from the CRM's own domain, which is
    // never in a customer-facing allow-list — "Open ↗" failed every time. That
    // origin is recorded by the settings screen and always accepted.
    const origin = req.headers.get("origin");
    const allowList = [...(site.allowed_origins || [])];
    if (pb.preview_origin) allowList.push(pb.preview_origin);
    if (!originAllowed(origin, allowList)) {
      return json({ error: "This domain isn't allowed to use this chat." }, 403);
    }
    if (pb.enabled === false) return json({ error: "Chat is turned off." }, 503);

    // ── Session ─────────────────────────────────────────────────────────────
    let session: any = null;
    if (session_id) {
      const { data } = await supabase.from("chat_sessions").select("*").eq("id", session_id).maybeSingle();
      session = data;
    }
    if (!session) {
      const { data } = await supabase.from("chat_sessions").insert({
        site_id: site.id,
        origin: origin || null,
        visitor_name: visitor?.name || null,
        visitor_email: visitor?.email || null,
      }).select().single();
      session = data;
      if (!message) {
        await supabase.from("chat_messages").insert({ session_id: session.id, role: "bot", content: pb.greeting });
        return json({ session_id: session.id, reply: pb.greeting, escalated: false });
      }
    }
    if (session.status === "closed") return json({ error: "This chat has ended." }, 410);
    if (!message || !String(message).trim()) return json({ error: "Empty message" }, 422);

    const text = String(message).trim().slice(0, 2000);
    await supabase.from("chat_messages").insert({ session_id: session.id, role: "visitor", content: text });

    const { data: history } = await supabase.from("chat_messages")
      .select("role, content, created_at").eq("session_id", session.id).order("created_at", { ascending: true });

    const TRANSCRIPT_MARK = "══════════ CHAT TRANSCRIPT ══════════";

    // Field extraction is the model's job and it will sometimes miss one — it
    // told Dave it would note the side gate and the dogs, then didn't. So once a
    // lead exists the whole conversation is mirrored onto it after every turn.
    // Nothing a customer says can be lost, whether or not it was extracted.
    const refreshTranscript = async (finalReply: string) => {
      if (!session.lead_id) return;
      try {
        // Who said what has to be unmistakable at a glance. "Visitor:" and
        // "Assistant:" a line apart ran together into a wall of text, and a rep
        // skim-reading could not tell which half was the customer — which is the
        // only half that matters. Every turn is now labelled, numbered and
        // separated, and the customer's words are marked so they stand out.
        const turns = [
          ...(history || []).map((m: any) => ({ who: m.role === "visitor" ? "customer" : "bot", text: m.content })),
          { who: "bot", text: finalReply },
        ];
        let n = 0;
        const lines = turns.map((t: any) => {
          const body = String(t.text || "").trim().split("\n").map((l: string) => `    ${l}`).join("\n");
          if (t.who === "customer") {
            n += 1;
            return `▶ CUSTOMER  (${n})\n${body}`;
          }
          return `  assistant (AI)\n${body}`;
        });
        const transcript = lines.join("\n\n").slice(-9000);
        const { data: cur } = await supabase.from("leads").select("notes").eq("id", session.lead_id).maybeSingle();
        const base = String(cur?.notes || "").split(TRANSCRIPT_MARK)[0].trimEnd();
        const footer =
          `${TRANSCRIPT_MARK}\n` +
          `Automated website chat. "▶ CUSTOMER" lines are the customer's own words;\n` +
          `"assistant (AI)" lines were written by the assistant, not by a person.\n\n` +
          transcript;
        await supabase.from("leads")
          .update({ notes: `${base}\n\n${footer}` })
          .eq("id", session.lead_id);
      } catch (e) {
        console.error("chat: transcript refresh failed", e);
      }
    };

    const say = async (rawReply: string, extra: Record<string, unknown> = {}) => {
      const reply = plainText(rawReply);
      await supabase.from("chat_messages").insert({ session_id: session.id, role: "bot", content: reply });
      await supabase.from("chat_sessions").update({ last_at: new Date().toISOString() }).eq("id", session.id);
      await refreshTranscript(reply);
      return json({ session_id: session.id, reply, ...extra });
    };

    const haveContact = () => !!(session.visitor_email || session.visitor_phone);

    // Hand-over: capture whatever we have so a rep can chase it, then say so.
    const handOver = async (reply: string, reason: string) => {
      if (!session.lead_id && haveContact()) {
        try {
          const res = await captureSalesLead(supabase, {
            name: session.visitor_name || "Website enquiry",
            email: session.visitor_email, phone: session.visitor_phone,
            notes: `Handed to a person from the website chat — ${reason}.\n\n` +
              (history || []).map((m: any) => `${m.role === "visitor" ? "Visitor" : "Assistant"}: ${m.content}`).join("\n"),
            project: null,
          });
          await supabase.from("chat_sessions").update({
            status: "handed_over", contact_id: res.contact_id, lead_id: res.lead_id, deal_id: res.deal_id,
          }).eq("id", session.id);
        } catch (e) {
          console.error("chat: hand-over capture failed", e);
        }
      } else {
        await supabase.from("chat_sessions").update({ status: "handed_over", pending_reason: reason }).eq("id", session.id);
      }
      // Once it is genuinely with an estimator, say so. "Let me get a person to
      // pick this up" leaves someone wondering whether anything happened at all.
      const passedOn = !!session.lead_id;
      const finalReply = plainText(
        passedOn
          ? ((pb.handover_reply || "").trim()
             || "Thanks — I've passed this through to one of our estimators, who will be in touch shortly.")
          : reply,
      );
      await supabase.from("chat_messages").insert({ session_id: session.id, role: "bot", content: finalReply, escalated: true });
      await refreshTranscript(finalReply);
      return json({ session_id: session.id, reply: finalReply, escalated: true });
    };

    // Ask once for a way to reach them before giving up on the conversation.
    const wantHandOver = async (reply: string, reason: string) => {
      if (haveContact() || session.pending_reason) return await handOver(reply, reason);
      await supabase.from("chat_sessions").update({ pending_reason: reason }).eq("id", session.id);
      session.pending_reason = reason;
      return await say("Let me get one of our estimators onto this. What's the best email or number for you?");
    };

    if ((history || []).length >= MAX_TURNS) {
      return await wantHandOver("We've covered plenty here — let me get a person to pick this up properly.", "conversation length");
    }

    // ── Topic rules, before the model is asked anything ──────────────────────
    const urgent = hitsKeyword(text, pb.always_escalate || []);
    if (urgent) {
      return await wantHandOver("That needs a person rather than me — I'm getting this to our team now.", `urgent keyword: ${urgent}`);
    }
    const forbidden = hitsKeyword(text, pb.never_answer || []);
    if (forbidden) return await wantHandOver(pb.unknown_reply, `restricted topic: ${forbidden}`);

    const { data: cfgRow } = await supabase.from("ai_settings").select("*").eq("id", 1).maybeSingle();
    if (!cfgRow?.enabled || !cfgRow?.api_key) return await wantHandOver(pb.unknown_reply, "AI not configured");

    // ── What it is allowed to state as fact ─────────────────────────────────
    const asked = (history || []).filter((m: any) => m.role === "visitor").slice(-4).map((m: any) => m.content).join(" ").slice(0, 400);
    let knowledge: any[] = [];
    if (asked.trim().length > 8) {
      const { data: kb } = await supabase.rpc("kb_search", { q: asked, lim: 5 });
      knowledge = kb || [];
    }
    const knowledgeBlock = knowledge.length
      ? `WHAT WE KNOW — you may state these as fact, in your own words:\n` +
        knowledge.map((k: any, i: number) => `[${i + 1}] ${k.title || k.question}\nQ: ${k.question}\nA: ${k.answer}`).join("\n\n")
      : `WHAT WE KNOW: nothing on file covers this yet. Do NOT invent an answer about our process, ` +
        `materials, warranty or timescales — say you'll have an estimator confirm it.`;

    // ── The catalogue, so it offers things we actually sell ─────────────────
    const { data: prodRows } = await supabase.from("quote_config_products")
      .select("name").eq("active", true).order("sort").limit(40);
    const catalogue = (prodRows || []).map((p: any) => p.name).filter(Boolean);

    const names = (pb.persona_names || []).filter(Boolean);
    const persona = names.length ? names[Math.floor(Math.random() * names.length)] : null;
    const estimatesOn = pb.estimates_enabled !== false;
    const measureUrl = (pb.measure_tool_url || "").trim();

    const identity = (pb.business_context || "").trim()
      || "You work for a siding contractor. Never claim to be the manufacturer of the products you install.";

    // ── The funnel, tracked in code ─────────────────────────────────────────
    //
    // Left to itself the model tracked outstanding questions from the transcript
    // alone, and drifted: it took "whole house" as the answer to the damage
    // question, asked for the timeline twice, and never reached square footage.
    // It also asked for a phone number five messages after being given one.
    //
    // So the checklist lives here. Code works out what is answered, what is
    // still outstanding, and hands the model exactly one thing to ask next. The
    // model does the talking; it is not asked to remember.
    const q0 = (session.qualification || {}) as Record<string, any>;
    const skipped: string[] = Array.isArray(q0._skipped) ? q0._skipped : [];

    type Item = { key: string; got: boolean; label: string; ask: string; optional?: boolean };
    const has = (k: string) => {
      const v = q0[k];
      return !(v === undefined || v === null || v === "");
    };
    const CHECKLIST: Item[] = [
      { key: "name", got: !!session.visitor_name, label: "name", ask: "their name" },
      { key: "contact", got: !!(session.visitor_email || session.visitor_phone), label: "phone or email", ask: "the best phone number or email" },
      { key: "address", got: has("address"), label: "property address", ask: "the address of the property" },
      { key: "is_owner", got: has("is_owner"), label: "owns it", ask: "whether they own the property" },
      { key: "motivation", got: has("motivation"), label: "why now", ask: "what is prompting them to look into new siding" },
      { key: "has_damage", got: has("has_damage"), label: "damage", ask: "whether they have noticed damage — cracking, warping, rot, mold, or water getting in" },
      { key: "scope", got: has("scope"), label: "scope", ask: "whether it is the whole home or specific areas" },
      { key: "home_age", got: has("home_age"), label: "age of home", ask: "roughly how old the home is" },
      { key: "current_material", got: has("current_material"), label: "current siding", ask: "what the current siding material is" },
      { key: "wants_insulation", got: has("wants_insulation"), label: "insulation", ask: "whether they would like insulation included in the quote" },
      { key: "other_items", got: has("other_items"), label: "other exterior work", ask: "any other exterior items to look at — windows, doors, trim, gutters", optional: true },
      { key: "sqft", got: !!session.estimate?.sqft, label: "square footage", ask:
        "whether they know the wall area to be covered, in square feet. Say that most people don't, and " +
        (measureUrl
          ? `if they don't, give them this exact link in the same reply: ${measureUrl}`
          : "if they don't, reassure them an estimator will measure on site") },
      { key: "profile_preference", got: has("profile_preference"), label: "siding profile", ask: "which profile they picture — lap (horizontal boards), board-and-batten panels, or shingles. Offer a recommendation if they are unsure" },
      { key: "material_preference", got: has("material_preference"), label: "brand/material", ask: "whether they have a brand or material in mind, like James Hardie fiber cement, or would like a recommendation" },
      { key: "finish_preference", got: has("finish_preference"), label: "finish", ask: "pre-painted ColorPlus or primed for painting on site" },
      { key: "timeline", got: has("timeline"), label: "timeline", ask: "when they would ideally like to start — as soon as possible, 1-3 months, 3-6 months, or just researching" },
      { key: "budget_max", got: has("budget_max"), label: "budget", ask: "whether they have a budget range in mind — optional, never push", optional: true },
      { key: "preferred_days", got: has("preferred_days") || has("preferred_times"), label: "availability", ask: "what days and times suit a free, no-obligation on-site estimate" },
      { key: "access_notes", got: has("access_notes"), label: "site notes", ask: "anything worth knowing before the visit — HOA, gated access, dogs, an insurance claim", optional: true },
      { key: "heard_about_us", got: has("heard_about_us"), label: "how they heard of us", ask: "how they heard about us", optional: true },
    ];

    const done = CHECKLIST.filter((i) => i.got);
    const outstanding = CHECKLIST.filter((i) => !i.got && !skipped.includes(i.key));
    const next = outstanding[0];

    const heldLines = done.map((i) => {
      if (i.key === "name") return `- name: ${session.visitor_name}`;
      if (i.key === "contact") return `- contact: ${[session.visitor_email, session.visitor_phone].filter(Boolean).join(" · ")}`;
      if (i.key === "sqft") return `- square footage: ${Math.round(session.estimate.sqft).toLocaleString("en-US")} sq ft`;
      const v = q0[i.key];
      return `- ${i.label}: ${typeof v === "boolean" ? (v ? "yes" : "no") : v}`;
    });
    if (session.estimate?.low) {
      heldLines.push(`- already quoted ${money(session.estimate.low)}–${money(session.estimate.high)} — do not re-quote unless something changed`);
    }

    const knownBlock = heldLines.length
      ? `ALREADY ESTABLISHED — never ask for any of these again:\n${heldLines.join("\n")}` +
        (skipped.length ? `\nAsked and not answered (leave them alone): ${skipped.join(", ")}` : "") +
        (session.lead_id ? `\nThis enquiry is already saved with an estimator.` : "")
      : `Nothing established yet — you have not been told their name or how to reach them.`;

    const nextBlock = next
      ? `ASK NEXT — exactly this, in your own words, and nothing else:\n  ${next.ask}` +
        (next.optional ? `\n  This one is optional. If they brush it off, move on and never return to it.\n` : `\n`) +
        `\nStill outstanding after that: ` +
        (outstanding.slice(1, 5).map((i) => i.label).join(", ") || "nothing — wrap up warmly") + `.\n` +
        `If their last message answered something, save it FIRST with capture_lead, then ask the above ` +
        `in the same reply.`
      : `EVERYTHING IS ANSWERED. Do not ask another question. Confirm an estimator will be in touch, ` +
        `thank them, and stop.`;

    const stages: any[] = Array.isArray(pb.question_stages) ? pb.question_stages : [];
    const points: any[] = Array.isArray(pb.talking_points) ? pb.talking_points : [];

    const stageBlock = stages.length
      ? stages.map((st: any) =>
          `STAGE ${st.stage} — ${st.title}${st.required ? " (REQUIRED)" : " (skippable)"}\n` +
          (st.note ? `  ${st.note}\n` : "") +
          (st.questions || []).map((qn: string) => `  - ${qn}`).join("\n")).join("\n\n")
      : "Find out what they need and how to reach them.";

    const pointsBlock = points.length
      ? points.map((tp: any) => `- "${tp.point}"${tp.when ? `  (${tp.when})` : ""}`).join("\n")
      : "";

    const system =
      `You are ${persona || "an estimator"} on live chat on our website, talking to someone ` +
      `thinking about a siding project.\n\n` +
      `WHO YOU ARE\n${identity}\n` +
      (pb.service_area ? `Service area: ${pb.service_area}.\n` : "") +
      (catalogue.length ? `Products we install: ${catalogue.join(", ")}.\n` : "") + `\n` +
      `TONE: ${pb.tone}\n` +
      `Never claim to be human — if asked outright whether you're a bot, say so plainly and offer a colleague.\n\n` +
      `${knowledgeBlock}\n\n` +
      `${knownBlock}\n\n` +
      `${nextBlock}\n\n` +
      `HOW TO RUN THE CONVERSATION\n` +
      `- This is a sales funnel with an end, not an open-ended chat. Ask the ONE thing under ASK NEXT, ` +
      `wait for the answer, save it, move on. You are steered by that list — do not invent your own order ` +
      `and do not wander.\n` +
      `- ONE question per reply. Never two, never a list.\n` +
      `- If their answer doesn't match what you asked, take what they DID give you, save it, and ask ` +
      `ASK NEXT again — briefly and without making a thing of it.\n` +
      `- If they decline or don't know, put that field in capture_lead's "skipped" list so it is never ` +
      `raised again.\n` +
      `- Answer anything they ask you first, then carry on.\n` +
      `- The stages below are context for why each thing is asked. The order you follow is ASK NEXT.\n\n` +
      `THE STAGES\n${stageBlock}\n\n` +
      (pointsBlock
        ? `SAY THESE — they are statements, not questions. Work them in where they fit naturally, once each.\n${pointsBlock}\n\n`
        : "") +
      `SERVICE AREA\n` +
      (pb.service_area
        ? `We cover ${pb.service_area}. Once you have the address, check it. If it is outside, tell them ` +
          `kindly, don't qualify them any further, and set in_service_area to false when you save.\n\n`
        : `No service area is configured, so do not tell anyone they are outside it.\n\n`) +
      `GETTING TO A SQUARE FOOTAGE\n` +
      `Ask whether they know the wall area to be covered. Most people don't, and you should say that is ` +
      `completely normal.\n` +
      (measureUrl
        ? `The moment they say they don't know, give them the link in that same reply: ${measureUrl} — it ` +
          `measures the property from the map in about a minute. Do not ask them to go and find the number ` +
          `some other way, and do not quietly move on without offering it. Then carry straight on with the ` +
          `next stage; never let this end the chat.\n`
        : `If they don't know, carry on without it — an estimator will measure on site.\n`) +
      `Never guess it yourself, and never treat the home's living area as the wall area — they are very ` +
      `different numbers.\n\n` +
      (estimatesOn
        ? `PRICING\nOnce you have a square footage, call estimate_project. When you give the range you ` +
          `MUST also say what it covers, using the "includes" text the tool returns — in full. A price ` +
          `on its own makes people assume permits, demolition and waste are extra, and they are not. ` +
          `Then say the firm figure follows an on-site visit. Never trail off with "just a guide" and ` +
          `nothing else.\n\n`
        : `PRICING\nDo not give any figures. An estimator prices every job.\n\n`) +
      `MONEY — READ THIS TWICE\n` +
      `- You may NEVER state, estimate, guess or "ballpark" a price yourself. The ONLY figures you may ` +
      `put in front of someone are the low and high returned by estimate_project, quoted as a range.\n` +
      `- If they push for a firmer number, say the range is as tight as it gets before someone sees it.\n` +
      `- Never discuss cost, markup or margin. You do not know them and must not speculate.\n` +
      `- Never promise a start date, a discount, or anything about the warranty beyond what is written ` +
      `above.\n\n` +
      `SAVING THE LEAD\n` +
      `- Call capture_lead as soon as you have their name and either an email or a phone number.\n` +
      `- Then call it AGAIN in the SAME turn you learn anything new. It updates the same record.\n` +
      `- If you tell someone you will note something down, you MUST call capture_lead in that same ` +
      `reply. Saying "I'll make a note of that" and not saving it is the worst thing you can do here — ` +
      `the estimator turns up knowing nothing about the gate, the dogs or the HOA.\n` +
      `- The last answers of a conversation (availability, access notes, how they heard about us) are ` +
      `the ones most often lost. Save them.\n` +
      `- Always send every field you know so far, not only the new one.\n` +
      `- Fill in only what you have actually been told. Never invent an answer.\n` +
      `- Call it even if you never got a square footage. A lead we can call beats a tidy conversation.\n\n` +
      (pb.booking_enabled !== false
        ? `HOW TO FINISH\nAlways offer the free, no-obligation on-site estimate and ask what days and ` +
          `times suit them. That is the point of the conversation.\n\n`
        : "") +
      `Keep replies under 80 words. Write plain sentences — no markdown, no asterisks, no bullet ` +
      `characters. Your reply is shown to the customer exactly as you write it.\n`;

    const tools: any[] = [
      {
        name: "capture_lead",
        description:
          "Save this person into the CRM. Call it as soon as you have their name and at least an email or " +
          "a phone number — do not wait until the end. Then call it AGAIN each time you learn something " +
          "new: it updates the same record rather than creating a second one. Send only the fields you " +
          "have just learned or corrected — earlier answers are kept, so there is no need to repeat them. " +
          "Fill in only what you have actually been told; never guess. Ask your next question in the same " +
          "reply as the tool call — don't spend a whole turn saving.",
        input_schema: {
          type: "object",
          properties: {
            // Stage 1
            name: { type: "string", description: "Their full name." },
            email: { type: "string", description: "Email address." },
            phone: { type: "string", description: "Phone number." },
            address: { type: "string", description: "Street address of the property." },
            city: { type: "string", description: "Town or city." },
            zip: { type: "string", description: "ZIP code." },
            is_owner: { type: "boolean", description: "True if they own the property." },
            owner_contact: {
              type: "string",
              description: "If they are a tenant or property manager: the owner or decision maker's name and contact.",
            },
            in_service_area: {
              type: "boolean",
              description: "False ONLY if you have established the property is outside our service area.",
            },
            // Stage 2
            motivation: { type: "string", description: "What is prompting them to look into new siding." },
            has_damage: { type: "boolean", description: "True if they reported damage — cracking, warping, rot, mold." },
            water_intrusion: { type: "boolean", description: "True if they reported signs of water getting in." },
            scope: { type: "string", enum: ["whole_home", "specific_areas"], description: "Whole home or specific areas." },
            areas: { type: "string", description: "Which sides or sections, if only specific areas." },
            home_age: { type: "string", description: "Roughly how old the home is, as they said it." },
            current_material: { type: "string", description: "Current siding material — vinyl, wood, fiber cement, aluminum, not sure." },
            wants_insulation: { type: "boolean", description: "True if they want insulation included in the quote." },
            other_items: { type: "string", description: "Other exterior work to look at — windows, doors, trim, gutters, repairs." },
            // Stage 3
            timeline: {
              type: "string", enum: ["asap", "1_3_months", "3_6_months", "researching"],
              description: "When they want to start.",
            },
            budget_max: { type: "number", description: "Top of the budget range they stated, in dollars. Omit if they didn't say." },
            wants_financing: { type: "boolean", description: "True if they asked for financing information." },
            part_of_renovation: { type: "string", description: "What else it needs coordinating with, if part of a larger renovation." },
            // Stage 4
            material_preference: { type: "string", description: "Brand or material they have in mind, or 'wants a recommendation'." },
            profile_preference: {
              type: "string", enum: ["lap", "panel", "shingle", "artisan", "unsure"],
              description: "Siding profile they picture. 'panel' covers board-and-batten. 'unsure' if they want a recommendation.",
            },
            skipped: {
              type: "array", items: { type: "string" },
              description:
                "Field names you ASKED about and they would not or could not answer (e.g. [\"budget_max\"]). " +
                "Recording it here stops you circling back to it.",
            },
            finish_preference: { type: "string", enum: ["colorplus", "primed", "undecided"], description: "Fiber cement finish preference." },
            // Stage 5
            preferred_days: { type: "string", description: "Days of the week that suit a site visit." },
            preferred_times: { type: "string", description: "Morning, afternoon or evening." },
            access_notes: { type: "string", description: "Anything for the visit — HOA rules, gated access, dogs, insurance claim involved." },
            heard_about_us: { type: "string", description: "Search, referral, social media, saw our work locally, other." },
            // Anything with no home above
            summary: { type: "string", description: "Anything else useful for the estimator, in plain sentences." },
          },
          required: ["name"],
        },
      },
    ];

    if (estimatesOn) {
      tools.unshift({
        name: "estimate_project",
        description:
          "Price the project with our real quote engine and return a guidance range. Only call this once you " +
          "have a square footage the customer actually gave you. Never invent the inputs.",
        input_schema: {
          type: "object",
          properties: {
            sqft: { type: "number", description: "Wall area to be covered, in square feet." },
            stories: { type: "number", description: "Number of storeys (1, 2 or 3)." },
            demoType: {
              type: "string", enum: ["siding", "stucco", "trim", "newbuild"],
              description: "What is being removed first. 'newbuild' if there is nothing to strip off.",
            },
            profile: {
              type: "string", enum: ["lap", "panel", "shingle", "artisan"],
              description: "Siding profile. Use 'lap' if they have no preference.",
            },
            finish: {
              type: "string", enum: ["colorplus", "primed"],
              description: "Factory colour (colorplus) or primed for painting on site.",
            },
            // battens are never an input: for board-and-batten panel jobs the
            // engine derives them itself (one every 12 inches) — do not ask
            // the customer how many battens they need.
          },
          required: ["sqft", "stories", "demoType", "profile", "finish"],
        },
      });
    }

    // ── Tools ───────────────────────────────────────────────────────────────
    // Both return ONLY customer-safe values. Cost, markup and margin never
    // cross this boundary.
    const runEstimate = async (args: any) => {
      const sqft = num(args.sqft);
      const minS = num(pb.min_sqft, 100);
      const maxS = num(pb.max_sqft, 25000);
      if (!(sqft > 0)) return { error: "No square footage given — ask the customer for it first." };
      if (sqft < minS || sqft > maxS) {
        return {
          error: `${Math.round(sqft)} sq ft is outside the range we can price in chat ` +
            `(${minS}–${maxS} sq ft). Tell them an estimator will size this one up properly.`,
        };
      }

      const [{ data: qc }, { data: prods }, { data: instMats }, { data: demoRates }] = await Promise.all([
        supabase.from("quote_config").select("*").eq("id", 1).maybeSingle(),
        supabase.from("quote_config_products").select("*").eq("active", true).order("sort"),
        supabase.from("quote_config_install_materials").select("*").eq("active", true).order("sort"),
        supabase.from("quote_config_demo_rates").select("*").eq("active", true).order("sort"),
      ]);
      const cfg = buildEngineConfig({
        config: qc || {}, products: prods || [], installMaterials: instMats || [], demoRates: demoRates || [],
      });

      const profileKey = String(args.profile || "lap");
      const finishKey = String(args.finish || "colorplus") === "primed" ? "primed" : "colorplus";
      const demoKey = String(args.demoType || "siding");
      const mainName = (PRODUCT_NAMES[profileKey] || PRODUCT_NAMES.lap)[finishKey];
      const mainProd = cfg.products.find((p) => p.name === mainName)
        || cfg.products.find((p) => p.name.toLowerCase().includes(profileKey)
          && p.name.toLowerCase().includes(finishKey === "primed" ? "primed" : "colorplus"));
      if (!mainProd) {
        return { error: "We don't have that product in the catalogue. Offer one of the products listed to you instead." };
      }

      // Battens for board-and-batten are derived inside the engine (one every
      // 12 inches of panel, finish-matched) — nothing to collect or guess here.
      const qty: Record<string, number> = { [mainProd.id]: sqft };

      const result = computeQuote(cfg, {
        totalSqft: sqft, numStories: num(args.stories, 1),
        demoType: DEMO_LABELS[demoKey] || "", markup: cfg.markupDefault, qty,
      });
      const battenRow = result.productRows.find((r: any) => r.type === "batten" && r.qty > 0);
      const battens = battenRow ? battenRow.qty : 0;

      const band = Math.min(1, Math.max(0, num(pb.estimate_band, 0.15)));
      const step = Math.max(1, num(pb.estimate_rounding, 500));
      const low = Math.floor((result.salePrice * (1 - band)) / step) * step;
      const high = Math.ceil((result.salePrice * (1 + band)) / step) * step;

      // Remembered on the session so capture_lead can draft the real quote from
      // the same inputs — and so the model can't smuggle its own number in.
      await supabase.from("chat_sessions").update({
        estimate: {
          low, high, currency: cfg.currency,
          sqft, stories: num(args.stories, 1),
          demoKey, profileKey, finishKey, battenBoards: battens || 0,
          at: new Date().toISOString(),
        },
      }).eq("id", session.id);
      session.estimate = { low, high, sqft, stories: num(args.stories, 1), demoKey, profileKey, finishKey, battenBoards: battens || 0 };

      // What the number actually buys. Built from the quote so it only ever
      // claims the demolition that was really priced, and overridden by the
      // wording in the playbook when one is set.
      const demoWord: Record<string, string> = {
        siding: "stripping and disposing of your existing siding and trim",
        stucco: "stripping and disposing of the existing stucco",
        trim: "stripping and disposing of the existing trim",
        newbuild: "",
      };
      const built = [
        "all materials",
        result.demoCost > 0 ? (demoWord[demoKey] || "removing the existing cladding") : "",
        "full installation by our own crews",
        result.permitsCost > 0 ? "building permits" : "",
        result.debrisCost > 0 ? "all waste and debris removal" : "",
      ].filter(Boolean);
      const includes = (pb.estimate_includes || "").trim()
        || `Everything: ${built.join(", ")}. We handle the lot — there is nothing else for you to arrange or pay for.`;

      return {
        low, high, currency: cfg.currency,
        range: `${money(low)} to ${money(high)}`,
        includes,
        based_on: `${Math.round(sqft).toLocaleString("en-US")} sq ft · ${num(args.stories, 1)} storey · ${mainProd.name}`,
        must_say:
          "Give the range, then state what it includes using the `includes` text above — say it in full, " +
          "in your own words, as a proper sentence. Do not shorten it to 'materials and labour' and do not " +
          "skip it: a bare number reads as if there are extras to come, when there are none. Then say the " +
          "firm figure follows an on-site visit.",
      };
    };

    const runCapture = async (args: any) => {
      const name = String(args.name || "").trim();
      const email = String(args.email || "").trim();
      const phone = String(args.phone || "").trim();
      if (!name) return { error: "Ask for their name first." };
      if (!looksLikeEmail(email) && !looksLikePhone(phone)) {
        return { error: "You need a valid email or a phone number before I can pass this to an estimator. Ask for one." };
      }
      // Only what the model was actually told. Undefined stays undefined so the
      // scorer can tell "no" apart from "never asked".
      const pick = <T,>(v: T): T | undefined => (v === undefined || v === null || v === "" ? undefined : v);
      const qualification: Qualification = {
        is_owner: pick(args.is_owner),
        owner_contact: pick(args.owner_contact),
        in_service_area: pick(args.in_service_area),
        motivation: pick(args.motivation),
        has_damage: pick(args.has_damage),
        water_intrusion: pick(args.water_intrusion),
        scope: pick(args.scope),
        areas: pick(args.areas),
        home_age: pick(args.home_age),
        current_material: pick(args.current_material),
        wants_insulation: pick(args.wants_insulation),
        other_items: pick(args.other_items),
        timeline: pick(args.timeline),
        budget_max: typeof args.budget_max === "number" && args.budget_max > 0 ? args.budget_max : undefined,
        wants_financing: pick(args.wants_financing),
        part_of_renovation: pick(args.part_of_renovation),
        material_preference: pick(args.material_preference),
        profile_preference: pick(args.profile_preference),
        finish_preference: pick(args.finish_preference),
        preferred_days: pick(args.preferred_days),
        preferred_times: pick(args.preferred_times),
        access_notes: pick(args.access_notes),
        heard_about_us: pick(args.heard_about_us),
      };

      // Merge onto what we already had: the model sends everything it knows each
      // time, but a later call must never blank a field an earlier one filled.
      const merged: Qualification = { ...(session.qualification || {}) };
      for (const [k, v] of Object.entries(qualification)) {
        if (v !== undefined) (merged as any)[k] = v;
      }
      // Questions asked and ducked accumulate, so we stop returning to them.
      if (Array.isArray(args.skipped) && args.skipped.length) {
        const prev: string[] = Array.isArray((merged as any)._skipped) ? (merged as any)._skipped : [];
        (merged as any)._skipped = [...new Set([...prev, ...args.skipped.map(String)])];
      }

      const est = session.estimate || null;
      const project = est
        ? {
            sqft: est.sqft, stories: est.stories, demoKey: est.demoKey,
            profileKey: est.profileKey, finishKey: est.finishKey, battenBoards: est.battenBoards,
            estimateLow: est.low, estimateHigh: est.high,
          }
        : null;

      // Already saved? Update it, so everything learned after the first save
      // still reaches the estimator.
      if (session.lead_id) {
        const upd = await enrichSalesLead(supabase, {
          leadId: session.lead_id,
          dealId: session.deal_id, contactId: session.contact_id,
          locationId: (session.qualification || {}).location_id || session.location_id || null,
          quoteId: session.quote_id,
          qualification: merged,
          project,
          notes: String(args.summary || "").slice(0, 4000),
          budgetFloor: num(pb.nurture_budget_floor, 5000),
          address: args.address || null, city: args.city || null, zip: args.zip || null,
        });
        await supabase.from("chat_sessions").update({
          qualification: { ...merged, address: args.address || (session.qualification || {}).address || null,
                           city: args.city || null, zip: args.zip || null,
                           location_id: (session.qualification || {}).location_id || null,
                           summary: args.summary || null },
          lead_score: upd.score,
          quote_id: upd.quote_id ?? session.quote_id,
        }).eq("id", session.id);
        session.qualification = merged;
        if (upd.quote_id) session.quote_id = upd.quote_id;
        if (upd.score === "disqualify" && merged.in_service_area === false) {
          return {
            ok: true, out_of_area: true,
            note: "Updated. The property is outside our service area — tell them kindly, thank them, and " +
              "don't qualify them any further.",
          };
        }
        return { ok: true, updated: true, note: "Updated the estimator's record. Carry on naturally — don't mention saving." };
      }

      const res = await captureSalesLead(supabase, {
        name,
        email: looksLikeEmail(email) ? email : null,
        phone: looksLikePhone(phone) ? phone : null,
        address: args.address || null,
        city: args.city || null,
        zip: args.zip || null,
        notes: String(args.summary || "").slice(0, 4000),
        qualification: merged,
        budgetFloor: num(pb.nurture_budget_floor, 5000),
        project,
      });

      await supabase.from("chat_sessions").update({
        status: "captured",
        visitor_name: name,
        visitor_email: looksLikeEmail(email) ? email : session.visitor_email,
        visitor_phone: looksLikePhone(phone) ? phone : session.visitor_phone,
        contact_id: res.contact_id, lead_id: res.lead_id, deal_id: res.deal_id, quote_id: res.quote_id,
        lead_score: res.score,
        qualification: { ...merged, address: args.address || null, city: args.city || null,
                         zip: args.zip || null, location_id: res.location_id, summary: args.summary || null },
        pending_reason: null,
      }).eq("id", session.id);
      session.lead_id = res.lead_id;
      session.deal_id = res.deal_id;
      session.contact_id = res.contact_id;
      session.quote_id = res.quote_id;
      session.qualification = { ...merged, location_id: res.location_id };
      if (looksLikeEmail(email)) session.visitor_email = email;
      if (looksLikePhone(phone)) session.visitor_phone = phone;
      session.visitor_name = name;

      // Out of area is the one outcome the visitor must be told about.
      if (res.score === "disqualify" && qualification.in_service_area === false) {
        return {
          ok: true, out_of_area: true,
          note: "Saved, but the property is outside our service area. Tell them kindly that we don't cover " +
            "that area, thank them, and don't qualify them any further.",
        };
      }

      return {
        ok: true,
        note: "Saved. Tell them an estimator will be in touch. Do not read any reference number out, and " +
          "do not mention how the lead was graded.",
      };
    };

    // ── Model loop ──────────────────────────────────────────────────────────
    const messages: any[] = (history || []).slice(-HISTORY_TURNS).map((m: any) => ({
      role: m.role === "visitor" ? "user" : "assistant",
      content: m.content,
    }));
    if (!messages.length) messages.push({ role: "user", content: text });

    const MODEL = cfgRow.chat_model || cfgRow.model || "claude-sonnet-5";

    // Ask the model. `useTools: false` forces it to answer in words, which is how
    // we guarantee the visitor always gets a reply.
    const ask = async (useTools: boolean) => {
      const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": cfgRow.api_key, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
          model: MODEL,
          // capture_lead carries the whole qualification, so a tool call is far
          // longer than a chat reply. At 700 the call was being truncated
          // mid-argument: stop_reason came back "max_tokens" with no text and no
          // usable tool call, and the visitor got the hand-over line instead of
          // their next question.
          max_tokens: 2000,
          system,
          ...(useTools ? { tools } : {}),
          messages,
        }),
      });
      if (!aiRes.ok) {
        console.error("chat: anthropic error", aiRes.status, (await aiRes.text()).slice(0, 400));
        return null;
      }
      return await aiRes.json();
    };

    let replyText = "";
    let usedEstimate = false;
    let lastStop = "";

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const ai = await ask(true);
      if (!ai) return await wantHandOver(pb.unknown_reply, "AI request failed");

      const blocks = ai.content || [];
      lastStop = ai.stop_reason || "";
      // The reply is the TEXT block — a response can open with a thinking block.
      const roundText = blocks.filter((b: any) => b.type === "text").map((b: any) => b.text).join("").trim();
      // Keep the last round that actually said something. Overwriting
      // unconditionally threw away a perfectly good question whenever the
      // following round returned tool-only output.
      if (roundText) replyText = roundText;

      const toolCalls = blocks.filter((b: any) => b.type === "tool_use");
      if (lastStop !== "tool_use" || !toolCalls.length) {
        if (lastStop === "max_tokens") console.error("chat: response hit max_tokens", { round, hasText: !!roundText });
        break;
      }

      console.log("chat: tools", toolCalls.map((c: any) => c.name).join(", "), `(round ${round + 1})`);
      messages.push({ role: "assistant", content: blocks });
      const results: any[] = [];
      for (const call of toolCalls) {
        let out: any;
        try {
          if (call.name === "estimate_project") { out = await runEstimate(call.input || {}); usedEstimate = usedEstimate || !out?.error; }
          else if (call.name === "capture_lead") out = await runCapture(call.input || {});
          else out = { error: `Unknown tool ${call.name}` };
        } catch (e) {
          console.error(`chat: tool ${call.name} failed`, e);
          out = { error: "That didn't work. Carry on without it and offer to have someone follow up." };
        }
        results.push({ type: "tool_result", tool_use_id: call.id, content: JSON.stringify(out) });
      }
      messages.push({ role: "user", content: results });
    }

    // A conversation must never die because the model spent its turn calling
    // tools. If we came out of the loop with tool results and no words — because
    // the rounds ran out, or the last response was tool-only — ask once more with
    // tools switched off so it has no choice but to reply.
    if (!replyText) {
      console.error("chat: no text after tool rounds, forcing a reply", { lastStop });
      const ai = await ask(false);
      const forced = ((ai?.content) || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("").trim();
      if (forced) replyText = forced;
    }

    if (!replyText) {
      return await wantHandOver(pb.unknown_reply, `assistant produced no reply (stop_reason: ${lastStop || "none"})`);
    }

    // The measuring tool is the entire recovery path for someone who doesn't know
    // their square footage, and the model kept referring to "the instant quote
    // tool" without ever pasting the address. Talking about it without linking it
    // is worse than not mentioning it, so the link is appended if it is missing.
    // …but not once they have just told us the number. The visitor saying
    // "about 1500 sq ft of wall" was tripping the same keyword check and getting
    // the link pushed at them anyway, which reads as if it wasn't listening.
    const gaveSqft = /\b\d{2,5}\s*(?:sq\.?\s*(?:ft|feet)|square\s*(?:ft|feet|foot))/i.test(text);
    if (measureUrl && !session.estimate?.sqft && !gaveSqft && !replyText.includes(measureUrl)) {
      const talksAboutMeasuring = /\b(square foot|square feet|sq\.? ?ft|measur\w*|instant quote tool|footage)\b/i.test(replyText);
      if (talksAboutMeasuring) {
        replyText = `${replyText.replace(/\s+$/, "")}\n\nYou can measure it from the map here, it takes about a minute: ${measureUrl}`;
      }
    }

    // Rule 1, enforced: a figure the engine never produced does not go out.
    if (mentionsPrice(replyText) && !session.estimate) {
      console.error("chat: blocked an unbacked price:", replyText.slice(0, 200));
      replyText = measureUrl
        ? `I don't want to guess at a number — it'd only mislead you. If you can measure the wall area here ` +
          `(${measureUrl}) I can give you a proper range, or an estimator can measure it on site.`
        : `I'd rather not guess at a number. Let me get an estimator to size it up properly for you.`;
    }

    return await say(replyText, {
      escalated: false,
      captured: !!session.lead_id,
      estimated: usedEstimate || !!session.estimate,
    });
  } catch (e) {
    console.error("chat error:", (e as Error).message);
    return json({ error: "Something went wrong." }, 500);
  }
});
