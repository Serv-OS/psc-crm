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

1. **Qualify.** Works through `chat_playbook.qualifying_questions`
   conversationally, one at a time — property type, replacing what, timeline,
   owner or not, town.
2. **Get to a square footage.** Asks if they know their wall area. Most people
   don't, and it says so rather than making them feel stupid. If they don't
   know, it points them at the **measuring tool** (`measure_tool_url`) and keeps
   talking. It will not guess, and it will not accept living-area square footage
   as wall area — those are very different numbers.
3. **Price it**, if it has a square footage → `estimate_project` → a range,
   explicitly framed as a guide subject to a site visit.
4. **Capture.** Asks for name, email and phone to send a written estimate and
   book the visit → `capture_lead`.

Capture happens **whether or not** there was a square footage. A lead we can
call is worth more than a tidy conversation.

---

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
| `supabase/functions/chat/index.ts` | The assistant. Tool loop, guardrails, hand-over |
| `supabase/functions/_shared/quoteEngine.ts` | TS port of the pricing engine |
| `supabase/functions/_shared/salesCapture.ts` | contact → property → lead → deal → draft quote |
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
