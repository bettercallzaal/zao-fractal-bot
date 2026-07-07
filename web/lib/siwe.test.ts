import { describe, expect, it } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { SiweMessage } from 'siwe';
import { verifySiweSignature } from './siwe.js';

describe('verifySiweSignature', () => {
  it('validates a correctly-signed SIWE message', async () => {
    const account = privateKeyToAccount('0x0123456789012345678901234567890123456789012345678901234567890abc');
    const siweMessage = new SiweMessage({
      domain: 'localhost',
      address: account.address,
      statement: 'Sign in to ZAO Fractal Dashboard',
      uri: 'http://localhost:3000',
      version: '1',
      chainId: 10,
      nonce: 'abcd1234',
    });
    const preparedMessage = siweMessage.prepareMessage();
    const signature = await account.signMessage({ message: preparedMessage });

    const result = await verifySiweSignature(preparedMessage, signature);
    expect(result.valid).toBe(true);
    expect(result.address.toLowerCase()).toBe(account.address.toLowerCase());
  });

  it('rejects a tampered message', async () => {
    const account = privateKeyToAccount('0x0123456789012345678901234567890123456789012345678901234567890abc');
    const siweMessage = new SiweMessage({
      domain: 'localhost',
      address: account.address,
      statement: 'Sign in to ZAO Fractal Dashboard',
      uri: 'http://localhost:3000',
      version: '1',
      chainId: 10,
      nonce: 'abcd1234',
    });
    const preparedMessage = siweMessage.prepareMessage();
    const signature = await account.signMessage({ message: preparedMessage });

    const result = await verifySiweSignature(preparedMessage.replace('abcd1234', 'zzzz9999'), signature);
    expect(result.valid).toBe(false);
  });
});
