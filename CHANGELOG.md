# Changelog

## 2.8.1 — 2026-10-24

### Fixed
- Secret scrubber: generic service keys (`prefix_longtoken`, e.g. `nb_…`, `xx_live_…`) are now redacted.
- History import: a sentence that held a secret is never offered as a preference memory.
- History import: long pasted prompts/docs (over 1,500 characters), tagged system text, headings, labels, tables and "Step …" lines are no longer mistaken for the user's own preferences.

## 2.8.0 — 2026-10-24

**Hybrid mode — one soul across your devices, synced on your terms.**

### Added
- `setup --hybrid <KEY>` (or `SEED_MODE=hybrid`): the soul lives on this device (`~/.seed/soul.sqlite`) and the types you tick in the dashboard (Privacy → Devices & sync: memories, corrections, traits, knowledge, daily logs) are copied to your cloud soul, so your other machines and tools — a laptop, a VPS agent — see them. Reads merge this device and the cloud, de-duplicated.
- Offline-safe: writes always land locally first; anything the cloud missed goes up at the next server start or with `npx seed-protocol-mcp sync`. Turning a type on later sends what was kept locally. Nothing is sent twice.
- `status` in hybrid shows what syncs and what is waiting.

## 2.7.0 — 2026-10-24

**Local-only mode — trust no server.**

### Added
- `setup --local` (or `SEED_MODE=local`): the soul lives in `~/.seed/soul.sqlite` on your machine and the connector never calls the SEED server — no account, no API key. Every tool works the same, `build_soul` and `import … --yes` save into the local soul. `SEED_MODE=online` overrides a saved local setup.
- `status` shows the mode and the local soul's counts.

### Changed
- `setup <KEY>` records `mode: online`, so switching back from local is one command.
- README links the plain-words privacy and security pages.

## 2.6.0 — 2026-10-21

**Connect it, and the first chat builds your soul.**

### Added
- `build_soul` tool: builds the soul from what already exists on this machine (Claude Code, Cursor, OpenClaw). `upload=false` is a local preview; `upload=true` only after the user agrees in chat. Uploads in batches of 45 to stay under the rate limit; re-runs send only new or changed items.
- First run: on a new soul (no daily logs, no articles, fewer than 3 memories) `load_soul` and `get_soul_state` return `first_run`, telling the AI to run `build_soul` before anything else.
- `import openclaw`: an OpenClaw workspace's daily notes → daily logs, `MEMORY.md` bullets → memories, topic notes + git-tracked skills → knowledge articles. Changed notes update in place (keyed articles, per-day logs), so it is safe on a cron. `OPENCLAW_PROFILE` picks `~/.openclaw-<profile>/workspace`.

### Changed
- Import code is one pipeline (`src/import/pipeline.js`) shared by the CLI and `build_soul`.
- Knowledge articles can carry a stable `key`; the server updates the article with that key instead of adding a copy.

## 2.5.1 — 2026-10-21

### Fixed
- `setup --help` (or any flag) was taken as the API key and written into every editor's MCP config, breaking a working setup. Flags are now rejected; `--help` / `-h` prints usage and changes nothing.
- `import --help` printed "Bad option"; it now prints the import options. `status --help` prints help instead of running a status check.

## 2.5.0 — 2026-10-21

**Your soul, your history — local-first.**

### Added
- Tools: `daily_log`, `kb_write`, `kb_search`, `history_search` (local brain only, no network).
- Prompt: `seed_bootstrap` — mine local history into preferences, corrections and a daily log.
- CLI: `import claude-code`, `import cursor` (best effort), `status`, `--help`, `--version`.
- Local brain at `~/.seed/brain.sqlite` (sql.js / WASM — no native build): `sessions`, `messages`, `days` tables, idempotent imports, keyword search with IDF scoring.
- Secret scrubber (`src/scrub.js`) applied before anything is stored locally or uploaded.
- Consent-gated upload of per-day digests + preference candidates (`--yes`, `--local-only`, `--days N`); re-imports never duplicate.
- `setup` also saves the key to `~/.seed/config.json` (chmod 600) so CLI commands work without env vars.
- Tool annotations (`readOnlyHint`, `openWorldHint`…), structured results, stable error codes (`NO_KEY`, `NO_SOUL`, `UNAUTHORIZED`, `RATE_LIMITED`, `TIMEOUT`…), 15 s request timeout, 429 retry for bulk uploads.

### Changed
- `load_soul` loads **your** soul via `/api/v1/me` (no default soul name); optional `soul_id` for another soul on the same account. Returns state, recent memories, active corrections, today's log status and KB size.
- `get_soul_state` / `evolve_soul` use `/api/v1/seeds/{id}/state` and `/evolve`.
- bin is now `src/cli.js`; no args still starts the MCP server, `setup <KEY>` is unchanged.
- Code split by feature (`src/features/`, `src/brain/`, `src/import/`), every file ≤ 300 lines.

### Removed
- Retired `/api/souls/*` routes (now 410 on the server) and the admin brain-status call.
- Stale skill counts from docs and tool descriptions.

2.4.0 source: git tag `v2.4.0`.
