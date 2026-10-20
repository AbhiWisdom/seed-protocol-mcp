/**
 * `npx seed-protocol-mcp setup YOUR_API_KEY`
 * Adds the seed-protocol MCP server to every detected client config:
 * Claude Desktop, Cursor, Windsurf, VS Code (Cline), Claude Code (CLI).
 * Also saves the key to ~/.seed/config.json (chmod 600) for the CLI commands.
 */

import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DASHBOARD_URL, DEFAULT_API_URL, editorConfigPaths, saveConfig } from "./config.js";

const SERVER_NAME = "seed-protocol";

/** MCP server entry injected into each client config (unchanged since 2.2). */
export function getMcpConfig(apiKey) {
  return {
    command: "npx",
    args: ["-y", "seed-protocol-mcp@latest"],
    env: { SEED_API_KEY: apiKey, SEED_API_URL: DEFAULT_API_URL },
  };
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

/**
 * @param {string[]} args argv after the bin name, e.g. ["setup", "seed_…"]
 * @returns {number} exit code
 */
export function runSetup(args, { log = console.log } = {}) {
  const apiKey = args[1] || process.env.SEED_API_KEY;
  log("\n🧬 SEED Protocol — MCP Setup\n");
  if (!apiKey) {
    log("Usage: npx seed-protocol-mcp setup YOUR_API_KEY\n");
    log(`Get your API key from your dashboard: ${DASHBOARD_URL}\n`);
    log("Or set environment variable: SEED_API_KEY=your_key");
    return 1;
  }

  const mcpConfig = getMcpConfig(apiKey);
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

  try {
    const saved = saveConfig({ api_key: apiKey, api_url: DEFAULT_API_URL });
    log(`\n  Key saved for CLI commands (import, status): ${saved}`);
  } catch {
    log("\n  Could not save the key for CLI commands — pass --key to import/status instead.");
  }

  log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  log(`Found: ${found} editors | Configured: ${configured}`);
  if (configured > 0) {
    log("\n🎉 Done! Restart your editor to activate your soul.");
    log("   The AI loads your soul (load_soul) at the start of each conversation.");
    log("\n   Tools: load_soul · remember · recall · correct · evolve_soul · get_soul_state");
    log("          daily_log · kb_write · kb_search · history_search (local) · get_skills");
    log("\n   Next: build your soul from past sessions (stays local until you say yes):");
    log("     npx seed-protocol-mcp import claude-code");
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
