# ZAO Fractal - timeline

Built 2026-09-25. Every entry cites where it comes from. Where two sources disagree, both are
shown rather than picked between - see `## Open contradictions` at the bottom. For the broader
history this inherits from (Larimer, Fractally, Eden, Optimism Fractal), see
`fractal-movement-timeline.md`.

## Founding and the two Respect ledgers (2023 - Sept 2025)

- **October 2023** - Zaal joins Optimism Fractal in week 6, then becomes an active member and
  later council member of Eden Fractal. This is where he learned the mechanism before founding
  ZAO's own. *(ZAOfractal whitepaper ch08, "The Zaal Arc")*
- **2024-07-30** - ZAO OG Respect (ERC-20, soulbound) deployed on Optimism at
  `0x34cE89baA7E4a4B00E17F7E4C0cb97105C216957`. This is also the earliest OG Respect receipt on
  record - Zaal's own wallet `0x7234c36a71ec237c2ae7698e8916e0735001e9af`, and by convention the
  start of ZAO Fractal itself. *(zip-0001-the-zao-framework.md; notes/zid-seniority-roster-
  2026-09-22.md, walked from the complete onchain transfer history)*
- **~August 2024** - ZAO Fractal begins running: weekly, Mondays 6pm EST, Zaal as founder.
  *(ZAOfractal reference/14-timeline.md, independently verified)*
