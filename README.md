# AEOkit Agent

A local-first agent harness that investigates why a brand is absent from AI answers, proposes a small website change, applies it only with approval, and preserves the evidence needed to verify the result.

It runs through an existing authenticated Codex or Claude Code installation. No separate model API key is required.

> Early development. AEOkit Agent can verify technical properties and run directional simulations. It cannot promise rankings, indexing, mentions, citations, or ingestion by a public answer engine.

## The job

```console
$ npx aeokit-agent init https://example.com \
    --brand "Example" \
    --category "API testing" \
    --audience "backend teams" \
    --competitors "Competitor A,Competitor B"

$ npx aeokit-agent improve \
    --query "What are the best open-source API testing tools?" \
    --provider codex \
    --observer claude
```

The first command creates `.aeokit/config.json`. The second command inspects the repository and deployed page, records a blind baseline through [AEO Preview](https://github.com/aeokit-dev/aeo-preview), and asks a fresh operator agent for an evidence-backed proposal.

Review the proposal, then explicitly approve edits:

```bash
aeokit-agent apply latest --provider codex
aeokit-agent verify latest --provider claude
```

`apply` refuses a dirty worktree by default. It never commits, pushes, publishes, or deploys.

## Why this is an agent, not another score

A visibility tracker ends with a report. AEOkit Agent continues from observation to diagnosis, a reviewable patch, and verification:

```text
buyer objective
      │
      ▼
deterministic audit ──► blind baseline (AEO Preview)
      │                         │
      └──────────┬──────────────┘
                 ▼
          operator hypothesis
                 │
          human approval gate
                 │
                 ▼
             site patch
                 │
        ┌────────┴─────────┐
        ▼                  ▼
deterministic checks   blind verifier
        │                  │
        └────────┬─────────┘
                 ▼
 production observation after deployment
```

The optimizing agent never grades its own work. Fresh observer processes receive the unchanged buyer question without the operator's reasoning.

## Evidence levels

| Level | What it establishes | What it does not establish |
|---|---|---|
| Deterministic verification | Crawlability, extractability, metadata, schema, evidence links, and internal consistency | Public answer-engine visibility |
| Directional grounded simulation | A fresh agent can use the supplied post-change evidence | Indexing or ranking on a consumer surface |
| Production observation | A named public consumer surface returned a mention or citation for the unchanged prompt at a point in time | Causality or a durable ranking |

Artifacts live under `.aeokit/sessions/<session-id>/`: the before/after audits, raw baseline observation, proposal, apply report, patch, and blind verification. Current Codex and Claude observations are labeled directional agent simulations; consumer-surface collectors remain a separate future adapter.

## Commands

| Command | Purpose |
|---|---|
| `init` | Create the local brand and site profile |
| `audit` | Run deterministic local and deployed checks |
| `observe` | Run one buyer prompt through AEO Preview |
| `plan` | Produce an evidence-backed proposal without editing |
| `apply` | Apply an approved proposal in a clean worktree |
| `improve` | Run `plan`, optionally followed by `apply --apply` |
| `verify` | Run post-change checks and optional fresh observers |
| `tools` | List the typed AEO tools exposed by the harness |
| `skills` | List optional skills installed for AEOkit Agent |
| `doctor` | Check the local runtime and provider CLIs |

Use `--observer codex`, `--observer claude`, or `--observer fixture` for a reproducible baseline. Start with one sample; increase `--samples` only after inspecting the raw evidence.

## Skills

AEOkit Agent reads optional Agent Skills from:

- `.aeokit/skills/` for a project
- `~/.aeokit/skills/` for a user

The companion [aeokit-skills](https://github.com/aeokit-dev/aeokit-skills) repository contains the same focused workflows for AEOkit Agent, Codex, and Claude Code:

```bash
npx aeokit-skills add aeo-improve --to aeokit --scope project
```

## Architecture

The harness deliberately uses provider CLIs as isolated subprocesses. Codex runs ephemerally; Claude runs without session persistence. That preserves subscription-backed authentication while giving AEOkit a provider-neutral lifecycle, evidence store, approval boundary, and tool contract.

AEO Preview owns repeatable prompt measurement. AEOkit Agent owns investigation and execution. The broader AEOkit project remains the tool ecosystem; this repository is its opinionated agentic layer, not a replacement.

## Development

Requires Node.js 22.19 or newer.

```bash
npm install
npm run check
node bin/aeokit-agent.js doctor
```

Tests use deterministic fixtures and do not consume Codex or Claude quota.

The GitHub Actions definition is checked in as `.github/ci.yml.example`; move it to `.github/workflows/ci.yml` when the publishing token has GitHub's `workflow` scope.

## License

MIT
