# Live instances

| Instance | Repo | Supabase ref | Region | Vercel | Notes |
|---|---|---|---|---|---|
| Posupject (dev/test) | Serv-OS/posupject | yuevuqvldtmjwwzjrddo | us-west-2 | posupject.vercel.app | Original build/test instance |
| POSUP CRM (production) | Serv-OS/posupcrm | xvtzxlyjasdmwxqchwmm | eu-west-2 (London) | posupcrm.vercel.app | Cloned 10 Jun 2026; blank data; schema verified at full parity (69 tables / 17 fns / 33 trigs / 136 policies / 269 constraints / 184 idx / 3 buckets / 11 storage policies / 2 cron) |

## POSUP CRM — remaining setup checklist
- [x] Vercel project from Serv-OS/posupcrm (env vars set; VITE_GOOGLE_CLIENT_ID still pending Google project)
- [x] Supabase Auth: Email OTP length = 6; Site URL = https://posupcrm.vercel.app
- [ ] Google Cloud project (consent Internal, scopes gmail.modify/send + calendar.events + chat.*, Chat app config, OAuth client w/ redirect to xvtzxlyjasdmwxqchwmm gmail-oauth-callback)
- [ ] Edge function secrets: GMAIL_CLIENT_ID/SECRET (APP_URL done)
- [x] Twilio: number +44 7428 700815 bought 11 Jun 2026 (same account as dev, own number); webhooks → posupcrm functions; TwiML app "POSUP CRM" AP7f89a86033f1efbcca75791e262e79b2; all 6 TWILIO_* secrets set; SMS verified end-to-end both directions (posupcrm ticket #1)
- [x] First owner login peter@posup.co.uk → profiles.role = 'owner'
- [ ] In-app: Branding, AI key, Stripe key, quote/invoice terms (Twilio number saved in Settings)

DB passwords: generated at creation, stored temporarily in /tmp on Peter's Mac
(posupcrm_dbpass.txt) — move to a password manager.
