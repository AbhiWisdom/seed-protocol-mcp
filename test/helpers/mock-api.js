/**
 * Tiny in-process SEED API (node:http) implementing the 2.5 backend contract.
 * Records every request so tests can assert paths, headers and payloads.
 */

import { createServer } from "node:http";

export const TEST_KEY = ["seed", "_", "a1b2c3d4e5f60718293a4b5c6d7e8f90"].join("");
export const SOUL_ID = "soul-test-0001";

/** fresh: a brand-new soul (no memories, corrections or articles) → first_run. */
export async function startMockApi({ key = TEST_KEY, soul = { id: SOUL_ID, name: "Nova" }, fresh = false } = {}) {
  const state = {
    requests: [],
    memories: [{ id: "m1", content: "User deploys with pm2", category: "fact", importance: 0.7, created_at: "2026-10-01T00:00:00Z" }],
    corrections: [{ original_content: "Used formal English", correction: "Reply in Hinglish", severity: 0.9, times_triggered: 2 }],
    logs: [],
    kb: [{ id: "k1", title: "Deploy guide", body: "pm2 deploy steps", tags: ["deploy"], auto: false, updated_at: "2026-10-01T00:00:00Z" }],
    imports: [],
    sync: { memories: true, corrections: true, traits: true, kb: false, daily_logs: false },
    vasanas: [{ trait_name: "concise", description: "Likes short answers", intensity: 0.8, seen: 3 }],
  };
  if (fresh) Object.assign(state, { memories: [], corrections: [], kb: [] });
  const owned = new Set(soul ? [soul.id] : []);

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://mock");
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString("utf8");
    let body;
    try {
      body = raw ? JSON.parse(raw) : undefined;
    } catch {
      body = raw;
    }
    const rec = { method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), headers: req.headers, body, raw };
    state.requests.push(rec);
    const send = (status, data) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    };

    if (url.pathname.startsWith("/api/souls/")) return send(410, { detail: "Gone" });
    if (req.headers["x-api-key"] !== key) return send(401, { detail: "Invalid API key" });
    const p = url.pathname;
    if (req.method === "GET" && p === "/api/v1/me") {
      return send(200, { user_id: "u1", email: "test@example.com", name: "Tester", plan: "free", api_key: key, soul: soul ? { ...soul, created_at: "x", updated_at: "y" } : null, memories_count: state.memories.length });
    }
    if (p === "/api/v1/me/sync") {
      if (req.method === "PUT") state.sync = { ...state.sync, ...body };
      return send(200, { policy: state.sync });
    }
    if (req.method === "GET" && p === "/api/v1/skills") {
      return send(200, { total: 3, categories: { frontend: [{ name: "react", description: "React", auto_apply: true }, { name: "css", description: "CSS" }], backend: [{ name: "fastapi", description: "FastAPI" }] } });
    }
    const m = p.match(/^\/api\/v1\/seeds\/([^/]+)(\/.*)?$/);
    if (!m) return send(404, { detail: "Not found" });
    const [, sid, sub = ""] = m;
    if (!owned.has(decodeURIComponent(sid))) return send(404, { detail: "Soul not found" });
    const counts = () => ({ memories: state.memories.length, corrections: state.corrections.length, daily_logs: state.logs.length, kb: state.kb.length });
    const route = `${req.method} ${sub}`;
    switch (route) {
      case "GET ":
        return send(200, { id: sid, name: soul.name, personality: { tone: "warm", raksha: { internal: true } }, language: "en", emotional_state: { rasa: "shanta" }, metadata: {}, memories_count: state.memories.length });
      case "GET /state":
        return send(200, { seed_id: sid, name: soul.name, personality: { tone: "warm", raksha: { internal: true } }, emotional_state: { rasa: "shanta" }, vasanas: state.vasanas, counts: counts() });
      case "POST /evolve": {
        const v = { ...body, seen: 1 };
        state.vasanas.push(v);
        return send(200, { ok: true, vasana: v });
      }
      case "POST /remember": {
        const mem = { id: `m${state.memories.length + 1}`, seed_id: sid, ...body, created_at: new Date().toISOString() };
        state.memories.push(mem);
        return send(201, mem);
      }
      case "GET /memories": {
        const q = (url.searchParams.get("q") || "").toLowerCase();
        const list = state.memories.filter((x) => !q || x.content.toLowerCase().includes(q));
        return send(200, { memories: list.slice(0, Number(url.searchParams.get("limit") || 20)), total: list.length });
      }
      case "POST /correct":
        state.corrections.push({ original_content: body.original, correction: body.correction, severity: body.severity, times_triggered: 1 });
        return send(201, { id: "c-new", repeated: false, times_triggered: 1, severity: body.severity });
      case "GET /corrections":
        return send(200, { corrections: state.corrections, total_corrections: state.corrections.length, active: state.corrections.length });
      case "POST /daily-logs": {
        const day = body.day || new Date().toISOString().slice(0, 10);
        let log = state.logs.find((l) => l.day === day && l.source === body.source);
        if (!log) state.logs.push((log = { id: `l${state.logs.length + 1}`, day, source: body.source }));
        Object.assign(log, { summary: body.summary, stats: body.stats || {}, updated_at: new Date().toISOString() });
        return send(200, { ok: true, log });
      }
      case "GET /daily-logs": {
        const before = url.searchParams.get("before");
        const logs = state.logs.filter((l) => !before || l.day < before).sort((a, b) => (a.day < b.day ? 1 : -1));
        return send(200, { logs: logs.slice(0, Number(url.searchParams.get("limit") || 30)) });
      }
      case "GET /kb": {
        const q = (url.searchParams.get("q") || "").toLowerCase();
        return send(200, { articles: state.kb.filter((a) => !q || `${a.title} ${a.body} ${a.tags}`.toLowerCase().includes(q)) });
      }
      case "POST /kb": {
        const { key, ...fields } = body;
        const existing = key && state.kb.find((a) => a.key === key); // backend: same key = update in place
        if (existing) {
          Object.assign(existing, fields, { updated_at: new Date().toISOString() });
          return send(201, { ok: true, article: existing });
        }
        const article = { id: `k${state.kb.length + 1}`, ...fields, key, auto: false, synced: Boolean(key), updated_at: new Date().toISOString() };
        state.kb.push(article);
        return send(201, { ok: true, article });
      }
      case "POST /imports":
        state.imports.push(body);
        return send(201, { ok: true });
      default:
        return send(404, { detail: `No route ${route}` });
    }
  });

  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}`;
  return {
    url,
    state,
    owned,
    requests: state.requests,
    close: () =>
      new Promise((r) => {
        server.close(r);
        server.closeAllConnections?.();
      }),
    reset: () => state.requests.splice(0),
  };
}
