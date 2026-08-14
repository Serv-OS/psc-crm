-- Poll the Microsoft support mailbox every minute, on THIS project.
--
-- Migration 009 was inherited through the clone chain and points its cron at
-- posupject's gmail-check — a different company's project, and the Gmail
-- variant besides. On PSC someone repointed the live job by hand and never
-- recorded it; SEA never got the hand-fix, so its mailbox sat "connected" while
-- no ticket ever appeared: nothing was polling. This records the correct job
-- for THIS repo's project, re-runnably.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- The inherited job polls another company's Gmail. Remove it here.
DO $$ BEGIN PERFORM cron.unschedule('gmail-check-poll'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
-- Re-runnable: replace any prior version of our own job.
DO $$ BEGIN PERFORM cron.unschedule('ms-check-poll'); EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- ms-check is deployed --no-verify-jwt; it authenticates internally.
SELECT cron.schedule(
  'ms-check-poll',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://xxazlzkhwraqfeqjzviz.supabase.co/functions/v1/ms-check',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);
