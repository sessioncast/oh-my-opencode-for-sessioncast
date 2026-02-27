# Oh My OpenCode for SessionCast

[Oh My OpenCode](https://github.com/code-yeongyu/oh-my-opencode) + [SessionCast](https://sessioncast.io) provider.

Use specialized AI agents (Sisyphus, Oracle, Prometheus) powered by your own local LLM backend through SessionCast.

## Quick Start

### 1. Install SessionCast CLI

```bash
npm i -g sessioncast-cli
sessioncast login
sessioncast agent
```

### 2. Install Oh My OpenCode for SessionCast

```bash
git clone -b feat/sessioncast-provider \
  https://github.com/sessioncast/oh-my-opencode-for-sessioncast.git
cd oh-my-opencode-for-sessioncast
npm install && npm run build
npm link
```

### 3. Configure Agents

Create `~/.config/opencode/oh-my-opencode.json`:

```json
{
  "agents": {
    "sisyphus": { "model": "sessioncast/claude-code" },
    "oracle": { "model": "sessioncast/claude-code" },
    "prometheus": { "model": "sessioncast/claude-code" }
  }
}
```

### 4. Run

```bash
oh-my-opencode run 'Explain what Kubernetes is in 2 sentences.'
```

## How It Works

```
Oh My OpenCode
  → OpenCode (TypeScript)
    → SessionCast Provider
      → SessionCast Relay
        → CLI Agent (your machine)
          → Claude Code / Ollama / OpenAI / Gemini ...
```

All AI requests are routed through your local SessionCast CLI agent. You choose the LLM backend — Claude Code CLI, Ollama, OpenAI API, Anthropic API, Gemini, or Codex CLI.

## LLM Backend Configuration

Configure your preferred backend in `~/.sessioncast.yml`:

```yaml
api:
  llm:
    provider: claude-code   # or ollama, openai, anthropic, gemini
    model: sonnet
```

Switch models without changing Oh My OpenCode config. The provider stays `sessioncast/claude-code` — only the backend changes.

## About This Fork

This is a fork of [Oh My OpenCode](https://github.com/code-yeongyu/oh-my-opencode) with the SessionCast provider added. The SessionCast provider enables all agents to route AI requests through your local CLI agent, giving you full control over which LLM you use.

**This fork does not use Claude Pro/Max OAuth tokens.** SessionCast calls LLM APIs with your own API keys or local models. See [Anthropic's compliance policy](https://code.claude.com/docs/en/legal-and-compliance) for details on OAuth restrictions.

## Links

- [SessionCast](https://sessioncast.io) — Product page
- [SessionCast CLI](https://www.npmjs.com/package/sessioncast-cli) — npm package
- [OpenCode](https://github.com/anomalyco/opencode) — Go-based terminal AI assistant
- [Oh My OpenCode](https://github.com/code-yeongyu/oh-my-opencode) — Original project
- [Blog Post](https://sessioncast.io/blog/2026-02-27-opencode-integration) — Full setup guide
