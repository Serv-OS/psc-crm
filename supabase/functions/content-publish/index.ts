// content-publish: every 15 minutes (pg_cron, no JWT), puts whatever is due
// live (Peter, 23 Nov 2026: hands off).
//
// Blog posts: the website already shows a scheduled post once its time has
// passed (it reads content_posts directly), so here we only stamp it
// published. Social posts: published to Facebook and Instagram through the
// Meta Graph API once the page token and Instagram account are saved
// (content_meta, coming with the Meta access). Until then a due social post
// is marked "waiting" and stays in the calendar, so nothing is lost.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
const GRAPH = "https://graph.facebook.com/v21.0";

async function graph(path: string, params: Record<string, string>) {
  const r = await fetch(`${GRAPH}${path}`, { method: "POST", body: new URLSearchParams(params) });
  const j = await r.json();
  if (!r.ok || j.error) throw new Error(j.error?.message || `Meta ${r.status}`);
  return j;
}

serve(async () => {
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const now = new Date().toISOString();
  const pub = (path: string) => `${Deno.env.get("SUPABASE_URL")}/storage/v1/object/public/content/${path}`;
  const out = { blogs: 0, social: 0, waiting: 0, failed: 0 };

  const { data: s } = await supabase.from("content_settings").select("enabled").eq("id", 1).maybeSingle();
  if (!s?.enabled) return json({ ok: true, skipped: "off" });

  // Blogs: stamp them.
  const { data: blogs } = await supabase.from("content_posts").update({ status: "published", published_at: now })
    .eq("kind", "blog").eq("status", "scheduled").lte("publish_at", now).select("id");
  out.blogs = blogs?.length || 0;

  // Social.
  const { data: due } = await supabase.from("content_posts").select("*")
    .eq("kind", "social").in("status", ["scheduled", "waiting"]).lte("publish_at", now).order("publish_at").limit(5);
  if (!due?.length) return json({ ok: true, ...out });

  // Meta details, when they exist (table added with the Meta setup).
  let meta: any = null;
  try {
    const { data } = await supabase.from("content_meta").select("*").eq("id", 1).maybeSingle();
    meta = data;
  } catch { /* not set up yet */ }

  for (const p of due) {
    if (!meta?.page_token) {
      if (p.status !== "waiting") await supabase.from("content_posts").update({ status: "waiting", error: "Waiting for Facebook and Instagram access" }).eq("id", p.id);
      out.waiting++;
      continue;
    }
    const ids: Record<string, string> = { ...(p.external_ids || {}) };
    try {
      const caption = [p.caption, p.link_url].filter(Boolean).join("\n\n");
      const imgs = (p.image_paths || []).map(pub);
      // Facebook page: one photo with the caption, or several attached to one post.
      if (p.channels.includes("facebook") && !ids.facebook) {
        if (imgs.length <= 1) {
          const r = await graph(`/${meta.page_id}/photos`, { url: imgs[0], caption, access_token: meta.page_token });
          ids.facebook = r.post_id || r.id;
        } else {
          const media = [];
          for (const u of imgs) media.push((await graph(`/${meta.page_id}/photos`, { url: u, published: "false", access_token: meta.page_token })).id);
          const r = await graph(`/${meta.page_id}/feed`, { message: caption, access_token: meta.page_token, ...Object.fromEntries(media.map((id, i) => [`attached_media[${i}]`, JSON.stringify({ media_fbid: id })])) });
          ids.facebook = r.id;
        }
      }
      // Instagram business account: single image or carousel.
      if (p.channels.includes("instagram") && meta.ig_user_id && !ids.instagram) {
        const igCaption = p.caption; // links are not clickable on Instagram
        let creation: string;
        if (imgs.length <= 1) {
          creation = (await graph(`/${meta.ig_user_id}/media`, { image_url: imgs[0], caption: igCaption, access_token: meta.page_token })).id;
        } else {
          const children = [];
          for (const u of imgs.slice(0, 10)) children.push((await graph(`/${meta.ig_user_id}/media`, { image_url: u, is_carousel_item: "true", access_token: meta.page_token })).id);
          creation = (await graph(`/${meta.ig_user_id}/media`, { media_type: "CAROUSEL", children: children.join(","), caption: igCaption, access_token: meta.page_token })).id;
        }
        ids.instagram = (await graph(`/${meta.ig_user_id}/media_publish`, { creation_id: creation, access_token: meta.page_token })).id;
      }
      await supabase.from("content_posts").update({ status: "published", published_at: new Date().toISOString(), external_ids: ids, error: null }).eq("id", p.id);
      out.social++;
    } catch (e) {
      // Keep what did go out, so a retry never posts twice.
      await supabase.from("content_posts").update({ status: "failed", external_ids: ids, error: (e as Error).message }).eq("id", p.id);
      out.failed++;
    }
  }
  return json({ ok: true, ...out });
});
