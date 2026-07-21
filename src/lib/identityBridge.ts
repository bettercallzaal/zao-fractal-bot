/** Identity bridge - pure unification of a member's identity across the three
 * worlds the fractal lives in: Discord (discord_id), the chain (wallet), and
 * Farcaster (fid). Those keys are scattered across tables - respect_members
 * (name, wallet, fid), users (discord_id, wallet, fid), wallets (discord_id,
 * wallet) - so this folds them into one record per person. It is what lets the
 * bot recognise that "Zaal in Discord voice", "0x7234... on-chain", and
 * "@zaal on Farcaster" are the same member, which is the basis of every
 * Farcaster<->Discord integration on top.
 *
 * Pure (no DB, no network), same convention as nameResolver / rosterCapture /
 * voicePresence. The Neynar reads live in farcaster.ts; the DB reads live in
 * the resolveFarcaster action.
 *
 * Wallet is the join key: it is the one identifier that appears in every
 * source and is canonical (a member has exactly one primary wallet). discord_id
 * and fid are layered on where present.
 */

export interface RespectMemberRow {
  name: string | null;
  wallet_address: string | null;
  fid: number | null;
}

export interface UserRow {
  discord_id: string | null;
  primary_wallet: string | null;
  display_name: string | null;
  fid: number | null;
}

export interface WalletRow {
  discord_id: string | null;
  wallet_address: string | null;
}

export interface UnifiedIdentity {
  wallet: string; // lowercased, the join key
  name: string | null; // canonical Respect name, else Discord display name
  discordId: string | null;
  fid: number | null;
}

interface Sources {
  respectMembers?: RespectMemberRow[];
  users?: UserRow[];
  wallets?: WalletRow[];
}

function norm(wallet: string | null | undefined): string | null {
  if (!wallet) return null;
  const w = wallet.trim().toLowerCase();
  return w.length > 0 ? w : null;
}

/** Fold all identity sources into one record per wallet. Precedence for a
 * field is first-non-null in source order: respect_members (canonical Respect
 * data) wins for name + fid; users fills discord_id, display name, and fid if
 * respect_members lacked it; wallets fills discord_id last. A member present
 * only in `wallets` (Discord user who registered a wallet but is not yet a
 * Respect member) still gets a record, so the bot can see them. */
export function unifyIdentities(sources: Sources): UnifiedIdentity[] {
  const byWallet = new Map<string, UnifiedIdentity>();

  const get = (wallet: string): UnifiedIdentity => {
    let id = byWallet.get(wallet);
    if (!id) {
      id = { wallet, name: null, discordId: null, fid: null };
      byWallet.set(wallet, id);
    }
    return id;
  };

  for (const m of sources.respectMembers ?? []) {
    const w = norm(m.wallet_address);
    if (!w) continue;
    const id = get(w);
    if (id.name === null && m.name) id.name = m.name;
    if (id.fid === null && m.fid !== null) id.fid = m.fid;
  }

  for (const u of sources.users ?? []) {
    const w = norm(u.primary_wallet);
    if (!w) continue;
    const id = get(w);
    if (id.discordId === null && u.discord_id) id.discordId = u.discord_id;
    if (id.name === null && u.display_name) id.name = u.display_name;
    if (id.fid === null && u.fid !== null) id.fid = u.fid;
  }

  for (const w of sources.wallets ?? []) {
    const wal = norm(w.wallet_address);
    if (!wal) continue;
    const id = get(wal);
    if (id.discordId === null && w.discord_id) id.discordId = w.discord_id;
  }

  return [...byWallet.values()];
}

/** Index a unified identity list for the two lookups the integrations need:
 * by Discord id (voice/roster came from Discord) and by fid (a Farcaster cast
 * came from an fid). Wallets are already unique per record. */
export function indexIdentities(identities: UnifiedIdentity[]): {
  byDiscordId: Map<string, UnifiedIdentity>;
  byFid: Map<number, UnifiedIdentity>;
  byWallet: Map<string, UnifiedIdentity>;
} {
  const byDiscordId = new Map<string, UnifiedIdentity>();
  const byFid = new Map<number, UnifiedIdentity>();
  const byWallet = new Map<string, UnifiedIdentity>();
  for (const id of identities) {
    byWallet.set(id.wallet, id);
    if (id.discordId) byDiscordId.set(id.discordId, id);
    if (id.fid !== null) byFid.set(id.fid, id);
  }
  return { byDiscordId, byFid, byWallet };
}
