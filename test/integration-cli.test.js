/**
 * End-to-end CLI: import (consent flow + upload contract), status, setup.
 * Every run uses a sandboxed HOME/SEED_HOME and a mock SEED API.
 */

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ALL_FAKE_SECRETS, claudeProjectsFixture, cursorDbFixture, tempDir } from "./helpers/fixtures.js";
import { SOUL_ID, TEST_KEY, startMockApi } from "./helpers/mock-api.js";
import { runCli, sandboxEnv } from "./helpers/run-cli.js";

const posts = (mock, suffix) => mock.requests.filter((r) => r.method === "POST" && r.path === `/api/v1/seeds/${SOUL_ID}${suffix}`);
const writes = (mock) => mock.requests.filter((r) => r.method === "POST");

describe("import claude-code", () => {
  let mock;
  before(async () => {
    mock = await startMockApi();
  });
  after(() => mock.close());

  test("answering N (or EOF) uploads nothing", async () => {
    mock.reset();
    const env = sandboxEnv({ SEED_API_URL: mock.url, SEED_API_KEY: TEST_KEY });
    const dir = claudeProjectsFixture();
    const no = await runCli(["import", "claude-code", "--path", dir, "--days", "0"], { env, input: "n\n" });
    assert.equal(no.code, 0, no.stderr);
    assert.match(no.stdout, /Upload 2 daily logs and 4 preference memories to your SEED dashboard\? \(y\/N\)/);
    assert.match(no.stdout, /Not uploaded/);
    const eof = await runCli(["import", "claude-code", "--path", dir, "--days", "0"], { env, input: "" });
    assert.match(eof.stdout, /Not uploaded/);
    assert.equal(writes(mock).length, 0);
    assert.ok(existsSync(join(env.SEED_HOME, "brain.sqlite")), "local brain is built either way");
  });

  test("answering y uploads scrubbed digests, preferences and an import record", async () => {
    mock.reset();
    const env = sandboxEnv({ SEED_API_URL: mock.url, SEED_API_KEY: TEST_KEY });
    const dir = claudeProjectsFixture();
    const yes = await runCli(["import", "claude-code", "--path", dir, "--days", "0"], { env, input: "y\n" });
    assert.equal(yes.code, 0, yes.stderr);
    assert.match(yes.stdout, /Uploaded 2 daily logs and 4 preference memories/);

    const logs = posts(mock, "/daily-logs").map((r) => r.body);
    assert.deepEqual(logs.map((l) => l.day).sort(), ["2026-10-19", "2026-10-20"]);
    assert.ok(logs.every((l) => l.source === "import:claude-code" && l.summary.length <= 20000 && l.stats.sessions === 1));
    const mems = posts(mock, "/remember").map((r) => r.body);
    assert.equal(mems.length, 4);
    assert.ok(mems.every((m) => m.category === "preference" && m.importance === 0.6));
    assert.ok(mems.some((m) => m.content === "Always use pnpm instead of npm in this repo."));
    assert.deepEqual(posts(mock, "/imports").map((r) => r.body), [
      { source: "claude-code", sessions: 2, messages: 10, days: 2, memories_added: 4, corrections_added: 0 },
    ]);

    const wire = writes(mock).map((r) => r.raw).join("\n");
    for (const s of ALL_FAKE_SECRETS) assert.ok(!wire.includes(s), `uploaded secret ${s}`);
    for (const m of ["ASSISTANT_ONLY_MARKER", "THINKING_MARKER", "TOOL_RESULT_MARKER", "Theek hai"]) {
      assert.ok(!wire.includes(m), `raw/assistant text uploaded: ${m}`);
    }
    assert.ok(mock.requests.every((r) => r.headers["x-api-key"] === TEST_KEY));

    // Re-running uploads nothing new (no duplicate memories).
    const before = writes(mock).length;
    const again = await runCli(["import", "claude-code", "--path", dir, "--days", "0", "--yes"], { env });
    assert.equal(again.code, 0, again.stderr);
    assert.match(again.stdout, /already up to date/);
    assert.equal(writes(mock).length, before);
  });

  test("--yes skips the prompt; --local-only never uploads", async () => {
    mock.reset();
    const env = sandboxEnv({ SEED_API_URL: mock.url, SEED_API_KEY: TEST_KEY });
    const local = await runCli(["import", "claude-code", "--path", claudeProjectsFixture(), "--local-only", "--yes"], { env });
    assert.equal(local.code, 0);
    assert.equal(mock.requests.length, 0);
    const res = await runCli(["import", "claude-code", "--path", claudeProjectsFixture(), "--yes", "--days", "3650"], { env });
    assert.equal(res.code, 0, res.stderr);
    assert.match(res.stdout, /yes \(--yes\)/);
    assert.equal(posts(mock, "/daily-logs").length, 2);
  });

  test("no key → builds locally, explains how to upload", async () => {
    const env = sandboxEnv({ SEED_API_URL: mock.url });
    mock.reset();
    const res = await runCli(["import", "claude-code", "--path", claudeProjectsFixture()], { env, input: "y\n" });
    assert.equal(res.code, 0);
    assert.match(res.stdout, /No SEED API key found/);
    assert.equal(mock.requests.length, 0);
  });

  test("missing history and bad flags", async () => {
    const env = sandboxEnv({ SEED_API_URL: mock.url, SEED_API_KEY: TEST_KEY });
    const none = await runCli(["import", "claude-code", "--path", join(tempDir(), "nope")], { env });
    assert.equal(none.code, 0);
    assert.match(none.stdout, /No Claude Code history found/);
    const bad = await runCli(["import", "claude-code", "--bogus"], { env });
    assert.equal(bad.code, 1);
    const unknown = await runCli(["import", "chatgpt"], { env });
    assert.equal(unknown.code, 1);
    assert.match(unknown.stdout, /Usage: npx seed-protocol-mcp import/);
  });
});

