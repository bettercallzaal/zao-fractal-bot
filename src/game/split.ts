// Splitting one fractal thread's roster into multiple group threads. Pure: no
// I/O, no discord.js - see src/architecture.test.ts. The Discord adapter
// (src/discord/gameCommands.ts) does the actual thread creation and calls
// these functions for the allocation, naming and reporting logic so that
// logic stays unit-testable even though thread creation itself is not.
//
// The break this file fixes: /start built its roster from every non-bot
// member of the thread and handed all of them to startSession, which throws
// past MAX_GROUP_MEMBERS. A fractal with 7+ people is normal and this made
// /start hard-fail on the ordinary case. Discord does not allow a thread
// inside a thread, so a split group's thread has to be created in the parent
// channel, under a fresh thread id - sessions are keyed by thread_id
// (fractal_sessions.thread_id, loadSessionByThread, the vote button
// customId, the in-memory `live` map), so two groups sharing one thread would
// collide on all four.

import { MAX_GROUP_MEMBERS } from '@fractalbot/shared';
import type { Participant } from './session.js';
import { seatGroups } from './seating.js';

/** Whether a roster is too big for one group and needs to be split. Six or
 * fewer is the common case and must behave exactly as before - no split, no
 * new threads. */
export function needsSplit(participantCount: number): boolean {
  return participantCount > MAX_GROUP_MEMBERS;
}

/** Fisher-Yates, given an rng so this stays deterministic and testable.
 * seatGroups is deterministic round-robin by design (its own comment says
 * the caller owns randomness - see randomize.ts's distributeIntoGroups,
 * which makes the same split) - so group assignment must not be predictable
 * from the caller's array order. Does not mutate `items`. */
export function shuffle<T>(items: readonly T[], rng: () => number = Math.random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function threadNameForGroup(meetingNumber: number, groupNumber: number): string {
  return `ZAO Fractal ${meetingNumber} - Group ${groupNumber}`;
}

export interface PlannedGroup {
  groupNumber: string;
  threadName: string;
  participants: Participant[];
}

/** Shuffles the roster and runs it through seatGroups with no async
 * entrants - the split path only fans out people who are already present,
 * it does not touch async admission. Groups are numbered 1..N, freshly
 * assigned every time: whatever `group` value the slash command received is
 * ignored once a split happens, because there is no longer one group for it
 * to name. seatGroups already guarantees no group exceeds MAX_GROUP_MEMBERS
 * and derives its group count from the candidate pool - do not duplicate
 * that logic here. */
export function planSplitGroups(
  participants: Participant[],
  meetingNumber: number,
  rng: () => number = Math.random,
): PlannedGroup[] {
  const seating = seatGroups({ voters: shuffle(participants, rng), eligibleAsync: [] });
  return seating.groups.map((g, i) => {
    const groupNumber = i + 1;
    return {
      groupNumber: String(groupNumber),
      threadName: threadNameForGroup(meetingNumber, groupNumber),
      participants: g.voters,
    };
  });
}

/** One planned group's real-world outcome, reported back to the facilitator.
 * `threadId` is set as soon as the thread exists, even if a later step (e.g.
 * startFractal) then fails for that same group - so the summary can say
 * "thread created but not started" rather than just "failed". */
export interface GroupOutcome {
  groupNumber: string;
  threadName: string;
  threadId: string | null;
  started: boolean;
  error?: string;
}

/** Renders the facilitator-facing summary. Never rolls anything back and
 * never hides what happened: every planned group gets one line, in order -
 * started (with a link), failed (with what went wrong and whether a thread
 * exists to check), or not attempted at all, because an earlier group in the
 * sequence failed and the remaining plan was never tried. A failed or
 * partial write must be visible, never swallowed - see src/lib/gameRepo.ts's
 * header for why that rule exists. */
export function formatSplitSummary(outcomes: GroupOutcome[], totalGroups: number): string {
  const allStarted = outcomes.length === totalGroups && outcomes.every((o) => o.started);

  const lines = outcomes.map((o) => {
    if (o.started) return `Group ${o.groupNumber}: started in <#${o.threadId}>.`;
    const threadNote = o.threadId ? ` Thread <#${o.threadId}> was created but not started.` : '';
    return `Group ${o.groupNumber} (${o.threadName}): FAILED - ${o.error}.${threadNote}`;
  });
  for (let i = outcomes.length; i < totalGroups; i++) {
    lines.push(`Group ${i + 1}: not attempted.`);
  }

  const header = allStarted
    ? `Split into ${totalGroups} groups.`
    : `Split into ${totalGroups} groups - NOT all of them started. Nothing was rolled back; ` +
      `check each line below before continuing.`;

  return [header, ...lines].join('\n');
}
