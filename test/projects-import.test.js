/**
 * import claude-code → project cards (2.11.0): the git repos sessions ran in become proposals, a remote's
 * credentials never survive, two folders of one repo are one project, a folder without git is skipped,
 * and an existing card is never overwritten.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanRemote, proposeProjects, statusOf, uploadProjects } from "../src/import/projects.js";

const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, ...args], { stdio: "ignore" });

function repo(root, name, remote, pkg) {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  git(dir, "init", "-q");
  if (remote) git(dir, "remote", "add", "origin", remote);
  if (pkg) writeFileSync(join(dir, "package.json"), JSON.stringify(pkg));
  return dir;
}

function session(projectsDir, folder, file, cwd, ts) {
  mkdirSync(join(projectsDir, folder), { recursive: true });
  const line = (i) => JSON.stringify({ type: "user", cwd, timestamp: ts, sessionId: file, uuid: `${file}-${i}`, message: { role: "user", content: "hello" } });
  writeFileSync(join(projectsDir, folder, `${file}.jsonl`), `${line(1)}\n${line(2)}\n`);
}

test("cleanRemote keeps owner/name or a bare https URL — never a token", () => {
  assert.equal(cleanRemote("git@github.com:me/app.git"), "me/app");
  assert.equal(cleanRemote("https://x-access-token:ghp_abcdef123@github.com/me/app.git"), "me/app");
  assert.equal(cleanRemote("https://user:secret@gitlab.com/team/proj.git"), "https://gitlab.com/team/proj");
  assert.equal(cleanRemote("file:///tmp/repo"), "");
  assert.equal(cleanRemote(""), "");
});

test("proposeProjects: one card per repo, credentials stripped, stack guessed, non-git folders skipped", async () => {
  const root = mkdtempSync(join(tmpdir(), "seed-proj-"));
  const app = repo(root, "app", "https://x-access-token:ghp_SECRET@github.com/me/app.git", { dependencies: { next: "16", react: "19" } });
  const appSub = join(app, "web");
  mkdirSync(appSub);
  const tool = repo(root, "tool", "git@github.com:me/tool.git");
  const plain = join(root, "plain");
  mkdirSync(plain);
  const sessions = join(root, "projects");
  session(sessions, "-app", "s1", app, "2026-10-29T10:00:00Z");
  session(sessions, "-app-web", "s2", appSub, "2026-10-30T09:00:00Z");
  session(sessions, "-tool", "s3", tool, "2026-08-01T09:00:00Z");
  session(sessions, "-plain", "s4", plain, "2026-10-30T09:00:00Z");

  const out = await proposeProjects(sessions);
  assert.deepEqual(out.map((p) => p.repo), ["me/app", "me/tool"]);
  const a = out[0];
  assert.equal(a.slug, "app");
  assert.equal(a.sessions, 2, "two folders of one repo are one project");
  assert.equal(a.stack, "Next.js · React");
  assert.equal(a.last, "2026-10-30T09:00:00Z");
  assert.ok(!JSON.stringify(out).includes("SECRET"), "no credentials anywhere");
});

test("proposeProjects: repos a session edited from another folder count too (3+ touches)", async () => {
  const root = mkdtempSync(join(tmpdir(), "seed-touch-"));
  const lib = repo(root, "lib", "git@github.com:me/lib.git", { dependencies: { express: "5" } });
  const once = repo(root, "once", "git@github.com:me/once.git");
  const home = join(root, "home");
  mkdirSync(home);
  const sessions = join(root, "projects");
  mkdirSync(join(sessions, "-home"), { recursive: true });
  const use = (p) => JSON.stringify({ type: "assistant", cwd: home, timestamp: "2026-10-30T08:00:00Z",
    message: { role: "assistant", content: [{ type: "tool_use", name: "Edit", input: { file_path: p } }] } });
  const lines = [use(join(lib, "src/a.js")), use(join(lib, "src/b.js")), use(join(lib, "README.md")), use(join(once, "x.js"))];
  writeFileSync(join(sessions, "-home", "s9.jsonl"), lines.join("\n") + "\n");
  const out = await proposeProjects(sessions);
  assert.deepEqual(out.map((p) => p.repo), ["me/lib"], "lib (3 edits) yes; once (1 edit) no; the non-git home folder no");
  assert.equal(out[0].stack, "Express");
});

test("statusOf: a session in the last 30 days → active, else paused", () => {
  const now = Date.parse("2026-10-30T12:00:00Z");
  assert.equal(statusOf("2026-10-20T00:00:00Z", now), "active");
  assert.equal(statusOf("2026-08-01T00:00:00Z", now), "paused");
  assert.equal(statusOf("", now), "paused");
});

test("uploadProjects creates only the cards that don't exist yet", async () => {
  const sent = [];
  const api = { remote: { get: async () => ({ projects: [{ slug: "tool" }] }), put: async (path, body) => sent.push([path, body]) } };
  const made = await uploadProjects(api, [
    { slug: "app", name: "app", repo: "me/app", stack: "Next.js", last: new Date().toISOString() },
    { slug: "tool", name: "tool", repo: "me/tool", stack: "", last: "" },
  ]);
  assert.equal(made, 1);
  assert.equal(sent[0][0], "/projects/app");
  assert.deepEqual(sent[0][1], { name: "app", repo: "me/app", status: "active", stack: "Next.js" });
});

test("local-only mode: no cloud, no cards", async () => {
  await assert.rejects(uploadProjects({ remote: null }, [{ slug: "x" }]), /LOCAL_MODE|cloud soul/);
});
