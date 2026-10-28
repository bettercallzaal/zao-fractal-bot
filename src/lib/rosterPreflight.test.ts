import { describe, expect, it } from 'vitest';
import { checkRosterPreflight, type AwardBalanceReader, type VerifiedWalletRecord } from './rosterPreflight.js';
import { packAwardTokenId } from './awardVerification.js';
import { checkRosterPreflightWithoutBalanceCheck } from './testing/fixtures/rosterPreflight-without-balance-check.js';

const roster = {
  meeting: 121,
  awards: [{ name: 'Gragragrande', wallet: '0x0000000000000000000000000000000000000001', rank: 1, room: 'Group 1' }],
};
const verified: VerifiedWalletRecord[] = [
  { name: 'Gragragrande', wallet: '0x0000000000000000000000000000000000000001', source: 'users' },
];

async function expectMintedRosterToBeBlocked(
  check: typeof checkRosterPreflight,
): Promise<void> {
  const expectedId = packAwardTokenId(roster.awards[0].wallet, 120, 10);
  const result = await check(roster, verified, async (_wallet, tokenId) => tokenId === expectedId ? 1n : 0n);
  expect(result.ready).toBe(false);
  expect(result.issues.join('\n')).toContain('already holds award token');
}

describe('Fractal proposal roster preflight', () => {
  it('passes only an exact verified wallet with no meeting award balance', async () => {
    const result = await checkRosterPreflight(roster, verified, async () => 0n);
    expect(result).toMatchObject({ ready: true, meeting: 121, rows: [{ name: 'Gragragrande', wallet: roster.awards[0].wallet }] });
    expect(result.issues).toEqual([]);
  });

  it('blocks a name without an exact verified wallet and does not query balances', async () => {
    let calls = 0;
    const result = await checkRosterPreflight(roster, [], async () => { calls += 1; return 0n; });
    expect(result.ready).toBe(false);
    expect(result.issues.join('\n')).toContain('no exact name match');
    expect(calls).toBe(0);
  });

  it('blocks a supplied address that differs from the verified registry', async () => {
    const result = await checkRosterPreflight({
      ...roster,
      awards: [{ ...roster.awards[0], wallet: '0x0000000000000000000000000000000000000002' }],
    }, verified, async () => 0n);
    expect(result.ready).toBe(false);
    expect(result.issues.join('\n')).toContain('does not match the verified registry wallet');
  });

  it('blocks ambiguous exact-name identities and duplicate wallets in one meeting', async () => {
    const ambiguous = await checkRosterPreflight(roster, [
      ...verified,
      { name: 'gragragrande', wallet: '0x0000000000000000000000000000000000000002', source: 'respect_members' },
    ], async () => 0n);
    expect(ambiguous.issues.join('\n')).toContain('ambiguous across multiple wallets');

    const duplicate = await checkRosterPreflight({
      ...roster,
      awards: [roster.awards[0], { ...roster.awards[0], name: 'Gragragrande alternate' }],
    }, [...verified, { name: 'Gragragrande alternate', wallet: verified[0].wallet, source: 'respect_members' }], async () => 0n);
    expect(duplicate.issues.join('\n')).toContain('one meeting must not award that wallet twice');
  });

  it('blocks an already minted award at the exact packed meeting token id', async () => {
    await expectMintedRosterToBeBlocked(checkRosterPreflight);
  });

  it('red control: the same minted-award assertion fails against a separate pre-fix artifact', async () => {
    await expect(expectMintedRosterToBeBlocked(checkRosterPreflightWithoutBalanceCheck)).rejects.toThrow();
  });

  it('lets RPC errors stop the preflight instead of returning a clear roster', async () => {
    const readBalance: AwardBalanceReader = async () => { throw new Error('RPC unavailable'); };
    await expect(checkRosterPreflight(roster, verified, readBalance)).rejects.toThrow('RPC unavailable');
  });
});
