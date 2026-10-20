/**
 * Keyword search over the local brain — no FTS extension needed.
 * SQL narrows to candidate rows (LIKE on any term, newest first), then JS
 * scores them: IDF-weighted term frequency × term coverage × small boosts for
 * exact phrase, the user's own words, and recency.
 */

import { localDay } from "../config.js";

const STOPWORDS = new Set(
  "the a an and or but to of in on at for with from by is are was were be been it this that these those as if then so do does did can could should would will just not no yes you your i me my we our they them their what which who how when where why".split(" "),
);
const MAX_TERMS = 8;
const CANDIDATES = 3000;
const SNIPPET = 260;

export function tokenize(query) {
  const words = String(query || "").toLowerCase().match(/[\p{L}\p{N}_][\p{L}\p{N}_.'-]*/gu) || [];
  const terms = [];
  for (const w of words) {
    const t = w.replace(/[.'-]+$/, "");
    if (t.length < 2 || STOPWORDS.has(t) || terms.includes(t)) continue;
    terms.push(t);
    if (terms.length >= MAX_TERMS) break;
  }
  return terms;
}

const escapeLike = (s) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

function countOccurrences(hay, needle, cap = 5) {
  let n = 0;
  for (let i = hay.indexOf(needle); i !== -1 && n < cap; i = hay.indexOf(needle, i + needle.length)) n++;
  return n;
}

export function makeSnippet(text, terms) {
  const flat = String(text).replace(/\s+/g, " ").trim();
  if (flat.length <= SNIPPET) return flat;
  const lower = flat.toLowerCase();
  const hits = terms.map((t) => lower.indexOf(t)).filter((i) => i >= 0);
  const first = hits.length ? Math.min(...hits) : 0;
  const start = Math.max(0, Math.min(first - 80, flat.length - SNIPPET));
  return `${start > 0 ? "…" : ""}${flat.slice(start, start + SNIPPET)}${start + SNIPPET < flat.length ? "…" : ""}`;
}

/**
 * @param {import('./db.js').Brain} brain
 * @param {{ query?: string, limit?: number, project?: string, days?: number, source?: string, now?: number }} opts
 */
export function searchBrain(brain, { query = "", limit = 10, project, days, source, now = Date.now() } = {}) {
  const terms = tokenize(query);
  const where = [];
  const params = [];
  if (terms.length) {
    where.push(`(${terms.map(() => "lower(m.text) LIKE ? ESCAPE '\\'").join(" OR ")})`);
    params.push(...terms.map((t) => `%${escapeLike(t)}%`));
  }
  if (project) {
    where.push("lower(COALESCE(s.project, '')) LIKE ? ESCAPE '\\'");
    params.push(`%${escapeLike(String(project).toLowerCase())}%`);
  }
  if (days) {
    where.push("m.ts >= ?");
    params.push(new Date(now - days * 86400000).toISOString());
  }
  if (source) {
    where.push("s.source = ?");
    params.push(source);
  }
  const rows = brain.all(
    `SELECT m.session_id AS session_id, m.role AS role, m.ts AS ts, m.text AS text,
            s.project AS project, s.source AS source
       FROM messages m JOIN sessions s ON s.id = m.session_id
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY m.ts DESC LIMIT ${CANDIDATES}`,
    params,
  );

  const lowered = rows.map((r) => String(r.text || "").toLowerCase());
  const df = terms.map((t) => lowered.reduce((n, l) => n + (l.includes(t) ? 1 : 0), 0));
  const N = rows.length || 1;
  const phrase = terms.length > 1 ? String(query).toLowerCase().replace(/\s+/g, " ").trim() : "";

  const scored = rows.map((row, i) => {
    if (!terms.length) return { row, score: 0 }; // no terms → newest first (SQL order)
    const lower = lowered[i];
    let score = 0;
    let matched = 0;
    terms.forEach((t, k) => {
      const tf = countOccurrences(lower, t);
      if (!tf) return;
      matched++;
      score += Math.log(1 + N / (df[k] || 1)) * (1 + Math.log(tf));
    });
    score *= (matched / terms.length) ** 2;
    if (phrase && lower.includes(phrase)) score *= 1.5;
    if (row.role === "user") score *= 1.2;
    const ageDays = row.ts ? Math.max(0, (now - Date.parse(row.ts)) / 86400000) : 365;
    score *= 1 + 0.3 * Math.exp(-ageDays / 30);
    score /= 1 + Math.log(1 + lower.length / 4000);
    return { row, score };
  });

  scored.sort((a, b) => b.score - a.score || String(b.row.ts).localeCompare(String(a.row.ts)));
  const seen = new Set();
  const results = [];
  for (const { row, score } of scored) {
    const snippet = makeSnippet(row.text, terms);
    const key = `${row.session_id}|${snippet}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({
      session_id: String(row.session_id).replace(/^[a-z-]+:/, ""),
      project: row.project || null,
      source: row.source,
      date: row.ts ? localDay(new Date(row.ts)) : null,
      ts: row.ts,
      role: row.role,
      snippet,
      score: Math.round(score * 100) / 100,
    });
    if (results.length >= limit) break;
  }
  return { terms, scanned: rows.length, results };
}
