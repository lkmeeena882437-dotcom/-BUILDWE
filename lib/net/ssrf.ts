/**
 * The guard in front of every server-side fetch of a URL somebody else chose.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * A link preview is, by definition, "the server, go fetch this address the user
 * pasted". That is the SSRF primitive: on cloud hosts the metadata service at
 * `169.254.169.254` answers without authentication and hands over temporary
 * credentials, and everything in `10/8`, `127/8`, `172.16/12`, `192.168/16`,
 * `fc00::/7` is a chance to read or poke an internal service through a product
 * feature that looks harmless. So the rule here is strict and the strictness is
 * the product: we fetch public web pages, on the two ports a browser would, and
 * nothing else.
 *
 * WHAT MAKES THIS MORE THAN A REGEX
 * ---------------------------------
 * - **Resolved addresses, not names.** `unsafe.example.com → 127.0.0.1` is a real
 *   attack (DNS pointing a public name at loopback), so after the name is
 *   syntactically fine, every answer it resolves to is checked. A literal IP is
 *   checked directly, and bracketed IPv6 too.
 * - **Every redirect hop.** `redirect: "manual"` with this function called per hop
 *   — `redirect: "follow"` would let an origin answer `302 → http://169.254.169.254/`
 *   and never show us the second URL. `lib/net/preview.ts` does the walk; a test
 *   proves the second hop is checked by letting the first one through and refusing
 *   the second.
 * - **Ports 80/443 or the default only.** A preview of `http://internal:6379/` is a
 *   Redis ping wearing a card UI.
 * - **No ambient credentials.** The fetch in `preview.ts` sends a User-Agent and an
 *   `Accept` header and nothing else: no `Authorization`, no cookie, not even when
 *   the target is the same origin as the app itself.
 *
 * THE ONE ESCAPE HATCH, AND ITS LIMITS
 * ------------------------------------
 * `allowHosts` bypasses the private-address check for the exact hostnames listed, and
 * `allowPorts` does the same for the one port a throwaway server is allowed to bind
 * (`tests/preview.mjs` cannot claim :80). No route ever passes either. They exist so that the real
 fetch/redirect/stream-cap/timeout code can be run against a *real* localhost server —
 * a test that mocked the transport would prove nothing about it. Anything that reaches a user
 * goes through `assertSafeUrl(url)` with the default options.
 */

import { promises as dns } from "node:dns";

export type GuardOptions = {
  /** Test-only. Exact hostnames allowed to resolve to private space. */
  allowHosts?: string[];
  /** Test-only. Exact ports a fixture may answer on - a test server cannot bind :80. */
  allowPorts?: string[];
  /** Injectable resolver, so "public name that points at loopback" is testable. */
  lookup?: (hostname: string) => Promise<{ address: string }[]>;
};

export type GuardErrorCode = "BAD_URL" | "BAD_SCHEME" | "BAD_PORT" | "NO_HOST" | "UNRESOLVED" | "PRIVATE_TARGET";

export class UnsafeUrlError extends Error {
  code: GuardErrorCode;
  constructor(code: GuardErrorCode, message: string) {
    super(message);
    this.name = "UnsafeUrlError";
    this.code = code;
  }
}

/** Only what a browser preview needs. Everything else (file, data, gopher, unix…) is refused. */
const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);
/** Explicit ports we will touch. An omitted port uses the protocol's own default. */
const ALLOWED_PORTS = new Set(["80", "443"]);

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata",
  "metadata.google.internal",
  "instance-data",
  "local",
  "ip6-localhost",
]);

/**
 * IPv4 → is this address in a range that must never be fetched? Written against
 * dotted-quad octets rather than a regex so `010.1.1.1` and other decimal/hex
 * aliases can't sneak past a string pattern.
 */
export function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".");
  if (parts.length !== 4) return true; // not a usable literal — refuse rather than guess
  const n = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : NaN));
  if (n.some((x) => !Number.isFinite(x) || x < 0 || x > 255)) return true;
  const [a, b] = n as [number, number, number, number];
  if (a === 0) return true; // 0.0.0.0/8 "this network"
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true; // link-local, incl. the cloud metadata IP
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT / carrier NAT, often a router
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 192 && b === 0) return true; // 192.0.0.0/24 (IETF protocol assignments)
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a >= 224) return true; // multicast + reserved
  return false;
}

/**
 * IPv6: loopback, unspecified, link-local, unique-local, multicast, and the
 * v4-mapped forms (which are how `::ffff:127.0.0.1` gets you to loopback past a
 * naive check). Zone ids (`fe80::1%eth0`) are dropped before comparing.
 */
/**
 * The IPv4 address an IPv6 form is standing in for, if any.
 *
 * Both spellings have to be handled, because the URL parser normalises one into the
 * other: `::ffff:127.0.0.1` is rewritten by WHATWG parsing to `::ffff:7f00:1`, which
 * no longer *looks* like an IPv4 address at all. Missing that is the classic way a
 * loopback check is walked straight past.
 */
export function embeddedIPv4(ip: string): string | null {
  const v = ip.toLowerCase().split("%")[0];
  const dotted = v.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (dotted) return dotted[1];
  const hex = v.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex) {
    const hi = parseInt(hex[1], 16);
    const lo = parseInt(hex[2], 16);
    return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  }
  return null;
}

