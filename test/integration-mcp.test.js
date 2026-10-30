/**
 * End-to-end: real MCP server (src/cli.js, no args) over stdio, driven by the
 * SDK client, talking to a mock SEED API. Covers every tool + the prompt.
 */

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ALL_FAKE_SECRETS, FAKE, claudeProjectsFixture } from "./helpers/fixtures.js";
import { SOUL_ID, TEST_KEY, startMockApi } from "./helpers/mock-api.js";
import { CLI, runCli, sandboxEnv } from "./helpers/run-cli.js";

const EXPECTED_TOOLS = ["build_soul", "correct", "daily_log", "evolve_soul", "get_skills", "get_soul_state", "history_search", "kb_search", "kb_write", "load_soul",
  "my_reports", "project_update", "projects", "recall", "remember", "search", "send_report", "ws_archive", "ws_mkdir", "ws_move", "ws_read", "ws_tree", "ws_write"];
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

async function connect(env) {
  const transport = new StdioClientTransport({ command: process.execPath, args: [CLI], env, stderr: "pipe" });
  const client = new Client({ name: "seed-test", version: "1.0.0" });
  await client.connect(transport);
  return client;
}

const call = (client, name, args = {}) => client.callTool({ name, arguments: args });
const data = (res) => res.structuredContent;
const sent = (mock, method, suffix) => mock.requests.filter((r) => r.method === method && r.path === `/api/v1/seeds/${SOUL_ID}${suffix}`);
const outbound = (mock) => mock.requests.map((r) => r.raw + JSON.stringify(r.query)).join("\n");

