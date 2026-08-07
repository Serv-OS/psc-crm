-- 065_public_branding_view.sql
-- The login screen (Auth.jsx, pre-auth) reads branding from a `public_branding` view so the
-- customer's brand logo shows before sign-in. psc-crm never had this view (it was added to the
-- other clones with the finance module), so the login fell back to the default ServOS mark.
-- Expose the brand fields from support_settings, readable by anon. Read-only; no sensitive data.
create or replace view public.public_branding as
  select logo_url, logo_url_dark, app_name, business_name, primary_color, secondary_color
  from public.support_settings
  where id = 1;

grant select on public.public_branding to anon, authenticated;
