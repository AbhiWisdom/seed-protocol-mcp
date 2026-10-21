/**
 * OpenClaw workspace → SEED items. Reads only what the agent itself wrote:
 *   memory/YYYY-MM-DD.md                 → one daily log per day
 *   MEMORY.md bullets                    → memories
 *   memory/<topic>.md, skills/<name>/    → knowledge articles with a stable key
 *     (only skills committed to the workspace git — installed packs stay out)
 * Everything is scrubbed here. Nothing in this module talks to the network.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { scrub } from "../scrub.js";

export const SOURCE = "openclaw";

const DAY_FILE = /^(\d{4}-\d{2}-\d{2})\.md$/;
const MAX_TEXT = 19_000; // server caps daily logs and articles at 20k chars
const MAX_MEMORY = 2_000;

/** ~/.openclaw/workspace, or ~/.openclaw-<profile>/workspace when OPENCLAW_PROFILE is set. */
export function defaultOpenClawWorkspace(env = process.env) {
  const profile = env.OPENCLAW_PROFILE;
  return join(homedir(), profile ? `.openclaw-${profile}` : ".openclaw", "workspace");
}

export function hasOpenClawWorkspace(dir = defaultOpenClawWorkspace()) {
  return existsSync(join(dir, "MEMORY.md")) || existsSync(join(dir, "memory"));
}

const read = (file) => readFileSync(file, "utf8").replace(/\r\n/g, "\n").trim();
const clip = (text, where) => (text.length <= MAX_TEXT ? text : `${text.slice(0, MAX_TEXT)}\n\n… (truncated — full text in ${where})`);

function titleOf(text, fallback) {
  const heading = text.match(/^#\s+(.+)$/m);
  return (heading ? heading[1] : fallback).replace(/[*_`]/g, "").trim().slice(0, 200) || fallback;
}

/** Top-level "- " bullets with their indented continuation lines, markdown emphasis removed. */
export function memoryBullets(text) {
  const out = [];
  let current = null;
  for (const line of text.split("\n")) {
    if (/^[-*]\s+/.test(line)) {
      if (current) out.push(current);
      current = line.replace(/^[-*]\s+/, "");
    } else if (current !== null && /^\s+\S/.test(line)) {
      current += ` ${line.trim()}`;
    } else {
      if (current) out.push(current);
      current = null;
    }
  }
  if (current) out.push(current);
  return out
    .map((b) => b.replace(/\*\*|__/g, "").replace(/\s+/g, " ").trim())
    .filter((b) => b.length >= 12)
    .map((b) => b.slice(0, MAX_MEMORY));
}

/** Skill folders committed to the workspace's own git repo. No git → none. */
export function trackedSkills(dir) {
  try {
    const out = execFileSync("git", ["-C", dir, "ls-files", "--", "skills/*/SKILL.md"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 10_000,
    });
    return [...new Set(out.split("\n").filter(Boolean).map((f) => f.split("/")[1]))].sort();
  } catch {
    return [];
  }
}

/**
 * @param {string} dir OpenClaw workspace directory
 * @returns {{ found: boolean, logs: object[], memories: object[], articles: object[] }}
 */
export function readOpenClaw(dir = defaultOpenClawWorkspace()) {
  if (!hasOpenClawWorkspace(dir)) return { found: false, logs: [], memories: [], articles: [] };
  const logs = [];
  const articles = [];
  const memDir = join(dir, "memory");
  const files = existsSync(memDir) ? readdirSync(memDir).filter((f) => f.endsWith(".md")).sort() : [];
  for (const file of files) {
    const text = read(join(memDir, file));
    if (!text) continue;
    const where = `memory/${file}`;
    const day = file.match(DAY_FILE)?.[1];
    if (day) logs.push({ day, summary: clip(scrub(text), where), stats: { file: where, chars: text.length } });
    else articles.push({ key: `openclaw:${where}`, title: titleOf(text, file.replace(/\.md$/, "")), body: clip(scrub(text), where), tags: ["openclaw", "notes"] });
  }

  const memoryFile = join(dir, "MEMORY.md");
  const memories = existsSync(memoryFile)
    ? memoryBullets(read(memoryFile)).map((text) => ({ text: scrub(text), category: "project", importance: 0.6 }))
    : [];

  for (const name of trackedSkills(dir)) {
    const file = join(dir, "skills", name, "SKILL.md");
    if (!existsSync(file)) continue;
    const where = `skills/${name}/SKILL.md`;
    articles.push({ key: `openclaw:${where}`, title: `Runbook: ${name}`, body: clip(scrub(read(file)), where), tags: ["openclaw", "skill"] });
  }
  return { found: true, logs, memories, articles };
}
