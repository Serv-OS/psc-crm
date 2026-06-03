-- Migration 012: Ticket auto-assignment
-- New unassigned tickets are routed to a support-team agent automatically,
-- preferring whoever is online, balancing by current open-ticket load.
-- Runs as a BEFORE INSERT trigger so every creation path is covered
-- (inbound SMS/email/call edge functions + the in-app "New ticket" form).

-- Settings singleton (owner-controlled)
CREATE TABLE IF NOT EXISTS public.support_settings (
  id                  int PRIMARY KEY DEFAULT 1,
  auto_assign_enabled boolean NOT NULL DEFAULT true,
  assign_team         text NOT NULL DEFAULT 'support',
  prefer_online       boolean NOT NULL DEFAULT true,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT support_settings_singleton CHECK (id = 1)
);

INSERT INTO public.support_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.support_settings ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY support_settings_read ON public.support_settings FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY support_settings_write ON public.support_settings FOR ALL TO authenticated
    USING (public.current_user_role() = 'owner') WITH CHECK (public.current_user_role() = 'owner');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Auto-assign function
CREATE OR REPLACE FUNCTION public.auto_assign_ticket() RETURNS trigger AS $$
DECLARE
  s public.support_settings%ROWTYPE;
  chosen uuid;
  five_min timestamptz := now() - interval '5 minutes';
BEGIN
  -- Respect an explicit owner if one was provided
  IF NEW.owner_id IS NOT NULL THEN RETURN NEW; END IF;

  SELECT * INTO s FROM public.support_settings WHERE id = 1;
  IF NOT FOUND OR NOT s.auto_assign_enabled THEN RETURN NEW; END IF;

  WITH agents AS (
    SELECT p.id,
           (SELECT count(*) FROM public.tickets t
              WHERE t.owner_id = p.id AND t.stage NOT IN ('resolved','closed')) AS load,
           COALESCE(a.status, 'offline') AS status,
           a.last_seen_at
    FROM public.profiles p
    LEFT JOIN public.agent_status a ON a.profile_id = p.id
    WHERE p.teams @> ARRAY[s.assign_team]::text[]
  )
  SELECT id INTO chosen FROM agents
  ORDER BY
    CASE WHEN s.prefer_online AND status = 'online' AND last_seen_at > five_min THEN 0 ELSE 1 END,
    load ASC,
    random()
  LIMIT 1;

  IF chosen IS NOT NULL THEN
    NEW.owner_id := chosen;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_auto_assign ON public.tickets;
CREATE TRIGGER trg_auto_assign BEFORE INSERT ON public.tickets
  FOR EACH ROW EXECUTE FUNCTION public.auto_assign_ticket();
