import { isAddress } from 'viem';
import { AWARD_MINT_TYPES, meetingToPeriod, packAwardTokenId } from './awardVerification.js';

export interface ProposedAwardRow {
  name: string;
  /** Optional only when the canonical identity source has one exact match. */
  wallet?: string | null;
  rank: number;
  room?: string;
}

export interface ProposedAwardRoster {
  meeting: number;
  awards: ProposedAwardRow[];
}

export interface VerifiedWalletRecord {
  name: string;
  wallet: string;
  source: 'respect_members' | 'users';
}

export interface RosterPreflightResult {
  ready: boolean;
  meeting: number | null;
  rows: { name: string; wallet: string; walletSources: VerifiedWalletRecord['source'][]; room?: string; rank: number }[];
  issues: string[];
}

export type AwardBalanceReader = (wallet: `0x${string}`, tokenId: bigint) => Promise<bigint>;

function normalizedName(value: string): string {
  return value.trim().toLocaleLowerCase('en-US');
}

/** Fail closed before anyone prepares an award proposal. A verified wallet is
 * an exact-name identity in the read-only canonical registry, never a fuzzy
 * name match. Existing awards are checked at the exact meeting's packed ids
 * for each mint type seen in ZOR history. */
export async function checkRosterPreflight(
  input: unknown,
  verifiedRecords: VerifiedWalletRecord[],
  readBalance: AwardBalanceReader,
): Promise<RosterPreflightResult> {
  const issues: string[] = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ready: false, meeting: null, rows: [], issues: ['Roster file must be a JSON object.'] };
  }

  const candidate = input as { meeting?: unknown; awards?: unknown };
  const meeting = candidate.meeting;
  const validMeeting = Number.isInteger(meeting) && Number(meeting) > 0;
  if (!validMeeting) issues.push('meeting must be a positive integer.');
  if (!Array.isArray(candidate.awards) || candidate.awards.length === 0) {
    issues.push('awards must be a non-empty array.');
  }
  if (issues.length) return { ready: false, meeting: validMeeting ? Number(meeting) : null, rows: [], issues };

  const awards = candidate.awards as unknown[];
  const rows: RosterPreflightResult['rows'] = [];
  for (const [index, raw] of awards.entries()) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      issues.push(`awards[${index}] must be an object.`);
      continue;
    }
    const row = raw as Record<string, unknown>;
    const name = typeof row.name === 'string' ? row.name.trim() : '';
    const rank = row.rank;
    const room = typeof row.room === 'string' && row.room.trim() ? row.room.trim() : undefined;
    if (!name) {
      issues.push(`awards[${index}] has no attendee name.`);
      continue;
    }
    if (!Number.isInteger(rank) || Number(rank) < 1 || Number(rank) > 6) {
      issues.push(`${name}: rank must be an integer from 1 through 6.`);
      continue;
    }

    const matches = verifiedRecords.filter((record) => normalizedName(record.name) === normalizedName(name));
    const wallets = [...new Set(matches.map((record) => record.wallet.toLowerCase()))];
    if (wallets.length === 0) {
      issues.push(`${name}: no exact name match with a verified wallet in respect_members or users.`);
      continue;
    }
    if (wallets.length > 1) {
      issues.push(`${name}: verified identity is ambiguous across multiple wallets.`);
      continue;
    }

    const wallet = wallets[0];
    if (!isAddress(wallet, { strict: false })) {
      issues.push(`${name}: canonical wallet record is not a valid EVM address.`);
      continue;
    }
    if (row.wallet !== undefined && row.wallet !== null && typeof row.wallet !== 'string') {
      issues.push(`${name}: wallet must be a string or null.`);
      continue;
    }
    if (typeof row.wallet === 'string' && row.wallet.trim() && row.wallet.trim().toLowerCase() !== wallet) {
      issues.push(`${name}: supplied wallet does not match the verified registry wallet.`);
      continue;
    }
    const walletSources = [...new Set(matches.filter((record) => record.wallet.toLowerCase() === wallet).map((record) => record.source))];
    rows.push({ name, wallet, walletSources, ...(room ? { room } : {}), rank: Number(rank) });
  }

  const walletRows = new Map<string, string[]>();
  for (const row of rows) {
    const names = walletRows.get(row.wallet) ?? [];
    names.push(row.name);
    walletRows.set(row.wallet, names);
  }
  for (const [wallet, names] of walletRows) {
    if (names.length > 1) issues.push(`${names.join(', ')} resolve to the same wallet ${wallet}; one meeting must not award that wallet twice.`);
  }

  if (issues.length) return { ready: false, meeting: Number(meeting), rows, issues };

  const period = meetingToPeriod(Number(meeting));
  for (const row of rows) {
    for (const mintType of AWARD_MINT_TYPES) {
      const tokenId = packAwardTokenId(row.wallet, period, mintType);
      const balance = await readBalance(row.wallet as `0x${string}`, tokenId);
      if (balance > 0n) {
        issues.push(`${row.name}: already holds award token ${tokenId.toString()} for meeting ${meeting} (mint type ${mintType}, balance ${balance}).`);
      }
    }
  }

  return { ready: issues.length === 0, meeting: Number(meeting), rows, issues };
}
