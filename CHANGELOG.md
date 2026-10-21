# Changelog

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
