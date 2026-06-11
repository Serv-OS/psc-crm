-- Live conversations + customer-reply tracking and notifications.

-- Stream message inserts so open conversations update live
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.crm_activities;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS last_customer_reply_at timestamptz;
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS last_agent_reply_at timestamptz;

-- Inbound customer message -> stamp the ticket + notify; agent reply -> stamp.
CREATE OR REPLACE FUNCTION public.track_ticket_reply() RETURNS trigger AS $$
DECLARE
  t record;
BEGIN
  IF NEW.subject_type <> 'ticket' OR COALESCE(NEW.is_internal, false) THEN RETURN NEW; END IF;
  IF NEW.type NOT IN ('email', 'sms', 'call') THEN RETURN NEW; END IF;

  IF NEW.direction = 'inbound' THEN
    UPDATE public.tickets SET last_customer_reply_at = now() WHERE id = NEW.subject_id
      RETURNING * INTO t;
    IF t.id IS NOT NULL THEN
      INSERT INTO public.notifications (recipient_id, actor_id, type, title, body, entity_type, link_id)
      SELECT p.id, NULL, 'reply',
             'Customer replied to #' || t.ticket_number || ': ' || COALESCE(t.subject, 'No subject'),
             left(COALESCE(NEW.body, ''), 140), 'ticket', t.id
      FROM public.profiles p
      WHERE (t.owner_id IS NOT NULL AND p.id = t.owner_id)
         OR (t.owner_id IS NULL AND ('support' = ANY(COALESCE(p.teams, '{}')) OR p.role = 'owner'));
    END IF;
  ELSIF NEW.direction = 'outbound' THEN
    UPDATE public.tickets SET last_agent_reply_at = now() WHERE id = NEW.subject_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_track_ticket_reply ON public.crm_activities;
CREATE TRIGGER trg_track_ticket_reply AFTER INSERT ON public.crm_activities
  FOR EACH ROW EXECUTE FUNCTION public.track_ticket_reply();
