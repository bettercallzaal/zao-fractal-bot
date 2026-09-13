import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { trackGatewayReadiness } from './gatewayReadiness.js';

// The events below are the real discord.js v14.26.4 strings, verified against
// node_modules/discord.js/typings/index.d.ts. An EventEmitter stands in for the
// Client because this module only ever listens - see src/architecture.test.ts
// for why the awareness layer avoids discord.js types where it can.
describe('trackGatewayReadiness', () => {
  it('starts not ready, before any login has happened', () => {
    const isReady = trackGatewayReadiness(new EventEmitter());
    expect(isReady()).toBe(false);
  });

  it('becomes ready when the client is ready', () => {
    const client = new EventEmitter();
    const isReady = trackGatewayReadiness(client);
    client.emit('clientReady');
    expect(isReady()).toBe(true);
  });

  // The bug this module exists to fix. MEASURED in
  // node_modules/discord.js/src/client/websocket/WebSocketManager.js: a shard
  // close only emits shardDisconnect when the close code is in
  // UNRECOVERABLE_CLOSE_CODES (auth failure, invalid or disallowed intents,
  // sharding required). EVERY ordinary disconnect - heartbeat timeout, reset
  // connection, a Discord-side restart - emits shardReconnecting instead. A
  // readiness flag that watches only shardDisconnect therefore reports
  // "connected" through the whole outage, which is exactly the window an
  // operator is trying to see.
  it('goes not-ready on an ordinary reconnect, not just an unrecoverable one', () => {
    const client = new EventEmitter();
    const isReady = trackGatewayReadiness(client);
    client.emit('clientReady');
    client.emit('shardReconnecting', 0);
    expect(isReady()).toBe(false);
  });

  it('goes not-ready on an unrecoverable disconnect', () => {
    const client = new EventEmitter();
    const isReady = trackGatewayReadiness(client);
    client.emit('clientReady');
    client.emit('shardDisconnect', { code: 4004 }, 0);
    expect(isReady()).toBe(false);
  });

  // The other half of the same bug: a reconnect finishes either by resuming the
  // old session (shardResume) or by identifying afresh (shardReady). Watching
  // only one leaves the flag stuck false after the other, so a healthy bot
  // would report 503 forever.
  it('recovers when the session resumes', () => {
    const client = new EventEmitter();
    const isReady = trackGatewayReadiness(client);
    client.emit('clientReady');
    client.emit('shardReconnecting', 0);
    client.emit('shardResume', 0, 12);
    expect(isReady()).toBe(true);
  });

  it('recovers when the shard re-identifies instead of resuming', () => {
    const client = new EventEmitter();
    const isReady = trackGatewayReadiness(client);
    client.emit('clientReady');
    client.emit('shardReconnecting', 0);
    client.emit('shardReady', 0);
    expect(isReady()).toBe(true);
  });

  it('survives a full outage and recovery cycle', () => {
    const client = new EventEmitter();
    const isReady = trackGatewayReadiness(client);
    client.emit('clientReady');
    expect(isReady()).toBe(true);
    client.emit('shardReconnecting', 0);
    expect(isReady()).toBe(false);
    client.emit('shardResume', 0, 3);
    expect(isReady()).toBe(true);
    client.emit('shardDisconnect', { code: 4014 }, 0);
    expect(isReady()).toBe(false);
  });
});
