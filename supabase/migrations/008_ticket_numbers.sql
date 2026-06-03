-- Migration 008: Auto-assigned ticket numbers (additive only)
-- Every ticket gets a unique sequential number, displayed as #NNNN in the UI.

-- Sequence for ticket numbers
CREATE SEQUENCE IF NOT EXISTS public.ticket_number_seq;

-- Add the column (nullable first so backfill works)
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS ticket_number integer;

-- Backfill existing tickets that have no number, oldest first
WITH numbered AS (
  SELECT id, 1000 + (row_number() OVER (ORDER BY created_at, id))::int AS n
  FROM public.tickets
  WHERE ticket_number IS NULL
)
UPDATE public.tickets t
SET ticket_number = numbered.n
FROM numbered
WHERE t.id = numbered.id;

-- Advance the sequence past the highest assigned number
SELECT setval(
  'public.ticket_number_seq',
  GREATEST((SELECT COALESCE(MAX(ticket_number), 1000) FROM public.tickets), 1000)
);

-- New tickets auto-get the next number
ALTER TABLE public.tickets ALTER COLUMN ticket_number SET DEFAULT nextval('public.ticket_number_seq');

-- Enforce uniqueness
CREATE UNIQUE INDEX IF NOT EXISTS idx_tickets_number ON public.tickets(ticket_number);
