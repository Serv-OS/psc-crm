-- What the guide range actually covers, in the customer's words.
--
-- The assistant was quoting a range and calling it "just a guide" without ever
-- saying what was in it. On a $38,500 to $52,500 number that reads as a bare
-- price with unknown extras behind it, when in fact it is everything: materials,
-- stripping the old siding or stucco, permits, installation and waste removal.
--
-- Left null the assistant builds the list from the quote itself, so it only ever
-- claims the demolition that was actually priced. Set it and this wording wins.

alter table public.chat_playbook
  add column if not exists estimate_includes text;

update public.chat_playbook
   set estimate_includes = 'Everything: all materials, stripping and disposing of the existing siding or stucco, '
     || 'building permits, full installation by our own crews, and all waste removal. '
     || 'We handle the lot — there is nothing else for you to arrange or pay for.',
       updated_at = now()
 where id = 1 and estimate_includes is null;
