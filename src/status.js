/**
 * `npx seed-protocol-mcp status` — key present? API reachable? which soul?
 * and what the local brain holds. Never prints a full API key.
 */

import { existsSync, statSync } from "node:fs";
import { createApi } from "./api.js";
import { DASHBOARD_URL, VERSION, brainPath, maskKey, resolveAuth, seedMode } from "./config.js";
import { openBrain } from "./brain/db.js";
import { brainCounts } from "./brain/store.js";
import { createLocalApi, soulPath } from "./local/store.js";
import { createModeApi } from "./modeApi.js";

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

async function localStatus(log) {
  const { counts: c } = await createLocalApi().get("/state");
  log("  Mode:        local-only — nothing is sent to SEED");
  log(`  Local soul:  ${soulPath()}`);
  log(`               ${c.memories} memories · ${c.corrections} corrections · ${c.daily_logs} daily logs · ${c.kb} articles`);
}

export async function runStatus(flags = {}, { log = console.log } = {}) {
  let exit = 0;
  log(`\nSEED Protocol MCP v${VERSION} — status\n`);
  const mode = seedMode();
  if (mode === "local") await localStatus(log);
  else exit = await onlineStatus(flags, log);
  if (mode === "hybrid") await hybridStatus(flags, log);
  return brainStatus(log, exit);
}

async function hybridStatus(flags, log) {
  const { api, mode } = createModeApi({ key: flags.key, url: flags.api, searchEditors: true });
  if (mode !== "hybrid") return;
  const { counts: c } = await createLocalApi().get("/state");
  const [policy, waiting] = await Promise.all([api.policy(), api.pendingCounts()]);
  log("  Mode:        hybrid — soul on this device, synced as chosen in the dashboard");
  log(`  Local soul:  ${soulPath()} · ${c.memories} memories · ${c.corrections} corrections · ${c.daily_logs} daily logs · ${c.kb} articles`);
  log(`  Syncing:     ${Object.entries(policy).filter(([, on]) => on).map(([t]) => t).join(", ") || "nothing"}`);
  const n = Object.values(waiting).reduce((a, b) => a + b, 0);
  if (n) log(`  Waiting:     ${n} items not yet in the cloud — run: npx seed-protocol-mcp sync`);
}

async function onlineStatus(flags, log) {
  const auth = resolveAuth({ key: flags.key, url: flags.api, searchEditors: true });
  let exit = 0;
  log(`  API key:     ${auth.apiKey ? `${maskKey(auth.apiKey)} (from ${auth.keySource})` : `missing — get one at ${DASHBOARD_URL}`}`);
  log(`  API:         ${auth.apiUrl}`);

  if (auth.apiKey) {
    try {
      const me = await createApi({ ...auth, timeoutMs: 10000 }).me();
      log("  Reachable:   yes");
      log(`  Account:     ${me.name || me.email || me.user_id} · ${me.plan || "free"} plan`);
      log(
        `  Soul:        ${me.soul ? `${me.soul.name} (${me.soul.id}) · ${me.memories_count ?? 0} memories` : `none yet — create one at ${DASHBOARD_URL}`}`,
      );
    } catch (err) {
      log(`  Reachable:   no — [${err.code || "ERROR"}] ${err.message}`);
      exit = 1;
    }
  } else {
    log("  Reachable:   not checked (no key)");
  }
  return exit;
}

async function brainStatus(log, exit) {
  const path = brainPath();
  if (!existsSync(path)) {
    log(`  Local brain: empty — run: npx seed-protocol-mcp import claude-code`);
  } else {
    const brain = await openBrain(path, { create: false });
    try {
      const c = brainCounts(brain);
      log(`  Local brain: ${path} (${mb(statSync(path).size)})`);
      log(`               ${c.sessions} sessions · ${c.messages} messages · ${c.days} days`);
      for (const s of c.by_source) log(`               ${s.source}: ${s.sessions} sessions, ${s.messages} messages`);
    } finally {
      brain.close();
    }
  }
  log("");
  return exit;
}
