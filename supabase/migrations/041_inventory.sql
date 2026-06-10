-- Inventory module (port of AIO Inventory): serial-tracked hardware stock.
-- Movement ledger + current-state serial rows, POs with landed cost, shipments
-- with partial receive, deployment to CRM company/locations, servicing/RMA,
-- stocktakes. Shares the existing products catalogue (quoting + inventory).

-- ── Products: inventory fields on the shared catalogue ──────────────────────
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS track_inventory boolean NOT NULL DEFAULT false;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS inv_category text;          -- hardware taxonomy (Payment Terminal, KDS, …)
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS default_threshold integer;  -- low-stock default
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS supplier_id uuid;

-- ── Suppliers ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.inv_suppliers (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  contact_name text,
  email        text,
  phone        text,
  notes        text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
DO $$ BEGIN
  ALTER TABLE public.products ADD CONSTRAINT products_supplier_fk
    FOREIGN KEY (supplier_id) REFERENCES public.inv_suppliers(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Warehouses (one main + ad-hoc) ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.inv_warehouses (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.inv_warehouses (name) VALUES ('Main Warehouse') ON CONFLICT DO NOTHING;

-- ── Purchase Orders ──────────────────────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS public.inv_po_seq START 1000;
CREATE TABLE IF NOT EXISTS public.inv_orders (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  po_number      text NOT NULL UNIQUE,
  supplier_id    uuid REFERENCES public.inv_suppliers(id) ON DELETE SET NULL,
  supplier_name  text,
  expected_by    date,
  status         text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','partial','received','cancelled')),
  subtotal       numeric NOT NULL DEFAULT 0,
  tax_rate       numeric,
  tax_amount     numeric NOT NULL DEFAULT 0,
  tax_ref        text,
  total_with_tax numeric NOT NULL DEFAULT 0,
  notes          text,
  created_by     uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.inv_order_lines (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        uuid NOT NULL REFERENCES public.inv_orders(id) ON DELETE CASCADE,
  product_id      uuid REFERENCES public.products(id) ON DELETE SET NULL,
  product_name    text NOT NULL,
  category        text,
  qty             integer NOT NULL DEFAULT 1,
  unit_cost       numeric,
  tax_share       numeric DEFAULT 0,
  tax_per_unit    numeric DEFAULT 0,
  landed_unit_cost numeric,            -- unit cost + proportional tax (locked PO price)
  received_qty    integer NOT NULL DEFAULT 0,
  sort            integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_inv_order_lines ON public.inv_order_lines(order_id);

-- ── Shipments (goods in transit) ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.inv_shipments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      uuid REFERENCES public.inv_orders(id) ON DELETE SET NULL,
  po_number     text,
  supplier_name text,
  warehouse_id  uuid REFERENCES public.inv_warehouses(id) ON DELETE SET NULL,
  status        text NOT NULL DEFAULT 'in_transit' CHECK (status IN ('in_transit','received','cancelled')),
  freight_cost  numeric DEFAULT 0,
  eta           date,
  received_at   timestamptz,
  received_by   text,
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.inv_shipment_lines (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id  uuid NOT NULL REFERENCES public.inv_shipments(id) ON DELETE CASCADE,
  product_id   uuid REFERENCES public.products(id) ON DELETE SET NULL,
  product_name text NOT NULL,
  category     text,
  qty          integer NOT NULL DEFAULT 1,
  serials      text[] NOT NULL DEFAULT '{}',   -- may contain NS- placeholders
  unit_cost    numeric,                         -- landed (incl. freight share) set at arrange time
  received_qty integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_inv_shipment_lines ON public.inv_shipment_lines(shipment_id);

-- ── Serials: current state of every unit ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.inv_serials (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  serial        text NOT NULL UNIQUE,           -- uppercased; NS-… for non-serialised units
  product_id    uuid REFERENCES public.products(id) ON DELETE SET NULL,
  product_name  text NOT NULL,
  category      text,
  status        text NOT NULL DEFAULT 'in_stock'
    CHECK (status IN ('in_stock','in_transit','deployed','servicing','rma','total_loss','written_off')),
  warehouse_id  uuid REFERENCES public.inv_warehouses(id) ON DELETE SET NULL,
  -- deployment target (CRM-linked, with free-text fallback)
  company_id    uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  location_id   uuid REFERENCES public.locations(id) ON DELETE SET NULL,
  customer_name text,
  deployed_at   timestamptz,
  dispatch_ref  text,
  -- provenance & condition
  used          boolean NOT NULL DEFAULT false,  -- permanent from receipt
  condition     text NOT NULL DEFAULT '',        -- '', needs-testing, pass, fail, fail-tl
  tested_by     text,
  tested_at     timestamptz,
  test_notes    text,
  cost          numeric,                         -- landed unit cost
  po_number     text,
  order_id      uuid REFERENCES public.inv_orders(id) ON DELETE SET NULL,
  shipment_id   uuid REFERENCES public.inv_shipments(id) ON DELETE SET NULL,
  supplier_name text,
  rma_type      text,                            -- 'rma' | 'tl' when dispatched back
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_inv_serials_status ON public.inv_serials(status);
CREATE INDEX IF NOT EXISTS idx_inv_serials_product ON public.inv_serials(product_name);
CREATE INDEX IF NOT EXISTS idx_inv_serials_location ON public.inv_serials(location_id);
CREATE INDEX IF NOT EXISTS idx_inv_serials_company ON public.inv_serials(company_id);

-- ── Movement ledger (audit trail) ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.inv_movements (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type          text NOT NULL CHECK (type IN ('in','out','recall','rma_out','writeoff','transfer','adjust')),
  product_name  text NOT NULL,
  category      text,
  serials       text[] NOT NULL DEFAULT '{}',
  qty           integer NOT NULL DEFAULT 0,
  warehouse_name text,
  supplier_name text,
  po_number     text,
  company_id    uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  location_id   uuid REFERENCES public.locations(id) ON DELETE SET NULL,
  customer_name text,
  ref           text,
  condition     text,
  by_name       text,
  actor_id      uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  notes         text,
  occurred_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_inv_movements_time ON public.inv_movements(occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_inv_movements_serials ON public.inv_movements USING gin (serials);

-- ── Low-stock thresholds (product × warehouse overrides) ────────────────────
CREATE TABLE IF NOT EXISTS public.inv_thresholds (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_name text NOT NULL,
  warehouse_id uuid REFERENCES public.inv_warehouses(id) ON DELETE CASCADE,
  threshold    integer NOT NULL DEFAULT 3,
  UNIQUE (product_name, warehouse_id)
);

-- ── Stocktakes ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.inv_stocktakes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status       text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','paused','completed')),
  scope        jsonb NOT NULL DEFAULT '[]',   -- [{product_name, warehouse_id}]
  counted      jsonb NOT NULL DEFAULT '[]',   -- serials scanned
  result       jsonb,                          -- {expected, found, missing[], unexpected[]}
  started_by   uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  started_at   timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  notes        text
);

-- ── RLS ──────────────────────────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['inv_suppliers','inv_warehouses','inv_orders','inv_order_lines',
    'inv_shipments','inv_shipment_lines','inv_serials','inv_movements','inv_thresholds','inv_stocktakes'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I_read ON public.%I', t, t);
    EXECUTE format('CREATE POLICY %I_read ON public.%I FOR SELECT TO authenticated USING (true)', t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I_write ON public.%I', t, t);
    EXECUTE format($f$CREATE POLICY %I_write ON public.%I FOR ALL TO authenticated
      USING (public.current_user_role() IN ('editor','owner'))
      WITH CHECK (public.current_user_role() IN ('editor','owner'))$f$, t, t);
  END LOOP;
END $$;

DROP TRIGGER IF EXISTS trg_inv_serials_touch ON public.inv_serials;
CREATE TRIGGER trg_inv_serials_touch BEFORE UPDATE ON public.inv_serials
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
