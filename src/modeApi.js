/**
 * One place that turns the configured mode into the API every tool talks to:
 * online → SEED cloud · local → ~/.seed/soul.sqlite · hybrid → both (see hybrid/api.js).
 * Hybrid without a key falls back to local so nothing breaks.
 */

import { createApi } from "./api.js";
import { resolveAuth, seedMode } from "./config.js";
import { createHybridApi } from "./hybrid/api.js";
import { createLocalApi } from "./local/store.js";

export function createModeApi(opts = {}) {
  const mode = seedMode();
  if (mode === "local") return { mode, api: createLocalApi() };
  const auth = resolveAuth(opts);
  if (mode === "hybrid") {
    if (!auth.apiKey) return { mode: "local", api: createLocalApi(), note: "hybrid needs an API key — running local-only" };
    return { mode, api: createHybridApi({ local: createLocalApi(), cloud: createApi(auth) }), auth };
  }
  return { mode, api: createApi(auth), auth };
}
