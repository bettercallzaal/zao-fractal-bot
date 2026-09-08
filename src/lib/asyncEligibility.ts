// Who may be ranked without attending. Pure: the caller supplies the clock and
// the intro set, so nothing here reads the wall clock or the database.
//
// Spec 2026-09-02 sections 4 and 5.

import { ASYNC_WINDOW_HOURS } from '@fractalbot/shared';
import type { Participant } from '../game/session.js';

export interface AsyncSubmission {
  discordId: string;
  displayName: string;
  wallet: string | null;
  createdAtMs: number;
}

/** Eligible entrants, EARLIEST SUBMISSION FIRST. That order is load-bearing:
 * seatGroups defers from the tail, so the ordering here is the overflow rule.
 * Earliest-first is the only rule that cannot be gamed by refreshing and does
 * not ask the facilitator to choose between people.
 *
 * `introDiscordIds` is the set as it stood when the session started. Passing
 * it in - rather than looking it up here - is what makes the gate resolve at
 * capture time: a late intro cannot retroactively qualify a submission that
 * was already made (spec section 4). */
export function eligibleAsyncEntrants(args: {
  submissions: AsyncSubmission[];
  sessionStartMs: number;
  introDiscordIds: ReadonlySet<string>;
}): Participant[] {
  const opensAt = args.sessionStartMs - ASYNC_WINDOW_HOURS * 3_600_000;

  const inWindow = args.submissions.filter(
    (s) =>
      s.createdAtMs >= opensAt &&
      s.createdAtMs <= args.sessionStartMs &&
      args.introDiscordIds.has(s.discordId),
  );

  const earliestFirst = [...inWindow].sort((a, b) => a.createdAtMs - b.createdAtMs);

  // One seat per person. Sorted ascending, so the first sighting is the
  // earliest and later submissions from the same person do not jump the queue.
  const seen = new Set<string>();
  const unique: Participant[] = [];
  for (const s of earliestFirst) {
    if (seen.has(s.discordId)) continue;
    seen.add(s.discordId);
    unique.push({ discordId: s.discordId, displayName: s.displayName, wallet: s.wallet });
  }
  return unique;
}
