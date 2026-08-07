// kb-learn — teach the sales assistant what it is allowed to state as fact.
//
// Two ways in:
//   POST { url }   — fetch a page (your own site, a manufacturer's spec page)
//   POST { text }  — paste anything: a brochure, a warranty page, your own notes
//
// Claude distils it into discrete question/answer entries in kb_docs. Nothing is
// invented: the model is told to use only what is on the page, and to drop
// anything it cannot support. Prices are deliberately excluded — the assistant
// only ever gets a figure from the quote engine, never from prose.
//
// Staff only (editor/owner).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

/** Crude but dependency-free HTML -> text. Drops nav/script/style so the model
 *  sees the content, not the chrome around it. */
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<header[\s\S]*?<\/header>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&#\d+;/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const auth = req.headers.get("Authorization")?.replace("Bearer ", "");
  if (!auth) return json({ error: "Unauthorized" }, 401);
  const { data: { user } } = await supabase.auth.getUser(auth);
  if (!user) return json({ error: "Unauthorized" }, 401);
  const { data: me } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (!["owner", "editor"].includes(me?.role || "")) return json({ error: "Editors and owners only" }, 403);

  try {
    const { url, text: pasted, dry_run = false } = (await req.json()) || {};
    if (!url && !pasted) return json({ error: "Give me a link or paste the text." }, 422);

    const { data: cfg } = await supabase.from("ai_settings").select("*").eq("id", 1).maybeSingle();
    if (!cfg?.api_key) return json({ error: "Add your Anthropic API key in Settings → AI Assistant first." }, 400);

    let source_text = String(pasted || "");
    let title_hint = "";

    if (url) {
      let u: URL;
      try { u = new URL(url); } catch { return json({ error: "That doesn't look like a URL." }, 422); }
      if (!["http:", "https:"].includes(u.protocol)) return json({ error: "Only http(s) URLs." }, 422);

      const r = await fetch(u.toString(), {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; SalesKB/1.0)", "Accept": "text/html,text/plain" },
        redirect: "follow",
      });
      if (!r.ok) return json({ error: `Couldn't read that page (HTTP ${r.status}).` }, 400);
      const ct = r.headers.get("content-type") || "";
      const body = await r.text();
      source_text = ct.includes("html") ? htmlToText(body) : body;
      title_hint = (body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").trim();
    }

    source_text = source_text.slice(0, 40000);
    if (source_text.length < 200) return json({ error: "There wasn't enough readable content there." }, 422);

    const system =
      `You convert a contractor's material into answers a sales assistant can give a homeowner on live chat.\n\n` +
      `Return strict JSON: {"entries":[{"title":"...","question":"...","answer":"...","category":"..."}]}\n\n` +
      `- One entry per distinct thing a customer would ask. Up to 12. Fewer is fine.\n` +
      `- question: how a homeowner would actually ask it, in plain words.\n` +
      `- answer: the answer, written to the customer, 60 words or fewer. No marketing language.\n` +
      `- category: one of Products, Process, Warranty, Timescales, Service area, Finance, Company, Other.\n` +
      `- Use ONLY what the text says. Never add anything from your own knowledge. If the text is ` +
      `marketing fluff with no facts in it, return {"entries":[]}.\n` +
      `- NEVER record a price, a rate, a discount or a "starting from" figure. Pricing comes from our ` +
      `quote engine, and a stale number in here would be quoted at a customer. Skip any such sentence.\n` +
      `- Do not record anything time-limited (a current promotion, a seasonal offer).\n` +
      `Return JSON only.`;

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": cfg.api_key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: cfg.chat_model || cfg.model || "claude-sonnet-5",
        max_tokens: 4000,
        system,
        messages: [{ role: "user", content: `${title_hint ? `Page: ${title_hint}\n` : ""}\n${source_text}` }],
      }),
    });
    if (!r.ok) return json({ error: `The AI request failed (${r.status}).` }, 502);

    const ai = await r.json();
    const raw = (ai.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("").trim();
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return json({ error: "Couldn't make sense of that." }, 422);

    const parsed = JSON.parse(m[0]);
    const entries = Array.isArray(parsed.entries) ? parsed.entries : [];
    if (!entries.length) return json({ ok: true, learned: 0, note: "Nothing worth keeping there." });

    if (dry_run) return json({ ok: true, learned: 0, preview: entries.slice(0, 5) });

    // Belt and braces: the model was told not to record prices, so drop anything
    // that slipped through rather than trusting it.
    const priced = (s: string) => /\$\s?\d|\bper sq(uare)? ?f(oo)?t\b|\bstarting (at|from)\b/i.test(s || "");

    const rows = entries
      .filter((e: any) => e.question && e.answer)
      .filter((e: any) => !priced(e.answer) && !priced(e.question))
      .map((e: any) => ({
        source: url ? "doc" : "manual",
        source_ref: url || null,
        title: (e.title || "").slice(0, 160),
        question: e.question,
        answer: e.answer,
        category: e.category || null,
        created_by: user.id,
      }));

    const dropped = entries.length - rows.length;
    if (!rows.length) return json({ ok: true, learned: 0, note: "Everything there was pricing — nothing kept." });

    const { error } = await supabase.from("kb_docs").insert(rows);
    if (error) return json({ error: error.message }, 500);

    return json({
      ok: true, learned: rows.length, dropped,
      samples: rows.slice(0, 4).map((x: any) => x.title),
    });
  } catch (e) {
    console.error("kb-learn error:", (e as Error).message);
    return json({ error: (e as Error).message }, 500);
  }
});
