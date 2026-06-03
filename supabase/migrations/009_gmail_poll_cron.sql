-- Migration 009: Schedule inbound email polling
-- Calls the gmail-check edge function every minute so customer emails
-- are pulled into the support system automatically.

-- Extensions needed to schedule HTTP calls from Postgres
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Remove any prior version of the job so this migration is re-runnable
DO $$
BEGIN
  PERFORM cron.unschedule('gmail-check-poll');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

-- Poll Gmail every minute. gmail-check is deployed with --no-verify-jwt,
-- so no Authorization header is required; it uses the service role internally.
SELECT cron.schedule(
  'gmail-check-poll',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://yuevuqvldtmjwwzjrddo.supabase.co/functions/v1/gmail-check',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);
