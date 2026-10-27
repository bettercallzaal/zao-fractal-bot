import { afterEach, describe, expect, it, vi } from 'vitest';
import { getDashboardData } from './fractalData.js';

function stubFetch(proposals: unknown[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: { body?: string }) => {
      // Honour ornode's cursor: createTs strictly below `before`, newest first.
      const before = init?.body ? (JSON.parse(init.body) as { spec: { before?: number } }).spec.before : undefined;
      const page = (proposals as { createTs: number }[]).filter((p) => before === undefined || p.createTs < before);
      const body = String(url).includes('ornode') ? { proposals: page } : { data: { upcoming: { entries: [] } } };
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getDashboardData', () => {
  it('treats an empty ornode answer as an error, never as zero fractals', async () => {
    stubFetch([]);
    const d = await getDashboardData();
    expect(d.stats).toBeNull();
    expect(d.statsError).toBe('ornode returned no proposals');
  });

  it('reports an HTTP failure as an error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('down', { status: 503 })));
    const d = await getDashboardData();
    expect(d.stats).toBeNull();
    expect(d.statsError).toContain('HTTP 503');
    expect(d.upcoming).toEqual([]);
  });

  it('summarizes a non-empty record (control)', async () => {
    stubFetch([{ id: '0x01', attachment: { propType: 'tick', propTitle: 'Increase Tick from 1 to 2' }, createTs: 1, status: 'Executed' }]);
    const d = await getDashboardData();
    expect(d.statsError).toBeNull();
    expect(d.stats?.proposals).toBe(1);
  });
});
