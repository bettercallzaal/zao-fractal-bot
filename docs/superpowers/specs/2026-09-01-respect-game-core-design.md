# Respect Game Core - Design

Subsystem 1 of the ZAO Fractal Bot v2 decomposition: running a fractal end to
end, recording it, and getting its result onchain.

- **Status:** design, awaiting Zaal's review. No implementation until approved.
- **Date:** 2026-09-01
- **Decided by:** Zaal, across four decision rounds on 2026-09-01.
- **Next step after approval:** `superpowers:writing-plans`.

Everything in this document labelled MEASURED was read from the live database,
the live chain, or the source at the path named. Everything else is design.
Where a README, a source comment or a prior brief disagreed with a measurement,
the measurement is what is written here.

---

## 1. What is actually broken

The premise this design was originally given - "the Respect Game does not
persist, rebuild it" - turned out to be half right, and the half that was wrong
changes the shape of the work.

**MEASURED (Alchemy `alchemy_getAssetTransfers`, ZOR mints from the zero
address, 2026-09-01): the game is running and its results reach chain every
week.** ZOR minted on 2026-08-31 at 22:16 and 22:17 UTC, and on 2026-08-25,
2026-08-18, 2026-08-10, 2026-08-03 and 2026-07-27. Two to three transactions
per week, which is two to three breakout groups per fractal. The minted values
are `0x6e 0x44 0x2a 0x1a 0x10 0x0a` = 110, 68, 42, 26, 16, 10 - exactly the
`RESPECT_POINTS` ladder in `packages/shared/src/config.ts`. Nothing else on
that contract would land on six values of that ladder by coincidence.

This corroborates `ZAODEVZ/ZAOfractal`'s README, which says the game "has run
unbroken on Mondays at 6pm EST since around August 2024". The mints land at
22:16 UTC, which is 18:16 EDT on a Monday. The docs and the chain agree.

**MEASURED (Supabase REST, project `efsxtoxvigqowjhgcbiz`): the recording is
dead.** Of 133 rows in `fractal_sessions`, only 7 carry a `thread_id`, meaning
only 7 were ever written by the bot rather than migrated in bulk. Six of those
are real. The newest `completed_at` is 2026-03-23, "ZAO Fractal 92 - Group 1".
Zero sessions have been created since 2026-04-15.

So: **the ritual survived, the recorder did not.** Roughly five months of
fractals exist onchain and nowhere else.

### Why it died silently

`ZAO OS V1/src/app/api/fractals/webhook/route.ts` is a complete, Zod-validated,
tested webhook accepting exactly the six events this subsystem needs -
`fractal_started`, `vote_cast`, `round_complete`, `fractal_complete`,
`fractal_paused`, `fractal_resumed` - writing `fractal_sessions`,
`fractal_scores` and `fractal_events`. Its own header comment reads:

> The bot sends via WebIntegration class with fire-and-forget semantics (10s timeout).

v1 calls it from `utils/web_integration.py`, and writes separately and directly
via `cogs/history.py`. Two unmonitored write paths into the same tables, both
fire-and-forget, neither load-bearing on anything a human would notice.

**A recorder that nothing depends on is a recorder that can die unobserved for
five months.** That single observation drives section 6 of this design and is
worth more than any other line in it.

### Two defects found in v1 while measuring, both still live

1. **`utils/blockchain.py:submit_breakout` calls a function that does not
   exist.** It encodes `submitBreakout(uint256,address[])`, selector
   `0xa2be0d05`, against `ORDAO_CONTRACT_ADDRESS`, which defaults to
   `0x9885CCeEf7E8371Bf8d6f2413723D25917E7445c` - the ZOR Respect token.
   MEASURED via `eth_getCode`: that selector is absent from the deployed
   bytecode of ZOR, of OG Respect and of the OREC executor, and ZOR is not a
   proxy (both EIP-1967 slots read zero).
2. **It reports success it never verified.** `submit_breakout` returns the hash
   from `eth_sendRawTransaction` without fetching a receipt, and
   `_post_submit_breakout` posts "Results Submitted Onchain!" with an explorer
   link on that basis. A reverted transaction is indistinguishable from a
   successful one to anyone reading the thread.

Neither is carried forward. The real write path is section 9.

---

## 2. Scope

**In:** session lifecycle, voice room orchestration, the presentation timer,
elimination voting, results, persistence, the onchain propose-and-execute
lifecycle, and the history read commands.

**Out, with decisions preserved:** section 13.

Zaal set this scope across four rounds on 2026-09-01. Two of his answers
changed it mid-design and both are recorded as replacements rather than
conflicts:

