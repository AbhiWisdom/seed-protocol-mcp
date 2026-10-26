/**
 * Workspace tools: the user's own file system of Markdown documents, grown by the user and their AIs.
 * ws_tree · ws_read · ws_write · ws_mkdir · ws_move · ws_archive. An AI never deletes: the API archives
 * a document or folder under archive/. Same names and shapes as the remote MCP (seed-api remote_mcp).
 * The workspace lives in the cloud soul, so local-only mode answers LOCAL_MODE with how to switch.
 */

import { z } from "zod";
import { cloudOf } from "../api.js";
import { scrub } from "../scrub.js";
import { READ, WRITE, ok, safe } from "../tool-result.js";

const PATH = z.string().min(1).max(200);

const TOOLS = [
  ["ws_tree", "Workspace tree",
    "Lists the user's workspace — folders and documents (paths, titles, versions, who wrote them). It grows with your work: keep it organised. Read-only.",
    {}, READ, (c) => c.get("/workspace")],
  ["ws_read", "Read a workspace document",
    "Reads one document by path (body, title, version). Send that version as base_version when you edit it. Read-only.",
    { path: PATH.describe("e.g. projects/tiffin-app/README.md") }, READ,
    (c, { path }) => c.get("/workspace/file", { path })],
  ["ws_write", "Write a workspace document",
    "Creates or updates a Markdown document. Put it where it belongs — make folders freely ('projects/<name>/', 'research/…'). When editing, send base_version from ws_read so you never overwrite the user's own change (a 409 means it changed: read it again). Writes to the user's soul.",
    {
      path: PATH.describe("e.g. projects/tiffin-app/README.md (.md or .txt)"),
      body: z.string().max(20000).describe("The whole document (Markdown)"),
      title: z.string().max(200).optional().describe("Optional title (defaults to the file name)"),
      base_version: z.number().int().min(1).optional().describe("The version you read — omit for a new document"),
    }, WRITE,
    (c, { path, body, title, base_version }) =>
      c.put("/workspace/file", { path, body: scrub(body), ...(title ? { title: scrub(title) } : {}), ...(base_version ? { base_version } : {}) })],
  ["ws_mkdir", "Make a folder", "Creates a workspace folder (parents too). Writes to the user's soul.",
    { path: PATH.describe("e.g. research/pricing") }, WRITE,
    (c, { path }) => c.post("/workspace/folder", { path })],
  ["ws_move", "Move or rename", "Moves or renames a document or a whole folder. Writes to the user's soul.",
    { from: PATH, to: PATH }, WRITE,
    (c, args) => c.post("/workspace/move", { from: args.from, to: args.to })],
  ["ws_archive", "Archive",
    "Moves a document or folder under archive/ — out of the way, never lost. You never delete; this is the only way to remove. Writes to the user's soul.",
    { path: PATH }, WRITE,
    (c, { path }) => c.del("/workspace", { path })],
];

export function registerWorkspaceTools(server, api) {
  for (const [name, title, description, inputSchema, annotations, run] of TOOLS) {
    server.registerTool(name, { title, description, inputSchema, annotations }, safe(async (args) => ok(await run(cloudOf(api, name), args))));
  }
}
