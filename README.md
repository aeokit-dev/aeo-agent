# AeoKit Agent

A standalone agent client for the [AeoKit](https://github.com/aeokit-dev/aeokit) API runtime. It follows the interaction model of PostHog AI: a focused new-chat screen, capability-based starter prompts, persistent chat history, a compact sticky composer, grounded answers, and visible sources.

The visual identity uses AeoKit's official modular-K icon, cobalt palette, Inter typography, and neutral surface system from [aeokit.dev](https://aeokit.dev/).

## Run locally

```bash
npm install
cp .env.example .env.local
npm run dev
```

To run the native desktop application:

```bash
npm run dev:desktop
```

Create an unpacked application or macOS installer with:

```bash
npm run package:dir
npm run package:mac
```

By default the development server proxies `/api` to AeoKit at `http://127.0.0.1:3000`, avoiding browser CORS requirements. Change `VITE_AEOKIT_API_URL`, or use the settings button in the app. Hosted Cloudflare runtimes also require a valid bearer token.

The runtime needs an AI Chat backend configured (`OPENROUTER_API_KEY` or `AI_CHAT_BASE_URL`). This client does not hold model-provider credentials; it only talks to AeoKit.

## Local agents with ACP

Development mode also exposes Codex and Claude Code through the same Agent Client Protocol architecture used by Buzz. The official ACP SDK talks over stdio to:

- `@agentclientprotocol/codex-acp`
- `@agentclientprotocol/claude-agent-acp`

The bridge is localhost-only, rejects non-local browser origins, denies file access and permission requests, applies a five-minute turn timeout, and terminates the adapter when the browser disconnects. Choose Codex or Claude Code from the model picker in a chat. Their adapter authentication must already be configured locally.

## API contract

The client uses the existing AeoKit routes:

- `GET /projects`
- `GET /ai-chat/backends`
- `GET|POST /projects/:projectId/ai-chat/sessions`
- `GET|POST /ai-chat/sessions/:sessionId/messages`
- `DELETE /ai-chat/sessions/:sessionId`

## Checks

```bash
npm test
npm run typecheck
npm run build
```
