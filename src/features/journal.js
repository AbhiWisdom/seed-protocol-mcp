/**
 * Journal tools: daily_log (end-of-session summary), kb_write, kb_search.
 */

import { z } from "zod";
import { localDay } from "../config.js";
import { scrub } from "../scrub.js";
import { READ, WRITE, ok, safe } from "../tool-result.js";

const MAX_SUMMARY = 20000;
const MAX_KB_BODY = 4000; // per article returned by kb_search
const SOURCE = "mcp";
const SEPARATOR = "\n\n---\n\n";

/** "2026-10-21" → "2026-10-22" (calendar arithmetic, timezone-free). */
export function nextDay(day) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Keep the newest text when the combined log would exceed the cap. */
function capSummary(text) {
  if (text.length <= MAX_SUMMARY) return text;
  return `…${text.slice(text.length - (MAX_SUMMARY - 1))}`;
}

async function writeDailyLog(api, { summary, day, mode }) {
  const d = day || localDay();
  let text = scrub(summary).trim();
  let entries = 1;
  if (mode === "append") {
    const { logs = [] } = await api.get("/daily-logs", { limit: 30, before: nextDay(d) });
    const existing = logs.find((l) => l.day === d && l.source === SOURCE);
    if (existing?.summary) {
      if (existing.summary.includes(text)) {
        return ok({ ok: true, day: d, unchanged: true }, "Today's log already contains this summary.");
      }
      text = `${existing.summary}${SEPARATOR}${text}`;
      entries = (Number(existing.stats?.entries) || 1) + 1;
    }
  }
  text = capSummary(text);
  const res = await api.post("/daily-logs", { day: d, source: SOURCE, summary: text, stats: { entries, chars: text.length } });
  return ok(
    { ok: true, day: d, mode, entries, chars: text.length, log_id: res.log?.id, updated_at: res.log?.updated_at },
    `Daily log for ${d} saved (${entries} ${entries === 1 ? "entry" : "entries"}).`,
  );
}

export function registerJournalTools(server, api) {
  server.registerTool(
    "daily_log",
    {
      title: "Write today's daily log",
      description:
        "Call at the END of any meaningful session. Write a concise summary: what was done, key decisions, open problems and next steps (markdown ok, no secrets). It is saved to the user's daily log for today (source 'mcp'): by default appended to what earlier sessions logged today; mode 'replace' overwrites today's mcp log instead. Writes to the user's soul.",
      inputSchema: {
        summary: z.string().min(1).max(MAX_SUMMARY).describe("End-of-session summary: done, decisions, next steps"),
        day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("YYYY-MM-DD; defaults to today in the user's timezone"),
        mode: z.enum(["append", "replace"]).default("append").describe("append (default) or replace today's mcp log"),
      },
      annotations: WRITE,
    },
    safe((args) => writeDailyLog(api, args)),
  );

  server.registerTool(
    "kb_write",
    {
      title: "Write a knowledge-base article",
      description:
        "Adds an article to the user's knowledge base — reusable know-how worth reading again: a setup guide, an architecture decision, a debugging recipe, a project overview. Prefer remember for one-line facts. Search first with kb_search to avoid duplicates. Writes to the user's soul.",
      inputSchema: {
        title: z.string().min(1).max(200).describe("Clear, searchable title"),
        body: z.string().min(1).max(MAX_SUMMARY).describe("Article body (markdown)"),
        tags: z.array(z.string().min(1).max(40)).max(20).default([]).describe("Up to 20 short tags"),
      },
      annotations: WRITE,
    },
    safe(async ({ title, body, tags }) => {
      const res = await api.post("/kb", { title: scrub(title), body: scrub(body), tags: tags.map(scrub) });
      const a = res.article || {};
      return ok({ ok: true, article: { id: a.id, title: a.title, tags: a.tags, updated_at: a.updated_at } }, "Article saved.");
    }),
  );

  server.registerTool(
    "kb_search",
    {
      title: "Search the knowledge base",
      description:
        "Searches the user's knowledge-base articles by title, body and tags (empty q lists the newest). Use when the user asks how something of theirs works or was set up, or before writing a new article. Read-only.",
      inputSchema: {
        q: z.string().max(200).default("").describe("Search text"),
        limit: z.number().int().min(1).max(50).default(10).describe("Max articles (1-50)"),
      },
      annotations: READ,
    },
    safe(async ({ q, limit }) => {
      const { articles = [] } = await api.get("/kb", { q, limit });
      return ok({
        count: articles.length,
        articles: articles.map((a) => ({
          id: a.id,
          title: a.title,
          tags: a.tags,
          auto: a.auto,
          updated_at: a.updated_at,
          body: a.body && a.body.length > MAX_KB_BODY ? `${a.body.slice(0, MAX_KB_BODY)}…` : a.body,
          truncated: Boolean(a.body && a.body.length > MAX_KB_BODY),
        })),
      });
    }),
  );
}
