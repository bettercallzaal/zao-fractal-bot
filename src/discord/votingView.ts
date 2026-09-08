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

/** Discord allows at most 5 buttons per row and 5 rows. A group is capped at 6
 * candidates including async entrants (MAX_GROUP_MEMBERS), so two rows always
 * suffice.
 *
 * Async entrants are marked twice over - a suffix and a different style -
 * because a voter picking between names has no other way to know that one of
 * them is not in the room. Spec 2026-09-02 section 7. */
export function buildVotingRows(
  threadId: string,
  candidates: Participant[],
  asyncEntrantIds: readonly string[] = [],
): ActionRowBuilder<ButtonBuilder>[] {
  const isAsync = new Set(asyncEntrantIds);
  const SUFFIX = ' (async)';
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];

  for (let i = 0; i < candidates.length; i += 5) {
    const row = new ActionRowBuilder<ButtonBuilder>();
    for (const c of candidates.slice(i, i + 5)) {
      const async = isAsync.has(c.discordId);
      // Trim the name, not the marker: an 80-character name must not push
      // "(async)" off the end of the label.
      const label = async
        ? c.displayName.slice(0, 80 - SUFFIX.length) + SUFFIX
        : c.displayName.slice(0, 80);
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(voteButtonId(threadId, c.discordId))
          .setLabel(label)
          .setStyle(async ? ButtonStyle.Secondary : ButtonStyle.Primary),
      );
    }
    rows.push(row);
  }
  return rows;
}
