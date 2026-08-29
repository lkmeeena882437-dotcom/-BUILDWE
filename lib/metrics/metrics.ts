/**
 * BUILDWE internal metrics (Update #2): lightweight, in-memory, zero PII.
 * Answers boss's quality-metric questions: time-to-first-answer, completion
 * rate, regeneration rate, fallback recovery, provider mix.
 *
 * Internal only — exposed via GET /api/metrics (not linked anywhere public).
 * Counters reset on server restart (dev-grade, honest — no fake history).
 */

type Counters = Record<string, number>;

const counters: Counters = {};
const ttftSamples: number[] = []; // ms, time-to-first-token (client-beaconed)
const startedAt = Date.now();

export function bump(name: string, by = 1) {
  counters[name] = (counters[name] || 0) + by;
}

export function sampleTtft(ms: number) {
  if (!Number.isFinite(ms) || ms < 0 || ms > 120_000) return;
  ttftSamples.push(ms);
  if (ttftSamples.length > 200) ttftSamples.shift();
}

function avg(xs: number[]) {
  if (!xs.length) return null;
  return Math.round(xs.reduce((a, b) => a + b, 0) / xs.length);
}

export function snapshot() {
  const sends = counters["chat_send"] || 0;
  const completions = counters["chat_done"] || 0;
  const errors = counters["chat_error"] || 0;
  const regens = counters["regenerate"] || 0;
  const modelSwitchRecoveries = counters["recovery_use_another_model"] || 0;
  const fallbacks = counters["fallback"] || 0;
  return {
    since: new Date(startedAt).toISOString(),
    uptimeSec: Math.round((Date.now() - startedAt) / 1000),
    counters: { ...counters },
    derived: {
      chat_sends: sends,
      completion_rate: sends ? Math.round((completions / sends) * 100) / 100 : null,
      error_rate: sends ? Math.round((errors / sends) * 100) / 100 : null,
      regenerations_per_answer: completions
        ? Math.round((regens / completions) * 100) / 100
        : null,
      fallback_rate: sends ? Math.round((fallbacks / sends) * 100) / 100 : null,
      fallback_recovery_actions: modelSwitchRecoveries,
      avg_time_to_first_token_ms: avg(ttftSamples),
      ttft_samples: ttftSamples.length,
    },
  };
}
