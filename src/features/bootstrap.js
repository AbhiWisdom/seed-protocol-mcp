/**
 * seed_bootstrap prompt — turns local history into durable soul knowledge.
 */

import { z } from "zod";

export function bootstrapText(days = "14") {
  return `You are bootstrapping my SEED soul from my recent AI-tool history. Work through these steps with the SEED tools:

1. Call load_soul. Note the existing memories and corrections so you do not duplicate them.
2. Call history_search with days=${days} and an empty query to see my recent work, then run 4-8 focused searches (limit 20) for durable signals, for example: "always", "never", "prefer", "don't", "instead", "hamesha", "mat karo", plus the names of the projects you saw.
3. For every DURABLE preference I stated (tools, style, language, workflow, stack), call remember with category "preference" and importance 0.6-0.8. One clear standalone sentence each. Skip one-off task instructions and anything already saved (check with recall if unsure).
4. For every mistake I corrected (an AI did X, I said do Y), call correct with original = what was wrong and correction = what is right.
5. For each active project, if nothing exists yet (kb_search), call kb_write with a short overview: what it is, stack, where it runs, conventions.
6. Finally call daily_log with a summary of this bootstrap: how many preferences, corrections and articles you added, and the main themes.

Rules: never store secrets, tokens, passwords or personal data of other people; keep each memory short and factual; prefer fewer, high-quality entries (aim for 10-30 memories total).`;
}

export function registerBootstrapPrompt(server) {
  server.registerPrompt(
    "seed_bootstrap",
    {
      title: "Bootstrap my soul from history",
      description: "Mine the local AI-session history for durable preferences and past corrections, save them to the soul, then write today's daily log.",
      argsSchema: {
        days: z.string().regex(/^\d{1,4}$/).optional().describe("How many days of history to review (default 14)"),
      },
    },
    ({ days }) => ({
      description: "Bootstrap the SEED soul from local history",
      messages: [{ role: "user", content: { type: "text", text: bootstrapText(days || "14") } }],
    }),
  );
}
