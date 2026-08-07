# Sales chat

A website assistant that qualifies an enquiry, prices it with the **real** quote
engine, and lands it in the pipeline as a lead → deal → draft quote.

It is not the posupcrm support bot with the words changed. There are no tickets
here. The outcome of a good conversation is a deal on a rep's desk.

---

## The one rule that shapes everything

**The model never produces a number.**

A sales bot that invents prices is worse than no sales bot: the figure a visitor
is told becomes the figure they expect, and every quote after it looks like a
bait-and-switch. So the assistant has no pricing knowledge at all. When it needs
a figure it calls a tool, the tool runs `quoteEngine` over the live
`quote_config_*` catalogue, and only a **widened range** comes back.

Three things enforce it, in order of how much they are trusted:

| Layer | What it does |
|---|---|
| Prompt | Told, at length, that it may only repeat what `estimate_project` returned |
| Tool boundary | Internal cost, markup and margin are never in the tool result — the model cannot leak what it never saw |
| Code | Before any reply is sent, `mentionsPrice()` checks it for a money figure. No engine-backed estimate on the session → the reply is **replaced**, not sent, and the incident is logged |

`src/lib/quoteEnginePort.test.mjs` proves the edge-function engine agrees with
`src/lib/quoteEngine.js` to the penny across six scenarios, so the website range
and the quote that follows come from identical math.
`src/lib/priceGuard.test.mjs` covers the guard.

---

## The conversation

A staged interview, worked through one question at a time, never as a form.
Editable in Settings → Sales chat.

| Stage | | |
|---|---|---|
| **1. Contact & property** | **Required** | Name, phone, email, address, do they own it. Captured **early**, not at the end — a conversation with no contact details is a lost lead. If the address is outside the service area it says so kindly and stops. |
| 2. Scope & condition | Skippable | Why now, damage or water, whole home or areas, home age, current material, insulation, other exterior work |
| 3. Timeline & budget | Skippable | Start timing, budget (optional, never pushed), financing, part of a bigger renovation |
| 4. Product | Skippable | Brand or material in mind; ColorPlus vs primed only if fiber cement came up |
| 5. Booking | The goal | Days and times for the free estimate, access notes, how they heard about us |

Square footage sits between stages 2 and 3: it asks whether they know their wall
area, says plainly that most people don't, and points anyone who doesn't at the
measuring tool. It will not guess, and will not take living area as wall area.

### Talking points, not questions

"Is a workmanship warranty important to you?" is a leading question no customer
answers no to. Four things are **stated** at the right moment instead, once each:
free no-obligation estimates, the workmanship warranty on top of the
manufacturer's, James Hardie certified installers (only when fiber cement comes
up), and financing (alongside the budget question).

### Saving as it goes

`capture_lead` is called as soon as there is a name and a contact, then **again
each time it learns something new** — the same record is updated, not duplicated.

That matters more than it sounds. In testing the bot saved Dave at message two,
and everything after — the water intrusion, the timeline, when he could meet —
never reached the CRM. A genuinely hot lead landed scored "nurture, no timeline
given". `enrichSalesLead` exists for exactly that.

Extraction is still the model's job and it will occasionally miss a field: it
told Dave it would note the side gate and the dogs, and didn't. So once a lead
exists the **whole transcript is mirrored onto it after every turn**. Nothing a
customer says can be lost, whether or not it was extracted into a field.

## Lead scoring

Decided by code (`_shared/leadScore.ts`), not re-judged by the model each time,
so a rep can trust what the flag means. Applied in this order:

| | |
|---|---|
| **Disqualify** | Outside the service area, or a renter with no owner contact. Lead recorded as `disqualified` with a reason, no deal, no quote |
| **Nurture** | A stated budget under the floor (default $5,000), just researching, or no timeline. `cold` / `new_lead` |
| **Hot** | Owner + damage or water + starting within 3 months + gave availability. `hot` / `qualified` |
| **Warm** | Everything else. `warm` / `qualified` |

