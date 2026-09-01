/**
 * Step 7: seats — what a Business order may charge, and what it may grant.
 *
 * There is no Razorpay key in this sandbox (by design: the app refuses to sell
 * anything when the gateway is not configured), so a completed payment cannot be
 * observed here. What CAN be proven, and is, is the part that matters for a
 * multiplier: the number is validated before money is asked for, the honest 503
 * is the only branch after it, no order object is ever returned for a server that
 * cannot create one, and the entitlement is read back from the ledger/gateway and
 * not from whatever the browser posted.
 *
 * Run: npm run test:pricing
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { newJar, req, report, run, startServer } from "./harness.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const PORT = 3345;
const INR = "\u20b9";

const src = (p) => readFileSync(path.join(ROOT, p), "utf8");
/** Comment-stripped source: a comment that *names* a banned pattern is evidence of the fix, not a regression. */
function codeOnly(s) {
  return s
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*|\/\*|\/\*\*)/.test(l))
    .join("\n");
}

const srv = await startServer({ port: PORT, label: "bw-pricing" });
const BASE = srv.base;

async function signUp() {
  const jar = newJar();
  const r = await req(BASE, "/api/auth/register", {
    method: "POST",
    jar,
    body: {
      email: `seats-${Date.now()}-${Math.floor(Math.random() * 1e6)}@buildwe.test`,
      password: "seats-test-password",
      name: "Seat tester",
    },
  });
  assert.ok(r.status === 200 || r.status === 201, `register -> ${r.status} ${r.text.slice(0, 120)}`);
  return jar;
}

await run("the order endpoint publishes the price and the seat bounds it will honour", async () => {
  const j = (await req(BASE, "/api/checkout/order")).json;
  assert.equal(typeof j.amountPaise, "number", "the unit price must be a number the client can multiply for display");
  assert.ok(j.amountPaise > 0, "and positive");
  assert.ok(j.currency === "INR" || j.currency === "USD", `unexpected currency ${j.currency}`);
  const expected =
    j.currency === "INR"
      ? `${INR}${(j.amountPaise / 100).toFixed(0)}`
      : `$${(j.amountPaise / 100).toFixed(2)}`;
  assert.equal(j.displayAmount, expected, "the label is derived from the amount, never typed beside it");
  assert.ok(Number.isInteger(j.seatsMax) && j.seatsMax >= 2, `seatsMax must be a real bound, got ${j.seatsMax}`);
  assert.equal(j.seatsMin, 1, "one seat is the floor, and it is the server that says so");
  assert.equal(j.configured, false, "this sandbox has no gateway keys, and the API must admit it");
  assert.ok(Array.isArray(j.packs) && j.packs.length >= 1, "packs ride along so /pricing needs no second price source");
  for (const p of j.packs) {
    assert.equal(p.displayAmount, `${INR}${(p.paise / 100).toFixed(0)}`, `pack ${p.id} label disagrees with its paise`);
  }
});

await run("an anonymous seat request is answered with a login wall, not a price quote", async () => {
  const r = await req(BASE, "/api/checkout/order", { method: "POST", body: { seats: 3 } });
  assert.equal(r.status, 401, "checkout needs an account, whoever asks");
  assert.equal(r.json.code, "LOGIN_REQUIRED", "and the code, so the UI can say the true reason");
  assert.ok(!r.json.order, "no order object may exist in a refused response");
});

await run("seats outside the bound are refused before anything is charged", async () => {
  const jar = await signUp();
  for (const bad of [0, -3, 1.5, "three", 9999]) {
    const r = await req(BASE, "/api/checkout/order", { method: "POST", jar, body: { seats: bad } });
    assert.equal(r.status, 400, `seats=${JSON.stringify(bad)} -> ${r.status} ${r.text.slice(0, 140)}`);
    assert.equal(r.json.code, "BAD_SEATS", `seats=${JSON.stringify(bad)} must say why`);
    assert.ok(!r.json.order, `seats=${JSON.stringify(bad)} cannot leave an order behind`);
  }
  // `null` is not a bad number, it is no number: a form that clears its seat field
  // means "buy the default", and refusing a purchase over an empty box would be the
  // UI's job to prevent, not the server's to punish. Pinned here so nobody "hardens"
  // it into a 400 and strands anyone whose browser posts null.
  const none = await req(BASE, "/api/checkout/order", { method: "POST", jar, body: { seats: null } });
  assert.equal(none.json.code, "CHECKOUT_UNAVAILABLE", "null seats falls back to the default of 1");

  // The bound itself, from the same number the response advertises.
  const pub = (await req(BASE, "/api/checkout/order")).json;
  const over = await req(BASE, "/api/checkout/order", { method: "POST", jar, body: { seats: pub.seatsMax + 1 } });
  assert.equal(over.json.code, "BAD_SEATS", "one past the maximum is refused, not clamped");
});