export function isPrivateIPv6(ip: string): boolean {
  const v = ip.toLowerCase().split("%")[0];
  if (!v) return true;
  if (v === "::1" || v === "::") return true;
  // v4-mapped / v4-compatible: hand the embedded address to the IPv4 rules.
  const inner = embeddedIPv4(v);
  if (inner) return isPrivateIPv4(inner);
  const head = v.split(":")[0] || "";
  if (head.startsWith("fe8") || head.startsWith("fe9") || head.startsWith("fea") || head.startsWith("feb")) return true; // fe80::/10
  if (head.startsWith("fc") || head.startsWith("fd")) return true; // fc00::/7 unique-local
  if (head.startsWith("ff")) return true; // multicast
  return false;
}

export function isPrivateAddress(ip: string): boolean {
  return ip.includes(":") ? isPrivateIPv6(ip) : isPrivateIPv4(ip);
}

/** Strip the brackets a URL puts around IPv6 literals, so the range checks see an address. */
function bareHost(hostname: string): string {
  const h = hostname.toLowerCase().replace(/\.$/, "");
  return h.startsWith("[") && h.endsWith("]") ? h.slice(1, -1) : h;
}

/**
 * Returns the parsed URL when it is safe to fetch, or throws `UnsafeUrlError` with a
 * code the route can pass through. `error` messages are written to be shown to a
 * person: they name the rule, not the internals.
 */
export async function assertSafeUrl(raw: string, opts: GuardOptions = {}): Promise<{ url: URL; host: string }> {
  const trimmed = String(raw || "").trim();
  if (!trimmed) throw new UnsafeUrlError("BAD_URL", "No URL was given.");
  if (trimmed.length > 2048) throw new UnsafeUrlError("BAD_URL", "That URL is too long to preview.");

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new UnsafeUrlError("BAD_URL", "That is not a URL this server can read.");
  }
  // `//host/path` and `\` tricks die here: no protocol means no fetch.
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw new UnsafeUrlError("BAD_SCHEME", "Only http and https links can be previewed.");
  }
  const host = bareHost(url.hostname);
  if (!host) throw new UnsafeUrlError("NO_HOST", "That URL has no host to fetch.");
  if (url.username || url.password) {
    throw new UnsafeUrlError("BAD_URL", "Credentials in a URL are not allowed here.");
  }
  // The one test-only widening (see the note at the top of this file), defined first
  // because every address rule below has to remember it.
  const isBlocked = (ip: string) => !opts.allowHosts?.includes(host) && isPrivateAddress(ip);
  // Address rules FIRST, the port rule second — deliberately. `http://127.1.2.3:8080/`
  // is an attempt at an internal host, and answering it with "only 80 and 443" both
  // hides the reason and invites a retry on port 80. A public host on 6379 is still
  // refused here, before we spend a DNS lookup on it.
  if (BLOCKED_HOSTNAMES.has(host)) {
    throw new UnsafeUrlError("PRIVATE_TARGET", INTERNAL_MSG);
  }
  // A single-label name (`docker`, `router`) is not a public website either way.
  if (!host.includes(".") && !host.includes(":")) {
    throw new UnsafeUrlError("PRIVATE_TARGET", INTERNAL_MSG);
  }
  // A literal address is decided in full right here: no DNS involved, and the
  // "is this even a valid address" question is answered by the same range function the
  // resolved path uses (which is also what catches `::ffff:7f00:1`).
  const isIpLiteral = host.includes(":") || /^\d+\.\d+\.\d+\.\d+$/.test(host);
  if (isIpLiteral && isBlocked(host)) throw new UnsafeUrlError("PRIVATE_TARGET", PRIVATE_MSG);
  if (url.port && !ALLOWED_PORTS.has(url.port) && !opts.allowPorts?.includes(url.port)) {
    throw new UnsafeUrlError("BAD_PORT", "Only standard web ports (80 and 443) can be previewed.");
  }

  let answers: { address: string }[];
  if (isIpLiteral) return { url, host }; // refused or allowed above
  try {
    // `verbatim: true` matters: without it Node may hand back a v4-mapped v6 form
    // and the range checks would be looking at a different spelling of the address.
    answers = opts.lookup ? await opts.lookup(host) : await dns.lookup(host, { all: true, verbatim: true });
  } catch {
    throw new UnsafeUrlError("UNRESOLVED", "That host could not be looked up.");
  }
  if (!answers.length) throw new UnsafeUrlError("UNRESOLVED", "That host has no address to fetch.");
  for (const a of answers) {
    if (isBlocked(a.address)) throw new UnsafeUrlError("PRIVATE_TARGET", PRIVATE_MSG);
  }
  // A public name that resolves publicly is still only ever fetched over http(s),
  // and the caller re-runs this whole function for every redirect hop it follows.
  return { url, host };
}

const PRIVATE_MSG = "That link points somewhere private, and BUILDWE will not fetch it for you.";
const INTERNAL_MSG = "That address is internal to this machine or network, so BUILDWE will not fetch it.";
