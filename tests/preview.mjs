/**
 * Step 8: rich link previews — the parser, the guard, the cache, the route.
 *
 * WHAT IS PROVEN HERE, AND HOW
 * ----------------------------
 * Four layers, each tested at the layer where it actually runs:
 *
 * 1. `lib/net/ssrf.ts` — compiled and called directly, including an injected DNS
 *    resolver, so "a public name that points at loopback" is a real assertion and not
 *    a comment.
 * 2. `lib/net/htmlMeta.ts` + `lib/net/urls.ts` — pure functions, run on real HTML and
 *    real markdown.
 * 3. `lib/net/preview.ts` — the fetch itself, against a real localhost HTTP server we
 *    own: redirect walking, per-hop re-validation, the byte cap while streaming, the
 *    timeout, content-type and status handling. Nothing is mocked: a mocked
 *    transport would prove nothing about `redirect: "manual"`.
 * 4. `GET /api/preview` — over real HTTP against a booted app, so the limiter, the
 *    cache, the guest path, and — the point of the step — the refusal of internal
 *    addresses are exercised the way a browser would exercise them.
 *
 * THE SANDBOX LIMIT, STATED RATHER THAN PAPERED OVER
 * --------------------------------------------------
 * This environment has no outbound internet. So a *successful* public fetch cannot
 * be observed here: `https://example.com/` is answered with a coded failure. That is
 * the assertion — the route reports what really happened instead of inventing a card.
 * A public-site preview needs one run on a machine with egress, and the fixture server
 * in the middle of this file is what makes everything except DNS-to-a-real-host
 * verifiable offline.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { newJar, report, req, run, startServer } from "./harness.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const PORT = 3346;
const src = (p) => readFileSync(path.join(ROOT, p), "utf8");
/** Comment-stripped source: a comment naming a banned pattern is evidence of the fix, not a regression. */
const codeOnly = (s) =>
  s
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*|\/\*|\/\*\*)/.test(l))
    .join("\n");

/* ── the real modules, compiled from source ────────────────────────────── */

const outDir = mkdtempSync(path.join(tmpdir(), "bw-preview-"));
const MODULES = ["lib/net/ssrf.ts", "lib/net/htmlMeta.ts", "lib/net/urls.ts", "lib/net/preview.ts"];
try {
  execFileSync(
    "npx",
    [
      "tsc",
      ...MODULES.map((m) => path.join(ROOT, m)),
      "--outDir",
      outDir,
      "--target",
      "es2022",
      // CommonJS on purpose: the emitted relative imports are extensionless
      // (`from "./ssrf"`), which Node's ESM loader refuses. `require` resolves them.
      "--module",
      "commonjs",
      "--moduleResolution",
      "node",
      "--esModuleInterop",
      "--skipLibCheck",
      "--strict",
    ],
    { cwd: ROOT, stdio: "pipe" }
  );
} catch (e) {
  console.error("could not compile lib/net modules\n", e.stdout?.toString(), e.stderr?.toString());
  process.exit(1);
}
for (const m of MODULES) {
  const emitted = path.join(outDir, path.basename(m).replace(/\.ts$/, ".js"));
  if (!existsSync(emitted)) {
    console.error(`tsc produced no ${emitted}`);
    process.exit(1);
  }
}
const load = createRequire(path.join(outDir, "probe.cjs"));
const { assertSafeUrl, isPrivateAddress, UnsafeUrlError } = load("./ssrf.js");
const { parseHtmlMeta } = load("./htmlMeta.js");
const { extractPreviewUrls, normalizePreviewUrl, isPrivateHost, MAX_PREVIEW_CARDS } = load("./urls.js");
const { readLinkPreview } = load("./preview.js");

/** The app server boots while the unit checks run — cold `next dev` is the slow part. */
const srvPromise = startServer({ port: PORT, label: "bw-preview" });
srvPromise.catch(() => {});

/** @returns {Promise<Error|null>} the refusal, so a single `await` reads as an assertion. */
async function refusal(raw, opts) {
  try {
    await assertSafeUrl(raw, opts);
    return null;
  } catch (e) {
    return e;
  }
}
async function allowed(raw, opts) {
  const out = await assertSafeUrl(raw, opts);
  assert.ok(out.url instanceof URL, `${raw} should return a parsed URL`);
  return out;
}

