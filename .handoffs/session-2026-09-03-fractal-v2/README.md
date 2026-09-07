# Session handoff - 2026-09-03

> from mac, `zao-fractal-bot` @ `ws/async-participation-spec` -> to future Zaal, resuming Monday 2026-09-07
> doc: `.handoffs/session-2026-09-03-fractal-v2/README.md`
> chain: none

Every claim below was re-measured while writing this bundle, not recalled. The
command is next to the claim. Anything not re-checked says so.

## Receiver instructions (read me FIRST, then do exactly this)

1. Read ALL sections below (A through E) before responding to anything.
2. Create TaskList entries from section A.
3. Use section B as your "why" - do not re-litigate those decisions unless new
   information surfaces. Several were decided against my recommendation and
   that is recorded.
4. Section D lists what is still running. The research loop is stopped.
5. Section E is the cold-start map.
6. Once integrated, say: "Ingested handoff fractal-v2. 5 tasks queued. Ready."

---

## A. Tasks to absorb

- [ ] **Apply migrations 0001-0005 to the ZAO OS project** (`efsxtoxvigqowjhgcbiz`).
  Nothing in v2 can run until this lands. Verified 2026-09-03: `bot_commands`,
  `discord_roster` and `discord_fractal_rounds` all return HTTP 404. Additive
  only. Snapshot already at `~/.zao/backups/zao-os-fractal-20260901/`, and
  `scripts/backup-fractal-tables.mjs` re-runs it.
- [ ] **Push `ZAOfractal`.** `git status -sb` reads `ahead 32, behind 4` as of
  2026-09-03. Today's entire research pass - 13 commits - exists only on this
  mac. Pull/rebase first, it is behind.
- [ ] **Review PR #21** (async participation design). It gates
  `superpowers:writing-plans` for that feature. **PR #20** (backup script) is
  also open and independent.
- [ ] **Get a SEPARATE Discord bot token for v2**, then deploy to Railway.
  v1 is live and running the game right now. Two bots on one token doubles
  every vote. This is the single highest-risk mistake available on Monday.
- [ ] **Answer the five operator questions** in
  `ZAOfractal/research/09-open-questions-for-operators.md`. Most urgent: should
  periods 71 and 72 be minted? Ten members earned Respect in November 2025 and
  never received it, and nothing tracks that it is owed.

---

## B. Why - decisions, pivots, ruled-out paths

- **The five-month recording gap was never a code bug.** The deployed v1 `.env`,
  downloaded from the bot-hosting panel on 2026-09-01, has `ALCHEMY_API_KEY`,
  `DISCORD_TOKEN`, `FRACTAL_BOT_WEBHOOK_SECRET`, `WEB_WEBHOOK_URL` - and **no
  Supabase credentials at all**. The bot ran the game correctly every week and
  wrote nothing after 2026-03-23. Nobody could have found this by reading code.
- **The database is the state machine, and writes are synchronous.** Chosen
  because ZAO OS's fractal webhook documents itself as "fire-and-forget
  semantics (10s timeout)" - a recorder nothing depends on can die unobserved.
  A failed write now fails the round visibly in the thread.
- **No tie break at all.** Zaal, asked what happens when a group has not agreed:
  "No tie break we need consensus to move forward." That was neither option on
  the table. Implementing it forced a real-majority fix: `majorityThreshold`
  returned exactly half for even groups while being named a majority, and its
  own test asserted the bug under the name "strict majority". A 3-3 split in a
  six was decided by whichever third vote arrived first - a race on click order.
- **The tie break was never reachable anyway.** Zaal pushed back with "the tie
  breaker was never a thing" and he was right: 606,145 simulated vote sequences,
  zero hits. Recorded because I had written the opposite into the research first
  and had to correct it.
- **The bot sends every onchain transaction and never votes.** Zaal's choice
  against my recommendation of a weight-holding wallet. It is better: a leaked
  bot key wastes gas and nothing more. Consequence, load-bearing rather than
  optional - **members must actually vote**, and today nobody does except the
  relayer.
- **Async entrants are ranked but never counted in the vote threshold.**
  Otherwise every round they touch deadlocks, which is the failure already
  recorded as the passing test `known limitation: a silent member blocks the
  round`.
- **Group cap of 6 including async entrants.** `RESPECT_POINTS` has six entries
  and `finalRanking` pays `RESPECT_POINTS[index] ?? 0`, so a seventh member
  would silently earn nothing. The cap means that branch is never reached.
- **Research was redirected off fractal theory.** `reference/` already has 16
  documents on Larimer, Fractally, Eden and Optimism Fractal, all touched since
  2026-07-01. Re-researching them would have been waste. The gap was
  ZAO-specific measurement, and that is where the loop went.
- **Ruled out: subagents.** The plan-execution skill recommends them; they were
  not used because they were not requested and spawn unattended work.
- **Ruled out: reviving Mikael's Fractal Circles code** for async, which
  `research/04-async-identity-deep.md` recommends as Phase 1. Not rejected on
  merit - simply not evaluated, because v2 already has `contributions.ts` doing
  the submission and digest half. Worth an actual look before building.

---

## C. Git state

