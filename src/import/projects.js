/**
 * Projects from Claude Code history (2.11.0): the folders the sessions ran in (each line's `cwd`), each
 * folder's git `origin`, and a stack guess from its manifest files — proposed as project cards
 * (projects/<slug>/README.md front-matter, see features/projects.js) in the import preview. Sent only
 * after the user's yes, and never over a card that already exists. All local reads; a remote URL loses
 * any user:token@ part before it is shown or sent.
 */

import { execFileSync } from "node:child_process";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { cloudOf } from "../api.js";
import { slugify } from "../features/projects.js";
import { listSessionFiles } from "./claude-code.js";

const HEAD_LINES = 40; // every line carries cwd — the first few are enough
const DAY = 864e5;

/** The folder a session ran in and its newest timestamp among the lines read. */
async function cwdOf(path) {
  const rl = createInterface({ input: createReadStream(path, { encoding: "utf8" }), crlfDelay: Infinity });
  let cwd = null;
  let ts = "";
  let n = 0;
  for await (const line of rl) {
    if (++n > HEAD_LINES) break;
    try {
      const o = JSON.parse(line);
      if (!cwd && typeof o.cwd === "string") cwd = o.cwd;
      if (typeof o.timestamp === "string" && o.timestamp > ts) ts = o.timestamp;
    } catch { /* a malformed line: skip */ }
  }
  rl.close();
  return cwd ? { cwd, ts } : null;
}

/** "git@github.com:me/app.git" · "https://x:TOKEN@github.com/me/app" → "me/app"; other hosts → https URL, no credentials. */
export function cleanRemote(url) {
  const s = String(url || "").trim();
  const gh = s.match(/github\.com[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i);
  if (gh) return `${gh[1]}/${gh[2]}`;
  const ssh = s.match(/^[\w.-]+@([\w.-]+):(.+?)(?:\.git)?$/);
  if (ssh) return `https://${ssh[1]}/${ssh[2]}`;
  try {
    const u = new URL(s);
    if (!/^https?:$/.test(u.protocol)) return "";
    u.username = "";
    u.password = "";
    return u.toString().replace(/\.git$/, "").replace(/\/$/, "");
  } catch {
    return "";
  }
}

export function gitRemote(cwd) {
  try {
    return cleanRemote(execFileSync("git", ["-C", cwd, "remote", "get-url", "origin"],
      { timeout: 3000, stdio: ["ignore", "pipe", "ignore"], encoding: "utf8" }));
  } catch {
    return ""; // not a repo, no origin, or no git
  }
}

const NODE = [["next", "Next.js"], ["react", "React"], ["vue", "Vue"], ["svelte", "Svelte"], ["express", "Express"],
  ["fastify", "Fastify"], ["@nestjs/core", "NestJS"], ["remotion", "Remotion"], ["electron", "Electron"]];
const PY = [["fastapi", "FastAPI"], ["django", "Django"], ["flask", "Flask"], ["aiogram", "aiogram"], ["python-telegram-bot", "python-telegram-bot"]];

/** A short stack line from the folder's manifests, e.g. "Next.js · React · FastAPI". */
export function stackOf(cwd) {
  const out = [];
  try {
    const p = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8"));
    const deps = { ...p.dependencies, ...p.devDependencies };
    const hits = NODE.filter(([k]) => deps[k]).map(([, n]) => n);
    out.push(...(hits.length ? hits : ["Node.js"]));
  } catch { /* no package.json */ }
  for (const f of ["requirements.txt", "pyproject.toml"]) {
    try {
      const t = readFileSync(join(cwd, f), "utf8").toLowerCase();
      const hits = PY.filter(([k]) => t.includes(k)).map(([, n]) => n);
      out.push(...(hits.length ? hits : ["Python"]));
      break;
    } catch { /* not there */ }
  }
  if (existsSync(join(cwd, "go.mod"))) out.push("Go");
  if (existsSync(join(cwd, "Cargo.toml"))) out.push("Rust");
  return [...new Set(out)].slice(0, 4).join(" · ");
}

export const statusOf = (last, now = Date.now()) => (last && now - Date.parse(last) < 30 * DAY ? "active" : "paused");

const PATH_RE = /"(?:file_path|notebook_path)":"(\/[^"\\]{1,400})"/g;
const MIN_TOUCHES = 3; // a repo touched once or twice in passing is not a project

