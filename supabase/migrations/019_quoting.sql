-- Migration 019: Quoting tool — product catalogue, quotes, line items,
-- and auto-rollup of line items into the deal's revenue fields.

-- ---------- Catalogue ----------
CREATE TABLE IF NOT EXISTS public.products (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  description   text,
  sku           text,
  category      text NOT NULL DEFAULT 'hardware' CHECK (category IN ('hardware','services','saas','payments')),
  billing_type  text NOT NULL DEFAULT 'one_off' CHECK (billing_type IN ('one_off','monthly','annual','usage')),
  default_price numeric NOT NULL DEFAULT 0,
  unit          text,
  stripe_price_id text,
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN CREATE POLICY products_read ON public.products FOR SELECT TO authenticated USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY products_write ON public.products FOR ALL TO authenticated USING (public.current_user_role() IN ('editor','owner')) WITH CHECK (public.current_user_role() IN ('editor','owner')); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DROP TRIGGER IF EXISTS trg_products_touch ON public.products;
CREATE TRIGGER trg_products_touch BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ---------- Quotes ----------
CREATE SEQUENCE IF NOT EXISTS public.quote_number_seq START 1000;

CREATE TABLE IF NOT EXISTS public.quotes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_number    integer NOT NULL DEFAULT nextval('public.quote_number_seq'),
  deal_id         uuid REFERENCES public.deals(id) ON DELETE CASCADE,
  company_id      uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  contact_id      uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  status          text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','sent','viewed','signed','paid','won','declined','expired','void')),
  valid_until     date,
  go_live_date    date,
  payment_terms   text NOT NULL DEFAULT 'pay_now' CHECK (payment_terms IN ('pay_now','deposit','invoice_later')),
  deposit_percent numeric DEFAULT 0,
  tax_rate        numeric NOT NULL DEFAULT 20,
  one_off_subtotal numeric NOT NULL DEFAULT 0,
  tax_amount      numeric NOT NULL DEFAULT 0,
  one_off_total   numeric NOT NULL DEFAULT 0,
  recurring_arr   numeric NOT NULL DEFAULT 0,
  terms           text,
  notes           text,
  public_token    text UNIQUE DEFAULT replace(gen_random_uuid()::text, '-', ''),
  accepted_at     timestamptz,
  signed_at       timestamptz,
  signed_by_name  text,
  signature_path  text,
  signer_ip       text,
  paid_at         timestamptz,
  amount_paid     numeric,
  stripe_checkout_id text,
  stripe_payment_intent text,
  created_by      uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_quotes_deal ON public.quotes(deal_id);
CREATE INDEX IF NOT EXISTS idx_quotes_token ON public.quotes(public_token);
ALTER TABLE public.quotes ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN CREATE POLICY quotes_read ON public.quotes FOR SELECT TO authenticated USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY quotes_write ON public.quotes FOR ALL TO authenticated USING (public.current_user_role() IN ('editor','owner')) WITH CHECK (public.current_user_role() IN ('editor','owner')); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DROP TRIGGER IF EXISTS trg_quotes_touch ON public.quotes;
CREATE TRIGGER trg_quotes_touch BEFORE UPDATE ON public.quotes FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ---------- Line items ----------
CREATE TABLE IF NOT EXISTS public.quote_line_items (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id     uuid NOT NULL REFERENCES public.quotes(id) ON DELETE CASCADE,
  product_id   uuid REFERENCES public.products(id) ON DELETE SET NULL,
  name         text NOT NULL,
  description  text,
  category     text NOT NULL DEFAULT 'hardware' CHECK (category IN ('hardware','services','saas','payments')),
  billing_type text NOT NULL DEFAULT 'one_off' CHECK (billing_type IN ('one_off','monthly','annual','usage')),
  qty          numeric NOT NULL DEFAULT 1,
  unit_price   numeric NOT NULL DEFAULT 0,
  discount     numeric NOT NULL DEFAULT 0,   -- percent
  line_total   numeric NOT NULL DEFAULT 0,   -- qty * unit_price * (1 - discount/100)
  sort         int NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_qli_quote ON public.quote_line_items(quote_id);
ALTER TABLE public.quote_line_items ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN CREATE POLICY qli_read ON public.quote_line_items FOR SELECT TO authenticated USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY qli_write ON public.quote_line_items FOR ALL TO authenticated USING (public.current_user_role() IN ('editor','owner')) WITH CHECK (public.current_user_role() IN ('editor','owner')); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------- Auto-rollup: line items -> deal revenue fields ----------
CREATE OR REPLACE FUNCTION public.recalc_deal_rollup(p_deal_id uuid) RETURNS void AS $$
DECLARE
  q_id uuid;
  hw numeric := 0; sv numeric := 0; saas numeric := 0; pay numeric := 0;
BEGIN
  IF p_deal_id IS NULL THEN RETURN; END IF;
  -- Primary quote drives the deal: the won one if present, else the most recent live quote
  SELECT id INTO q_id FROM public.quotes
   WHERE deal_id = p_deal_id AND status NOT IN ('declined','void','expired')
   ORDER BY (status = 'won') DESC, updated_at DESC
   LIMIT 1;

  IF q_id IS NOT NULL THEN
    SELECT
      COALESCE(sum(line_total) FILTER (WHERE category = 'hardware'), 0),
      COALESCE(sum(line_total) FILTER (WHERE category = 'services'), 0),
      COALESCE(sum(CASE WHEN category = 'saas' THEN (CASE WHEN billing_type = 'monthly' THEN line_total * 12 ELSE line_total END) END), 0),
      COALESCE(sum(line_total) FILTER (WHERE category = 'payments'), 0)
    INTO hw, sv, saas, pay
    FROM public.quote_line_items WHERE quote_id = q_id;
  END IF;

  UPDATE public.deals SET
    hardware_value = hw, services_value = sv, saas_arr = saas, payments_arr = pay,
    value = hw + sv + saas + pay
  WHERE id = p_deal_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.trg_qli_recalc() RETURNS trigger AS $$
DECLARE did uuid;
BEGIN
  SELECT deal_id INTO did FROM public.quotes WHERE id = COALESCE(NEW.quote_id, OLD.quote_id);
  PERFORM public.recalc_deal_rollup(did);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS qli_recalc ON public.quote_line_items;
CREATE TRIGGER qli_recalc AFTER INSERT OR UPDATE OR DELETE ON public.quote_line_items
  FOR EACH ROW EXECUTE FUNCTION public.trg_qli_recalc();

CREATE OR REPLACE FUNCTION public.trg_quote_recalc() RETURNS trigger AS $$
BEGIN
  PERFORM public.recalc_deal_rollup(NEW.deal_id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS quote_recalc ON public.quotes;
CREATE TRIGGER quote_recalc AFTER INSERT OR UPDATE ON public.quotes
  FOR EACH ROW EXECUTE FUNCTION public.trg_quote_recalc();
