/** Award verification - pure logic for checking whether a Respect award has
 * already been minted onchain, so a pending respectAccountBatch never
 * double-awards.
 *
 * Every ZOR Respect (ERC-1155) award on Optimism mints two tokens in one tx:
 *   1. A unique award NFT whose token id packs the recipient address
 *      (bits 0-159), the fractal meeting number (bits 160-223), and a
 *      mint-type byte at bits 224+ (observed value 10 for both weekly game
 *      results and manual respectAccount awards).
 *   2. Fungible token id 0 for the same amount (the running Respect balance).
 *
 * That makes verification deterministic: reconstruct the award NFT id for
 * (wallet, meeting) and ask the contract - `balanceOf(wallet, id) == 1`
 * means the award landed, `valueOfToken(id)` returns the points. No event
 * log scanning needed (public RPC endpoints cap getLogs ranges anyway).
 *
 * The id's period field is NOT the meeting number: **meeting = period + 1**
 * (ZAOOS research doc 2301, validated against the Airtable CSV record on
 * 15/18 overlapping meetings). On top of that fixed offset, todo lists can
 * still drift by a meeting or two from what was minted, so verification
 * searches a radius of nearby meeting numbers before declaring an award
 * missing. All hits in the radius are collected, not just the first: a
 * wallet can hold both a weekly game result at the expected meeting AND a
 * makeup award tagged nearby.
 *
 * This module is pure (no chain reads); scripts/verify-awards.ts is the
 * viem runner.
 */

/** An award someone believes is owed, from a todo list or meeting notes.
 * `amount` null = points not recorded; `wallet` null = unknown recipient. */
export interface PendingAward {
  name: string;
  wallet: `0x${string}` | null;
  meeting: number;
  amount: number | null;
}

/** An award NFT actually found onchain. */
export interface AwardHit {
  meeting: number;
  amount: number;
  mintType: number;
}

/** Mint-type byte observed in every ZOR award NFT id to date; the others are
 * scanned as a safety net in case a future ORDAO version mints differently. */
export const AWARD_MINT_TYPES = [10, 0, 1, 2] as const;

/** How many meeting numbers on each side of the expected one to search. */
export const MEETING_SEARCH_RADIUS = 2;

/** meeting = period + 1 (doc 2301, CSV-validated). */
export const PERIOD_MEETING_OFFSET = 1;

/** The onchain period field for a human meeting number. */
export function meetingToPeriod(meeting: number): number {
  return meeting - PERIOD_MEETING_OFFSET;
}

/** The human meeting number for an onchain period field. */
export function periodToMeeting(period: number): number {
  return period + PERIOD_MEETING_OFFSET;
}

/** Reconstruct the deterministic ZOR award NFT id for a wallet + onchain
 * period (use meetingToPeriod to convert a human meeting number). */
export function packAwardTokenId(
  wallet: string,
  period: number,
  mintType: number,
): bigint {
  return (BigInt(mintType) << 224n) | (BigInt(period) << 160n) | BigInt(wallet);
}

/** Decode an award NFT id back into its packed fields. */
export function unpackAwardTokenId(tokenId: bigint): {
  wallet: `0x${string}`;
  period: number;
  meeting: number;
  mintType: number;
} {
  const wallet = tokenId & ((1n << 160n) - 1n);
  const period = Number((tokenId >> 160n) & ((1n << 64n) - 1n));
  return {
    wallet: `0x${wallet.toString(16).padStart(40, '0')}` as `0x${string}`,
    period,
    meeting: periodToMeeting(period),
    mintType: Number(tokenId >> 224n),
  };
}

/** The meeting numbers to probe for an expected meeting, expected-first. */
export function meetingSearchRange(
  meeting: number,
  radius: number = MEETING_SEARCH_RADIUS,
): number[] {
  const range = [meeting];
  for (let step = 1; step <= radius; step++) {
    range.push(meeting - step, meeting + step);
  }
  return range;
}

/** Verdict for one pending award against the hits found onchain. */
export function awardVerdict(award: PendingAward, hits: AwardHit[]): string {
  if (award.wallet === null) return 'CANNOT VERIFY - wallet unknown';
  if (hits.length === 0) {
    return (
      `MISSING - no onchain award within ${MEETING_SEARCH_RADIUS} meetings ` +
      `of ${award.meeting}; include in respectAccountBatch`
    );
  }

  const where = (hit: AwardHit) =>
    hit.meeting === award.meeting
      ? `meeting ${hit.meeting}`
      : `meeting ${hit.meeting} (expected ${award.meeting})`;

  if (award.amount !== null) {
    const exact = hits.find((h) => h.amount === award.amount);
    if (exact) return `ALREADY AWARDED - ${award.amount} at ${where(exact)}`;
    const found = hits.map((h) => `${h.amount} at meeting ${h.meeting}`).join(', ');
    return `PARTIAL - found ${found}, expected ${award.amount} - review before awarding`;
  }
  const found = hits.map((h) => `${h.amount} at ${where(h)}`).join(', ');
  return `ALREADY AWARDED - ${found} (expected amount was unrecorded)`;
}
