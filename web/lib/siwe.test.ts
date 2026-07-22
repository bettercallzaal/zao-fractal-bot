import { describe, expect, it } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { SiweMessage } from 'siwe';
import { getCsrfNonce, verifySiweSignature } from './siwe.js';

const KEY = '0x0123456789012345678901234567890123456789012345678901234567890abc';
const DOMAIN = 'fractal.thezao.com';
const NONCE = 'servernonce123456';

interface SiweParams {
  domain: string;
  address: string;
  statement: string;
  uri: string;
  version: string;
  chainId: number;
  nonce: string;
  expirationTime: string;
  notBefore: string;
}

async function signed(overrides: Partial<SiweParams> = {}) {
  const account = privateKeyToAccount(KEY);
  const siwe = new SiweMessage({
    domain: DOMAIN,
    address: account.address,
    statement: 'Sign in to ZAO Fractal Dashboard',
    uri: `https://${DOMAIN}`,
    version: '1',
    chainId: 10,
    nonce: NONCE,
    ...overrides,
  });
  const message = siwe.prepareMessage();
  const signature = await account.signMessage({ message });
  return { account, message, signature };
}

describe('verifySiweSignature', () => {
  it('accepts a correctly-signed message with matching domain + nonce', async () => {
    const { account, message, signature } = await signed();
    const r = await verifySiweSignature(message, signature, { domain: DOMAIN, nonce: NONCE });
    expect(r.valid).toBe(true);
    expect(r.address.toLowerCase()).toBe(account.address.toLowerCase());
  });

  it('rejects a corrupted signature', async () => {
    const { message } = await signed();
    const bad = await verifySiweSignature(message, ('0x' + '00'.repeat(65)) as `0x${string}`, {
      domain: DOMAIN,
      nonce: NONCE,
    });
    expect(bad.valid).toBe(false);
  });

  it('rejects a signature for a DIFFERENT domain (cross-site replay)', async () => {
    const { message, signature } = await signed({ domain: 'evil-dapp.xyz' });
    const r = await verifySiweSignature(message, signature, { domain: DOMAIN, nonce: NONCE });
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('domain mismatch');
  });

  it('rejects a nonce that does not match the server nonce (replay)', async () => {
    const { message, signature } = await signed({ nonce: 'someOtherNonce99' });
    const r = await verifySiweSignature(message, signature, { domain: DOMAIN, nonce: NONCE });
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('nonce mismatch');
  });

  it('rejects an expired message', async () => {
    const past = new Date(1000).toISOString();
    const { message, signature } = await signed({ expirationTime: past });
    const r = await verifySiweSignature(message, signature, { domain: DOMAIN, nonce: NONCE, now: 2000 });
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('expired');
  });

  it('rejects a not-yet-valid message', async () => {
    const future = new Date(100000).toISOString();
    const { message, signature } = await signed({ notBefore: future });
    const r = await verifySiweSignature(message, signature, { domain: DOMAIN, nonce: NONCE, now: 5000 });
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('not yet valid');
  });

  it('rejects a message whose nonce is too short (raw message)', async () => {
    // siwe's own builder enforces nonce length, so hand-edit a valid message
    // down to a 3-char nonce. Either the parser rejects it or our length guard
    // does - both are a rejection.
    const { message, signature } = await signed();
    const shortNonceMessage = message.replace(/Nonce: \w+/, 'Nonce: abc');
    const r = await verifySiweSignature(shortNonceMessage, signature, { domain: DOMAIN });
    expect(r.valid).toBe(false);
  });

  it('rejects a malformed message without throwing', async () => {
    const r = await verifySiweSignature('not a siwe message', '0xdeadbeef', { domain: DOMAIN });
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('malformed message');
  });
});

describe('getCsrfNonce', () => {
  const req = (cookie: string) =>
    ({ headers: { get: (k: string) => (k === 'cookie' ? cookie : null) } }) as unknown as Request;

  it('extracts the token half of the authjs csrf cookie', () => {
    expect(getCsrfNonce(req('authjs.csrf-token=abcd1234efgh%7Chashpart'))).toBe('abcd1234efgh');
  });

  it('supports the __Host- prefixed cookie', () => {
    expect(getCsrfNonce(req('foo=bar; __Host-authjs.csrf-token=tok12345678|h'))).toBe('tok12345678');
  });

  it('returns undefined when no csrf cookie is present', () => {
    expect(getCsrfNonce(req('session=x; other=y'))).toBeUndefined();
  });

  it('returns undefined for a missing request or empty cookie', () => {
    expect(getCsrfNonce(undefined)).toBeUndefined();
    expect(getCsrfNonce(req(''))).toBeUndefined();
  });
});
