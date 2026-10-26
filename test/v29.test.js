/**
 * 2.9 over stdio against the 2026-10 API (mock v29): load_soul is the brief (the AI is the soul), every
 * request names the app (X-Seed-Client), the workspace / search / report tools hit the right routes,
 * the input limits match the API, and local-only mode answers the cloud-only tools with LOCAL_MODE.
 */

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { withThisDevice } from "../src/features/brief.js";
import { dashboardUrl } from "../src/config.js";
import { FAKE } from "./helpers/fixtures.js";
import { SOUL_ID, TEST_KEY, startMockApi } from "./helpers/mock-api.js";
import { CLI, sandboxEnv } from "./helpers/run-cli.js";

async function connect(env, name = "Claude Code") {
  const client = new Client({ name, version: "1.0.0" });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [CLI], env, stderr: "pipe" }));
  return client;
}
const call = (client, name, args = {}) => client.callTool({ name, arguments: args });
const seedReqs = (mock, method, suffix) => mock.requests.filter((r) => r.method === method && r.path === `/api/v1/seeds/${SOUL_ID}${suffix}`);

describe("2.9 against the 2026-10 API", () => {
  let mock;
  let client;

  before(async () => {
    mock = await startMockApi({ v29: true });
    client = await connect(sandboxEnv({ SEED_API_URL: mock.url, SEED_API_KEY: TEST_KEY }));
  });
  after(async () => {
    await client?.close();
    await mock?.close();
  });

  test("load_soul is the brief: the AI is told who it is, in one call", async () => {
    mock.reset();
    const res = await call(client, "load_soul");
    assert.ok(!res.isError, res.content[0].text);
    assert.match(res.content[0].text, /^You are Nova — speak as Nova/);
    assert.equal(res.structuredContent.identity.you_are, "Nova — Tester's own AI");
    assert.equal(res.structuredContent.rules[0].instead, "Reply in Hinglish");
    assert.ok(res.structuredContent.security, "the confidentiality note stays");
    assert.deepEqual(mock.requests.map((r) => r.path), ["/api/v1/me/brief"]);
    assert.equal(mock.requests[0].query.memories, "25");
  });

  test("every request names the app (X-Seed-Client)", async () => {
    await call(client, "recall", { query: "pm2" });
    assert.ok(mock.requests.length > 0);
    for (const r of mock.requests) assert.equal(r.headers["x-seed-client"], "Claude Code");
  });

  test("workspace tools: tree, write (scrubbed), read, edit with base_version, 409, mkdir, move, archive", async () => {
    assert.ok(!(await call(client, "ws_tree")).isError);
    const w = await call(client, "ws_write", { path: "projects/tiffin/README.md", body: `token ${FAKE.SLACK_TOKEN}` });
    assert.ok(!w.isError, w.content[0].text);
    assert.match(seedReqs(mock, "PUT", "/workspace/file").at(-1).body.body, /\[REDACTED:slack_token\]/);
    const r = await call(client, "ws_read", { path: "projects/tiffin/README.md" });
    assert.equal(r.structuredContent.version, 1);
    assert.ok(!(await call(client, "ws_write", { path: "projects/tiffin/README.md", body: "v2", base_version: 1 })).isError);
    const stale = await call(client, "ws_write", { path: "projects/tiffin/README.md", body: "v3", base_version: 1 });
    assert.equal(stale.isError, true);
    assert.match(stale.content[0].text, /409/);
    assert.ok(!(await call(client, "ws_mkdir", { path: "research" })).isError);
    assert.ok(!(await call(client, "ws_move", { from: "projects/tiffin/README.md", to: "research/tiffin.md" })).isError);
    assert.deepEqual(seedReqs(mock, "POST", "/workspace/move").at(-1).body, { from: "projects/tiffin/README.md", to: "research/tiffin.md" });
    const a = await call(client, "ws_archive", { path: "research/tiffin.md" });
    assert.ok(!a.isError);
    assert.equal(seedReqs(mock, "DELETE", "").length, 0);
    assert.equal(seedReqs(mock, "DELETE", "/workspace").at(-1).query.path, "research/tiffin.md");
  });

  test("search asks the whole brain; send_report and my_reports reach the team", async () => {
    const s = await call(client, "search", { query: "deploy" });
    assert.equal(s.structuredContent.results[0].type, "memory");
    assert.equal(seedReqs(mock, "GET", "/search").at(-1).query.q, "deploy");
    const sent = await call(client, "send_report", { kind: "bug", title: "ws_move fails", body: `key ${FAKE.SLACK_TOKEN}`, where: "ws_move" });
    assert.ok(!sent.isError, sent.content[0].text);
    assert.match(mock.state.reports[0].body, /\[REDACTED:slack_token\]/);
    assert.equal((await call(client, "my_reports")).structuredContent.reports.length, 1);
  });

  test("limits match the API: remember ≤ 5,000 chars; daily_log refuses impossible and future days", async () => {
    const before = mock.requests.length;
    assert.equal((await call(client, "remember", { content: "x".repeat(5001) })).isError, true);
    for (const day of ["2026-13-45", "2026-02-30", "2999-01-01"]) {
      const res = await call(client, "daily_log", { summary: "x", day });
      assert.equal(res.isError, true, day);
      assert.match(res.content[0].text, /BAD_REQUEST/);
    }
    assert.equal(mock.requests.length, before, "nothing invalid reaches the API");
    const ok = await call(client, "daily_log", { summary: "Shipped 2.9" });
    assert.equal(ok.structuredContent.source, "claude-code");
  });
});

