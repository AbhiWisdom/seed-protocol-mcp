/**
 * search — one search across everything the soul knows: rules, memories, workspace documents (incl. the
 * user's uploads) and the past AI sessions they brought into SEED (GET /seeds/{id}/search). history_search
 * stays this machine's own history and never touches the network. Local-only mode, an API from before
 * /search, or hybrid while offline → this machine's memories and notes.
 */

import { z } from "zod";
import { READ, ok, safe } from "../tool-result.js";

const SNIPPET = 400;

async function searchHere(api, q, limit) {
  const [m, k] = await Promise.all([api.get("/memories", { q, limit }), api.get("/kb", { q, limit })]);
  const memories = (m.memories || []).map((x) => ({ type: "memory", text: x.content, category: x.category, score: x.score }));
  const notes = (k.articles || []).map((a) => ({ type: "document", title: a.title, text: String(a.body || "").slice(0, SNIPPET) }));
  return { query: q, here_only: true, results: [...memories, ...notes].slice(0, limit) };
}

export function registerSearchTool(server, api) {
  server.registerTool(
    "search",
    {
      title: "Search the whole brain",
      description:
        "One search across everything the soul knows — rules, memories, workspace documents (incl. the user's uploads) and the past AI sessions they brought into SEED. Use it before saying you don't know. For this machine's own Claude Code / Cursor history use history_search. Read-only.",
      inputSchema: {
        query: z.string().min(1).max(500).describe("What to look for"),
        limit: z.number().int().min(1).max(40).default(12).describe("Max results (1-40)"),
      },
      annotations: READ,
    },
    safe(async ({ query, limit }) => {
      if (api.remote) {
        try {
          return ok(await api.remote.get("/search", { q: query, limit }));
        } catch (err) {
          const offline = api.hybrid && ["NETWORK", "TIMEOUT"].includes(err.code);
          if (!offline && err.code !== "NOT_FOUND") throw err;
        }
      }
      return ok(await searchHere(api, query, limit), "Searched the memories and notes on this machine.");
    }),
  );
}
