/**
 * Local-only mode: every tool works against ~/.seed/soul.sqlite and the SEED API is
 * never called (a live mock API records zero requests). Also `setup --local`,
 * `status` and `import openclaw` in local mode.
 */

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { openclawWorkspaceFixture } from "./helpers/fixtures.js";
import { TEST_KEY, startMockApi } from "./helpers/mock-api.js";
import { CLI, runCli, sandboxEnv } from "./helpers/run-cli.js";

const call = async (client, name, args = {}) => {
  const res = await client.callTool({ name, arguments: args });
  assert.ok(!res.isError, `${name}: ${res.content?.[0]?.text}`);
  return res;
};

describe("local-only MCP server", () => {
  let mock;
  let client;
  let env;

  before(async () => {
    mock = await startMockApi({ fresh: true });
    // A key and a live API are present on purpose: local mode must ignore both.
    env = sandboxEnv({ SEED_MODE: "local", SEED_API_URL: mock.url, SEED_API_KEY: TEST_KEY, SEED_SOUL_NAME: "Nova" });
    openclawWorkspaceFixture(join(env.HOME, ".openclaw", "workspace"));
    client = new Client({ name: "seed-test", version: "1.0.0" });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [CLI], env, stderr: "pipe" }));
  });

  after(async () => {
    await client?.close();
    await mock?.close();
  });

  test("new local soul → first_run → build_soul saves locally", async () => {
    const soul = (await call(client, "load_soul")).structuredContent;
    assert.equal(soul.soul.id, "local");
    assert.equal(soul.identity.name, "Nova");
    assert.ok(soul.first_run);
    const preview = await call(client, "build_soul");
    assert.match(preview.structuredContent.privacy, /nothing leaves this machine/);
    const built = await call(client, "build_soul", { upload: true });
    assert.equal(built.structuredContent.remaining, 0);
    assert.match(built.content[0].text, /local-only, on this machine/);
  });

  test("memory, corrections, journal, knowledge and traits all work locally", async () => {
    await call(client, "remember", { content: "Owner deploys with deploy.sh", category: "project" });
    const dup = await call(client, "remember", { content: "Owner deploys with deploy.sh", category: "project" });
    assert.match(dup.content[0].text, /duplicate/i);
    const recall = (await call(client, "recall", { query: "deploy" })).structuredContent;
    assert.ok(recall.memories.some((m) => m.content === "Owner deploys with deploy.sh"));
    await call(client, "correct", { original: "Formal English", correction: "Plain English" });
    const again = (await call(client, "correct", { original: "Formal again", correction: "Plain English" })).structuredContent;
    assert.equal(again.repeated, true);
    await call(client, "daily_log", { summary: "Local mode works" });
    await call(client, "kb_write", { title: "Local guide", body: "Everything stays here", tags: ["local"] });
    const kb = (await call(client, "kb_search", { q: "stays" })).structuredContent;
    assert.deepEqual(kb.articles.map((a) => a.title), ["Local guide"]);
    await call(client, "evolve_soul", { trait_name: "likes-short-answers", description: "Short replies", intensity: 0.7 });
    const state = (await call(client, "get_soul_state")).structuredContent;
    assert.equal(state.mode, "local");
    assert.equal(state.first_run, undefined);
    assert.ok(state.counts.memories >= 3 && state.counts.corrections === 1 && state.counts.daily_logs >= 3 && state.counts.kb >= 3);
    assert.equal(state.vasanas[0].trait_name, "likes-short-answers");
    const loaded = (await call(client, "load_soul")).structuredContent;
    assert.equal(loaded.context.corrections.items[0].right, "Plain English");
  });

  test("the soul file is private and the API was never called", () => {
    const file = join(env.SEED_HOME, "soul.sqlite");
    assert.ok(existsSync(file));
    assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.equal(mock.requests.length, 0, "local mode must not touch the network");
  });
});

test("CLI: setup --local, status and import openclaw stay on this machine", async () => {
  const mock = await startMockApi({ fresh: true });
  try {
    const env = sandboxEnv({ SEED_API_URL: mock.url });
    mkdirSync(join(env.HOME, ".cursor"), { recursive: true });
    const setup = await runCli(["setup", "--local"], { env });
    assert.equal(setup.code, 0, setup.stderr);
    const cursor = JSON.parse(readFileSync(join(env.HOME, ".cursor", "mcp.json"), "utf8")).mcpServers["seed-protocol"];
    assert.deepEqual(cursor.env, { SEED_MODE: "local" });
    assert.equal(JSON.parse(readFileSync(join(env.SEED_HOME, "config.json"), "utf8")).mode, "local");

    const status = await runCli(["status"], { env });
    assert.match(status.stdout, /local-only — nothing is sent to SEED/);
    const imp = await runCli(["import", "openclaw", "--path", openclawWorkspaceFixture(), "--yes"], { env });
    assert.equal(imp.code, 0, imp.stderr);
    assert.match(imp.stdout, /Saved 2 daily logs, 2 memories and 2 knowledge articles to your local soul/);
    assert.equal(mock.requests.length, 0);
  } finally {
    await mock.close();
  }
});
