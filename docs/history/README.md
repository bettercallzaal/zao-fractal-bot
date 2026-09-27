# History and context - for future agents

Built 2026-09-25/26 on Zaal's request ("build the history of zao fractal then fractals as a
whole into a timeline... part of the repo for any future agents to grab context from"), so an
agent that lands in this repo cold does not have to re-derive what this project is, where it
came from, or which of several conflicting docs elsewhere in the estate to trust.

- **`zao-fractal-timeline.md`** - ZAO Fractal's own history, chronological, sourced. Start here
  if you need to know what happened and when.
- **`fractal-movement-timeline.md`** - the broader fractal-governance lineage ZAO Fractal
  inherited from (Larimer, Fractally, Eden, Optimism Fractal), adapted from a source already
  independently verified against primary sources.
- **`zao-fractal-timeline.json`** - the same ZAO Fractal events as structured data (one object
  per event: date, title, detail, source, type), for a script or agent to query without parsing
  prose.
- **`zaal-personal-fractal-history.md`** - the founder's own participation record: every OG and
  ZOR Respect transfer his wallet was ever party to, read directly from Optimism Blockscout, not
  from any doc's summary of it. Separate from the org-level timeline above on purpose - the OG
  era is administrative on his wallet (447 of 518 total OG transfers are him distributing awards,
  not earning them), and conflating the two would misrepresent his personal record.

## Read this before trusting any other fractal doc

Fractal-related material is scattered across at least six separate places in the estate - this
repo, ZAOOS's own 90+-document research library, a third live repo (`ZAOfractal`), a dormant
fourth (`zaofractal-contracts`), zao-vault's decisions/projects/handoffs, and four independently
written public site pages. None of it is indexed together anywhere else. The full audit of that
sprawl, with every contradiction found, lives at
`~/zao-vault/projects/fractal-sources-of-truth-audit-2026-09-15.md` - read it if you need to
know *why* two docs disagree, not just *that* they do. These timeline files summarize the
resolved facts and name the still-open contradictions; they do not re-litigate the audit.

## What changed since the 2026-09-15 audit, worth knowing up front

- **ZIP-2 ("Season 3 - The Fractal Season") merged** to `bettercallzaal/zao-papers` main on
  2026-09-19 - per that repo's own convention, a merge is a status change to Accepted, not a
  draft anymore.
- **The bot naming confusion the audit flagged is resolved - and the deeper question with it.**
  `fractalbotjuly2026` was never a separate repo - it is a local directory name for a clone of
  `fractalbotapril2026` (confirmed via `git remote -v` inside it). The real lineage, confirmed via
  `gh repo list`, is a monthly-rename chain, all archived: `fractalbotnov2025` ->
  `fractalbotdec2025` -> `fractalbotv1old` -> `fractalbotfeb2026` -> `fractalbotmarch2026` ->
  `fractalbotapril2026` (last pushed 2026-07-07). **And as of 2026-09-25, that archived Python
  codebase is confirmed to still be the bot actually answering commands in the real Discord
  server** - Zaal ran `/admin_lookup`, a command that exists only in `fractalbotapril2026`, and
  it responded. This repo's own README claims Subsystem 1 is "live in production"; that claim
  does not hold. See `zao-fractal-timeline.md`'s "2026-09-25" entry and PR #33.
- **Governance got a lot bigger than one fractal, very recently, outside this repo.** Grill-seat
  rulings on 2026-09-21/22 (`~/zao-vault/decisions/grill-2026-09-22-seat-morning.md`) moved to a
  multi-tenant model: ZAO Festivals gets its own fractal and ledger, any ZAO-incubated project
  can run its own fractal under ZAO's tooling, and *governance-conferring* Respect narrows to
  come only from participating in the ZAO fractal specifically - a constraint the existing specs
  (this repo included) were not written against. A ZID identity layer is being built on top of
  it, and an Airtable base (`appTUNG04rjZ9kSF4`) was named the primary source of truth for
  historical reconciliation, ahead of this bot's own Discord/Supabase database.
- **Season 3's 1 November launch date may move to New Year's** - Zaal, 2026-09-24, "maybe," not
  decided. See `~/zao-vault/notes/season3-launch-date-tentative-2026-09-24.md`.
