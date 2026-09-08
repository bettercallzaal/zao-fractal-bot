// Discord adapter for the Respect Game. The only layer that knows what an
// Interaction is. It translates interactions into action calls and action
// results into messages, and holds no game logic of its own.

import {
  type AnyThreadChannel,
  type ButtonInteraction,
  ChannelType,
  type ChatInputCommandInteraction,
  type Client,
  Events,
  MessageFlags,
  SlashCommandBuilder,
} from 'discord.js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { MAX_GROUP_MEMBERS } from '@fractalbot/shared';
import { activeCandidates, voters, type GameState, type Participant } from '../game/session.js';
import { formatSplitSummary, needsSplit, planSplitGroups, type GroupOutcome } from '../game/split.js';
import { castFractalVote, startFractal } from '../commands/respectGame.js';
import { loadSessionByThread } from '../lib/gameRepo.js';
import { buildVotingRows, parseVoteButtonId } from './votingView.js';

/** In-flight state per thread. The database is the record; this is a cache in
 * front of it so a vote does not re-read the whole session. On a restart this
 * map is empty and the thread is rehydrated from gameRepo. */
const live = new Map<string, { sessionId: string; state: GameState }>();

export const startCommand = new SlashCommandBuilder()
  .setName('start')
  .setDescription('Start a fractal in this thread')
  .addIntegerOption((o) =>
    o.setName('meeting').setDescription('Fractal number, e.g. 111').setRequired(true),
  )
  .addStringOption((o) =>
    o
      .setName('group')
      .setDescription('Group number, e.g. 1. Ignored and reassigned if the thread splits.')
      .setRequired(false),
  );

export function votingPrompt(state: GameState, awaiting: number): string {
  // voters(state), not participants: with 4 present and 2 async this used to
  // read "all 6 have voted" while the round resolved at 4.
  const voterCount = voters(state).length;
  const asyncCount = state.asyncEntrantIds.length;
  const asyncNote =
    asyncCount > 0
      ? ` ${asyncCount} async ${asyncCount === 1 ? 'entrant is' : 'entrants are'} ranked but do not vote.`
      : '';
  return (
    `Level ${state.currentLevel}. Pick who contributed most.\n` +
    `The round resolves once all ${voterCount} present have voted ` +
    `and someone has a majority. ${awaiting} still to vote.${asyncNote}`
  );
}

async function handleStart(
  interaction: ChatInputCommandInteraction,
  supabase: SupabaseClient,
): Promise<void> {
  await interaction.deferReply();
  const meetingNumber = interaction.options.getInteger('meeting', true);
  const groupOption = interaction.options.getString('group');

  const channel = interaction.channel;
  if (!channel || !channel.isThread()) {
    await interaction.editReply('Run /start inside the fractal thread.');
    return;
  }

  // Phase 1 takes the roster from who is in the thread. Voice-based capture
  // is Phase 4 - see the spec's delivery order. Group splitting (7+ people)
  // is handled below by handleStartSplit.
  const members = await channel.members.fetch();
  const participants: Participant[] = members
    .filter((m) => !m.user?.bot)
    .map((m) => ({
      discordId: m.id,
      displayName: m.user?.displayName ?? m.id,
      wallet: null,
    }));

  if (needsSplit(participants.length)) {
    await handleStartSplit(interaction, channel, meetingNumber, participants, supabase);
    return;
  }

  // Six or fewer: the common case, unchanged from before splitting existed.
  // `group` used to be required; now it defaults to '1' when omitted.
  const groupNumber = groupOption ?? '1';

  try {
    const started = await startFractal(
      {
        threadId: channel.id,
        guildId: interaction.guildId ?? '',
        facilitatorDiscordId: interaction.user.id,
        name: `ZAO Fractal ${meetingNumber} - Group ${groupNumber}`,
        meetingNumber,
        groupNumber,
        participants,
      },
      { supabase },
    );
    live.set(channel.id, { sessionId: started.sessionId, state: started.state });

    await interaction.editReply(
      `Fractal ${meetingNumber}, group ${groupNumber}. ${participants.length} members, ` +
        `${started.votesNeeded} votes to take a level.`,
    );
    await channel.send({
      content: votingPrompt(started.state, voters(started.state).length),
      components: buildVotingRows(
        channel.id,
        activeCandidates(started.state),
        started.state.asyncEntrantIds,
      ),
    });
  } catch (err) {
    // A failed write must be visible, not swallowed. This message existing at
    // all is the difference between this bot and the one that lost five months.
    await interaction.editReply(
      `Could not start the fractal - nothing was recorded. ${String(err)}`,
    );
  }
}

/** More than MAX_GROUP_MEMBERS people in the thread. Discord does not allow a
 * thread inside a thread, so each group gets its own thread in the PARENT
 * channel - never inside `channel` itself. Sessions are keyed by thread id
 * end to end (fractal_sessions.thread_id, loadSessionByThread, the vote
 * button customId, the `live` map), so two groups sharing a thread would
 * collide on all four; a fresh thread per group is what keeps them separate.
 *
 * Groups run in order. If a group fails partway through - thread creation,
 * adding members, or starting the session - later groups in the plan are not
 * attempted, because nothing here overwrites the trail of what already
 * happened. Whatever thread was already created is left exactly as it is:
 * deleting it is worse than reporting the truth. See src/game/split.ts for
 * the pure allocation, naming and summary-formatting logic this calls into. */
