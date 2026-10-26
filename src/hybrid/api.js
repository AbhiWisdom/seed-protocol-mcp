/**
 * Hybrid mode (SEED_MODE=hybrid): the soul lives on this device (~/.seed/soul.sqlite)
 * and the types the user ticked in the dashboard (Privacy → Devices & sync) are copied
 * to their cloud soul, so other devices and tools see them. Reads merge both,
 * de-duplicated. Offline, writes stay local and go up later: at the next server start
 * or with `npx seed-protocol-mcp sync`.
 */

const TYPE = { "/remember": "memories", "/correct": "corrections", "/daily-logs": "daily_logs", "/kb": "kb", "/evolve": "traits" };
export const DEFAULT_POLICY = { memories: true, corrections: true, traits: true, kb: false, daily_logs: false };
const POLICY_TTL = 5 * 60 * 1000;
const norm = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
const settled = (r) => (r.status === "fulfilled" ? r.value : null);
const uniqueBy = (list, keyFn) => {
  const seen = new Set();
  return list.filter((x) => (seen.has(keyFn(x)) ? false : seen.add(keyFn(x))));
};

function refOf(type, out, body) {
  if (type === "daily_logs") return out?.log ? [out.log.day, out.log.source] : null;
  if (type === "kb") return out?.article?.id;
  if (type === "traits") return out?.vasana?.trait_name || body.trait_name;
  return out?.id;
}

const MERGE = {
  "": (l, c) => ({ ...(l || {}), ...(c || {}), mode: "hybrid" }),
  "/state": (l, c) => {
    const lc = l?.counts || {};
    const cc = c?.counts || {};
    const counts = Object.fromEntries(["memories", "corrections", "daily_logs", "kb"].map((k) => [k, Math.max(lc[k] || 0, cc[k] || 0)]));
    const vasanas = uniqueBy([...(l?.vasanas || []), ...(c?.vasanas || [])], (v) => v.trait_name);
    return { ...(l || {}), ...(c || {}), mode: "hybrid", counts, counts_local: lc, counts_cloud: cc, vasanas };
  },
  "/memories": (l, c, q) => {
    const tag = (list, where) => (list || []).map((m) => ({ ...m, where }));
    const all = uniqueBy([...tag(l?.memories, "this device"), ...tag(c?.memories, "cloud")], (m) => norm(m.content))
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || (b.importance ?? 0) - (a.importance ?? 0));
    return { memories: all.slice(0, Number(q.limit) || 20), total: Math.max(l?.total || 0, c?.total || 0) };
  },
  "/corrections": (l, c) => ({ corrections: uniqueBy([...(l?.corrections || []), ...(c?.corrections || [])], (x) => norm(x.correction)) }),
  "/daily-logs": (l, c) => ({
    logs: uniqueBy([...(l?.logs || []), ...(c?.logs || [])], (x) => `${x.day}|${x.source}`).sort((a, b) => (a.day < b.day ? 1 : -1)),
  }),
  "/kb": (l, c, q) => ({
    articles: uniqueBy([...(l?.articles || []), ...(c?.articles || [])], (a) => a.key || norm(a.title)).slice(0, Number(q.limit) || 10),
  }),
};

/** @param {{ local: object, cloud: object }} stores — createLocalApi() and createApi(auth) */
export function createHybridApi({ local, cloud }) {
  let policy = null;
  let fetchedAt = 0;
  let flushing = null;

  async function getPolicy() {
    if (policy && Date.now() - fetchedAt < POLICY_TTL) return policy;
    try {
      policy = { ...DEFAULT_POLICY, ...((await cloud.request("/api/v1/me/sync")).policy || {}) };
      fetchedAt = Date.now();
    } catch {
      policy = policy || { ...DEFAULT_POLICY }; // offline: last known, else the defaults
    }
    return policy;
  }

  /** Push waiting rows of every ticked type. Single-flight; stops at the first cloud error. */
  function flush({ max = 40 } = {}) {
    if (flushing) return flushing;
    flushing = (async () => {
      const p = await getPolicy();
      const pushed = {};
      for (const type of Object.keys(p).filter((t) => p[t])) {
        pushed[type] = 0;
        for (const item of await local.pending(type, max)) {
          try {
            await cloud.post(item.suffix, item.body);
          } catch (err) {
            return { pushed, error: `[${err.code || "ERROR"}] ${err.message}` };
          }
          await local.markSynced(type, [item.ref]);
          pushed[type]++;
        }
      }
      return { pushed, error: null };
    })().finally(() => { flushing = null; });
    return flushing;
  }

  return {
    hybrid: true,
    remote: cloud, // workspace, search and reports live in the cloud soul only
    apiUrl: cloud.apiUrl,
    hasKey: () => cloud.hasKey(),
    seedId: () => cloud.seedId().catch(() => local.seedId()),
    useSeed: (id) => cloud.useSeed(id),
    setClient: (name) => { cloud.setClient(name); local.setClient(name); },
    client: () => cloud.client(),
    request: (path, opts) => cloud.request(path, opts),
    /** This device's rows only (load_soul adds what the cloud has not got yet). */
    localOnly: (suffix, query) => local.get(suffix, query),
    policy: getPolicy,
    pendingCounts: () => local.pendingCounts(),
    flush,
    get: async (suffix = "", query = {}) => {
      const merge = MERGE[suffix];
      const [l, c] = await Promise.allSettled([local.get(suffix, query), cloud.get(suffix, query)]);
      if (!merge || (l.status === "rejected" && c.status === "rejected")) {
        if (c.status === "fulfilled") return c.value;
        throw c.reason;
      }
      const out = merge(settled(l), settled(c), query || {});
      if (c.status === "rejected") out.cloud_unreachable = c.reason?.message || true;
      return out;
    },
    post: async (suffix, body = {}) => {
      if (flushing) await flushing.catch(() => {}); // a running flush must not pick up (and double-send) this write
      const out = await local.post(suffix, body);
      const type = TYPE[suffix];
      if (!type) return out; // import records stay on this device
      if (!(await getPolicy())[type]) return { ...out, synced: false, sync: "kept on this device (sync is off for this type)" };
      const ref = refOf(type, out, body);
      try {
        await cloud.post(suffix, type === "kb" && !body.key ? { ...body, key: `local:${ref}` } : body);
        await local.markSynced(type, [ref]);
        return { ...out, synced: true };
      } catch (err) {
        return { ...out, synced: false, sync: `saved on this device; cloud copy pending (${err.code || "offline"})` };
      }
    },
  };
}