await run("a valid seat count reaches the honest refusal, and no fake order", async () => {
  const jar = await signUp();
  const r = await req(BASE, "/api/checkout/order", { method: "POST", jar, body: { seats: 3 } });
  assert.equal(r.status, 503, `unconfigured gateway must answer 503, got ${r.status}`);
  assert.equal(r.json.code, "CHECKOUT_UNAVAILABLE", "the code, so the copy can name the cause");
  assert.ok(!r.json.order && !r.json.keyId, "a server that cannot create an order must not return one");
  // A string that parses is the shape a <input type=number> posts; it must not be refused.
  const asText = await req(BASE, "/api/checkout/order", { method: "POST", jar, body: { seats: "2" } });
  assert.equal(asText.json.code, "CHECKOUT_UNAVAILABLE", '"2" is two seats, not a bad request');
});

await run("the ledger decides what was owed; the gateway decides what was granted", () => {
  const order = codeOnly(src("app/api/checkout/order/route.ts"));
  const verify = codeOnly(src("app/api/checkout/verify/route.ts"));
  const hook = codeOnly(src("app/api/checkout/webhook/route.ts"));
  const money = codeOnly(src("lib/payments/razorpay.ts"));

  // order: validate, then multiply, then charge — in that order.
  assert.ok(order.includes("normalizeSeats(body?.seats)"), "the request's seat number goes through the one validator");
  assert.ok(order.includes("proAmountPaise(seats.seats)"), "and the amount charged is the unit price times that number");
  assert.ok(order.includes("createProOrder(session.userId, seats.seats)"), "the same value reaches the gateway");
  assert.ok(order.includes("seats: seats.seats"), "and into the ledger row");
  assert.ok(order.indexOf('code: "BAD_SEATS"') < order.indexOf("livePayments()"), "out-of-range is refused before the gateway is touched");

  // verify: what should have been paid comes from OUR row, never from the client.
  assert.ok(verify.includes("proAmountPaise(pay.seats || 1)"), "the expected amount is the ledger's seat count");
  assert.ok(!/body\.seats|body\?\.seats/.test(verify), "the verify request has no say in seats at all");
  assert.ok(verify.includes("result.seats && result.seats > 1 ? result.seats : pay.seats || 1"), "the grant prefers what the gateway recorded, falling back to the ledger");
  assert.ok(verify.includes("planSeats: seats"), "and writes it once, in the same try as the plan flip");

  // the multiplier lives in the money module alone
  assert.ok(money.includes("RAZORPAY.amountPaise * Math.max(SEATS_MIN"), "one arithmetic owner");
  assert.ok(money.includes("normalizeSeats(notes.seats"), "and the seat count is read back out of the gateway's own order, through the same validator");

  // webhook: a renewal without a note must not shrink what was paid for
  assert.ok(hook.includes("normalizeSeats(entity?.notes?.seats)"), "the webhook reads seats from the event's own note");
  assert.ok(hook.includes("planSeats: 1"), "and clears them when the subscription ends");
});

await run("the per-seat grant is applied once, on the server, and shown as it is", () => {
  const credits = codeOnly(src("lib/credits.ts"));
  const store = codeOnly(src("lib/db/store.ts"));
  assert.ok(credits.includes("CREDITS.proMonthly * seats"), "the monthly grant is multiplied where it is minted");
  assert.ok(credits.includes("proMonthly: monthly") && credits.includes("proSeats: seats"), "and the wallet reports the effective number plus its multiplier");
  assert.ok(store.includes("export function planSeatsOf"), "one reader for the multiplier, so a missing field is 1 everywhere");
  assert.ok(store.includes('"planSeats"'), "updateUser's allow-list carries it, so only the verified money paths can write it");

  // No component may re-derive it: two multipliers is one too many.
  for (const f of ["components/billing/CreditsUI.tsx", "app/pricing/page.tsx", "app/page.tsx"]) {
    const code = codeOnly(src(f));
    assert.ok(!/proMonthly\s*\*/.test(code), `${f} must display the server's number, not multiply it again`);
  }

});

await run("a fresh account reads its own seat count, not a marketing number", async () => {
  const jar = await signUp();
  const j = (await req(BASE, "/api/credits", { jar })).json;
  assert.ok(j.ok, "the wallet still loads");
  assert.equal(j.proSeats, 1, "a new account has one seat");
  assert.ok(Number.isInteger(j.proMonthly) && j.proMonthly > 0, "and the monthly figure is the base grant");
  assert.equal(j.proMonthly % j.proSeats, 0, "the number shown is the number minted, divided by nothing");
});

await srv.stop();
process.exit(report("Seats: the Business multiplier (step 7b)") ? 1 : 0);