/** The folder holding .git above `dir` (cached for every folder on the way), or "". */
function gitRoot(dir, cache) {
  const seen = [];
  let d = dir;
  let root = "";
  while (d && d !== "/" && d !== ".") {
    if (cache.has(d)) { root = cache.get(d); break; }
    seen.push(d);
    if (existsSync(join(d, ".git"))) { root = d; break; }
    d = dirname(d);
  }
  for (const s of seen) cache.set(s, root);
  return root;
}

/** Repos whose files a session read or edited (Read/Edit/Write tool paths) — scanned as text, no JSON parse. */
async function touchedRoots(path, cache) {
  const roots = new Map();
  const rl = createInterface({ input: createReadStream(path, { encoding: "utf8" }), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.includes("_path")) continue;
    for (const m of line.matchAll(PATH_RE)) {
      const root = gitRoot(dirname(m[1]), cache);
      if (root) roots.set(root, (roots.get(root) || 0) + 1);
    }
  }
  return roots;
}

/**
 * One proposal per git repo the sessions worked in, newest first: the folder a session ran in, and —
 * for sessions in the last `days` — the files it read or edited (people often run Claude Code from one
 * home folder and work across many repos). Repos without an origin are skipped.
 */
export async function proposeProjects(dir, { days = 30, now = Date.now() } = {}) {
  const cache = new Map();
  const byRoot = new Map();
  const bump = (root, sessions, touches, last) => {
    const e = byRoot.get(root) || { root, sessions: 0, touches: 0, ran: false, last: "" };
    e.sessions += sessions;
    e.touches += touches;
    if (last > e.last) e.last = last;
    byRoot.set(root, e);
    return e;
  };
  for (const f of listSessionFiles(dir)) {
    const head = await cwdOf(f.path);
    const ranIn = head && existsSync(head.cwd) ? gitRoot(head.cwd, cache) : "";
    if (ranIn) bump(ranIn, 1, MIN_TOUCHES, head.ts).ran = true;
    const mtime = statSync(f.path).mtimeMs;
    if (days && now - mtime > days * DAY) continue;
    for (const [root, n] of await touchedRoots(f.path, cache)) {
      if (root !== ranIn) bump(root, 1, n, new Date(mtime).toISOString());
    }
  }
  const byRepo = new Map();
  for (const e of [...byRoot.values()].filter((x) => x.touches >= MIN_TOUCHES)) {
    const repo = gitRemote(e.root);
    const slug = repo && slugify(basename(repo));
    if (!slug) continue;
    const cur = byRepo.get(repo);
    if (cur) {  // another clone or worktree of the same repo
      cur.sessions += e.sessions;
      if (e.last > cur.last) cur.last = e.last;
      if (!cur.stack) cur.stack = stackOf(e.root);
      continue;
    }
    byRepo.set(repo, { slug, name: basename(repo), repo, stack: stackOf(e.root), sessions: e.sessions, last: e.last });
  }
  return [...byRepo.values()].sort((a, b) => (b.last > a.last ? 1 : b.last < a.last ? -1 : 0));
}

/** Create the cards that don't exist yet. → number created. */
export async function uploadProjects(api, proposals) {
  const cloud = cloudOf(api, "project_update");
  const have = new Set(((await cloud.get("/projects")).projects || []).map((p) => p.slug.toLowerCase()));
  let made = 0;
  for (const p of proposals) {
    if (have.has(p.slug)) continue;
    await cloud.put(`/projects/${p.slug}`, { name: p.name, repo: p.repo, status: statusOf(p.last), ...(p.stack ? { stack: p.stack } : {}) });
    have.add(p.slug);
    made++;
  }
  return made;
}
