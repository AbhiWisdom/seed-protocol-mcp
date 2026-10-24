/**
 * Hybrid mode: writes land on this device first; only the types the user ticked go to
 * the cloud. Reads merge both. Offline writes wait and `sync` sends them exactly once.
 */

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SOUL_ID, TEST_KEY, startMockApi } from "./helpers/mock-api.js";
import { CLI, runCli, sandboxEnv } from "./helpers/run-cli.js";

const posts = (mock, suffix) => mock.requests.filter((r) => r.method === "POST" && r.path === `/api/v1/seeds/${SOUL_ID}${suffix}`);
const call = async (client, name, args = {}) => {
  const res = await client.callTool({ name, arguments: args });
  assert.ok(!res.isError, `${name}: ${res.content?.[0]?.text}`);
  return res;
};
async function connect(env) {
  const client = new Client({ name: "seed-test", version: "1.0.0" });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [CLI], env, stderr: "pipe" }));
  return client;
}

describe("hybrid MCP server", () => {
  let mock;
  let client;
  let env;

  before(async () => {
    mock = await startMockApi(); // the cloud already holds "User deploys with pm2" (from another device)
    env = sandboxEnv({ SEED_MODE: "hybrid", SEED_API_URL: mock.url, SEED_API_KEY: TEST_KEY });
    client = await connect(env);
  });

  after(async () => {
    await client?.close();
    await mock?.close();
  });

  test("ticked types reach the cloud; unticked stay on this device", async () => {
    const mem = (await call(client, "remember", { content: "Laptop knows the owner prefers Hinglish", category: "preference" })).structuredContent;
    assert.equal(mem.synced, true);
    assert.equal(posts(mock, "/remember").length, 1);
    await call(client, "correct", { original: "Formal English", correction: "Plain Hinglish" });
    assert.equal(posts(mock, "/correct").length, 1);
    const log = (await call(client, "daily_log", { summary: "Laptop-only log" })).structuredContent;
    assert.equal(posts(mock, "/daily-logs").length, 0, "daily logs are off by default");
    assert.ok(log);
    await call(client, "kb_write", { title: "Private note", body: "stays here" });
    assert.equal(posts(mock, "/kb").length, 0);
  });

  test("reads merge this device and the cloud, without duplicates", async () => {
    const r = (await call(client, "recall", { query: "" , limit: 50 })).structuredContent;
    const contents = r.memories.map((m) => m.content);
    assert.ok(contents.includes("User deploys with pm2"), "cloud memory from another device");
    assert.ok(contents.includes("Laptop knows the owner prefers Hinglish"));
    assert.equal(contents.filter((c) => c === "Laptop knows the owner prefers Hinglish").length, 1, "synced memory appears once");
    const kb = (await call(client, "kb_search", { q: "" })).structuredContent;
    assert.ok(kb.articles.some((a) => a.title === "Private note") && kb.articles.some((a) => a.title === "Deploy guide"));
    const state = (await call(client, "get_soul_state")).structuredContent;
    assert.equal(state.mode, "hybrid");
  });

  test("turning a type on later sends what was kept locally", async () => {
    mock.state.sync.daily_logs = true;
    const out = await runCli(["sync"], { env });
    assert.equal(out.code, 0, out.stdout + out.stderr);
    assert.match(out.stdout, /daily_logs\s+sync on · 1 sent/);
    assert.equal(posts(mock, "/daily-logs").length, 1);
    const again = await runCli(["sync"], { env });
    assert.match(again.stdout, /daily_logs\s+sync on · 0 sent · 0 waiting/);
    assert.equal(posts(mock, "/daily-logs").length, 1, "never sent twice");
  });
});

test("offline: writes stay on this device, `sync` sends them once the cloud is back", async () => {
  const env = sandboxEnv({ SEED_MODE: "hybrid", SEED_API_URL: "http://127.0.0.1:9", SEED_API_KEY: TEST_KEY });
  const offline = await connect(env);
  try {
    const res = (await call(offline, "remember", { content: "Written on a plane" })).structuredContent;
    assert.equal(res.synced, false);
    assert.match(res.sync, /pending/);
    const recall = (await call(offline, "recall", { query: "plane" })).structuredContent;
    assert.equal(recall.memories[0].content, "Written on a plane");
  } finally {
    await offline.close();
  }
  const mock = await startMockApi({ fresh: true });
  try {
    const online = { ...env, SEED_API_URL: mock.url };
    const out = await runCli(["sync"], { env: online });
    assert.equal(out.code, 0, out.stdout);
    assert.match(out.stdout, /memories\s+sync on · 1 sent/);
    assert.equal(posts(mock, "/remember")[0].body.content, "Written on a plane");
  } finally {
    await mock.close();
  }
});

test("setup --hybrid writes SEED_MODE=hybrid with the key", async () => {
  const env = sandboxEnv();
  mkdirSync(join(env.HOME, ".cursor"), { recursive: true });
  const out = await runCli(["setup", "--hybrid", TEST_KEY], { env });
  assert.equal(out.code, 0, out.stderr);
  const cfg = JSON.parse(readFileSync(join(env.HOME, ".cursor", "mcp.json"), "utf8")).mcpServers["seed-protocol"];
  assert.equal(cfg.env.SEED_MODE, "hybrid");
  assert.equal(cfg.env.SEED_API_KEY, TEST_KEY);
  assert.equal(JSON.parse(readFileSync(join(env.SEED_HOME, "config.json"), "utf8")).mode, "hybrid");
});
