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
import { buildEngineConfig, computeQuote, PRODUCT_NAMES, BATTEN_NAMES, DEMO_LABELS, num } from "../_shared/quoteEngine.ts";
import { captureSalesLead } from "../_shared/salesCapture.ts";
import { mentionsPrice } from "../_shared/priceGuard.ts";

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

    const origin = req.headers.get("origin");
    if (!originAllowed(origin, site.allowed_origins || [])) {
      return json({ error: "This domain isn't allowed to use this chat." }, 403);
    }

    const { data: pbRow } = await supabase.from("chat_playbook").select("*").eq("id", 1).maybeSingle();
    const pb = (pbRow || {}) as any;
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

    const say = async (reply: string, extra: Record<string, unknown> = {}) => {
      await supabase.from("chat_messages").insert({ session_id: session.id, role: "bot", content: reply });
      await supabase.from("chat_sessions").update({ last_at: new Date().toISOString() }).eq("id", session.id);
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
      await supabase.from("chat_messages").insert({ session_id: session.id, role: "bot", content: reply, escalated: true });
      return json({ session_id: session.id, reply, escalated: true });
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

    const system =
      `You are ${persona || "an estimator"} on live chat on our website. You are talking to someone ` +
      `thinking about a siding project.\n\n` +
      `WHO YOU ARE\n${identity}\n` +
      (pb.service_area ? `Service area: ${pb.service_area}. If they are outside it, say so kindly and stop.\n` : "") +
      (catalogue.length ? `Products we install: ${catalogue.join(", ")}.\n` : "") + `\n` +
      `TONE: ${pb.tone}. Short sentences, one question at a time, no bullet-point essays. ` +
      `Never claim to be human — if asked outright whether you're a bot, say so plainly and offer a colleague.\n\n` +
      `${knowledgeBlock}\n\n` +
      `YOUR JOB, IN ORDER\n` +
      `1. Understand the project. Work through these, conversationally, one at a time — never as a form:\n` +
      (pb.qualifying_questions || []).map((q: string) => `   - ${q}`).join("\n") + `\n` +
      `2. Get to a square footage. Ask if they know the wall area they need covered. Most people don't — ` +
      `that is completely normal and you should say so.\n` +
      (measureUrl
        ? `   If they don't know, point them at our measuring tool: ${measureUrl} — it measures the property ` +
          `from the map in about a minute. Keep chatting to them either way; do NOT let this end the conversation.\n`
        : `   If they don't know, carry on without it and let an estimator measure on site.\n`) +
      `   Do not guess a square footage yourself, and do not accept their house's living area as the wall ` +
      `area — those are very different numbers.\n` +
      (estimatesOn
        ? `3. Once you have a square footage, call the estimate_project tool. Give them the range it returns, ` +
          `in a sentence, and say plainly it's a guide based on what they've told you and that the real ` +
          `number comes after a site visit.\n`
        : `3. Do not give any figures. An estimator prices every job.\n`) +
      `4. Then ask for their name, email and phone so we can send a written estimate and book the visit. ` +
      `Once you have a name AND an email or phone, call capture_lead. Call it even if you never got a ` +
      `square footage — a lead we can call is worth far more than a tidy conversation.\n\n` +
      `MONEY — READ THIS TWICE\n` +
      `- You may NEVER state, estimate, guess or "ballpark" a price yourself. The ONLY figures you may put ` +
      `in front of someone are the low and high returned by estimate_project, quoted as a range.\n` +
      `- If they push for a firmer number, say the range is as tight as it gets before someone sees the property.\n` +
      `- Never discuss cost, markup, margin, or what anything costs us. You do not know and must not speculate.\n` +
      `- Never promise a start date, a discount, financing terms, or anything about warranty beyond what is ` +
      `in WHAT WE KNOW above.\n\n` +
      `RULES\n` +
      `- One question at a time. Wait for the answer.\n` +
      `- Never ask for the same thing twice.\n` +
      `- If they are just browsing, be useful and leave the door open. Don't chase.\n` +
      `- Keep replies under 80 words.\n`;

    const tools: any[] = [
      {
        name: "capture_lead",
        description:
          "Save this person and their project into the CRM so an estimator can follow up. Call this as soon " +
          "as you have their name and at least an email or a phone number. Safe to call without a square footage.",
        input_schema: {
          type: "object",
          properties: {
            name: { type: "string", description: "Their full name as they gave it." },
            email: { type: "string", description: "Email address, if given." },
            phone: { type: "string", description: "Phone number, if given." },
            address: { type: "string", description: "Property address, if given." },
            city: { type: "string", description: "Town or city." },
            zip: { type: "string", description: "ZIP code." },
            summary: {
              type: "string",
              description:
                "A few lines for the estimator: what they want done, property type, timeline, whether they " +
                "own it, and anything else useful. Plain sentences.",
            },
          },
          required: ["name", "summary"],
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
            battenBoards: { type: "number", description: "Only for board-and-batten panel jobs: number of batten boards." },
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

      const qty: Record<string, number> = { [mainProd.id]: sqft };
      const battens = num(args.battenBoards);
      if (profileKey === "panel" && battens > 0) {
        const b = cfg.products.find((p) => p.name === BATTEN_NAMES[finishKey]);
        if (b) qty[b.id] = battens;
      }

      const result = computeQuote(cfg, {
        totalSqft: sqft, numStories: num(args.stories, 1),
        demoType: DEMO_LABELS[demoKey] || "", markup: cfg.markupDefault, qty,
      });

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

      return {
        low, high, currency: cfg.currency,
        range: `${money(low)} to ${money(high)}`,
        covers: "Materials, labour, underlayment, permits, demolition and debris removal.",
        based_on: `${Math.round(sqft).toLocaleString("en-US")} sq ft · ${num(args.stories, 1)} storey · ${mainProd.name}`,
        must_say:
          "Tell them this is a guide based on what they've described, and the firm number comes after " +
          "an estimator has seen the property.",
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
      if (session.lead_id) {
        return { ok: true, already: true, note: "This enquiry is already with an estimator — don't save it twice." };
      }

      const est = session.estimate || null;
      const res = await captureSalesLead(supabase, {
        name,
        email: looksLikeEmail(email) ? email : null,
        phone: looksLikePhone(phone) ? phone : null,
        address: args.address || null,
        city: args.city || null,
        zip: args.zip || null,
        notes: String(args.summary || "").slice(0, 4000),
        project: est
          ? {
              sqft: est.sqft, stories: est.stories, demoKey: est.demoKey,
              profileKey: est.profileKey, finishKey: est.finishKey, battenBoards: est.battenBoards,
              estimateLow: est.low, estimateHigh: est.high,
            }
          : null,
      });

      await supabase.from("chat_sessions").update({
        status: "captured",
        visitor_name: name,
        visitor_email: looksLikeEmail(email) ? email : session.visitor_email,
        visitor_phone: looksLikePhone(phone) ? phone : session.visitor_phone,
        contact_id: res.contact_id, lead_id: res.lead_id, deal_id: res.deal_id, quote_id: res.quote_id,
        qualification: {
          summary: String(args.summary || ""),
          address: args.address || null, city: args.city || null, zip: args.zip || null,
        },
        pending_reason: null,
      }).eq("id", session.id);
      session.lead_id = res.lead_id;
      if (looksLikeEmail(email)) session.visitor_email = email;
      if (looksLikePhone(phone)) session.visitor_phone = phone;
      session.visitor_name = name;

      return {
        ok: true,
        note: "Saved. Tell them an estimator will be in touch, and roughly when. Do not read any reference number out.",
      };
    };

    // ── Model loop ──────────────────────────────────────────────────────────
    const messages: any[] = (history || []).slice(-HISTORY_TURNS).map((m: any) => ({
      role: m.role === "visitor" ? "user" : "assistant",
      content: m.content,
    }));
    if (!messages.length) messages.push({ role: "user", content: text });

    let replyText = "";
    let usedEstimate = false;

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": cfgRow.api_key, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
          model: cfgRow.chat_model || cfgRow.model || "claude-sonnet-5",
          max_tokens: 700,
          system,
          tools,
          messages,
        }),
      });
      if (!aiRes.ok) {
        console.error("chat: anthropic error", aiRes.status, await aiRes.text());
        return await wantHandOver(pb.unknown_reply, "AI request failed");
      }
      const ai = await aiRes.json();
      const blocks = ai.content || [];
      // The reply is the TEXT block — a response can open with a thinking block.
      replyText = blocks.filter((b: any) => b.type === "text").map((b: any) => b.text).join("").trim();

      const toolCalls = blocks.filter((b: any) => b.type === "tool_use");
      if (ai.stop_reason !== "tool_use" || !toolCalls.length) break;

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

    if (!replyText) {
      return await wantHandOver(pb.unknown_reply, "assistant produced no reply");
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
