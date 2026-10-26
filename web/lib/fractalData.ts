/** Live reads for the public dashboard: ornode proposals and upcoming Luma
 * events. Both are public, keyless endpoints. Next caches each fetch for
 * REVALIDATE_SECONDS, so the page stays current without hammering either. */

import { ZOR_RESPECT_ADDRESS } from '@fractalbot/shared';
import { paginateProposals, type OrnodeProposal } from '../../src/lib/newcomers.js';
import { summarize, type FractalStats } from './fractalStats.js';

export const REVALIDATE_SECONDS = 300;

const ORNODE_URL = process.env.ZAO_ORNODE_URL ?? 'https://zao-ornode.frapps.xyz';
const LUMA_CALENDAR_SLUG = process.env.ZAO_LUMA_SLUG ?? 'zao';
// ornode caps limit at 50 with no error (probed 2026-09-29); page below it so
// a second that fills a page can be re-read wider - see paginateProposals.
const PAGE = 25;
const WIDE = 50;

export interface UpcomingEvent {
  name: string;
  startAt: string;
  url: string;
}

export interface DashboardData {
  stats: FractalStats | null;
  statsError: string | null;
  upcoming: UpcomingEvent[];
  fetchedAt: string;
}

async function fetchAllProposals(): Promise<OrnodeProposal[]> {
  return paginateProposals(
    async (spec) => {
      const res = await fetch(`${ORNODE_URL}/v1/getProposals`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ spec }),
        next: { revalidate: REVALIDATE_SECONDS },
      });
      if (!res.ok) throw new Error(`ornode getProposals failed: HTTP ${res.status}`);
      return ((await res.json()) as { proposals: OrnodeProposal[] }).proposals;
    },
    PAGE,
    WIDE,
  );
}

/** Upcoming fractal events from the ZAO Luma calendar. Empty on any failure:
 * the schedule is a nicety, the Respect record is the page. */
async function fetchUpcoming(): Promise<UpcomingEvent[]> {
  try {
    const res = await fetch(`https://api.lu.ma/url?url=${encodeURIComponent(LUMA_CALENDAR_SLUG)}`, {
      next: { revalidate: REVALIDATE_SECONDS },
    });
    if (!res.ok) return [];
    type Entry = { event?: { name?: string; start_at?: string; url?: string } };
    // Measured 2026-10-26: `upcoming` is { entries: [...], has_more }.
    const body = (await res.json()) as { data?: { upcoming?: { entries?: Entry[] } | Entry[] } };
    const up = body.data?.upcoming;
    const entries = Array.isArray(up) ? up : (up?.entries ?? []);
    return entries
      .map((u) => u.event)
      .filter((e): e is { name: string; start_at: string; url: string } => !!e?.name && !!e.start_at && !!e.url)
      .filter((e) => /fractal/i.test(e.name))
      .map((e) => ({ name: e.name, startAt: e.start_at, url: `https://luma.com/${e.url}` }))
      .sort((a, b) => a.startAt.localeCompare(b.startAt));
  } catch {
    return [];
  }
}

export async function getDashboardData(): Promise<DashboardData> {
  const [proposals, upcoming] = await Promise.all([
    fetchAllProposals().then(
      (p) => ({ ok: true as const, p }),
      (e: unknown) => ({ ok: false as const, e: e instanceof Error ? e.message : String(e) }),
    ),
    fetchUpcoming(),
  ]);
  return {
    stats: proposals.ok ? summarize(proposals.p, ZOR_RESPECT_ADDRESS) : null,
    statsError: proposals.ok ? null : proposals.e,
    upcoming,
    fetchedAt: new Date().toISOString(),
  };
}
