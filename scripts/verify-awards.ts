/** Verify pending Respect awards against onchain ZOR mints, so a
 * respectAccountBatch never double-awards. Run: `npm run verify-awards`.
 *
 * For each pending award it reconstructs the deterministic ZOR award NFT id
 * (see src/lib/awardVerification.ts) for the expected meeting and its
 * neighbours, then asks the contract: balanceOf(wallet, id) == 1 means the
 * award landed and valueOfToken(id) is the points. Cheap eth_calls only -
 * public RPC is fine, no key or log scanning needed.
 *
 * Probe a one-off award:
 *   npm run verify-awards -- --wallet 0x... --meeting 93 --amount 110
 *
 * The built-in list is the 2026-08-18 OneNote Fractal Todos sweep. Verified
 * 2026-08-19: all five were already minted in batch tx 0x993fd3e2... on
 * 2026-04-13. With the meeting = period + 1 convention (doc 2301) applied,
 * four of five match their expected meeting exactly; Penguin's 42 sits one
 * meeting below - which is why the radius search stays. Penguin's wallet
 * was recovered from that tx (the only 42-Respect mint). Update the list
 * for future batches.
 *
 * Award submission itself stays human-gated:
 * https://zao.frapps.xyz/newProposal/respectAccountBatch
 */

import { ZOR_RESPECT_ADDRESS } from '@fractalbot/shared';
import {
  AWARD_MINT_TYPES,
  type AwardHit,
  awardVerdict,
  meetingSearchRange,
  meetingToPeriod,
  packAwardTokenId,
  type PendingAward,
} from '../src/lib/awardVerification.js';
import { makeOptimismClient } from '../src/lib/governance.js';

const PENDING_AWARDS: PendingAward[] = [
  { name: 'Joel', wallet: '0x570e563BA92589AD6b31f3269D24Cb21E5a45CaD', meeting: 90, amount: 110 },
  { name: 'Penguin', wallet: '0xfaCEf700458D4Fc9746F7f3e0d37B462711fF09e', meeting: 90, amount: 42 },
  { name: 'Nico', wallet: '0x9763C16Dd7dEb17D33355d999cf2dA219Cec9EEA', meeting: 91, amount: 110 },
  { name: 'Kata7yst', wallet: '0xEa2fE2A296BB347a24f5Df0d06703fCb19140487', meeting: 93, amount: null },
  { name: 'LMDesigns8', wallet: '0xdbaa464302ff8928f04f82a57db0434c9bc3024a', meeting: 93, amount: null },
];

const RESPECT1155_ABI = [
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ type: 'address' }, { type: 'uint256' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'valueOfToken', stateMutability: 'view', inputs: [{ type: 'uint256' }], outputs: [{ type: 'uint256' }] },
] as const;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

type Client = ReturnType<typeof makeOptimismClient>;

/** All award NFTs held by the wallet within the meeting search radius. */
async function findAwardHits(
  client: Client,
  wallet: `0x${string}`,
  meeting: number,
): Promise<AwardHit[]> {
  const hits: AwardHit[] = [];
  for (const m of [...meetingSearchRange(meeting)].sort((a, b) => a - b)) {
    for (const mintType of AWARD_MINT_TYPES) {
      const tokenId = packAwardTokenId(wallet, meetingToPeriod(m), mintType);
      const balance = await client.readContract({
        address: ZOR_RESPECT_ADDRESS,
        abi: RESPECT1155_ABI,
        functionName: 'balanceOf',
        args: [wallet, tokenId],
      });
      if (balance > 0n) {
        const value = await client.readContract({
          address: ZOR_RESPECT_ADDRESS,
          abi: RESPECT1155_ABI,
          functionName: 'valueOfToken',
          args: [tokenId],
        });
        hits.push({ meeting: m, amount: Number(value), mintType });
        break; // one mint type per meeting; no need to probe the rest
      }
    }
  }
  return hits;
}

async function main() {
  const client = makeOptimismClient();

  const walletArg = arg('wallet');
  const awards: PendingAward[] = walletArg
    ? [{
        name: 'ad-hoc',
        wallet: walletArg as `0x${string}`,
        meeting: Number(arg('meeting') ?? NaN),
        amount: arg('amount') ? Number(arg('amount')) : null,
      }]
    : PENDING_AWARDS;
  if (walletArg && Number.isNaN(awards[0].meeting)) {
    throw new Error('--wallet needs --meeting <number>');
  }

  console.log(`Verifying awards against ZOR contract ${ZOR_RESPECT_ADDRESS}\n`);
  for (const award of awards) {
    const hits = award.wallet
      ? await findAwardHits(client, award.wallet, award.meeting)
      : [];
    const amount = award.amount ?? '?';
    console.log(
      `${award.name.padEnd(12)} meeting ${award.meeting} amount ${String(amount).padStart(4)}: ` +
        awardVerdict(award, hits),
    );
  }
  console.log('\nBatch form: https://zao.frapps.xyz/newProposal/respectAccountBatch');
  console.log('Award submission is human-gated - this script only verifies.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
