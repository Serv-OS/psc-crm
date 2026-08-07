-- 066_decouple_company.sql  (ADDITIVE + CONSTRAINT-RELAX ONLY — NO DROPS)
-- Construction CRM: the customer is the HOMEOWNER (a contact), never a company.
-- Bill-to / dispatch / time become contact-scoped. We KEEP every company_id column
-- (legacy/transitional) and only ADD contact_id where billing/inventory/time need it,
-- relax the company_id NOT NULLs so app code can stop writing company_id, and teach the
-- closed-won trigger to also stamp the homeowner contact onto the build stage.
-- Idempotent (IF NOT EXISTS / DROP NOT NULL no-ops). invoices/quotes/recurring_invoices
-- already carry contact_id (038), so they only get covering indexes here.

-- 1. contact_id on the tables that still lack it -----------------------------
alter table public.processing_accounts add column if not exists contact_id uuid references public.contacts(id) on delete set null;
alter table public.inv_serials        add column if not exists contact_id uuid references public.contacts(id) on delete set null;
alter table public.inv_movements      add column if not exists contact_id uuid references public.contacts(id) on delete set null;
alter table public.time_entries       add column if not exists contact_id uuid references public.contacts(id) on delete set null;
alter table public.onboardings        add column if not exists contact_id uuid references public.contacts(id) on delete set null;

create index if not exists idx_processing_accounts_contact_id on public.processing_accounts(contact_id);
create index if not exists idx_inv_serials_contact_id         on public.inv_serials(contact_id);
create index if not exists idx_inv_movements_contact_id       on public.inv_movements(contact_id);
create index if not exists idx_time_entries_contact_id        on public.time_entries(contact_id);
create index if not exists idx_onboardings_contact_id         on public.onboardings(contact_id);
create index if not exists idx_quotes_contact_id              on public.quotes(contact_id);
create index if not exists idx_recurring_invoices_contact_id  on public.recurring_invoices(contact_id);

-- 2. Relax company_id NOT NULLs so code can stop writing them (no-op if already nullable)
alter table public.deals       alter column company_id drop not null;
alter table public.locations   alter column company_id drop not null;
alter table public.tickets     alter column company_id drop not null;
alter table public.onboardings alter column company_id drop not null;

-- 3. closed-won trigger: also stamp the deal's primary contact onto the build stage.
--    (Exact copy of the live function + contact resolution; keeps stage 'pre_production'
--     and still writes company_id for legacy continuity.)
create or replace function public.create_onboarding_on_won()
 returns trigger language plpgsql security definer
as $function$
declare ob_id uuid; c_id uuid;
begin
  if new.stage = 'closed_won' and coalesce(old.stage, '') <> 'closed_won' then
    select id into ob_id from public.onboardings where deal_id = new.id limit 1;
    if ob_id is null then
      select a.to_id into c_id from public.associations a
        where a.from_type = 'deal' and a.from_id = new.id and a.to_type = 'contact' limit 1;
      insert into public.onboardings (company_id, contact_id, deal_id, owner_id, target_go_live, notes)
        values (new.company_id, c_id, new.id, new.owner_id, new.expected_close_date,
                'Auto-created from won deal: ' || coalesce(new.name, ''))
        returning id into ob_id;
      insert into public.stage_history (object_type, object_id, from_stage, to_stage, changed_by)
        values ('onboarding', ob_id, null, 'pre_production', new.owner_id);
      insert into public.associations (from_type, from_id, to_type, to_id, label)
        select 'onboarding', ob_id, a.to_type, a.to_id,
               coalesce(a.label, case a.to_type when 'location' then 'affected_location' else 'primary_contact' end)
        from public.associations a
        where a.from_type = 'deal' and a.from_id = new.id and a.to_type in ('location', 'contact');
    end if;
  end if;
  return new;
end;
$function$;