- Round 2 scoped the timer out ("game core plus history commands"). Round 4
  described the flow as "start starts timer everyone talks then after timer
  ends then we move to voting", and when asked directly he chose to port v1's
  full timer. The timer is in.
- Round 1 scoped the backfill out. Round 2 asked for a backfill to week one,
  reviewed by him week by week. That is now its own spec (section 13), because
  a human review queue with a publishing surface is a different job from a
  recorder.

### Delivery order

This is a larger subsystem than it was at the start of the day, and the
recorder should not wait on the timer. The implementation plan phases it:

1. **Recorder.** Session lifecycle, roster, voting, results, persistence.
   Enough to record a real fractal, driven manually. This is the phase that
   stops the gap growing and it ships first.
2. **Onchain.** Propose, nudge, execute, verify.
3. **Timer.** The `cogs/timer.py` port (section 8).
4. **Voice orchestration.** Splitting and moving between rooms.
5. **History reads.** `/leaderboard`, `/mystats`, `/fractal <n>`.

Phases 3 and 4 are quality-of-life over a game that is already being recorded
correctly. Phase 1 is the only one where every week of delay costs a fractal.

---

## 3. Architecture

Three layers, and one rule that a test enforces.

```
src/game/          Pure engine. State + event in, new state + effects out.
                   No I/O. No discord.js. No Supabase.
src/commands/      Actions. Load state, call engine, persist, return JSON.
                   No discord.js types in any signature.
src/discord/       Adapter. Slash commands, buttons, voice moves. The only
                   layer that knows what an Interaction is.
src/http/          Existing dispatch adapter. Admin and automation only.
```

**Surface split (Zaal, 2026-09-01):** Discord-native slash commands and buttons
for gameplay; the existing `bot_commands` web-dispatch for admin and
automation. Both call the same action functions. v2's existing dispatch code is
kept, not thrown away, and gameplay is not built on it.

His framing for why: "everything is discord right now in an ideal world this
would be mutli platform but let's save that for v3 just have V2 be clean
agentic since that can get us to multiplatform." One core, two callers today,
more surfaces in v3 without touching the engine.

**The enforced rule:** no file under `src/game/` or `src/commands/` may import
`discord.js`. A test asserts this. Without a test it quietly stops being true,
and the cost is paid in v3 rather than now.

---

## 4. Which database - read this before writing any migration

There are two Supabase projects in play and they both contain a table called
`bot_commands` with different columns. Pointing the bot at the wrong one would
half-work and then corrupt.

| Project | Ref | Role |
|---|---|---|
| ZAO OS app | `efsxtoxvigqowjhgcbiz` | **Everything in this spec.** Holds `fractal_sessions`, `fractal_scores`, `respect_members`, `users`, `fractal_events`. |
| cowork tracker | `etwvzrmlxeobinrlytza` | Unrelated. Holds tasks, contacts, the agent fleet. |

MEASURED: the cowork `bot_commands` has columns `bot, command, args, status,
result, created_by, created_at, claimed_at, completed_at`. v2's migration
`0001_bot_commands.sql` defines `action, params, idempotency_key, requested_by,
status, result, created_at, completed_at`. **Same name, different schema, no
relation.** `~/.zao/zao.env` points at the cowork project; `~/Documents/ZAO OS
V1/.env.local` points at the ZAO OS project. The bot uses the latter.

MEASURED: no configured MCP server on this machine can reach the ZAO OS
project. It was read for this design through the REST API using the service
role key in `~/Documents/ZAO OS V1/.env.local`. If MCP access is wanted later,
that project has to be added as a second connector.

---

## 5. Data model

### 5.1 What exists today - MEASURED, not from the README

`fractal_sessions` (133 rows): `id, session_date, name, host_name, host_wallet,
scoring_era, participant_count, notes, created_at, thread_id,
facilitator_discord_id, group_number, guild_id, completed_at,
discord_thread_id, status`

`fractal_scores` (801 rows): `id, session_id, member_name, wallet_address,
rank, score, created_at, discord_id, level, respect_points`

`fractal_events` (4 rows, all test writes dated 2026-04-14): `id, fractal_id,
event_type, payload, created_at`. `fractal_id` holds a Discord thread id.

`respect_members` (188 rows, 161 with a wallet). `users` (60 rows, 22 with a
`discord_id`).

**Corrections to the README and to the prior brief, both MEASURED:**
`wallets` does not exist on this project, and `src/commands/executeCommand.ts`'s
`bridgeIdentities` action reads it - that action throws the moment it runs.
`fractal_rankings` does not exist either; only `fractal_scores` does.
`fractal_sessions.group_number` is text, not an integer, and holds values like
`'2test'`.