await run("guard: only http(s) on standard ports, and no credentials in the URL", async () => {
  for (const bad of [
    "file:///etc/passwd",
    "javascript:alert(1)",
    "data:text/html,<script>1</script>",
    "gopher://127.0.0.1:70/gopher/INDEX",
    "ftp://example.com/pub/",
    "http://example.com:6379/",
    "http://example.com:22/",
    "https://example.com:8443/",
    "http://user:pass@example.com/",
    "not a url",
    "//example.com/x",
  ]) {
    const e = await refusal(bad);
    assert.ok(e instanceof UnsafeUrlError, `refused with a typed error: ${bad}`);
    assert.ok(
      ["BAD_URL", "BAD_SCHEME", "BAD_PORT"].includes(e.code),
      `${bad} -> ${e.code} (want a format/scheme/port refusal)`
    );
  }
  assert.equal((await allowed("http://example.com/")).url.pathname, "/");
  assert.equal((await allowed("https://example.com:443/x")).url.port, "", "an explicit default port is fine");
  assert.ok((await allowed("http://example.com:80/")).url.port === "", "port 80 on http is the default, not an oddity");
});

await run("guard: loopback, RFC1918, link-local (incl. the cloud metadata IP), CGNAT, multicast", async () => {
  const blocked = [
    "http://127.0.0.1/",
    "http://127.1.2.3:8080/",
    "http://169.254.169.254/latest/meta-data/iam/security-credentials/",
    "http://169.254.170.23/v2/credentials",
    "http://10.1.2.3/",
    "http://172.16.0.1/",
    "http://172.31.255.255/",
    "http://192.168.1.1/admin",
    "http://100.64.0.1/",
    "http://0.0.0.0/",
    "http://224.0.0.1/",
    "http://localhost:3000/api/preview",
    "http://LOCALHOST./",
    "http://metadata.google.internal/computeMetadata/v1/",
    "http://[::1]/",
    "http://[::ffff:127.0.0.1]/",
    "http://[fe80::1]/",
    "http://[fd00::1234]/",
    "http://[ff02::2]/",
    // odd but valid spellings of the same loopback — a regex would miss these
    "http://0177.0.0.1/",
    "http://2130706433/",
    "http://127.1/",
  ];
  for (const raw of blocked) {
    const e = await refusal(raw);
    assert.ok(e instanceof UnsafeUrlError, `refused: ${raw}`);
    assert.equal(e.code, "PRIVATE_TARGET", `${raw} -> ${e.code}`);
  }
  // A single-label name (`router`, `db`) is not a website either.
  assert.equal((await refusal("http://router/config")).code, "PRIVATE_TARGET");
});

await run("guard: a PUBLIC name that resolves to a private address is still refused", async () => {
  // This is the case a hostname allowlist cannot catch, so it gets its own check:
  // the name is normal, the answer is loopback.
  // And the spelling the URL parser *rewrites* to, which is where a naive
  // v4-mapped check dies: `new URL("http://[::ffff:127.0.0.1]/").hostname` comes back
  // as `[::ffff:7f00:1]`, no longer recognisable as an IPv4 address by eye.
  assert.equal(isPrivateAddress("::ffff:7f00:1"), true, "loopback, in the form the parser hands us");
  assert.equal(isPrivateAddress("::ffff:6440:1"), true, "100.64.0.1 (CGNAT) in hex form");
  assert.equal(isPrivateAddress("::ffff:6404:1"), false, "100.4.0.1 is outside CGNAT: a range, not a prefix match");
  for (const addr of ["127.0.0.1", "::1", "100.64.1.1", "169.254.169.254", "fd12::9"]) {
    const e = await refusal("http://public-looking.example/robots.txt", {
      lookup: async () => [{ address: addr, family: addr.includes(":") ? 6 : 4 }],
    });
    assert.equal(e?.code, "PRIVATE_TARGET", `${addr} behind a public name -> ${e?.code}`);
    assert.match(e.message, /private/i, "the person is told the reason, in plain words");
  }
  // Two answers, one good and one loopback, is still refused: we do not get to pick a
  // lucky address to connect to.
  const mixed = await refusal("http://split-horizon.example/", {
    lookup: async () => [{ address: "93.184.216.34" }, { address: "127.0.0.1" }],
  });
  assert.equal(mixed?.code, "PRIVATE_TARGET", "any private answer fails the whole URL");
  // And the same host with a public answer is allowed — the guard is not "refuse everything".
  await allowed("http://well-configured.example/", { lookup: async () => [{ address: "93.184.216.34" }] });
});

