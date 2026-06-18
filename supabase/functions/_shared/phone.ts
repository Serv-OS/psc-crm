// Phone-number variant generation for matching an inbound caller/texter against
// contacts (and tickets) that may be stored in different formats — US and UK.
//
// Returns FILTER-SAFE tokens only (digits / E.164 / national forms — no spaces,
// parentheses or commas) so they can be dropped straight into a PostgREST
// `.or(phone.eq.X,phone.eq.Y,...)` filter without breaking its grammar.
//
// Example: "+16503985153" -> ["+16503985153","16503985153","6503985153"]
//          so a contact stored as the bare 10-digit "6503985153" matches.
export function phoneVariants(input: string | null | undefined): string[] {
  const raw = (input || "").replace(/\s/g, "");
  if (!raw) return [];
  const set = new Set<string>();
  set.add(raw);

  const digits = raw.replace(/[^\d]/g, "");
  if (digits) set.add(digits);

  // US / NANP: +1XXXXXXXXXX, 1XXXXXXXXXX, or bare 10-digit XXXXXXXXXX
  let us = "";
  if (digits.length === 11 && digits.startsWith("1")) us = digits.slice(1);
  else if (digits.length === 10) us = digits;
  if (us.length === 10) {
    set.add(us);          // 6503985153
    set.add("1" + us);    // 16503985153
    set.add("+1" + us);   // +16503985153
  }

  // UK: +44 / 44 / leading-0 national
  if (raw.startsWith("+44")) {
    set.add("0" + raw.slice(3));
    set.add("44" + raw.slice(3));
    set.add(raw.slice(1)); // 44...
  }
  if (raw.startsWith("0") && digits.length >= 10) {
    set.add("+44" + raw.slice(1));
    set.add("44" + raw.slice(1));
  }
  if (digits.startsWith("44") && digits.length > 5) {
    set.add("+" + digits);
    set.add("0" + digits.slice(2));
  }

  return [...set];
}

// Last 10 digits of a number — the stable key for matching across formats.
// Used for a `like.*<last10>` filter, which matches "+16503985153",
// "16503985153" and "6503985153" alike WITHOUT a literal "+" (PostgREST
// mangles "+" inside an .or() string, so phone.eq.+1... never matches).
export function last10(input: string | null | undefined): string {
  return (input || "").replace(/\D/g, "").slice(-10);
}

// PostgREST .or() filter that matches any of the given columns ending in the
// caller's last 10 digits. Falls back to exact-variant matching for short
// inputs (e.g. short codes) that don't have 10 digits.
export function phoneMatchFilter(cols: string[], input: string | null | undefined): string {
  const d = last10(input);
  if (d.length >= 7) return cols.map((c) => `${c}.like.*${d}`).join(",");
  return phoneVariants(input).flatMap((p) => cols.map((c) => `${c}.eq.${p}`)).join(",");
}
