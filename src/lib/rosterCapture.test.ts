import { describe, expect, it } from 'vitest';
import type { Member } from './nameResolver.js';
import {
  buildRoster,
  mergeSignals,
  type PresenceSignal,
  type RegistryEntry,
} from './rosterCapture.js';

const MEMBERS: Member[] = [
  { name: 'Zaal', wallet_address: '0xAAA', fid: 1 },
  { name: 'Jose Goats', wallet_address: '0xBBB', fid: 2 },
  { name: 'Josephine', wallet_address: '0xCCC', fid: 3 },
  { name: 'Ohnahji', wallet_address: '0xDDD', fid: 4 },
];

describe('mergeSignals', () => {
  it('unions sources for the same discord id seen in multiple places', () => {
    const merged = mergeSignals([
      [{ discordId: '111', displayName: 'Zaal | ZAO', source: 'voice' }],
      [{ discordId: '111', displayName: 'Zaal | ZAO', source: 'reaction' }],
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].sources).toEqual(['voice', 'reaction']);
  });

  it('dedupes manual name-only entries by normalized name', () => {
    const merged = mergeSignals([
      [{ discordId: null, displayName: 'Zaal', source: 'manual' }],
      [{ discordId: null, displayName: 'zaal 🎵', source: 'manual' }],
    ]);
    expect(merged).toHaveLength(1);
  });

  it('keeps a discord-id entry and a name entry separate (no false merge)', () => {
    const merged = mergeSignals([
      [{ discordId: '111', displayName: 'Zaal', source: 'voice' }],
      [{ discordId: null, displayName: 'Someone Else', source: 'manual' }],
    ]);
    expect(merged).toHaveLength(2);
  });

  it('drops manual entries that normalize to nothing', () => {
    const merged = mergeSignals([[{ discordId: null, displayName: '🎵🔥', source: 'manual' }]]);
    expect(merged).toHaveLength(0);
  });

  it('preserves first-seen order', () => {
    const merged = mergeSignals([
      [
        { discordId: 'a', displayName: 'A', source: 'voice' },
        { discordId: 'b', displayName: 'B', source: 'voice' },
      ],
    ]);
    expect(merged.map((m) => m.discordId)).toEqual(['a', 'b']);
  });
});

describe('buildRoster', () => {
  it('resolves a bound user by wallet via the registry (confidence=registry)', () => {
    const registry: RegistryEntry[] = [
      { discord_id: '111', primary_wallet: '0xAAA', display_name: 'Zaal', fid: 1 },
    ];
    const signals: PresenceSignal[][] = [
      [{ discordId: '111', displayName: 'totally-different-nickname', source: 'voice' }],
    ];
    const r = buildRoster(signals, MEMBERS, registry);
    expect(r.matched).toHaveLength(1);
    expect(r.matched[0].confidence).toBe('registry');
    expect(r.matched[0].member?.name).toBe('Zaal'); // canonical name, not the nickname
    expect(r.matched[0].member?.wallet).toBe('0xAAA');
  });

  it('registry wallet match is case-insensitive', () => {
    const registry: RegistryEntry[] = [
      { discord_id: '111', primary_wallet: '0xaaa', display_name: 'Zaal', fid: 1 },
    ];
    const signals: PresenceSignal[][] = [[{ discordId: '111', displayName: 'z', source: 'voice' }]];
    const r = buildRoster(signals, MEMBERS, registry);
    expect(r.matched[0].member?.name).toBe('Zaal');
  });

  it('bound user with a wallet but no Respect member row still resolves (score by wallet)', () => {
    const registry: RegistryEntry[] = [
      { discord_id: '999', primary_wallet: '0xNOPE', display_name: 'New Person', fid: 7 },
    ];
    const signals: PresenceSignal[][] = [
      [{ discordId: '999', displayName: 'New Person', source: 'voice' }],
    ];
    const r = buildRoster(signals, MEMBERS, registry);
    expect(r.matched).toHaveLength(1);
    expect(r.matched[0].confidence).toBe('registry');
    expect(r.matched[0].member?.wallet).toBe('0xNOPE');
    expect(r.matched[0].member?.name).toBe('New Person');
  });

  it('falls back to name fuzzy for an unbound user', () => {
    const signals: PresenceSignal[][] = [
      [{ discordId: '222', displayName: 'Ohnahji.eth #4213', source: 'voice' }],
    ];
    const r = buildRoster(signals, MEMBERS, []);
    expect(r.matched).toHaveLength(1);
    expect(r.matched[0].confidence).not.toBe('registry');
    expect(r.matched[0].member?.name).toBe('Ohnahji');
  });

  it('flags an ambiguous name (two plausible members) for a human pick', () => {
    const signals: PresenceSignal[][] = [
      [{ discordId: null, displayName: 'Jose', source: 'manual' }],
    ];
    const r = buildRoster(signals, MEMBERS, []);
    expect(r.ambiguous).toHaveLength(1);
    expect(r.ambiguous[0].candidates?.length).toBeGreaterThan(1);
  });

  it('marks an unknown name unmatched (needs /register)', () => {
    const signals: PresenceSignal[][] = [
      [{ discordId: '333', displayName: 'Xyzzy Nobody', source: 'voice' }],
    ];
    const r = buildRoster(signals, MEMBERS, []);
    expect(r.unmatched).toHaveLength(1);
    expect(r.unmatched[0].confidence).toBe('none');
  });

  it('merges multi-source presence before resolving (one roster row per person)', () => {
    const registry: RegistryEntry[] = [
      { discord_id: '111', primary_wallet: '0xAAA', display_name: 'Zaal', fid: 1 },
    ];
    const signals: PresenceSignal[][] = [
      [{ discordId: '111', displayName: 'Zaal', source: 'voice' }],
      [{ discordId: '111', displayName: 'Zaal', source: 'text' }],
      [{ discordId: '111', displayName: 'Zaal', source: 'reaction' }],
    ];
    const r = buildRoster(signals, MEMBERS, registry);
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0].sources).toEqual(['voice', 'text', 'reaction']);
  });
});
