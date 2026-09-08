# All-Weeks Points Audit - the shape of the job

> Scoping only. **Nothing has been audited or changed.** Zaal asked for the shape
> before the work: *"It's not money but we deff need a zao fractal lane to review and
> audit all weeks points."* (2026-09-08)

Every figure below was measured on 2026-09-08 against the live ZAO OS project
(`efsxtoxvigqowjhgcbiz`) over REST, and against the branch's own source. Nothing is
recalled.

**Respect is not money.** This document does not describe any period as unpaid, owed,
or a debt, and Zaal has made no decision to mint anything.

---

## 1. What exists

| | |
|---|---|
| `fractal_sessions` rows | **133** |
| `fractal_scores` rows | **801** |
| Period numbers present | **1 - 92** (91 distinct; parsed from `name`) |
| Session dates | **2024-06-10 -> 2026-04-14** |
| Sessions by scoring era | 1x: **51**, 2x: **80**, ORDAO: **2** |
| Status values | `completed` on all 133 |

A "period" is one weekly fractal. One period holds several sessions, one per breakout
group, so 133 sessions across ~91 periods is roughly 1.5 groups per period recorded.

---

## 2. The gaps, by class

These are the actual units of work. They are different problems and want different
methods.

### Class A - the 21-week blackout (largest)

The newest session of any kind is **2026-04-14**. That is **21 weeks before today**.
The database's highest period is **92**.

The fractal did not stop. The lane measured ZOR mints from the zero address landing
**every week with no gap** through at least 2026-08-31, two to three per week, in the
exact `RESPECT_POINTS` ladder (110/68/42/26/16/10). So roughly **21 periods ran, were
scored, and reached chain, with no database record at all.**

This is where the unknown **period 103** sits - inside the blackout, not adjacent to it.

**Source of truth for Class A is the chain, not Discord.** Reconstruction means reading
mint transactions per week and mapping amounts back to ranks. What the chain cannot give
back is the human layer: names, group composition, facilitator, who attended and earned
nothing.

### Class B - periods recorded but never scored

- **Period 61** - sessions exist, **zero** score rows across all of its groups.
- **Periods 74-91** - **18 consecutive periods** where *some* groups have score rows and
  others have none. Partial records, not absent ones.

Class B is the subtlest class: these periods *look* present in any count of sessions and
are silently short on results.

### Class C - identity coverage on existing scores

| Field | Missing |
|---|---|
| `discord_id` | **771 of 801** (96%) |
| `respect_points` | **771 of 801** (96%) |
| `wallet_address` | **43 of 801** (5%) |

96% of score rows cannot be attributed to a Discord identity, and 96% carry no value in
`respect_points` - the `score` column appears to hold it instead for those rows.
**Which column is authoritative is an open question and must be settled before any
totalling**, or every sum will be wrong in the same direction.

### Class D - unparseable and missing entries

- **4 sessions** whose `name` carries no period number at all.
- **Period 6** is absent from the 1-92 range entirely.

### Class E - provenance

Only **7 of 133 sessions** carry a `thread_id`, i.e. were written by the bot. The newest
is **2026-03-23**. The other 126 were entered by other means. Any audit has to treat
bot-written and hand-entered rows as different evidence.

---

## 3. What makes this hard, beyond counting

**Eras are not comparable.** 51 sessions scored under `1x`, 80 under `2x`, 2 under
`ORDAO`. "All weeks' points" cannot be summed across eras without an explicit
normalisation rule, and that rule is a decision, not a measurement.

**Two ledgers.** OG Respect (ERC-20) and ZOR (ERC-1155) are separate states. Research doc
`research/08-zao-fractal-measured-state.md` puts the two-ledger split's start at period
**67**, correcting an earlier claim of 74.

**One group of 8 exists on chain** (period 78, 2025-12-22), paid off-ladder
(110, 110, 40 x 6). Oversized groups happened and were handled by hand, so the ladder is
not a safe assumption when reconstructing.

---

## 4. What a full audit would involve

Four passes, in dependency order. Each is independently useful and can stop.

1. **Settle the schema questions.** Which of `score` / `respect_points` is authoritative;
   how eras normalise; whether a period's group count is knowable. Nothing else is
   trustworthy until these are answered. *Mostly decisions, not work.*
2. **Reconcile what exists** (periods 1-92). Per period: how many groups ran, how many
   have scores, do the scores form a valid ladder, do totals match chain. Produces a
   per-period completeness table and turns Class B from "18 periods look odd" into a
   specific list of missing groups.
3. **Reconstruct the blackout** (Class A, ~21 periods). Chain-first: mints per week ->
   ranks -> wallets. Recovers amounts and recipients; does **not** recover names, group
   composition or attendance. Whatever Discord history survives is the only source for
   those, and it degrades with time - this is the pass that gets harder the longer it waits.
4. **Close identity coverage** (Class C). Backfill `discord_id` where a wallet or member
   name can be resolved. 96% is the headline number and the one that makes the ledger
   hard to read as a human record.

**Prerequisite for anything written back:** migrations 0001-0006 are unapplied, so v2 has
no database. An audit can *read* today; it cannot record its findings until those land.

---

## 5. What I would ask before starting

- **Which column is authoritative, `score` or `respect_points`?** Blocks every total.
- **Is the goal a report, or corrected data?** A read-only reconciliation is much cheaper
  than a backfill, and only the second needs decisions about writing to history.
- **Does the blackout get reconstructed at all**, or is the chain considered a sufficient
  record for those 21 weeks? This is the largest single piece of work here.
- **Is period 6 known to have happened?** It may be a numbering artifact rather than a gap.
