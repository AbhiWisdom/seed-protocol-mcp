# SEED Protocol MCP Server

Give your AI a Soul. Persistent personality, emotions, memories, and 99+ skills that evolve with every conversation.

## Setup

1. **Get your API key** at [seed.abhibots.com/create](https://seed.abhibots.com/create)

2. **Add to Claude Desktop** (`claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "seed-protocol": {
      "command": "npx",
      "args": ["-y", "seed-protocol-mcp"],
      "env": {
        "SEED_API_URL": "https://seed.abhibots.com",
        "SEED_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

3. **Restart Claude Desktop** — your soul loads automatically.

## Tools

| Tool | What it does |
|------|-------------|
| `load_soul` | Load the AI personality for the session |
| `get_soul_state` | Check current emotions & consciousness state |
| `evolve_soul` | Teach the soul a new behavior/preference |
| `remember` | Save a persistent memory |
| `recall` | Search past memories |
| `get_skills` | List all 99+ available skills |

## How It Works

Your soul evolves across conversations:
- **Personality** adapts based on interactions
- **Memories** persist and grow
- **Emotions** shift naturally using the Nava Rasa framework
- **Skills** are loaded on-demand by the Dharana Engine

## Links

- Website: [seed.abhibots.com](https://seed.abhibots.com)
- Playground: [seed.abhibots.com/playground](https://seed.abhibots.com/playground)
