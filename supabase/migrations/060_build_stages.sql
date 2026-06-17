-- 060_build_stages.sql
-- Convert the build-stage pipeline (formerly the POS "onboarding" pipeline) to
-- construction stages. The stage KEYS below must stay in sync with
-- src/lib/buildStages.js (the frontend single source of truth).
--
-- New pipeline:
--   pre_production, measure, materials_ordered, materials_delivery_scheduled,
--   permits, scheduled, in_progress, final_inspection, completed, final_payment,
--   closed_warranty

-- 1) Drop the old POS-era stage CHECK constraint and set the new default.
ALTER TABLE public.onboardings DROP CONSTRAINT IF EXISTS onboardings_stage_check;
ALTER TABLE public.onboardings ALTER COLUMN stage SET DEFAULT 'pre_production';

-- 2) Migrate existing build-stage records to the new vocabulary
UPDATE public.onboardings SET stage = CASE stage
  WHEN 'kickoff'              THEN 'pre_production'
  WHEN 'hardware_ordered'     THEN 'materials_ordered'
  WHEN 'hardware_shipped'     THEN 'materials_delivery_scheduled'
  WHEN 'account_menu_config'  THEN 'scheduled'
  WHEN 'staff_training'       THEN 'in_progress'
  WHEN 'go_live_scheduled'    THEN 'scheduled'
  WHEN 'live'                 THEN 'completed'
  WHEN 'handover_to_support'  THEN 'closed_warranty'
  ELSE stage
END;

-- Catch-all: never leave a record on a stage the board cannot render.
UPDATE public.onboardings SET stage = 'pre_production'
WHERE stage NOT IN ('pre_production','measure','materials_ordered','materials_delivery_scheduled',
                    'permits','scheduled','in_progress','final_inspection','completed',
                    'final_payment','closed_warranty');

-- 3) Migrate the build-stage timeline so historical labels still resolve.
UPDATE public.stage_history SET
  from_stage = CASE from_stage
    WHEN 'kickoff' THEN 'pre_production' WHEN 'hardware_ordered' THEN 'materials_ordered'
    WHEN 'hardware_shipped' THEN 'materials_delivery_scheduled' WHEN 'account_menu_config' THEN 'scheduled'
    WHEN 'staff_training' THEN 'in_progress' WHEN 'go_live_scheduled' THEN 'scheduled'
    WHEN 'live' THEN 'completed' WHEN 'handover_to_support' THEN 'closed_warranty'
    ELSE from_stage END,
  to_stage = CASE to_stage
    WHEN 'kickoff' THEN 'pre_production' WHEN 'hardware_ordered' THEN 'materials_ordered'
    WHEN 'hardware_shipped' THEN 'materials_delivery_scheduled' WHEN 'account_menu_config' THEN 'scheduled'
    WHEN 'staff_training' THEN 'in_progress' WHEN 'go_live_scheduled' THEN 'scheduled'
    WHEN 'live' THEN 'completed' WHEN 'handover_to_support' THEN 'closed_warranty'
    ELSE to_stage END
WHERE object_type = 'onboarding';

-- 3b) Re-add the CHECK constraint with the new construction vocabulary.
ALTER TABLE public.onboardings ADD CONSTRAINT onboardings_stage_check
  CHECK (stage = ANY (ARRAY['pre_production','measure','materials_ordered','materials_delivery_scheduled',
                            'permits','scheduled','in_progress','final_inspection','completed',
                            'final_payment','closed_warranty']::text[]));

-- 4) Seed the first new stage in the two auto-create paths (was 'kickoff').
CREATE OR REPLACE FUNCTION public.create_onboarding_on_won()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE ob_id uuid;
BEGIN
  IF NEW.stage = 'closed_won' AND COALESCE(OLD.stage, '') <> 'closed_won' THEN
    SELECT id INTO ob_id FROM public.onboardings WHERE deal_id = NEW.id LIMIT 1;
    IF ob_id IS NULL THEN
      INSERT INTO public.onboardings (company_id, deal_id, owner_id, target_go_live, notes)
        VALUES (NEW.company_id, NEW.id, NEW.owner_id, NEW.expected_close_date,
                'Auto-created from won deal: ' || COALESCE(NEW.name, ''))
        RETURNING id INTO ob_id;
      INSERT INTO public.stage_history (object_type, object_id, from_stage, to_stage, changed_by)
        VALUES ('onboarding', ob_id, NULL, 'pre_production', NEW.owner_id);
      -- carry the deal's location + contact associations onto the onboarding
      INSERT INTO public.associations (from_type, from_id, to_type, to_id, label)
        SELECT 'onboarding', ob_id, a.to_type, a.to_id,
               COALESCE(a.label, CASE a.to_type WHEN 'location' THEN 'affected_location' ELSE 'primary_contact' END)
        FROM public.associations a
        WHERE a.from_type = 'deal' AND a.from_id = NEW.id AND a.to_type IN ('location', 'contact');
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.execute_quote(p_quote_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  q public.quotes%ROWTYPE;
  d public.deals%ROWTYPE;
  ob_id uuid;
BEGIN
  SELECT * INTO q FROM public.quotes WHERE id = p_quote_id;
  IF q.id IS NULL THEN RETURN; END IF;

  UPDATE public.quotes SET status = 'won' WHERE id = p_quote_id AND status <> 'won';

  IF q.deal_id IS NULL THEN RETURN; END IF;
  SELECT * INTO d FROM public.deals WHERE id = q.deal_id;
  IF d.id IS NULL THEN RETURN; END IF;

  IF d.stage <> 'closed_won' THEN
    UPDATE public.deals SET stage = 'closed_won', closed_at = now() WHERE id = d.id;
    INSERT INTO public.stage_history (object_type, object_id, from_stage, to_stage, changed_by)
      VALUES ('deal', d.id, d.stage, 'closed_won', d.owner_id);
  END IF;

  -- Onboarding (one per deal)
  SELECT id INTO ob_id FROM public.onboardings WHERE deal_id = d.id LIMIT 1;
  IF ob_id IS NULL THEN
    INSERT INTO public.onboardings (company_id, deal_id, owner_id, target_go_live, notes)
      VALUES (d.company_id, d.id, d.owner_id, q.go_live_date, 'Auto-created from accepted quote #' || q.quote_number)
      RETURNING id INTO ob_id;
    INSERT INTO public.stage_history (object_type, object_id, from_stage, to_stage, changed_by)
      VALUES ('onboarding', ob_id, NULL, 'pre_production', d.owner_id);
    -- copy location + contact associations from the deal
    INSERT INTO public.associations (from_type, from_id, to_type, to_id, label)
      SELECT 'onboarding', ob_id, 'location', a.to_id, COALESCE(a.label, 'affected_location')
      FROM public.associations a WHERE a.from_type = 'deal' AND a.from_id = d.id AND a.to_type = 'location';
    INSERT INTO public.associations (from_type, from_id, to_type, to_id, label)
      SELECT 'onboarding', ob_id, 'contact', a.to_id, a.label
      FROM public.associations a WHERE a.from_type = 'deal' AND a.from_id = d.id AND a.to_type = 'contact';
  END IF;
END;
$function$;
