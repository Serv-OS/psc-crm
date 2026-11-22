/* Financing through Enhancify (Peter, 22 Nov 2026). Same figures and link as
 * the website (psc-website src/lib/financing.ts); keep the two in step. */

export const ENHANCIFY_URL = 'https://www.enhancify.com/peninsula-siding-company';

export function applyUrl(place) {
  const u = new URL(ENHANCIFY_URL);
  u.searchParams.set('utm_source', 'psc-crm');
  u.searchParams.set('utm_medium', 'quote');
  u.searchParams.set('utm_campaign', 'financing');
  if (place) u.searchParams.set('utm_content', place);
  return u.toString();
}

// The example used for "about $X a month". US law: a monthly figure is only
// shown with the APR and term that made it and "depends on your credit".
export const EXAMPLE_APR = 9.99;
export const EXAMPLE_YEARS = 10;
export const LOWEST_APR = 7.99;

export function monthlyPayment(amount, apr = EXAMPLE_APR, years = EXAMPLE_YEARS) {
  const n = Math.max(1, Math.round(years * 12));
  if (!(amount > 0)) return 0;
  const r = apr / 100 / 12;
  if (r <= 0) return amount / n;
  return (amount * r) / (1 - Math.pow(1 + r, -n));
}

export const LEAD_FINANCING = [
  { key: 'yes', label: 'Interested' },
  { key: 'maybe', label: 'Maybe' },
  { key: 'no', label: 'Not needed' },
];
export const leadFinancingLabel = (k) => LEAD_FINANCING.find((o) => o.key === k)?.label || '';

export const DEAL_FINANCING = [
  { key: 'interested', label: 'Interested' },
  { key: 'applied', label: 'Applied' },
  { key: 'approved', label: 'Approved' },
  { key: 'funded', label: 'Funded' },
  { key: 'declined', label: 'Declined' },
  { key: 'not_needed', label: 'Not needed' },
];
