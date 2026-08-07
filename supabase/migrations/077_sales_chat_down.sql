-- Reverses 077. Drops every conversation and everything the assistant was
-- taught. Leads, deals and quotes it created are NOT touched — they are normal
-- pipeline records by then and belong to sales.

drop function if exists public.kb_search(text, int);
drop table if exists public.chat_messages;
drop table if exists public.chat_sessions;
drop table if exists public.kb_docs;
drop table if exists public.chat_playbook;
drop table if exists public.chat_sites;
