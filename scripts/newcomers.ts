/** Capture every wallet that has ever been proposed for ZOR Respect, and flag
 * the ones the committed roster has never seen. Run: `npm run newcomers`.
 *
 * Reads every proposal from ZAO's ornode (the same store zao.frapps.xyz reads),
 * decodes the award calldata (src/lib/newcomers.ts), and diffs against
 * docs/members/roster.json. Each newcomer's ZOR and OG Respect balances are
 * read at capture time: a pending award to a wallet holding neither is someone
 * brand new to the ZAO - the person to onboard before the vote closes.
 * Keyless - public ornode + public RPC.
 *
 * Coverage: ornode's history starts around meeting 68. OG-era members who
 * never received a ZOR award are not in it and will not appear here.
 *
 *   npm run newcomers            # report only
 *   npm run newcomers -- --write # also add newcomers to roster.json
 *
 * roster.json is the capture surface: commit it after --write. The `label`
 * field is for humans - fill in names; --write never overwrites one.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { OG_RESPECT_ADDRESS, ZOR_RESPECT_ADDRESS } from '@fractalbot/shared';
import { makeOptimismClient } from '../src/lib/governance.js';
import {
  buildRoster,
  diffNewcomers,
  type MemberRecord,
  type OrnodeProposal,
  paginateProposals,
} from '../src/lib/newcomers.js';

const ORNODE_URL = process.env.ZAO_ORNODE_URL ?? 'https://zao-ornode.frapps.xyz';
const ROSTER_PATH = new URL('../docs/members/roster.json', import.meta.url);
// ornode caps limit at 50 with no error (probed 2026-09-29). Page below the
// cap so a second that fills a page can be re-read wider - see paginateProposals.
const PAGE = 25;
const WIDE = 50;

const BALANCE_ABI = [
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ type: 'address' }, { type: 'uint256' }], outputs: [{ type: 'uint256' }] },
] as const;
const ERC20_BALANCE_ABI = [
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
] as const;

interface CaptureBalances {
  zorAtCapture: string;
  ogAtCapture: string;
}

interface RosterFile {
  generatedAt: string;
  source: string;
  members: (MemberRecord & Partial<CaptureBalances>)[];
}

async function fetchAllProposals(): Promise<OrnodeProposal[]> {
  return paginateProposals(async (spec) => {
    const res = await fetch(`${ORNODE_URL}/v1/getProposals`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ spec }),
    });
    if (!res.ok) throw new Error(`ornode getProposals failed: HTTP ${res.status}`);
    return ((await res.json()) as { proposals: OrnodeProposal[] }).proposals;
  }, PAGE, WIDE);
}

function loadRoster(): RosterFile {
  if (!existsSync(ROSTER_PATH)) return { generatedAt: '', source: ORNODE_URL, members: [] };
  return JSON.parse(readFileSync(ROSTER_PATH, 'utf8')) as RosterFile;
}

async function main(): Promise<void> {
  const write = process.argv.includes('--write');
  const proposals = await fetchAllProposals();
  const current = buildRoster(proposals, ZOR_RESPECT_ADDRESS);
  const file = loadRoster();
  const newcomers = diffNewcomers(current, file.members.map((m) => m.wallet));

  console.log(`ornode: ${proposals.length} proposals, ${current.size} distinct award wallets`);
  console.log(`roster.json: ${file.members.length} known wallets`);
  if (current.size === 0) {
    console.log('UNKNOWN: decoded 0 award wallets - ornode shape changed or fetch is wrong, not "no members".');
    process.exit(2);
  }

  const client = makeOptimismClient();
  const tagged: (MemberRecord & CaptureBalances)[] = [];
  for (const m of newcomers) {
    const wallet = m.wallet as `0x${string}`;
    const zor = await client.readContract({ address: ZOR_RESPECT_ADDRESS, abi: BALANCE_ABI, functionName: 'balanceOf', args: [wallet, 0n] });
    const og = await client.readContract({ address: OG_RESPECT_ADDRESS, abi: ERC20_BALANCE_ABI, functionName: 'balanceOf', args: [wallet] });
    tagged.push({ ...m, zorAtCapture: zor.toString(), ogAtCapture: (og / 10n ** 18n).toString() });
  }

  if (tagged.length === 0) {
    console.log('No newcomers - every award wallet is already in roster.json.');
  } else {
    console.log(`\n${tagged.length} newcomer(s):`);
    for (const m of tagged) {
      const fresh = m.firstStatus !== 'Executed' && m.zorAtCapture === '0' && m.ogAtCapture === '0';
      console.log(
        `  ${fresh ? 'NEW-TO-ZAO' : '          '} ${m.firstSeen} ${m.wallet} mtg ${String(m.firstMeeting).padEnd(3)} ${m.firstStatus.padEnd(15)} zor=${m.zorAtCapture} og=${m.ogAtCapture}  ${m.firstTitle ?? ''}`,
      );
    }
  }

  // Refresh counters for known members too, so the file tracks live state;
  // labels and capture tags are human/first-sight data and are kept.
  const merged = file.members.map((old) => {
    const live = current.get(old.wallet);
    return live ? { ...live, label: old.label, zorAtCapture: old.zorAtCapture, ogAtCapture: old.ogAtCapture } : old;
  });
  merged.push(...tagged);

  if (write) {
    const out: RosterFile = { generatedAt: new Date().toISOString(), source: ORNODE_URL, members: merged.sort((a, b) => a.firstSeen.localeCompare(b.firstSeen) || a.wallet.localeCompare(b.wallet)) };
    writeFileSync(ROSTER_PATH, `${JSON.stringify(out, null, 2)}\n`);
    console.log(`\nWrote ${out.members.length} members to docs/members/roster.json - commit it.`);
  } else if (tagged.length > 0) {
    console.log('\nRe-run with --write to add them to roster.json.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
