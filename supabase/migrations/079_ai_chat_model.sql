-- Separate model for the website chat.
--
-- ai_settings.model drives the "AI reply" button on tickets: a handful of calls
-- a day, written by staff, where the strongest model is worth it. The website
-- chat is the opposite — every visitor, several turns each, and the work is
-- following a script rather than reasoning hard. One setting for both meant
-- paying Opus rates for volume traffic.
--
-- The chat function already reads chat_model first and falls back to model, so
-- this takes effect without a redeploy.

alter table public.ai_settings
  add column if not exists chat_model text;

update public.ai_settings
   set chat_model = 'claude-sonnet-5', updated_at = now()
 where id = 1 and chat_model is null;