await run("guard: isPrivateAddress is the single owner of the ranges", async () => {
  for (const ip of ["127.0.0.1", "10.0.0.5", "172.16.9.9", "192.168.0.1", "169.254.1.1", "0.0.0.0", "::1", "fe80::1", "fc00::1", "::ffff:10.1.2.3"]) {
    assert.equal(isPrivateAddress(ip), true, `${ip} is private`);
  }
  for (const ip of ["93.184.216.34", "8.8.8.8", "2606:2800:220:1:248:1893:25c8:1946"]) {
    assert.equal(isPrivateAddress(ip), false, `${ip} is public`);
  }
  // Garbage is treated as private, i.e. refused, not fetched and not explained.
  assert.equal(isPrivateAddress("1.2.3"), true);
  assert.equal(isPrivateAddress("999.1.1.1"), true);
});

/* ── the parser ────────────────────────────────────────────────────────── */

await run("parser: og:/twitter:/title precedence, entities, and metadata after </head> ignored", async () => {
  const html = [
    "<!doctype html><html><head>",
    "<title>fallback title</title>",
    '<meta property="og:site_name" content="The Test Press">',
    '<meta name="description" content="the plain one">',
    '<meta property="og:title" content="Buildwe &amp; the whole &lt;title&gt; business">',
    '<meta property="og:description" content="OG says: <b>real</b> facts &amp; figures">',
    "</head><body>",
    '<div><meta property="og:title" content="BODY HIJACK"></div>',
    "</body></html>",
  ].join("");
  const m = parseHtmlMeta(html, "https://press.example/story");
  assert.equal(m.siteName, "The Test Press");
  assert.equal(m.title, "Buildwe & the whole <title> business", "entities decode, and a tag-looking title survives as text");
  assert.equal(m.description, "OG says: real facts & figures", "og:description beats the plain one; its raw markup is stripped");
  assert.doesNotMatch(m.title, /BODY HIJACK/, "the body is not our scan region");
  assert.equal(m.foundAny, true);

  // First og:title wins, and a quoted `>` inside content does not truncate the tag.
  const twice = parseHtmlMeta(
    '<html><head><meta property="og:title" content="First"><meta property="og:title" content="Second"><meta property="og:description" content="more than 5 > 3 and fine"></head></html>',
    "https://a.example/"
  );
  assert.equal(twice.title, "First");
  assert.equal(twice.description, "more than 5 > 3 and fine");
});

await run("parser: nothing is invented, and the image is absolutised only for http(s)", async () => {
  const empty = parseHtmlMeta("<html><head><title>   </title></head><body>hi</body></html>", "https://a.example/");
  assert.equal(empty.foundAny, false, "a blank title is not a title");
  assert.equal(empty.title, undefined, "and must not become an empty string the card has to special-case");

  const m = parseHtmlMeta(
    '<html><head><meta property="og:image" content="/pics/a.png"><meta property="og:url" content="canonical/"></head></html>',
    "https://a.example/deep/page?x=1"
  );
  assert.equal(m.imageUrl, "https://a.example/pics/a.png", "a root-relative og:image is resolved against the page");
  assert.equal(m.canonical, "https://a.example/deep/canonical/");

  const evil = parseHtmlMeta(
    '<html><head><meta property="og:image" content="javascript:alert(1)"><meta property="og:title" content="ok"></head></html>',
    "https://a.example/"
  );
  assert.equal(evil.imageUrl, undefined, "a javascript: og:image is dropped, not sanitised into something else");

  const noBase = parseHtmlMeta('<html><head><meta property="og:image" content="https://cdn.example/x.jpg"><meta property="og:image" content="http://cdn.example/x.jpg"><meta property="og:title" content="t">', undefined);
  assert.equal(noBase.imageUrl, "https://cdn.example/x.jpg", "without a base, only absolute http(s) counts");
  assert.ok(
    src("lib/net/preview.ts").includes("if (imageHost !== safe.host.toLowerCase()) delete meta.imageUrl;"),
    "and a cross-host image is dropped before it can make the reader's browser call a third party"
  );
});

/* ── which links become cards ──────────────────────────────────────────── */

