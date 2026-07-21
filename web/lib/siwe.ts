import { createPublicClient, http } from 'viem';
import { optimism } from 'viem/chains';
import { SiweMessage } from 'siwe';

const client = createPublicClient({ chain: optimism, transport: http() });

export interface SiweExpectation {
  /** The domain the signed message must be bound to (the app's own host).
   * A signature produced for any other site is rejected - this is what stops
   * a signature phished or captured on another dApp from being replayed here. */
  domain: string;
  /** The server-issued single-use nonce the message must carry. When provided,
   * the message's nonce must match exactly; the caller is responsible for
   * issuing it and refusing to reuse it. When omitted, a syntactically valid
   * nonce is still required, but single-use replay within `domain` is not
   * prevented - always pass a nonce in production. */
  nonce?: string;
  /** Injectable clock (ms) for deterministic expiry tests. */
  now?: number;
}

export interface SiweResult {
  address: string;
  valid: boolean;
  /** Why verification failed, for logging (never surfaced to the client). */
  reason?: string;
}

/** Verify a SIWE-signed message. Unlike a bare signature check, this binds the
 * signature to the app's `domain`, a server-issued `nonce`, and the message's
 * own expiry window - the fields that make SIWE replay-resistant. The
 * signature itself is checked with viem's verifyMessage (ERC-1271 / 6492), so
 * smart-account signers work too, not just EOAs.
 *
 * Order matters: cheap field checks (domain, nonce, expiry) run before the
 * signature recovery, so a mismatched message is rejected without a chain call. */
export async function verifySiweSignature(
  message: string,
  signature: `0x${string}`,
  expected: SiweExpectation,
): Promise<SiweResult> {
  let siwe: SiweMessage;
  try {
    siwe = new SiweMessage(message);
  } catch {
    return { address: '', valid: false, reason: 'malformed message' };
  }

  const now = expected.now ?? Date.now();

  // 1. Domain binding - the message must be for this app.
  if (!expected.domain || siwe.domain !== expected.domain) {
    return { address: siwe.address, valid: false, reason: 'domain mismatch' };
  }

  // 2. Expiry window.
  if (siwe.expirationTime && now >= new Date(siwe.expirationTime).getTime()) {
    return { address: siwe.address, valid: false, reason: 'expired' };
  }
  if (siwe.notBefore && now < new Date(siwe.notBefore).getTime()) {
    return { address: siwe.address, valid: false, reason: 'not yet valid' };
  }

  // 3. Nonce - single-use anti-replay. Must be present, and must match the
  //    server-issued nonce when one is supplied.
  if (!siwe.nonce || siwe.nonce.length < 8) {
    return { address: siwe.address, valid: false, reason: 'missing nonce' };
  }
  if (expected.nonce !== undefined && siwe.nonce !== expected.nonce) {
    return { address: siwe.address, valid: false, reason: 'nonce mismatch' };
  }

  // 4. Signature recovery (chain call last).
  const valid = await client.verifyMessage({
    address: siwe.address as `0x${string}`,
    message,
    signature,
  });

  return { address: siwe.address, valid, reason: valid ? undefined : 'bad signature' };
}

/** Extract the next-auth CSRF token to use as the expected SIWE nonce. The CSRF
 * cookie value is `token|hash` (the separator may be URL-encoded); the token
 * half is a per-session, server-issued random value - exactly what a SIWE nonce
 * needs. The sign-in client must set the SIWE message's nonce to this token.
 * Returns undefined if no CSRF cookie is present. */
export function getCsrfNonce(request: Request | undefined): string | undefined {
  const cookie = request?.headers?.get('cookie');
  if (!cookie) return undefined;
  const names = [
    '__Host-authjs.csrf-token',
    'authjs.csrf-token',
    '__Host-next-auth.csrf-token',
    'next-auth.csrf-token',
  ];
  for (const name of names) {
    const escaped = name.replace(/[.$*+?^(){}|[\]\\]/g, '\\$&');
    const m = cookie.match(new RegExp('(?:^|;\\s*)' + escaped + '=([^;]+)'));
    if (m) {
      const raw = decodeURIComponent(m[1]);
      const token = raw.split('|')[0];
      if (token && token.length >= 8) return token;
    }
  }
  return undefined;
}
