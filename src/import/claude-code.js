/**
 * Claude Code history → local brain.
 * Reads ~/.claude/projects/<project>/<session>.jsonl (one JSON object per
 * line). Keeps only human/assistant TEXT; tool calls, tool results, thinking,
 * sidechains and harness-injected meta lines are skipped.
 */

import { createReadStream, existsSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { createInterface } from "node:readline";
import { addCounts, addSession } from "../brain/store.js";

export const SOURCE = "claude-code";

export function defaultClaudeProjectsDir() {
  return join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"), "projects");
}

/** Every <projects>/<dir>/*.jsonl file (one level deep, like Claude Code writes them). */
export function listSessionFiles(projectsDir) {
  if (!existsSync(projectsDir)) return [];
  const files = [];
  for (const dir of readdirSync(projectsDir, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const full = join(projectsDir, dir.name);
    for (const f of readdirSync(full, { withFileTypes: true })) {
      if (f.isFile() && f.name.endsWith(".jsonl")) files.push({ path: join(full, f.name), folder: dir.name });
    }
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

// Harness wrappers that are not the user's own words.
const WRAPPER_TAGS = [
  "system-reminder", "local-command-stdout", "local-command-stderr", "command-name", "command-message",
  "command-args", "bash-input", "bash-stdout", "bash-stderr", "user-prompt-submit-hook",
];
const WRAPPER_RE = new RegExp(`<(${WRAPPER_TAGS.join("|")})>[\\s\\S]*?</\\1>`, "g");
const NOISE = /^\[Request interrupted by user[^\]]*\]$/;

/** Plain text from a message `content` (string or block array). */
export function extractText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((b) => b && b.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("\n");
}

export function cleanText(text) {
  const t = String(text || "").replace(WRAPPER_RE, "").trim();
  return NOISE.test(t) ? "" : t;
}

/** Folder fallback when a line has no cwd: "-Users-me-code-app" → "app". */
function folderProject(folder) {
  return folder.split("-").filter(Boolean).pop() || folder;
}

/**
 * Parse one JSONL line. Returns null for anything that is not a kept message.
 * @returns {{ sessionId: string, id: string, role: string, ts: string|null, project: string|null, text: string } | null}
 */
export function parseLine(line, { fileSession, folder } = {}) {
  let obj;
  try {
    obj = JSON.parse(line);
  } catch {
    return undefined; // malformed (distinct from "skipped")
  }
  if (!obj || (obj.type !== "user" && obj.type !== "assistant")) return null;
  if (obj.isSidechain || obj.isMeta || obj.isCompactSummary) return null;
  const msg = obj.message;
  if (!msg) return null;
  const text = cleanText(extractText(msg.content));
  if (!text) return null;
  const sessionId = obj.sessionId || fileSession;
  const role = msg.role || obj.type;
  const ts = obj.timestamp || null;
  const id = obj.uuid
    ? `${SOURCE}:${obj.uuid}`
    : `${SOURCE}:${createHash("sha1").update(`${sessionId}|${ts}|${role}|${text}`).digest("hex")}`;
  return {
    sessionId,
    id,
    role,
    ts,
    project: obj.cwd ? basename(obj.cwd) : folder ? folderProject(folder) : null,
    text,
  };
}

/** Parse a whole session file (streamed line by line). */
export async function parseFile(path, folder) {
  const fileSession = basename(path, ".jsonl");
  const sessions = new Map();
  let malformed = 0;
  const rl = createInterface({ input: createReadStream(path, { encoding: "utf8" }), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    const m = parseLine(line, { fileSession, folder });
    if (m === undefined) malformed++;
    if (!m) continue;
    let s = sessions.get(m.sessionId);
    if (!s) sessions.set(m.sessionId, (s = { id: m.sessionId, project: null, messages: [] }));
    if (!s.project && m.project) s.project = m.project;
    s.messages.push(m);
  }
  return { sessions: [...sessions.values()], malformed };
}

/**
 * Import every session file into the brain. Files whose size+mtime did not
 * change since the last import are skipped (pass `full: true` to re-read).
 */
export async function importClaudeCode(brain, { dir = defaultClaudeProjectsDir(), full = false } = {}) {
  const stats = { source: SOURCE, found: existsSync(dir), files: 0, files_skipped: 0, sessions: 0, messages_seen: 0, messages_new: 0, malformed: 0, redactions: {} };
  const touched = new Set();
  for (const file of listSessionFiles(dir)) {
    stats.files++;
    const st = statSync(file.path);
    const stamp = `${st.size}:${Math.round(st.mtimeMs)}`;
    const metaKey = `file:${SOURCE}:${file.path}`;
    if (!full && brain.getMeta(metaKey) === stamp) {
      stats.files_skipped++;
      continue;
    }
    const { sessions, malformed } = await parseFile(file.path, file.folder);
    stats.malformed += malformed;
    for (const s of sessions) {
      const sid = `${SOURCE}:${s.id}`;
      touched.add(sid);
      stats.messages_seen += s.messages.length;
      const { inserted, redactions } = addSession(brain, { id: sid, source: SOURCE, project: s.project }, s.messages);
      stats.messages_new += inserted;
      addCounts(stats.redactions, redactions);
    }
    brain.setMeta(metaKey, stamp);
  }
  stats.sessions = touched.size;
  return stats;
}
