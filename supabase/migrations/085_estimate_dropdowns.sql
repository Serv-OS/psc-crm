-- 085_estimate_dropdowns.sql (safe to run twice)
--
-- Steve, 18 Nov 2026: the estimate should be three dropdowns, not a long list
-- of quantities. Type the sq ft, pick the siding, the trim and any other items,
-- and the estimate shows one total per pick.
--
-- 1. Each catalogue product says which dropdown it sits in (or none).
-- 2. Trim is sold by the length, so a rule turns sq ft into trim lengths.
-- 3. Three "other items" were typed as batten or length. Pump Jack Rental as a
--    batten was being counted like battens (quote 1069: 220 pump jacks).
--    They are each items.

-- 1. Which dropdown a product sits in.
alter table public.quote_config_products
  add column if not exists estimate_group text;
alter table public.quote_config_products
  drop constraint if exists quote_config_products_estimate_group_check;
alter table public.quote_config_products
  add constraint quote_config_products_estimate_group_check
  check (estimate_group is null or estimate_group in ('siding', 'trim', 'extra'));

-- Fill it once, only where nobody has chosen yet.
update public.quote_config_products set estimate_group = 'siding'
 where estimate_group is null and type = 'sqft'
   and (name ilike '%lap%' or name ilike '%panel%' or name ilike '%shingle%' or name ilike '%artisan%');
update public.quote_config_products set estimate_group = 'trim'
 where estimate_group is null and name ilike '%trim%';
update public.quote_config_products set estimate_group = 'extra'
 where estimate_group is null
   and (name ilike 'lead test%' or name ilike 'pump jack%' or name ilike 'small job%'
     or name ilike 'insulation%' or name ilike 'plywood%' or name ilike 'soffit%');

-- 2. Sq ft per trim length (1000 sq ft = 40 lengths at 25).
alter table public.quote_config
  add column if not exists trim_sqft_per_length numeric not null default 25;

-- 3. Flat items are each items. Settings has always offered "each", but the
--    database only allowed sqft, batten and length, so picking it never saved.
alter table public.quote_config_products
  drop constraint if exists quote_config_products_type_check;
alter table public.quote_config_products
  add constraint quote_config_products_type_check
  check (type in ('sqft', 'batten', 'length', 'each'));
update public.quote_config_products set type = 'each'
 where type <> 'each' and (name ilike 'lead test%' or name ilike 'pump jack%' or name ilike 'small job%');

select estimate_group, type, count(*) from public.quote_config_products where active group by 1, 2 order by 1, 2;

-- ROLLBACK
--   alter table public.quote_config_products drop column estimate_group;
--   alter table public.quote_config drop column trim_sqft_per_length;
