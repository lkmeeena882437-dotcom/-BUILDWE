/**
 * Money, printed the same way everywhere.
 *
 * A separate module because this rule is needed on both sides of the wire: the order
 * endpoint stamps it onto responses, and /pricing has to draw `unit × seats` before any
 * order exists. It used to be a ternary copy-pasted into three files, which is exactly how
 * a page ends up showing ₹500 for a product the gateway was told to charge ₹499 for.
 * This file imports nothing, so a client component can use it without pulling the
 * payment module (and Node's `crypto`) into the browser bundle.
 */
export function formatPaise(paise: number, currency: string): string {
  const n = Math.max(0, Math.floor(paise));
  return currency === "INR" ? `\u20b9${(n / 100).toFixed(0)}` : `$${(n / 100).toFixed(2)}`;
}

/** "₹99 for 100 credits" — same rule, both numbers supplied by the server. */
export function packPhrase(paise: number, credits: number, currency: string): string {
  return `${formatPaise(paise, currency)} for ${credits} credits`;
}
