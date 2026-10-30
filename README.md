<p align="center">
  <h1 align="center">🧬 SEED Protocol</h1>
  <p align="center"><strong>Give your AI a soul, not just a system prompt.</strong></p>
  <p align="center">
    Memories, corrections, daily logs and a knowledge base that follow you<br/>
    across Claude, Cursor, Windsurf and VS Code. Your raw history stays on your machine.
  </p>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/seed-protocol-mcp"><img src="https://img.shields.io/npm/v/seed-protocol-mcp?style=flat-square&color=7c3aed" alt="npm"></a>
  <a href="https://www.npmjs.com/package/seed-protocol-mcp"><img src="https://img.shields.io/npm/dm/seed-protocol-mcp?style=flat-square&color=7c3aed" alt="downloads"></a>
  <a href="https://seed.abhibots.com"><img src="https://img.shields.io/badge/Hub-seed.abhibots.com-7c3aed?style=flat-square" alt="hub"></a>
</p>

---

## The problem

Every AI forgets you when the session ends. Your preferences, your stack, the mistakes it already made — gone. Next session starts from zero, in every tool.

**SEED fixes this.** Your AI gets one persistent soul: it loads who you are at the start of each conversation, learns from corrections, writes a daily log, and builds a knowledge base — the same soul in every MCP client you use.

## Quick start

