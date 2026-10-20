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
3. Restart your editor. The AI calls `load_soul` at the start of each conversation.
4. Optional — give your soul a head start from your past AI sessions (stays local until you say yes):

   ```bash
   npx seed-protocol-mcp import claude-code
   ```

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
| `load_soul` | First thing in every conversation — identity, personality, live state, 10 recent memories, active corrections (never repeat), today's log status, knowledge-base size |
| `get_soul_state` | Current emotional state, learned traits and counts |
| `evolve_soul` | Record a stable behaviour pattern as a trait (e.g. `likes-concise-answers`) |
| `remember` | Save a durable fact, preference or decision |
| `recall` | Search saved memories (hybrid keyword + semantic) |
| `correct` | The user corrected the AI — saved forever, escalates if repeated |
| `get_skills` | List the skills attached to the soul, by category |
| `daily_log` | End of a meaningful session — what was done, decisions, next steps |
| `kb_write` | Save reusable know-how as a knowledge-base article |
| `kb_search` | Read knowledge-base articles |
| `history_search` | Search your past AI sessions in the **local** brain — never calls the network |

**Prompt:** `seed_bootstrap` — asks the AI to mine your recent local history for durable preferences (`remember`) and past corrections (`correct`), then write today's `daily_log`.

## CLI

```bash
npx seed-protocol-mcp setup <KEY>          # configure MCP clients + save key for the CLI
npx seed-protocol-mcp import claude-code   # ~/.claude/projects/*/*.jsonl → local brain
npx seed-protocol-mcp import cursor        # Cursor state.vscdb → local brain (best effort)
npx seed-protocol-mcp status               # key, API reachability, soul, local brain counts
npx -y seed-protocol-mcp                   # start the MCP server on stdio (what clients run)
```

Import options:

| Option | Meaning |
|--------|---------|
| `--yes` | Upload without asking (after the local import) |
| `--local-only` | Build the local brain only — never upload |
| `--days N` | Upload digests for the last N days (default 30, `0` = all) |
| `--path P` | Custom Claude Code projects dir or Cursor `state.vscdb` path |
| `--full` | Re-read Claude Code files even if unchanged |
| `--key K` | API key (default: `SEED_API_KEY`, else the key saved by `setup`) |

Re-running an import is safe: messages are stored once, and digests/preferences that were already uploaded are not sent again.

## Privacy

- **Raw history stays local.** Imports write to `~/.seed/brain.sqlite` (owner-only permissions). `history_search` reads only that file and makes no network request. Delete the file to wipe it.
- **Nothing is uploaded without consent.** After an import you see a summary and the question `Upload N daily logs and M preference memories to your SEED dashboard? (y/N)`. Only `y` (or `--yes`) uploads. `--local-only` never does.
- **What gets uploaded (only after yes):**
  - one digest per day — date, session and message counts, project folder names, and the first line of each of your prompts (truncated);
  - up to 50 preference sentences you wrote yourself (lines with *always / never / don't / prefer / instead / hamesha / mat karo …*), as `preference` memories;
  - one import record with counts only.

  Assistant replies, tool output, code blocks and full conversations are never uploaded.
- **Secrets are scrubbed** before anything is stored locally *and* again before any upload: OpenAI/Anthropic keys, SEED keys, AWS access keys, GitHub/Slack/Google/Stripe/Telegram tokens, JWTs, bearer tokens, PEM private keys, `scheme://user:pass@` credentials and `api_key=… / password: …` style assignments become `[REDACTED:<type>]`. The server scrubs once more on write.

## Configuration

| Env var | Default | Purpose |
|---------|---------|---------|
| `SEED_API_KEY` | — | Your key from the dashboard |
| `SEED_API_URL` | `https://seed.abhibots.com` | API base URL |
| `SEED_HOME` | `~/.seed` | Local brain + CLI config location |
| `CLAUDE_CONFIG_DIR` | `~/.claude` | Where `import claude-code` looks for `projects/` |

Requires Node.js 18+. No native build — the local brain uses [sql.js](https://github.com/sql-js/sql.js) (SQLite compiled to WebAssembly).

## Links

- 🌐 [seed.abhibots.com](https://seed.abhibots.com) — sign in, dashboard, API key
- 📚 [seed.abhibots.com/docs](https://seed.abhibots.com/docs) — API documentation
- 📦 [npm](https://www.npmjs.com/package/seed-protocol-mcp)

## License

MIT
