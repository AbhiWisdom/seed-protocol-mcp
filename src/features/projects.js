/**
 * Project tools (2.10.0): a project is the workspace folder projects/<slug>/, described by the
 * front-matter of its README.md — status, repo, live, hosting, stack, now. `projects` lists them;
 * `project_update` merges fields into that front-matter and keeps the README's text. Same names and
 * shapes as the remote MCP. Cloud soul only, like the workspace (local-only mode → LOCAL_MODE).
 */

import { z } from "zod";
import { cloudOf } from "../api.js";
import { scrub } from "../scrub.js";
import { READ, WRITE, ok, safe } from "../tool-result.js";

const LINE = z.string().max(200);
const FIELDS = ["name", "status", "repo", "live", "hosting", "stack", "now", "about"];
// slugged here as the API does: a raw "../profile" must never reach another route
export const slugify = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

export function registerProjectTools(server, api) {
  server.registerTool("projects", {
    title: "Projects",
    description: "The user's projects — status, repo, live URL, stack and what's happening now (each is the workspace folder projects/<slug>/). Read-only.",
    inputSchema: {},
    annotations: READ,
  }, safe(async () => ok(await cloudOf(api, "projects").get("/projects"))));

  server.registerTool("project_update", {
    title: "Update a project",
    description: "Creates or updates a project's card: the front-matter of projects/<slug>/README.md (the README's text is kept unless you send `about`). "
      + "Call it when a project starts, or its repo, live URL, stack or current step changes. Writes to the user's soul.",
    inputSchema: {
      slug: z.string().min(1).max(60).describe("e.g. tiffin-app"),
      name: z.string().max(120).optional(),
      status: z.enum(["active", "paused", "idea", "done"]).optional(),
      repo: LINE.optional().describe("owner/name or a URL"),
      live: LINE.optional(),
      hosting: LINE.optional(),
      stack: LINE.optional(),
      now: LINE.optional().describe("What's happening right now — one line"),
      about: z.string().max(15000).optional().describe("Replaces the README text; omit to keep it"),
    },
    annotations: WRITE,
  }, safe(async (args) => {
    const slug = slugify(args.slug);
    if (!slug) throw new Error("slug needs letters or digits, e.g. tiffin-app");
    const body = {};
    for (const k of FIELDS) if (args[k] !== undefined) body[k] = scrub(args[k]);
    return ok(await cloudOf(api, "project_update").put(`/projects/${slug}`, body));
  }));
}
