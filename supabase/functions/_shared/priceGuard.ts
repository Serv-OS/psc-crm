// The last line of defence on pricing.
//
// The sales assistant is told it may only ever repeat a figure that came back
// from the quote engine. Told is not the same as guaranteed, so before a reply
// is sent we check it for a money figure and, if the session has no engine-backed
// estimate behind it, the reply is replaced rather than sent.
//
// Tuned to catch what a bot would actually say to a homeowner — "around $28,000",
// "$25k to $30k", "roughly $18,500" — while ignoring the small change that turns
// up in ordinary sentences ("$0 down", "a $50 deposit") and bare numbers that are
// obviously not money (square footages, phone numbers, years).

/** The smallest dollar figure we treat as a project price rather than an aside. */
export const PRICE_FLOOR = 500;

/** Every money figure in the text, in dollars. "$25k" -> 25000. */
export function moneyFigures(text: string): number[] {
  const out: number[] = [];
  const re = /\$\s?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(k|m)?\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text || "")) !== null) {
    const n = parseFloat(m[1].replace(/,/g, ""));
    if (!Number.isFinite(n)) continue;
    const mult = (m[2] || "").toLowerCase() === "k" ? 1000 : (m[2] || "").toLowerCase() === "m" ? 1_000_000 : 1;
    out.push(n * mult);
  }
  return out;
}

/** Is this reply quoting a project price? */
export function mentionsPrice(text: string): boolean {
  return moneyFigures(text).some((n) => n >= PRICE_FLOOR);
}