- **December 2025** - New mints to the OG Respect ledger paused as an administrative policy
  choice, at 122 holders and 38,484 total supply. OG Respect remains mintable if ever chosen
  again - "paused by policy," not frozen (this repo's own PR #31, 2026-09-21, corrected an
  earlier "frozen" framing to this). *(whitepaper ch08; zao-fractal-bot PR #31)*
- **2025-09-11** - ZAO ZOR Respect (ERC-1155, soulbound, weekly, no fixed cap) deployed on
  Optimism at `0x9885CCeEf7E8371Bf8d6f2413723D25917E7445c`. *(zip-0001-the-zao-framework.md;
  bobbi-reply-2026-09-13.md)*
- **Fractal period 67 (minted 2025-09-25)** - the actual dividing line between the OG era and the
  ZOR era. **Corrected 2026-09-02**: earlier drafts said period 73/74; the measured first ZOR
  award onchain carries period 67. Periods 1-66 ran in Discord, tracked in Airtable, paid in OG
  Respect. Periods 67 on run on-chain via ORDAO/OREC, paid in ZOR Respect.
  *(ZAOfractal whitepaper ch08, "Sixth" - the 2026-09-02 accuracy pass against live chain,
  Supabase and Airtable)*

## OREC, governance mechanics (measured, not assumed)

- OREC executor: `0xcB05F9254765CA521F7698e61E0A6CA6456Be532` on Optimism. 72-hour vote window,
  72-hour veto window, 1,000 Respect minimum to pass - so no award can land onchain in under six
  days from its proposal. *(bobbi-reply-2026-09-13.md, measured 2026-09-11; matches
  zip-0001-the-zao-framework.md)*
- **Vote weight is read live, per voter, at the moment each address casts or re-casts its vote -
  not a single snapshot taken at proposal creation.** This corrected an assumption already
  written into this repo's own bot knowledge base and into the Season 3 brainstorm log; fixed in
  this repo's PR #29 (merged 2026-09-13) and cited throughout ZIP-2.
  *(measured directly from `Orec.sol`, `@ordao/orec` v1.4.4, vendored in this repo's
  `node_modules`)*
- `OREC.respectContract` is swappable to any contract implementing `IRespect` or ERC-20
  `balanceOf`, via one governance-passed `setRespectContract` call - no redeploy. This is the
  mechanism ZIP-2's activation wrapper (Season 3, still unbuilt as of this writing) depends on.
  *(season3-protocol-survey-2026-09-11.md)*
- As of 2026-05-19, OREC had recorded 242+ transactions, historically submitted by a small number
  of wallets (a documented single-relayer bottleneck, not fixed by anything in this timeline).
  *(ZAOfractal reference; ZAOfractal whitepaper ch08 "Sixth")*

## The bot lineage - resolved naming, 2025 - 2026

A monthly-rename chain, confirmed 2026-09-25 via `gh repo list bettercallzaal`, **all archived**:

```
fractalbotnov2025 -> fractalbotdec2025 -> fractalbotv1old -> fractalbotfeb2026
  -> fractalbotmarch2026 (archived 2026-03-28) -> fractalbotapril2026 (archived, last pushed 2026-07-07)
```

- **~Mar 6-12, 2026** - consolidated and rebranded `fractalbotmarch2026` (v1.3-v1.6), 52 slash
  commands, timer overhaul. *(ZAOfractal reference/14-timeline.md)*
- **2026-03-27/28** - v2.0 migrates all storage from JSON to Supabase (the same
  `fractal_sessions`/`fractal_scores`/`respect_members` tables this repo now writes to); v2.1
  adds optional onchain auto-submit via a hot wallet and Farcaster identity linking.
  *(ZAOfractal reference/14-timeline.md)*
- **2026-05-21** - ZAO OS research doc 703, a current-state audit: week 100+, OREC at 242+
  transactions, bot v2.1 live, the single-relayer bottleneck and a needed dashboard rebuild both
  flagged. *(ZAOfractal reference/14-timeline.md, ZAOOS research library)*
- **`fractalbotjuly2026` is not a separate repo.** It is a local directory name
  (`~/Desktop/repos/fractalbotjuly2026`) for a clone whose actual remote is
  `github.com/bettercallzaal/fractalbotapril2026` - confirmed by reading its `git remote -v`.
  Earlier audits (including one in this project's own history, 2026-09-15) treated it as a third
  distinct bot; it is not. It was the last commit on the `april2026` lineage (`11ffc6b`,
  2026-08-25) before this repo replaced it.
- **2026-07-06** - this repo (`zao-fractal-bot`) starts from scratch: a ground-up TypeScript
  rebuild (discord.js, viem, Supabase, Vitest), grounded in ZAOOS research docs 981 (synthesis of
  the old bot + whitepaper + verified onchain state) and 982 (stack decision). First commit
  `4b5cc22`. *(this repo's own git log; README.md)*
- **2026-08-31** - the onchain award ledger (not this repo's database - the actual OREC/ZOR
  mints) reaches **period 111**, measured directly from chain for the whitepaper's 2026-09-02
  accuracy pass. This is a different number from the bot's own session-recording database, which
  was separately found to have gone dark for long stretches - see "The recording gap" below.
  *(ZAOfractal whitepaper ch08)*
- **2026-09-01** - Zaal's binding architectural ruling: v1 (the Python bot) stays down
  permanently; v2 (this repo) takes the live game; Hats/proposals/events - the parts of the old
  bot's monolithic cogs that caused rate-limit bans and notification loops - return later as
  cleanly separated v2 subsystems, only after the core game settles. This is the origin of the
  "Subsystem 1 / Subsystem 2" split this repo's README now documents.
  *(this repo's README.md, "Subsystems and Architecture Status," added 2026-09-21)*
- **2026-09-08 to 09-13** - this repo's v2 build sprint: async participation (PRs #23-26), CI
  actually running the whole test suite instead of 232 of 273 tests (#27), a schema-aware test
  fake that catches database-shape bugs mocks cannot (#28). The sprint's single worst find:
  `discord_roster.confidence` didn't permit the value `'manual'` that `/start` actually writes
  for a facilitator-named group, so **`/start` could never successfully record a fractal at
  all** - fixed in migration `0006`, never caught by tests because they mock Supabase and the
  constraint only exists in the real database. *(this repo's own commits and
  `handoffs/status/zaofractal.md`)*
- **2026-09-13** - PR #29 merged: the bot's own knowledge base told members their vote weight
  was "snapshotted at proposal creation" - measured false, fixed (see OREC section above). PR #30
  merged: the bot made deployable (health endpoint, host config docs) and observable, plus four
  security fixes (duplicate-session guard, permission-gated `/start`, guild-scoped command
  registration, two dropped unused gateway intents).
- **2026-09-21** - PR #31 merged: OG Respect language corrected from "frozen" to "paused by
  policy." Same day, this repo's README gained a "Subsystems and Architecture Status" block
  declaring Subsystem 1 (Respect Game core) **"Active in production."** ZAOfractal's own
  whitepaper ch08 was updated the same day with matching language, stating the Python bot
  (`fractalbotapril2026`) "was retired" in September 2026.
- **2026-09-25 - RESOLVED, and the 09-21 claim above does not hold.** Zaal ran `/admin_lookup`
  in the live `#fractal-bot` Discord channel at 5:16pm; the bot responded. `/admin_lookup` is
  defined nowhere in this repo (`grep -rl admin_lookup src/` finds nothing) - it exists only in
  `fractalbotapril2026`'s `cogs/wallet.py` (`@app_commands.command(name="admin_lookup", ...)`,
  Supreme-Admin-gated wallet lookup). **The bot actually answering commands in the ZAO Discord
  server today is running the archived Python codebase, not this repo.** Both this repo's README
  and ZAOfractal's ch08 self-declared "live in production" / "retired" on the same day
  (2026-09-21) with no independent check behind either - this is that check, and it comes out the
  other way. README.md has not yet been corrected; that is a separate, deliberate call, not made
  silently in this file.

## The recording gap and the migrations, still open as of this writing

- **Migrations 0001-0007 were staged as ready-to-run SQL clips for Zaal on 2026-09-15**
  (`~/.zao/clipboard/clip-20260915-*-zaoos-migrations-*` and `-migration-0007-*`) - exact,
  begin;/commit;-wrapped, with pre- and post-apply verification queries. **Whether they have
  actually been applied to the live ZAO OS database is not confirmed anywhere this document's
  author could find** as of 2026-09-25; a related line in `handoffs/status/zj.md` lists them
  under still-open taps for Zaal, though that line itself is dated from before the clips existed
  and may simply be stale. Treat as UNKNOWN, not as done.
- Separately, the bot's own **session-recording database** (as opposed to the onchain award
  ledger, which kept minting) went dark for long stretches - only 7 of 133 `fractal_sessions`
  rows were ever written by any bot, the newest dated 2026-03-23, discovered 2026-09-01. The
  cause: the deployed bot's `.env` had no Supabase credentials at all, so its only write path was
  a fire-and-forget webhook. *(this repo's migration `0005_respect_game.sql` header comment,
  `handoffs/status/zaofractal.md`)*
- **2026-09-21/22 grill rulings** (outside this repo, `~/zao-vault/decisions/grill-2026-09-22-
  seat-morning.md`) ordered a full reconstruction of the fractal's history using Zaal's Airtable
  as the primary source, ahead of this bot's database: the burned periods 67-70, the unminted
  71-72, and a roughly 21-week blackout starting around period 93. This is the bot's *recording*
  gap, not a gap in the actual weekly ritual, which per the whitepaper's onchain measurement
  continued minting through period 111 by 2026-08-31.

## Season 3 (2026-09-11 onward)

- **2026-09-11** - Zaal dictates 36 decisions on The ZAO's membership redesign, one question at a
  time, captured verbatim. This is the single source everything below cites.
  *(`~/zao-vault/projects/zao-membership-brainstorm-2026-09-11.md`)*
- **2026-09-15** - the `season3` lane opens. Drafts ZIP-2, "Season 3 - The Fractal Season," from
  the 36 decisions, every clause cited back to its decision number. Runs a full audit of where
  "the fractal" has spread across the estate and finds a live third repo (`ZAOfractal`), a
  dormant fourth (`zaofractal-contracts`) with a tested `IRespect` implementation nobody had seen,
  a manifesto already published and live that contradicts Season 3's own assumption it "needs
  writing," and a domain collision on `fractal.thezao.com`.
  *(`~/zao-vault/projects/fractal-sources-of-truth-audit-2026-09-15.md`)*
- **2026-09-19** - ZIP-2 merges to `bettercallzaal/zao-papers` main - Accepted, per that repo's
  merge-is-ratification convention.
- **2026-09-21/22** - grill-seat rulings (not run through the season3 lane, which was parked)
  restructure governance into a multi-tenant model: ZAO Festivals gets its own fractal and
  ledger; any ZAO-incubated sub-project may run its own fractal under ZAO's tooling; governance-
  conferring Respect narrows to come *only* from participation in the ZAO fractal specifically.
  A ZID identity layer starts being built, seniority measured from the full onchain OG Respect
  transfer history (518 rows, 123 distinct addresses, oldest Zaal 2024-07-30).
  *(`~/zao-vault/decisions/grill-2026-09-22-seat-morning.md`,
  `~/zao-vault/notes/zid-seniority-roster-2026-09-22.md`)*
- **2026-09-24** - Zaal floats, tentatively, moving Season 3's launch off 1 November to New
  Year's, with the extra time spent on upgrading and testing, and says Season 3 needs an actual
  governance proposal and a promotion push before it ships - not just a merged document. Not
  decided. *(`~/zao-vault/notes/season3-launch-date-tentative-2026-09-24.md`)*

## Open contradictions

Recorded rather than resolved - each needs either a source not yet found, or Zaal's word.

1. ~~**"Subsystem 1 is live in production"**~~ - **RESOLVED 2026-09-25, false.** See above: the
   bot answering commands in the real Discord server today runs `fractalbotapril2026`'s Python
   codebase, not this repo. Kept here struck-through rather than deleted, per this vault's
   never-delete convention.
2. **The unbroken weekly streak** - whitepaper ch08 marks this explicitly `[unverified]`: no
   source confirms it, and periods 71, 72 and 103 have gaps in at least one record.
3. **Migrations 0001-0007 applied or not** - **partially resolved 2026-09-25**: 0001-0006 are
   confirmed applied (`zao-measure --verify`, 2026-09-19, every v2 table 404 -> 200). Migration
   0006's `manual` CHECK constraint specifically, and migration 0007, remain UNKNOWN - neither is
   visible through a REST read.
4. **"40 active per session"** (this repo's own `docs/deploy/bot-hosting-runbook.md` and older
   research) vs. the measured median 7 / mean 8 / max 17 people who actually receive Respect per
   session across 42 recorded periods. Both figures exist in the estate; only the second is
   sourced to a direct count.
5. **If the Python bot is still the one running, what is "Subsystem 1 (TypeScript) - Active in
   production" actually describing?** Possibly a parallel deploy neither this document nor the
   Discord check found, possibly aspirational README copy written ahead of the actual cutover.
   Not guessed here - needs whoever controls the bot-hosting.net panel.