Budget is checked **before** hot, deliberately. A test caught the opposite
order: water coming in, wanting to start tomorrow, budget $3,000 scored *hot*.
Urgency does not make an unaffordable job a rep's next call.

Availability becomes `next_action` ("Book the on-site estimate — they suggested
Tuesdays or Thursdays, morning"), and the motivation and damage become
`pain_points`.

## What lands in the CRM

`_shared/salesCapture.ts` performs the same sequence as the website
instant-quote form, so a rep cannot tell the two apart:

- **contact** — resolved on email, else created
- **location** — the property, status `prospect`
- **lead** — `new_lead`, then `qualified` once the deal exists
- **deal** — stage `estimate`, round-robin to the least loaded owner/editor
- **draft quote** — line items + `quote_estimates` breakdown, **only when a
  square footage was established**
- associations and `stage_history` throughout

Everything after the lead is best-effort: a failure building the quote never
costs us the lead.

> `instant-quote/index.ts` still carries its own inline copy of the engine. If
> that function is ever revisited it should import from `_shared/` instead.

---

## Pieces

| File | What |
|---|---|
| `supabase/migrations/077_sales_chat.sql` | `chat_sites`, `chat_playbook`, `chat_sessions`, `chat_messages`, `kb_docs`, `kb_search()`, RLS |
| `supabase/migrations/078_sales_chat_qualification.sql` | The staged script, talking points, scoring settings |
| `supabase/functions/_shared/leadScore.ts` | Hot / warm / nurture / disqualify, and the rep-facing summary |
| `supabase/functions/chat/index.ts` | The assistant. Tool loop, guardrails, hand-over |
| `supabase/functions/_shared/quoteEngine.ts` | TS port of the pricing engine |
| `supabase/functions/_shared/salesCapture.ts` | contact → property → lead → deal → draft quote, and enrichment |
| `supabase/functions/_shared/priceGuard.ts` | Is this reply quoting a price? |
| `supabase/functions/kb-learn/index.ts` | Teach it from a page or pasted notes |
| `public/chat.js` | The widget — dependency-free, shadow DOM |
| `public/sales-chat.html` | Always-open full page version |
| `src/components/crm/SalesChatCard.jsx` | Settings → Sales chat |

### Knowledge

`kb_docs` is what it may state as **fact**: process, materials, warranty,
service area. Anything not in there, it says it will have an estimator confirm.

`kb-learn` refuses to record prices — twice. The model is told not to, and then
anything with a `$`, a "per square foot" or a "starting from" is dropped on the
way in. A stale number in the knowledge base would get quoted at a customer.

### Safety net

Forbidden topics (`never_answer`) and urgent ones (`always_escalate`) are
keyword-matched **before the model is called at all**, whole-word so "lien"
cannot fire inside "client". Either one hands over. A hand-over still captures
whatever contact details exist, with the full transcript in the lead notes.

---

## Going live

1. Apply `077_sales_chat.sql` (needs a Supabase management token).
2. Deploy `chat` and `kb-learn`:
   ```
   SUPABASE_ACCESS_TOKEN=$(cat /tmp/sbtoken) npx -y supabase functions deploy chat --no-verify-jwt --project-ref xxazlzkhwraqfeqjzviz
   SUPABASE_ACCESS_TOKEN=$(cat /tmp/sbtoken) npx -y supabase functions deploy kb-learn --project-ref xxazlzkhwraqfeqjzviz
   ```
   `chat` **must** be `--no-verify-jwt` — it is called by anonymous visitors.
3. Settings → AI Assistant: Anthropic key present and enabled.
4. Settings → Sales chat: create an embed, set the allowed domains, set **Who
   you are**, **Service area** and the **Measuring tool link**, teach it a few
   pages, then turn it **On** (off by default on purpose).
5. Paste the snippet into the website.

## Then

- Watch the first dozen conversations under **Recent conversations** before
  trusting it unattended.
- SEA-CRM is a straight port once PSC is proven — same engine, same schema, its
  own catalogue and playbook.
