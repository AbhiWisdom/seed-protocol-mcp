#!/usr/bin/env node

/**
 * SEED Protocol MCP server (stdio).
 * Give your AI a soul — memories, corrections, daily logs and a knowledge
 * base that persist across sessions and tools, plus a local-only history brain.
 *
 * Env:
 *   SEED_API_KEY  your key from https://seed.abhibots.com/login (dashboard)
 *   SEED_API_URL  API base (default https://seed.abhibots.com)
 *   SEED_HOME     local data dir (default ~/.seed)
 *
 * Copyright (c) 2026 Abhiraj. MIT licensed.
 */

import { startServer } from "./server.js";

startServer().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
