-- Customer purchase-order reference, shown on the invoice and in emails
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS po_number text;
