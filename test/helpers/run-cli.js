/** Spawn `node src/cli.js …` with an isolated environment. */

import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { tempDir } from "./fixtures.js";

export const CLI = fileURLToPath(new URL("../../src/cli.js", import.meta.url));

/** A fake HOME + SEED_HOME so nothing touches the real user's files. */
export function sandboxEnv(extra = {}) {
  const home = tempDir("seed-home-");
  mkdirSync(join(home, ".seed"), { recursive: true });
  return { PATH: process.env.PATH, HOME: home, USERPROFILE: home, SEED_HOME: join(home, ".seed"), ...extra };
}

export function runCli(args, { env, input = "" } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], { env, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(input);
  });
}
