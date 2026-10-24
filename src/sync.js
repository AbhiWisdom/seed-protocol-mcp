/**
 * `npx seed-protocol-mcp sync` (hybrid mode): push the items that were saved on this
 * device while the cloud was unreachable, for the types the user chose to sync.
 */

import { createModeApi } from "./modeApi.js";

export async function runSync(flags = {}, { log = console.log } = {}) {
  const { mode, api } = createModeApi({ key: flags.key, url: flags.api, searchEditors: true });
  if (mode !== "hybrid") {
    log(`Sync is for hybrid mode (current: ${mode}). Set it up: npx seed-protocol-mcp setup --hybrid YOUR_API_KEY`);
    return mode === "online" ? 0 : 1;
  }
  const policy = await api.policy();
  const { pushed, error } = await api.flush({ max: 500 });
  const left = await api.pendingCounts();
  log("\nSEED sync — this device → cloud");
  for (const [type, on] of Object.entries(policy)) {
    log(`  ${type.padEnd(12)} ${on ? `sync on · ${pushed[type] || 0} sent · ${left[type] || 0} waiting` : `sync off · stays on this device (${left[type] || 0} items)`}`);
  }
  if (error) log(`\nStopped: ${error}. Run it again when the cloud is reachable — nothing is lost.`);
  log("");
  return error ? 1 : 0;
}
