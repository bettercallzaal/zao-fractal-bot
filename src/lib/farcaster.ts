/** Farcaster reads - thin Neynar client for the bot's Farcaster awareness.
 * Given member fids (from respect_members / the identity bridge), it fetches
 * their Farcaster profile so the bot knows a member's Farcaster account, not
 * just their Discord and wallet. Reuses the same Neynar path ZOL uses; reads
 * need only an API key, no bot FID.
 *
 * Thin + defensive (the pure identity logic lives in identityBridge.ts): a
 * missing key or a failed request yields an empty map rather than throwing, so
 * Farcaster being unreachable never breaks a roster resolve.
 */

export interface FarcasterProfile {
  fid: number;
  username: string | null;
  displayName: string | null;
  pfpUrl: string | null;
  custodyAddress: string | null;
  verifiedAddresses: string[];
}

const NEYNAR_BULK_URL = 'https://api.neynar.com/v2/farcaster/user/bulk';

/** Fetch Farcaster profiles for a set of fids via Neynar's bulk endpoint.
 * Returns a map keyed by fid; fids that fail to resolve are simply absent.
 * `apiKey` defaults to NEYNAR_API_KEY. `fetchImpl` is injectable for tests. */
export async function fetchFarcasterProfiles(
  fids: number[],
  apiKey: string | undefined = process.env.NEYNAR_API_KEY,
  fetchImpl: typeof fetch = fetch,
): Promise<Map<number, FarcasterProfile>> {
  const out = new Map<number, FarcasterProfile>();
  const unique = [...new Set(fids.filter((f) => Number.isFinite(f) && f > 0))];
  if (unique.length === 0) return out;
  if (!apiKey) {
    console.error('fetchFarcasterProfiles: NEYNAR_API_KEY not set - skipping Farcaster read');
    return out;
  }

  // Neynar caps the bulk endpoint at 100 fids per call.
  for (let i = 0; i < unique.length; i += 100) {
    const batch = unique.slice(i, i + 100);
    const url = `${NEYNAR_BULK_URL}?fids=${batch.join(',')}`;
    try {
      const res = await fetchImpl(url, { headers: { 'x-api-key': apiKey, accept: 'application/json' } });
      if (!res.ok) {
        console.error(`fetchFarcasterProfiles: Neynar ${res.status} for ${batch.length} fids`);
        continue;
      }
      const body = (await res.json()) as { users?: NeynarUser[] };
      for (const u of body.users ?? []) {
        out.set(u.fid, {
          fid: u.fid,
          username: u.username ?? null,
          displayName: u.display_name ?? null,
          pfpUrl: u.pfp_url ?? null,
          custodyAddress: u.custody_address ?? null,
          verifiedAddresses: u.verified_addresses?.eth_addresses ?? [],
        });
      }
    } catch (err) {
      console.error('fetchFarcasterProfiles: request failed', err);
    }
  }
  return out;
}

interface NeynarUser {
  fid: number;
  username?: string;
  display_name?: string;
  pfp_url?: string;
  custody_address?: string;
  verified_addresses?: { eth_addresses?: string[] };
}
