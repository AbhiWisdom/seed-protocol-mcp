import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { writeFileSync } from "node:fs";
import { ALL_FAKE_SECRETS, cursorDbFixture, tempDir } from "./helpers/fixtures.js";

const sandbox = tempDir("seed-home-");
process.env.HOME = sandbox;
process.env.SEED_HOME = join(sandbox, ".seed");

const { importCursor, readCursorDb } = await import("../src/import/cursor.js");
const { openBrain } = await import("../src/brain/db.js");
const { brainCounts, rebuildDays } = await import("../src/brain/store.js");
const { extractPreferences } = await import("../src/import/digest.js");

test("reads header-based and inline-conversation composers", async () => {
  const res = await readCursorDb(await cursorDbFixture());
  assert.equal(res.ok, true);
  const byId = Object.fromEntries(res.sessions.map((s) => [s.id, s]));
  assert.deepEqual(Object.keys(byId).sort(), ["comp-1", "comp-2"]);
  const c1 = byId["comp-1"].messages;
  assert.deepEqual(c1.map((m) => m.role), ["user", "assistant"]); // empty tool bubble dropped
  assert.equal(c1[0].ts, "2026-10-18T10:00:00.000Z");
  assert.match(c1[1].text, /prettier on every commit/); // BLOB value decoded
  const c2 = byId["comp-2"].messages;
  assert.deepEqual(c2.map((m) => [m.role, m.text]), [["user", "Never use var in TypeScript files."], ["assistant", "Understood, I will use const and let."]]);
  assert.equal(c2[0].ts, "2026-10-17T10:00:00.000Z"); // composer createdAt fallback
  assert.equal(c2[1].ts, "2026-10-17T10:00:01.000Z");
});

test("unknown layouts are reported, not thrown", async () => {
  const noKv = await readCursorDb(await cursorDbFixture({ withKvTable: false }));
  assert.equal(noKv.ok, false);
  assert.match(noKv.reason, /Cursor format not recognised/);

  const garbage = join(tempDir(), "state.vscdb");
  writeFileSync(garbage, "definitely not sqlite");
  const bad = await readCursorDb(garbage);
  assert.equal(bad.ok, false);
  assert.match(bad.reason, /Cursor format not recognised/);

  const missing = await readCursorDb(join(tempDir(), "nope.vscdb"));
  assert.equal(missing.ok, false);
  assert.match(missing.reason, /not found/);
});

test("importCursor scrubs, is idempotent, feeds digests", async () => {
  const path = await cursorDbFixture();
  const brain = await openBrain(join(tempDir(), "brain.sqlite"));
  const first = await importCursor(brain, { path });
  assert.equal(first.ok, true);
  assert.equal(first.sessions, 2);
  assert.equal(first.messages_new, 4);
  assert.equal(first.redactions.anthropic_key, 1);
  const again = await importCursor(brain, { path });
  assert.equal(again.messages_new, 0);
  assert.equal(brainCounts(brain).messages, 4);

  const text = brain.all("SELECT text FROM messages").map((r) => r.text).join("\n");
  for (const s of ALL_FAKE_SECRETS) assert.ok(!text.includes(s));
  assert.equal(brain.get("SELECT DISTINCT project FROM sessions").project, "cursor");

  const days = rebuildDays(brain, "cursor");
  assert.deepEqual(days.map((d) => d.day), ["2026-10-18", "2026-10-17"]);
  const prefs = extractPreferences(brain, "cursor").map((p) => p.text);
  assert.deepEqual(prefs.sort(), ["Always run prettier before committing.", "Never use var in TypeScript files."]);
  brain.close();
});
