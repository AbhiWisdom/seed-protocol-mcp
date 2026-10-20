import { test, before } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { appendFileSync, existsSync, statSync } from "node:fs";
import { ALL_FAKE_SECRETS, claudeProjectsFixture, tempDir } from "./helpers/fixtures.js";

// Never touch the real home directory from unit tests.
const sandbox = tempDir("seed-home-");
process.env.HOME = sandbox;
process.env.SEED_HOME = join(sandbox, ".seed");

const { cleanText, extractText, importClaudeCode, listSessionFiles, parseLine } = await import("../src/import/claude-code.js");
const { openBrain } = await import("../src/brain/db.js");
const { brainCounts } = await import("../src/brain/store.js");
const { searchBrain, tokenize } = await import("../src/brain/search.js");

let dir;
before(() => {
  dir = claudeProjectsFixture();
});

test("extractText keeps text blocks only", () => {
  assert.equal(extractText("hi"), "hi");
  assert.equal(
    extractText([{ type: "thinking", thinking: "x" }, { type: "text", text: "a" }, { type: "tool_use", name: "Bash" }, { type: "text", text: "b" }]),
    "a\nb",
  );
  assert.equal(extractText([{ type: "tool_result", content: "out" }]), "");
});

test("cleanText strips harness wrappers and interrupts", () => {
  assert.equal(cleanText("<system-reminder>x</system-reminder>Real question"), "Real question");
  assert.equal(cleanText("<command-name>/model</command-name><command-args></command-args>"), "");
  assert.equal(cleanText("[Request interrupted by user for tool use]"), "");
});

test("parseLine: kept, skipped and malformed lines", () => {
  const base = { sessionId: "s1", cwd: "/x/proj", uuid: "u1", timestamp: "2026-10-19T10:00:00Z" };
  const kept = parseLine(JSON.stringify({ ...base, type: "user", message: { role: "user", content: "hello" } }));
  assert.deepEqual(kept, { sessionId: "s1", id: "claude-code:u1", role: "user", ts: "2026-10-19T10:00:00Z", project: "proj", text: "hello" });
  assert.equal(parseLine(JSON.stringify({ ...base, type: "summary" })), null);
  assert.equal(parseLine(JSON.stringify({ ...base, type: "user", isMeta: true, message: { role: "user", content: "m" } })), null);
  assert.equal(parseLine(JSON.stringify({ ...base, type: "user", isSidechain: true, message: { role: "user", content: "m" } })), null);
  assert.equal(parseLine("{not json"), undefined);
  const noUuid = parseLine(JSON.stringify({ sessionId: "s1", type: "assistant", message: { role: "assistant", content: "x" } }), { folder: "-Users-me-code-app" });
  assert.match(noUuid.id, /^claude-code:[0-9a-f]{40}$/);
  assert.equal(noUuid.project, "app");
});

test("listSessionFiles finds one-level jsonl files", () => {
  const files = listSessionFiles(dir);
  assert.equal(files.length, 2);
  assert.ok(files.every((f) => f.path.endsWith(".jsonl")));
  assert.deepEqual(listSessionFiles(join(dir, "missing")), []);
});

