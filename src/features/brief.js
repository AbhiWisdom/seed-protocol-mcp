/**
 * load_soul from the SEED brief (GET /api/v1/me/brief, API 2026-10-26): who the soul is — the AI speaks
 * as it — who the user is, the rules, personal-first memories, the last log and the workspace, in one
 * call. It is the same brief the remote MCP and ChatGPT get. Hybrid adds this device's rows the cloud
 * has not got yet. fetchBrief → null means "stitch the soul from separate calls" (local-only mode, an
 * older API, or hybrid while offline).
 */

const norm = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
const settled = (r) => (r.status === "fulfilled" ? r.value : null);

/** Nothing learned yet → build_soul first. */
export const briefIsFresh = (b) => (b.memories?.length ?? 0) < 3 && !b.last_log && !b.notes?.length;

export async function fetchBrief(api) {
  if (!api.remote) return null;
  try {
    return await api.remote.request("/api/v1/me/brief", { query: { memories: 25 } });
  } catch (err) {
    // NOT_FOUND: an API from before the brief, or no soul yet (the stitched path then says NO_SOUL)
    if (api.hybrid || err.code === "NOT_FOUND" || err.code === "GONE") return null;
    throw err;
  }
}

/** Hybrid: this device's memories and rules that are not in the cloud brief (sync off, or still waiting). */
export async function withThisDevice(api, brief) {
  if (!api.localOnly) return brief;
  const [mem, corr] = await Promise.allSettled([api.localOnly("/memories", { limit: 10 }), api.localOnly("/corrections", { limit: 25 })]);
  const haveMemory = new Set((brief.memories || []).map((m) => norm(m.text)));
  const haveRule = new Set((brief.rules || []).map((r) => norm(`${r.wrong}|${r.instead}`)));
  const memories = (settled(mem)?.memories || []).filter((m) => !haveMemory.has(norm(m.content)))
    .map((m) => ({ text: m.content, category: m.category, importance: m.importance, at: m.created_at, where: "this device" }));
  const rules = (settled(corr)?.corrections || []).filter((c) => !haveRule.has(norm(`${c.original_content}|${c.correction}`)))
    .map((c) => ({ wrong: c.original_content, instead: c.correction, severity: c.severity, where: "this device" }));
  return { ...brief, rules: [...(brief.rules || []), ...rules], memories: [...(brief.memories || []), ...memories] };
}
