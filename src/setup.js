/**
 * `npx seed-protocol-mcp setup YOUR_API_KEY`
 * Adds the seed-protocol MCP server to every detected client config:
 * Claude Desktop, Cursor, Windsurf, VS Code (Cline), Claude Code (CLI).
 * Also saves the key to ~/.seed/config.json (chmod 600) for the CLI commands.
 */

import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { dashboardUrl, DEFAULT_API_URL, editorConfigPaths, saveConfig, seedHome } from "./config.js";

const SERVER_NAME = "seed-protocol";

/** MCP server entry injected into each client config (unchanged since 2.2). */
export function getMcpConfig(apiKey, { local = false, hybrid = false } = {}) {
  const env = local ? { SEED_MODE: "local" } : { SEED_API_KEY: apiKey, SEED_API_URL: DEFAULT_API_URL };
  if (hybrid) env.SEED_MODE = "hybrid";
  return { command: "npx", args: ["-y", "seed-protocol-mcp@latest"], env };
}

function setupEditor(path, mcpConfig) {
  try {
    let config = {};
    if (existsSync(path)) {
      try {
        config = JSON.parse(readFileSync(path, "utf-8"));
      } catch {
        config = {};
      }
    }
    if (!config.mcpServers) config.mcpServers = {};
    config.mcpServers[SERVER_NAME] = mcpConfig;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(config, null, 2));
    return true;
  } catch {
    return false;
  }
}

const SETUP_USAGE = `Usage: npx seed-protocol-mcp setup YOUR_API_KEY
       npx seed-protocol-mcp setup --local    keep the soul on this machine only (no account, nothing sent)
       npx seed-protocol-mcp setup --hybrid YOUR_API_KEY   soul on this machine + sync what you choose

Get your API key from your dashboard: ${dashboardUrl()}
Or set environment variable: SEED_API_KEY=your_key`;

/**
 * @param {string[]} args argv after the bin name, e.g. ["setup", "seed_…"]
 * @returns {number} exit code
 */
export function runSetup(args, { log = console.log } = {}) {
  const arg = args[1];
  // A flag is never a key: writing "--help" into every editor config would break a working setup.
  if (arg === "--help" || arg === "-h") {
    log(SETUP_USAGE);
    return 0;
  }
  if (arg === "--local") return runLocalSetup(log);
  if (arg === "--hybrid") return runHybridSetup(args[2] || process.env.SEED_API_KEY, log);
  if (arg?.startsWith("-")) {
    log(`Bad option: ${arg}\n\n${SETUP_USAGE}`);
    return 1;
  }
  const apiKey = arg || process.env.SEED_API_KEY;
  log("\n🧬 SEED Protocol — MCP Setup\n");
  if (!apiKey) {
    log(SETUP_USAGE);
    return 1;
  }

  const mcpConfig = getMcpConfig(apiKey);
  const { found, configured } = configureEditors(mcpConfig, log);

  try {
    const saved = saveConfig({ api_key: apiKey, api_url: DEFAULT_API_URL, mode: "online" });
    log(`\n  Key saved for CLI commands (import, status): ${saved}`);
  } catch {
    log("\n  Could not save the key for CLI commands — pass --key to import/status instead.");
  }
  return finish(found, configured, mcpConfig, log, false);
}

/** Local-only: the soul lives in ~/.seed/soul.sqlite; no key, no account, nothing sent. */
function runLocalSetup(log) {
  log("\n🧬 SEED Protocol — local-only setup\n");
  const mcpConfig = getMcpConfig(null, { local: true });
  const { found, configured } = configureEditors(mcpConfig, log);
  saveConfig({ mode: "local" });
  log(`\n  Your soul will live in ${join(seedHome(), "soul.sqlite")} — nothing is sent to SEED.`);
  log("  Switch to the online dashboard any time: npx seed-protocol-mcp setup YOUR_API_KEY");
  return finish(found, configured, mcpConfig, log, true);
}

/** Hybrid: soul on this device; the types ticked in the dashboard are copied to the cloud. */
function runHybridSetup(apiKey, log) {
  log("\n🧬 SEED Protocol — hybrid setup\n");
  if (!apiKey || apiKey.startsWith("-")) {
    log(SETUP_USAGE);
    return 1;
  }
  const mcpConfig = getMcpConfig(apiKey, { hybrid: true });
  const { found, configured } = configureEditors(mcpConfig, log);
  saveConfig({ api_key: apiKey, api_url: DEFAULT_API_URL, mode: "hybrid" });
  log(`\n  Your soul lives in ${join(seedHome(), "soul.sqlite")}. What syncs to the cloud is your choice:`);
  log(`  ${dashboardUrl().replace("/login", "/dashboard?tab=privacy")} → Devices & sync. Push waiting items: npx seed-protocol-mcp sync`);
  return finish(found, configured, mcpConfig, log, false);
}

function configureEditors(mcpConfig, log) {
  let configured = 0;
  let found = 0;
  log("Scanning for code editors...\n");
  for (const editor of editorConfigPaths()) {
    if (existsSync(join(editor.path, "..")) || existsSync(editor.path)) {
      found++;
      if (setupEditor(editor.path, mcpConfig)) {
        configured++;
        log(`  ✅ ${editor.name} — configured`);
        log(`     ${editor.path}`);
      } else {
        log(`  ❌ ${editor.name} — failed (permission error?)`);
      }
    } else {
      log(`  ⬜ ${editor.name} — not installed`);
    }
  }
  return { found, configured };
}

function finish(found, configured, mcpConfig, log, local) {
  log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  log(`Found: ${found} editors | Configured: ${configured}`);
  if (configured > 0) {
    log("\n🎉 Done! Restart your editor to activate your soul.");
    log("   The AI loads your soul (load_soul) at the start of each conversation.");
    log("\n   Tools: load_soul · build_soul · remember · recall · correct · evolve_soul · get_soul_state");
    log("          daily_log · kb_write · kb_search · history_search (local) · get_skills");
    log("\n   In your first chat the AI offers build_soul: it reads your past sessions on this machine,");
    log(local ? "   shows a preview, and saves only what you approve — into the local soul file."
      : "   shows a preview, and uploads only what you approve. Terminal: npx seed-protocol-mcp import claude-code");
  } else {
    log("\n⚠️  No supported editors found.");
    log("   Manually add this to your MCP config:\n");
    log(JSON.stringify({ [SERVER_NAME]: mcpConfig }, null, 2));
  }
  log("");
  return 0;
}

// Back-compat: 2.4 shipped this file as the bin. Run directly, it behaves like the CLI.
function isMain() {
  try {
    return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}
if (isMain()) import("./cli.js");
