/** Roster capture - pure merge + resolution logic for "who is present in a
 * fractal session". Presence signals come from several Discord sources (voice
 * channel members, recently-active text authors, reactors on an attendance
 * post, plus a manual operator list). This module merges those signals and
 * resolves each present person to a canonical Respect member, so a fractal can
 * be run without hand-typing the roster.
 *
 * Kept pure (no DB, no discord.js) so it stays trivially testable, same
 * convention as nameResolver + distributeIntoGroups. The Discord reads live in
 * discordPresence.ts; the DB reads + writes live in the captureRoster action.
 *
 * Resolution tiers, best first:
 *   1. registry  - the Discord user is already bound (users.discord_id ->
 *      primary_wallet), so we match the Respect member by wallet. No guessing.
 *   2. exact / fuzzy - unbound user, resolved by display name via matchMember.
 *   3. ambiguous - multiple plausible members, needs a human pick.
 *   4. none      - nobody plausible, needs a /register binding.
 */

import { type Match, type Member, matchMember, normalizeName } from './nameResolver.js';

export type PresenceSource = 'voice' | 'text' | 'reaction' | 'manual';

/** One raw presence observation from a single source. `discordId` is null for
 * manual name-only entries (an operator typed a name, not a mention). */
export interface PresenceSignal {
  discordId: string | null;
  displayName: string;
  source: PresenceSource;
}

/** A row from the ZAO OS `users` table - the persistent Discord<->Respect
 * binding (the registry). A present user whose discord_id is here is resolved
 * by wallet, bypassing name fuzzing entirely. */
export interface RegistryEntry {
  discord_id: string;
  primary_wallet: string | null;
  display_name: string | null;
  fid: number | null;
}

export type RosterConfidence = 'registry' | 'exact' | 'fuzzy' | 'ambiguous' | 'none';

export interface ResolvedMember {
  name: string | null;
  wallet: string | null;
  fid: number | null;
}

export interface RosterEntry {
  discordId: string | null;
  displayName: string;
  sources: PresenceSource[]; // every source that observed this person
  confidence: RosterConfidence;
  member: ResolvedMember | null; // set for registry / exact / fuzzy
  candidates?: ResolvedMember[]; // set for ambiguous
}

export interface RosterResult {
  entries: RosterEntry[]; // every present person, in stable order
  matched: RosterEntry[]; // registry / exact / fuzzy - safe to score
  ambiguous: RosterEntry[]; // needs a human pick
  unmatched: RosterEntry[]; // needs a /register binding
}

interface MergedSignal {
  discordId: string | null;
  displayName: string;
  sources: PresenceSource[];
}

/** Merge presence signals from every source into one entry per person,
 * deduping and unioning the sources. People with a Discord id dedupe on that
 * id; manual name-only entries dedupe on their normalized name. A person seen
 * in voice AND reacting collapses to a single entry with sources
 * ['voice','reaction']. Order is stable: first-seen wins. */
export function mergeSignals(signalLists: PresenceSignal[][]): MergedSignal[] {
  const byKey = new Map<string, MergedSignal>();
  const order: string[] = [];

  for (const list of signalLists) {
    for (const sig of list) {
      const key = sig.discordId ? `id:${sig.discordId}` : `name:${normalizeName(sig.displayName)}`;
      // Skip manual/name entries that normalize to nothing (pure emoji, etc.).
      if (!sig.discordId && !normalizeName(sig.displayName)) continue;

      const existing = byKey.get(key);
      if (existing) {
        if (!existing.sources.includes(sig.source)) existing.sources.push(sig.source);
        // Prefer a non-empty display name if the first one was blank.
        if (!existing.displayName && sig.displayName) existing.displayName = sig.displayName;
      } else {
        byKey.set(key, {
          discordId: sig.discordId,
          displayName: sig.displayName,
          sources: [sig.source],
        });
        order.push(key);
      }
    }
  }

  return order.map((k) => byKey.get(k) as MergedSignal);
}

function toResolved(m: Member): ResolvedMember {
  return { name: m.name, wallet: m.wallet_address, fid: m.fid };
}

/** Resolve merged presence to Respect members. Registry hits (by discord_id ->
 * wallet) win; everyone else falls through to name matching. */
export function buildRoster(
  signalLists: PresenceSignal[][],
  members: Member[],
  registry: RegistryEntry[],
): RosterResult {
  const registryById = new Map(registry.map((r) => [r.discord_id, r]));
  // Index Respect members by lowercased wallet for the registry->member hop.
  const memberByWallet = new Map<string, Member>();
  for (const m of members) {
    if (m.wallet_address) memberByWallet.set(m.wallet_address.toLowerCase(), m);
  }

  const merged = mergeSignals(signalLists);
  const entries: RosterEntry[] = merged.map((sig) => {
    const reg = sig.discordId ? registryById.get(sig.discordId) : undefined;

    if (reg && reg.primary_wallet) {
      const canonical = memberByWallet.get(reg.primary_wallet.toLowerCase());
      // A bound user resolves by wallet. If the wallet also has a Respect
      // member row, use its canonical name; otherwise fall back to the
      // registry's own display name + wallet (still safe to score by wallet).
      const member: ResolvedMember = canonical
        ? toResolved(canonical)
        : { name: reg.display_name, wallet: reg.primary_wallet, fid: reg.fid };
      return {
        discordId: sig.discordId,
        displayName: sig.displayName,
        sources: sig.sources,
        confidence: 'registry',
        member,
      };
    }

    // Unbound - resolve by display name.
    const m: Match = matchMember(sig.displayName, members);
    if (m.confidence === 'exact' || m.confidence === 'fuzzy') {
      return {
        discordId: sig.discordId,
        displayName: sig.displayName,
        sources: sig.sources,
        confidence: m.confidence,
        member: m.member ? toResolved(m.member) : null,
      };
    }
    if (m.confidence === 'ambiguous') {
      return {
        discordId: sig.discordId,
        displayName: sig.displayName,
        sources: sig.sources,
        confidence: 'ambiguous',
        member: null,
        candidates: (m.candidates ?? []).map(toResolved),
      };
    }
    return {
      discordId: sig.discordId,
      displayName: sig.displayName,
      sources: sig.sources,
      confidence: 'none',
      member: null,
    };
  });

  return {
    entries,
    matched: entries.filter((e) => e.confidence === 'registry' || e.confidence === 'exact' || e.confidence === 'fuzzy'),
    ambiguous: entries.filter((e) => e.confidence === 'ambiguous'),
    unmatched: entries.filter((e) => e.confidence === 'none'),
  };
}
