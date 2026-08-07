-- What the widget says and looks like, per embed — and make the preview link work.
--
-- Three things were wrong:
--
--  * The heading was hard-coded to "Get a price" with "Ask about your project"
--    underneath. Both belong to the business, not to me.
--  * The accent defaulted to #C75A29, which I took from a deal-stage colour on
--    the pipeline board. The actual brand colour lives in support_settings.
--  * "Open ↗" next to an embed always failed with "This domain isn't allowed to
--    use this chat", because the preview is served from the CRM's own domain and
--    that is never in a customer-facing allow-list. The back office now records
--    its own origin and the chat function always accepts it.

alter table public.chat_sites
  add column if not exists widget_title text,
  add column if not exists widget_subtitle text,
  add column if not exists accent text;

-- Seed from the branding this workspace already has, so a new embed looks right
-- without anyone touching it.
update public.chat_sites s set
  widget_title = coalesce(s.widget_title, (select nullif(trim(app_name), '') from public.support_settings where id = 1), 'Chat with us'),
  widget_subtitle = coalesce(s.widget_subtitle, 'How can we help?'),
  accent = coalesce(s.accent, (select nullif(trim(primary_color), '') from public.support_settings where id = 1), '#15C26A');

alter table public.chat_playbook
  -- Set automatically by the settings screen. Always allowed, so "Open ↗" works
  -- however the customer-facing allow-list is configured.
  add column if not exists preview_origin text;
