// Canonical Build Stage pipeline for the construction CRM.
// (Formerly the POS "onboarding" pipeline — the table/route ids stay `onboarding`
//  for compatibility, but every stage value + label lives here, in one place, so
//  the board, detail view, location card and reporting never drift apart again.)
//
// `key` is the value stored in onboardings.stage / stage_history — changing one
// here requires a data migration (see supabase/migrations/060_build_stages.sql).
export const BUILD_STAGES = [
  { key: 'pre_production',               label: 'Pre-Production / Handoff',     color: '#3b82f6' },
  { key: 'measure',                      label: 'Measure / Final Site Check',   color: '#6366f1' },
  { key: 'materials_ordered',            label: 'Materials Ordered',            color: '#8b5cf6' },
  { key: 'materials_delivery_scheduled', label: 'Materials Delivery Scheduled', color: '#a855f7' },
  { key: 'permits',                      label: 'Permits',                      color: '#d946ef' },
  { key: 'scheduled',                    label: 'Scheduled',                    color: '#E8743C' },
  { key: 'in_progress',                  label: 'In Progress',                  color: '#C75A29' },
  { key: 'final_inspection',             label: 'Final Inspection',             color: '#f59e0b' },
  { key: 'completed',                    label: 'Completed',                    color: '#10b981' },
  { key: 'final_payment',                label: 'Final Payment',                color: '#059669' },
  { key: 'closed_warranty',              label: 'Closed / Warranty',            color: '#948A7A' },
];

export const BUILD_STAGE_KEYS = BUILD_STAGES.map(s => s.key);
export const BUILD_STAGE_LABELS = Object.fromEntries(BUILD_STAGES.map(s => [s.key, s.label]));
export const FIRST_BUILD_STAGE = BUILD_STAGES[0].key; // 'pre_production'
