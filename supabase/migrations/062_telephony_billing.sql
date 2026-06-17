-- 062_telephony_billing.sql
-- Reseller billing for the Twilio phone number: monthly usage + real cost pulled
-- live from the Twilio Usage API, plus a markup % so we can produce a "bill the
-- client" figure in the back office (mirrors the processing-account margin model).

-- One row per billing month, populated by the twilio-usage-sync edge function.
CREATE TABLE IF NOT EXISTS public.twilio_usage (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period          date NOT NULL,                 -- first of the month (UTC)
  inbound_calls   int     DEFAULT 0,
  outbound_calls  int     DEFAULT 0,
  call_minutes    numeric DEFAULT 0,
  inbound_sms     int     DEFAULT 0,
  outbound_sms    int     DEFAULT 0,
  number_count    int     DEFAULT 0,
  usage_cost      numeric DEFAULT 0,             -- calls + sms + recordings (ex-number)
  number_cost     numeric DEFAULT 0,             -- monthly number rental
  total_cost      numeric DEFAULT 0,             -- usage_cost + number_cost (raw Twilio spend)
  currency        text    DEFAULT 'usd',
  breakdown       jsonb,                         -- raw per-category from Twilio, for audit
  source          text    DEFAULT 'twilio_api',
  synced_at       timestamptz DEFAULT now(),
  UNIQUE (period)
);

ALTER TABLE public.twilio_usage ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS twilio_usage_read ON public.twilio_usage;
CREATE POLICY twilio_usage_read ON public.twilio_usage
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS twilio_usage_write ON public.twilio_usage;
CREATE POLICY twilio_usage_write ON public.twilio_usage
  FOR ALL TO authenticated
  USING (current_user_role() = ANY (ARRAY['editor','owner']))
  WITH CHECK (current_user_role() = ANY (ARRAY['editor','owner']));

-- Markup + bill-to label live on the support_settings singleton (id = 1).
ALTER TABLE public.support_settings
  ADD COLUMN IF NOT EXISTS twilio_markup_pct numeric DEFAULT 0,   -- e.g. 30 = +30%
  ADD COLUMN IF NOT EXISTS twilio_bill_to    text;
