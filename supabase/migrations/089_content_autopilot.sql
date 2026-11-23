-- 089_content_autopilot.sql (safe to run twice)
--
-- Peter, 23 Nov 2026: blog and social posts on autopilot. "Fully automatic,
-- 1 to 2 blogs and 3 socials a week." Claude writes a few weeks ahead from
-- the project photo library and a list of guide topics; a timer publishes
-- whatever is due. Blog posts show on the website by date (the website reads
-- them from here); Facebook and Instagram go out once Meta access is added.

-- 1. Projects in the photo library (one row per finished job).
create table if not exists public.content_projects (
  key text primary key,                 -- folder / surname key, never shown publicly
  town text,                            -- typed in the CRM; posts name the town when known
  product text,                         -- e.g. James Hardie lap siding
  colour text,                          -- e.g. Evening Blue
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- 2. Photos (public bucket "content"). label: before, after, progress.
create table if not exists public.content_photos (
  id uuid primary key default gen_random_uuid(),
  project_key text references public.content_projects(key) on delete cascade,
  path text not null unique,            -- path in the content bucket
  label text not null default 'after' check (label in ('before', 'after', 'progress')),
  width int, height int,
  used_count int not null default 0,
  last_used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists content_photos_project_idx on public.content_photos (project_key);

-- 3. The posts.
create table if not exists public.content_posts (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('blog', 'social')),
  channels text[] not null default '{}',   -- blog: {website}; social: {facebook,instagram}
  title text,
  slug text unique,
  excerpt text,
  seo_title text,
  seo_description text,
  body jsonb,                              -- blog: [{type:'h2'|'p'|'ul'|'quote'|'img', ...}]
  caption text,                            -- social text
  link_url text,
  image_paths text[] not null default '{}',
  project_key text references public.content_projects(key) on delete set null,
  topic text,
  publish_at timestamptz not null,
  status text not null default 'scheduled'
    check (status in ('scheduled', 'published', 'paused', 'failed', 'waiting')),
  published_at timestamptz,
  external_ids jsonb not null default '{}'::jsonb,
  error text,
  created_by_ai boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists content_posts_publish_idx on public.content_posts (kind, publish_at);

-- 4. Settings (one row).
create table if not exists public.content_settings (
  id int primary key default 1 check (id = 1),
  enabled boolean not null default true,
  blogs_per_week int not null default 2 check (blogs_per_week between 0 and 7),
  socials_per_week int not null default 3 check (socials_per_week between 0 and 14),
  post_hour int not null default 9 check (post_hour between 0 and 23),  -- local hour, America/Los_Angeles
  weeks_ahead int not null default 3 check (weeks_ahead between 1 and 8),
  guide_topics jsonb not null default '[]'::jsonb,                       -- [{topic, done}]
  brand_notes text,
  updated_at timestamptz not null default now()
);
insert into public.content_settings (id, guide_topics, brand_notes) values (1,
 '[
  {"topic":"How much does new siding cost in the Bay Area in 2027?"},
  {"topic":"James Hardie vs LP SmartSide: which siding is right for a Bay Area home?"},
  {"topic":"Fire resistant siding for homes in California fire hazard zones"},
  {"topic":"How to choose a James Hardie ColorPlus colour for your home"},
  {"topic":"Signs your siding needs replacing (and what dry rot looks like)"},
  {"topic":"Board and batten vs lap siding: the look, the cost and the upkeep"},
  {"topic":"ColorPlus vs primed and painted Hardie siding"},
  {"topic":"How long does a siding replacement take, step by step"},
  {"topic":"Siding for coastal homes: salt air, fog and wind on the Peninsula"},
  {"topic":"How to finance new siding (and what checking your rate means)"},
  {"topic":"Do you need a permit to replace siding in San Mateo County?"},
  {"topic":"Does new siding add value to your home?"},
  {"topic":"Cedar shingle look without the upkeep: Hardie shingle siding"},
  {"topic":"Stucco to siding: what is involved in switching"},
  {"topic":"Lead paint and older homes: what happens before re-siding a pre 1978 house"},
  {"topic":"How to prepare your home and garden for a siding project"}
 ]'::jsonb,
 'Peninsula Siding Company, San Mateo CA. Elite Preferred James Hardie contractor, also LP SmartSide. In house crews, no subcontractors. 5 year workmanship warranty. We beat any like for like quote by 10%. Financing through Enhancify, rates from 7.99% APR, soft credit check. Phone 650-910-5521. Website peninsulasidingcompany.com, instant quote at /instant-quote.')
on conflict (id) do nothing;

-- 5. Who can see what. Staff (signed in) read and edit everything. The public
--    website reads only blog posts that are due.
alter table public.content_projects enable row level security;
alter table public.content_photos enable row level security;
alter table public.content_posts enable row level security;
alter table public.content_settings enable row level security;

drop policy if exists content_projects_staff on public.content_projects;
create policy content_projects_staff on public.content_projects for all to authenticated using (true) with check (true);
drop policy if exists content_photos_staff on public.content_photos;
create policy content_photos_staff on public.content_photos for all to authenticated using (true) with check (true);
drop policy if exists content_posts_staff on public.content_posts;
create policy content_posts_staff on public.content_posts for all to authenticated using (true) with check (true);
drop policy if exists content_settings_staff on public.content_settings;
create policy content_settings_staff on public.content_settings for all to authenticated using (true) with check (true);

drop policy if exists content_posts_public_blog on public.content_posts;
create policy content_posts_public_blog on public.content_posts for select to anon
  using (kind = 'blog' and status in ('scheduled', 'published') and publish_at <= now());

-- 6. Public photo bucket.
insert into storage.buckets (id, name, public) values ('content', 'content', true)
on conflict (id) do update set public = true;

-- 7. Timers. Write ahead once an hour (one post per run), publish every 15 min.
do $$ begin perform cron.unschedule('content-plan'); exception when others then null; end $$;
select cron.schedule('content-plan', '7 * * * *', $c$
  SELECT net.http_post(
    url := 'https://xxazlzkhwraqfeqjzviz.supabase.co/functions/v1/content-plan',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb, timeout_milliseconds := 150000);
$c$);
do $$ begin perform cron.unschedule('content-publish'); exception when others then null; end $$;
select cron.schedule('content-publish', '*/15 * * * *', $c$
  SELECT net.http_post(
    url := 'https://xxazlzkhwraqfeqjzviz.supabase.co/functions/v1/content-publish',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb, timeout_milliseconds := 55000);
$c$);

select (select count(*) from public.content_settings) as settings_rows,
       (select count(*) from cron.job where jobname like 'content-%') as timers;

-- ROLLBACK
--   select cron.unschedule('content-plan'); select cron.unschedule('content-publish');
--   drop table public.content_posts, public.content_photos, public.content_projects, public.content_settings;
