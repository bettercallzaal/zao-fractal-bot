// Discord adapter for the Respect Game. The only layer that knows what an
// Interaction is. It translates interactions into action calls and action
// results into messages, and holds no game logic of its own.

import {
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Client,
  Events,
  MessageFlags,
  SlashCommandBuilder,
} from 'discord.js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { activeCandidates, type GameState, type Participant } from '../game/session.js';
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
    o.setName('group').setDescription('Group number, e.g. 1').setRequired(true),
  );

function votingPrompt(state: GameState, awaiting: number): string {
  return (
    `Level ${state.currentLevel}. Pick who contributed most.\n` +
    `The round resolves once all ${state.participants.length} have voted ` +
    `and someone has a majority. ${awaiting} still to vote.`
  );
}

async function handleStart(
  interaction: ChatInputCommandInteraction,
  supabase: SupabaseClient,
): Promise<void> {
  await interaction.deferReply();
  const meetingNumber = interaction.options.getInteger('meeting', true);
  const groupNumber = interaction.options.getString('group', true);

  const channel = interaction.channel;
  if (!channel || !channel.isThread()) {
    await interaction.editReply('Run /start inside the fractal thread.');
    return;
  }

  // Phase 1 takes the roster from who is in the thread. Voice-based capture
  // and group splitting are Phase 4 - see the spec's delivery order.
  const members = await channel.members.fetch();
  const participants: Participant[] = members
    .filter((m) => !m.user?.bot)
    .map((m) => ({
      discordId: m.id,
      displayName: m.user?.displayName ?? m.id,
      wallet: null,
    }));

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
      content: votingPrompt(started.state, participants.length),
      components: buildVotingRows(channel.id, activeCandidates(started.state)),
    });
  } catch (err) {
    // A failed write must be visible, not swallowed. This message existing at
    // all is the difference between this bot and the one that lost five months.
    await interaction.editReply(
      `Could not start the fractal - nothing was recorded. ${String(err)}`,
    );
  }
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
          votingPrompt(out.state, out.state.participants.length),
        components: buildVotingRows(parsed.threadId, activeCandidates(out.state)),
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
