-- 087_financing.sql (safe to run twice)
--
-- Peter, 22 Nov 2026: PSC offers financing through Enhancify. The website asks
-- "Interested in financing?", the CRM keeps the answer, and each deal tracks
-- how far the customer got with the lender (Enhancify tells us nothing back,
-- so a rep sets it by hand). Quotes can offer an Apply for financing button.

-- 1. The answer from the website (or typed by a rep): yes, no or maybe.
alter table public.leads add column if not exists financing text;
alter table public.leads drop constraint if exists leads_financing_check;
alter table public.leads add constraint leads_financing_check
  check (financing is null or financing in ('yes', 'no', 'maybe'));

-- 2. Where the customer is with the lender.
alter table public.deals add column if not exists financing_status text;
alter table public.deals drop constraint if exists deals_financing_status_check;
alter table public.deals add constraint deals_financing_status_check
  check (financing_status is null or financing_status in
    ('interested', 'applied', 'approved', 'funded', 'declined', 'not_needed'));

-- 3. Show the Apply for financing button on this quote (on unless a rep turns it off).
alter table public.quotes add column if not exists offer_financing boolean not null default true;

-- Old leads that said so in their notes.
update public.leads set financing = 'yes'
 where financing is null and notes ilike '%Financing: interested%';

select
  (select count(*) from public.leads where financing = 'yes') as leads_wanting_financing,
  (select count(*) from public.quotes where offer_financing) as quotes_offering_financing;

-- ROLLBACK
--   alter table public.leads drop column financing;
--   alter table public.deals drop column financing_status;
--   alter table public.quotes drop column offer_financing;
