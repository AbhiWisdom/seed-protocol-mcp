/**
 * Runtime configuration. Read lazily (functions, not constants) so tests and
 * CLI flags can change the environment before anything is resolved.
 *
 * Key lookup order: --key flag → SEED_API_KEY env → $SEED_HOME/config.json
 * (written by `setup`) → MCP configs that an older `setup` wrote.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join } from "node:path";

export const VERSION = "2.8.0";
export const DEFAULT_API_URL = "https://seed.abhibots.com";
export const DASHBOARD_URL = "https://seed.abhibots.com/login";

/** Directory that holds the local brain + CLI config (~/.seed by default). */
export function seedHome() {
  return process.env.SEED_HOME || join(homedir(), ".seed");
}

export function brainPath() {
  return join(seedHome(), "brain.sqlite");
}

function configFile() {
  return join(seedHome(), "config.json");
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

/** Saved CLI config ({ api_key, api_url }) or {}. */
export function readSavedConfig() {
  return readJson(configFile()) || {};
}

/** Persist the API key for CLI commands (import/status). File is chmod 600. */
export function saveConfig(patch) {
  const path = configFile();
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const next = { ...readSavedConfig(), ...patch };
  writeFileSync(path, JSON.stringify(next, null, 2), { mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    /* best effort on platforms without chmod */
  }
  return path;
}

/**
 * Local-only mode: the soul lives in ~/.seed/soul.sqlite and nothing is sent to SEED.
 * SEED_MODE=local|online wins; otherwise what `setup --local` saved.
 */
export function localMode() {
  return seedMode() === "local";
}

/** "online" (default) · "local" (nothing sent) · "hybrid" (this device + what the user chose to sync). */
export function seedMode() {
  const env = process.env.SEED_MODE;
  if (["local", "hybrid", "online"].includes(env)) return env;
  const saved = readSavedConfig().mode;
  return ["local", "hybrid"].includes(saved) ? saved : "online";
}

/** MCP client config files `setup` writes into (shared with setup.js). */
export function editorConfigPaths() {
  const home = homedir();
  const isMac = platform() === "darwin";
  const isWin = platform() === "win32";
  const appData = isMac
    ? join(home, "Library", "Application Support")
    : isWin
      ? process.env.APPDATA || join(home, "AppData", "Roaming")
      : join(home, ".config");
  const cline = join(appData, "Code", "User", "globalStorage", "saoudrizwan.claude-dev", "settings", "cline_mcp_settings.json");
  return [
    {
      name: "Claude Desktop",
      path: isMac || isWin
        ? join(appData, "Claude", "claude_desktop_config.json")
        : join(home, ".config", "claude", "claude_desktop_config.json"),
    },
    { name: "Cursor", path: join(home, ".cursor", "mcp.json") },
    {
      name: "Windsurf",
      path: isMac ? join(home, ".codeium", "windsurf", "mcp_config.json") : join(appData, "Windsurf", "mcp_config.json"),
    },
    { name: "VS Code (Cline)", path: cline },
    { name: "Claude Code (CLI)", path: join(home, ".claude.json") },
  ];
}

function keyFromEditorConfigs() {
  for (const editor of editorConfigPaths()) {
    if (!existsSync(editor.path)) continue;
    const env = readJson(editor.path)?.mcpServers?.["seed-protocol"]?.env;
    if (env?.SEED_API_KEY) return { key: env.SEED_API_KEY, url: env.SEED_API_URL, source: editor.name };
  }
  return null;
}

/**
 * Resolve API key + URL. `opts.key` / `opts.url` come from CLI flags.
 * `opts.searchEditors` (CLI only) also looks inside MCP client configs.
 * @returns {{ apiKey: string, apiUrl: string, keySource: string }}
 */
export function resolveAuth(opts = {}) {
  const saved = readSavedConfig();
  let apiKey = opts.key || process.env.SEED_API_KEY || saved.api_key || "";
  let keySource = opts.key ? "--key flag" : process.env.SEED_API_KEY ? "SEED_API_KEY env" : saved.api_key ? configFile() : "";
  let editorUrl;
  if (!apiKey && opts.searchEditors) {
    const found = keyFromEditorConfigs();
    if (found) {
      apiKey = found.key;
      editorUrl = found.url;
      keySource = `${found.source} MCP config`;
    }
  }
  const apiUrl = (opts.url || process.env.SEED_API_URL || saved.api_url || editorUrl || DEFAULT_API_URL).replace(/\/+$/, "");
  return { apiKey, apiUrl, keySource };
}

/** `seed_abcd…wxyz` — never print a full key. */
export function maskKey(key) {
  if (!key) return "(none)";
  if (key.length <= 12) return `${key.slice(0, 3)}…`;
  return `${key.slice(0, 9)}…${key.slice(-4)}`;
}

/** Today's date in the user's local timezone, YYYY-MM-DD. */
export function localDay(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
