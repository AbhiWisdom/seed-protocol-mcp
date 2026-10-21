/**
 * MCP server assembly. Transport-agnostic `createServer(api)` plus the stdio
 * entry `startServer()`. stdout is the JSON-RPC channel — log to stderr only.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createApi } from "./api.js";
import { DASHBOARD_URL, VERSION, resolveAuth } from "./config.js";
import { registerBootstrapPrompt } from "./features/bootstrap.js";
import { registerBuildTool } from "./features/build.js";
import { registerHistoryTools } from "./features/history.js";
import { registerJournalTools } from "./features/journal.js";
import { registerMemoryTools } from "./features/memory.js";
import { registerSkillTools } from "./features/skills.js";
import { registerSoulTools } from "./features/soul.js";

const INSTRUCTIONS = [
  "SEED gives the user's AI a persistent soul.",
  "Call load_soul at the start of every conversation and follow its corrections.",
  "On a new soul (first_run) call build_soul first: preview, ask the user, then upload.",
  "Use remember for durable facts/preferences, correct whenever the user corrects you,",
  "history_search to look up past local sessions, kb_write/kb_search for reusable know-how,",
  "and daily_log at the end of any meaningful session.",
].join(" ");

export function createServer(api) {
  const server = new McpServer({ name: "seed-protocol", version: VERSION }, { instructions: INSTRUCTIONS });
  registerSoulTools(server, api);
  registerMemoryTools(server, api);
  registerSkillTools(server, api);
  registerJournalTools(server, api);
  registerBuildTool(server, api);
  registerHistoryTools(server);
  registerBootstrapPrompt(server);
  return server;
}

export async function startServer() {
  const auth = resolveAuth();
  if (!auth.apiKey) {
    console.error(`SEED_API_KEY not set — get your key at ${DASHBOARD_URL}, then run: npx seed-protocol-mcp setup <KEY>`);
    console.error("Running with local tools only (history_search); soul tools will return NO_KEY.");
  }
  const server = createServer(createApi(auth));
  await server.connect(new StdioServerTransport());
  console.error(`SEED Protocol MCP v${VERSION} running — API ${auth.apiUrl} — key ${auth.apiKey ? "set" : "missing"}`);
  return server;
}
