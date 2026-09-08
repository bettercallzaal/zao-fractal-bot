import { describe, expect, it } from 'vitest';
import type { Participant } from './session.js';
import {
  formatSplitSummary,
  needsSplit,
  planSplitGroups,
  shuffle,
  threadNameForGroup,
  type GroupOutcome,
} from './split.js';

const people = (prefix: string, n: number): Participant[] =>
  Array.from({ length: n }, (_, i) => ({
    discordId: `${prefix}${i + 1}`,
    displayName: `${prefix}${i + 1}`,
    wallet: null,
  }));

describe('needsSplit', () => {
  it('is false at and below the six-person cap - the common case must not change', () => {
    expect(needsSplit(0)).toBe(false);
    expect(needsSplit(5)).toBe(false);
    expect(needsSplit(6)).toBe(false);
  });

  it('is true past the cap', () => {
    expect(needsSplit(7)).toBe(true);
    expect(needsSplit(8)).toBe(true);
  });
});

describe('threadNameForGroup', () => {
  it('formats "ZAO Fractal <meeting> - Group <n>"', () => {
    expect(threadNameForGroup(111, 1)).toBe('ZAO Fractal 111 - Group 1');
    expect(threadNameForGroup(111, 2)).toBe('ZAO Fractal 111 - Group 2');
  });
});

describe('shuffle', () => {
  it('returns a permutation: same elements, same length', () => {
    const items = people('v', 7);
    const out = shuffle(items, () => 0);
    expect(out).toHaveLength(items.length);
    expect(out.map((p) => p.discordId).sort()).toEqual(items.map((p) => p.discordId).sort());
  });

  it('does not mutate its input', () => {
    const items = people('v', 5);
    const before = items.map((p) => p.discordId);
    shuffle(items, () => 0);
    expect(items.map((p) => p.discordId)).toEqual(before);
  });

  it('with a fixed rng of 0, produces the known Fisher-Yates rotation (deterministic, not identity)', () => {
    // rng() => 0 makes every swap target index 0, which rotates the array
    // rather than leaving it untouched - this is the concrete evidence that
    // shuffle actually reorders instead of being a no-op pass-through.
    const items = people('v', 7);
    const out = shuffle(items, () => 0);
    expect(out.map((p) => p.discordId)).toEqual(['v2', 'v3', 'v4', 'v5', 'v6', 'v7', 'v1']);
    expect(out.map((p) => p.discordId)).not.toEqual(items.map((p) => p.discordId));
  });
});

describe('planSplitGroups', () => {
  it('7 participants -> two groups of 4 and 3, numbered 1 and 2', () => {
    const plan = planSplitGroups(people('v', 7), 111, () => 0);
    expect(plan.map((g) => g.participants.length)).toEqual([4, 3]);
    expect(plan.map((g) => g.groupNumber)).toEqual(['1', '2']);
    expect(plan.map((g) => g.threadName)).toEqual([
      'ZAO Fractal 111 - Group 1',
      'ZAO Fractal 111 - Group 2',
    ]);
  });

  it('8 participants -> two groups of 4', () => {
    const plan = planSplitGroups(people('v', 8), 42, () => 0);
    expect(plan.map((g) => g.participants.length)).toEqual([4, 4]);
  });

  it('12 participants -> two groups of 6', () => {
    const plan = planSplitGroups(people('v', 12), 42, () => 0);
    expect(plan.map((g) => g.participants.length)).toEqual([6, 6]);
  });

  it('no group ever exceeds MAX_GROUP_MEMBERS', () => {
    for (let n = 7; n <= 25; n++) {
      const plan = planSplitGroups(people('v', n), 1, () => 0);
      for (const g of plan) expect(g.participants.length).toBeLessThanOrEqual(6);
    }
  });

  it('actually shuffles before seating: with rng 0, group membership differs from unshuffled round-robin', () => {
    // Without the shuffle, seatGroups round-robin would seat v1,v3,v5,v7 into
    // group 1 and v2,v4,v6 into group 2 (straight off the input order). With
    // the rng-0 rotation applied first, the membership is different even
    // though the sizes are the same - proving the shuffle step runs.
    const plan = planSplitGroups(people('v', 7), 111, () => 0);
    expect(plan[0].participants.map((p) => p.discordId)).toEqual(['v2', 'v4', 'v6', 'v1']);
    expect(plan[1].participants.map((p) => p.discordId)).toEqual(['v3', 'v5', 'v7']);
  });
});

describe('formatSplitSummary', () => {
  it('all groups started: says so, with a mention per thread', () => {
    const outcomes: GroupOutcome[] = [
      { groupNumber: '1', threadName: 'ZAO Fractal 1 - Group 1', threadId: 't1', started: true },
      { groupNumber: '2', threadName: 'ZAO Fractal 1 - Group 2', threadId: 't2', started: true },
    ];
    const summary = formatSplitSummary(outcomes, 2);
    expect(summary).toContain('Split into 2 groups.');
    expect(summary).toContain('Group 1: started in <#t1>.');
    expect(summary).toContain('Group 2: started in <#t2>.');
    expect(summary).not.toContain('NOT all');
  });

  it('a partial failure reports exactly which groups exist and which do not, without rollback language', () => {
    const outcomes: GroupOutcome[] = [
      { groupNumber: '1', threadName: 'ZAO Fractal 1 - Group 1', threadId: 't1', started: true },
      {
        groupNumber: '2',
        threadName: 'ZAO Fractal 1 - Group 2',
        threadId: 't2',
        started: false,
        error: 'startFractal failed: boom',
      },
    ];
    const summary = formatSplitSummary(outcomes, 3);
    expect(summary).toContain('NOT all of them started');
    expect(summary).toContain('Group 1: started in <#t1>.');
    expect(summary).toContain(
      'Group 2 (ZAO Fractal 1 - Group 2): FAILED - startFractal failed: boom.',
    );
    expect(summary).toContain('Thread <#t2> was created but not started.');
    expect(summary).toContain('Group 3: not attempted.');
  });

  it('a thread-creation failure (no threadId yet) is reported without a thread mention', () => {
    const outcomes: GroupOutcome[] = [
      {
        groupNumber: '1',
        threadName: 'ZAO Fractal 1 - Group 1',
        threadId: null,
        started: false,
        error: 'Missing Permissions',
      },
    ];
    const summary = formatSplitSummary(outcomes, 2);
    expect(summary).toContain('Group 1 (ZAO Fractal 1 - Group 1): FAILED - Missing Permissions.');
    expect(summary).not.toContain('was created but not started');
    expect(summary).toContain('Group 2: not attempted.');
  });
});
