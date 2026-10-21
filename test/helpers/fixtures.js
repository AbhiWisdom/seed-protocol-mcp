/**
 * Test fixtures. Fake secrets are assembled at runtime (never stored as
 * literals in the repo) and substituted into the fixture files when they are
 * copied into a temp dir.
 */

import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const j = (...parts) => parts.join("");

export const FAKE = {
  OPENAI_KEY: j("sk-", "proj-", "Fake0Key1For2Tests3Only4XYZ"),
  ANTHROPIC_KEY: j("sk-", "ant-", "fake-Test0123456789abcdefXYZ"),
  GITHUB_TOKEN: j("gh", "p_", "FakeTokenForTests0123456789abcdEFGH"),
  TG_TOKEN: j("123456789", ":AA", "FakeTelegramTokenForTests_0123456789"),
  DB_PASS: j("Hunter2", "Pass"),
  AWS_KEY: j("AK", "IA", "FAKE0TEST0KEY000"),
  GOOGLE_KEY: j("AI", "za", "SyFake_Google-Key0123456789abcdefghi"),
  STRIPE_KEY: j("sk_", "live_", "FakeStripeKey0123456789"),
  SLACK_TOKEN: j("xo", "xb-", "1234567890-FakeSlackToken"),
  SEED_KEY: j("seed_", "0123456789abcdef0123456789abcdef"),
  JWT: j("eyJ", "hbGciOiJIUzI1NiJ9", ".", "eyJ", "zdWIiOiJ0ZXN0In0", ".", "FakeSignature_0123"),
};

export function tempDir(prefix = "seed-test-") {
  return mkdtempSync(join(tmpdir(), prefix));
}

function substitute(text) {
  return text.replace(/\{\{([A-Z_]+)\}\}/g, (_, name) => FAKE[name] ?? `{{${name}}}`);
}

function substituteTree(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) substituteTree(p);
    else writeFileSync(p, substitute(readFileSync(p, "utf8")));
  }
}

/** Copy the Claude Code fixture tree into a temp dir; returns the projects dir. */
export function claudeProjectsFixture() {
  const root = tempDir("seed-cc-");
  cpSync(join(FIXTURES, "claude-code", "projects"), join(root, "projects"), { recursive: true });
  substituteTree(join(root, "projects"));
  return join(root, "projects");
}

/** Build a synthetic Cursor state.vscdb from fixtures/cursor/kv.json. */
export async function cursorDbFixture({ withKvTable = true } = {}) {
  const { loadSqlJs } = await import("../../src/brain/db.js");
  const SQL = await loadSqlJs();
  const spec = JSON.parse(substitute(readFileSync(join(FIXTURES, "cursor", "kv.json"), "utf8")));
  const db = new SQL.Database();
  db.run("CREATE TABLE ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB)");
  for (const r of spec.itemTable) db.run("INSERT INTO ItemTable VALUES (?, ?)", [r.key, r.value]);
  if (withKvTable) {
    db.run("CREATE TABLE cursorDiskKV (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB)");
    for (const r of spec.cursorDiskKV) {
      const raw = typeof r.value === "string" ? r.value : JSON.stringify(r.value);
      // Store one bubble as a BLOB like newer Cursor builds do.
      const value = r.key.endsWith(":b2") ? new TextEncoder().encode(raw) : raw;
      db.run("INSERT INTO cursorDiskKV VALUES (?, ?)", [r.key, value]);
    }
  }
  const path = join(tempDir("seed-cursor-"), "state.vscdb");
  writeFileSync(path, Buffer.from(db.export()));
  db.close();
  return path;
}

/**
 * A small OpenClaw workspace: two daily notes (one with a secret), MEMORY.md, a topic
 * note, one git-tracked skill (the agent's own) and one untracked installed pack.
 */
export function openclawWorkspaceFixture(dir = tempDir("openclaw-ws-")) {
  mkdirSync(join(dir, "memory"), { recursive: true });
  writeFileSync(join(dir, "memory", "2026-10-01.md"), `# 2026-10-01\n- Fixed nginx 502 on shop\n- rotated ${FAKE.GITHUB_TOKEN}\n`);
  writeFileSync(join(dir, "memory", "2026-10-02.md"), "# 2026-10-02\n- Deployed vgen with a smoke test\n");
  writeFileSync(join(dir, "memory", "pending-lessons.md"), "# Pending lessons\n- Check pm2 status before any restart\n");
  writeFileSync(join(dir, "MEMORY.md"), [
    "# MEMORY", "", "## Box",
    "- **Deploys** go through deploy.sh with a smoke test",
    "  and auto-rollback on failure.",
    "- short",
    "- Owner wants Hinglish replies, never formal English",
  ].join("\n"));
  const skills = { "shop-ops": "---\nname: shop-ops\n---\n# Shop ops\nRestart order: api, then bot.\n", "video-pack": "# Installed pack\n" };
  for (const [name, text] of Object.entries(skills)) {
    mkdirSync(join(dir, "skills", name), { recursive: true });
    writeFileSync(join(dir, "skills", name, "SKILL.md"), text);
  }
  execFileSync("git", ["init", "-q", dir]);
  execFileSync("git", ["-C", dir, "add", "skills/shop-ops/SKILL.md"]);
  return dir;
}

/** Every fake secret value, for "never leaked" assertions. */
export const ALL_FAKE_SECRETS = Object.values(FAKE);
