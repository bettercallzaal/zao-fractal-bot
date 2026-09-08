import { describe, expect, it } from 'vitest';
import { startSession, type Participant } from '../game/session.js';
import { registerGameCommands, startCommand, votingPrompt } from './gameCommands.js';
import { fakeDiscord } from './testing/fakeDiscord.js';
import { fakeSupabase } from '../lib/testing/fakeSupabase.js';

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

describe('startCommand', () => {
  it('the group option is optional, so a 7+ person thread does not need one supplied', () => {
    // Splitting assigns group numbers itself (1..N); a facilitator running
    // /start on a large thread should not have to pick one that gets
    // overridden anyway.
    const json = startCommand.toJSON();
    const groupOption = json.options?.find((o) => o.name === 'group');
    expect(groupOption).toBeDefined();
    expect(groupOption?.required).toBeFalsy();
  });

  it('the meeting option stays required', () => {
    const json = startCommand.toJSON();
    const meetingOption = json.options?.find((o) => o.name === 'meeting');
    expect(meetingOption?.required).toBe(true);
  });
});

// These drive handleStart and handleVote (both unexported) through the real
// public entry point, registerGameCommands - see src/discord/testing/
// fakeDiscord.ts's header for what is genuinely real here (Client,
// Collection) versus a narrow cast (interactions, threads). Before this file,
// nothing under here had ever executed: the split path landed today with no
// way to run it at all.
const sessionInsertOk = { 'fractal_sessions.insert': { data: { id: 'session-1' }, error: null } };

describe('handleStart via registerGameCommands', () => {
  it('6 or fewer participants: one session, in the current thread, no threads created', async () => {
    const discord = fakeDiscord();
    const sb = fakeSupabase({ results: sessionInsertOk });

    const members = [
      { id: 'v1', displayName: 'User v1' },
      { id: 'v2', displayName: 'User v2' },
      { id: 'v3', displayName: 'User v3' },
      { id: 'v4', displayName: 'User v4' },
      { id: 'v5', displayName: 'User v5' },
      { id: 'v6', displayName: 'User v6' },
      // Exercises the bot filter, not just assumes it.
      { id: 'bot1', displayName: 'A Bot', bot: true },
    ];
    const thread = discord.makeThread({ id: 'thread-main', members });
    const interaction = discord.makeChatInputInteraction({ meetingNumber: 111, channel: thread });

    const client = discord.makeClient();
    registerGameCommands(client, sb as never);
    await discord.dispatch(client, interaction);

    expect(discord.calls.filter((c) => c.type === 'threadCreate')).toHaveLength(0);

    const sends = discord.calls.filter((c) => c.type === 'send');
    expect(sends).toHaveLength(1);
    expect(sends[0].threadId).toBe('thread-main');

    const editReplies = discord.calls.filter((c) => c.type === 'editReply');
    expect(editReplies).toHaveLength(1);
    expect(String(editReplies[0].content)).toContain('6 members');

    const roster = sb.calls.find((c) => c.table === 'discord_roster')?.payload as {
      discord_id: string;
    }[];
    expect(roster).toHaveLength(6);
    expect(roster.some((r) => r.discord_id === 'bot1')).toBe(false);
  });

  it('7 participants: splits into two threads in the parent channel, 4 and 3 members', async () => {
    const discord = fakeDiscord();
    const sb = fakeSupabase({ results: sessionInsertOk });

    const parent = discord.makeParentChannel({ id: 'parent-1' });
    const members = [
      { id: 'v1' },
      { id: 'v2' },
      { id: 'v3' },
      { id: 'v4' },
      { id: 'v5' },
      { id: 'v6' },
      { id: 'v7' },
      { id: 'bot1', bot: true },
    ];
    const thread = discord.makeThread({ id: 'thread-orig', members, parent });
    const interaction = discord.makeChatInputInteraction({ meetingNumber: 222, channel: thread });

    const client = discord.makeClient();
    registerGameCommands(client, sb as never);
    await discord.dispatch(client, interaction);

    const creates = discord.calls.filter((c) => c.type === 'threadCreate');
    expect(creates).toHaveLength(2);
    expect(creates[0].name).toBe('ZAO Fractal 222 - Group 1');
    expect(creates[1].name).toBe('ZAO Fractal 222 - Group 2');

    const group1ThreadId = creates[0].threadId as string;
    const group2ThreadId = creates[1].threadId as string;
    const addsFor = (threadId: string) =>
      discord.calls.filter((c) => c.type === 'memberAdd' && c.threadId === threadId);
    expect(addsFor(group1ThreadId)).toHaveLength(4);
    expect(addsFor(group2ThreadId)).toHaveLength(3);

    const sendsFor = (threadId: string) =>
      discord.calls.filter((c) => c.type === 'send' && c.threadId === threadId);
    expect(sendsFor(group1ThreadId)).toHaveLength(1);
    expect(sendsFor(group2ThreadId)).toHaveLength(1);

    // Each group is its own session, keyed by its own thread.
    const sessionInserts = sb.calls.filter(
      (c) => c.table === 'fractal_sessions' && c.op === 'insert',
    );
    expect(sessionInserts).toHaveLength(2);
    const threadIds = sessionInserts.map((c) => (c.payload as { thread_id: string }).thread_id);
    expect(new Set(threadIds)).toEqual(new Set([group1ThreadId, group2ThreadId]));

    const editReplies = discord.calls.filter((c) => c.type === 'editReply');
    expect(editReplies).toHaveLength(1);
    const summary = String(editReplies[0].content);
    expect(summary).toContain('Split into 2 groups.');
    expect(summary).toContain(`Group 1: started in <#${group1ThreadId}>.`);
    expect(summary).toContain(`Group 2: started in <#${group2ThreadId}>.`);
  });

  it('not run inside a thread: replies with guidance and creates nothing', async () => {
    const discord = fakeDiscord();
    const sb = fakeSupabase();

    const channel = discord.makeNonThreadChannel();
    const interaction = discord.makeChatInputInteraction({ meetingNumber: 111, channel });

    const client = discord.makeClient();
    registerGameCommands(client, sb as never);
    await discord.dispatch(client, interaction);

    const editReplies = discord.calls.filter((c) => c.type === 'editReply');
    expect(editReplies).toHaveLength(1);
    expect(editReplies[0].content).toBe('Run /start inside the fractal thread.');
    expect(discord.calls.filter((c) => c.type === 'threadCreate')).toHaveLength(0);
    expect(sb.calls).toHaveLength(0);
  });

  it('a failure partway through a split names which groups exist and which do not, and leaves the created thread alone', async () => {
    const discord = fakeDiscord();
    const sb = fakeSupabase({ results: sessionInsertOk });

    const parent = discord.makeParentChannel({
      id: 'parent-1',
      createOutcomes: { 1: { fail: new Error('discord is down') } },
    });
    const members = [
      { id: 'v1' },
      { id: 'v2' },
      { id: 'v3' },
      { id: 'v4' },
      { id: 'v5' },
      { id: 'v6' },
      { id: 'v7' },
    ];
    const thread = discord.makeThread({ id: 'thread-orig', members, parent });
    const interaction = discord.makeChatInputInteraction({ meetingNumber: 333, channel: thread });

    const client = discord.makeClient();
    registerGameCommands(client, sb as never);
    await discord.dispatch(client, interaction);

    const creates = discord.calls.filter((c) => c.type === 'threadCreate');
    expect(creates).toHaveLength(2);
    expect(creates[0].ok).toBe(true);
    expect(creates[1].ok).toBe(false);

    const group1ThreadId = creates[0].threadId as string;
    expect(
      discord.calls.filter((c) => c.type === 'memberAdd' && c.threadId === group1ThreadId),
    ).toHaveLength(4);
    expect(
      discord.calls.filter((c) => c.type === 'send' && c.threadId === group1ThreadId),
    ).toHaveLength(1);

    // The fake harness has no delete concept at all for a thread - there is
    // nothing production code could have called even if it tried to roll
    // group 1's thread back.
    expect(discord.calls.some((c) => c.type.toLowerCase().includes('delete'))).toBe(false);

    const editReplies = discord.calls.filter((c) => c.type === 'editReply');
    expect(editReplies).toHaveLength(1);
    const summary = String(editReplies[0].content);
    expect(summary).toContain('NOT all of them started');
    expect(summary).toContain(`Group 1: started in <#${group1ThreadId}>.`);
    expect(summary).toContain(
      'Group 2 (ZAO Fractal 333 - Group 2): FAILED - Error: discord is down.',
    );

    // Only the group that actually started ever wrote a session row.
    expect(
      sb.calls.filter((c) => c.table === 'fractal_sessions' && c.op === 'insert'),
    ).toHaveLength(1);
  });
});

