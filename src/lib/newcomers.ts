/** Newcomer capture - who has ever been minted Respect, and who is new.
 *
 * Every ZOR award goes through an OREC proposal whose calldata is either
 * mintRespectGroup((uint256 id, uint64 value)[], bytes) - breakouts and batch
 * intros - or mintRespect((uint256 id, uint64 value), bytes) - a single intro
 * ("respectAccount"). Both target the ZOR contract.
 * The id packs the recipient wallet (see awardVerification.ts), so decoding
 * the proposal calldata gives the full recipient list with no name lookup.
 * ornode keeps every proposal, so walking its list rebuilds the whole roster.
 *
 * Pure (no network), same convention as awardVerification / identityBridge.
 * The ornode + chain reads live in scripts/newcomers.ts.
 *
 * "New" means a wallet's first appearance in any award proposal. A wallet
 * first seen in a NotExecuted proposal is a pending newcomer - worth knowing
 * about before the vote closes, since that is when they need onboarding.
 */

import { decodeFunctionData, type Hex } from 'viem';
import { unpackAwardTokenId } from './awardVerification.js';

const RESPECT_REQUEST = {
  type: 'tuple',
  components: [
    { type: 'uint256', name: 'id' },
    { type: 'uint64', name: 'value' },
  ],
} as const;

