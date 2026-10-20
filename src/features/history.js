/**
 * history_search — keyword search over the LOCAL brain (~/.seed/brain.sqlite).
 * This tool never makes a network request: the user's raw history stays on
 * their machine. The brain is opened lazily and cached until the file changes.
 */

import { z } from "zod";
import { brainPath } from "../config.js";
import { brainFileStamp, openBrain } from "../brain/db.js";
import { searchBrain } from "../brain/search.js";
import { LOCAL_READ, ok, safe } from "../tool-result.js";

const EMPTY_HINT = "Your local history is empty. Run `npx seed-protocol-mcp import claude-code` (or `import cursor`) in a terminal to build it.";

export function createBrainCache(pathFn = brainPath) {
  let cached = null; // { stamp, brain }
  return async function current() {
    const path = pathFn();
    const stamp = brainFileStamp(path);
    if (!stamp) return null;
    if (cached?.stamp === stamp) return cached.brain;
    cached?.brain.close();
    const brain = await openBrain(path, { create: false });
    cached = brain ? { stamp, brain } : null;
    return brain;
  };
}

export function registerHistoryTools(server) {
  const current = createBrainCache();

  server.registerTool(
    "history_search",
    {
      title: "Search past AI sessions (local)",
      description:
        "Searches the user's past AI-tool sessions (Claude Code, Cursor) stored ONLY on this machine — nothing is sent to any server. Use to recover earlier decisions, commands, errors and preferences instead of asking the user to repeat themselves. Returns snippets with session, project and date; empty query = most recent messages.",
      inputSchema: {
        query: z.string().max(500).default("").describe("Keywords to find, e.g. 'nginx 502 fix' (empty = most recent)"),
        limit: z.number().int().min(1).max(20).default(10).describe("Max results (1-20)"),
        project: z.string().max(200).optional().describe("Only sessions whose project (folder name) contains this"),
        days: z.number().int().min(1).max(3650).optional().describe("Only the last N days"),
      },
      annotations: LOCAL_READ,
    },
    safe(async ({ query, limit, project, days }) => {
      const brain = await current();
      if (!brain) return ok({ local_only: true, results: [], hint: EMPTY_HINT }, EMPTY_HINT);
      const found = searchBrain(brain, { query, limit, project, days });
      return ok(
        { local_only: true, query, terms: found.terms, scanned: found.scanned, count: found.results.length, results: found.results },
        `Searched the local brain (${brainPath()}). Nothing was sent to any server.`,
      );
    }),
  );
}
