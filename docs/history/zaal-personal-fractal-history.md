# Zaal's personal fractal history

Built 2026-09-26, on request, from a direct read of onchain data - every OG Respect and ZOR
Respect transfer ever involving Zaal's wallet (`0x7234c36a71ec237c2ae7698e8916e0735001e9af`),
walked in full via the Optimism Blockscout API (518 OG transfers, 86 ZOR transfer log entries
resolving to 40 unique awards after removing duplicate log rows). This is a different document
from `zao-fractal-timeline.md` - that one is the organization's history; this one is one member's
- the founder's - own participation record, read the same way: measured, not remembered.

## The founder's path, before ZAO Fractal existed

- **October 2023** - joins Optimism Fractal in week 6, then becomes an active member and later a
  council member of Eden Fractal. *(ZAOfractal whitepaper ch08, "The Zaal Arc" - not independently
  re-verified here, carried from that source)*
- **2024-07-30** - founds ZAO Fractal. Same day, his wallet receives its first-ever OG Respect
  mint (1000 OG at 00:20:15 UTC, then seven more mints across the same day totaling 1,458 OG by
  end of day 2024-07-30). This is also the earliest OG Respect receipt on the ENTIRE ledger -
  the genesis point everything else in ZAO Fractal's history is measured from.

## OG Respect era (2024-07-30 to 2025-12-20) - administrative, not a personal score

**Read this section carefully before quoting a number from it.** Of 518 total OG Respect
transfers ever recorded on the token, **447 have Zaal's wallet as the sender**. Of the 74 where
his wallet is the *recipient*, 69 are direct mints from the zero address
(`0x000...000`), arriving in small, irregular batches (5, 8, 10, 13, 21, 34, 44... up to
2,852 in one mint) roughly weekly to biweekly from 2024-07-30 through 2025-09-09. The other five
are the two settlement transfers described below, a 126 OG transfer from the wallet to itself
on 2025-04-15, and two more non-mint receipts; recounted from the Blockscout transfer log on
2026-09-27.

This is not a personal Respect-earned record. It is the shape of how OG Respect actually worked
for periods 1-66: Zaal held mint authority and distributed awards to members by hand, week to
week, tracked in Airtable rather than earned by any individual ranking mechanism visible onchain.
**The 447 outbound transfers are him distributing the game's awards; the 74 inbound mints are him
funding his own distributing wallet, not a personal score.** Summing "OG received by Zaal" as
if it were his own earned total would overstate his personal participation by conflating it with
his administrative role - so this document doesn't report that sum.

**What the OG era does give cleanly: his current, final OG balance.** On 2025-12-12, his wallet
received exactly **3,094 OG** in one transfer from a contract address
(`0x7A944994cE587bD133c2E6C683FE34951cBb5575`, unidentified beyond "is a contract" - no ENS, no
Blockscout tag), followed by a further 150 OG on 2025-12-20. **3,094 OG matches, to the token,**
the vote-weight figure measured independently in `season3-protocol-survey-2026-09-11.md`
("`voteWeightOf` and `respectOf` both return 3094 OG Respect") - so this is where that number
comes from: a single December 2025 settlement transaction, not an accumulated personal balance
from years of weekly participation. His live OG balance today (checked 2026-09-26 via the
Blockscout token-balance API) is still exactly **3,094 OG** - unchanged since that settlement,
consistent with OG being paused for new mints since December 2025.

## ZOR Respect era (2025-10-16 to present) - his real weekly record

This part is clean. ZOR mints come from OREC executing a passed proposal after a session is
scored, so every ZOR award to Zaal's wallet is a real result from a real breakout group, not an
administrative artifact. **40 unique awards, periods 67 through 114** (of 48 periods in that
span, he has an award recorded in 40 - see "Gaps" below), **881 points minted to him in total**
across that span.

