import { describe, expect, it } from 'vitest';
import { encodeFunctionData } from 'viem';
import { MINT_RESPECT_ABI, type OrnodeProposal } from '../../src/lib/newcomers.js';
import { meetingToPeriod, packAwardTokenId } from '../../src/lib/awardVerification.js';
import { summarize } from './fractalStats.js';

const ZOR = '0x9885CCeEf7E8371Bf8d6f2413723D25917E7445c';
const A = '0x00000000000000000000000000000000000000a1';
const B = '0x00000000000000000000000000000000000000b2';
const C = '0x00000000000000000000000000000000000000c3';

let n = 0;
function breakout(meeting: number, ranked: [string, number][], status: string, ts: number): OrnodeProposal {
  const cdata = encodeFunctionData({
    abi: MINT_RESPECT_ABI,
    functionName: 'mintRespectGroup',
    args: [ranked.map(([w, v]) => ({ id: packAwardTokenId(w, meetingToPeriod(meeting), 10), value: BigInt(v) })), '0x'],
  });
  n += 1;
  return { id: `0x${n.toString(16).padStart(64, '0')}`, content: { addr: ZOR, cdata }, attachment: { propType: 'respectBreakoutX2', groupNum: 1 }, createTs: ts, status };
}
function tick(from: number, to: number, ts: number): OrnodeProposal {
  n += 1;
  return { id: `0x${n.toString(16).padStart(64, '0')}`, attachment: { propType: 'tick', propTitle: `Increase Tick from ${from} to ${to} for next meeting` }, createTs: ts, status: 'Executed' };
}

describe('summarize', () => {
  it('counts only Executed awards toward Respect and the leaderboard', () => {
    const s = summarize(
      [breakout(119, [[A, 110], [B, 68]], 'Executed', 1760000000), breakout(120, [[A, 110], [C, 68]], 'NotExecuted', 1760600000)],
      ZOR,
    );
    expect(s.totalExecutedRespect).toBe(178);
    expect(s.leaderboard.map((r) => [r.wallet, r.respect])).toEqual([[A, 110], [B, 68]]);
    expect(s.meetings.map((m) => [m.meeting, m.state, m.executedRespect, m.pendingRespect])).toEqual([
      [120, 'pending', 0, 178],
      [119, 'minted', 178, 0],
    ]);
  });

  it('flags the missing tick after the latest awarded meeting', () => {
    const s = summarize([breakout(119, [[A, 110]], 'Executed', 1), tick(119, 120, 2), breakout(120, [[A, 110]], 'NotExecuted', 3)], ZOR);
    expect(s.tick).toEqual({ latestAwardMeeting: 120, latestTickTo: 120, ok: false, missingTick: '120 to 121' });
  });

  it('is healthy once the next tick is proposed', () => {
    const s = summarize([breakout(120, [[A, 110]], 'NotExecuted', 3), tick(120, 121, 4)], ZOR);
    expect(s.tick.ok).toBe(true);
    expect(s.tick.missingTick).toBeNull();
  });

  it('marks a meeting whose only proposal failed as failed, adding nothing', () => {
    const s = summarize([breakout(114, [[A, 110], [B, 68]], 'ExecutionFailed', 5)], ZOR);
    expect(s.meetings[0]).toMatchObject({ meeting: 114, state: 'failed', executedRespect: 0, pendingRespect: 0, failedProposals: 1 });
    expect(s.totalExecutedRespect).toBe(0);
  });

  it('ignores proposals to other contracts and ticks for awards', () => {
    const other = breakout(119, [[A, 110]], 'Executed', 1);
    other.content = { addr: '0x0000000000000000000000000000000000000001', cdata: other.content!.cdata };
    const s = summarize([other, tick(1, 2, 2)], ZOR);
    expect(s.meetings).toEqual([]);
    expect(s.tick.ok).toBe(true);
  });
});