describe("import cursor", () => {
  test("uploads with --yes; unrecognised format exits 0", async () => {
    const mock = await startMockApi();
    try {
      const env = sandboxEnv({ SEED_API_URL: mock.url, SEED_API_KEY: TEST_KEY });
      const ok = await runCli(["import", "cursor", "--path", await cursorDbFixture(), "--yes", "--days", "0"], { env });
      assert.equal(ok.code, 0, ok.stderr);
      assert.match(ok.stdout, /SEED import — Cursor/);
      assert.ok(posts(mock, "/daily-logs").every((r) => r.body.source === "import:cursor"));
      assert.equal(posts(mock, "/daily-logs").length, 2);
      assert.equal(posts(mock, "/remember").length, 2);
      const wire = writes(mock).map((r) => r.raw).join("\n");
      for (const s of ALL_FAKE_SECRETS) assert.ok(!wire.includes(s));

      const bad = await runCli(["import", "cursor", "--path", await cursorDbFixture({ withKvTable: false })], { env });
      assert.equal(bad.code, 0);
      assert.match(bad.stdout, /Cursor format not recognised/);
    } finally {
      await mock.close();
    }
  });
});

describe("status and setup", () => {
  test("status shows masked key, reachability, soul and brain counts", async () => {
    const mock = await startMockApi();
    try {
      const env = sandboxEnv({ SEED_API_URL: mock.url, SEED_API_KEY: TEST_KEY });
      await runCli(["import", "claude-code", "--path", claudeProjectsFixture(), "--local-only"], { env });
      const res = await runCli(["status"], { env });
      assert.equal(res.code, 0, res.stderr);
      assert.match(res.stdout, /API key: +seed_a1b2…8f90 \(from SEED_API_KEY env\)/);
      assert.ok(!res.stdout.includes(TEST_KEY), "full key printed");
      assert.match(res.stdout, /Reachable: +yes/);
      assert.match(res.stdout, /Soul: +Nova \(soul-test-0001\)/);
      assert.match(res.stdout, /2 sessions · 10 messages · 2 days/);

      const bad = await runCli(["status"], { env: { ...env, SEED_API_KEY: "seed_wrongwrongwrongwrong01" } });
      assert.equal(bad.code, 1);
      assert.match(bad.stdout, /Reachable: +no — \[UNAUTHORIZED\]/);
    } finally {
      await mock.close();
    }
  });

  test("setup writes MCP configs exactly as 2.4 did and saves the key privately", async () => {
    const env = sandboxEnv();
    mkdirSync(join(env.HOME, ".cursor"), { recursive: true });
    writeFileSync(join(env.HOME, ".cursor", "mcp.json"), JSON.stringify({ mcpServers: { other: { command: "x" } } }));
    const res = await runCli(["setup", TEST_KEY], { env });
    assert.equal(res.code, 0, res.stderr);
    const cursor = JSON.parse(readFileSync(join(env.HOME, ".cursor", "mcp.json"), "utf8"));
    assert.deepEqual(cursor.mcpServers.other, { command: "x" });
    assert.deepEqual(cursor.mcpServers["seed-protocol"], {
      command: "npx",
      args: ["-y", "seed-protocol-mcp@latest"],
      env: { SEED_API_KEY: TEST_KEY, SEED_API_URL: "https://seed.abhibots.com" },
    });
    assert.ok(existsSync(join(env.HOME, ".claude.json")));
    const saved = join(env.SEED_HOME, "config.json");
    assert.equal(JSON.parse(readFileSync(saved, "utf8")).api_key, TEST_KEY);
    assert.equal(statSync(saved).mode & 0o777, 0o600);

    const noKey = await runCli(["setup"], { env: sandboxEnv() });
    assert.equal(noKey.code, 1);
    assert.match(noKey.stdout, /https:\/\/seed\.abhibots\.com\/login/);
  });

  test("help and version", async () => {
    const env = sandboxEnv();
    assert.match((await runCli(["--help"], { env })).stdout, /import claude-code/);
    // --version must match package.json, so a bump can't leave src/config.js behind.
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    assert.equal((await runCli(["--version"], { env })).stdout.trim(), pkg.version);
  });

  test("--help on every subcommand prints usage and touches nothing", async () => {
    const env = sandboxEnv({ SEED_API_KEY: TEST_KEY });
    mkdirSync(join(env.HOME, ".cursor"), { recursive: true });
    const cursorFile = join(env.HOME, ".cursor", "mcp.json");
    const before = JSON.stringify({ mcpServers: { "seed-protocol": { command: "npx", env: { SEED_API_KEY: TEST_KEY } } } });
    writeFileSync(cursorFile, before);

    for (const flag of ["--help", "-h"]) {
      const imp = await runCli(["import", flag], { env });
      assert.equal(imp.code, 0, imp.stderr);
      assert.match(imp.stdout, /Usage: npx seed-protocol-mcp import <claude-code\|cursor>/);
      assert.match(imp.stdout, /--local-only/);

      const setup = await runCli(["setup", flag], { env });
      assert.equal(setup.code, 0, setup.stderr);
      assert.match(setup.stdout, /Usage: npx seed-protocol-mcp setup YOUR_API_KEY/);

      const status = await runCli(["status", flag], { env });
      assert.equal(status.code, 0, status.stderr);
      assert.match(status.stdout, /import claude-code/);
    }
    assert.equal((await runCli(["import", "claude-code", "--help"], { env })).code, 0);

    const bad = await runCli(["setup", "--key"], { env });
    assert.equal(bad.code, 1);
    assert.match(bad.stdout, /Bad option: --key/);

    // No flag ever became a key: the existing editor config and saved config are untouched.
    assert.equal(readFileSync(cursorFile, "utf8"), before);
    assert.ok(!existsSync(join(env.HOME, ".claude.json")));
    assert.ok(!existsSync(join(env.SEED_HOME, "config.json")));
  });
});
