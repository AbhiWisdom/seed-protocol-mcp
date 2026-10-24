#!/usr/bin/env node

/**
 * seed-protocol-mcp bin.
 *   (no args)              → MCP server over stdio (what MCP clients run)
 *   setup <KEY>            → configure detected MCP clients
 *   import <claude-code|cursor|openclaw> [--yes] [--local-only] [--days N] [--path P]
 *   status                 → key / API / soul / local brain
 * Any other argument also starts the server, exactly like 2.4 did.
 */

import { VERSION } from "./config.js";

const HELP = `SEED Protocol MCP v${VERSION}

  npx -y seed-protocol-mcp                   start the MCP server (stdio)
  npx seed-protocol-mcp setup <KEY>          add SEED to Claude, Cursor, Windsurf, VS Code
  npx seed-protocol-mcp setup --local        same, but the soul stays on this machine (no account)
  npx seed-protocol-mcp import claude-code   build your local brain from Claude Code history
  npx seed-protocol-mcp import cursor        …from Cursor history
  npx seed-protocol-mcp import openclaw      …from an OpenClaw agent's notes (safe on a cron)
  npx seed-protocol-mcp status               check key, API, soul and local brain

Import options: --yes  --local-only  --days N  --path P  --full  --key K
Get your key: https://seed.abhibots.com/login`;

const VALUE_FLAGS = { "--days": "days", "--path": "path", "--key": "key", "--api": "api" };
const BOOL_FLAGS = { "--yes": "yes", "-y": "yes", "--local-only": "localOnly", "--full": "full", "--help": "help", "-h": "help" };

function parseArgs(args) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const [name, inline] = args[i].split(/=(.*)/s);
    if (BOOL_FLAGS[name]) flags[BOOL_FLAGS[name]] = true;
    else if (VALUE_FLAGS[name]) flags[VALUE_FLAGS[name]] = inline ?? args[++i];
    else if (name.startsWith("-")) (flags.unknown ||= []).push(name);
    else positional.push(args[i]);
  }
  if (flags.days !== undefined) {
    const n = Number(flags.days);
    flags.days = Number.isInteger(n) && n >= 0 ? n : NaN;
  }
  return { flags, positional };
}

async function main(argv) {
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case "setup": {
      const { runSetup } = await import("./setup.js");
      return runSetup(argv);
    }
    case "import": {
      const { flags, positional } = parseArgs(rest);
      if (flags.help) {
        const { IMPORT_USAGE } = await import("./import/command.js");
        console.log(IMPORT_USAGE);
        return 0;
      }
      if (flags.unknown || Number.isNaN(flags.days)) {
        console.error(`Bad option: ${flags.unknown?.join(" ") || "--days needs a whole number"}`);
        return 1;
      }
      const { runImport } = await import("./import/command.js");
      return runImport(positional, flags);
    }
    case "status": {
      const { flags } = parseArgs(rest);
      if (flags.help) {
        console.log(HELP);
        return 0;
      }
      const { runStatus } = await import("./status.js");
      return runStatus(flags);
    }
    case "help":
    case "--help":
    case "-h":
      console.log(HELP);
      return 0;
    case "--version":
    case "-v":
      console.log(VERSION);
      return 0;
    default:
      await import("./index.js"); // MCP server; keeps running on stdio
      return null;
  }
}

main(process.argv.slice(2)).then(
  (code) => {
    if (typeof code === "number") process.exitCode = code;
  },
  (err) => {
    console.error(`Error: ${err?.message || err}`);
    process.exitCode = 1;
  },
);
