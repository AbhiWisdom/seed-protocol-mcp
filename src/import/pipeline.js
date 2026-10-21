/**
 * One import pipeline for the CLI (`import <source>`) and the build_soul tool.
 * prepare() is local-only work: read history, scrub it, build digests, and plan
 * what still has to be uploaded. Uploading is the caller's job, after consent.
 */

import { existsSync } from "node:fs";
import { rebuildDays } from "../brain/store.js";
import { defaultClaudeProjectsDir, importClaudeCode } from "./claude-code.js";
import { defaultCursorDbPath, importCursor } from "./cursor.js";
import { SOURCE_LABEL, buildDayDigests, extractPreferences } from "./digest.js";
import { defaultOpenClawWorkspace, hasOpenClawWorkspace, readOpenClaw } from "./openclaw.js";
import { planUpload } from "./upload.js";

export const SOURCES = ["claude-code", "cursor", "openclaw"];
export const LABEL = { ...SOURCE_LABEL, openclaw: "OpenClaw" };

const SESSION_IMPORTERS = {
  "claude-code": {
    where: (f) => f.path || defaultClaudeProjectsDir(),
    run: (brain, f) => importClaudeCode(brain, { dir: f.path || defaultClaudeProjectsDir(), full: f.full }),
  },
  cursor: {
    where: (f) => f.path || defaultCursorDbPath(),
    run: (brain, f) => importCursor(brain, { path: f.path || defaultCursorDbPath() }),
  },
};

export function whereOf(source, flags = {}) {
  if (source === "openclaw") return flags.path || defaultOpenClawWorkspace();
  return SESSION_IMPORTERS[source].where(flags);
}

/** Sources that exist on this machine (default locations). */
export function availableSources() {
  return SOURCES.filter((s) => (s === "openclaw" ? hasOpenClawWorkspace() : existsSync(whereOf(s))));
}

function sourceTotals(brain, source) {
  const row = brain.get("SELECT COUNT(*) AS sessions, COALESCE(SUM(messages), 0) AS messages FROM sessions WHERE source = ?", [source]);
  return { sessions: row?.sessions || 0, messages: row?.messages || 0 };
}

/**
 * @returns {Promise<object>} { source, label, where, found, reason?, plan, totals, ... }
 *   session sources add { stats, days, digests, prefs, window }; openclaw adds { items }.
 */
export async function prepare(brain, source, flags = {}) {
  const base = { source, label: LABEL[source], where: whereOf(source, flags) };
  if (source === "openclaw") {
    const items = readOpenClaw(base.where);
    if (!items.found) return { ...base, found: false };
    const plan = planUpload(brain, source, items.logs, items.memories, items.articles);
    return { ...base, found: true, items, plan, totals: { sessions: 0, messages: 0 } };
  }
  const stats = await SESSION_IMPORTERS[source].run(brain, flags);
  if (stats.ok === false) return { ...base, found: false, reason: stats.reason };
  if (!stats.found) return { ...base, found: false };
  const days = rebuildDays(brain, source);
  brain.save();
  const window = flags.days ?? 30;
  const digests = buildDayDigests(brain, source, { days: window });
  const prefs = extractPreferences(brain, source);
  const plan = planUpload(brain, source, digests, prefs);
  return { ...base, found: true, stats, days, digests, prefs, window, plan, totals: sourceTotals(brain, source) };
}
