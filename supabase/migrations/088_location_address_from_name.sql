-- 088_location_address_from_name.sql (safe to run twice)
--
-- Peter, 23 Nov 2026: "why is the address not populating in the address box".
-- New properties made from the lead form saved what was typed (the address)
-- only as the property NAME. 32 properties have an empty address and their
-- address in the name, so the address box showed -- and house research could
-- not run. The form now saves both; this fills in the ones already made.
-- Only touches properties with NO address whose name starts with a house number.

update public.locations
   set address = trim(name)
 where coalesce(trim(address), '') = ''
   and trim(name) ~ '^[0-9]+ ';

select count(*) as still_without_address from public.locations where coalesce(trim(address), '') = '';

-- ROLLBACK: not needed (it only fills empty boxes).