test("an API from before the brief → the stitched soul, still told who it is", async () => {
  const mock = await startMockApi();
  const client = await connect(sandboxEnv({ SEED_API_URL: mock.url, SEED_API_KEY: TEST_KEY }));
  try {
    const res = await call(client, "load_soul");
    assert.ok(!res.isError, res.content[0].text);
    assert.match(res.structuredContent.identity.you_are, /^Nova — the user's own AI/);
    assert.match(res.structuredContent.session_protocol[0], /^You are Nova/);
    const s = await call(client, "search", { query: "pm2" });
    assert.equal(s.structuredContent.here_only, true, "no /search → memories and notes");
  } finally {
    await client.close();
    await mock.close();
  }
});

test("local-only mode: cloud-only tools answer LOCAL_MODE and send nothing", async () => {
  const mock = await startMockApi({ v29: true });
  const client = await connect(sandboxEnv({ SEED_MODE: "local", SEED_API_URL: mock.url, SEED_API_KEY: TEST_KEY }));
  try {
    for (const [name, args] of [["ws_tree", {}], ["ws_write", { path: "a.md", body: "x" }], ["send_report", { kind: "idea", title: "hello", body: "x" }]]) {
      const res = await call(client, name, args);
      assert.equal(res.isError, true, name);
      assert.match(res.content[0].text, /^Error \[LOCAL_MODE\]/);
    }
    assert.ok(!(await call(client, "search", { query: "anything" })).isError, "search works locally");
    assert.equal(mock.requests.length, 0);
  } finally {
    await client.close();
    await mock.close();
  }
});

test("hybrid: this device's rules and memories the cloud lacks join the brief", async () => {
  const brief = { rules: [{ wrong: "npm", instead: "pnpm" }], memories: [{ text: "Sister is Priya" }] };
  const api = {
    localOnly: async (suffix) => (suffix === "/memories"
      ? { memories: [{ content: "sister is  priya" }, { content: "Uses a Mac", category: "fact" }] }
      : { corrections: [{ original_content: "npm", correction: "pnpm" }, { original_content: "tabs", correction: "spaces" }] }),
  };
  const out = await withThisDevice(api, brief);
  assert.deepEqual(out.memories.map((m) => m.text), ["Sister is Priya", "Uses a Mac"]);
  assert.deepEqual(out.rules.map((r) => r.instead), ["pnpm", "spaces"]);
  assert.equal(out.rules[1].where, "this device");
});

test("the dashboard follows the API in use; SEED_DASHBOARD_URL wins", () => {
  assert.equal(dashboardUrl("https://seed.example.org/"), "https://seed.example.org/login");
  process.env.SEED_DASHBOARD_URL = "https://app.example.org/login";
  try {
    assert.equal(dashboardUrl("https://seed.example.org"), "https://app.example.org/login");
  } finally {
    delete process.env.SEED_DASHBOARD_URL;
  }
});
