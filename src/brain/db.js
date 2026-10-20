/**
 * Local brain — a single SQLite file (~/.seed/brain.sqlite) driven by sql.js
 * (pure WASM, no native build). Holds the user's scrubbed AI-tool history.
 * Nothing in this module talks to the network.
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { brainPath } from "../config.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY, source TEXT NOT NULL, project TEXT,
  started_at TEXT, ended_at TEXT, messages INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL, role TEXT, ts TEXT, text TEXT
);
CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
CREATE INDEX IF NOT EXISTS idx_messages_ts ON messages(ts);
CREATE TABLE IF NOT EXISTS days (
  day TEXT NOT NULL, source TEXT NOT NULL, sessions INTEGER NOT NULL DEFAULT 0,
  messages INTEGER NOT NULL DEFAULT 0, projects_json TEXT NOT NULL DEFAULT '[]',
  PRIMARY KEY (day, source)
);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
`;

let sqlPromise = null;

/** Initialise the sql.js WASM runtime once per process. */
export function loadSqlJs() {
  if (!sqlPromise) {
    sqlPromise = import("sql.js").then((mod) => (mod.default || mod)());
  }
  return sqlPromise;
}

/** Thin helper wrapper so callers never juggle prepared statements. */
export class Brain {
  constructor(db, path) {
    this.db = db;
    this.path = path;
  }

  /** Run a statement; returns rows modified. */
  run(sql, params = []) {
    this.db.run(sql, params);
    return this.db.getRowsModified();
  }

  /** All rows as plain objects. */
  all(sql, params = []) {
    const stmt = this.db.prepare(sql);
    try {
      stmt.bind(params);
      const rows = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      return rows;
    } finally {
      stmt.free();
    }
  }

  /** Stream rows to `fn` without building an array (large tables). */
  each(sql, params, fn) {
    const stmt = this.db.prepare(sql);
    try {
      stmt.bind(params);
      while (stmt.step()) fn(stmt.getAsObject());
    } finally {
      stmt.free();
    }
  }

  get(sql, params = []) {
    return this.all(sql, params)[0] || null;
  }

  /** Run `fn(stmt)` with one prepared statement inside a transaction. */
  batch(sql, fn) {
    const stmt = this.db.prepare(sql);
    this.db.exec("BEGIN");
    try {
      fn(stmt);
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    } finally {
      stmt.free();
    }
  }

  getMeta(key) {
    return this.get("SELECT value FROM meta WHERE key = ?", [key])?.value ?? null;
  }

  setMeta(key, value) {
    this.run("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [key, String(value)]);
  }

  /** Atomic write: temp file + rename, private permissions. */
  save() {
    if (!this.path) throw new Error("in-memory brain has no path");
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    const tmp = `${this.path}.tmp-${process.pid}`;
    writeFileSync(tmp, Buffer.from(this.db.export()), { mode: 0o600 });
    renameSync(tmp, this.path);
    try {
      chmodSync(this.path, 0o600);
    } catch {
      /* best effort */
    }
  }

  close() {
    this.db.close();
  }
}

/**
 * Open (or create) the brain. `create: false` returns null when the file is
 * missing, so read-only callers never leave an empty file behind.
 */
export async function openBrain(path = brainPath(), { create = true } = {}) {
  const SQL = await loadSqlJs();
  let db;
  if (path && existsSync(path)) db = new SQL.Database(readFileSync(path));
  else if (create) db = new SQL.Database();
  else return null;
  db.exec(SCHEMA);
  return new Brain(db, path);
}

/** File size + mtime, used to cache a read-only handle until it changes. */
export function brainFileStamp(path = brainPath()) {
  try {
    const st = statSync(path);
    return `${st.size}:${st.mtimeMs}`;
  } catch {
    return null;
  }
}
