/**
 * Bring-your-own-key — the one place that knows which vendor keys a user may store
 * and how a stored key turns back into something a provider adapter can use.
 *
 * WHY THIS EXISTS
 * ---------------
 * The decrypt pair (`user.byok.groq` → `ProviderKeys.groq`) was written out twice, in
 * `/api/ai/chat` and `/api/ai/agent`, and every surface that answers *"can this model be
 * called?"* ignored it completely. So a BYOK account was told `No openrouter key on this
 * deployment` while holding an OpenRouter key, and `/api/ai/compare` — which never passed
 * `userKeys` at all — would run a comparison on the platform key or on nothing, quietly
 * offline. A fact written in two places is a fact that drifts; this is the third copy, made
 * so the other two can be deleted.
 *
 * The list below is also the answer to "can the user fix this themselves?": a missing key for
 * a provider we accept keys for gets a Settings link, and a missing key for a provider we do
 * not is an operator problem, not a user action.
 */

import { findUserById } from "@/lib/db/store";
import { decryptSecret } from "@/lib/crypto";
import type { ProviderKeys } from "@/lib/ai/provider-registry";

/**
 * The vendors a user can paste a key for. `/api/user/keys` validates against exactly this set,
 * so adding a provider here without a key shape there is a compile error rather than a route
 * that stores anything.
 */
export const BYOK_PROVIDERS = ["groq", "openrouter"] as const;

export type ByokProvider = (typeof BYOK_PROVIDERS)[number];

/** Stored keys are `enc:v1:…` boxes; anything that does not decrypt is treated as absent. */
export type ByokStore = { [K in ByokProvider]?: string };

/** True when a missing key for this provider is something the signed-in user can fix. */
export function byokAccepted(provider: string): boolean {
  return (BYOK_PROVIDERS as readonly string[]).includes(provider);
}

/**
 * The caller's own keys, decrypted. `undefined` for a guest, an unknown account, or an
 * account that never saved one — which is the same thing as "use the platform keys".
 */
export function userProviderKeys(userId: string | undefined): ProviderKeys | undefined {
  if (!userId) return undefined;
  const byok = findUserById(userId)?.byok as ByokStore | undefined;
  if (!byok) return undefined;
  const out: ProviderKeys = {};
  let found = false;
  for (const provider of BYOK_PROVIDERS) {
    const boxed = byok[provider];
    if (!boxed) continue;
    const plain = decryptSecret(boxed);
    if (!plain) continue;
    out[provider] = plain;
    found = true;
  }
  return found ? out : undefined;
}