**MEASURED: none of v2's four migrations are applied to this project.**
`bot_commands`, `discord_roster`, `discord_contributions`,
`discord_bot_events`, `discord_bot_heartbeats` and `discord_voice_presence` all
return 404 PGRST205. This is a read of the database, not an inference from the
migration files.

### 5.2 Status vocabulary - reuse, do not invent

MEASURED: `ZAO OS V1/src/app/api/discord/fractal-live/route.ts` queries
`fractal_sessions` by `status` with exactly three values: `active`, `completed`,
`paused`. MEASURED: all 133 existing rows are `completed`.

The bot uses those three values and no others. The consequence is that the ZAO
OS live-fractal dashboard starts working with **zero changes to ZAO OS**, and
no existing reader breaks.

### 5.3 New and changed

Migration `0005_respect_game.sql`, additive only. No DROP, no UPDATE, no data
touched.

Shared table, additive column:
- `fractal_sessions.meeting_number int` - required by
  `proposeBreakoutResultX2`, and currently only encoded in the free-text name.

New bot-owned tables, following the existing `discord_` convention:
- `discord_fractal_rounds` - `id, session_id, level, votes_needed, started_at,
  resolved_at, winner_discord_id, winner_wallet`
- `discord_fractal_votes` - `id, round_id, voter_discord_id,
  candidate_discord_id, cast_at`, unique on `(round_id, voter_discord_id)` so a
  changed vote is an upsert rather than a duplicate
- `discord_fractal_awards` - `id, session_id, proposal_id, call_used,
  mint_type, period_number, meeting_number, status, tx_hash, covers_wallets,
  created_at, executed_at`

`fractal_events` gets one append per transition. The table already exists and
has been unused since April.

### 5.4 The database is the state machine

The bot writes **directly and synchronously**, service role, and a failed write
fails the round. Recording is not a notification about the game; it is the
game. A session row is created at `/start` with status `active`, not at the end.

This is the deliberate opposite of v1, and of the existing webhook. The webhook
is not used for recording. It may later be used to push a live projection, but
never as the record.

Consequences worth stating: a bot restart mid-fractal resumes from the database
instead of losing the session, and a broken write is discovered in ten seconds
because the round visibly does not advance, rather than in five months.

---

## 6. Command surface

Gameplay, Discord-native:
- `/start [name] [meeting_number?]` - opens the session or sessions
- `/submit` - retries a stuck onchain step, runnable by any member
- `/status`, `/endgroup`
- Voting and timer controls are buttons in the session thread

History reads:
- `/leaderboard`, `/mystats`, `/fractal <n>`

Admin and automation stay on `bot_commands` web-dispatch, including the twelve
actions already implemented in `src/commands/executeCommand.ts`.

---

## 7. Round flow

Zaal's words, round 4: "start starts timer everyone talks then after timer ends
then we move to voting and then when that ends anyone can submit and all move
back to waitingroom."

1. `/start` in the waiting room. More than six people present splits them using
   the existing `distributeIntoGroups` in `src/commands/randomize.ts`.
2. Roster capture uses the existing `captureRoster` action - voice, text,
   reactions, manual - which is already built and tested.
3. The bot **moves** each group into Fractal Room 1, 2 or 3. Permanent
   channels, so the only elevated permission needed is Move Members. The bot
   never creates or deletes channels.
4. The presentation timer runs (section 8).
5. Voting opens. Buttons in-thread, one per candidate. **Votes are public**, as
   they have been for two years - Zaal declined to change this, on the grounds
   that it changes the ritual and not just the software.
6. Elimination proceeds level 6 down to 1 using the existing
   `majorityThreshold` and `findRoundWinner` in `src/lib/voteThreshold.ts`.
7. Last level resolved: the bot writes the result, proposes onchain (section
   9), and moves everyone back to the waiting room.

---

## 8. The timer - what carries over from v1

`cogs/timer.py` is 1011 lines and is real prior art. Zaal chose to port it in
full rather than build a reduced version.

Carried forward, from `PresentationTimer` and `TimerControlView`:
per-speaker rotation with `current_speaker` and `advance`, the countdown loop
with its message-edit and resend fallback, overtime handling, `add_time`
(+1 min), `pause` and `resume`, `skip` and `skip_come_back`, `raise_hand`,
`im_done`, `pick_next`, and the reaction bar.

Ported deliberately differently: the countdown's state lives in
`discord_fractal_rounds` rather than in a Python object, so a restart does not
lose the round; and the timer's logic is a pure module under `src/game/` with
the buttons as an adapter, per section 3.

