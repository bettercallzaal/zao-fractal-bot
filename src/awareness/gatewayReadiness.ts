/** Gateway readiness, as `/healthz` reports it.
 *
 * This exists as its own module because the first version of it was wrong in a
 * way no test could see: readiness was wired inline in `src/index.ts`, which
 * has no tests, so the wiring was unverifiable by construction.
 *
 * The bug: readiness watched only `shardDisconnect`. MEASURED in
 * node_modules/discord.js/src/client/websocket/WebSocketManager.js - a closing
 * shard emits `shardDisconnect` ONLY when the close code is in
 * UNRECOVERABLE_CLOSE_CODES (authentication failed, invalid shard, sharding
 * required, invalid API version, invalid or disallowed intents). Every ordinary
 * disconnect - heartbeat timeout, reset connection, a Discord-side restart -
 * emits `shardReconnecting` instead. So health reported "connected" for the
 * whole of a normal outage, which is precisely the window an operator is trying
 * to see.
 *
 * Recovery has two shapes and both count: a reconnect either resumes the old
 * session (`shardResume`) or identifies afresh (`shardReady`). Watching one and
 * not the other leaves a working bot stuck reporting 503 forever, which on a
 * host that restarts unhealthy processes is a restart loop.
 *
 * Single flag, not per-shard: this bot runs one shard. If it is ever sharded,
 * one shard dropping should not mark the whole process unready, and this is the
 * place to fix that.
 */

/** The minimum of discord.js's Client this needs. Kept structural rather than
 * importing the Client type, so the module stays testable with an EventEmitter
 * and the HTTP layer never grows a discord.js dependency. */
export interface GatewayEvents {
  on(event: string, listener: (...args: unknown[]) => void): unknown;
}

/** Wire readiness tracking onto a client. Returns a probe `/healthz` calls per
 * request - not a snapshot, so it always reflects the current connection. */
export function trackGatewayReadiness(client: GatewayEvents): () => boolean {
  let ready = false;

  // Event name strings verified against discord.js 14.26.4 typings/index.d.ts.
  client.on('clientReady', () => {
    ready = true;
  });
  client.on('shardReady', () => {
    ready = true;
  });
  client.on('shardResume', () => {
    ready = true;
  });
  client.on('shardReconnecting', () => {
    ready = false;
  });
  client.on('shardDisconnect', () => {
    ready = false;
  });

  return () => ready;
}
