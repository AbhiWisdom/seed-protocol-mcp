import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { ALL_FAKE_SECRETS, claudeProjectsFixture, tempDir } from "./helpers/fixtures.js";

const sandbox = tempDir("seed-home-");
process.env.HOME = sandbox;
process.env.SEED_HOME = join(sandbox, ".seed");

const { openBrain } = await import("../src/brain/db.js");
const { rebuildDays } = await import("../src/brain/store.js");
const { importClaudeCode } = await import("../src/import/claude-code.js");
const { buildDayDigests, extractPreferences, firstLine, isPreference, sentences } = await import("../src/import/digest.js");
const { planUpload } = await import("../src/import/upload.js");

async function loadedBrain() {
  const brain = await openBrain(join(tempDir(), "brain.sqlite"));
  await importClaudeCode(brain, { dir: claudeProjectsFixture() });
  return brain;
}

test("sentences split on sentence ends only and skip code fences", () => {
  assert.deepEqual(sentences("Never commit .env files. Use v2.5 now!\n- Always lint"), ["Never commit .env files.", "Use v2.5 now!", "Always lint"]);
  assert.deepEqual(sentences("```js\nalways();\n```\nFix it."), ["Fix it."]);
});

test("isPreference: cues, questions, code, secrets, length", () => {
  assert.ok(isPreference("Always use pnpm instead of npm."));
  assert.ok(isPreference("Hamesha Hinglish mein reply karo."));
  assert.ok(isPreference("Formal English kabhi mat likhna."));
  assert.ok(isPreference("Mujhe long answers nahi chahiye."));
  assert.ok(isPreference("Don't add emojis to commits."));
  assert.ok(isPreference("I prefer tabs over spaces."));
  assert.ok(!isPreference("Should I always use tabs?"));
  assert.ok(!isPreference("const x = () => always();"));
  assert.ok(!isPreference("Never [REDACTED:secret] here please."));
  assert.ok(!isPreference("never"));
  assert.ok(!isPreference("Fix the login page layout."));
});

test("firstLine truncates", () => {
  assert.equal(firstLine("\n  hello world  \nsecond"), "hello world");
  assert.equal(firstLine("x".repeat(200), 20).length, 20);
});

test("rebuildDays + buildDayDigests per local day", async () => {
  const brain = await loadedBrain();
  const days = rebuildDays(brain, "claude-code");
  assert.deepEqual(days.map((d) => [d.day, d.sessions, d.messages, d.projects]), [
    ["2026-10-20", 1, 5, ["beta-web"]],
    ["2026-10-19", 1, 5, ["alpha-app"]],
  ]);
  assert.equal(brain.get("SELECT COUNT(*) AS n FROM days").n, 2);

  const digests = buildDayDigests(brain, "claude-code", { days: 0 });
  assert.equal(digests.length, 2);
  const d19 = digests.find((d) => d.day === "2026-10-19");
  assert.match(d19.summary, /Imported from Claude Code history — 2026-10-19/);
  assert.match(d19.summary, /Sessions: 1 · Messages: 5 · Projects: alpha-app/);
  assert.match(d19.summary, /- \[alpha-app\] Set up the build for alpha-app\./);
  assert.match(d19.summary, /Should I always use tabs\?/);
  assert.ok(!d19.summary.includes("ASSISTANT_ONLY_MARKER"), "assistant text must not be in digests");
  assert.deepEqual(d19.stats, { sessions: 1, messages: 5, user_messages: 3, projects: ["alpha-app"] });
  for (const d of digests) for (const s of ALL_FAKE_SECRETS) assert.ok(!d.summary.includes(s));

  // Calendar window: only days within the last N days of `now`.
  const window = buildDayDigests(brain, "claude-code", { days: 2, now: new Date(2026, 9, 20, 12).getTime() });
  assert.deepEqual(window.map((d) => d.day), ["2026-10-20", "2026-10-19"]);
  const one = buildDayDigests(brain, "claude-code", { days: 1, now: new Date(2026, 9, 20, 12).getTime() });
  assert.deepEqual(one.map((d) => d.day), ["2026-10-20"]);
  brain.close();
});

