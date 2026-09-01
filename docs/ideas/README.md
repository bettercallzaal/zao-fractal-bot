# Ideas - next iterations

Work that is decided but deliberately not being built yet, so the Respect Game
core can be tested over the next few weeks without a moving target around it.

Each entry records the decision that was already made, so none of it gets
re-litigated when its turn comes. Decisions are Zaal's unless stated, taken
2026-09-01.

Everything labelled MEASURED was read from the live database, the live chain,
or the source at the path named.

---

## 1. ZID as the canonical member id

**Decided:** one ZID per person, and everything keys on it. Discord id,
wallets, Farcaster fid and display name hang off the ZID rather than each
system keeping its own idea of who someone is.

**Why it is not in the game core spec:** it is an identity migration touching
the bot, the leaderboard and two years of history at once. The game core can
write rows keyed on `discord_id` and `wallet_address` today and gain a `zid`
column later cheaply. The reverse is not true.

**Already there:** MEASURED - `users.zid` exists on the ZAO OS project
(`efsxtoxvigqowjhgcbiz`). 60 rows in `users`, 22 of them with a `discord_id`.

**Blocks:** the backfill (item 4). Two years of history cannot be keyed to
people until there is one id per person.

---

## 2. Registry convergence onto Supabase

**Decided:** converge on Supabase as the single member registry, with the
leaderboard reading it. The chain stays the source of truth for balances.

**The problem it solves:** there are currently three registries.
`ZAO-Leaderboard` reads member identity from **Airtable**. `respect_members` on
ZAO OS holds 188 members, 161 with a wallet (MEASURED). v1 also kept
`data/names_to_wallets.json` and `data/wallets.json` locally. A member who
registers in Discord never appears on the leaderboard, and nobody finds out.

**Work:** an Airtable to Supabase import, plus a change to
`ZAO-Leaderboard`'s data layer. Once done, the bot's own register flow is
enough to put someone on the public leaderboard, which it is not today.

---

## 3. Member list with join dates

**Decided:** show both dates side by side - when someone joined Discord, and
when they first earned Respect. The gap between arriving and taking part is
itself worth seeing.

**Already there:** MEASURED - `respect_members.first_respect_at` exists. The
Discord join date has to be read from Discord.

**Depends on:** item 1, so a person is one row rather than several.

---

## 4. Backfill to week one, reviewed week by week

**Decided:** go back to the first fractal, not just to the gap. And Zaal
reviews each week himself: "I wanna review each week weather it disagrees or
not and I'll prob post about each one from the zao account."

That makes this a **human review queue with a publishing surface**, not a
migration script. Each week lands as something to approve or correct, with a
draft post for the ZAO account.

**What the sources are, and how far they disagree:**
- **The chain** has every award, signed and dated, since period 1. MEASURED:
  the period number is carried in the ZOR token id and stepped `0x6e` to `0x6f`
  between 2026-08-25 and 2026-08-31.
- **Supabase** holds 133 sessions, of which MEASURED only 7 carry a
  `thread_id`, and `scoring_era` splits 51 at `1x`, 80 at `2x`, 2 at `ORDAO`.
- **v1's `data/history.json`** holds the pre-Supabase record.

The chain has amounts, ranks, recipients and dates. Only the other two have
group names, facilitator, Discord ids and thread links. Neither is complete.

**Depends on:** item 1.

---

## 5. Hats, teams, projects, boards

Subsystem 2 of the agreed decomposition. v1 has 966 lines in `cogs/hats.py`;
v2 has none. Hats are permissions layered over the game, so the game has to
exist first.

---

## 6. v1 cogs not yet carried forward

`cogs/proposals.py` (1689 lines), `cogs/snapshot.py` (472),
`cogs/events.py` (457), `cogs/intro.py` (318), `cogs/guide.py` (283).

**Carry a warning into the events port.** MEASURED in v1: the
`cogs/events.py` reminder loop runs every 60s and sends `@everyone` *before*
writing its suppression field to Supabase, with no try/except on either, while
the `total_seconds <= threshold` condition stays true for the whole window. If
that write ever fails while the send succeeds, it pings `@everyone` every 60
seconds for up to a day, per event, per threshold. It is the only unbounded
outbound path in v1 and it must not be ported as written.

---

## 7. Multi-platform surfaces

v3. The game core is built platform-agnostic for this reason - no `discord.js`
under `src/game/` or `src/commands/`, enforced by a test - so a second surface
is an adapter rather than a rewrite.

Zaal's framing: "in an ideal world this would be mutli platform but let's save
that for v3 just have V2 be clean agentic since that can get us to
multiplatform."
