-- The pre-qualification script, as a staged interview the assistant works
-- through rather than a flat list of things to ask.
--
-- Stage 1 is required: a conversation with no contact details is a lost lead, so
-- it is captured early rather than at the end. Stages 2-4 qualify and are all
-- skippable — a visitor who won't answer must never be blocked. Stage 5 is the
-- conversion goal: every conversation ends by offering the free on-site estimate.
--
-- Replaces chat_playbook.qualifying_questions (flat, unstaged). Nothing is live
-- yet — no sites, no sessions — so this is a clean swap rather than a migration
-- of existing content.

alter table public.chat_playbook drop column if exists qualifying_questions;

alter table public.chat_playbook
  add column if not exists question_stages jsonb not null default '[]'::jsonb,
  -- Things the assistant STATES at the right moment. They were originally
  -- written as questions ("is a workmanship warranty important to you?"), which
  -- no customer answers no to — a leading question, not a qualifying one.
  add column if not exists talking_points jsonb not null default '[]'::jsonb,
  -- Contact details before anything else. The alternative (give the range, then
  -- ask) converts better on paper but loses the visitors who leave mid-answer.
  add column if not exists contact_first boolean not null default true,
  -- Always close on booking the estimate.
  add column if not exists booking_enabled boolean not null default true,
  -- A stated budget ceiling below this marks the lead as nurture rather than warm.
  add column if not exists nurture_budget_floor numeric not null default 5000;

update public.chat_playbook set
  question_stages = $json$[
    {
      "stage": 1,
      "title": "Contact & property",
      "required": true,
      "note": "Required. Capture early, before they drop off. If the address is outside the service area, say so kindly and stop.",
      "questions": [
        "Their name",
        "Best phone number and email address",
        "The address of the property (used to confirm it is in the service area)",
        "Whether they own the property — if a tenant or property manager, get the owner or decision maker's details too"
      ]
    },
    {
      "stage": 2,
      "title": "Project scope & condition",
      "required": false,
      "note": "Skippable. Offer the bracketed options when it helps them answer.",
      "questions": [
        "What is prompting them to look into new siding (visible damage or wear, appearance, preparing to sell, energy efficiency, an addition or remodel, other)",
        "Whether they have noticed damage — cracking, warping, rot, mold, or signs of water getting in",
        "Whether it is the whole home or specific areas — and if specific, which sides or sections",
        "Roughly how old the home is, and the current siding material if they know it (vinyl, wood, fiber cement, aluminum — 'not sure' is fine)",
        "Whether they would like insulation included in the quote",
        "Any other exterior items to look at while we are there — windows, doors, trim, gutters, repairs"
      ]
    },
    {
      "stage": 3,
      "title": "Timeline & budget",
      "required": false,
      "note": "Skippable. Budget is optional — if they would rather not say, move straight on.",
      "questions": [
        "When they would ideally like the project to start (as soon as possible, within 1-3 months, 3-6 months, just researching for now)",
        "Whether they have a budget range in mind — optional, never push",
        "Whether they would like information on financing options",
        "Whether this is a standalone project or part of a larger renovation — and if larger, what else needs coordinating"
      ]
    },
    {
      "stage": 4,
      "title": "Product preferences",
      "required": false,
      "note": "Skippable. Only ask the second question if they have shown interest in fiber cement or Hardie.",
      "questions": [
        "Whether they already have a brand or material in mind (James Hardie fiber cement, vinyl, other) or would like a recommendation at the estimate",
        "If fiber cement interests them: pre-painted ColorPlus or primed for paint, or would they like the difference explained"
      ]
    },
    {
      "stage": 5,
      "title": "Booking & wrap-up",
      "required": false,
      "note": "The conversion goal. Always offer the free on-site estimate before the conversation ends.",
      "questions": [
        "What days and times generally suit a free on-site estimate (days of the week, and morning, afternoon or evening)",
        "Anything else worth knowing before the visit — HOA requirements, gated access, dogs on the property, an insurance claim involved",
        "How they heard about us (search, referral, social media, saw our work locally, other)"
      ]
    }
  ]$json$::jsonb,
  talking_points = $json$[
    {"point": "Estimates are free and carry no obligation.", "when": "Whenever the estimate comes up, and when closing."},
    {"point": "Every installation carries our workmanship warranty on top of the manufacturer's warranty.", "when": "When quality, warranty or 'why you' comes up."},
    {"point": "Our installers are James Hardie certified.", "when": "Only when fiber cement or Hardie comes up."},
    {"point": "Financing is available if it would help.", "when": "Alongside the budget question, never as a hard sell."}
  ]$json$::jsonb,
  greeting = 'Hi — I can help you get a price for a siding project. What are you looking to get done?',
  tone = 'Warm and helpful, like a good estimator on the phone. You are here to help them, not to interrogate them.',
  updated_at = now()
where id = 1;

-- What the assistant established, so a rep can read the qualification without
-- reading the transcript, and so scoring can be recomputed if the rules change.
alter table public.chat_sessions
  add column if not exists lead_score text
    check (lead_score is null or lead_score in ('hot', 'warm', 'nurture', 'disqualify'));
