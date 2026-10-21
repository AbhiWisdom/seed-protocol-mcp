/**
 * First connection on a brand-new soul: load_soul / get_soul_state say first_run,
 * build_soul previews without any network write, uploads only with upload=true,
 * and a second upload sends nothing. Also the `import openclaw` CLI path.
 */

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ALL_FAKE_SECRETS, openclawWorkspaceFixture } from "./helpers/fixtures.js";
import { SOUL_ID, TEST_KEY, startMockApi } from "./helpers/mock-api.js";
import { CLI, runCli, sandboxEnv } from "./helpers/run-cli.js";

const call = (client, name, args = {}) => client.callTool({ name, arguments: args });
const writes = (mock) => mock.requests.filter((r) => r.method === "POST");
const sent = (mock, suffix) => writes(mock).filter((r) => r.path === `/api/v1/seeds/${SOUL_ID}${suffix}`);

describe("first run: build_soul", () => {
  let mock;
  let client;

  before(async () => {
    mock = await startMockApi({ fresh: true });
    const env = sandboxEnv({ SEED_API_URL: mock.url, SEED_API_KEY: TEST_KEY });
    openclawWorkspaceFixture(join(env.HOME, ".openclaw", "workspace")); // default location
    client = new Client({ name: "seed-test", version: "1.0.0" });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [CLI], env, stderr: "pipe" }));
  });

  after(async () => {
    await client?.close();
    await mock?.close();
  });

  test("a new soul tells the AI to build it first", async () => {
    const soul = await call(client, "load_soul");
    assert.match(soul.content[0].text, /New soul — call build_soul first/);
    assert.match(soul.structuredContent.first_run, /build_soul \(upload=false\)/);
    const state = await call(client, "get_soul_state");
    assert.ok(state.structuredContent.first_run);
  });

  test("preview sends nothing; upload=true sends; a re-run sends nothing new", async () => {
    mock.reset();
    const preview = await call(client, "build_soul");
    assert.ok(!preview.isError, preview.content[0].text);
    assert.match(preview.content[0].text, /Preview only — nothing was uploaded/);
    const [p] = preview.structuredContent.preview;
    assert.equal(p.source, "OpenClaw");
    assert.deepEqual(p.will_upload, { daily_logs: 2, memories: 2, articles: 2 });
    assert.equal(writes(mock).length, 0, "preview must not write");

    const up = await call(client, "build_soul", { upload: true });
    assert.ok(!up.isError, up.content[0].text);
    assert.equal(up.structuredContent.remaining, 0);
    assert.equal(sent(mock, "/daily-logs").length, 2);
    assert.equal(sent(mock, "/remember").length, 2);
    assert.deepEqual(sent(mock, "/kb").map((r) => r.body.key), ["openclaw:memory/pending-lessons.md", "openclaw:skills/shop-ops/SKILL.md"]);
    assert.equal(sent(mock, "/imports")[0].body.source, "openclaw");
    const outbound = mock.requests.map((r) => r.raw).join("\n");
    for (const secret of ALL_FAKE_SECRETS) assert.ok(!outbound.includes(secret), "secret left the machine");

    mock.reset();
    const again = await call(client, "build_soul", { upload: true });
    assert.match(again.content[0].text, /already in the soul/);
    assert.equal(writes(mock).length, 0);

    const state = await call(client, "get_soul_state");
    assert.equal(state.structuredContent.first_run, undefined, "built soul is no longer first_run");
  });
});

test("CLI: import openclaw --yes uploads once, then reports up to date", async () => {
  const mock = await startMockApi({ fresh: true });
  try {
    const env = sandboxEnv({ SEED_API_URL: mock.url, SEED_API_KEY: TEST_KEY });
    const dir = openclawWorkspaceFixture();
    const first = await runCli(["import", "openclaw", "--path", dir, "--yes"], { env });
    assert.equal(first.code, 0, first.stderr);
    assert.match(first.stdout, /Upload 2 daily logs, 2 memories and 2 knowledge articles/);
    assert.match(first.stdout, /Uploaded 2 daily logs, 2 memories and 2 knowledge articles/);
    const second = await runCli(["import", "openclaw", "--path", dir, "--yes"], { env });
    assert.match(second.stdout, /already up to date/);
    assert.equal(sent(mock, "/kb").length, 2);
  } finally {
    await mock.close();
  }
});
