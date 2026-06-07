-- AI assistant settings (Claude). Single-row config; api_key is read
-- server-side by the ai-draft edge function via the service role.
create table if not exists public.ai_settings (
  id int primary key default 1,
  api_key text,
  model text default 'claude-opus-4-8',
  tone text default 'friendly, concise and professional',
  enabled boolean default true,
  updated_at timestamptz default now(),
  constraint ai_settings_singleton check (id = 1)
);

insert into public.ai_settings (id) values (1) on conflict do nothing;

alter table public.ai_settings enable row level security;

-- Owners manage the config from Settings. The key is write-mostly; the
-- frontend only checks presence, never displays it.
drop policy if exists ai_settings_owner_all on public.ai_settings;
create policy ai_settings_owner_all on public.ai_settings
  for all
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'owner'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'owner'));
