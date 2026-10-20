/**
 * Writes into the local brain. Every text is scrubbed BEFORE it is stored and
 * every insert is idempotent (stable ids + INSERT OR IGNORE), so re-running an
 * import never duplicates anything.
 */

import { localDay } from "../config.js";
import { scrubWithReport } from "../scrub.js";

/** Normalise any timestamp (ISO string, epoch ms/s) to ISO-8601 UTC or null. */
export function toIso(value) {
  if (value === undefined || value === null || value === "") return null;
  let v = value;
  if (typeof v === "string" && /^\d+$/.test(v)) v = Number(v);
  if (typeof v === "number" && v < 1e12) v *= 1000; // epoch seconds
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Insert one session's messages. `session` = { id, source, project }.
 * `messages` = [{ id, role, ts, text }]. Returns { inserted, redactions }.
 */
export function addSession(brain, session, messages) {
  brain.run(
    `INSERT INTO sessions (id, source, project) VALUES (?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET project = COALESCE(sessions.project, excluded.project)`,
    [session.id, session.source, session.project || null],
  );
  let inserted = 0;
  const redactions = {};
  brain.batch("INSERT OR IGNORE INTO messages (id, session_id, role, ts, text) VALUES (?, ?, ?, ?, ?)", (stmt) => {
    for (const m of messages) {
      if (!m.text) continue;
      const { text, redactions: r } = scrubWithReport(m.text);
      stmt.run([m.id, session.id, m.role, toIso(m.ts), text]);
      if (brain.db.getRowsModified() > 0) {
        inserted++;
        for (const [k, n] of Object.entries(r)) redactions[k] = (redactions[k] || 0) + n;
      }
    }
  });
  refreshSession(brain, session.id);
  return { inserted, redactions };
}

/** Recompute a session's message count and time span from its messages. */
export function refreshSession(brain, sessionId) {
  brain.run(
    `UPDATE sessions SET
       messages = (SELECT COUNT(*) FROM messages WHERE session_id = ?1),
       started_at = (SELECT MIN(ts) FROM messages WHERE session_id = ?1),
       ended_at = (SELECT MAX(ts) FROM messages WHERE session_id = ?1)
     WHERE id = ?1`,
    [sessionId],
  );
}

/**
 * Rebuild the `days` rows for one source from its messages, bucketing by the
 * user's LOCAL calendar day. Returns the day rows, newest first.
 */
export function rebuildDays(brain, source) {
  const byDay = new Map();
  brain.each(
    `SELECT m.ts AS ts, m.session_id AS sid, s.project AS project
       FROM messages m JOIN sessions s ON s.id = m.session_id
      WHERE s.source = ? AND m.ts IS NOT NULL`,
    [source],
    (row) => {
      const day = localDay(new Date(row.ts));
      let d = byDay.get(day);
      if (!d) byDay.set(day, (d = { day, sessions: new Set(), messages: 0, projects: new Set() }));
      d.sessions.add(row.sid);
      d.messages++;
      if (row.project) d.projects.add(row.project);
    },
  );
  const rows = [...byDay.values()]
    .map((d) => ({ day: d.day, source, sessions: d.sessions.size, messages: d.messages, projects: [...d.projects].sort() }))
    .sort((a, b) => (a.day < b.day ? 1 : -1));
  brain.run("DELETE FROM days WHERE source = ?", [source]);
  brain.batch("INSERT INTO days (day, source, sessions, messages, projects_json) VALUES (?, ?, ?, ?, ?)", (stmt) => {
    for (const r of rows) stmt.run([r.day, source, r.sessions, r.messages, JSON.stringify(r.projects)]);
  });
  return rows;
}

/** Totals for `status` and import summaries. */
export function brainCounts(brain) {
  const one = (sql) => brain.get(sql)?.n ?? 0;
  return {
    sessions: one("SELECT COUNT(*) AS n FROM sessions"),
    messages: one("SELECT COUNT(*) AS n FROM messages"),
    days: one("SELECT COUNT(DISTINCT day) AS n FROM days"),
    by_source: brain.all(
      `SELECT s.source AS source, COUNT(DISTINCT s.id) AS sessions, COALESCE(SUM(s.messages), 0) AS messages
         FROM sessions s GROUP BY s.source ORDER BY s.source`,
    ),
  };
}

/** Merge redaction counters in place. */
export function addCounts(target, extra) {
  for (const [k, n] of Object.entries(extra || {})) target[k] = (target[k] || 0) + n;
  return target;
}
