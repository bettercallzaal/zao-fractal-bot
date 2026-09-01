// Vote buttons for one elimination round. Adapter layer: this file may import
// discord.js, and nothing under src/game or src/commands may.

import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import type { Participant } from '../game/session.js';

export const VOTE_BUTTON_PREFIX = 'fractal_vote';

/** customId encodes the thread and candidate so a click needs no lookup table:
 * fractal_vote:<threadId>:<candidateDiscordId>. Discord caps customId at 100
 * characters; two snowflakes plus the prefix fits inside that. */
export function voteButtonId(threadId: string, candidateDiscordId: string): string {
  return `${VOTE_BUTTON_PREFIX}:${threadId}:${candidateDiscordId}`;
}

export function parseVoteButtonId(
  customId: string,
): { threadId: string; candidateDiscordId: string } | null {
  const parts = customId.split(':');
  if (parts.length !== 3 || parts[0] !== VOTE_BUTTON_PREFIX) return null;
  return { threadId: parts[1], candidateDiscordId: parts[2] };
}

/** Discord allows at most 5 buttons per row and 5 rows. A fractal group is
 * capped at 6 members (MAX_GROUP_MEMBERS), so two rows always suffice. */
export function buildVotingRows(
  threadId: string,
  candidates: Participant[],
): ActionRowBuilder<ButtonBuilder>[] {
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  for (let i = 0; i < candidates.length; i += 5) {
    const row = new ActionRowBuilder<ButtonBuilder>();
    for (const c of candidates.slice(i, i + 5)) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(voteButtonId(threadId, c.discordId))
          .setLabel(c.displayName.slice(0, 80))
          .setStyle(ButtonStyle.Primary),
      );
    }
    rows.push(row);
  }
  return rows;
}