await run("urls: fences are not links, one link is one card, and there is a cap", async () => {
  const text = [
    "See [the docs](https://a.example/docs) and also https://b.example/x.",
    "",
    "```js",
    "const u = \"https://evil.example/inside-a-fence\";",
    "```",
    "",
    "Inline `https://evil.example/inside-code` stays text.",
    "Again: [the docs](https://a.example/docs#top) and <https://c.example/y>.",
    "Trailing punctuation: https://d.example/z.",
    "https://e.example/1 https://f.example/2 https://g.example/3",
  ].join("\n");
  const urls = extractPreviewUrls(text, 50);
  assert.ok(urls.includes("https://a.example/docs"), "a markdown link's target is the link");
  assert.ok(urls.includes("https://b.example/x"), "bare urls count");
  assert.ok(urls.includes("https://c.example/y"), "angle-bracket autolinks count");
  assert.ok(urls.includes("https://d.example/z"), "a full stop at the end is not part of the URL");
  assert.ok(!urls.some((u) => u.includes("evil.example")), "code fences and inline code are skipped");
  assert.equal(urls.filter((u) => u === "https://a.example/docs").length, 1, "the #fragment is dropped, so it dedupes with the first mention");
  assert.ok(!urls.some((u) => u.includes("/inside-code")), "inline code skipped");
  assert.equal(extractPreviewUrls(text).length, MAX_PREVIEW_CARDS, "three cards per message, by default");
  assert.equal(extractPreviewUrls(text, 2).length, 2, "and the caller can ask for fewer");
});

await run("urls: one canonical spelling per link, and no policy smuggled in", async () => {
  assert.equal(normalizePreviewUrl("https://Example.COM/x#frag"), "https://example.com/x", "host lowercased, fragment dropped");
  assert.equal(normalizePreviewUrl("https://example.com:443/x"), "https://example.com/x", "default port removed");
  assert.equal(normalizePreviewUrl("http://example.com:80/"), "http://example.com/");
  assert.equal(normalizePreviewUrl("https://example.com:8443/x"), "https://example.com:8443/x", "a non-default port is part of the link");
  assert.equal(
    normalizePreviewUrl("https://example.com/s?b=2&a=1&c=x%2Fy&a=0"),
    "https://example.com/s?a=0&a=1&b=2&c=x%2Fy",
    "params (and repeated keys) sorted for a stable cache key; VALUES STILL ENCODED so %2F cannot turn into /"
  );
  assert.equal(normalizePreviewUrl("https://example.com/index.html"), "https://example.com/");
  assert.equal(normalizePreviewUrl("javascript:alert(1)"), null);
  assert.equal(normalizePreviewUrl("/relative/only"), null);
  assert.equal(
    normalizePreviewUrl("https://user:pass@example.com/"),
    "https://user:pass@example.com/",
    "the normaliser keeps the link as written and does NOT decide policy - the guard refuses credentials, so that refusal is stated once"
  );
  // The client-side skip-list is for experience, not security; assert it covers the
  // hosts that would otherwise make a reader wait 8 seconds to see nothing.
  for (const h of ["localhost", "127.0.0.1", "::1", "10.1.1.1", "192.168.0.9", "169.254.169.254", "router", "db.internal"]) {
    assert.equal(isPrivateHost(h), true, `${h} is skipped client-side`);
  }
  for (const h of ["example.com", "8.8.8.8", "www.bbc.co.uk"]) {
    assert.equal(isPrivateHost(h), false, `${h} is a real link`);
  }
  assert.equal(extractPreviewUrls("try http://127.0.0.1:3000/admin").length, 0, "so no request is even attempted");
  // Sources chips already carry these links, so they must not become cards too — and
  // the exclusion has to see through the spellings (fragment, www, default port).
  const withSources = "Read [the docs](https://a.example/docs) and https://b.example/x";
  assert.deepEqual(extractPreviewUrls(withSources, 3, ["https://a.example/docs#section"]), ["https://b.example/x"]);
  assert.deepEqual(extractPreviewUrls(withSources, 3, []), ["https://a.example/docs", "https://b.example/x"]);
  assert.deepEqual(
    extractPreviewUrls("x https://c.example/1 https://d.example/2 https://e.example/3 https://f.example/4", 3, ["https://c.example/1"]),
    ["https://d.example/2", "https://e.example/3", "https://f.example/4"],
    "skipping one still fills all three slots"
  );
});