---

## 9. Onchain lifecycle

### 9.1 Measured ground truth

MEASURED from the live OREC executor `0xcB05F9254765CA521F7698e61E0A6CA6456Be532`:

| Parameter | Value |
|---|---|
| `voteLen` | 259200s = 72h |
| `vetoLen` | 259200s = 72h |
| `minWeight` | 1000e18 |
| `respectContract` | `0x34cE89...` = OG Respect, the frozen ledger |

MEASURED: `ZOR.owner()` is the OREC executor, so minting ZOR requires an
executed OREC proposal. **No fractal award can land onchain in under six days.**
That is not a footnote; it is visible in the data, where each week's execute
transaction lands roughly six days after its proposal. Any design in which a
session ends and Respect appears that evening is impossible.

MEASURED, three independent ways, that the correct call is the X2 variant:
`RESPECT_POINTS` is exactly double ORDAO's standard 55/34/21/13/8/5;
`proposeBreakoutResultX2`'s own doc comment lists 110/68/42/26/16/10; and every
observed ZAO token id begins `0x0000000a`, where `@ordao/ortypes`'s
`mintTypeDesc` defines `10 - Respect Breakout x2`.

### 9.2 The trap, and how this design avoids it

MEASURED from `@ordao/orclient`: `proposeBreakoutResultX2` assigns Respect **by
position in the `rankings` array** - index 0 gets 110, index 1 gets 68, and so
on.

Zaal chose, when a member has no wallet on file, to "propose for who has a
wallet and then do a separate proposal when we get the unknown users wallets".
Implemented naively that is silently wrong: dropping a member from the array
promotes everyone below them a level and over-mints.

The implementation that honours the decision without the bug:

| Case | Call | Why |
|---|---|---|
| Every member has a wallet | `proposeBreakoutResultX2({meetingNum, groupNum, rankings})` | Identical to the last two years |
| Some member does not | `proposeRespectAccountBatch` with explicit per-member amounts at their true levels, `mintType: 10`, same `meetingNum` | Correct amounts, no level shift, same onchain tagging |
| Wallet arrives later | `proposeRespectAccountBatch` for just them, `mintType: 10`, same `meetingNum` | Lands in the same period |

`zRespectAccountRequest` accepts optional `mintType` and `meetingNum`, which is
what makes the tagging survive. Verify this against the installed package
before relying on it in the plan.

### 9.3 The bot's role

Zaal's decision: **the bot sends every transaction and never votes.** It holds
gas and no Respect. A compromised bot key wastes gas and nothing more. The
proposal passes on members' own votes during the 72h window.

This has a consequence that is load-bearing rather than optional: **members
must actually vote**, and today nobody does except the relayer. The Discord
vote-nudge loop is therefore part of the mechanism, not a nicety.

1. Last level resolves. Bot writes the session and scores.
2. Bot proposes with `vote: 'None'`, per the table in 9.2. Records an
   `discord_fractal_awards` row.
3. Bot posts the proposal id in the thread with a call to vote, and names
   anyone whose missing wallet held them out.
4. Bot polls `getStage` and `getVoteStatus` - already implemented in
   `src/lib/governance.ts` - posts running weight, and reminds before the
   window closes.
5. Stage `Execution` and status `Passed`: bot sends `execute`, records the
   transaction hash.
6. `src/lib/awardVerification.ts` reconciles the actual mint against what the
   session said it should be. It was built for exactly this gap.

**Meeting number:** the bot reads the last period number from chain and offers
the next; the facilitator confirms or corrects it. The period appears in the
token id and stepped `0x6e` to `0x6f` between 2026-08-25 and 2026-08-31. The
byte offsets are inferred and must be verified against
`@ordao/ortypes`'s `zTokenIdData` during implementation before being relied on.

**Submission trigger:** the bot proposes automatically so it cannot be
forgotten, and any member can run `/submit` to retry a failed or held step.

**Gas:** funded once with a float, with the bot posting a warning in Discord
below a threshold, so it can never silently fail to submit because it ran dry.

### 9.4 Multi-signer, as a requirement

The README calls multi-signer OREC submission a design requirement rather than
an afterthought, citing the 94% single-relayer bottleneck in ZAOOS docs
975/977. This design satisfies it: the bot is a relayer with no vote, so
passing a proposal requires real members voting with their own weight. It does
not centralise submission on a new key.

---

## 10. Failure handling

**The rule: a failed write fails the round, visibly, in the thread.** No
fire-and-forget anywhere in the recording path. This is the direct answer to
section 1.