export const MINT_RESPECT_ABI = [
  {
    type: 'function',
    name: 'mintRespect',
    stateMutability: 'nonpayable',
    inputs: [
      { ...RESPECT_REQUEST, name: 'req' },
      { type: 'bytes', name: 'data' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'mintRespectGroup',
    stateMutability: 'nonpayable',
    inputs: [
      { ...RESPECT_REQUEST, type: 'tuple[]', name: 'res' },
      { type: 'bytes', name: 'data' },
    ],
    outputs: [],
  },
] as const;

/** The subset of an ornode proposal this module reads. */
export interface OrnodeProposal {
  id: string;
  /** Absent when ornode only knows the id (proposed on-chain without content). */
  content?: { addr: string; cdata: string };
  attachment?: {
    propType?: string;
    propTitle?: string;
    mintTitle?: string;
    groupNum?: number;
    awards?: { mintTitle?: string; mintReason?: string; groupNum?: number }[];
  };
  createTs: number;
  createTxHash?: string;
  executeTxHash?: string;
  status: string;
}

export interface AwardRecipient {
  wallet: string; // lowercased
  value: number;
  meeting: number;
  mintType: number;
  /** The award's own title, when the proposer typed one. */
  title: string | null;
}

/** Decode a mintRespect / mintRespectGroup proposal into its recipients. Returns [] for any
 * proposal that is not an award to the ZOR contract (ticks, custom calls). */
export function decodeAwardRecipients(p: OrnodeProposal, zorAddress: string): AwardRecipient[] {
  if (!p.content || p.content.addr.toLowerCase() !== zorAddress.toLowerCase()) return [];
  let decoded;
  try {
    decoded = decodeFunctionData({ abi: MINT_RESPECT_ABI, data: p.content.cdata as Hex });
  } catch {
    return [];
  }
  const res = decoded.functionName === 'mintRespect' ? [decoded.args[0]] : decoded.args[0];
  const titles =
    decoded.functionName === 'mintRespect'
      ? [{ mintTitle: p.attachment?.mintTitle }]
      : (p.attachment?.awards ?? []);
  return res.map((r, i) => {
    const f = unpackAwardTokenId(r.id);
    return {
      wallet: f.wallet.toLowerCase(),
      value: Number(r.value),
      meeting: f.meeting,
      mintType: f.mintType,
      title: titles[i]?.mintTitle ?? null,
    };
  });
}

export interface MemberRecord {
  wallet: string;
  /** Human-filled name. Never derived - the award title is kept verbatim in
   * firstTitle so a person can label from it. */
  label: string | null;
  /** Meeting packed into the award id. Proposers occasionally mistype it
   * (one 2026 intro was minted as meeting 1), so order by firstSeen instead. */
  firstMeeting: number;
  /** ISO date of the proposal that first named this wallet. */
  firstSeen: string;
  firstProposal: string;
  firstStatus: string;
  firstTitle: string | null;
  proposals: number;
  /** Respect across Executed proposals only - pending ones have not landed. */
  executedRespect: number;
}

/** Fold proposals, oldest first, into one record per wallet. */
export function buildRoster(proposals: OrnodeProposal[], zorAddress: string): Map<string, MemberRecord> {
  const roster = new Map<string, MemberRecord>();
  const ordered = [...proposals].sort((a, b) => a.createTs - b.createTs);
  for (const p of ordered) {
    for (const r of decodeAwardRecipients(p, zorAddress)) {
      const executed = p.status === 'Executed';
      const existing = roster.get(r.wallet);
      if (existing) {
        existing.proposals += 1;
        if (executed) existing.executedRespect += r.value;
        // A wallet first seen in a proposal that later failed should not stay
        // "pending" once it lands for real.
        if (existing.firstStatus !== 'Executed' && executed) {
          existing.firstStatus = 'Executed';
          existing.firstMeeting = r.meeting;
          existing.firstSeen = isoDate(p.createTs);
          existing.firstProposal = p.id;
        }
        continue;
      }
      roster.set(r.wallet, {
        wallet: r.wallet,
        label: null,
        firstMeeting: r.meeting,
        firstSeen: isoDate(p.createTs),
        firstProposal: p.id,
        firstStatus: p.status,
        firstTitle: r.title,
        proposals: 1,
        executedRespect: executed ? r.value : 0,
      });
    }
  }
  return roster;
}

/** Wallets in `current` that the committed roster file has never seen. */
export function diffNewcomers(
  current: Map<string, MemberRecord>,
  known: Iterable<string>,
): MemberRecord[] {
  const seen = new Set([...known].map((w) => w.toLowerCase()));
  return [...current.values()]
    .filter((m) => !seen.has(m.wallet))
    .sort((a, b) => a.firstSeen.localeCompare(b.firstSeen) || a.wallet.localeCompare(b.wallet));
}

function isoDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}

/** One ornode getProposals call. Live semantics, probed 2026-09-29: newest
 * first, createTs strictly below `before`, and `limit` silently capped at 50
 * (asking for 100 returns 50 with no error; omitting it returns 10). */
export type FetchProposalPage = (spec: { limit: number; before?: number }) => Promise<OrnodeProposal[]>;

/** Walk every ornode proposal, newest first.
 *
 * ornode only takes a timestamp cursor and timestamps are not unique, so a
 * composite (createTs, id) cursor is not available. Instead:
 *
 * - The cursor is INCLUSIVE of the oldest second seen (before = oldest + 1):
 *   each page re-reads the boundary second and skips ids already seen. The
 *   old strict cursor (before = oldest) dropped every boundary-second item
 *   that did not fit on the page.
 * - A full page that adds nothing means one second fills the page. From
 *   same-size pages "exactly full" and "overflowed" look identical, so the
 *   second is re-read once at `wideLimit`. If that page is short, or reaches
 *   older items, the second is fully enumerated. If it too is full and adds
 *   nothing, completeness cannot be proven and this throws.
 * - A short page is only the end of the data if the server honoured the
 *   limit. Because ornode caps silently, a short page is checked with one
 *   strict probe for anything older; finding some means the cap is below the
 *   page size, and that throws instead of returning one page as "everything".
 *
 * pageSize must sit below wideLimit, and wideLimit at or below the server cap. */
export async function paginateProposals(
  fetchPage: FetchProposalPage,
  pageSize: number,
  wideLimit: number,
): Promise<OrnodeProposal[]> {
  if (pageSize >= wideLimit) {
    throw new Error(`pageSize ${pageSize} needs headroom below wideLimit ${wideLimit} to resolve a full second`);
  }
  const seen = new Map<string, OrnodeProposal>();
  const absorb = (page: OrnodeProposal[]): number => {
    let added = 0;
    for (const p of page) {
      if (!seen.has(p.id)) {
        seen.set(p.id, p);
        added += 1;
      }
    }
    return added;
  };
  const oldestOf = (page: OrnodeProposal[]) => Math.min(...page.map((p) => p.createTs));

  let before: number | undefined;
  for (;;) {
    const cursor = before !== undefined ? { before } : {};
    let limit = pageSize;
    let page = await fetchPage({ limit, ...cursor });
    // absorb() must run on every page - never behind a short-circuit.
    let added = absorb(page);
    if (page.length === limit && added === 0) {
      limit = wideLimit;
      page = await fetchPage({ limit, ...cursor });
      added = absorb(page);
      if (page.length === limit && added === 0) {
        throw new Error(
          `cannot prove the list is complete: at least ${limit} proposals share createTs ${oldestOf(page)}, ` +
            'and a timestamp cursor cannot page within one second',
        );
      }
    }
    if (page.length < limit) {
      if (page.length > 0) {
        const older = await fetchPage({ limit: 1, before: oldestOf(page) });
        if (older.length > 0) {
          throw new Error(
            `ornode returned ${page.length} of ${limit} requested yet older proposals exist - its page cap is below ${limit}`,
          );
        }
      }
      break;
    }
    before = oldestOf(page) + 1;
  }
  return [...seen.values()];
}
