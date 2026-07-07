import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createHttpServer } from './server.js';

vi.mock('../commands/executeCommand.js', () => ({
  executeCommand: vi.fn(async () => ({ status: 'done', result: { groups: [['a', 'b']] } })),
}));

describe('createHttpServer', () => {
  const fakeSupabase = {} as any;

  it('rejects requests missing the shared secret', async () => {
    const app = createHttpServer(fakeSupabase, 'correct-secret');
    const res = await request(app)
      .post('/commands/randomize')
      .send({ params: { memberIds: ['a', 'b'], maxGroupSize: 6 }, idempotencyKey: 'k1', requestedBy: 'admin1' });
    expect(res.status).toBe(401);
  });

  it('accepts requests with the correct shared secret and runs the command', async () => {
    const app = createHttpServer(fakeSupabase, 'correct-secret');
    const res = await request(app)
      .post('/commands/randomize')
      .set('x-bot-api-secret', 'correct-secret')
      .send({ params: { memberIds: ['a', 'b'], maxGroupSize: 6 }, idempotencyKey: 'k1', requestedBy: 'admin1' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'done' });
  });
});
