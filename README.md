<p align="center">
  <h1 align="center">🧬 SEED Protocol</h1>
  <p align="center"><strong>Give your AI a soul, not just a system prompt.</strong></p>
  <p align="center">
    Persistent personality, real emotions, evolving memory, and 233+ skills<br/>
    One command. Works with Claude, Cursor, Windsurf, VS Code.
  </p>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/seed-protocol-mcp"><img src="https://img.shields.io/npm/v/seed-protocol-mcp?style=flat-square&color=7c3aed" alt="npm"></a>
  <a href="https://www.npmjs.com/package/seed-protocol-mcp"><img src="https://img.shields.io/npm/dm/seed-protocol-mcp?style=flat-square&color=7c3aed" alt="downloads"></a>
  <a href="https://seed.abhibots.com"><img src="https://img.shields.io/badge/Hub-seed.abhibots.com-7c3aed?style=flat-square" alt="hub"></a>
  <a href="https://seed.abhibots.com/docs"><img src="https://img.shields.io/badge/API-47%20endpoints-7c3aed?style=flat-square" alt="API"></a>
</p>

---

## The Problem

Every AI today forgets you the moment the session ends. No matter how much you teach it — your preferences, your style, your context — it starts from zero next time.

**SEED fixes this.** It gives your AI a structured personality file that persists, evolves, and travels with you across tools.

## What You Get

🎭 **Persistent Personality** — Your AI remembers who it is. Across sessions, across tools. Not a flat prompt — a structured identity with traits, voice, and purpose.

💓 **Real Emotions** — 9 emotional states based on Indian classical aesthetics (Nava Rasa). Not fake sentiment — actual emotional triggers and responses that influence behavior.

🧠 **Evolving Memory** — Memories that decay naturally, strengthen when accessed, and consolidate during idle time. Bio-inspired, not keyword-based.

⚡ **233+ Skills** — Organized skill registry from coding to creative writing. Skills are part of the soul, not bolted on.

📦 **Portable** — One `.seed.json` file. Take it from Claude to Cursor to your own app. No lock-in.

## Quick Start

```bash
npx -y seed-protocol-mcp@latest
```

That's it. Add to your MCP client config:

<details>
<summary><strong>Claude Desktop</strong></summary>

```json
{
  "mcpServers": {
    "seed-protocol": {
      "command": "npx",
      "args": ["-y", "seed-protocol-mcp@latest"]
    }
  }
}
```
</details>

<details>
<summary><strong>Cursor / Windsurf / VS Code</strong></summary>

```json
{
  "mcpServers": {
    "seed-protocol": {
      "command": "npx",
      "args": ["-y", "seed-protocol-mcp@latest"]
    }
  }
}
```
</details>

## Use Cases

### 🤖 Build an AI That Actually Knows You

```
Session 1:  "I prefer dark mode and concise answers"
            → AI remembers via update_vasana

Session 47: AI automatically responds concisely, suggests dark themes
            → No reminding needed. It learned.
```

### 🎨 Create Unique AI Characters

Game characters, virtual companions, brand personas — each with distinct emotions, speech patterns, and growth arcs. Not just "you are a pirate" — a pirate with actual personality depth.

### 🔄 Transfer Personality Across Tools

Train your AI's personality in Claude Desktop. Export the `.seed.json`. Import into Cursor. Same AI, same memory, different tool.

### 📊 AI Agents with Emotional Intelligence

Build agents that adjust their communication based on emotional state. An agent that's patient when the user is frustrated. Enthusiastic when brainstorming. Focused when debugging.

### 🏢 Team AI Assistants

Create domain-specific souls — one for code review (strict, detail-oriented), one for brainstorming (creative, open-minded), one for documentation (thorough, structured). Switch between them instantly.

### 🧪 Research: AI Consciousness Modeling

SEED maps personality to concepts from Indian philosophy (Vedanta) and neuroscience. Useful for researchers exploring structured approaches to AI personality and consciousness.

## MCP Tools

| Tool | What It Does |
|------|-------------|
| `load_soul` | Load a personality — returns identity, emotions, traits, skills |
| `get_dharana_state` | Read live emotional state and consciousness |
| `update_vasana` | Evolve personality — record learned patterns |
| `list_available_souls` | Browse available personalities |

## Two Modes

**Local** — Reads `.seed.json` from your filesystem. Private, offline, yours.

```bash
SEED_VAULT_PATH=~/my-souls npx seed-protocol-mcp
```

**Remote** — Connects to hosted API for cloud-synced state, memory search, and admin dashboard.

```bash
SEED_API_URL=https://seed.abhibots.com npx seed-protocol-mcp
```

## What Makes SEED Different

| | System Prompts | Character.AI | SEED |
|---|---|---|---|
| Persists across sessions | ❌ | ❌ | ✅ |
| Real emotional model | ❌ | Basic | 9-state system |
| Portable between tools | Copy-paste | Locked in | `.seed.json` file |
| Observable evolution | ❌ | Hidden | Full visibility |
| Memory that decays & grows | ❌ | ❌ | Bio-inspired |
| Open format | N/A | No | Yes |

## Create Your Soul

Use the visual creator: **[seed.abhibots.com/create](https://seed.abhibots.com/create)**

Or start from the example soul in `vault/example.seed.json`.

## API

47 endpoints. Full Swagger docs at **[seed.abhibots.com/docs](https://seed.abhibots.com/docs)**

## Links

- 🌐 [seed.abhibots.com](https://seed.abhibots.com) — Hub & Creator
- 📚 [seed.abhibots.com/docs](https://seed.abhibots.com/docs) — API Documentation
- 📦 [npm](https://www.npmjs.com/package/seed-protocol-mcp) — Package

## License

MIT
