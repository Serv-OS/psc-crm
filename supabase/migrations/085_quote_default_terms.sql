-- The standard terms every quote goes out with.
--
-- Kept in the config table, not hard-coded, so the wording is edited in the app
-- when the contract changes rather than by a deploy. Quote creation copies the
-- text onto the quote itself, so a quote already sent keeps the terms the
-- customer actually agreed to even if the default changes afterwards.
alter table public.quote_config add column if not exists default_terms text;
