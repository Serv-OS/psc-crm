-- Google Chat as a third notification channel (alongside email + SMS).
-- A space-level incoming webhook: the team watches one "CRM Alerts" space.
ALTER TABLE public.support_settings ADD COLUMN IF NOT EXISTS chat_webhook_url text;
ALTER TABLE public.support_settings ADD COLUMN IF NOT EXISTS chat_notify_enabled boolean DEFAULT false;
-- Track Chat delivery + dedupe a single event's recipient fan-out to one post.
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS chatted_at timestamptz;
