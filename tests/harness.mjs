/**
 * Shared test harness: boots throwaway BUILDWE servers so rate-limit buckets
 * and the JSON store are NOT inherited from whatever else is running.
 *
 * This matters: a test that asserts "the 4th signup in an hour is blocked"
 * against a developer's already-warm server is a coin flip. Every limit test
 * here gets its own port, its own data dir, and its own counters.
 */

import { spawn } from "node:child_process";
import net from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");

export async function waitForServer(base, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${base}/api/health`, { cache: "no-store" });
      if (r.ok) return true;
    } catch {
      /* not listening yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`server at ${base} did not become ready in ${timeoutMs}ms`);
}

/**
 * Start one disposable server.
 * @param {{port:number, env?:Record<string,string>, label?:string}} opts
 */
/** Is anything already listening? Adopting a stranger's server is how a test suite reports nonsense. */
function portFree(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => resolve(false));
    probe.once("listening", () => probe.close(() => resolve(true)));
    probe.listen(port, "127.0.0.1");
  });
}

/**
 * Find a free port at or after `want`.
 *
 * An interrupted previous run leaves a `next dev` bound to the requested port,
 * and `waitForServer` then happily polls THAT server — old code, exhausted
 * buckets — so the suite reports results about a build it didn't start. Taking
 * the next free port removes that whole class of false result.
 */
async function pickPort(want) {
  for (let p = want; p < want + 40; p++) {
    if (await portFree(p)) return p;
  }
  throw new Error(`no free port in ${want}..${want + 39} — kill the leftover dev servers`);
}

export async function startServer({ port, env = {}, label = `bw-${port}`, dataDir: sharedDir }) {
  port = await pickPort(port);
  // Two servers pointed at the SAME dataDir is how the cross-process write
  // test reproduces "next dev plus a worker plus a script" on one JSON store.
  const dataDir = sharedDir || mkdtempSync(path.join(tmpdir(), `${label}-`));
  const ownsDir = !sharedDir;
  const child = spawn("npx", ["next", "dev", "-p", String(port), "-H", "127.0.0.1"], {
    cwd: ROOT,
    env: {
      ...process.env,
      NEXT_TELEMETRY_DISABLED: "1",
      BUILDWE_DATA_DIR: dataDir,
      // Keep the child off the parent's dev-server port and off hot reload races.
      NODE_ENV: process.env.NODE_ENV || "development",
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
    // Own process group, so stop() can take `next dev` AND its child worker
    // down together. Without this a test run leaks a listener on the port.
    detached: true,
  });
  const log = [];
  child.stdout?.on("data", (b) => log.push(b.toString()));
  child.stderr?.on("data", (b) => log.push(b.toString()));
  const base = `http://127.0.0.1:${port}`;
  try {
    await waitForServer(base);
  } catch (e) {
    const tail = log.join("").split("\n").slice(-25).join("\n");
    stopServer({ child, dataDir: ownsDir ? dataDir : undefined });
    throw new Error(`${e.message}\n--- server log ---\n${tail}`);
  }
  return {
    base,
    port,
    child,
    dataDir,
    log,
    stop: () => stopServer({ child, dataDir: ownsDir ? dataDir : undefined }),
  };
}

export function stopServer({ child, dataDir }) {
  try {
    child?.kill("SIGKILL");
    if (child?.pid) {
      // `next dev` spawns a child worker; kill the group so no port leaks.
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        /* already gone / not a group leader */
      }
    }
  } catch {
    /* already dead */
  }
  if (dataDir) {
    try {
      rmSync(dataDir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
}

export function newJar() {
  const cookies = new Map();
  return {
    header: () => [...cookies].map(([k, v]) => `${k}=${v}`).join("; ") || undefined,
    absorb(res) {
      for (const raw of res.headers.getSetCookie?.() || []) {
        const [pair] = raw.split(";");
        const i = pair.indexOf("=");
        if (i > 0) cookies.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
      }
    },
  };
}

export async function req(base, path, { method = "GET", jar, body, headers = {}, raw } = {}) {
  const res = await fetch(base + path, {
    method,
    redirect: "manual",
    headers: {
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(jar?.header() ? { cookie: jar.header() } : {}),
      ...headers,
    },
    body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
  });
  jar?.absorb(res);
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* html */
  }
  return { status: res.status, json, text };
}

/** Collected lines from every `run()` call, so tests need no plumbing. */
export const results = [];

export async function run(name, fn) {
  try {
    await fn();
    results.push(`  PASS  ${name}`);
    return true;
  } catch (e) {
    results.push(
      `  FAIL  ${name}\n          ${String(e.message).split("\n").slice(0, 4).join("\n          ")}`
    );
    return false;
  }
}

export function report(title) {
  const failed = results.filter((l) => l.includes("FAIL")).length;
  console.log(`\n${title}\n`);
  console.log(results.join("\n"));
  console.log(
    `\n${results.length - failed}/${results.length} checks passed` +
      (failed ? ` — ${failed} FAILED\n` : "\n")
  );
  return failed;
}
