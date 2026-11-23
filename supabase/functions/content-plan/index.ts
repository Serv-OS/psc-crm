// content-plan: keeps the content calendar full (Peter, 23 Nov 2026: "fully
// automatic, 1 to 2 blogs and 3 socials a week").
//
// Called by pg_cron once an hour (no JWT). Each run finds the FIRST empty
// slot in the next few weeks and writes ONE post for it with Claude, so a
// run never outlasts the function's time limit and a bad answer costs one
// post, not a batch. A staff member can also call it (POST {fill:true}) from
// the Content page to fill a slot now.
//
// Blog slots alternate between a finished project from the photo library and
// a guide topic from settings. Social slots show a project, and every third
// one points at the newest blog post. Never a customer's surname or house
// number: Claude is never told the project's key, only the town and product.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const TZ = "America/Los_Angeles";
const SITE = "https://www.peninsulasidingcompany.com";
const MODEL = "claude-opus-5-5";
// Weekday preference: blogs Tue, Thu first; socials Mon, Wed, Fri first.
const BLOG_DAYS = [2, 4, 1, 3, 5, 6, 0];
const SOCIAL_DAYS = [1, 3, 5, 6, 2, 4, 0];

// The UTC instant of `hour`:00 Los Angeles time on the LA calendar day `ymd`.
function laAt(ymd: string, hour: number): Date {
  const guess = new Date(`${ymd}T${String(hour).padStart(2, "0")}:00:00Z`);
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(guess);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const shown = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"));
  return new Date(guess.getTime() - (shown - guess.getTime()));
}
const laYmd = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);
const laWeekday = (ymd: string) => new Date(`${ymd}T12:00:00Z`).getUTCDay();
const addDays = (ymd: string, n: number) => { const d = new Date(`${ymd}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 80);

async function claude(apiKey: string, system: string, content: any[], search: boolean) {
  const messages: any[] = [{ role: "user", content }];
  for (let turn = 0; turn < 4; turn++) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01", "anthropic-beta": "server-side-fallback-2026-07-01" },
      body: JSON.stringify({
        model: MODEL, max_tokens: 12000, system, output_config: { effort: "medium" }, fallbacks: "default",
        ...(search ? { tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 5, user_location: { type: "approximate", country: "US", region: "California" } }] } : {}),
        messages,
      }),
    });
    const ai = await res.json();
    if (!res.ok) throw new Error(ai?.error?.message || `Claude failed (${res.status})`);
    if (ai.stop_reason === "pause_turn") { messages.push({ role: "assistant", content: ai.content }); continue; }
    const text = (ai.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n");
    const m = text.match(/```json\s*([\s\S]*?)```/) || text.match(/(\{[\s\S]*\})\s*$/);
    if (!m) throw new Error("Claude did not return JSON");
    return JSON.parse(m[1]);
  }
  throw new Error("Claude took too many turns");
}

const RULES = `Voice: plain, warm, confident, short sentences, American English. No hype, no exclamation marks, no emojis in blog posts. Never invent prices, numbers, reviews, awards or facts about a customer. Never name a customer, a street or a house number. When you mention a town, only use the one you are given. Only make claims the business facts support.`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  try {
    const { data: s } = await supabase.from("content_settings").select("*").eq("id", 1).maybeSingle();
    if (!s?.enabled) return json({ ok: true, skipped: "off" });
    // This address has no login (the timer calls it), so it writes at most
    // one post every 20 minutes whoever calls; a signed in owner or editor
    // (the Fill now button) skips the wait.
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    let staff = false;
    if (jwt) {
      const { data: u } = await supabase.auth.getUser(jwt);
      if (u?.user) {
        const { data: prof } = await supabase.from("profiles").select("role").eq("id", u.user.id).maybeSingle();
        staff = ["owner", "editor"].includes(prof?.role);
      }
    }
    if (!staff) {
      const { data: recent } = await supabase.from("content_posts").select("id").eq("created_by_ai", true)
        .gte("created_at", new Date(Date.now() - 20 * 60000).toISOString()).limit(1);
      if (recent?.length) return json({ ok: true, skipped: "wrote one recently" });
    }
    const { data: ai } = await supabase.from("ai_settings").select("api_key").eq("id", 1).maybeSingle();
    if (!ai?.api_key) return json({ error: "No Anthropic key in Settings, AI Assistant" }, 400);

    // ── find the first empty slot ──
    const today = laYmd(new Date());
    const end = addDays(today, s.weeks_ahead * 7);
    const blogDays = new Set(BLOG_DAYS.slice(0, s.blogs_per_week));
    const socialDays = new Set(SOCIAL_DAYS.slice(0, s.socials_per_week));
    const { data: existing } = await supabase.from("content_posts").select("kind, publish_at, status")
      .gte("publish_at", laAt(today, 0).toISOString()).lte("publish_at", laAt(end, 23).toISOString());
    const taken = new Set((existing || []).map((p: any) => `${p.kind}:${laYmd(new Date(p.publish_at))}`));
    let slot: { kind: "blog" | "social"; ymd: string } | null = null;
    for (let d = addDays(today, 1); d <= end && !slot; d = addDays(d, 1)) {
      const wd = laWeekday(d);
      if (blogDays.has(wd) && !taken.has(`blog:${d}`)) slot = { kind: "blog", ymd: d };
      else if (socialDays.has(wd) && !taken.has(`social:${d}`)) slot = { kind: "social", ymd: d };
    }
    if (!slot) return json({ ok: true, full: true });
    const publishAt = laAt(slot.ymd, s.post_hour).toISOString();

    // ── pick a project: least used, town known first, befores help ──
    const pickProject = async (exclude: string[] = []) => {
      const { data: projects } = await supabase.from("content_projects").select("key, town, product, colour").eq("active", true);
      const { data: used } = await supabase.from("content_posts").select("project_key, kind, publish_at").not("project_key", "is", null);
      const lastUse: Record<string, number> = {};
      for (const u of used || []) lastUse[u.project_key] = Math.max(lastUse[u.project_key] || 0, new Date(u.publish_at).getTime());
      const ranked = (projects || []).filter((p: any) => !exclude.includes(p.key))
        .sort((a: any, b: any) => (lastUse[a.key] || 0) - (lastUse[b.key] || 0) || (b.town ? 1 : 0) - (a.town ? 1 : 0));
      return ranked[0] || null;
    };
    const photosOf = async (key: string) => {
      const { data } = await supabase.from("content_photos").select("id, path, label, used_count").eq("project_key", key).order("path");
      return data || [];
    };
    const pub = (path: string) => `${Deno.env.get("SUPABASE_URL")}/storage/v1/object/public/content/${path}`;
    const facts = `Business facts:\n${s.brand_notes || ""}`;

    if (slot.kind === "blog") {
      const { data: lastBlog } = await supabase.from("content_posts").select("project_key").eq("kind", "blog").order("publish_at", { ascending: false }).limit(1).maybeSingle();
      const topics: any[] = Array.isArray(s.guide_topics) ? s.guide_topics : [];
      const nextTopic = topics.find((t) => !t.done);
      const doGuide = !!nextTopic && (lastBlog?.project_key != null || !(await pickProject()));

      if (doGuide) {
        const project = await pickProject();
        const photos = project ? (await photosOf(project.key)).filter((p: any) => p.label === "after").slice(0, 2) : [];
        const out = await claude(ai.api_key, `You write blog articles for a siding contractor's website. ${RULES}`, [
          ...photos.map((p: any) => ({ type: "image", source: { type: "url", url: pub(p.path) } })),
          { type: "text", text: `${facts}\n\nWrite a helpful, accurate blog article (900 to 1300 words) on: "${nextTopic.topic}". Audience: Bay Area homeowners. Search the web to check any facts, rules or typical figures, and say ranges are typical and vary. Link ideas naturally to getting an instant quote at ${SITE}/instant-quote and to financing at ${SITE}/financing where it fits. ${photos.length ? `The photos are our own finished work${project?.town ? ` in ${project.town}` : ""}; you may place them with img blocks (photo 0 and 1).` : ""}

Reply with ONE fenced \`\`\`json block:
{ "title": "", "seo_title": "under 60 characters", "seo_description": "under 155 characters", "excerpt": "1 or 2 sentences",
  "body": [ {"type":"p","text":""}, {"type":"h2","text":""}, {"type":"ul","items":[""]}, {"type":"quote","text":""}, {"type":"img","photo":0,"alt":"","caption":""} ] }
Body text is plain text (no markdown). Start with a short intro paragraph, use 4 to 6 h2 sections, end with a short call to action paragraph.` },
        ], true);
        const slug = slugify(out.title);
        await supabase.from("content_posts").insert({
          kind: "blog", channels: ["website"], title: out.title, slug, excerpt: out.excerpt, seo_title: out.seo_title, seo_description: out.seo_description,
          body: out.body, image_paths: photos.map((p: any) => p.path), project_key: photos.length ? project.key : null, topic: nextTopic.topic, publish_at: publishAt,
        });
        nextTopic.done = true;
        await supabase.from("content_settings").update({ guide_topics: topics, updated_at: new Date().toISOString() }).eq("id", 1);
        return json({ ok: true, made: "blog guide", title: out.title, publish_at: publishAt });
      }

      const project = await pickProject();
      if (!project) return json({ ok: true, skipped: "no projects in the photo library" });
      const all = await photosOf(project.key);
      const photos = [...all.filter((p: any) => p.label === "after").slice(0, 4), ...all.filter((p: any) => p.label === "before").slice(0, 1), ...all.filter((p: any) => p.label === "progress").slice(0, 1)];
      const out = await claude(ai.api_key, `You write project stories for a siding contractor's website. ${RULES}`, [
        ...photos.flatMap((p: any, i: number) => [{ type: "text", text: `Photo ${i} (${p.label})` }, { type: "image", source: { type: "url", url: pub(p.path) } }]),
        { type: "text", text: `${facts}\n\nProject: ${project.product || "James Hardie siding"}${project.colour ? `, colour ${project.colour}` : ""}. ${project.town ? `Town: ${project.town}, CA.` : "Town: not known, say 'on the Peninsula'."}\n\nWrite a project story blog post (600 to 900 words) from these photos of OUR finished work: what the house looked like before (if a before photo is given), what we installed, the colour and trim, details worth noticing in the photos, and why it suits a Bay Area home. Describe only what the photos show; do not invent problems we found or how long it took. Title format like "${project.colour ? project.colour + " " : ""}James Hardie siding${project.town ? " in " + project.town : ""}: a before and after". End with a short call to action to get an instant quote at ${SITE}/instant-quote.

Reply with ONE fenced \`\`\`json block:
{ "title": "", "seo_title": "under 60 characters", "seo_description": "under 155 characters", "excerpt": "1 or 2 sentences",
  "body": [ {"type":"p","text":""}, {"type":"h2","text":""}, {"type":"img","photo":0,"alt":"describe the photo and town","caption":""}, {"type":"ul","items":[""]} ] }
Use every photo once with an img block (photo numbers as given). Body text is plain text (no markdown).` },
      ], false);
      let slug = slugify(out.title);
      const { data: clash } = await supabase.from("content_posts").select("id").eq("slug", slug).maybeSingle();
      if (clash) slug = `${slug}-${slot.ymd}`;
      await supabase.from("content_posts").insert({
        kind: "blog", channels: ["website"], title: out.title, slug, excerpt: out.excerpt, seo_title: out.seo_title, seo_description: out.seo_description,
        body: out.body, image_paths: photos.map((p: any) => p.path), project_key: project.key, topic: "project", publish_at: publishAt,
      });
      for (const p of photos) await supabase.from("content_photos").update({ used_count: (p.used_count || 0) + 1, last_used_at: new Date().toISOString() }).eq("id", p.id);
      return json({ ok: true, made: "blog project", title: out.title, publish_at: publishAt });
    }

    // ── social ──
    const { count: socialCount } = await supabase.from("content_posts").select("id", { count: "exact", head: true }).eq("kind", "social");
    const { data: latestBlog } = await supabase.from("content_posts").select("title, slug, excerpt, image_paths, publish_at")
      .eq("kind", "blog").lte("publish_at", publishAt).order("publish_at", { ascending: false }).limit(1).maybeSingle();
    const promoteBlog = !!latestBlog && ((socialCount || 0) % 3 === 2);
    let images: string[] = [];
    let projectKey: string | null = null;
    let brief = "";
    let link: string | null = null;
    if (promoteBlog) {
      images = (latestBlog.image_paths || []).slice(0, 1);
      link = `${SITE}/resources/${latestBlog.slug}`;
      brief = `Promote our new blog post "${latestBlog.title}": ${latestBlog.excerpt || ""}`;
    } else {
      const project = await pickProject();
      if (!project) return json({ ok: true, skipped: "no projects" });
      projectKey = project.key;
      const all = await photosOf(project.key);
      const before = all.find((p: any) => p.label === "before");
      const afters = all.filter((p: any) => p.label === "after").sort((a: any, b: any) => (a.used_count || 0) - (b.used_count || 0));
      images = [...afters.slice(0, before ? 2 : 3), ...(before ? [before] : [])].map((p: any) => p.path);
      brief = `Show off this finished project: ${project.product || "James Hardie siding"}${project.colour ? ` in ${project.colour}` : ""}${project.town ? ` in ${project.town}, CA` : " on the Peninsula"}.${before ? " The last photo is the BEFORE." : ""}`;
      for (const p of all.filter((p: any) => images.includes(p.path))) await supabase.from("content_photos").update({ used_count: (p.used_count || 0) + 1, last_used_at: new Date().toISOString() }).eq("id", p.id);
    }
    const out = await claude(ai.api_key, `You write social media posts for a siding contractor (Facebook and Instagram). ${RULES} A light touch of one or two emojis is fine on social.`, [
      ...images.map((p) => ({ type: "image", source: { type: "url", url: pub(p) } })),
      { type: "text", text: `${facts}\n\n${brief}\n\nWrite one caption that works on both Facebook and Instagram: 40 to 90 words, a hook in the first line, describe only what the photos show, end with a call to action (instant quote at peninsulasidingcompany.com/instant-quote${link ? ", or read the post" : ""}), then 5 to 8 relevant hashtags (local + siding). Reply with ONE fenced \`\`\`json block: { "caption": "" }` },
    ], false);
    await supabase.from("content_posts").insert({
      kind: "social", channels: ["facebook", "instagram"], caption: out.caption, link_url: link, image_paths: images,
      project_key: projectKey, topic: promoteBlog ? "blog promo" : "project", publish_at: publishAt,
    });
    return json({ ok: true, made: "social", publish_at: publishAt });
  } catch (e) {
    console.error("content-plan failed", e);
    return json({ error: (e as Error).message }, 500);
  }
});
