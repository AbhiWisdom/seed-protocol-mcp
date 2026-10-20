/**
 * Memory tools: remember, recall, correct. All text is scrubbed before upload.
 */

import { z } from "zod";
import { scrub } from "../scrub.js";
import { READ, WRITE, ok, safe } from "../tool-result.js";

/** Only the fields the model needs (undefined ones drop out of the JSON). */
function compactMemory(m) {
  return { id: m.id, content: m.content, category: m.category, importance: m.importance, score: m.score, created_at: m.created_at };
}

export function registerMemoryTools(server, api) {
  server.registerTool(
    "remember",
    {
      title: "Remember",
      description:
        "Saves a durable memory to the user's soul — a fact, preference, decision or piece of context that should survive across sessions and tools. Use when the user states something worth keeping ('I deploy with pm2', 'my sister is Priya'). Do not store secrets or chit-chat. Secrets are redacted automatically. Writes to the user's soul.",
      inputSchema: {
        content: z.string().min(1).max(10000).describe("What to remember, as a standalone sentence"),
        category: z.string().min(1).max(40).default("general").describe("general, preference, fact, project, person, emotion, skill"),
        importance: z.number().min(0).max(1).default(0.5).describe("0 (trivial) to 1 (critical)"),
      },
      annotations: WRITE,
    },
    safe(async ({ content, category, importance }) =>
      ok(await api.post("/remember", { content: scrub(content), category, importance }), "Memory saved."),
    ),
  );

  server.registerTool(
    "recall",
    {
      title: "Recall",
      description:
        "Searches the user's saved memories (hybrid keyword + semantic). Use before answering anything that may depend on past context, preferences or decisions; empty query returns the most recent memories. Read-only.",
      inputSchema: {
        query: z.string().max(500).default("").describe("Search text (empty = recent memories)"),
        category: z.string().max(40).default("").describe("Optional category filter"),
        limit: z.number().int().min(1).max(100).default(10).describe("Max results (1-100)"),
      },
      annotations: READ,
    },
    safe(async ({ query, category, limit }) => {
      const res = await api.get("/memories", { q: query, category, limit });
      const memories = (res.memories || []).map(compactMemory);
      return ok({ total: res.total ?? memories.length, memories });
    }),
  );

  server.registerTool(
    "correct",
    {
      title: "Record a correction",
      description:
        "Records a mistake and its fix — call it whenever the user corrects you ('no, use pnpm', 'don't write formal English'). Corrections never decay, always rank first in load_soul, and severity escalates automatically when the same mistake repeats. Writes to the user's soul.",
      inputSchema: {
        original: z.string().min(1).max(2000).describe("What was wrong, e.g. 'Used formal English'"),
        correction: z.string().min(1).max(2000).describe("What is right, e.g. 'Always reply in Hinglish'"),
        category: z.string().min(1).max(40).default("behavior").describe("behavior, communication, knowledge, preference, code"),
        severity: z.number().min(0).max(1).default(0.8).describe("0 (minor) to 1 (critical)"),
      },
      annotations: WRITE,
    },
    safe(async ({ original, correction, category, severity }) => {
      const res = await api.post("/correct", { original: scrub(original), correction: scrub(correction), category, severity });
      const note = res.repeated
        ? `Repeated mistake — severity escalated (triggered ${res.times_triggered}x). Do not do this again.`
        : `Correction saved (severity ${res.severity ?? severity}). It will be shown at every session start.`;
      return ok(res, note);
    }),
  );
}
