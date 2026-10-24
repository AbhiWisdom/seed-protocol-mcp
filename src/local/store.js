/**
 * Local-only mode (SEED_MODE=local): the soul lives in ~/.seed/soul.sqlite on this
 * machine and nothing is sent anywhere. It answers the slice of the SEED API the tools
 * use — /state, /memories, /corrections, /daily-logs, /kb, /remember, /correct, /evolve,
 * /imports — so every tool, build_soul included, works unchanged. A separate file from
 * the history brain, so the two never overwrite each other.
 */

import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import { ApiError } from "../api.js";
import { brainFileStamp, openBrain } from "../brain/db.js";
import { localDay, seedHome } from "../config.js";

export const LOCAL_SOUL_ID = "local";
const SCHEMA = `
CREATE TABLE IF NOT EXISTS memories (id TEXT PRIMARY KEY, content TEXT NOT NULL, hash TEXT UNIQUE, category TEXT, importance REAL, created_at TEXT);
CREATE TABLE IF NOT EXISTS corrections (id TEXT PRIMARY KEY, original TEXT, correction TEXT NOT NULL, hash TEXT UNIQUE, category TEXT,
  severity REAL, times_triggered INTEGER NOT NULL DEFAULT 1, created_at TEXT, last_triggered TEXT);
CREATE TABLE IF NOT EXISTS daily_logs (day TEXT NOT NULL, source TEXT NOT NULL, summary TEXT, stats TEXT, updated_at TEXT, PRIMARY KEY (day, source));
CREATE TABLE IF NOT EXISTS kb (id TEXT PRIMARY KEY, key TEXT UNIQUE, title TEXT, body TEXT, tags TEXT, updated_at TEXT);
CREATE TABLE IF NOT EXISTS vasanas (trait_name TEXT PRIMARY KEY, description TEXT, intensity REAL, seen INTEGER NOT NULL DEFAULT 1, updated_at TEXT);
CREATE TABLE IF NOT EXISTS imports (id TEXT PRIMARY KEY, source TEXT, sessions INTEGER, messages INTEGER, days INTEGER, memories_added INTEGER, created_at TEXT);
`;