**`zao-fractal-bot`** - verified 2026-09-03 via `git status -sb`, `gh pr list`.

- Branch: `ws/async-participation-spec`, working tree **clean**, no untracked files.
- `main` last commit: `7efc30c` - "fix: a fresh clone of this repo could not
  typecheck or test, and nothing said so (#19)".
- Tests on `main`: **169 passing across 20 files** (`npx vitest run`), up from
  130 at session start. `tsc --noEmit` clean.
- No uncommitted diff. Nothing to apply.

Open PRs:

| PR | Title | Note |
|---|---|---|
| #21 | docs: async fractal participation design | gates `writing-plans` |
| #20 | feat: repeatable snapshot of the fractal tables | independent |

Merged this session: #14 (spec), #15 (bridgeIdentities fix), #16 (plan),
#17 (consensus rule), #18 (Phase 1 recorder), #19 (CI, not mine).

Branches still local: `ws/respect-game-core-spec`, `ws/respect-game-recorder-plan`,
`ws/fix-bridge-identities-wallets`, `ws/consensus-rule-and-resume`,
`ws/respect-game-core-impl` - all merged upstream, safe to delete.

**`ZAOfractal`** (`~/Desktop/repos/ZAOfractal`) - **ahead 32, behind 4,
UNPUSHED.** 13 commits from this session. See task A2.

---

## D. In-flight

- Background bash jobs: none.
- Subagents: none were spawned this session.
- Scheduled wakeups: **none.** The research loop was stopped deliberately with
  `ScheduleWakeup stop:true` - the agenda was exhausted and the five remaining
  questions need a person, not another iteration.
- Open AskUserQuestion: no.
- **Blocked, needs you:** the Canva connector is not connected to this session,
  so the Canva document you asked about could not be searched or read. Section
  E lists what a ZAO Fractal deck would now be wrong about.

---

## E. Cold-start map

**Files touched - `zao-fractal-bot`**

- `src/game/session.ts` + `session.test.ts` - the pure elimination engine, consensus rule
- `src/game/playthrough.test.ts` - a full six-person fractal, plus the dropout limitation as a passing test
- `src/lib/gameRepo.ts` + test - the only file that writes game state; every write awaited
- `src/commands/respectGame.ts` + test - actions; persists before reporting an outcome
- `src/discord/gameCommands.ts`, `votingView.ts` + test - `/start` and vote buttons
- `src/architecture.test.ts` - asserts no discord.js under `src/game` or `src/commands`
- `src/lib/voteThreshold.ts` - strict majority fix
- `src/commands/executeCommand.ts`, `subscribeToCommands.ts` - discord.js removed from the action layer
- `supabase/migrations/0005_respect_game.sql` - **written, not applied**
- `scripts/backup-fractal-tables.mjs` - PR #20
- `docs/superpowers/specs/2026-09-01-respect-game-core-design.md`, `2026-09-02-async-participation-design.md`
- `docs/superpowers/plans/2026-09-01-respect-game-recorder.md`
- `docs/ideas/README.md` - seven deferred items with their decisions preserved

**Files touched - `ZAOfractal`**

- `research/07-bot-generations-paths-tried.md` - seven bot generations; five restarts in 16 months
- `research/08-zao-fractal-measured-state.md` - 13 sections, the measured state
- `research/09-open-questions-for-operators.md` - the five things measurement cannot settle
- `whitepaper/draft/ch04, ch05, ch06, ch08, ch09` - accuracy pass, corrections marked inline

**Skills invoked**

- `superpowers:brainstorming` x2 - Respect Game core spec, async participation design
- `superpowers:writing-plans` - the Phase 1 recorder plan
- `superpowers:executing-plans` - tasks 1-6; task 7 is manual and blocked
- `quick-grill` - four rounds of decisions
- `loop` - the research pass, stopped
- `handoff` - this bundle

**Memory writes:** none this session.

**Last-known mental model.** v2 can now run a fractal and record it, which is
the thing that has been broken since 2026-03-23, but it has never run because
the migrations are unapplied and it has no token. The async participation design
is written and awaiting review before its plan. The research pass is finished
and its residue is five questions only a human can answer.

**Open questions for the receiver**

- Which Canva document did Zaal mean? The connector was down and the question
  was never answered.
- Does period 103 exist? Needs Discord history around 2026-06-29. It is the last
  gap in the ledger and the whitepaper's "unbroken streak" claim rests on it.
- Should the ZAO OS project be added as a second Supabase MCP connector? It is
  reachable only via REST with the key in `~/Documents/ZAO OS V1/.env.local`.

**What a ZAO Fractal deck would now be wrong about** (for the Canva task):
"100+ weeks unbroken" (unevidenced; six periods carry no Respect); the 2x ladder
"increasing differentiation" (110/10 and 55/5 are both 11x); "40 active per
session" (ledger median is 7, max 17); anything implying earners have a say
(two-thirds cannot vote); the two-ledger story starting at fractal 74 (it starts
at 67).

---

## Inline copy-paste block

```
Ingest the bundle at ~/Documents/zao-fractal-bot/.handoffs/session-2026-09-03-fractal-v2/README.md and follow the receiver instructions at the top. 5 tasks to absorb.
```
