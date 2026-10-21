/**
 * OpenClaw importer: what is read, what is left out, scrubbing, size caps, and
 * that a re-run plans only what changed (so it is safe on a cron).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { openBrain } from "../src/brain/db.js";
import { memoryBullets, readOpenClaw, trackedSkills } from "../src/import/openclaw.js";
import { planSize, planUpload, runUpload } from "../src/import/upload.js";
import { FAKE, openclawWorkspaceFixture, tempDir } from "./helpers/fixtures.js";

test("MEMORY.md bullets keep continuation lines and drop markup and stubs", () => {
  const out = memoryBullets("# T\n- **Deploys** use deploy.sh\n  with rollback.\n- short\n* Second fact is long enough\ntext\n");
  assert.deepEqual(out, ["Deploys use deploy.sh with rollback.", "Second fact is long enough"]);
});

test("reads daily notes, MEMORY.md, topic notes and only git-tracked skills", () => {
  const dir = openclawWorkspaceFixture();
  const r = readOpenClaw(dir);
  assert.equal(r.found, true);
  assert.deepEqual(r.logs.map((l) => l.day), ["2026-10-01", "2026-10-02"]);
  assert.ok(!r.logs[0].summary.includes(FAKE.GITHUB_TOKEN), "secrets are scrubbed before anything leaves");
  assert.match(r.logs[0].summary, /REDACTED/);
  assert.deepEqual(r.memories.map((m) => m.text), [
    "Deploys go through deploy.sh with a smoke test and auto-rollback on failure.",
    "Owner wants Hinglish replies, never formal English",
  ]);
  assert.equal(r.memories[0].category, "project");
  assert.deepEqual(trackedSkills(dir), ["shop-ops"]);
  assert.deepEqual(r.articles.map((a) => [a.key, a.title]), [
    ["openclaw:memory/pending-lessons.md", "Pending lessons"],
    ["openclaw:skills/shop-ops/SKILL.md", "Runbook: shop-ops"],
  ]);
});

test("caps long notes under the server limit and points to the full file", () => {
  const dir = openclawWorkspaceFixture();
  writeFileSync(join(dir, "memory", "2026-10-03.md"), "x".repeat(25_000));
  const log = readOpenClaw(dir).logs.find((l) => l.day === "2026-10-03");
  assert.ok(log.summary.length < 20_000);
  assert.match(log.summary, /truncated — full text in memory\/2026-10-03\.md/);
});

test("no workspace → found false", () => {
  assert.equal(readOpenClaw(tempDir("no-openclaw-")).found, false);
});

test("re-runs plan only new or changed items", async () => {
  const dir = openclawWorkspaceFixture();
  const home = tempDir("seed-home-");
  process.env.SEED_HOME = home;
  const brain = await openBrain();
  try {
    const r = readOpenClaw(dir);
    const plan = planUpload(brain, "openclaw", r.logs, r.memories, r.articles);
    assert.equal(planSize(plan), 2 + 2 + 2);
    const sent = [];
    const api = { post: async (path, body) => sent.push({ path, body }) };
    const done = await runUpload(api, brain, "openclaw", plan, { sessions: 0, messages: 0 }, { log: () => {}, pace: 0 });
    assert.deepEqual(done, { logs: 2, memories: 2, articles: 2 });
    const kb = sent.filter((s) => s.path === "/kb");
    assert.deepEqual(kb.map((s) => s.body.key), ["openclaw:memory/pending-lessons.md", "openclaw:skills/shop-ops/SKILL.md"]);
    assert.equal(sent.find((s) => s.path === "/daily-logs").body.source, "import:openclaw");

    const again = readOpenClaw(dir);
    assert.equal(planSize(planUpload(brain, "openclaw", again.logs, again.memories, again.articles)), 0);

    writeFileSync(join(dir, "memory", "2026-10-02.md"), "# 2026-10-02\n- Deployed vgen, then fixed the cache\n");
    writeFileSync(join(dir, "memory", "pending-lessons.md"), "# Pending lessons\n- Check pm2 first\n- Then nginx\n");
    const changed = readOpenClaw(dir);
    const next = planUpload(brain, "openclaw", changed.logs, changed.memories, changed.articles);
    assert.deepEqual(next.logs.map((l) => l.day), ["2026-10-02"]);
    assert.deepEqual(next.articles.map((a) => a.key), ["openclaw:memory/pending-lessons.md"]);
    assert.equal(next.memories.length, 0);
  } finally {
    brain.close();
    delete process.env.SEED_HOME;
  }
});
