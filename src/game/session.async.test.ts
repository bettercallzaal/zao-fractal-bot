import { describe, expect, it } from 'vitest';
import {
  activeCandidates,
  asyncEntrants,
  awaitingVoters,
  castVote,
  type Participant,
  startSession,
  voters,
  votesNeeded,
} from './session.js';

const person = (id: string): Participant => ({
  discordId: id,
  displayName: `Member ${id}`,
  wallet: null,
});

/** 4 present, 2 async - the shape spec 3.1 row 4 produces. */
const mixed = () =>
  startSession({
    threadId: 't',
    meetingNumber: 92,
    groupNumber: '1',
    participants: ['v1', 'v2', 'v3', 'v4', 'a1', 'a2'].map(person),
    asyncEntrantIds: ['a1', 'a2'],
  });

describe('async entrants are votable-for and never voted-with', () => {
  it('votesNeeded counts voters only', () => {
    // 4 voters -> strict majority 3. Counting all 6 candidates would say 4.
    expect(votesNeeded(mixed())).toBe(3);
  });

  it('an async entrant never appears in awaitingVoters', () => {
    expect(awaitingVoters(mixed()).sort()).toEqual(['v1', 'v2', 'v3', 'v4']);
  });

  it('an async entrant is a candidate', () => {
    expect(activeCandidates(mixed()).map((p) => p.discordId)).toContain('a1');
  });

  it('voters and asyncEntrants partition participants', () => {
    const s = mixed();
    expect(voters(s).map((p) => p.discordId)).toEqual(['v1', 'v2', 'v3', 'v4']);
    expect(asyncEntrants(s).map((p) => p.discordId)).toEqual(['a1', 'a2']);
  });

  it('rejects a vote cast BY an async entrant', () => {
    const out = castVote(mixed(), 'a1', 'v1');
    expect(out.accepted).toBe(false);
    expect(out.reason).toBe('not_participant');
  });

  it('an async entrant can win a level on the voters alone', () => {
    let s = mixed();
    for (const v of ['v1', 'v2', 'v3']) {
      s = castVote(s, v, 'a1').state;
    }
    const out = castVote(s, 'v4', 'a1');
    expect(out.roundWinnerId).toBe('a1');
  });

  it('the round resolves without the async entrants ever voting', () => {
    let s = mixed();
    for (const v of ['v1', 'v2', 'v3']) {
      s = castVote(s, v, 'v1').state;
    }
    // All four voters have now spoken; a1 and a2 never will.
    const out = castVote(s, 'v4', 'v1');
    expect(out.awaitingVoters).toEqual([]);
    expect(out.roundWinnerId).toBe('v1');
  });

  it('defaults to no async entrants, so existing callers are unaffected', () => {
    const s = startSession({
      threadId: 't',
      meetingNumber: 92,
      groupNumber: '1',
      participants: ['v1', 'v2', 'v3'].map(person),
    });
    expect(s.asyncEntrantIds).toEqual([]);
    expect(votesNeeded(s)).toBe(2);
  });

  it('throws when async entrants are present and voters are below the floor', () => {
    expect(() =>
      startSession({
        threadId: 't',
        meetingNumber: 92,
        groupNumber: '1',
        participants: ['v1', 'v2', 'a1'].map(person),
        asyncEntrantIds: ['a1'],
      }),
    ).toThrow(/at least 3 voters/);
  });

  it('throws when an async id is not among the participants', () => {
    expect(() =>
      startSession({
        threadId: 't',
        meetingNumber: 92,
        groupNumber: '1',
        participants: ['v1', 'v2', 'v3'].map(person),
        asyncEntrantIds: ['ghost'],
      }),
    ).toThrow(/not a participant/);
  });

  it('a round still resolves normally with 4 voters + 2 async (guards against over-filtering)', () => {
    let s = mixed();
    for (const v of ['v1', 'v2', 'v3']) {
      s = castVote(s, v, 'v2').state;
    }
    const out = castVote(s, 'v4', 'v2');
    expect(out.roundWinnerId).toBe('v2');
  });

  it('does not count a ballot keyed to an async entrant toward the threshold', () => {
    // 4 voters (v1-v4) + 1 async (a1). votesNeeded = majorityThreshold(4) = 3.
    const base = startSession({
      threadId: 't',
      meetingNumber: 92,
      groupNumber: '1',
      participants: ['v1', 'v2', 'v3', 'v4', 'a1'].map(person),
      asyncEntrantIds: ['a1'],
    });
    // A rehydrated session could carry a ghost ballot keyed to an async
    // entrant - castVote itself can never insert one. v1 has 2 real votes
    // (v1, v2) plus the ghost, which would total 3 - exactly the threshold -
    // if the ghost were counted. It must not be: 2 real votes is short of 3.
    const state = {
      ...base,
      votes: { a1: 'v1', v1: 'v1', v2: 'v1', v3: 'v2' },
    };
    const out = castVote(state, 'v4', 'v2');
    expect(out.awaitingVoters).toEqual([]);
    expect(out.roundWinnerId).toBeNull();
  });

  it('throws when candidates exceed MAX_GROUP_MEMBERS', () => {
    expect(() =>
      startSession({
        threadId: 't',
        meetingNumber: 92,
        groupNumber: '1',
        participants: ['v1', 'v2', 'v3', 'v4', 'v5', 'a1', 'a2'].map(person),
        asyncEntrantIds: ['a1', 'a2'],
      }),
    ).toThrow(/at most 6 candidates/);
  });

  it('accepts exactly MAX_GROUP_MEMBERS candidates', () => {
    expect(() =>
      startSession({
        threadId: 't',
        meetingNumber: 92,
        groupNumber: '1',
        participants: ['v1', 'v2', 'v3', 'v4', 'a1', 'a2'].map(person),
        asyncEntrantIds: ['a1', 'a2'],
      }),
    ).not.toThrow();
  });
});
