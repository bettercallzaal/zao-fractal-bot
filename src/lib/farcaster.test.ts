import { describe, expect, it, vi } from 'vitest';
import { fetchFarcasterProfiles } from './farcaster.js';

function mockFetch(users: unknown[], ok = true, status = 200): typeof fetch {
  return vi.fn(async () => ({
    ok,
    status,
    json: async () => ({ users }),
  })) as unknown as typeof fetch;
}

describe('fetchFarcasterProfiles', () => {
  it('maps Neynar users into profiles keyed by fid', async () => {
    const fetchImpl = mockFetch([
      {
        fid: 5,
        username: 'zaal',
        display_name: 'Zaal',
        pfp_url: 'http://x/y.png',
        custody_address: '0xcustody',
        verified_addresses: { eth_addresses: ['0xAAA'] },
      },
    ]);
    const out = await fetchFarcasterProfiles([5], 'key', fetchImpl);
    expect(out.get(5)).toEqual({
      fid: 5,
      username: 'zaal',
      displayName: 'Zaal',
      pfpUrl: 'http://x/y.png',
      custodyAddress: '0xcustody',
      verifiedAddresses: ['0xAAA'],
    });
  });

  it('returns empty and does not call fetch when no api key', async () => {
    const fetchImpl = mockFetch([]);
    const out = await fetchFarcasterProfiles([5], undefined, fetchImpl);
    expect(out.size).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns empty for an empty / invalid fid list without calling fetch', async () => {
    const fetchImpl = mockFetch([]);
    const out = await fetchFarcasterProfiles([0, -1, NaN], 'key', fetchImpl);
    expect(out.size).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('dedupes fids before querying', async () => {
    const fetchImpl = mockFetch([{ fid: 5, username: 'zaal' }]);
    await fetchFarcasterProfiles([5, 5, 5], 'key', fetchImpl);
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]).toContain('fids=5');
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });

  it('swallows a non-ok response and returns empty (defensive)', async () => {
    const fetchImpl = mockFetch([], false, 429);
    const out = await fetchFarcasterProfiles([5], 'key', fetchImpl);
    expect(out.size).toBe(0);
  });

  it('defaults missing optional fields to null / empty', async () => {
    const fetchImpl = mockFetch([{ fid: 9 }]);
    const out = await fetchFarcasterProfiles([9], 'key', fetchImpl);
    expect(out.get(9)).toEqual({
      fid: 9,
      username: null,
      displayName: null,
      pfpUrl: null,
      custodyAddress: null,
      verifiedAddresses: [],
    });
  });
});
