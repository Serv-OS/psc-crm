-- 090: server only settings (23 Nov 2026, CRM 0.9.124). Safe to run twice.
--
-- A small key and value table that ONLY the edge functions can read (they use
-- the service role). Row level security is on with no policies, and the anon
-- and authenticated roles have no rights at all, so neither a browser nor a
-- signed in CRM user can see what is in it.
--
-- First use: website_forms_secret. The website's own server sends it with each
-- form, and forms-public then skips reCAPTCHA for that request. The value is
-- NOT in this file: it is set once with an insert that Peter runs.

create table if not exists public.server_settings (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);

alter table public.server_settings enable row level security;
revoke all on public.server_settings from anon, authenticated;

-- Check: expect rls = true, and both role checks false.
select
  (select relrowsecurity from pg_class where oid = 'public.server_settings'::regclass) as rls,
  has_table_privilege('anon', 'public.server_settings', 'select') as anon_can_read,
  has_table_privilege('authenticated', 'public.server_settings', 'select') as staff_can_read;