test("extractPreferences: deduped, ranked by repetition, capped", async () => {
  const brain = await loadedBrain();
  const prefs = extractPreferences(brain, "claude-code");
  const texts = prefs.map((p) => p.text);
  assert.equal(texts[0], "Always use pnpm instead of npm in this repo.");
  assert.equal(prefs[0].count, 2);
  assert.ok(texts.includes("Never commit .env files."));
  assert.ok(texts.includes("Hamesha Hinglish mein reply karo, formal English mat karo."));
  assert.ok(texts.includes("I prefer short commit messages without emojis."));
  assert.ok(!texts.some((t) => t.includes("?") || t.includes("REDACTED") || t.includes("=>")));
  assert.equal(prefs.length, 4);
  assert.equal(extractPreferences(brain, "claude-code", { limit: 2 }).length, 2);
  brain.close();
});

test("planUpload skips already-uploaded logs and preferences", async () => {
  const brain = await loadedBrain();
  rebuildDays(brain, "claude-code");
  const digests = buildDayDigests(brain, "claude-code", { days: 0 });
  const prefs = extractPreferences(brain, "claude-code");
  const plan = planUpload(brain, "claude-code", digests, prefs);
  assert.equal(plan.logs.length, 2);
  assert.equal(plan.memories.length, 4);
  // Simulate an earlier upload of everything.
  const { runUpload } = await import("../src/import/upload.js");
  const sent = [];
  const fakeApi = { post: async (path, body) => sent.push({ path, body }) };
  const done = await runUpload(fakeApi, brain, "claude-code", plan, { sessions: 2, messages: 10 }, { log: () => {}, pace: 0 });
  assert.deepEqual(done, { logs: 2, memories: 4, articles: 0 });
  assert.deepEqual(sent.map((s) => s.path), ["/daily-logs", "/daily-logs", "/remember", "/remember", "/remember", "/remember", "/imports"]);
  assert.equal(sent[0].body.source, "import:claude-code");
  assert.deepEqual(sent[2].body.category, "preference");
  assert.equal(sent[2].body.importance, 0.6);
  assert.deepEqual(sent[6].body, { source: "claude-code", sessions: 2, messages: 10, days: 2, memories_added: 4, corrections_added: 0 });
  const again = planUpload(brain, "claude-code", digests, prefs);
  assert.deepEqual([again.logs.length, again.memories.length], [0, 0]);
  brain.close();
});

test("isPreference rejects headings, labels, tables and step lines", () => {
  for (const s of ["## Always read state first", "Send pattern (always file-based, never inline):", "| never | always |", "Step 3 — never skip the backup"]) {
    assert.equal(isPreference(s), false, s);
  }
});

test("extractPreferences ignores long pastes, tagged system text and secret-bearing lines", async () => {
  const { openBrain } = await import("../src/brain/db.js");
  const brain = await openBrain(null);
  brain.run("INSERT INTO sessions (id, source, project, messages) VALUES ('s1', 'claude-code', 'p', 4)");
  const add = (id, text) => brain.run("INSERT INTO messages (id, session_id, role, ts, text) VALUES (?, 's1', 'user', '2026-10-01T00:00:00Z', ?)", [id, text]);
  add("m1", "Always reply in Hinglish, never formal English.");
  add("m2", `${"Routine prompt line. ".repeat(80)}Always reply in ENGLISH only.`);
  add("m3", "<task-notification>Never restart the gateway.</task-notification>");
  add("m4", `Never expire this key ${["nb", "_", "7f09cc7dd083384b755f7ab7d9043dc0"].join("")} please.`);
  const texts = extractPreferences(brain, "claude-code").map((p) => p.text);
  assert.deepEqual(texts, ["Always reply in Hinglish, never formal English."]);
});

