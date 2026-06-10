-- Link invoices to the quote that generated them (paid-quote receipts)
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS quote_id uuid REFERENCES public.quotes(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_invoices_quote ON public.invoices(quote_id);
