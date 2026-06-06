-- Toggle: include the company logo in the user's email signature.
alter table public.profiles add column if not exists email_signature_logo boolean default false;