describe("MCP server over stdio", () => {
  let mock;
  let client;
  let env;

  before(async () => {
    mock = await startMockApi();
    env = sandboxEnv({ SEED_API_URL: mock.url, SEED_API_KEY: TEST_KEY });
    const imp = await runCli(["import", "claude-code", "--path", claudeProjectsFixture(), "--local-only"], { env });
    assert.equal(imp.code, 0, imp.stderr);
    assert.match(imp.stdout, /--local-only: nothing was uploaded/);
    assert.equal(mock.requests.length, 0, "a local-only import must not call the API");
    client = await connect(env);
  });

  after(async () => {
    await client?.close();
    await mock?.close();
  });

  test("lists every tool with annotations, and the bootstrap prompt", async () => {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), EXPECTED_TOOLS);
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    assert.equal(byName.history_search.annotations.readOnlyHint, true);
    assert.equal(byName.history_search.annotations.openWorldHint, false);
    assert.equal(byName.remember.annotations.readOnlyHint, false);
    assert.match(byName.load_soul.description, /FIRST/);
    assert.match(byName.daily_log.description, /END of any meaningful session/);
    const { prompts } = await client.listPrompts();
    assert.deepEqual(prompts.map((p) => p.name), ["seed_bootstrap"]);
    const prompt = await client.getPrompt({ name: "seed_bootstrap", arguments: { days: "7" } });
    const text = prompt.messages[0].content.text;
    for (const word of ["history_search", "days=7", "remember", '"preference"', "correct", "daily_log"]) assert.ok(text.includes(word), word);
  });

  test("load_soul returns identity, state, memories, corrections, log + kb status", async () => {
    const res = await call(client, "load_soul");
    assert.ok(!res.isError, res.content[0].text);
    const d = data(res);
    assert.equal(d.soul.id, SOUL_ID);
    assert.equal(d.identity.name, "Nova");
    assert.deepEqual(d.identity.personality, { tone: "warm" }); // restricted section filtered
    assert.equal(d.state.vasanas[0].trait_name, "concise");
    assert.equal(d.context.recent_memories[0].content, "User deploys with pm2");
    assert.match(d.context.corrections.note, /NEVER repeat/);
    assert.equal(d.context.corrections.items[0].right, "Reply in Hinglish");
    assert.equal(d.context.daily_log.exists, false);
    assert.equal(d.context.daily_log.today, today());
    assert.equal(d.context.knowledge_base.articles, 1);
    assert.equal(d.security.classification, "CONFIDENTIAL");
    assert.equal(sent(mock, "GET", "/memories")[0].query.limit, "10");
    assert.ok(!JSON.stringify(d).includes(TEST_KEY), "load_soul must not echo the API key");
  });

  test("load_soul rejects a soul_id the user does not own", async () => {
    const res = await call(client, "load_soul", { soul_id: "someone-else" });
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /\[NOT_FOUND\]/);
  });

  test("remember / recall / correct / evolve_soul / get_soul_state", async () => {
    const r1 = await call(client, "remember", { content: `Deploy key is ${FAKE.ANTHROPIC_KEY}, deploys use pm2`, category: "fact", importance: 0.7 });
    assert.ok(!r1.isError, r1.content[0].text);
    const body = sent(mock, "POST", "/remember").at(-1).body;
    assert.equal(body.content, "Deploy key is [REDACTED:anthropic_key], deploys use pm2");
    assert.deepEqual([body.category, body.importance], ["fact", 0.7]);

    const r2 = await call(client, "recall", { query: "pm2", limit: 5 });
    assert.ok(data(r2).memories.length >= 1);
    assert.deepEqual(sent(mock, "GET", "/memories").at(-1).query, { q: "pm2", limit: "5" });

    const r3 = await call(client, "correct", { original: `Printed ${FAKE.GITHUB_TOKEN}`, correction: "Never print tokens" });
    assert.match(r3.content[0].text, /Correction saved/);
    const cbody = sent(mock, "POST", "/correct").at(-1).body;
    assert.deepEqual(cbody, { original: "Printed [REDACTED:github_token]", correction: "Never print tokens", category: "behavior", severity: 0.8 });

    const r4 = await call(client, "evolve_soul", { trait_name: "likes-tables", description: "Asks for tables", intensity: 0.6 });
    assert.equal(data(r4).ok, true);
    assert.deepEqual(sent(mock, "POST", "/evolve").at(-1).body, { trait_name: "likes-tables", description: "Asks for tables", intensity: 0.6 });

    const r5 = await call(client, "get_soul_state");
    assert.equal(data(r5).seed_id, SOUL_ID);
    assert.ok(data(r5).counts.memories >= 2);

    const bad = await call(client, "evolve_soul", { trait_name: "x", description: "y", intensity: 5 });
    assert.equal(bad.isError, true); // schema validation
  });

  test("get_skills filters by category", async () => {
    const res = await call(client, "get_skills", { category: "front" });
    assert.equal(data(res).categories_shown, 1);
    assert.deepEqual(data(res).skills[0].skills.map((s) => s.name), ["react", "css"]);
    assert.equal(mock.requests.filter((r) => r.path === "/api/v1/skills").length, 1);
  });

  test("daily_log appends to today's log for this app (its MCP client name), replace overwrites", async () => {
    const a = await call(client, "daily_log", { summary: "Built the import CLI." });
    assert.equal(data(a).entries, 1);
    const b = await call(client, "daily_log", { summary: `Fixed tests. Token ${FAKE.SLACK_TOKEN}` });
    assert.equal(data(b).entries, 2);
    const posts = sent(mock, "POST", "/daily-logs");
    const last = posts.at(-1).body;
    assert.equal(last.day, today());
    assert.equal(last.source, "seed-test"); // the client said hello as "seed-test"
    assert.equal(last.summary, "Built the import CLI.\n\n---\n\nFixed tests. Token [REDACTED:slack_token]");
    const get = sent(mock, "GET", "/daily-logs").at(-1);
    assert.ok(get.query.before > today());
    const c = await call(client, "daily_log", { summary: "Fresh summary.", mode: "replace" });
    assert.equal(data(c).entries, 1);
    assert.equal(sent(mock, "POST", "/daily-logs").at(-1).body.summary, "Fresh summary.");
    const soul = await call(client, "load_soul");
    assert.equal(data(soul).context.daily_log.exists, true);
    assert.deepEqual(data(soul).context.daily_log.sources, ["seed-test"]);
  });

  test("kb_write scrubs, kb_search queries", async () => {
    const w = await call(client, "kb_write", { title: "Prod DB", body: `postgres://app:${FAKE.DB_PASS}@db/prod`, tags: ["db"] });
    assert.ok(!w.isError, w.content[0].text);
    assert.deepEqual(sent(mock, "POST", "/kb").at(-1).body, { title: "Prod DB", body: "postgres://[REDACTED:url_credentials]@db/prod", tags: ["db"] });
    const s = await call(client, "kb_search", { q: "deploy" });
    assert.equal(data(s).articles[0].title, "Deploy guide");
    assert.deepEqual(sent(mock, "GET", "/kb").at(-1).query, { q: "deploy", limit: "10" });
  });

  test("history_search reads the local brain and makes NO HTTP call", async () => {
    const before = mock.requests.length;
    const res = await call(client, "history_search", { query: "pnpm", limit: 5 });
    const res2 = await call(client, "history_search", { query: "nginx", project: "beta", days: 3650 });
    assert.equal(mock.requests.length, before, "history_search must not touch the network");
    const d = data(res);
    assert.equal(d.local_only, true);
    assert.ok(d.results.length >= 2);
    assert.ok(d.results.every((r) => r.snippet.toLowerCase().includes("pnpm")));
    assert.ok(d.results.some((r) => r.project === "alpha-app" && r.date === "2026-10-19" && r.session_id));
    assert.ok(data(res2).results.every((r) => r.project === "beta-web"));
    for (const s of ALL_FAKE_SECRETS) assert.ok(!res.content[0].text.includes(s));
  });

  test("contract hygiene across the whole session", () => {
    assert.equal(mock.requests.filter((r) => r.path === "/api/v1/me").length, 1, "/me is resolved once and cached");
    assert.ok(mock.requests.every((r) => r.headers["x-api-key"] === TEST_KEY));
    assert.ok(!mock.requests.some((r) => r.path.startsWith("/api/souls") || r.path.includes("/admin")));
    assert.ok(!mock.requests.some((r) => r.path.includes("avni")));
    const wire = outbound(mock);
    for (const s of ALL_FAKE_SECRETS) assert.ok(!wire.includes(s), `secret on the wire: ${s}`);
  });
});

describe("MCP server edge cases", () => {
  test("no soul → clear NO_SOUL error; no key → NO_KEY but history_search still works", async () => {
    const mock = await startMockApi({ soul: null });
    const clients = [];
    try {
      const c1 = await connect(sandboxEnv({ SEED_API_URL: mock.url, SEED_API_KEY: TEST_KEY }));
      clients.push(c1);
      const res = await call(c1, "load_soul");
      assert.equal(res.isError, true);
      assert.equal(res.content[0].text, `Error [NO_SOUL]: No soul yet — create one at ${mock.url}/login`);

      const c2 = await connect(sandboxEnv({ SEED_API_URL: mock.url }));
      clients.push(c2);
      const rem = await call(c2, "remember", { content: "x" });
      assert.match(rem.content[0].text, /^Error \[NO_KEY\]/);
      const h = await call(c2, "history_search", { query: "anything" });
      assert.ok(!h.isError);
      assert.match(data(h).hint, /import claude-code/);
    } finally {
      for (const c of clients) await c.close();
      await mock.close();
    }
  });
});
