/**
 * build_soul — the first job after the MCP is connected: turn what already exists on
 * this machine (Claude Code / Cursor history, an OpenClaw agent's workspace) into the
 * user's soul. upload=false (default) is a local-only preview; upload=true only after
 * the user agreed in chat. Re-runs send only new or changed items.
 */

import { z } from "zod";
import { DASHBOARD_URL } from "../config.js";
import { openBrain } from "../brain/db.js";
import { SOURCES, availableSources, prepare } from "../import/pipeline.js";
import { planSize, runUpload } from "../import/upload.js";
import { WRITE, ok, safe } from "../tool-result.js";

const BATCH = 45; // one call stays under the server's 60 writes/min without pacing

/** Up to n items from a plan: logs first, then memories, then articles. */
export function takeBatch(plan, n = BATCH) {
  const logs = plan.logs.slice(0, Math.max(0, n));
  const memories = plan.memories.slice(0, Math.max(0, n - logs.length));
  const articles = (plan.articles || []).slice(0, Math.max(0, n - logs.length - memories.length));
  return { logs, memories, articles };
}

function preview({ label, where, plan }) {
  const articles = plan.articles || [];
  return {
    source: label,
    read_from: where,
    will_upload: { daily_logs: plan.logs.length, memories: plan.memories.length, articles: articles.length },
    samples: [
      ...plan.memories.slice(0, 5).map((m) => `memory: ${m.text.slice(0, 160)}`),
      ...articles.slice(0, 5).map((a) => `article: ${a.title}`),
      ...plan.logs.slice(-3).map((l) => `daily log: ${l.day}`),
    ],
  };
}

async function buildSoul(api, { upload = false, sources, days }) {
  const picked = sources?.length ? sources : availableSources();
  if (!picked.length) {
    return ok({ found: [] }, "No Claude Code, Cursor or OpenClaw history on this machine. The soul grows from here through remember, correct and daily_log.");
  }
  const brain = await openBrain();
  try {
    const runs = [];
    for (const source of picked) {
      const run = await prepare(brain, source, { days });
      if (run.found && planSize(run.plan)) runs.push(run);
    }
    brain.save();
    if (!runs.length) return ok({ up_to_date: true, checked: picked }, "Everything on this machine is already in the soul — nothing new to upload.");
    if (!upload) {
      const privacy = api.local
        ? "Local-only mode: nothing leaves this machine — this only saves summaries into the local soul file."
        : "Raw history stays on this machine. Only these summaries, notes and memories would be uploaded.";
      return ok(
        { preview: runs.map(preview), privacy },
        "Preview only — nothing was saved. Show the user what was found and ask whether to add it to their SEED soul. If they say yes, call build_soul again with upload=true.",
      );
    }
    let budget = BATCH;
    let remaining = 0;
    const uploaded = [];
    for (const run of runs) {
      const batch = takeBatch(run.plan, budget);
      const n = planSize(batch);
      remaining += planSize(run.plan) - n;
      if (!n) continue;
      budget -= n + 1; // +1 for the import record
      uploaded.push({ source: run.label, ...(await runUpload(api, brain, run.source, batch, run.totals, { log: () => {}, pace: 0 })) });
    }
    const note = remaining
      ? `Uploaded one batch; ${remaining} items left. Wait about a minute (rate limit), then call build_soul with upload=true again.`
      : `Soul built${api.local ? " (local-only, on this machine)" : `. The user can see it at ${DASHBOARD_URL}`}. Continue with their request.`;
    return ok({ uploaded, remaining, dashboard: DASHBOARD_URL }, note);
  } finally {
    brain.save();
    brain.close();
  }
}

export function registerBuildTool(server, api) {
  server.registerTool(
    "build_soul",
    {
      title: "Build the soul from this machine",
      description:
        "Builds the user's soul from what already exists on this machine: Claude Code and Cursor history (daily digests + stated preferences) and an OpenClaw agent's workspace (daily notes, MEMORY.md facts, notes and runbooks). Call it first when load_soul or get_soul_state reports first_run, or when the user asks to import their history. Step 1: upload=false and show the user the preview. Step 2: only if they agree, upload=true. Raw history never leaves the machine; re-runs send only new or changed items.",
      inputSchema: {
        upload: z.boolean().default(false).describe("false (default): local preview only, nothing is sent. true: upload — only after the user said yes to the preview."),
        sources: z.array(z.enum(SOURCES)).max(3).optional().describe("Which history to read. Default: everything found on this machine."),
        days: z.number().int().min(0).max(3650).optional().describe("Claude Code / Cursor: daily digests for the last N days (default 30, 0 = all)"),
      },
      annotations: WRITE,
    },
    safe((args) => buildSoul(api, args)),
  );
}