| Period | Date | Rank (level) | Points |
|---|---|---|---|
| 67 | 2025-10-17 | - | 13 |
| 68 | 2025-10-16 | - | 5 |
| 69 | 2025-10-17 | - | 21 |
| 73 | 2025-11-10 | 2nd | 16 |
| 74 | 2025-11-17 | 3rd | 26 |
| 75 | 2025-12-08 | 2nd | 16 |
| 76 | 2025-12-07 | 3rd | 26 |
| 77 | 2025-12-22 | 1st | 10 |
| 78 | 2025-12-22 | even-split | 40 |
| 79 | 2025-12-22 | 2nd | 16 |
| 80 | 2025-12-29 | 1st | 10 |
| 81 | 2026-01-26 | 2nd | 16 |
| 82 | 2026-01-26 | 1st | 10 |
| 83 | 2026-02-02 | 3rd | 26 |
| 84 | 2026-02-09 | 4th | 42 |
| 85 | 2026-02-16 | 2nd | 16 |
| 86 | 2026-02-23 | 1st | 10 |
| 87 | 2026-03-03 | 4th | 42 |
| 88 | 2026-03-09 | 3rd | 26 |
| 89 | 2026-03-16 | **5th (68)** | 68 |
| 90 | 2026-03-26 | 3rd | 26 |
| 91 | 2026-03-30 | 1st | 10 |
| 92 | 2026-04-06 | 2nd | 16 |
| 93 | 2026-04-13 | 1st | 10 |
| 94 | 2026-04-20 | 3rd | 26 |
| 95 | 2026-04-27 | 3rd | 26 |
| 96 | 2026-05-11 | 2nd | 16 |
| 97 | 2026-05-19 | 2nd | 16 |
| 98 | 2026-05-19 | 1st | 10 |
| 99 | 2026-05-25 | 2nd | 16 |
| 100 | 2026-06-08 | 3rd | 26 |
| 101 | 2026-06-08 | 2nd | 16 |
| 104 | 2026-07-06 | 3rd | 26 |
| 105 | 2026-08-03 | even-split | 40 |
| 106 | 2026-07-27 | 1st | 10 |
| 107 | 2026-08-03 | 4th | 42 |
| 108 | 2026-08-10 | 3rd | 26 |
| 109 | 2026-08-18 | 2nd | 16 |
| 110 | 2026-08-25 | 1st | 10 |
| 114 | 2026-09-24 | 4th | 42 |

"Rank" here is the ladder position ("level" in the mint metadata: 1=lowest/10pts through
5=highest/68pts recorded, against the six-rank 110/68/42/26/16/10 curve - he has never placed
1st-by-points/rank-6 in this data, his best recorded placement is the 68-point rank at period 89).
Periods 67-69 predate the standard award format (`mintType=0` rather than `mintType=10`) and
carry no rank metadata, just points. Periods 78 and 105 are even 40-point splits (`level: null,
denomination: 40`) - the same award shape used in the fractal 112/113 CSV built 2026-09-24,
confirming that shape is a real, recurring pattern in the ledger, not a one-off invention.

**Live ZOR balance today (2026-09-26): 842**, not 881. The 39-point gap is exactly accounted for:
periods 67 (13) + 68 (5) + 69 (21) = 39, and those three periods fall inside the mass reversal
transaction already known from `ZAOfractal/research/09-open-questions-for-operators.md` Q1 -
28 ZOR awards across periods 67-70 burned in one transaction on 2025-10-24, "why" unresolved.
**This confirms Zaal's own early awards were part of that reversal.** He also separately holds
39 distinct award NFTs (one non-fungible instance per award, value 1 each, on top of the fungible
balance-842 token) - the individual collectible record of each still-standing award.

## Gaps in his own record, and what they do and don't mean

Periods in his own span (67-114) with no award recorded to him: **70, 71, 72, 102, 103, 111, 112,
113.**

- **70, 71, 72** - match already-known ledger-wide gaps: 70 was reversed in the same transaction
  as 67-69 (see above); 71-72 were played and scored in Airtable but never minted onchain at all
  (`research/09-open-questions-for-operators.md` Q2) - not personal to him, nobody was minted for
  those two periods.
- **102, 103** - 103 matches the ledger-wide "did period 103 happen" open question (Q3, same
  source). 102 missing from his own record specifically is new here - not previously flagged as a
  ledger-wide gap, so this may just mean he wasn't ranked or wasn't present that week, not that
  the period itself is missing. Worth checking against the wider ledger before treating as a
  second gap.
- **111, 112, 113** - **not a ledger problem.** The fractal-112/113 CSV built 2026-09-24
  (`~/Downloads/fractal-112-113-even-split.csv`) has him listed for both periods at an even
  40-point split each, and this onchain check confirms neither has been minted yet - the CSV is
  still sitting unsubmitted. Consistent, not contradictory.

## Sources

- Optimism Blockscout API (`optimism.blockscout.com/api/v2/addresses/{wallet}/token-transfers`
  and `/tokens`), walked in full 2026-09-26 for OG Respect
  (`0x34cE89baA7E4a4B00E17F7E4C0cb97105C216957`) and ZOR Respect
  (`0x9885CCeEf7E8371Bf8d6f2413723D25917E7445c`) against `0x7234c36a71ec237c2ae7698e8916e0735001e9af`.
- `zao-fractal-timeline.md` (this directory) for the organization-level dates this cross-checks
  against.
- `ZAOfractal/research/09-open-questions-for-operators.md` for the periods 67-70 reversal and
  71-72/103 gap questions this document's own data corroborates.
- `season3-protocol-survey-2026-09-11.md` for the independently-measured 3,094 OG vote-weight
  figure this document traces to its source transaction.
