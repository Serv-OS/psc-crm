-- What it says once the enquiry is genuinely with an estimator.
--
-- The hand-over line was "We've covered plenty here — let me get a person to
-- pick this up properly", which leaves someone unsure whether anything actually
-- happened. By that point the lead is saved and assigned, so say so.

alter table public.chat_playbook
  add column if not exists handover_reply text;

update public.chat_playbook
   set handover_reply = 'Thanks — I''ve passed this through to one of our estimators, who will be in touch shortly.',
       updated_at = now()
 where id = 1 and handover_reply is null;
