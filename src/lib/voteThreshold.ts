// Elimination-voting mechanic carried forward from fractalbotapril2026
// (cogs/fractal/group.py) - proven in production, kept as pure/testable
// functions here instead of buried in a stateful Discord event handler.

/** Minimum votes a candidate needs to take a level: a STRICT majority of the
 * group. 4 of 6, 3 of 4, 3 of 5, 2 of 2.
 *
 * This used to return `floor(n/2) + n%2`, which is exactly half for an even
 * group - 3 of 6 - despite being called a majority. Two things followed from
 * that, and both were wrong. Two candidates could each hold 3 of 6, so a tie
 * was reachable; and because the tally was read after every single vote, a 3-3
 * split was decided by whichever third vote arrived first rather than by the
 * group. Half is not a majority and click order is not consensus.
 *
 * A strict majority makes a tie arithmetically impossible, which is what lets
 * the game have no tie break at all - Zaal, 2026-09-01: "No tie break we need
 * consensus to move forward." When nobody clears it, the round stays open and
 * the group keeps talking. See spec section 7. */
export function majorityThreshold(groupSize: number): number {
  if (groupSize < 1) {
    throw new RangeError(`groupSize must be >= 1, got ${groupSize}`);
  }
  return Math.floor(groupSize / 2) + 1;
}

/** Given a map of candidateId -> vote count, return the winner once any
 * candidate's votes reach the majority threshold for the group. Returns
 * null if no one has cleared the threshold yet. */
export function findRoundWinner(
  voteCounts: Map<string, number>,
  groupSize: number,
): string | null {
  const threshold = majorityThreshold(groupSize);
  for (const [candidateId, votes] of voteCounts) {
    if (votes >= threshold) return candidateId;
  }
  return null;
}
