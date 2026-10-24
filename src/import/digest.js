/**
 * Builds what an import MAY upload (only after the user says yes):
 *   • one short digest per local day — sessions, message count, projects
 *     touched, and the first line of each of the user's prompts;
 *   • up to 50 preference candidates — the user's own sentences that carry a
 *     cue like always / never / prefer / instead / hamesha / mat karo.
 * Everything is derived from the (already scrubbed) brain and scrubbed again.
 */

import { localDay } from "../config.js";
import { scrub } from "../scrub.js";

export const SOURCE_LABEL = { "claude-code": "Claude Code", cursor: "Cursor" };
const PROMPTS_PER_DAY = 25;
const PROMPT_CHARS = 160;
const MAX_SUMMARY = 20000;
const MAX_PREFS = 50;

export const PREFERENCE_CUE = /\b(always|never|don'?t|do not|prefer(?:s|red)?|instead|hamesha|kabhi mat|mat karo|nahi chahiye)\b/i;
const CODE_LIKE = /[{};<>]|=>|==|\(\)|^\s*(?:import|export|const|let|var|function|def|class|return|SELECT|INSERT)\b/i;

/** First non-empty line, truncated. */
export function firstLine(text, max = PROMPT_CHARS) {
  const line = String(text || "").split("\n").map((l) => l.trim()).find(Boolean) || "";
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

const norm = (s) => s.toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, " ").replace(/[\s.!,;:]+$/, "").trim();

/**
 * Per-day digests for `source`, newest first. `days` = calendar window
 * (last N days, 0 = all history).
 */
export function buildDayDigests(brain, source, { days = 30, now = Date.now() } = {}) {
  const since = days > 0 ? localDay(new Date(now - (days - 1) * 86400000)) : "";
  const dayRows = brain
    .all("SELECT day, sessions, messages, projects_json FROM days WHERE source = ? AND day >= ? ORDER BY day DESC", [source, since]);
  if (!dayRows.length) return [];
  const wanted = new Map(dayRows.map((r) => [r.day, { ...r, prompts: [], seen: new Set(), userMessages: 0 }]));
  const oldest = dayRows[dayRows.length - 1].day;
  brain.each(
    `SELECT m.ts AS ts, m.text AS text, s.project AS project FROM messages m JOIN sessions s ON s.id = m.session_id
      WHERE s.source = ? AND m.role = 'user' AND m.ts >= ? ORDER BY m.ts`,
    [source, new Date(new Date(`${oldest}T00:00:00`).getTime() - 86400000).toISOString()],
    (row) => {
      const d = wanted.get(localDay(new Date(row.ts)));
      if (!d) return;
      d.userMessages++;
      const line = firstLine(row.text);
      const key = norm(line);
      if (!line || d.seen.has(key) || d.prompts.length >= PROMPTS_PER_DAY) return;
      d.seen.add(key);
      d.prompts.push({ project: row.project, line });
    },
  );
  const label = SOURCE_LABEL[source] || source;
  return [...wanted.values()].map((d) => {
    const projects = JSON.parse(d.projects_json || "[]");
    const lines = [
      `Imported from ${label} history — ${d.day}. Local digest; the raw chats stay on the user's device.`,
      `Sessions: ${d.sessions} · Messages: ${d.messages}${projects.length ? ` · Projects: ${projects.join(", ")}` : ""}`,
    ];
    if (d.prompts.length) {
      lines.push("", "What the user asked for (first line of each prompt):");
      for (const p of d.prompts) lines.push(`- ${p.project ? `[${p.project}] ` : ""}${p.line}`);
      if (d.userMessages > d.prompts.length) lines.push(`- …and ${d.userMessages - d.prompts.length} more messages`);
    }
    const summary = scrub(lines.join("\n")).slice(0, MAX_SUMMARY);
    return {
      day: d.day,
      summary,
      stats: { sessions: d.sessions, messages: d.messages, user_messages: d.userMessages, projects },
    };
  });
}

/** Split text into sentence-ish chunks, ignoring fenced code. */
export function sentences(text) {
  const prose = String(text || "").replace(/```[\s\S]*?```/g, "\n").replace(/[’‘]/g, "'");
  const out = [];
  for (const line of prose.split(/\n+/)) {
    // Split only where punctuation is followed by space, so ".env" or "v2.5" stay intact.
    for (const part of line.split(/(?<=[.!?])\s+/)) {
      const s = part.trim().replace(/^(?:[-*•>]|\d+[.)])\s+/, "");
      if (s) out.push(s);
    }
  }
  return out;
}

// Real preferences are typed in short messages. Long pastes (prompts, skills, docs) and
// tagged system messages are someone else's instructions, not the user's taste.
const MAX_SOURCE_CHARS = 1500;
const isPaste = (text) => text.length > MAX_SOURCE_CHARS || /^\s*</.test(text) || (text.match(/^#{1,6}\s/gm) || []).length >= 2;
const STRUCTURE = /^#{1,6}\s|:\s*$|\|.*\||^(step|block|rule|phase)\b/i;

/** Is this sentence a plausible durable preference? */
export function isPreference(sentence) {
  const s = sentence.trim();
  if (s.length < 12 || s.length > 240 || STRUCTURE.test(s)) return false;
  if (s.endsWith("?") || s.includes("[REDACTED") || CODE_LIKE.test(s)) return false;
  if (s.split(/\s+/).length < 3) return false;
  return PREFERENCE_CUE.test(s);
}

/**
 * Preference candidates from the user's own messages, deduped and ranked by
 * how often they recur, then recency. Returns [{ text, count, last_seen }].
 */
export function extractPreferences(brain, source, { limit = MAX_PREFS } = {}) {
  const found = new Map();
  brain.each(
    `SELECT m.text AS text, m.ts AS ts FROM messages m JOIN sessions s ON s.id = m.session_id
      WHERE s.source = ? AND m.role = 'user' ORDER BY m.ts`,
    [source],
    (row) => {
      if (!row.text || isPaste(row.text)) return;
      for (const raw of sentences(row.text)) {
        const sentence = raw.replace(/\*\*|__/g, "").trim();
        if (!isPreference(sentence)) continue;
        const clean = scrub(sentence);
        if (clean.includes("[REDACTED")) continue; // a sentence that held a secret is never a memory
        const key = norm(sentence);
        const hit = found.get(key);
        if (hit) {
          hit.count++;
          hit.last_seen = row.ts || hit.last_seen;
        } else {
          found.set(key, { text: clean, count: 1, last_seen: row.ts || null });
        }
      }
    },
  );
  return [...found.values()]
    .sort((a, b) => b.count - a.count || String(b.last_seen).localeCompare(String(a.last_seen)))
    .slice(0, Math.min(limit, MAX_PREFS));
}

/** Stable key for "already uploaded" bookkeeping. */
export const preferenceKey = (text) => norm(text);
