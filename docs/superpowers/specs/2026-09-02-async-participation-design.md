# Async Fractal Participation - Design

Let someone submit in the 12 hours before a fractal and be ranked in it without
attending.

- **Status:** design approved in chat 2026-09-02. Not yet implemented.
- **Decided by:** Zaal, 2026-09-02.
- **Depends on:** the Phase 1 recorder (merged, `e270e41`). This extends it.
- **Next step:** `superpowers:writing-plans`.

Claims marked MEASURED were read from the live chain, Supabase or Airtable on
2026-09-02.

---

## 1. Why this is small

Most of it exists.

- **`src/lib/contributions.ts`** (116 lines, tested) already logs work outside
  the call and digests it per member for the circle. That is the submission and
  the summary.
- **`discord_contributions`** already has `discord_id`, `content`, `links`,
  `meeting_number`, `reviewed`.
- **`discord_intros`** exists on the live ZAO OS project - MEASURED, 6 rows,
  columns `discord_id, intro_text, message_id, posted_at, cached_at`. That is
  the gate.
- **`src/game/session.ts`** already runs the ranking.

What is missing is one idea: a person can be **ranked without voting**.

## 2. The one mechanic

An async submitter is **votable-for and never voted-with.**

Yesterday's consensus rule (spec `2026-09-01`, section 7.1) evaluates a round
only once *every participant* has voted. If an async submitter counted as a
participant, the round could never resolve - the failure already recorded as
the passing test `known limitation: a silent member blocks the round`.

So `participants` splits in two:

```ts
interface GameState {
  voters: Participant[];      // present in the room
  asyncEntrants: Participant[]; // submitted in the window, not present
  // candidates = voters ++ asyncEntrants
}
```

- `votesNeeded(state)` counts **voters only**. Five present plus two async
  still needs 3 votes, not 4.
- `awaitingVoters(state)` counts **voters only**. An absent person can never
  stall a round.
- `activeCandidates(state)` counts **both**, minus anyone who already took a
  level.

That is the entire change to the engine. Everything else in `session.ts` -
elimination, the strict majority, the no-tie-break rule, `finalRanking` - is
untouched, and its 16 tests should still pass unmodified.

## 3. The cap resolves the hard problem

**A group is at most 6 people including async entrants** (Zaal, 2026-09-02;
`MAX_GROUP_MEMBERS` already 6 in `packages/shared/src/config.ts`).

This matters more than it looks. `RESPECT_POINTS` has exactly six entries, and
`finalRanking` currently pays `RESPECT_POINTS[index] ?? 0` - so a seventh
member would silently earn **nothing**. Capping candidates at 6 means the
ladder always fits and that branch is never reached.

MEASURED, for context: one group of 8 exists on chain (period 78, 2025-12-22),
and it was *not* paid on the ladder - it received 110, 110, 40, 40, 40, 40, 40,
40. So oversized groups have happened and were handled by hand.

**Consequence needing a rule:** if more people submit than there are free
slots, not everyone gets in. The rule this design adopts is **earliest
submission first**, with the rest carried to the next fractal and told so. It
is the only rule that cannot be gamed by refreshing, and it does not ask the
facilitator to choose between people.

## 4. The gate: an introduction

To be ranked async you must have an introduction on file **before the session
starts**.

Resolved at capture time, not display time - a late intro cannot retroactively
qualify a submission that was already made. The check is a lookup of
`discord_intros` by `discord_id`.

**Known limitation, stated rather than designed around.** `discord_intros` is
keyed on `discord_id`, so this gate is Discord-shaped. Section 6's later
surfaces - Farcaster, mini app, web - have no Discord id for a first-time
submitter, so either intros become surface-agnostic or those submitters cannot
pass. Not solved here, because the first surface is Discord.

MEASURED: the table holds 6 rows. v1 rebuilds it from the `#intros` channel via
`/admin_refresh_intros`; that refresh has to run before the gate is meaningful.

## 5. The window

Twelve hours before the session. A submission is eligible if
`created_at >= sessionStart - 12h`.

The comparison uses the session's start, so it is decided when `/start` runs
rather than drifting with wall-clock time. `contributions.ts` already takes an
injectable `nowMs` for exactly this kind of determinism; the same pattern
applies.

## 6. Surfaces, and why only one ships

Zaal chose all four - Farcaster cast, Discord, mini app, web app - and Discord
first because it already exists.

They are four different auth models, four spam surfaces and four failure modes.
What they share is small: a submission has an author, a body, links and a
timestamp. **The shared core plus Discord ships first.** Each further surface
is its own spec, and each has to answer section 4's identity problem for itself.

Recorded for those later specs, MEASURED: reading casts via Neynar is a *read*,
`NEYNAR_API_KEY` is already wired, and `src/lib/farcaster.ts` does reads today
while `draftCast` stays deliberately draft-only. So Farcaster ingest needs no
posting permission - only the one weekly prompt cast does, and that is a
separate decision.

## 7. What the circle sees

Verbatim, grouped by person, with their links, under their name - which is what
`formatContributionDigest` already produces. **No model in the loop.** Zaal
chose this over an LLM summary: a paraphrase of the evidence someone is ranked
on can cost them Respect, and there is nothing to distrust when the words are
theirs.

The only change is that async entrants appear in the voting buttons alongside
the room, visually marked so nobody mistakes them for present.

## 8. The onchain path is unchanged

Async entrants who place in the top six are in the `rankings` array like anyone
else, and `proposeBreakoutResultX2` pays them by position. Because the cap
holds the group at 6, no new call is needed.

They are subject to the same wallet rule as everyone else (spec `2026-09-01`,
section 9.2): if they have no wallet, the group's proposal uses
`proposeRespectAccountBatch` with explicit amounts so nobody's level shifts, and
a supplementary proposal follows when the wallet arrives.

## 9. Testing

- Engine: a group of 4 voters plus 2 async resolves on 3 votes; an async
  entrant never appears in `awaitingVoters`; an async entrant can win Level 6.
- The existing 16 `session.test.ts` cases pass unmodified - if any needs
  changing, the split was done wrong.
- Gate: a submission from someone with no intro row is rejected at capture.
- Window: a submission 12h1m before the session is rejected; 11h59m is accepted.
- Cap: a seventh candidate is deferred, not silently paid zero.

## 10. Out of scope

Farcaster, mini-app and web surfaces (section 6). Surface-agnostic intros
(section 4). Async *voting* - Zaal chose ranked-but-not-voting, on the grounds
that ranking before hearing the presentations inverts the Respect Game.
