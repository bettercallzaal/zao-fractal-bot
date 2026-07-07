// Elimination-voting mechanic carried forward from fractalbotapril2026
// (cogs/fractal/group.py) - proven in production, kept as pure/testable
// functions here instead of buried in a stateful Discord event handler.

/** Minimum votes a candidate needs to win a round: majority of the group. */
export function majorityThreshold(groupSize: number): number {
  if (groupSize < 1) {
    throw new RangeError(`groupSize must be >= 1, got ${groupSize}`);
  }
  return Math.max(1, Math.floor(groupSize / 2) + (groupSize % 2));
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
