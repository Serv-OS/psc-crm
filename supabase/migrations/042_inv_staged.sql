-- Staged deployments: serials reserved against a customer before dispatch is
-- confirmed (the old app's "pending deployments").
ALTER TABLE public.inv_serials DROP CONSTRAINT IF EXISTS inv_serials_status_check;
ALTER TABLE public.inv_serials ADD CONSTRAINT inv_serials_status_check
  CHECK (status IN ('in_stock','staged','in_transit','deployed','servicing','rma','total_loss','written_off'));
