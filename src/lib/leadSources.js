/* Where a PSC siding lead came from (20 Nov 2026).
 * The list used to be the restaurant CRM's (cold outreach, trade show, POS
 * review site). These are the places a homeowner finds a siding company.
 * Keys already on PSC leads (instant-quote, inbound_call, sales-chat...) are
 * kept so old leads still read properly. */
export const LEAD_SOURCES = [
  { key: 'instant-quote', label: 'Instant quote' },
  { key: 'website', label: 'Website' },
  { key: 'sales-chat', label: 'Website chat' },
  { key: 'inbound_call', label: 'Phone call' },
  { key: 'inbound_email', label: 'Email' },
  { key: 'referral', label: 'Referral' },
  { key: 'google', label: 'Google' },
  { key: 'yelp', label: 'Yelp' },
  { key: 'nextdoor', label: 'Nextdoor' },
  { key: 'houzz', label: 'Houzz' },
  { key: 'social', label: 'Social media' },
  { key: 'yard_sign', label: 'Yard sign' },
  { key: 'event', label: 'Home show or event' },
  { key: 'partner', label: 'Contractor or designer' },
  { key: 'other', label: 'Other' },
];

export function sourceLabel(key) {
  if (!key) return '';
  const hit = LEAD_SOURCES.find((s) => s.key === key);
  return hit ? hit.label : String(key).replace(/[_-]/g, ' ');
}

// The dropdown, keeping an old value that is no longer on the list so
// opening and saving a lead never wipes where it came from.
export function sourceOptions(current) {
  if (!current || LEAD_SOURCES.some((s) => s.key === current)) return LEAD_SOURCES;
  return [...LEAD_SOURCES, { key: current, label: sourceLabel(current) }];
}