async function handleStartSplit(
  interaction: ChatInputCommandInteraction,
  channel: AnyThreadChannel,
  meetingNumber: number,
  participants: Participant[],
  supabase: SupabaseClient,
): Promise<void> {
  const parent = channel.parent;
  if (!parent || parent.type !== ChannelType.GuildText) {
    await interaction.editReply(
      `This group needs to split into ${Math.ceil(
        participants.length / MAX_GROUP_MEMBERS,
      )}+ threads (${participants.length} people, cap is ${MAX_GROUP_MEMBERS}), but the ` +
        'parent channel is not a text channel that supports creating threads. Nothing was started.',
    );
    return;
  }

  const plan = planSplitGroups(participants, meetingNumber);
  const outcomes: GroupOutcome[] = [];

  for (const group of plan) {
    let threadId: string | null = null;
    try {
      const thread = await parent.threads.create({
        name: group.threadName,
        type: ChannelType.PublicThread,
        reason: `Fractal ${meetingNumber} split from thread ${channel.id}`,
      });
      threadId = thread.id;

      for (const p of group.participants) {
        await thread.members.add(p.discordId);
      }

      const started = await startFractal(
        {
          threadId: thread.id,
          guildId: interaction.guildId ?? '',
          facilitatorDiscordId: interaction.user.id,
          name: group.threadName,
          meetingNumber,
          groupNumber: group.groupNumber,
          participants: group.participants,
        },
        { supabase },
      );
      live.set(thread.id, { sessionId: started.sessionId, state: started.state });

      await thread.send({
        content: votingPrompt(started.state, voters(started.state).length),
        components: buildVotingRows(
          thread.id,
          activeCandidates(started.state),
          started.state.asyncEntrantIds,
        ),
      });

      outcomes.push({
        groupNumber: group.groupNumber,
        threadName: group.threadName,
        threadId,
        started: true,
      });
    } catch (err) {
      outcomes.push({
        groupNumber: group.groupNumber,
        threadName: group.threadName,
        threadId,
        started: false,
        error: String(err),
      });
      // Stop here. A later group's outcome would be a guess - report exactly
      // what happened up to this point and nothing more.
      break;
    }
  }

  await interaction.editReply(formatSplitSummary(outcomes, plan.length));
}

async function handleVote(
  interaction: ButtonInteraction,
  supabase: SupabaseClient,
): Promise<void> {
  const parsed = parseVoteButtonId(interaction.customId);
  if (!parsed) return;

  let entry = live.get(parsed.threadId);
  if (!entry) {
    // Restart recovery. The database is the record, so a fractal survives the
    // process dying mid-round - spec section 2, moved into Phase 1 by Zaal on
    // 2026-09-01 because a crash during a live call should not cost the round.
    try {
      const restored = await loadSessionByThread(supabase, parsed.threadId);
      if (!restored || restored.state.status !== 'active') {
        await interaction.reply({
          content: 'That fractal is not open. Ask the facilitator to run /start.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      entry = { sessionId: restored.sessionId, state: restored.state };
      live.set(parsed.threadId, entry);
    } catch (err) {
      await interaction.reply({
        content: `Could not reload that fractal, so your vote was NOT recorded. ${String(err)}`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
  }

  try {
    const out = await castFractalVote(
      {
        sessionId: entry.sessionId,
        state: entry.state,
        voterDiscordId: interaction.user.id,
        candidateDiscordId: parsed.candidateDiscordId,
      },
      { supabase },
    );

    if (!out.accepted) {
      const why =
        out.reason === 'not_participant'
          ? 'You are not in this group.'
          : out.reason === 'not_candidate'
            ? 'That member already has a level.'
            : 'Voting is not open.';
      await interaction.reply({ content: why, flags: MessageFlags.Ephemeral });
      return;
    }

    live.set(parsed.threadId, { sessionId: entry.sessionId, state: out.state });

    // Votes are public. Spec section 7: two years of the game have run this
    // way and the fractal's premise is peers openly accounting for
    // contribution.
    const name = `<@${interaction.user.id}>`;
    const target = `<@${parsed.candidateDiscordId}>`;
    const tail =
      out.awaitingVoters.length > 0
        ? ` (${out.awaitingVoters.length} still to vote)`
        : out.roundWinnerId
          ? ''
          : ' (everyone has voted, no majority yet - keep talking)';
    await interaction.reply({
      content:
        (out.previousCandidateId
          ? `${name} changed vote to ${target}`
          : `${name} voted for ${target}`) + tail,
    });

    const channel = interaction.channel;
    if (!channel?.isSendable()) return;

    if (out.sessionComplete && out.ranking) {
      const lines = out.ranking.map(
        (r) => `${r.rank}. <@${r.discordId}> - Level ${r.level}, ${r.respectPoints} Respect`,
      );
      await channel.send(
        `Fractal complete and recorded.\n${lines.join('\n')}\n\n` +
          'Onchain submission lands in a later release. Results are saved.',
      );
      live.delete(parsed.threadId);
      return;
    }

    if (out.roundWinnerId) {
      await channel.send({
        content:
          `Level ${out.state.currentLevel + 1}: <@${out.roundWinnerId}>.\n\n` +
          votingPrompt(out.state, voters(out.state).length),
        components: buildVotingRows(
          parsed.threadId,
          activeCandidates(out.state),
          out.state.asyncEntrantIds,
        ),
      });
    }
  } catch (err) {
    await interaction.reply({
      content: `Your vote was NOT recorded and the round has not advanced. ${String(err)}`,
    });
  }
}

export function registerGameCommands(client: Client, supabase: SupabaseClient): void {
  client.on(Events.InteractionCreate, async (interaction) => {
    if (interaction.isChatInputCommand() && interaction.commandName === 'start') {
      await handleStart(interaction, supabase);
      return;
    }
    if (interaction.isButton()) {
      await handleVote(interaction, supabase);
    }
  });
}