test("import parses, scrubs, and is idempotent", async () => {
  const path = join(tempDir(), "brain.sqlite");
  const brain = await openBrain(path);
  const first = await importClaudeCode(brain, { dir });
  assert.equal(first.files, 2);
  assert.equal(first.sessions, 2);
  assert.equal(first.malformed, 1);
  // alpha: u-0001, a-0001, u-0004, u-0005, a-0002 · beta: u-1001, a-1001, u-1002, u-1003, a-1002
  assert.equal(first.messages_new, 10);
  assert.ok(first.redactions.openai_key >= 1 && first.redactions.url_credentials >= 1);
  assert.ok(first.redactions.github_token >= 1 && first.redactions.telegram_bot_token >= 1);

  const rows = brain.all("SELECT text FROM messages");
  const all = rows.map((r) => r.text).join("\n");
  for (const marker of ["THINKING_MARKER", "TOOL_USE_MARKER", "TOOL_RESULT_MARKER", "META_MARKER", "REMINDER_MARKER", "SIDECHAIN_MARKER", "Request interrupted"]) {
    assert.ok(!all.includes(marker), `stored ${marker}`);
  }
  for (const secret of ALL_FAKE_SECRETS) assert.ok(!all.includes(secret), `stored secret ${secret}`);
  assert.ok(all.includes("[REDACTED:openai_key]"));

  const sessions = brain.all("SELECT id, project, messages, started_at, ended_at FROM sessions ORDER BY id");
  assert.deepEqual(sessions.map((s) => [s.project, s.messages]), [["alpha-app", 5], ["beta-web", 5]]);
  assert.equal(sessions[0].started_at, "2026-10-19T10:00:00.000Z");
  assert.equal(sessions[0].ended_at, "2026-10-19T10:05:00.000Z");

  // Unchanged files are skipped; a forced full re-read inserts nothing new.
  const second = await importClaudeCode(brain, { dir });
  assert.equal(second.files_skipped, 2);
  assert.equal(second.messages_new, 0);
  const full = await importClaudeCode(brain, { dir, full: true });
  assert.equal(full.messages_new, 0);
  assert.equal(full.messages_seen, 10);
  assert.equal(brainCounts(brain).messages, 10);

  // A growing session file adds only the new line.
  const file = listSessionFiles(dir).find((f) => f.folder.endsWith("beta-web")).path;
  appendFileSync(file, `${JSON.stringify({ type: "user", sessionId: "22222222-bbbb-4bbb-8bbb-000000000002", cwd: "/Users/dev/code/beta-web", uuid: "u-1004", timestamp: "2026-10-20T11:00:00.000Z", message: { role: "user", content: "One more thing" } })}\n`);
  const third = await importClaudeCode(brain, { dir });
  assert.equal(third.messages_new, 1);
  assert.equal(brainCounts(brain).messages, 11);

  brain.save();
  assert.ok(existsSync(path));
  assert.equal(statSync(path).mode & 0o777, 0o600);
  brain.close();
  const reopened = await openBrain(path, { create: false });
  assert.equal(brainCounts(reopened).messages, 11);
  reopened.close();
});

test("openBrain with create:false returns null for a missing file", async () => {
  assert.equal(await openBrain(join(tempDir(), "nope.sqlite"), { create: false }), null);
});

test("keyword search scores, filters and snippets", async () => {
  const brain = await openBrain(join(tempDir(), "b.sqlite"));
  await importClaudeCode(brain, { dir: claudeProjectsFixture() });
  assert.deepEqual(tokenize("How do I fix the nginx 502?"), ["fix", "nginx", "502"]);

  const res = searchBrain(brain, { query: "nginx 502 fix", limit: 5, now: Date.parse("2026-10-21T00:00:00Z") });
  assert.ok(res.results.length >= 2);
  assert.equal(res.results[0].project, "alpha-app"); // matches all three terms
  assert.match(res.results[0].snippet, /nginx 502 fix/);
  assert.equal(res.results[0].session_id, "11111111-aaaa-4aaa-8aaa-000000000001");
  assert.equal(res.results[0].date, "2026-10-19");

  const scoped = searchBrain(brain, { query: "nginx", project: "beta" });
  assert.ok(scoped.results.length >= 1 && scoped.results.every((r) => r.project === "beta-web"));

  const recent = searchBrain(brain, { query: "", limit: 3 });
  assert.equal(recent.results.length, 3);
  assert.equal(recent.results[0].ts, "2026-10-20T10:03:00.000Z");

  const old = searchBrain(brain, { query: "pnpm", days: 1, now: Date.parse("2026-12-31T00:00:00Z") });
  assert.equal(old.results.length, 0);

  const like = searchBrain(brain, { query: "100%_x" });
  assert.equal(like.results.length, 0); // LIKE wildcards are escaped
  brain.close();
});
