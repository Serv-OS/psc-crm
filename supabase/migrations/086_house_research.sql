-- 086_house_research.sql (safe to run twice)
--
-- Peter, 19 Nov 2026: "research the house" on the CRM. One button on the
-- property gathers what matters for a siding job: Street View and satellite
-- photos, the building outline and roof height from Google, and what Claude
-- reads from the photos and public listings (year built, current siding,
-- storeys, access, lead risk, fire zone). Each run is kept, newest first.
--
-- Written only by the house-research edge function (service role). Everyone
-- signed in can read, same as locations.

create table if not exists public.house_research (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  address text,
  status text not null default 'running' check (status in ('running', 'done', 'failed')),
  facts jsonb not null default '{}'::jsonb,     -- Google: position, outline, roof, photo dates
  findings jsonb not null default '{}'::jsonb,  -- Claude: the report
  images jsonb not null default '[]'::jsonb,    -- [{kind, path, label}] in the attachments bucket
  sources jsonb not null default '[]'::jsonb,   -- [{title, url}] pages Claude read
  error text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists house_research_location_idx on public.house_research (location_id, created_at desc);

alter table public.house_research enable row level security;
drop policy if exists house_research_read on public.house_research;
create policy house_research_read on public.house_research for select to authenticated using (true);
-- No insert/update/delete policies: only the edge function writes.

-- Live updates while a run is going.
do $$ begin
  alter publication supabase_realtime add table public.house_research;
exception when duplicate_object then null; end $$;

select count(*) as house_research_rows from public.house_research;

-- ROLLBACK
--   drop table public.house_research;
