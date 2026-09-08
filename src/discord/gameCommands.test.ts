import { describe, expect, it } from 'vitest';
import { startSession, type Participant } from '../game/session.js';
import { votingPrompt } from './gameCommands.js';

function participant(id: string): Participant {
  return { discordId: id, displayName: `User ${id}`, wallet: null };
}

describe('votingPrompt', () => {
  it('counts voters, not participants: the bug this task fixes', () => {
    // 4 present voters + 2 async entrants (the largest mixed group the
    // MAX_GROUP_MEMBERS cap of 6 allows). This used to read "all 6 have
    // voted" using participants.length, while the round actually resolves
    // once the 4 voters have voted.
    const participants = ['v1', 'v2', 'v3', 'v4', 'a1', 'a2'].map(participant);
    const state = startSession({
      threadId: 't1',
      meetingNumber: 1,
      groupNumber: '1',
      participants,
      asyncEntrantIds: ['a1', 'a2'],
    });

    const prompt = votingPrompt(state, 2);

    expect(prompt).toContain('all 4 present');
    expect(prompt).not.toContain('all 6');
  });

  it('omits the async note entirely when there are no async entrants', () => {
    const participants = ['v1', 'v2'].map(participant);
    const state = startSession({
      threadId: 't1',
      meetingNumber: 1,
      groupNumber: '1',
      participants,
    });

    const prompt = votingPrompt(state, 1);

    expect(prompt).not.toContain('async');
  });

  it('uses singular wording for exactly one async entrant', () => {
    const participants = ['v1', 'v2', 'v3', 'a1'].map(participant);
    const state = startSession({
      threadId: 't1',
      meetingNumber: 1,
      groupNumber: '1',
      participants,
      asyncEntrantIds: ['a1'],
    });

    const prompt = votingPrompt(state, 0);

    expect(prompt).toContain('1 async entrant is ranked but do not vote.');
  });

  it('uses plural wording for more than one async entrant', () => {
    const participants = ['v1', 'v2', 'v3', 'v4', 'a1', 'a2'].map(participant);
    const state = startSession({
      threadId: 't1',
      meetingNumber: 1,
      groupNumber: '1',
      participants,
      asyncEntrantIds: ['a1', 'a2'],
    });

    const prompt = votingPrompt(state, 3);

    expect(prompt).toContain('2 async entrants are ranked but do not vote.');
  });

  it('renders the awaiting count as given', () => {
    const participants = ['v1', 'v2'].map(participant);
    const state = startSession({
      threadId: 't1',
      meetingNumber: 1,
      groupNumber: '1',
      participants,
    });

    expect(votingPrompt(state, 5)).toContain('5 still to vote');
  });
});
