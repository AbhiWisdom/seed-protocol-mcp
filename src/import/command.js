/**
 * `npx seed-protocol-mcp import <claude-code|cursor|openclaw> [--yes] [--local-only]
 *   [--days N] [--path P] [--full] [--key K] [--api URL]`
 *
 * 1. Read history into the LOCAL brain (scrubbed, idempotent) — see pipeline.js.
 * 2. Show a summary and ASK before uploading anything. --local-only never uploads.
 * 3. Upload only what changed since the last run, so it is safe on a cron.
 */

import { DASHBOARD_URL, brainPath, resolveAuth } from "../config.js";
import { createApi } from "../api.js";
import { openBrain } from "../brain/db.js";
import { SOURCES, prepare } from "./pipeline.js";
import { askYesNo, planSize, runUpload } from "./upload.js";

export const IMPORT_USAGE = `Usage: npx seed-protocol-mcp import <claude-code|cursor|openclaw> [options]

Options:
  --yes          upload without asking (after the local import)
  --local-only   build the local brain only, never upload
  --days N       upload digests for the last N days (default 30, 0 = all)
  --path P       Claude Code projects dir / Cursor state.vscdb / OpenClaw workspace
  --full         re-read Claude Code files even if unchanged
  --key K        SEED API key (default: SEED_API_KEY or the key saved by setup)

Re-running only uploads what changed, so it is safe to schedule.`;

function printSessionSummary(log, { stats, totals, days, digests, prefs, window }) {
  const redacted = Object.entries(stats.redactions);
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
}

function printOpenClawSummary(log, { items, plan }) {
  log(`  Daily notes:  ${items.logs.length} (${plan.logs.length} new or changed)`);
  log(`  MEMORY.md:    ${items.memories.length} facts (${plan.memories.length} new)`);
  log(`  Articles:     ${items.articles.length} notes + runbooks (${plan.articles.length} new or changed)`);
  for (const a of plan.articles.slice(0, 8)) log(`    - ${a.title}`);
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
  if (!SOURCES.includes(source)) {
    log(IMPORT_USAGE);
    return source ? 1 : 0;
  }
  const brain = await openBrain();
  try {
    const run = await prepare(brain, source, flags);
    if (run.reason) {
      log(`${run.reason}. Nothing imported.`);
      return 0;
    }
    if (!run.found) {
      log(`No ${run.label} history found at ${run.where}. Nothing imported.`);
      return 0;
    }
    log(`\nSEED import — ${run.label}`);
    log(`  Read from:    ${run.where}`);
    if (source === "openclaw") printOpenClawSummary(log, run);
    else printSessionSummary(log, run);
    log(`  Local brain:  ${brainPath()} — raw history never leaves this machine.\n`);

    if (flags.localOnly) {
      log("--local-only: nothing was uploaded.");
      return 0;
    }
    const { plan } = run;
    if (!planSize(plan)) {
      log("Your SEED dashboard is already up to date — nothing new to upload.");
      return 0;
    }
    const auth = resolveAuth({ key: flags.key, url: flags.api, searchEditors: true });
    if (!auth.apiKey) {
      log(`No SEED API key found, so nothing was uploaded.\nGet your key at ${DASHBOARD_URL}, run: npx seed-protocol-mcp setup <KEY>, then re-run this import.`);
      return 0;
    }
    const what = source === "openclaw"
      ? `${plan.logs.length} daily logs, ${plan.memories.length} memories and ${plan.articles.length} knowledge articles`
      : `${plan.logs.length} daily logs and ${plan.memories.length} preference memories`;
    const question = `Upload ${what} to your SEED dashboard? (y/N)`;
    if (flags.yes) log(`${question} yes (--yes)`);
    const yes = flags.yes || (await askYesNo(question, io));
    if (!yes) {
      log("Not uploaded. Your history stays in the local brain only.");
      return 0;
    }
    try {
      const done = await runUpload(createApi(auth), brain, source, plan, run.totals, { log });
      const sent = source === "openclaw"
        ? `${done.logs} daily logs, ${done.memories} memories and ${done.articles} knowledge articles`
        : `${done.logs} daily logs and ${done.memories} preference memories`;
      log(`Uploaded ${sent}. Open ${DASHBOARD_URL} to see them.`);
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
