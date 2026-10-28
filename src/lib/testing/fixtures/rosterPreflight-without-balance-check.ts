import {
  checkRosterPreflight,
  type AwardBalanceReader,
  type VerifiedWalletRecord,
} from '../../rosterPreflight.js';

/** Separate pre-fix mutant for the red control: it verifies roster identities
 * but discards every on-chain balance result, so a minted attendee passes. */
export async function checkRosterPreflightWithoutBalanceCheck(
  input: unknown,
  verifiedRecords: VerifiedWalletRecord[],
  _readBalance: AwardBalanceReader,
) {
  return checkRosterPreflight(input, verifiedRecords, async () => 0n);
}
