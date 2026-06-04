-- Migration 016: Canned response templates + auto-reply

-- Reusable reply templates (email/SMS). Support {{contact_name}},
-- {{ticket_number}}, {{company}}, {{agent_name}} placeholders.
CREATE TABLE IF NOT EXISTS public.templates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  channel     text NOT NULL DEFAULT 'any' CHECK (channel IN ('any','email','sms')),
  subject     text,          -- used for email
  body        text NOT NULL,
  created_by  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.templates ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY templates_read ON public.templates FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY templates_write ON public.templates FOR ALL TO authenticated
    USING (public.current_user_role() IN ('editor','owner'))
    WITH CHECK (public.current_user_role() IN ('editor','owner'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DROP TRIGGER IF EXISTS trg_templates_touch ON public.templates;
CREATE TRIGGER trg_templates_touch BEFORE UPDATE ON public.templates
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- A few starter templates
INSERT INTO public.templates (name, channel, subject, body) VALUES
  ('Acknowledge', 'email', 'Re: your support request',
   'Hi {{contact_name}},\n\nThanks for getting in touch — we''ve logged your request as ticket {{ticket_number}} and are looking into it now. We''ll be back to you shortly.\n\nBest,\nServOS Support'),
  ('Resolved', 'email', 'Your support request is resolved',
   'Hi {{contact_name}},\n\nWe believe ticket {{ticket_number}} is now resolved. If anything''s still not right, just reply and we''ll pick it straight back up.\n\nBest,\nServOS Support'),
  ('Quick SMS ack', 'sms', NULL,
   'Hi {{contact_name}}, thanks for your message — we''re on it and will reply shortly. — ServOS Support')
ON CONFLICT DO NOTHING;

-- Auto-reply settings on the support_settings singleton
ALTER TABLE public.support_settings ADD COLUMN IF NOT EXISTS auto_reply_email_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE public.support_settings ADD COLUMN IF NOT EXISTS auto_reply_email_subject text NOT NULL DEFAULT 'We received your message';
ALTER TABLE public.support_settings ADD COLUMN IF NOT EXISTS auto_reply_email_message text NOT NULL DEFAULT 'Hi {{contact_name}},

Thanks for contacting ServOS Support. We''ve received your message (ticket {{ticket_number}}) and a member of our team will get back to you as soon as possible.

Best,
ServOS Support';
ALTER TABLE public.support_settings ADD COLUMN IF NOT EXISTS auto_reply_sms_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE public.support_settings ADD COLUMN IF NOT EXISTS auto_reply_sms_message text NOT NULL DEFAULT 'Thanks for messaging ServOS Support — we''ve got your message and will reply shortly.';
