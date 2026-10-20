/**
 * Consent-gated upload of import digests. Only runs after the user typed "y"
 * (or passed --yes). Sends: daily logs (one per day), preference memories,
 * and one import record with counts. Everything is scrubbed once more right
 * before it leaves the machine. Already-uploaded items are remembered in the
 * brain's meta table so re-imports never duplicate memories.
 */

import { createHash } from "node:crypto";
import { createInterface } from "node:readline";
import { withRateLimitRetry } from "../api.js";
import { scrub, scrubDeep } from "../scrub.js";
import { preferenceKey } from "./digest.js";

const hash = (s) => createHash("sha256").update(s).digest("hex").slice(0, 32);
const logKey = (source, day) => `upload:log:${source}:${day}`;
const prefKey = (source, text) => `upload:pref:${source}:${hash(preferenceKey(text))}`;

/** Drop digests whose exact text was already uploaded and prefs already sent. */
export function planUpload(brain, source, digests, prefs) {
  return {
    logs: digests.filter((d) => brain.getMeta(logKey(source, d.day)) !== hash(d.summary)),
    memories: prefs.filter((p) => !brain.getMeta(prefKey(source, p.text))),
  };
}

/**
 * Ask a yes/no question. EOF or anything but y/yes counts as "no".
 * Works with a TTY or piped stdin (`echo y | npx seed-protocol-mcp import …`).
 */
export function askYesNo(question, { input = process.stdin, output = process.stdout } = {}) {
  return new Promise((resolve) => {
    const rl = createInterface({ input, output, terminal: Boolean(input.isTTY) });
    let answered = false;
    rl.on("close", () => {
      if (!answered) {
        output.write("\n");
        resolve(false);
      }
    });
    rl.question(`${question} `, (answer) => {
      answered = true;
      rl.close();
      resolve(/^\s*y(es)?\s*$/i.test(answer));
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Upload the plan. 60 writes/min is the server's ceiling, so big batches are
 * paced and 429s are retried with Retry-After.
 * @returns {Promise<{ logs: number, memories: number }>}
 */
export async function runUpload(api, brain, source, plan, totals, { log = console.log, pace } = {}) {
  const writes = plan.logs.length + plan.memories.length + 1;
  const gap = pace ?? (writes > 50 ? 1100 : 0);
  let last = 0;
  const send = async (suffix, body) => {
    const wait = last + gap - Date.now();
    if (wait > 0) await sleep(wait);
    last = Date.now();
    return withRateLimitRetry(() => api.post(suffix, body));
  };

  const label = `import:${source}`;
  let logs = 0;
  let memories = 0;
  for (const d of plan.logs) {
    await send("/daily-logs", { day: d.day, source: label, summary: scrub(d.summary), stats: scrubDeep(d.stats) });
    brain.setMeta(logKey(source, d.day), hash(d.summary));
    logs++;
    if (logs % 10 === 0) log(`  …${logs}/${plan.logs.length} daily logs`);
  }
  for (const p of plan.memories) {
    await send("/remember", { content: scrub(p.text), category: "preference", importance: 0.6 });
    brain.setMeta(prefKey(source, p.text), "1");
    memories++;
  }
  await send("/imports", {
    source,
    sessions: totals.sessions,
    messages: totals.messages,
    days: logs,
    memories_added: memories,
    corrections_added: 0,
  });
  return { logs, memories };
}
