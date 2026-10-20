/**
 * `npx seed-protocol-mcp import <claude-code|cursor> [--yes] [--local-only]
 *   [--days N] [--path P] [--full] [--key K] [--api URL]`
 *
 * 1. Parse history into the LOCAL brain (scrubbed, idempotent).
 * 2. Build per-day digests + preference candidates locally.
 * 3. Show a summary and ASK before uploading anything. --local-only never uploads.
 */

import { DASHBOARD_URL, brainPath, resolveAuth } from "../config.js";
import { createApi } from "../api.js";
import { openBrain } from "../brain/db.js";
import { rebuildDays } from "../brain/store.js";
import { defaultClaudeProjectsDir, importClaudeCode } from "./claude-code.js";
import { defaultCursorDbPath, importCursor } from "./cursor.js";
import { SOURCE_LABEL, buildDayDigests, extractPreferences } from "./digest.js";
import { askYesNo, planUpload, runUpload } from "./upload.js";

const IMPORTERS = {
  "claude-code": {
    where: (f) => f.path || defaultClaudeProjectsDir(),
    run: (brain, f) => importClaudeCode(brain, { dir: f.path || defaultClaudeProjectsDir(), full: f.full }),
  },
  cursor: {
    where: (f) => f.path || defaultCursorDbPath(),
    run: (brain, f) => importCursor(brain, { path: f.path || defaultCursorDbPath() }),
  },
};

export const IMPORT_USAGE = `Usage: npx seed-protocol-mcp import <claude-code|cursor> [options]

Options:
  --yes          upload without asking (after the local import)
  --local-only   build the local brain only, never upload
  --days N       upload digests for the last N days (default 30, 0 = all)
  --path P       Claude Code projects dir / Cursor state.vscdb location
  --full         re-read Claude Code files even if unchanged
  --key K        SEED API key (default: SEED_API_KEY or the key saved by setup)`;

function sourceTotals(brain, source) {
  const row = brain.get("SELECT COUNT(*) AS sessions, COALESCE(SUM(messages), 0) AS messages FROM sessions WHERE source = ?", [source]);
  return { sessions: row?.sessions || 0, messages: row?.messages || 0 };
}

function printSummary(log, { label, where, stats, totals, days, digests, prefs, window }) {
  const redacted = Object.entries(stats.redactions);
  log(`\nSEED import — ${label}`);
  log(`  Read from:    ${where}`);
  if (stats.files_skipped) log(`  Files:        ${stats.files} (${stats.files_skipped} unchanged, skipped)`);
  log(`  Sessions:     ${totals.sessions} total · ${stats.messages_new} new messages (${totals.messages} total)`);
  log(`  Days:         ${days.length} with activity · ${digests.length} in the last ${window || "∞"} days`);
  if (redacted.length) {
    const n = redacted.reduce((a, [, c]) => a + c, 0);
    log(`  Redacted:     ${n} secrets (${redacted.map(([k, c]) => `${k}×${c}`).join(", ")})`);
  }
  if (stats.malformed) log(`  Skipped:      ${stats.malformed} malformed lines`);
  log(`  Preferences:  ${prefs.length} candidates`);
  for (const p of prefs.slice(0, 8)) log(`    - ${p.text}${p.count > 1 ? `  (×${p.count})` : ""}`);
  if (prefs.length > 8) log(`    …and ${prefs.length - 8} more`);
  log(`  Local brain:  ${brainPath()} — raw history never leaves this machine.\n`);
}

/**
 * @param {string[]} args positional args after "import"
 * @param {Record<string, any>} flags parsed CLI flags
 * @param {{ log?: Function, err?: Function, input?: any, output?: any }} io
 * @returns {Promise<number>} exit code
 */
export async function runImport(args, flags = {}, io = {}) {
  const log = io.log || console.log;
  const err = io.err || console.error;
  const source = args[0];
  const importer = IMPORTERS[source];
  if (!importer) {
    log(IMPORT_USAGE);
    return source ? 1 : 0;
  }
  const label = SOURCE_LABEL[source];
  const where = importer.where(flags);
  const brain = await openBrain();
  try {
    const stats = await importer.run(brain, flags);
    if (stats.ok === false) {
      log(`${stats.reason}. Nothing imported.`);
      return 0;
    }
    if (!stats.found) {
      log(`No ${label} history found at ${where}. Nothing imported.`);
      return 0;
    }
    const days = rebuildDays(brain, source);
    brain.save();

    const window = flags.days ?? 30;
    const digests = buildDayDigests(brain, source, { days: window });
    const prefs = extractPreferences(brain, source);
    const totals = sourceTotals(brain, source);
    printSummary(log, { label, where, stats, totals, days, digests, prefs, window });

    if (flags.localOnly) {
      log("--local-only: nothing was uploaded.");
      return 0;
    }
    const plan = planUpload(brain, source, digests, prefs);
    if (!plan.logs.length && !plan.memories.length) {
      log("Your SEED dashboard is already up to date — nothing new to upload.");
      return 0;
    }
    const auth = resolveAuth({ key: flags.key, url: flags.api, searchEditors: true });
    if (!auth.apiKey) {
      log(`No SEED API key found, so nothing was uploaded.\nGet your key at ${DASHBOARD_URL}, run: npx seed-protocol-mcp setup <KEY>, then re-run this import.`);
      return 0;
    }
    const question = `Upload ${plan.logs.length} daily logs and ${plan.memories.length} preference memories to your SEED dashboard? (y/N)`;
    if (flags.yes) log(`${question} yes (--yes)`);
    const yes = flags.yes || (await askYesNo(question, io));
    if (!yes) {
      log("Not uploaded. Your history stays in the local brain only.");
      return 0;
    }
    try {
      const done = await runUpload(createApi(auth), brain, source, plan, totals, { log });
      log(`Uploaded ${done.logs} daily logs and ${done.memories} preference memories. Open ${DASHBOARD_URL} to see them.`);
      return 0;
    } catch (e) {
      err(`Upload stopped: [${e.code || "ERROR"}] ${e.message}\nRe-run the same command to resume — finished items are not sent twice.`);
      return 1;
    } finally {
      brain.save();
    }
  } finally {
    brain.close();
  }
}