- A restart mid-fractal resumes from the database.
- A failed onchain propose leaves the award row in a retryable state and says
  so in the thread; `/submit` retries.
- A member leaving mid-round is handled by the engine as an explicit case, not
  by a `discord.utils.get` returning `None` and the round silently stalling, as
  in v1's `check_for_winner`.
- Voice moves are best-effort per member and never block the round; a member
  the bot could not move is named in the thread.

---

## 11. Testing

TDD per the repo's own standard - 128 tests pass today and stay passing.

- The pure engine gets exhaustive round, tally, threshold and tie tests.
- The onchain layer is tested against a mocked orclient, with the amount table
  asserted per case in 9.2 - specifically that a partial roster never shifts a
  level.
- One architectural test: no file under `src/game/` or `src/commands/` imports
  `discord.js`.
- One regression test for the thing that caused all of this: an action whose
  persistence fails must reject, not resolve.

---

## 12. Prerequisites

1. **Migrations.** 0001 to 0004 have never been applied to the ZAO OS project,
   and 0005 goes on top. All additive. A snapshot of `fractal_sessions`,
   `fractal_scores`, `respect_members`, `fractal_events` and a
   credential-free column subset of `users` was taken on 2026-09-01 to
   `~/.zao/backups/zao-os-fractal-20260901/`.
2. **Hosting: Railway** (Zaal, 2026-09-01). v2 has no deploy config of any
   kind today. Railway gives a container from the repo and its own outbound IP,
   which matters because v1 sits banned on bot-hosting.net behind a Cloudflare
   IP ban shared with strangers.
3. **Secrets.** The ten in `.env.example`, plus the ZAO OS `SUPABASE_URL` and
   service role key, plus a funded gas-only `BOT_PRIVATE_KEY`. All via the
   `setting-secrets` skill; no value enters a transcript.
4. **Discord permission:** Move Members, scoped to the fractal voice channels.
5. **v1 stays down** (Zaal, 2026-09-01). v2 takes the game. Its hats,
   proposals and events cogs return later as v2 subsystems.

---

## 13. Out of scope, decisions preserved

Each of these was decided on 2026-09-01 and is deferred to its own spec so that
none of it is re-litigated.

- **ZID as the canonical member id.** One id per person, with Discord id,
  wallets, fid and name hanging off it. The `users.zid` column already exists.
- **Registry convergence.** `ZAO-Leaderboard` reads member identity from
  Airtable; `respect_members` holds 188 with 161 wallets. Converge on Supabase
  and switch the leaderboard to read it.
- **Member list with join dates**, showing Discord join and first Respect side
  by side.
- **Backfill to week one**, reviewed by Zaal week by week, with a draft post
  for the ZAO account per week. Depends on ZID: two years of history cannot be
  keyed to people until there is one id per person.
- **Hats, teams, projects, boards** - subsystem 2.
- **v1's proposals, snapshot, events and intro cogs.**

### Repo census, since it was asked

ZAO Respect runs on four repos: `zao-fractal-bot` (the engine),
`ZAO-Leaderboard` (the public surface), `ZAODEVZ/ZAOfractal` (whitepaper and
docs) and `ZAOOS` (schema and app). Everything that mints is ORDAO's contracts,
an external dependency. MEASURED: `zaofractal-contracts` has never been
deployed anywhere but local anvil - its only broadcast is chain 31337 - so it
is a spare, not the live token. Nine further repos are dead history:
`fractalbotapril2026` plus `fractalbotmarch2026`, `fractalbotfeb2026`,
`fractalbotv1old`, `fractalbotdec2025`, `fractalbotnov2025`,
`fractalbotV3June2025`, `ZAO-FRACTAL-BOTV2` and `zao-fractal-bot-archive`.

---

## 14. Risks recorded

**The mint key.** MEASURED: one address,
`0x7234c36a71ec237c2ae7698e8916e0735001e9af`, sent 100% of the last twelve ZOR
mints, and holds 3094 OG Respect vote weight against a `minWeight` of 1000. One
key clears the threshold three times over, alone, every week. If it is lost or
compromised, no Respect can be minted by anyone.

Zaal was told and chose to accept this on 2026-09-01. It is recorded here so
the acceptance is visible rather than looking like an oversight.

This design does not extend that risk. The bot holds no Respect and never
votes.

**Open items for implementation, not blockers:**
- Verify `zRespectAccountRequest` accepts `mintType` and `meetingNum` as read.
- Verify the token id byte offsets for `periodNumber` against `zTokenIdData`.
- Confirm no other ZAO OS reader depends on `fractal_sessions` rows only ever
  appearing once already `completed`.
