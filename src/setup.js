#!/usr/bin/env node

/**
 * SEED Protocol — One-Command MCP Setup
 * Usage: npx seed-protocol-mcp setup YOUR_API_KEY
 * 
 * Auto-detects and configures: Claude Code, Cursor, Windsurf, VS Code (Cline)
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, platform } from 'node:os';

const HOME = homedir();
const IS_MAC = platform() === 'darwin';
const IS_WIN = platform() === 'win32';

// MCP config to inject
function getMcpConfig(apiKey) {
  return {
    command: "npx",
    args: ["-y", "seed-protocol-mcp@latest"],
    env: {
      SEED_API_KEY: apiKey,
      SEED_API_URL: "https://seed.abhibots.com"
    }
  };
}

// Editor config paths
function getEditorPaths() {
  const appData = IS_MAC
    ? join(HOME, 'Library', 'Application Support')
    : IS_WIN
      ? process.env.APPDATA || join(HOME, 'AppData', 'Roaming')
      : join(HOME, '.config');

  return [
    {
      name: 'Claude Desktop',
      path: IS_MAC
        ? join(appData, 'Claude', 'claude_desktop_config.json')
        : IS_WIN
          ? join(appData, 'Claude', 'claude_desktop_config.json')
          : join(HOME, '.config', 'claude', 'claude_desktop_config.json'),
      key: 'mcpServers',
      serverName: 'seed-protocol'
    },
    {
      name: 'Cursor',
      path: join(HOME, '.cursor', 'mcp.json'),
      key: 'mcpServers',
      serverName: 'seed-protocol'
    },
    {
      name: 'Windsurf',
      path: IS_MAC
        ? join(HOME, '.codeium', 'windsurf', 'mcp_config.json')
        : join(appData, 'Windsurf', 'mcp_config.json'),
      key: 'mcpServers',
      serverName: 'seed-protocol'
    },
    {
      name: 'VS Code (Cline)',
      path: IS_MAC
        ? join(appData, 'Code', 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'settings', 'cline_mcp_settings.json')
        : join(appData, 'Code', 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'settings', 'cline_mcp_settings.json'),
      key: 'mcpServers',
      serverName: 'seed-protocol'
    },
    {
      name: 'Claude Code (CLI)',
      path: join(HOME, '.claude.json'),
      key: 'mcpServers',
      serverName: 'seed-protocol'
    },
  ];
}

function setupEditor(editor, mcpConfig) {
  try {
    let config = {};

    // Read existing config
    if (existsSync(editor.path)) {
      try {
        config = JSON.parse(readFileSync(editor.path, 'utf-8'));
      } catch {
        config = {};
      }
    }

    // Ensure mcpServers exists
    if (!config[editor.key]) {
      config[editor.key] = {};
    }

    // Add seed-protocol
    config[editor.key][editor.serverName] = mcpConfig;

    // Create dir if needed
    const dir = join(editor.path, '..');
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    // Write config
    writeFileSync(editor.path, JSON.stringify(config, null, 2));
    return true;
  } catch (err) {
    return false;
  }
}

// ─── Main ───
function main() {
  const args = process.argv.slice(2);

  // Check if this is a setup command
  if (args[0] !== 'setup') {
    // Not setup mode — run as MCP server (import the main module)
    import('./index.js');
    return;
  }

  const apiKey = args[1] || process.env.SEED_API_KEY;

  console.log('\n🧬 SEED Protocol — MCP Setup\n');

  if (!apiKey) {
    console.log('Usage: npx seed-protocol-mcp setup YOUR_API_KEY');
    console.log('');
    console.log('Get your API key at: https://seed.abhibots.com/create');
    console.log('');
    console.log('Or set environment variable: SEED_API_KEY=your_key');
    process.exit(1);
  }

  const mcpConfig = getMcpConfig(apiKey);
  const editors = getEditorPaths();
  let configured = 0;
  let found = 0;

  console.log('Scanning for code editors...\n');

  for (const editor of editors) {
    const dirExists = existsSync(join(editor.path, '..'));
    const fileExists = existsSync(editor.path);

    if (dirExists || fileExists) {
      found++;
      const success = setupEditor(editor, mcpConfig);
      if (success) {
        configured++;
        console.log(`  ✅ ${editor.name} — configured`);
        console.log(`     ${editor.path}`);
      } else {
        console.log(`  ❌ ${editor.name} — failed (permission error?)`);
      }
    } else {
      console.log(`  ⬜ ${editor.name} — not installed`);
    }
  }

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`Found: ${found} editors | Configured: ${configured}`);

  if (configured > 0) {
    console.log(`\n🎉 Done! Restart your editor to activate the soul.`);
    console.log(`   The AI will auto-load Avni's personality on first message.`);
    console.log(`\n   Tools available:`);
    console.log(`   • load_soul    — Load AI personality`);
    console.log(`   • remember     — Save memories`);
    console.log(`   • recall       — Search memories`);
    console.log(`   • evolve_soul  — Record learned behaviors`);
    console.log(`   • get_skills   — View 200+ skills`);
  } else {
    console.log(`\n⚠️  No supported editors found.`);
    console.log(`   Manually add this to your MCP config:\n`);
    console.log(JSON.stringify({ "seed-protocol": mcpConfig }, null, 2));
  }

  console.log('');
}

main();
