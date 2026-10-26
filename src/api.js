/**
 * SEED API client — one place for auth, timeouts, error mapping and the
 * "which soul is mine" lookup. Every request carries `X-Api-Key`, and `X-Seed-Client`
 * (the MCP client's own name, once it has said hello) so the soul knows which app wrote what.
 *
 * Errors are `ApiError` with a stable `code`:
 *   NO_KEY · NO_SOUL · BAD_REQUEST · UNAUTHORIZED · FORBIDDEN · NOT_FOUND ·
 *   GONE · RATE_LIMITED (retryAfter seconds) · UPSTREAM_ERROR · TIMEOUT · NETWORK ·
 *   LOCAL_MODE (a cloud-only tool in local-only mode)
 */

import { VERSION, dashboardUrl } from "./config.js";

export class ApiError extends Error {
  constructor(code, message, { status = 0, retryAfter } = {}) {
    super(message);
    this.code = code;
    this.status = status;
    if (retryAfter !== undefined) this.retryAfter = retryAfter;
  }
}

const STATUS_CODES = { 400: "BAD_REQUEST", 401: "UNAUTHORIZED", 403: "FORBIDDEN", 404: "NOT_FOUND", 410: "GONE", 413: "BAD_REQUEST", 422: "BAD_REQUEST", 429: "RATE_LIMITED" };

const hints = (dashboard) => ({
  UNAUTHORIZED: `API key rejected — copy a fresh key from ${dashboard} and run: npx seed-protocol-mcp setup <KEY>`,
  RATE_LIMITED: "Too many requests — wait a minute and retry.",
  GONE: "This endpoint was retired — update with: npx -y seed-protocol-mcp@latest",
});

/** An MCP client's self-reported name, as the API accepts it (ASCII, ≤ 40 chars). */
export const clientLabel = (name) => String(name || "").replace(/[^A-Za-z0-9 ._-]/g, "").slice(0, 40).trim();

/** The cloud side of `api` for tools that only exist there (workspace, search, reports). */
export function cloudOf(api, tool) {
  if (api.remote) return api.remote;
  throw new ApiError("LOCAL_MODE", `${tool} needs your SEED cloud soul — local-only mode keeps memories, rules, logs and notes on this machine. To use it, run: npx seed-protocol-mcp setup <KEY> (online) or setup --hybrid.`);
}

/** FastAPI `detail` may be a string or a list of validation errors. */
function detailText(body) {
  try {
    const parsed = JSON.parse(body);
    const d = parsed.detail ?? parsed.error ?? parsed.message ?? body;
    if (Array.isArray(d)) return d.map((e) => `${(e.loc || []).slice(1).join(".")}: ${e.msg}`).join("; ");
    return typeof d === "string" ? d : JSON.stringify(d);
  } catch {
    return body.slice(0, 300);
  }
}

/**
 * @param {{ apiUrl: string, apiKey: string, timeoutMs?: number, fetchImpl?: typeof fetch }} opts
 */
export function createApi({ apiUrl, apiKey, timeoutMs = 15000, fetchImpl = globalThis.fetch }) {
  let mePromise = null;
  let activeSeedId = null;
  let client = "";
  const dashboard = dashboardUrl(apiUrl);
  const HINTS = hints(dashboard);

  async function request(path, { method = "GET", body, query } = {}) {
    if (!apiKey) {
      throw new ApiError("NO_KEY", `SEED_API_KEY not set — get your key from the dashboard at ${dashboard}, then run: npx seed-protocol-mcp setup <KEY>`);
    }
    let url = `${apiUrl}${path}`;
    if (query) {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
      const s = qs.toString();
      if (s) url += `?${s}`;
    }
    const headers = { Accept: "application/json", "X-Api-Key": apiKey, "User-Agent": `seed-protocol-mcp/${VERSION}` };
    if (client) headers["X-Seed-Client"] = client;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    let res;
    try {
      res = await fetchImpl(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      if (err?.name === "TimeoutError" || err?.name === "AbortError") {
        throw new ApiError("TIMEOUT", `SEED API did not answer within ${Math.round(timeoutMs / 1000)}s (${method} ${path})`);
      }
      throw new ApiError("NETWORK", `Cannot reach SEED API at ${apiUrl}: ${err?.cause?.code || err?.message || err}`);
    }
    const text = await res.text();
    if (!res.ok) {
      const code = STATUS_CODES[res.status] || (res.status >= 500 ? "UPSTREAM_ERROR" : "BAD_REQUEST");
      const ra = Number(res.headers.get("retry-after"));
      const msg = `${detailText(text) || res.statusText}${HINTS[code] ? ` — ${HINTS[code]}` : ""}`;
      throw new ApiError(code, `API ${res.status}: ${msg}`, { status: res.status, retryAfter: Number.isFinite(ra) && ra > 0 ? ra : undefined });
    }
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch {
      throw new ApiError("UPSTREAM_ERROR", `SEED API returned non-JSON for ${method} ${path}`);
    }
  }

  /** GET /api/v1/me once per process; failures are not cached. */
  function me() {
    if (!mePromise) {
      mePromise = request("/api/v1/me").catch((err) => {
        mePromise = null;
        throw err;
      });
    }
    return mePromise;
  }

  /** The caller's soul id (cached). Throws NO_SOUL with a clear next step. */
  async function seedId() {
    if (activeSeedId) return activeSeedId;
    const info = await me();
    if (!info?.soul?.id) {
      mePromise = null; // they may create one mid-session
      throw new ApiError("NO_SOUL", `No soul yet — create one at ${dashboard}`);
    }
    activeSeedId = info.soul.id;
    return activeSeedId;
  }

  /** Switch to another soul the user owns (backend 404s on anyone else's). */
  function useSeed(id) {
    activeSeedId = id;
  }

  const seedPath = async (suffix = "") => `/api/v1/seeds/${encodeURIComponent(await seedId())}${suffix}`;

  const api = {
    request,
    me,
    seedId,
    useSeed,
    hasKey: () => Boolean(apiKey),
    apiUrl,
    setClient: (name) => { client = clientLabel(name); },
    client: () => client,
    get: async (suffix, query) => request(await seedPath(suffix), { query }),
    post: async (suffix, body) => request(await seedPath(suffix), { method: "POST", body }),
    put: async (suffix, body) => request(await seedPath(suffix), { method: "PUT", body }),
    del: async (suffix, query) => request(await seedPath(suffix), { method: "DELETE", query }),
  };
  api.remote = api;
  return api;
}

/**
 * Run `fn` and retry on RATE_LIMITED (honouring Retry-After) — used by the
 * bulk import uploader, where 60 writes/min is a real ceiling.
 */
export async function withRateLimitRetry(fn, { retries = 5, baseDelayMs = 5000, sleep = defaultSleep } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (err?.code !== "RATE_LIMITED" || attempt >= retries) throw err;
      const wait = err.retryAfter ? err.retryAfter * 1000 : baseDelayMs * 2 ** attempt;
      await sleep(Math.min(wait, 65000));
    }
  }
}

function defaultSleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