describe('handleVote via registerGameCommands', () => {
  it('a vote is recorded and, once everyone has voted, the round advances', async () => {
    const discord = fakeDiscord();
    const sb = fakeSupabase({
      results: {
        ...sessionInsertOk,
        'discord_fractal_rounds.select': { data: { id: 'round-1' }, error: null },
      },
    });

    const members = [{ id: 'v1' }, { id: 'v2' }, { id: 'v3' }];
    const thread = discord.makeThread({ id: 'thread-vote', members });
    const startInteraction = discord.makeChatInputInteraction({
      meetingNumber: 111,
      channel: thread,
    });

    const client = discord.makeClient();
    registerGameCommands(client, sb as never);
    await discord.dispatch(client, startInteraction);

    const vote = (voterId: string, candidateId: string) =>
      discord.dispatch(
        client,
        discord.makeButtonInteraction({
          customId: `fractal_vote:thread-vote:${candidateId}`,
          userId: voterId,
          channel: thread,
        }),
      );

    // v1 -> v3, v2 -> v3: two of three votes in, consensus rule holds the
    // round open until everyone has spoken, majority or not.
    await vote('v1', 'v3');
    await vote('v2', 'v3');
    expect(discord.calls.filter((c) => c.type === 'reply')).toHaveLength(2);
    expect(
      discord.calls.filter((c) => c.type === 'send' && c.threadId === 'thread-vote'),
    ).toHaveLength(1); // still just the /start prompt - no round has resolved

    // v3 -> v1, the last voter: now everyone has spoken, and v3 has 2 of 3 -
    // a strict majority - so the round advances.
    await vote('v3', 'v1');

    const replies = discord.calls.filter((c) => c.type === 'reply');
    expect(replies).toHaveLength(3);
    const lastReplyContent = (replies[2].payload as { content: string }).content;
    expect(lastReplyContent).toBe('<@v3> voted for <@v1>');

    const sends = discord.calls.filter((c) => c.type === 'send' && c.threadId === 'thread-vote');
    expect(sends).toHaveLength(2); // the /start prompt, then the round-advance message
    const advanceContent = (sends[1].payload as { content: string }).content;
    expect(advanceContent).toContain('Level 6: <@v3>');
    expect(advanceContent).toContain('Level 5.');

    const voteWrites = sb.calls.filter(
      (c) => c.table === 'discord_fractal_votes' && c.op === 'upsert',
    );
    expect(voteWrites).toHaveLength(3);
    const roundResolutions = sb.calls.filter(
      (c) => c.table === 'discord_fractal_rounds' && c.op === 'update',
    );
    expect(roundResolutions).toHaveLength(1);
  });
});
