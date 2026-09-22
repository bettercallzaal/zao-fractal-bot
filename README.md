# ZAO Fractal Bot (fresh rebuild)

Discord bot for running the weekly ZAO Fractal Respect Game. Ground-up rebuild
of [fractalbotapril2026](https://github.com/bettercallzaal/fractalbotapril2026),
built on the stack decisions in ZAOOS research
[doc 982](https://github.com/bettercallzaal/ZAOOS/tree/main/research/governance/982-fresh-fractal-bot-rebuild-stack),
which in turn is grounded in [doc 981](https://github.com/bettercallzaal/ZAOOS/tree/main/research/governance/981-fractal-bot-synthesis)
(the full synthesis of the old bot + the whitepaper + verified on-chain state).

## Stack

- **discord.js** (TypeScript) - not discord.py. Shares a language with the ZAOOS
  web app and the ZOE agent, so Respect-scoring logic can be a single shared
  implementation instead of two independently-maintained ones (the exact gap
  flagged in doc 981).
- **viem** for all Optimism reads/writes - no raw JSON-RPC calls.
- **`@ordao/orclient`** for OREC/Respect contract integration.
- **Supabase** for persistence - same tables ZAOOS already uses
  (`fractal_sessions`, `fractal_scores`, `respect_members`). No local JSON
  files.
- **Vitest** - tests from commit 1, not bolted on later.

## What's carried forward from fractalbotapril2026

- Elimination-voting mechanic (level 6 -> 1, majority threshold) -
  `src/lib/voteThreshold.ts`.
- Fibonacci Respect point table `[110, 68, 42, 26, 16, 10]` - `src/config.ts`.
- The Respect-weight formula, ported to match the ZAOOS app's
  `computeRespectWeight()` exactly - `src/lib/respectWeight.ts`.

## What's deliberately different

- No JSON-file persistence layer.
- One Respect-weight implementation shared in spirit with ZAOOS (see
  `src/lib/respectWeight.ts`'s doc comment) instead of two independent ones.
- Test coverage required for new logic, starting with vote math and the
  Respect formula (`src/lib/*.test.ts`).
- Multi-signer OREC submission is a design requirement, not an afterthought -
  the current bot's 94%-single-relayer bottleneck (doc 975/977) should not be
  reproduced here.

## Getting started

```bash
npm install
cp .env.example .env   # fill in DISCORD_TOKEN at minimum
npm test                # run the test suite
npm run dev             # start the bot (requires DISCORD_TOKEN)
```

## Subsystems and Architecture Status (Updated 2026-09-21)

Following Zaal's binding architectural ruling on 2026-09-01, the bot is structured into two distinct subsystems:

### Subsystem 1: Respect Game Core (LIVE)
- **Status:** Active in production.
- **Components:**
  - Breakout circle seating and Fibonacci award split (`src/game/session.ts`, `seating.ts`, `split.ts`).
  - Automated roster capture and member resolution across Discord, wallet, and Farcaster (`src/game/rosterCapture.ts`).
  - Voice channel presence tracking and automatic camera detection (+10 points).
  - Embedded fractal and ecosystem knowledge lookup (`src/lib/fractalKnowledge.ts`).
  - Local loopback HTTP API (`127.0.0.1:8080`) and Supabase persistence.
  - Comprehensive unit test coverage across all pure game mechanics.

### Subsystem 2: Hats Protocol, Teams, and Governance (DEFERRED ROADMAP)
- **Status:** Formally deferred in roadmap.
- **Scope:**
  - Hats Protocol Tree 226 on Optimism role verification and sync.
  - Team assignments, working groups, and project boards.
  - On-chain OREC proposal submission and multi-signer relayer flows.
- **Context:** The deprecated Python bot v1 (`fractalbotapril2026`) previously coupled these features into monolithic cogs, triggering rate-limit bans and notification loops. Per Zaal's ruling ("v1 stays down. v2 takes the game. Its hats, proposals, and events cogs return later as v2 subsystems"), Subsystem 2 will be reintroduced as cleanly isolated modules only after Subsystem 1 settles in live weekly ceremonies.
