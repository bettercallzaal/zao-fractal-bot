# Optimystics' Respect.Games app - evaluate before building more

> Zaal, 2026-09-08: evaluate it before building more, same call he made on herdr.
> **Verdict: KEEP BUILDING.** Reasons below, each measured today.

Searched the research library first (`zao-research-index`). **The library already held the
answer** - `governance/982-fresh-fractal-bot-rebuild-stack`, the stack-decision doc for this
very rebuild, recorded in July 2026 that it had searched "Optimystics' full toolkit
(Fractalgram, FRAPPS, Respect.Games, op-fractal-sc)" and concluded *"Do not adopt an external
fractal/Respect-game framework - none exists... This is a genuine negative result, not a weak
match stretched to fit."*

That doc asked a narrower question than Zaal's, though - it was looking for a **Discord bot
framework**. This evaluation re-asks it for **async participation** specifically, and checks
the repos as they stand today.

---

## 1. Does it cover async fractal participation?

**Yes, but it is the wrong shape.** The library consistently describes Respect.Games as an
"async all-in-one app" (`community/106-dan-singjoy-eden-fractal-deep-dive`) and an
"async-first web app" (`governance/306-eden-fractal-op-fractal-deep-history`).

Async-*first* is the problem. It replaces the live session. What ZAO is building adds absent
people to a session that still happens live, because Zaal explicitly refused async voting:
ranking before hearing the presentations inverts the Respect Game. These are different
products that share a word.

## 2. Our contracts, or its own?

**Its own, completely.** `Optimystics/Respect.Games-app-smart-contracts` ships a parallel
governance stack:

```
CommunityGovernanceContributions{Implementation,Storage}.sol
CommunityGovernanceRankings{Implementation,Storage}.sol
CommunityGovernanceProfiles{Implementation,Storage}.sol
CommunityGovernanceMultisig{Implementation,Storage}.sol
CommunityStateManager.sol
CommunityToken.sol            <- its own token
```

Nothing there touches ZAO's actual setup: OG Respect (`0x34cE89`, ERC-20, the frozen ledger),
ZOR (`0x9885CC`, ERC-1155), or the OREC executor (`0xcB05F9`). `ZOR.owner()` is the OREC
executor, so minting requires an executed OREC proposal.

Adopting this means either migrating ZAO's Respect onto a new token - abandoning the existing
ledger and its 122 OG holders - or running two governance systems side by side. **This is the
finding that decides it.**

## 3. Usable beta, or aspirational?

**Beta in name, dormant in fact.** Measured on GitHub today:

| | |
|---|---|
| `Optimystics/respect.games-ui` last commit | **2025-05-20** (~16 months) |
| `Optimystics/Respect.Games-app-smart-contracts` last commit | **2024-11-18** (~22 months) |
| Stars on either | **0** |
| Newest push anywhere in the Optimystics org | **2025-05-20** - the whole org is quiet |
| `respect.games-ui` README | **unmodified Create React App boilerplate** - no project documentation at all |

`governance/982` also recorded Optimism Fractal on "indefinite hiatus" per Optimystics' own
blog, with attention moved to Eden Fractal.

A README nobody replaced is a fair proxy for how much external adoption was expected.

## 4. Licence - read from the LICENSE file, not the API field

| Repo | LICENSE file says |
|---|---|
| `Optimystics/respect.games-ui` | **MIT**, Copyright (c) 2024 lennarlehestik |
| `Optimystics/Respect.Games-app-smart-contracts` | **MIT**, Copyright (c) 2024 n0umen0n |

Both permissive. **Licence is not the blocker here** - fit and maintenance are. Worth stating
plainly, because "we can't use it" would be the wrong reason to walk away.

---

## Verdict: KEEP BUILDING

Not because nothing exists, but because what exists solves a different problem with a
different token and has not been touched in over a year. Adopting it would replace ZAO's
Respect ledger to gain an async model Zaal has already rejected.

**Adopt-in-part, and it is already done:** `@ordao/orclient` - the live, maintained piece that
actually speaks ZAO's contracts (published 2026-04-02, from `sim31/ordao`, 266 commits) - is
already a dependency, per `governance/982` recommendation #3. Nothing from Respect.Games
should be adopted.

---

## Two problems found while checking, unrelated to the verdict

**1. Licence conflict, MIT against GPL-3.0.** `zao-fractal-bot`'s own LICENSE file is **MIT**
(Copyright 2026 Zaal Panthaki / BCZ Strategies LLC / The ZAO). `@ordao/orclient@1.4.4` is
published as **GPL-3.0**, and its repo `sim31/ordao` carries the full GPL-3.0 text.

GPL-3.0 is copyleft. If the bot is distributed while linking it, GPL-3.0's terms generally
extend to the combined work, which contradicts the MIT declaration. This is a question for
Zaal, not something a lane should quietly resolve. Note also `package.json` has **no `license`
field at all**, so the two statements about licensing that do exist are the LICENSE file and
the dependency - and they disagree.

**2. `@ordao/orclient` is pinned to `"latest"`.** `package.json:27`. Every other critical
dependency in this project was deliberately pinned to an exact version - `governance/982`
pinned viem to 2.54.6 on purpose. An unpinned dependency on a GPL-3.0 package that reaches
onchain writes is worth a version number.