/* ── the fetch, against a real server we own ───────────────────────────── */

const BODY_HIJACK = '<div><meta property="og:title" content="BODY HIJACK"></div>';
const OG_HTML = [
  "<!doctype html><html><head><title>fallback</title>",
  '<meta property="og:title" content="The one with a > sign and &amp; an entity">',
  '<meta property="og:description" content="described">',
  '<meta property="og:image" content="/pic.png">',
  "</head><body>",
  BODY_HIJACK,
  "</body></html>",
].join("\n");

const timers = new Set();
const fixture = http.createServer((rq, rs) => {
  const u = new URL(rq.url, "http://127.0.0.1");
  const send = (code, type, body, extra = {}) => {
    rs.writeHead(code, { "content-type": type, ...extra });
    rs.end(body);
  };
  switch (u.pathname) {
    case "/og":
      return send(200, "text/html; charset=utf-8", OG_HTML);
    case "/cross":
      return send(
        200,
        "text/html",
        '<html><head><meta property="og:title" content="Cross-host picture"><meta property="og:image" content="http://cdn.other.invalid:9/pic.png"></head></html>'
      );
    case "/chain":
      rs.writeHead(302, { location: "/chain2" });
      return rs.end();
    case "/chain2":
      rs.writeHead(302, { location: "/og" });
      return rs.end();
    case "/evil":
      rs.writeHead(302, { location: "http://169.254.169.254/latest/meta-data/" });
      return rs.end();
    case "/loop":
      rs.writeHead(302, { location: "/loop" });
      return rs.end();
    case "/noloc":
      rs.writeHead(302, {});
      return rs.end();
    case "/bare":
      return send(200, "text/html", "<html><head><title> </title></head><body>no metadata here</body></html>");
    case "/notfound":
      return send(404, "text/html", "<html><head><title>404</title></head></html>");
    case "/text":
      return send(200, "text/plain", '<meta property="og:title" content="plain text">');
    case "/huge":
      return send(200, "text/html", `<html><head><meta property="og:title" content="${"x".repeat(400_000)}">`);
    case "/long":
      // No Content-Length at all: the cap has to be enforced while reading.
      rs.writeHead(200, { "content-type": "text/html" });
      rs.write("<html><head><meta property=\"og:title\" content=\"");
      for (let i = 0; i < 200; i++) rs.write("abcdefghij");
      return rs.end('">');
    case "/slow": {
      const t = setTimeout(() => send(200, "text/html", OG_HTML), 30_000);
      t.unref?.();
      timers.add(t);
      rq.on("close", () => clearTimeout(t));
      return;
    }
    case "/drop":
      rs.socket.destroy(); // no response at all: the socket is the answer
      return;
    default:
      return send(404, "text/plain", "no such fixture");
  }
});
await new Promise((r) => fixture.listen(0, "127.0.0.1", r));
const FPORT = fixture.address().port;
const F = (p) => `http://127.0.0.1:${FPORT}${p}`;
/** The test-only seam: let the fixture's own loopback through, so the fetch code runs for real. */
const SEAM = { guard: { allowHosts: ["127.0.0.1"], allowPorts: [String(FPORT)] } };

await run("fetch: the fixture is only reachable through the test-only seam", async () => {
  const strict = await readLinkPreview(F("/og"));
  assert.equal(strict.ok, false, "with no seam, the fixture is refused — the same code the route runs");
  assert.ok(
    ["PRIVATE_TARGET", "BAD_PORT"].includes(strict.code),
    `the refusal came from the guard, got ${strict.code}`
  );
  // The port rule fires first on a fixture URL, so the loopback half of that claim is
  // made where it can be made cleanly: an address with no explicit port at all.
  const strictNoPort = await readLinkPreview("http://127.0.0.1/og");
  assert.equal(strictNoPort.code, "PRIVATE_TARGET", "same host, default port: the address itself is what was refused");
  const seam = await readLinkPreview(F("/og"), SEAM);
  assert.equal(seam.ok, true, `with the seam, it reads: ${seam.code || ""}`);
  assert.equal(seam.meta.title, "The one with a > sign and & an entity", "a quoted > does not truncate the tag, and &amp; decodes");
  assert.equal(seam.host, "127.0.0.1");
  assert.match(seam.meta.imageUrl, new RegExp(`^http://127\\.0\\.0\\.1:${FPORT}/pic\\.png$`), "same-host image kept");
  // No route passes either half of the seam, and no other app file does either.
  for (const f of ["app/api/preview/route.ts", "lib/net/preview.ts", "app/api/ai/search/route.ts", "app/page.tsx"]) {
    assert.equal(/allowHosts|allowPorts/.test(codeOnly(src(f))), false, `${f} never widens the seam`);
  }
});

