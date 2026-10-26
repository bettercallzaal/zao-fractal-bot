/** Fractal stats - pure summaries of ornode proposals for the public dashboard.
 *
 * Every number on the home page comes from here, computed from the same
 * proposal list zao.frapps.xyz reads. No network, no database: the caller
 * passes proposals in (see fractalData.ts), so this is unit-testable.
 *
 * Only Executed proposals count toward Respect totals. A NotExecuted proposal
 * may still pass, or may be a duplicate (0xbbe2fa11 re-filed meeting 114's
 * room at meeting 113), so it is shown as pending, never added in.
 */

import { decodeAwardRecipients, type OrnodeProposal } from '../../src/lib/newcomers.js';

export interface MeetingSummary {
  meeting: number;
  /** Earliest proposal date for this meeting, YYYY-MM-DD (UTC). */
  date: string;
  rooms: number;
  people: number;
  executedRespect: number;
  pendingRespect: number;
  failedProposals: number;
  state: 'minted' | 'pending' | 'partly minted' | 'failed';
}

export interface LeaderboardRow {
  wallet: string;
  respect: number;
  meetings: number;
  lastMeeting: number;
}

export interface TickHealth {
  /** Highest meeting that has award proposals. */
  latestAwardMeeting: number | null;
  /** Highest "to" number in a tick title ("Increase Tick from 119 to 120"). */
  latestTickTo: number | null;
  /** True when the tick after the latest awarded meeting has been proposed. */
  ok: boolean;
  missingTick: string | null;
}

export interface FractalStats {
  proposals: number;
  meetings: MeetingSummary[];
  leaderboard: LeaderboardRow[];
  totalExecutedRespect: number;
  wallets: number;
  tick: TickHealth;
}

const TICK_TITLE = /tick from (\d+) to (\d+)/i;

function day(ts: number): string {
  return new Date(ts * 1000).toISOString().slice(0, 10);
}

export function summarize(proposals: OrnodeProposal[], zorAddress: string): FractalStats {
  const byMeeting = new Map<
    number,
    { firstTs: number; groups: Set<string>; wallets: Set<string>; exec: number; pend: number; failed: number; proposals: Set<string>; executedProposals: Set<string> }
  >();
  const byWallet = new Map<string, { respect: number; meetings: Set<number> }>();
  let latestTickTo: number | null = null;

  for (const p of proposals) {
    const tick = TICK_TITLE.exec(p.attachment?.propTitle ?? '');
    if (p.attachment?.propType === 'tick' && tick) {
      const to = Number(tick[2]);
      if (latestTickTo === null || to > latestTickTo) latestTickTo = to;
    }

    const recipients = decodeAwardRecipients(p, zorAddress);
    if (recipients.length === 0) continue;
    const executed = p.status === 'Executed';
    const failed = p.status === 'ExecutionFailed';

    for (const r of recipients) {
      let m = byMeeting.get(r.meeting);
      if (!m) {
        m = { firstTs: p.createTs, groups: new Set(), wallets: new Set(), exec: 0, pend: 0, failed: 0, proposals: new Set(), executedProposals: new Set() };
        byMeeting.set(r.meeting, m);
      }
      m.firstTs = Math.min(m.firstTs, p.createTs);
      if (p.attachment?.propType === 'respectBreakoutX2') m.groups.add(`${p.id}`);
      m.wallets.add(r.wallet);
      m.proposals.add(p.id);
      if (executed) {
        m.exec += r.value;
        m.executedProposals.add(p.id);
        let w = byWallet.get(r.wallet);
        if (!w) {
          w = { respect: 0, meetings: new Set() };
          byWallet.set(r.wallet, w);
        }
        w.respect += r.value;
        w.meetings.add(r.meeting);
      } else if (!failed) {
        m.pend += r.value;
      }
    }
    if (failed) {
      const m = byMeeting.get(recipients[0].meeting);
      if (m) m.failed += 1;
    }
  }

  const meetings: MeetingSummary[] = [...byMeeting.entries()]
    .map(([meeting, m]) => {
      const all = m.proposals.size;
      const done = m.executedProposals.size;
      const state: MeetingSummary['state'] =
        done === all ? 'minted' : done > 0 ? 'partly minted' : m.failed === all ? 'failed' : 'pending';
      return {
        meeting,
        date: day(m.firstTs),
        rooms: m.groups.size,
        people: m.wallets.size,
        executedRespect: m.exec,
        pendingRespect: m.pend,
        failedProposals: m.failed,
        state,
      };
    })
    .sort((a, b) => b.meeting - a.meeting);

  const leaderboard: LeaderboardRow[] = [...byWallet.entries()]
    .map(([wallet, w]) => ({ wallet, respect: w.respect, meetings: w.meetings.size, lastMeeting: Math.max(...w.meetings) }))
    .sort((a, b) => b.respect - a.respect || b.meetings - a.meetings);

  const latestAwardMeeting = meetings.length ? meetings[0].meeting : null;
  const ok = latestAwardMeeting === null || (latestTickTo !== null && latestTickTo > latestAwardMeeting);
  const missingTick = ok || latestAwardMeeting === null ? null : `${latestAwardMeeting} to ${latestAwardMeeting + 1}`;

  return {
    proposals: proposals.length,
    meetings,
    leaderboard,
    totalExecutedRespect: leaderboard.reduce((s, r) => s + r.respect, 0),
    wallets: byWallet.size,
    tick: { latestAwardMeeting, latestTickTo, ok, missingTick },
  };
}
