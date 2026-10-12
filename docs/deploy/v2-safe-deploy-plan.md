# v2 safe deploy plan

Written 2026-10-12 by the fractal-bot-v2 lane (ZAO Fractal slate, section 4).
This is the order of operations and the gates. The panel steps themselves are
in [bot-hosting-runbook.md](bot-hosting-runbook.md) and are not repeated here.

**Every step below that touches a token, the database or the host is Zaal's
hand.** Nothing in this plan has been run. No deploy, no token, no migration.

## What is true tonight

| Fact | Source |
|---|---|
| The bot answering commands in the ZAO Discord is v1, the archived Python codebase `fractalbotapril2026`, not this repo | `docs/history/zao-fractal-timeline.md` (2026-09-25, `/admin_lookup` trace) |
| `fractalbotapril2026` is archived on GitHub, last push 2026-07-07, so it takes no pull requests | `gh repo view` (isArchived true), 2026-10-12 |
| v1's "Submit Onchain" calls `submitBreakout` (selector `0xa2be0d05`), which is in none of the ZOR, OG Respect or OREC bytecode, checks no receipt, and still posts "Results Submitted Onchain!" | `docs/superpowers/specs/2026-09-01-respect-game-core-design.md`, vault `notes/fractal-monday-2026-10-12-zaofractal.md` row 4 |
| v2 does not carry that defect forward: after a game it says "Onchain submission lands in a later release. Results are saved." | `src/discord/gameCommands.ts:313` |
| Seven migrations exist, `0001` to `0007` | `supabase/migrations/` |
| Whether any of them are applied is disputed in the record: one vault status says 0001-0006 confirmed applied 2026-09-19, another says none ever ran; on 2026-10-11 Zaal said "run later today" and no later entry says it happened. The database was not queried for this plan | vault `handoffs/status/season3.md`, `handoffs/status/zaofractal.md`, `decisions/grill-2026-10-09-seat-morning.md` item 131 |
| No record says the separate v2 Discord token (card 9677) has been created | vault `decisions/grill-2026-10-09-seat-morning.md` item 113; searched vault decisions and status files |

## The one rule

**v2 never runs on v1's token, and never as a second poller beside v1 on one
token.** Two processes on one token count every vote twice, silently. v2 gets
its own Discord application ("The ZAO Agent"), per runbook section 1.

## Order of operations

Each phase has a gate. Do not start a phase until the one before it has passed
its gate.

### Phase 0 - read-only checks (an agent can do these, no writes)

1. Against Supabase project `efsxtoxvigqowjhgcbiz` (ZAO OS, not the cowork
   project), read which migration objects exist: the seven tables, the
   `manual` CHECK from `0006`, and the partial unique index from `0007`.
   The expected objects are the `create` statements in each migration file.
2. Write the result as a table: migration, present yes/no, evidence.

**Gate:** a measured list of what is missing. This settles the disagreement
above without anyone applying anything.

### Phase 1 - migrations (card 9674, Zaal)

1. Backup check first (the clip at vault
   `inbox/clips/clip-20261010-185629-apply-fractal-migrations-0001-0005.md`
   has the steps).
2. Apply only what Phase 0 found missing, in number order.
3. **`0007` is required before v2 goes near a live fractal.** It turns a
   double-recorded session into a database error instead of 110 plus 110 in
   the table a human builds the onchain award from.

**Gate:** Phase 0 re-run shows all seven present.

### Phase 2 - separate token (card 9677, Zaal)

1. New Discord application, runbook section 1. Server Members intent on,
   Message Content off, the six listed permissions only.
2. Token goes straight into the panel via `/secret` or the panel form. Never
   into chat, a file or a commit.

**Gate:** the new application exists and is invited to the ZAO server; v1's
token was never copied.

### Phase 3 - shadow run (Zaal at the panel)

1. Deploy per runbook sections 2 to 5, with `DISCORD_GUILD_ID` set,
   `BOT_INSTANCE_NAME=zao-agent-prod`, `ENABLE_COMMAND_API` off.
2. v1 keeps running the weekly game. Nobody runs `/start` on v2 during a live
   session (runbook section 6).
3. Run one full game in a private test channel with two or more test accounts.

**Gate, all four:**
- exactly one `discord_bot_heartbeats` row advancing for `zao-agent-prod`;
- one `fractal_sessions` row for the test game, scores written once;
- a second `/start` in the same thread fails instead of writing a second session;
- the end-of-game message says results are saved, not submitted onchain.

### Phase 4 - cutover (Zaal decides the week)

1. Stop v1 in its host panel first.
2. Run that week's fractal on v2.
3. Results go onchain the way they do today: a human builds the award
   proposal from the saved scores. v2 does not submit anything onchain.

**Gate:** one live fractal recorded on v2 with no double rows.

### Rollback, any phase

Stop the v2 server in the panel. v2 writes only to its own `discord_*` tables
and `fractal_sessions`; stopping the process stops all of it. Restart v1 if it
was stopped. Migrations are additive and stay.

## The v1 "Submit Onchain" button, until cutover

It cannot be fixed by pull request: the repo is archived, and the code the
live bot runs sits on its host panel. The choices are Zaal's:

- **A (recommended):** facilitators are told the message is false and results
  are recorded by hand, starting with IMan's session at noon ET Tue 13 Oct.
  No code change.
- **B:** unarchive `fractalbotapril2026`, change the message to "NOT submitted
  - record by hand", and redeploy it on the v1 host. A live-host change for a
  bot that is being replaced.
- **C:** leave it until Phase 4 retires v1.

## Not blocking this deploy

- **Card 9678, the five operator questions** (ZAOfractal `research/09`:
  periods 67 to 70 reversed, 71 and 72 unminted, period 103, the 2x ladder,
  the frozen franchise). They concern the onchain ledger's history and policy,
  not whether v2 can record a game. They stay parked.
- **The service role key risk** (runbook, last section). Real, Zaal's to
  decide, and it applies to v2 on any host. It should be decided before
  Phase 3, not after.
