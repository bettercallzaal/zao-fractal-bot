/** Discord presence collectors - the thin, side-effecting layer that turns
 * live Discord state into PresenceSignal[] for rosterCapture. Kept minimal and
 * separate from the pure merge/resolve logic (rosterCapture.ts) so the hard-to-
 * unit-test discord.js reads stay small.
 *
 * Intents required (declared in index.ts):
 *   - voice     -> GuildVoiceStates + GuildMembers
 *   - text      -> GuildMessages (reads message *authors*, not content, so the
 *                  privileged MessageContent intent is NOT needed)
 *   - reaction  -> GuildMessageReactions
 *
 * Every collector is defensive: a missing channel / message / permission
 * yields an empty list rather than throwing, so one dead source never sinks a
 * whole capture. The caller logs which sources returned nothing.
 */

import type { Client } from 'discord.js';
import { ChannelType } from 'discord.js';
import type { PresenceSignal } from './rosterCapture.js';

/** Members currently sitting in a voice channel. The primary presence source. */
export async function collectVoicePresence(
  client: Client,
  guildId: string,
  voiceChannelId: string,
): Promise<PresenceSignal[]> {
  const guild = await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) return [];
  const channel = await guild.channels.fetch(voiceChannelId).catch(() => null);
  if (!channel || (channel.type !== ChannelType.GuildVoice && channel.type !== ChannelType.GuildStageVoice)) {
    return [];
  }
  return [...channel.members.values()].map((m) => ({
    discordId: m.id,
    displayName: m.displayName ?? m.user.username,
    source: 'voice' as const,
  }));
}

/** Distinct authors of recent messages in a text channel, within `lookbackMs`.
 * "Active in the room" presence. Reads only message.author, so no
 * MessageContent intent. Bots are excluded. */
export async function collectTextPresence(
  client: Client,
  guildId: string,
  textChannelId: string,
  lookbackMs: number,
  nowMs: number,
): Promise<PresenceSignal[]> {
  const guild = await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) return [];
  const channel = await guild.channels.fetch(textChannelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return [];

  const messages = await channel.messages.fetch({ limit: 100 }).catch(() => null);
  if (!messages) return [];

  const cutoff = nowMs - lookbackMs;
  const seen = new Set<string>();
  const signals: PresenceSignal[] = [];
  for (const msg of messages.values()) {
    if (msg.createdTimestamp < cutoff) continue;
    if (msg.author.bot) continue;
    if (seen.has(msg.author.id)) continue;
    seen.add(msg.author.id);
    const member = msg.member;
    signals.push({
      discordId: msg.author.id,
      displayName: member?.displayName ?? msg.author.username,
      source: 'text',
    });
  }
  return signals;
}

/** Users who reacted to an attendance post (any emoji). "I'm here" presence. */
export async function collectReactionPresence(
  client: Client,
  guildId: string,
  channelId: string,
  messageId: string,
): Promise<PresenceSignal[]> {
  const guild = await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) return [];
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return [];
  const message = await channel.messages.fetch(messageId).catch(() => null);
  if (!message) return [];

  const seen = new Set<string>();
  const signals: PresenceSignal[] = [];
  for (const reaction of message.reactions.cache.values()) {
    const users = await reaction.users.fetch().catch(() => null);
    if (!users) continue;
    for (const user of users.values()) {
      if (user.bot) continue;
      if (seen.has(user.id)) continue;
      seen.add(user.id);
      const member = await guild.members.fetch(user.id).catch(() => null);
      signals.push({
        discordId: user.id,
        displayName: member?.displayName ?? user.username,
        source: 'reaction',
      });
    }
  }
  return signals;
}