await run("fetch: redirects are followed hop by hop and re-checked at every one", async () => {
  const chain = await readLinkPreview(F("/chain"), SEAM);
  assert.equal(chain.ok, true, `two hops, then metadata: ${chain.code || ""}`);
  assert.equal(chain.url, F("/og"), "the card reports where the chain actually ended");

  // The attack this exists for: the first hop is allowed by the seam, the second is
  // the metadata service. `redirect: "follow"` would have fetched it already.
  const evil = await readLinkPreview(F("/evil"), SEAM);
  assert.equal(evil.ok, false);
  assert.equal(evil.code, "PRIVATE_TARGET", "hop 2 is refused even though hop 1 was fine");

  const loop = await readLinkPreview(F("/loop"), SEAM);
  assert.equal(loop.code, "TOO_MANY_REDIRECTS", "a self-redirect ends, it does not spin");
  const noloc = await readLinkPreview(F("/noloc"), SEAM);
  assert.equal(noloc.code, "UNREACHABLE", "a 302 with no Location is a dead end, not a preview of nothing");
  const fetchCode = codeOnly(src("lib/net/preview.ts"));
  assert.ok(fetchCode.includes('redirect: "manual"'), "manual is what makes the above possible");
});

await run("fetch: size, type, status, timeout and a dead socket are all coded failures", async () => {
  const huge = await readLinkPreview(F("/huge"), { ...SEAM, maxBytes: 256 * 1024 });
  assert.equal(huge.code, "TOO_LARGE", "declared by Content-Length, refused before reading");
  const long = await readLinkPreview(F("/long"), { ...SEAM, maxBytes: 512 });
  assert.equal(long.code, "TOO_LARGE", "and while streaming, when there is no header to trust");
  const texty = await readLinkPreview(F("/text"), SEAM);
  assert.equal(texty.code, "NOT_HTML", "a preview of a plain-text file is not a preview");
  const gone = await readLinkPreview(F("/notfound"), SEAM);
  assert.equal(gone.code, "HTTP_STATUS");
  assert.match(gone.message, /404/, "the number the site actually answered, so the hint can be honest");
  const slow = await readLinkPreview(F("/slow"), { ...SEAM, timeoutMs: 300 });
  assert.equal(slow.code, "TIMEOUT", "a slow host is given up on, not waited for");
  const dropped = await readLinkPreview(F("/drop"), SEAM);
  assert.equal(dropped.ok, false, "socket reset mid-response");
  assert.equal(dropped.code, "UNREACHABLE");
  const bare = await readLinkPreview(F("/bare"), SEAM);
  assert.equal(bare.code, "NO_METADATA", "a page that says nothing about itself yields no card, not an empty one");
  const cross = await readLinkPreview(F("/cross"), SEAM);
  assert.equal(cross.meta.imageUrl, undefined, "a cross-host og:image never reaches the browser");
  const code = codeOnly(src("lib/net/preview.ts"));
  assert.ok(code.includes("AbortSignal.timeout("), "the deadline is a real timer, not a comment");
  assert.ok(code.includes('credentials: "omit"'), "no cookies, even for same-origin targets");
  assert.equal(code.toLowerCase().includes("authorization"), false, "and no ambient Authorization header, ever");
});

/* ── the route, over real HTTP ─────────────────────────────────────────── */

