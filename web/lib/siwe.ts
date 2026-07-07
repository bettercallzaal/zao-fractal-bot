import { createPublicClient, http } from 'viem';
import { optimism } from 'viem/chains';
import { SiweMessage } from 'siwe';

const client = createPublicClient({ chain: optimism, transport: http() });

/** Verifies a SIWE-signed message and returns the recovered address. Uses
 * viem's verifyMessage (which also handles smart-contract wallets via
 * ERC-6492/1271) rather than a raw ecrecover, so Safe/smart-account signers
 * work too, not just EOAs. */
export async function verifySiweSignature(
  message: string,
  signature: `0x${string}`,
): Promise<{ address: string; valid: boolean }> {
  const siwe = new SiweMessage(message);

  const valid = await client.verifyMessage({
    address: siwe.address as `0x${string}`,
    message,
    signature,
  });

  return { address: siwe.address, valid };
}