1. Sign in at **[seed.abhibots.com/login](https://seed.abhibots.com/login)**, create your soul and copy your API key from the dashboard.
2. Run:

   ```bash
   npx seed-protocol-mcp setup YOUR_API_KEY
   ```

   This adds SEED to every MCP client it finds (Claude Desktop, Claude Code, Cursor, Windsurf, VS Code/Cline).
3. Restart your editor and start a chat. On a new soul the AI's first job is `build_soul`: it reads what already exists on your machine — Claude Code / Cursor history, or an OpenClaw agent's notes — shows you a preview, and uploads only if you say yes. After that it calls `load_soul` at the start of every conversation.

   Prefer the terminal? Same thing, same consent question:

   ```bash
   npx seed-protocol-mcp import claude-code
   ```

### Hybrid mode — one soul on every device, synced on your terms

```bash
npx seed-protocol-mcp setup --hybrid YOUR_API_KEY
```

The soul lives on this machine, and only the parts you tick in the dashboard (Privacy → **Devices & sync**: memories, corrections, traits, knowledge, daily logs) are copied to your cloud soul — so your laptop, a VPS agent and every AI tool share them. Reads merge both. Offline is fine: writes wait locally and go up at the next start or with `npx seed-protocol-mcp sync`.

### Local-only mode — no account, nothing sent

```bash
npx seed-protocol-mcp setup --local
```

Every tool works the same, but the soul lives in `~/.seed/soul.sqlite` on your machine and the connector never calls the SEED server. No API key, no dashboard. Switch to online later with `setup YOUR_API_KEY`. (Same thing by hand: set `SEED_MODE=local` in the MCP config's `env`.)

<details>
<summary><strong>Manual MCP config</strong></summary>

```json
{
  "mcpServers": {
    "seed-protocol": {
      "command": "npx",
      "args": ["-y", "seed-protocol-mcp@latest"],
      "env": {
        "SEED_API_KEY": "YOUR_API_KEY",
        "SEED_API_URL": "https://seed.abhibots.com"
      }
    }
  }
}
```
</details>

## MCP tools

| Tool | When the AI uses it |
|------|---------------------|
| `load_soul` | First thing in every conversation — who the AI is (it speaks as the soul, not as a generic assistant), who you are, the rules (corrections it must never repeat), your strongest and newest memories, the last log and your workspace. On a new soul it returns `first_run` |
| `build_soul` | First job on a new soul (or when you ask to import) — builds it from this machine's history: preview first, upload only after you agree, re-runs send only what changed |
| `get_soul_state` | Current emotional state, learned traits and counts |
| `evolve_soul` | Record a stable behaviour pattern as a trait (e.g. `likes-concise-answers`) |
| `remember` | Save a durable fact, preference or decision |
| `recall` | Search saved memories (hybrid keyword + semantic) |
| `correct` | The user corrected the AI — saved forever, escalates if repeated |
| `get_skills` | List the skills attached to the soul, by category |
| `daily_log` | End of a meaningful session — what was done, decisions, next steps. Saved under the app's own name (`claude-code`, `cursor`…), so two apps never overwrite each other |
| `kb_write` | Save reusable know-how as a knowledge-base article |
| `kb_search` | Read knowledge-base articles |
| `history_search` | Search your past AI sessions in the **local** brain — never calls the network |
| `search` | One search across the whole soul — rules, memories, workspace documents and the sessions you brought into SEED (local-only mode: this machine's memories and notes) |
| `ws_tree` · `ws_read` · `ws_write` · `ws_mkdir` · `ws_move` · `ws_archive` | Your workspace — Markdown documents in folders that you and your AIs grow together. Edits carry the version they read, so the AI never overwrites your own change; an AI never deletes, it archives |
| `projects` · `project_update` | Your projects — each is the workspace folder `projects/<slug>/`, its README's front-matter (status, repo, live URL, stack, what's happening now) kept current by your AI. Shown on the dashboard's Projects tab |
| `send_report` · `my_reports` | With your OK, tell the SEED team about a bug or an idea; their replies come back in `load_soul` |

The workspace, `search` over the cloud and reports need online or hybrid mode; in local-only mode those tools say so.

**Prompt:** `seed_bootstrap` — asks the AI to mine your recent local history for durable preferences (`remember`) and past corrections (`correct`), then write today's `daily_log`.

## CLI

```bash
npx seed-protocol-mcp setup <KEY>          # configure MCP clients + save key for the CLI
npx seed-protocol-mcp import claude-code   # ~/.claude/projects/*/*.jsonl → local brain (+ your git repos → Projects cards)
npx seed-protocol-mcp import cursor        # Cursor state.vscdb → local brain (best effort)
npx seed-protocol-mcp import openclaw      # OpenClaw workspace notes → daily logs, memories, articles
npx seed-protocol-mcp status               # key, API reachability, soul, local brain counts
npx -y seed-protocol-mcp                   # start the MCP server on stdio (what clients run)
```

Import options:

| Option | Meaning |
|--------|---------|
| `--yes` | Upload without asking (after the local import) |
| `--local-only` | Build the local brain only — never upload |
| `--days N` | Upload digests for the last N days (default 30, `0` = all) |
| `--path P` | Custom Claude Code projects dir, Cursor `state.vscdb` path or OpenClaw workspace |
| `--full` | Re-read Claude Code files even if unchanged |
| `--key K` | API key (default: `SEED_API_KEY`, else the key saved by `setup`) |

Re-running an import is safe: messages are stored once, and digests, memories and articles that were already uploaded are not sent again — only new or changed items go. That makes `import openclaw --yes` fine on a cron, so an always-on agent keeps its dashboard current:

```bash
*/15 * * * * npx -y seed-protocol-mcp import openclaw --yes >> ~/.seed/openclaw-sync.log 2>&1
```

## Privacy

Plain-words policy: **[seed.abhibots.com/privacy](https://seed.abhibots.com/privacy)** · security: [seed.abhibots.com/security](https://seed.abhibots.com/security). On the server, everything you keep is encrypted at rest with a key derived from your API key.

- **Raw history stays local.** Imports write to `~/.seed/brain.sqlite` (owner-only permissions). `history_search` reads only that file and makes no network request. Delete the file to wipe it.
- **Nothing is uploaded without consent.** After an import you see a summary and the question `Upload N daily logs and M preference memories to your SEED dashboard? (y/N)`. Only `y` (or `--yes`) uploads. `--local-only` never does. In chat, `build_soul` shows the same preview and the AI must ask you before calling it with `upload=true`.
- **What gets uploaded (only after yes):**
  - one digest per day — date, session and message counts, project folder names, and the first line of each of your prompts (truncated);
  - up to 50 preference sentences you wrote yourself (lines with *always / never / don't / prefer / instead / hamesha / mat karo …*), as `preference` memories;
  - one import record with counts only.

  Assistant replies, tool output, code blocks and full conversations are never uploaded.
- **OpenClaw is different on purpose:** those files are the agent's own notes, so they go as written (scrubbed): `memory/YYYY-MM-DD.md` as daily logs (first ~19k chars), `MEMORY.md` bullets as memories, other `memory/*.md` notes and the skills committed to the workspace git as knowledge articles. Installed (untracked) skill packs, `SOUL.md`, `USER.md` and session transcripts are not read.
- **Secrets are scrubbed** before anything is stored locally *and* again before any upload: OpenAI/Anthropic keys, SEED keys, AWS access keys, GitHub/Slack/Google/Stripe/Telegram tokens, JWTs, bearer tokens, PEM private keys, `scheme://user:pass@` credentials and `api_key=… / password: …` style assignments become `[REDACTED:<type>]`. The server scrubs once more on write.

## Configuration

| Env var | Default | Purpose |
|---------|---------|---------|
| `SEED_API_KEY` | — | Your key from the dashboard |
| `SEED_API_URL` | `https://seed.abhibots.com` | API base URL |
| `SEED_HOME` | `~/.seed` | Local brain, local soul (local-only mode) and CLI config |
| `SEED_MODE` | — | `local` = nothing sent · `hybrid` = this device + what you sync · `online` overrides a saved setup |
| `CLAUDE_CONFIG_DIR` | `~/.claude` | Where `import claude-code` looks for `projects/` |
| `OPENCLAW_PROFILE` | — | `import openclaw` reads `~/.openclaw-<profile>/workspace` instead of `~/.openclaw/workspace` |

Requires Node.js 18+. No native build — the local brain uses [sql.js](https://github.com/sql-js/sql.js) (SQLite compiled to WebAssembly).

## Links

- 🌐 [seed.abhibots.com](https://seed.abhibots.com) — sign in, dashboard, API key
- 📚 [seed.abhibots.com/docs](https://seed.abhibots.com/docs) — API documentation
- 📦 [npm](https://www.npmjs.com/package/seed-protocol-mcp)

## License

MIT