let srv = null;
try {
  srv = await srvPromise;
  const BASE = srv.base;

  await run("route: a caller-chosen internal address is refused by the GUARD, not by a client-side list", async () => {
    const jar = newJar();
    for (const [url, label] of [
      [`http://127.0.0.1/api/health`, "our own API (default port)"],
      ["http://169.254.169.254/latest/meta-data/", "the metadata service"],
      ["http://127.1.1.1/", "loopback, other spelling"],
      ["http://[::1]/", "ipv6 loopback"],
      ["http://localhost/", "by name"],
      ["http://10.0.0.7/admin", "an internal host"],
      ["http://example.com:6379/", "a non-web port"],
    ]) {
      const r = await req(BASE, `/api/preview?url=${encodeURIComponent(url)}`, { jar });
      assert.equal(r.status, 400, `${label} -> ${r.status} ${r.text.slice(0, 160)}`);
      assert.equal(r.json.ok, false, `${label} refused`);
      assert.ok(!r.json.preview, `${label} produced no card`);
      // Codes without an explicit port can only come from the address rules, so the
      // refusal is provably the guard's and not the client-side skip-list.
      const want = url.includes(":6379") ? "BAD_PORT" : "PRIVATE_TARGET";
      assert.equal(r.json.code, want, `${label} -> ${r.json.code}`);
      assert.match(r.json.error, /private|port|internal/i, `${label} explains itself`);
    }
    for (const url of ["javascript:alert(1)", "file:///etc/passwd", "not-a-url", ""]) {
      const r = await req(BASE, `/api/preview?url=${encodeURIComponent(url)}`, { jar });
      assert.equal(r.status, 400, `${url || "(empty)"} -> ${r.status}`);
      assert.equal(r.json.ok, false);
      assert.ok(!r.json.preview, "no card, ever, for a non-URL");
    }
  });

  await run("route: previews are free (no credit gate) but rate-limited per identity", async () => {
    assert.equal(
      /credits|charge|debit/i.test(codeOnly(src("app/api/preview/route.ts"))),
      false,
      "a preview is not AI work, so it must not read like it costs anything"
    );
    const jar = newJar();
    const codes = [];
    for (let i = 0; i < 40; i++) {
      const r = await req(BASE, `/api/preview?url=${encodeURIComponent(`http://127.0.0.1:1/x${i}`)}`, { jar });
      codes.push(r.status);
    }
    const limited = codes.filter((c) => c === 429).length;
    assert.ok(limited > 0, `expected some 429s in ${codes.join(",")}`);
    assert.ok(codes.slice(0, 10).every((c) => c === 400), "the first ones were refusals, not throttling");
    const last = await req(BASE, "/api/preview?url=http%3A%2F%2F127.0.0.1%2F", { jar });
    assert.equal(last.status, 429);
    assert.ok(last.json.hint, "and the caller is told when to come back");
  });

  await run("route: no egress here, so a public link reports a coded failure — never a fake card", async () => {
    // The bucket above is now exhausted for this guest, so use a fresh identity.
    const jar = newJar();
    const first = await req(BASE, "/api/preview?url=https%3A%2F%2Fexample.com%2F", { jar });
    assert.notEqual(first.status, 200, "example.com is unreachable from this sandbox (no outbound network)");
    assert.equal(first.json.ok, false, "and that is reported as a failure, not as an empty success");
    assert.ok(!first.json.preview, "no title is invented for a page we could not read");
    assert.ok(
      ["UNRESOLVED", "TIMEOUT", "UNREACHABLE", "HTTP_STATUS"].includes(first.json.code),
      `a real network outcome, got ${first.json.code}`
    );
    // Same link, different spelling: the fragment is not part of it, so this is a hit
    // on the row the previous request stored.
    const second = await req(BASE, "/api/preview?url=https%3A%2F%2Fexample.com%2F#frag", { jar });
    assert.equal(second.json.source, "cache", "a dead host is remembered briefly, so a long chat does not re-probe it per render");
    assert.equal(second.json.ok, false, "and remembering a failure does not turn it into a success");
    assert.ok(!second.json.preview);
  });

  await run("route: guests may preview, and nothing is cached for browsers", async () => {
    const anon = await fetch(`${BASE}/api/preview?url=${encodeURIComponent("http://127.0.0.1/x")}`, {
      redirect: "manual",
      cache: "no-store",
    });
    assert.ok(anon.status !== 401 && anon.status !== 403, `guest -> ${anon.status}`);
    assert.equal(anon.status, 400, "the refusal is the same for a guest: the check is about the address");
    assert.ok(!anon.headers.get("set-cookie") || !/bw_session=;/.test(anon.headers.get("set-cookie")), "no session churn");
    const withGuest = await fetch(`${BASE}/api/preview?url=http%3A%2F%2F127.0.0.1%2Fy`, { redirect: "manual" });
    assert.equal(withGuest.headers.get("cache-control"), "no-store", "per-user, per-link answers are never CDN cacheable");
    const body = await withGuest.json();
    assert.ok(body.code, "and a refusal carries a code the client could branch on");
    const setCookie = withGuest.headers.get("set-cookie") || "";
    assert.ok(
      setCookie.includes("bw_guest="),
      "a first visit gets the guest cookie — that is what makes the per-identity limit mean something"
    );
    assert.equal(
      setCookie.includes("bw_session="),
      false,
      "and no session is conjured by a preview: this route is not an auth surface"
    );
  });

  await run("store: the cache keys on a hash and keeps no URL", async () => {
    const store = src("lib/db/store.ts");
    const rowStart = store.indexOf("export type LinkPreviewRow = {");
    assert.ok(rowStart > 0, "the row type exists");
    const rowBlock = store.slice(rowStart, store.indexOf("};", rowStart));
    assert.equal(rowBlock.includes("url:"), false, "no URL column: the cache is not a reading log");
    assert.ok(rowBlock.includes("key: string"), "keyed by the hash");
    assert.ok(store.includes('createHash("sha256").update(normalizedUrl)'), "and that is a SHA-256 of the normalised URL");
    for (const spot of ["linkPreviews: LinkPreviewRow[]", "linkPreviews: [],", "parsed.linkPreviews || []", "remote.linkPreviews || []"]) {
      assert.ok(store.includes(spot), `wired into the store and the remote mapping: ${spot}`);
    }
    assert.ok(store.includes("r.expiresAt > row.fetchedAt"), "expired rows are pruned on write, and the cap is enforced");
    assert.match(store, /LINK_PREVIEW_MAX_ROWS = 500/, "bounded: a shared cache must not grow forever");
  });

  await run("UI: a card is text-only, no-opinion-on-failure, and out of the markdown renderer", async () => {
    const card = src("components/chat/LinkPreviews.tsx");
    const code = codeOnly(card);
    assert.equal(card.includes("dangerouslySetInnerHTML"), false, "the card never injects HTML, so og:* text cannot become markup");
    assert.ok(code.includes('rel="noopener noreferrer nofollow ugc"'), "the reader gets no referrer and the link earns no SEO weight");
    assert.ok(code.includes('target="_blank"'));
    assert.ok(code.includes('referrerPolicy="no-referrer"'), "the opt-in image leaks no referrer");
    assert.ok(code.includes("if (!dto) return null;"), "nothing is rendered before or without data");
    assert.ok(code.includes("setWantsImage(true)"), "og:image is behind a click: no request from the reader without consent");
    assert.equal(card.includes("setTimeout"), false, "no competing client timeout: the server owns the one deadline");

    const chat = src("app/page.tsx");
    assert.equal((chat.match(/<LinkPreviews /g) || []).length, 1, "one render site in the chat");
    assert.ok(chat.includes('!isUser && !m.streaming && ('), "assistant-only, and not while streaming");
    assert.ok(chat.includes('<LinkPreviews text={m.content || ""} exclude={m.sources?.map((s) => s.url)} />'), "and Sources chips are not duplicated as cards");
    const share = src("app/s/[id]/page.tsx");
    assert.equal((share.match(/<LinkPreviews /g) || []).length, 1, "and one on the shared page");
    assert.ok(share.includes("exclude={m.sources?.map("), "same rule on the shared page");
    const md = src("lib/safe-md.ts");
    assert.equal(/LinkPreview|bw-preview/.test(md), false, "the shared markdown renderer stays a pure string function: no cards inside tool output");
  });

  await run("CSS: preview rules sit above the reduced-motion guard and clamp instead of resizing", async () => {
    const css = src("app/globals.css");
    const at = css.indexOf(".bw-preview {");
    assert.ok(at > 0, "the card has its own rule");
    assert.ok(at < css.lastIndexOf("@media (prefers-reduced-motion"), "above the guard, so transitions are still neutralised");
    assert.ok(css.includes("--bw-focus-r: 12px"), "and the focus ring follows the primitive's own corner radius");
    assert.ok(css.includes("line-clamp: 2"), "the description is clamped");
    assert.ok(css.includes(".bw-preview__img {") && css.includes("max-height: 168px"), "the opt-in picture cannot stretch the bubble");
  });
} finally {
  for (const t of timers) clearTimeout(t);
  fixture.close();
  const s = await srvPromise.catch(() => null);
  if (s) s.stop();
}

process.exit(report("link preview + SSRF guard (step 8)"));
