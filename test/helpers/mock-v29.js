/**
 * The SEED API routes 2.9 talks to (seed-api 2026-10-26), for the mock: the brief, reports,
 * whole-brain search and the workspace. startMockApi({ v29: true }) turns them on; without it
 * the mock is the 2.5 contract, so the stitched load_soul path stays covered.
 */

export function meRoute(method, p, body, state, soul) {
  if (p === "/api/v1/me/brief") {
    if (!soul) return [404, { detail: "No soul yet — create it at https://seed.abhibots.com/onboarding" }];
    return [200, {
      seed_id: soul.id, soul: { name: soul.name },
      identity: { you_are: `${soul.name} — Tester's own AI`, voice: "Speak warmly, in English." },
      user: { name: "Tester" },
      rules: state.corrections.map((c) => ({ wrong: c.original_content, instead: c.correction, severity: c.severity })),
      memories: state.memories.map((m) => ({ text: m.content, category: m.category, importance: m.importance, at: m.created_at })),
      last_log: null, notes: state.kb.map((a) => a.title), workspace: [], how_to: [`You are ${soul.name}.`], team_answers: [],
    }];
  }
  if (p === "/api/v1/me/reports" && method === "POST") {
    const report = { id: state.reports.length + 1, ...body, status: "new" };
    state.reports.push(report);
    return [201, report];
  }
  if (p === "/api/v1/me/reports") return [200, { reports: state.reports }];
  return null;
}

export function seedRoute(method, sub, query, body, state) {
  const ws = state.workspace;
  switch (`${method} ${sub}`) {
    case "GET /search":
      return [200, { query: query.q, results: [{ type: "memory", text: "User deploys with pm2", score: 1 }], counts: { memories: 1 } }];
    case "GET /workspace":
      return [200, { folders: [], files: Object.values(ws).map(({ path, version }) => ({ path, version })) }];
    case "GET /workspace/file":
      return ws[query.path] ? [200, ws[query.path]] : [404, { detail: "No document at that path" }];
    case "PUT /workspace/file": {
      const old = ws[body.path];
      if (old && body.base_version && body.base_version !== old.version) return [409, { detail: { error: "changed_since", current_version: old.version } }];
      ws[body.path] = { path: body.path, body: body.body, title: body.title, version: (old?.version || 0) + 1 };
      return [200, { file: ws[body.path], created: !old }];
    }
    case "POST /workspace/folder":
      return [200, { path: body.path, created: true }];
    case "POST /workspace/move":
      ws[body.to] = { ...ws[body.from], path: body.to };
      delete ws[body.from];
      return [200, { moved: 1, to: body.to }];
    case "DELETE /workspace":
      return [200, { archived: true, to: `archive/${query.path}` }];
    default:
      return null;
  }
}
