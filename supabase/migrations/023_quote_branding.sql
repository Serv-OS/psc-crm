-- Migration 023: quote branding (seller/company info) + quote location link
ALTER TABLE public.support_settings ADD COLUMN IF NOT EXISTS business_name text;
ALTER TABLE public.support_settings ADD COLUMN IF NOT EXISTS business_address text;
ALTER TABLE public.support_settings ADD COLUMN IF NOT EXISTS business_email text;
ALTER TABLE public.support_settings ADD COLUMN IF NOT EXISTS business_phone text;
ALTER TABLE public.support_settings ADD COLUMN IF NOT EXISTS quote_accent text DEFAULT '#E8743C';

ALTER TABLE public.quotes ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES public.locations(id) ON DELETE SET NULL;