export const soulPath = () => join(seedHome(), "soul.sqlite");
const now = () => new Date().toISOString();
const words = (s) => String(s || "").toLowerCase().match(/[\p{L}\p{N}']{2,}/gu) || [];
const hash = (s) => createHash("sha256").update(words(s).join(" ")).digest("hex").slice(0, 32);
const limit = (v, d, max = 100) => Math.min(Math.max(1, Number(v) || d), max);
const tagsOf = (raw) => { try { return JSON.parse(raw || "[]"); } catch { return []; } };

function counts(b) {
  const n = (t) => b.get(`SELECT COUNT(*) AS c FROM ${t}`).c;
  return { memories: n("memories"), corrections: n("corrections"), daily_logs: n("daily_logs"), kb: n("kb") };
}

function searchMemories(b, { q = "", category = "", limit: lim } = {}) {
  const rows = b.all(`SELECT id, content, category, importance, created_at FROM memories ${category ? "WHERE category = ?" : ""}
    ORDER BY importance DESC, created_at DESC`, category ? [category] : []);
  const terms = words(q);
  const scored = terms.length
    ? rows.map((m) => ({ ...m, score: terms.filter((t) => m.content.toLowerCase().includes(t)).length / terms.length })).filter((m) => m.score > 0)
      .sort((a, b2) => b2.score - a.score || b2.importance - a.importance)
    : rows;
  return { memories: scored.slice(0, limit(lim, 20)), total: rows.length };
}

const GET = {
  "": (b, name) => ({ id: LOCAL_SOUL_ID, name, personality: {}, local: true }),
  "/state": (b, name) => ({ seed_id: LOCAL_SOUL_ID, name, mode: "local", personality: {}, counts: counts(b),
    vasanas: b.all("SELECT trait_name, description, intensity, seen FROM vasanas ORDER BY intensity DESC") }),
  "/memories": (b, name, q) => searchMemories(b, q),
  "/corrections": (b, name, q) => ({ corrections: b.all(
    "SELECT original AS original_content, correction, category, severity, times_triggered FROM corrections ORDER BY severity DESC, times_triggered DESC LIMIT ?",
    [limit(q.limit, 25)]) }),
  "/daily-logs": (b, name, q) => ({ logs: b.all(
    `SELECT day, source, summary, stats, updated_at FROM daily_logs ${q.before ? "WHERE day < ?" : ""} ORDER BY day DESC, source LIMIT ?`,
    q.before ? [q.before, limit(q.limit, 30, 200)] : [limit(q.limit, 30, 200)]).map((l) => ({ ...l, stats: tagsOf(l.stats) })) }),
  "/kb": (b, name, q) => {
    const needle = String(q.q || "").toLowerCase();
    const rows = b.all("SELECT id, key, title, body, tags, updated_at FROM kb ORDER BY updated_at DESC").map((a) => ({ ...a, tags: tagsOf(a.tags), auto: false }));
    return { articles: (needle ? rows.filter((a) => `${a.title} ${a.body} ${a.tags.join(" ")}`.toLowerCase().includes(needle)) : rows).slice(0, limit(q.limit, 10, 500)) };
  },
};

const POST = {
  "/remember": (b, { content, category = "general", importance = 0.5 }) => {
    const h = hash(content);
    const dup = b.get("SELECT id, created_at FROM memories WHERE hash = ?", [h]);
    if (dup) return { ...dup, content, duplicate: true };
    const row = { id: randomUUID(), content, category, importance, created_at: now() };
    b.run("INSERT INTO memories (id, content, hash, category, importance, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      [row.id, content, h, category, importance, row.created_at]);
    return row;
  },
  "/correct": (b, { original = "", correction, category = "behavior", severity = 0.8 }) => {
    const h = hash(correction);
    const row = b.get("SELECT id, times_triggered FROM corrections WHERE hash = ?", [h]);
    if (row) {
      b.run("UPDATE corrections SET times_triggered = times_triggered + 1, severity = MIN(1.0, severity + 0.1), last_triggered = ? WHERE id = ?", [now(), row.id]);
      return { id: row.id, repeated: true, times_triggered: row.times_triggered + 1 };
    }
    const id = randomUUID();
    b.run("INSERT INTO corrections (id, original, correction, hash, category, severity, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [id, original, correction, h, category, severity, now()]);
    return { id, repeated: false, severity };
  },
  "/daily-logs": (b, { day, source = "mcp", summary, stats = {} }) => {
    const log = { day: day || localDay(), source, summary, stats, updated_at: now() };
    b.run("INSERT INTO daily_logs (day, source, summary, stats, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(day, source) DO UPDATE SET "
      + "summary = excluded.summary, stats = excluded.stats, updated_at = excluded.updated_at", [log.day, source, summary, JSON.stringify(stats), log.updated_at]);
    return { ok: true, log };
  },
  "/kb": (b, { key = null, title, body, tags = [] }) => {
    const existing = key && b.get("SELECT id FROM kb WHERE key = ?", [key]);
    const article = { id: existing?.id || randomUUID(), key, title, tags, updated_at: now() };
    if (existing) b.run("UPDATE kb SET title = ?, body = ?, tags = ?, updated_at = ? WHERE id = ?", [title, body, JSON.stringify(tags), article.updated_at, article.id]);
    else b.run("INSERT INTO kb (id, key, title, body, tags, updated_at) VALUES (?, ?, ?, ?, ?, ?)", [article.id, key, title, body, JSON.stringify(tags), article.updated_at]);
    return { ok: true, article };
  },
  "/evolve": (b, { trait_name, description, intensity }) => {
    b.run("INSERT INTO vasanas (trait_name, description, intensity, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(trait_name) DO UPDATE SET "
      + "description = excluded.description, intensity = excluded.intensity, seen = seen + 1, updated_at = excluded.updated_at",
    [trait_name, description, intensity, now()]);
    return { ok: true, vasana: b.get("SELECT trait_name, description, intensity, seen, updated_at FROM vasanas WHERE trait_name = ?", [trait_name]) };
  },
  "/imports": (b, body) => {
    b.run("INSERT INTO imports (id, source, sessions, messages, days, memories_added, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [randomUUID(), body.source, body.sessions || 0, body.messages || 0, body.days || 0, body.memories_added || 0, now()]);
    return { ok: true };
  },
};

/** Same shape as createApi(): get/post/request/seedId/useSeed/hasKey. Calls are serialised. */
export function createLocalApi({ name = process.env.SEED_SOUL_NAME || "Your AI" } = {}) {
  let brain = null;
  let stamp = null;
  let chain = Promise.resolve();
  const lock = (fn) => {
    const run = chain.then(fn);
    chain = run.catch(() => {});
    return run;
  };
  const open = async () => {
    const current = brainFileStamp(soulPath());
    if (!brain || current !== stamp) {  // another process wrote the file: reload it
      brain?.close();
      brain = await openBrain(soulPath());
      brain.db.exec(SCHEMA);
      stamp = current;
    }
    return brain;
  };
  const route = (table, suffix) => {
    const fn = table[suffix];
    if (!fn) throw new ApiError("NOT_FOUND", `Local-only mode does not support ${suffix || "/"}.`);
    return fn;
  };
  return {
    local: true,
    apiUrl: soulPath(),
    hasKey: () => true,
    seedId: async () => LOCAL_SOUL_ID,
    useSeed: () => {},
    request: async (path) => {
      if (path === "/api/v1/skills") return { total: 0, categories: {}, note: "The skills catalogue needs online mode." };
      throw new ApiError("NOT_FOUND", "Local-only mode keeps one soul, on this machine.");
    },
    get: (suffix = "", query = {}) => lock(async () => route(GET, suffix)(await open(), name, query || {})),
    post: (suffix, body = {}) => lock(async () => {
      const b = await open();
      const out = route(POST, suffix)(b, body);
      b.save();
      stamp = brainFileStamp(soulPath());
      return out;
    }),
  };
}
