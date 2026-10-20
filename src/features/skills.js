/**
 * get_skills — the skill registry attached to SEED souls (cached per process).
 */

import { z } from "zod";
import { READ, ok, safe } from "../tool-result.js";

export function registerSkillTools(server, api) {
  let cache = null;

  server.registerTool(
    "get_skills",
    {
      title: "List skills",
      description:
        "Lists the skills available to the soul, grouped by category (frontend, backend, ai, security, devops, mobile…). Skills marked auto_apply activate automatically. Use to see which expertise you can draw on. Read-only.",
      inputSchema: {
        category: z.string().max(60).default("").describe("Optional category filter, e.g. 'frontend'"),
      },
      annotations: READ,
    },
    safe(async ({ category }) => {
      if (!cache) cache = await api.request("/api/v1/skills");
      const cats = cache.categories || {};
      const wanted = String(category || "").toLowerCase();
      const entries = Object.entries(cats).filter(([k]) => !wanted || k.toLowerCase().includes(wanted));
      return ok({
        total_skills: cache.total ?? Object.values(cats).reduce((n, list) => n + list.length, 0),
        categories_shown: entries.length,
        skills: entries.map(([cat, list]) => ({
          category: cat,
          count: list.length,
          skills: list.map((s) => ({ name: s.name, description: s.description, auto_apply: Boolean(s.auto_apply) })),
        })),
        note: "When the user asks about any of these topics, apply that skill's expertise. auto_apply skills are always active.",
      });
    }),
  );
}
