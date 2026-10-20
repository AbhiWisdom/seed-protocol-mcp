/**
 * Cursor history → local brain (best effort).
 * Cursor keeps chats in globalStorage/state.vscdb, table cursorDiskKV:
 *   composerData:<composerId>             → { composerId, createdAt, fullConversationHeadersOnly | conversation }
 *   bubbleId:<composerId>:<bubbleId>      → { type: 1 (user) | 2 (assistant), text, createdAt? }
 * The file is read into memory and opened with sql.js — never written back.
 * Unknown layouts return { ok: false, reason } instead of throwing.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { loadSqlJs } from "../brain/db.js";
import { addCounts, addSession, toIso } from "../brain/store.js";

export const SOURCE = "cursor";
const MAX_BYTES = 2 * 1024 ** 3; // sql.js holds the whole file in memory
const ROLE = { 1: "user", 2: "assistant" };

export function defaultCursorDbPath() {
  const rel = ["Cursor", "User", "globalStorage", "state.vscdb"];
  if (platform() === "darwin") return join(homedir(), "Library", "Application Support", ...rel);
  if (platform() === "win32") return join(process.env.APPDATA || join(homedir(), "AppData", "Roaming"), ...rel);
  return join(homedir(), ".config", ...rel);
}

const decoder = new TextDecoder();
function parseValue(v) {
  try {
    return JSON.parse(typeof v === "string" ? v : decoder.decode(v));
  } catch {
    return null;
  }
}

function rowsLike(db, prefix, fn) {
  const stmt = db.prepare("SELECT key, value FROM cursorDiskKV WHERE key LIKE ?");
  try {
    stmt.bind([`${prefix}%`]);
    while (stmt.step()) {
      const [key, value] = stmt.get();
      fn(String(key), parseValue(value));
    }
  } finally {
    stmt.free();
  }
}

function bubbleText(b) {
  return typeof b?.text === "string" ? b.text.trim() : "";
}

/**
 * Read Cursor chats. Returns { ok: true, sessions: [{ id, project, messages }] }
 * or { ok: false, reason }.
 */
export async function readCursorDb(path = defaultCursorDbPath()) {
  if (!existsSync(path)) return { ok: false, reason: `Cursor history not found at ${path}` };
  const size = statSync(path).size;
  if (size > MAX_BYTES) return { ok: false, reason: `Cursor database is ${(size / 1024 ** 3).toFixed(1)} GB — too large to import safely` };
  const SQL = await loadSqlJs();
  let db;
  try {
    db = new SQL.Database(readFileSync(path));
    const hasTable = db.exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'cursorDiskKV'");
    if (!hasTable.length) return { ok: false, reason: "Cursor format not recognised (no cursorDiskKV table)" };

    const composers = new Map();
    rowsLike(db, "composerData:", (key, val) => {
      if (val && typeof val === "object") composers.set(val.composerId || key.slice("composerData:".length), val);
    });
    const bubbles = new Map(); // composerId → Map(bubbleId → bubble)
    rowsLike(db, "bubbleId:", (key, val) => {
      const [, composerId, bubbleId] = key.split(":");
      if (!composerId || !bubbleId || !val || typeof val !== "object") return;
      if (!bubbles.has(composerId)) bubbles.set(composerId, new Map());
      bubbles.get(composerId).set(bubbleId, val);
    });
    if (!composers.size && !bubbles.size) {
      return { ok: false, reason: "Cursor format not recognised (no composerData/bubbleId entries)" };
    }
    const fallbackTs = statSync(path).mtimeMs;
    const sessions = [];
    for (const id of new Set([...composers.keys(), ...bubbles.keys()])) {
      const s = buildSession(id, composers.get(id), bubbles.get(id), fallbackTs);
      if (s.messages.length) sessions.push(s);
    }
    if (!sessions.length && (composers.size || bubbles.size)) {
      const anyText = [...bubbles.values()].some((m) => [...m.values()].some((b) => typeof b.text === "string"));
      if (!anyText) return { ok: false, reason: "Cursor format not recognised (chats have no text field)" };
    }
    return { ok: true, sessions };
  } catch (err) {
    return { ok: false, reason: `Cursor format not recognised (${err.message})` };
  } finally {
    db?.close();
  }
}

/** Order bubbles by the composer's header list (or inline conversation). */
function buildSession(id, composer, bubbleMap, fallbackTs) {
  const base = Number(composer?.createdAt) || Date.parse(composer?.createdAt) || fallbackTs;
  let ordered = [];
  if (Array.isArray(composer?.conversation) && composer.conversation.some((b) => bubbleText(b))) {
    ordered = composer.conversation;
  } else if (Array.isArray(composer?.fullConversationHeadersOnly) && bubbleMap) {
    ordered = composer.fullConversationHeadersOnly.map((h) => ({ ...h, ...(bubbleMap.get(h.bubbleId) || {}) }));
  } else if (bubbleMap) {
    ordered = [...bubbleMap.entries()]
      .map(([bubbleId, b]) => ({ bubbleId, ...b }))
      .sort((a, b) => String(toIso(a.createdAt) || "").localeCompare(String(toIso(b.createdAt) || "")));
  }
  const messages = [];
  ordered.forEach((b, i) => {
    const text = bubbleText(b);
    const role = ROLE[b.type] || { user: "user", ai: "assistant", assistant: "assistant" }[b.type] || null;
    if (!text || !role) return;
    messages.push({
      id: `${SOURCE}:${id}:${b.bubbleId || i}`,
      role,
      ts: toIso(b.createdAt) || toIso(base + i * 1000),
      text,
    });
  });
  return { id, project: null, messages };
}

/** Import Cursor chats into the brain; same stats shape as Claude Code. */
export async function importCursor(brain, { path = defaultCursorDbPath() } = {}) {
  const stats = { source: SOURCE, found: existsSync(path), files: 1, files_skipped: 0, sessions: 0, messages_seen: 0, messages_new: 0, malformed: 0, redactions: {} };
  const read = await readCursorDb(path);
  if (!read.ok) return { ...stats, ok: false, reason: read.reason };
  for (const s of read.sessions) {
    stats.sessions++;
    stats.messages_seen += s.messages.length;
    const { inserted, redactions } = addSession(brain, { id: `${SOURCE}:${s.id}`, source: SOURCE, project: s.project || "cursor" }, s.messages);
    stats.messages_new += inserted;
    addCounts(stats.redactions, redactions);
  }
  return { ...stats, ok: true };
}
