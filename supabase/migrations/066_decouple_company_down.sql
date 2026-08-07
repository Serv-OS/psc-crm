-- 066_decouple_company_down.sql — reverse of 066 (drops the added contact_id columns
-- + indexes). Does NOT restore the company_id NOT NULLs (data may now violate them).
-- Restores the closed-won trigger to its pre-066 form (no contact stamping).
drop index if exists public.idx_processing_accounts_contact_id;
drop index if exists public.idx_inv_serials_contact_id;
drop index if exists public.idx_inv_movements_contact_id;
drop index if exists public.idx_time_entries_contact_id;
drop index if exists public.idx_onboardings_contact_id;
drop index if exists public.idx_quotes_contact_id;
drop index if exists public.idx_recurring_invoices_contact_id;

alter table public.processing_accounts drop column if exists contact_id;
alter table public.inv_serials        drop column if exists contact_id;
alter table public.inv_movements      drop column if exists contact_id;
alter table public.time_entries       drop column if exists contact_id;
alter table public.onboardings        drop column if exists contact_id;

create or replace function public.create_onboarding_on_won()
 returns trigger language plpgsql security definer
as $function$
declare ob_id uuid;
begin
  if new.stage = 'closed_won' and coalesce(old.stage, '') <> 'closed_won' then
    select id into ob_id from public.onboardings where deal_id = new.id limit 1;
    if ob_id is null then
      insert into public.onboardings (company_id, deal_id, owner_id, target_go_live, notes)
        values (new.company_id, new.id, new.owner_id, new.expected_close_date,
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
