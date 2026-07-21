import { describe, expect, it } from 'vitest';
import { indexIdentities, unifyIdentities } from './identityBridge.js';

describe('unifyIdentities', () => {
  it('joins the three worlds on wallet (discord + chain + farcaster)', () => {
    const out = unifyIdentities({
      respectMembers: [{ name: 'Zaal', wallet_address: '0xAAA', fid: 5 }],
      users: [{ discord_id: 'd1', primary_wallet: '0xAAA', display_name: 'Zaal|ZAO', fid: null }],
      wallets: [{ discord_id: 'd1', wallet_address: '0xAAA' }],
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({ wallet: '0xaaa', name: 'Zaal', discordId: 'd1', fid: 5 });
  });

  it('lowercases wallet as the join key (case-insensitive merge)', () => {
    const out = unifyIdentities({
      respectMembers: [{ name: 'Zaal', wallet_address: '0xAbC', fid: 5 }],
      users: [{ discord_id: 'd1', primary_wallet: '0xabc', display_name: null, fid: null }],
    });
    expect(out).toHaveLength(1);
    expect(out[0].wallet).toBe('0xabc');
    expect(out[0].discordId).toBe('d1');
  });

  it('respect_members name + fid take precedence over users', () => {
    const out = unifyIdentities({
      respectMembers: [{ name: 'Canonical', wallet_address: '0xAAA', fid: 5 }],
      users: [{ discord_id: 'd1', primary_wallet: '0xAAA', display_name: 'Nickname', fid: 99 }],
    });
    expect(out[0].name).toBe('Canonical');
    expect(out[0].fid).toBe(5);
  });

  it('users fills fid when respect_members lacks it', () => {
    const out = unifyIdentities({
      respectMembers: [{ name: 'Zaal', wallet_address: '0xAAA', fid: null }],
      users: [{ discord_id: 'd1', primary_wallet: '0xAAA', display_name: null, fid: 42 }],
    });
    expect(out[0].fid).toBe(42);
  });

  it('keeps a wallet-only member (registered wallet, not yet a Respect member)', () => {
    const out = unifyIdentities({
      wallets: [{ discord_id: 'd9', wallet_address: '0xNEW' }],
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({ wallet: '0xnew', name: null, discordId: 'd9', fid: null });
  });

  it('skips rows with no wallet (nothing to join on)', () => {
    const out = unifyIdentities({
      respectMembers: [{ name: 'Ghost', wallet_address: null, fid: 1 }],
      users: [{ discord_id: 'd1', primary_wallet: '  ', display_name: null, fid: null }],
    });
    expect(out).toHaveLength(0);
  });

  it('merges the same wallet appearing across all sources into one record', () => {
    const out = unifyIdentities({
      respectMembers: [{ name: 'Jose Goats', wallet_address: '0xBBB', fid: null }],
      users: [{ discord_id: 'd2', primary_wallet: '0xBBB', display_name: 'jose', fid: 7 }],
      wallets: [{ discord_id: 'd2', wallet_address: '0xBBB' }],
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({ wallet: '0xbbb', name: 'Jose Goats', discordId: 'd2', fid: 7 });
  });
});

describe('indexIdentities', () => {
  it('indexes by discordId, fid, and wallet for the integration lookups', () => {
    const ids = unifyIdentities({
      respectMembers: [
        { name: 'Zaal', wallet_address: '0xAAA', fid: 5 },
        { name: 'Nobody', wallet_address: '0xCCC', fid: null }, // no discord, no fid
      ],
      users: [{ discord_id: 'd1', primary_wallet: '0xAAA', display_name: null, fid: null }],
    });
    const { byDiscordId, byFid, byWallet } = indexIdentities(ids);
    expect(byDiscordId.get('d1')?.name).toBe('Zaal');
    expect(byFid.get(5)?.discordId).toBe('d1');
    expect(byWallet.get('0xccc')?.name).toBe('Nobody');
    expect(byFid.has(0)).toBe(false); // null fid not indexed
  });
});
