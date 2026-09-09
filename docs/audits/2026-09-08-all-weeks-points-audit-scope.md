# All-Weeks Points Audit - the shape of the job

> Scoping only. **Nothing has been audited or changed.** Zaal asked for the shape
> before the work: *"It's not money but we deff need a zao fractal lane to review and
> audit all weeks points."* (2026-09-08)

Every figure below was measured on 2026-09-08 against the live ZAO OS project
(`efsxtoxvigqowjhgcbiz`) over REST, and against the branch's own source. Nothing is
recalled.

> **RE-VERIFY BY 2026-09-22.** Every count here is a snapshot of a live database that is
> expected to change: migrations 0001-0006 are pending, and once they land the bot starts
> writing sessions again. Past that date, re-run the measurements before acting on any
> number below - and correct them at the TOP of this file, not only in the section you
> happen to be editing.
>
> Figures that carry a `zao-measure` citation comment were re-run and confirmed as of the
> timestamp in that comment; `zao-measure --verify` re-runs the exact query named in the
> comment and reports whether the figure still holds. A figure with no citation was not
> re-verified by that tool and should not be read as more current than the document date.

**Respect is not money.** This document does not describe any period as unpaid, owed,
or a debt, and Zaal has made no decision to mint anything.

---

## 1. What exists

<!-- measured 2026-09-08T19:20Z - zao-measure --verify "zaofractal: fractal ledger shape" -->

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

**Source of truth for Class A is the chain, not Discord.** *(Weekly-mint claim measured
2026-08-31 by this lane; **re-verify by 2026-09-22** - it is a statement about an ongoing
external process and decays.)* Reconstruction means reading
mint transactions per week and mapping amounts back to ranks. What the chain cannot give
back is the human layer: names, group composition, facilitator, who attended and earned
nothing.

### Class B - periods recorded but never scored

- **Period 61** - sessions exist, **zero** score rows across all of its groups.
- **Periods 74-91** - **18 consecutive periods** where *some* groups have score rows and
  others have none. Partial records, not absent ones.

Class B is the subtlest class: these periods *look* present in any count of sessions and
are silently short on results.

### Class C - identity coverage, and a column that lies

> **Corrected 2026-09-08, same day.** An earlier draft of this section said 96% of rows
> "carry no value in `respect_points`". That was wrong, and wrong in the direction that
> matters. Re-measured distinguishing null from zero:

<!-- measured 2026-09-08T19:20Z - zao-measure --verify "zaofractal: fractal ledger shape" -->

| Field | null | zero | genuinely present |
|---|---|---|---|
| `discord_id` | **771** | - | 30 |
| `wallet_address` | 43 | - | 758 |
| `respect_points` | **0** | **771** | 30 |

`respect_points` is **never null. It is zero on 771 of 801 rows.** That is a *wrong value,
not a missing one*, and it is more dangerous: a null is skipped by any honest sum, a zero
is silently added. Anything totalling this column today reports that 96% of all Respect
ever awarded was zero.

**Which column is authoritative: `score`. Measured, not asked.**

| Column | Non-null | Matches the `RESPECT_POINTS` ladder by rank |
|---|---|---|
| `score` | 801 | **489** |
| `respect_points` | 801 (771 of them zero) | **30** |

`score` holds era-appropriate values (its distinct values include 2, 5, 8, 9, 13, 21, 22,
23, 31 - the smaller 1x-era numbers - alongside the ladder). `respect_points` holds only
`{0, 10, 16, 26, 42, 68, 110}`, i.e. the 2x ladder or nothing.

The same **30 rows** carry both a `discord_id` and a non-zero `respect_points`, against 7
bot-written sessions. So one narrow slice was written properly and the rest was not.

**Use `score`. Treat `respect_points` as unpopulated except on those 30 rows**, and do not
sum it.

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

1. **Settle the remaining schema questions.** The authoritative-column question is
   **already answered - it is `score`**, measured, see Class C. What is left: how the
   1x / 2x / ORDAO eras normalise against each other, and whether a period's true group
   count is knowable. Both are genuine decisions, not measurements.
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

## 5. What actually blocks starting

One question was on this list and has been removed: *which column is authoritative*. It was
answerable by measurement rather than by asking, so it was measured - see Class C. `score`.

- **Is the goal a report, or corrected data?** A read-only reconciliation is much cheaper
  than a backfill, and only the second needs decisions about writing to history.
- **Does the blackout get reconstructed at all**, or is the chain considered a sufficient
  record for those 21 weeks? This is the largest single piece of work here.
- **Is period 6 known to have happened?** It may be a numbering artifact rather than a gap.
