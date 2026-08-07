-- Sales chat — an assistant on the website that qualifies an enquiry, prices it
-- with the REAL quote engine, and lands it in the pipeline.
--
-- This is deliberately not the support bot from posupcrm. There are no tickets
-- here: the outcome of a good conversation is a contact, a property, a lead, a
-- deal and (when we have a square footage) a draft quote sitting on a rep's
-- desk, exactly as the website instant-quote form produces.
--
-- The chat_* tables carry no anon policy on purpose. The public edge function
-- runs as service_role and validates the site key and Origin itself, so an
-- anonymous browser never touches these tables directly.

create extension if not exists pgcrypto;

-- ── Embeds ──────────────────────────────────────────────────────────────────
-- One row per place the widget is embedded. The key is public (it ships in the
-- page source), so the allow-list of origins is what actually protects it.
create table if not exists public.chat_sites (
  id uuid primary key default gen_random_uuid(),
  site_key text unique not null,
  label text not null,
  active boolean not null default true,
  allowed_origins text[] not null default '{}',   -- empty = any origin
  mode text not null default 'popup',             -- popup | inline
  created_at timestamptz not null default now()
);

-- ── Playbook (single row) ───────────────────────────────────────────────────
create table if not exists public.chat_playbook (
  id int primary key default 1 check (id = 1),
  enabled boolean not null default false,
  greeting text not null default
    'Hi — happy to help you price up a siding project. What are you looking to get done?',
  tone text not null default
    'Warm, straightforward and useful. Like a good estimator on the phone, not a salesperson.',
  persona_names text[] not null default '{}',
  business_context text,
  -- What we need to know before a rep can do anything useful with the lead.
  qualifying_questions text[] not null default array[
    'What the property is — single family home, multi-family, commercial',
    'Whether they are replacing existing siding, re-siding over stucco, or building new',
    'Roughly when they want the work done',
    'Whether they are the homeowner or getting quotes on someone else''s behalf',
    'The town or ZIP so we know it is in our service area'
  ],
  never_answer text[] not null default array[
    'warranty claim', 'lawsuit', 'lien', 'complaint', 'refund'
  ],
  always_escalate text[] not null default array[
    'emergency', 'storm damage', 'water coming in', 'insurance claim'
  ],
  unknown_reply text not null default
    'That one I would rather not guess at — let me get one of our estimators to come back to you properly.',
  service_area text,
  -- ── Estimating ────────────────────────────────────────────────────────────
  -- Figures come from the quote engine and catalogue a rep uses, then widen
  -- into a range so nothing the bot says can be mistaken for a firm quote.
  estimates_enabled boolean not null default true,
  estimate_band numeric not null default 0.15 check (estimate_band >= 0 and estimate_band <= 1),
  estimate_rounding int not null default 500,
  -- Where to send someone who does not know their wall area.
  measure_tool_url text,
  min_sqft numeric not null default 100,
  max_sqft numeric not null default 25000,
  updated_at timestamptz not null default now()
);
insert into public.chat_playbook (id) values (1) on conflict (id) do nothing;

-- ── Conversations ───────────────────────────────────────────────────────────
create table if not exists public.chat_sessions (
  id uuid primary key default gen_random_uuid(),
  site_id uuid references public.chat_sites(id) on delete set null,
  origin text,
  status text not null default 'open',       -- open | captured | handed_over | closed
  visitor_name text,
  visitor_email text,
  visitor_phone text,
  contact_id uuid references public.contacts(id) on delete set null,
  lead_id uuid references public.leads(id) on delete set null,
  deal_id uuid references public.deals(id) on delete set null,
  quote_id uuid references public.quotes(id) on delete set null,
  -- Everything the bot established, so a rep can read the qualification without
  -- reading the transcript.
  qualification jsonb not null default '{}'::jsonb,
  -- The last range it quoted, and the inputs behind it. Written ONLY by the
  -- estimate tool — the model can never put a number in here itself.
  estimate jsonb,
  pending_reason text,
  last_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists chat_sessions_recent on public.chat_sessions (last_at desc);

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.chat_sessions(id) on delete cascade,
  role text not null check (role in ('visitor', 'bot')),
  content text not null,
  escalated boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists chat_messages_session on public.chat_messages (session_id, created_at);

-- ── Knowledge ───────────────────────────────────────────────────────────────
-- What the bot is allowed to state as fact: process, materials, warranty,
-- service area. Anything not in here is handed to a person.
create table if not exists public.kb_docs (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'manual',      -- manual | doc
  source_ref text,
  title text,
  question text not null,
  answer text not null,
  category text,
  active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  search tsvector generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(question, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(answer, '')), 'B')
  ) stored
);
create index if not exists kb_docs_search on public.kb_docs using gin (search);

-- Retrieval. websearch_to_tsquery ANDs every word, so a real customer sentence
-- ("do you do the whole house or just the front?") matched nothing at all. OR
-- the lexemes instead and let ts_rank sort out which entry is closest.
create or replace function public.kb_search(q text, lim int default 5)
returns table (id uuid, title text, question text, answer text, category text, rank real)
language sql stable security definer set search_path = public as $$
  with terms as (
    select string_agg(w, ' | ') as tq
    from unnest(string_to_array(
           regexp_replace(lower(coalesce(q, '')), '[^a-z0-9 ]', ' ', 'g'), ' ')) as w
    where length(w) > 2
  )
  select d.id, d.title, d.question, d.answer, d.category,
         ts_rank(d.search, to_tsquery('english', t.tq)) as rank
  from public.kb_docs d, terms t
  where d.active
    and t.tq is not null and t.tq <> ''
    and d.search @@ to_tsquery('english', t.tq)
  order by rank desc
  limit greatest(1, coalesce(lim, 5));
$$;
grant execute on function public.kb_search(text, int) to authenticated;

-- ── RLS — staff read, owner/editor write, no anon ───────────────────────────
do $$
declare t text;
begin
  foreach t in array array['chat_sites', 'chat_playbook', 'chat_sessions', 'chat_messages', 'kb_docs'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I_read on public.%I', t, t);
    execute format('create policy %I_read on public.%I for select using (auth.uid() is not null)', t, t);
    execute format('drop policy if exists %I_write on public.%I', t, t);
    execute format($f$create policy %I_write on public.%I for all
      using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('owner','editor')))
      with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('owner','editor')))$f$, t, t);
  end loop;
end $$;
