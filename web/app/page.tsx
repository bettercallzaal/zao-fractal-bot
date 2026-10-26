import { getDashboardData, REVALIDATE_SECONDS } from '../lib/fractalData.js';
import type { MeetingSummary } from '../lib/fractalStats.js';

export const revalidate = REVALIDATE_SECONDS;

const DISCORD_URL = 'https://discord.thezao.com';
const FRAPPS_URL = 'https://zao.frapps.xyz';
const LADDER = [110, 68, 42, 26, 16, 10];
const MEETINGS_SHOWN = 20;
const LEADERS_SHOWN = 25;

const nf = new Intl.NumberFormat('en-US');

function etTime(iso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(new Date(iso));
}

function shortWallet(w: string): string {
  return `${w.slice(0, 6)}...${w.slice(-4)}`;
}

const STATE_LABEL: Record<MeetingSummary['state'], [string, string]> = {
  minted: ['minted', 'Minted'],
  pending: ['pending', 'Awaiting execution'],
  'partly minted': ['partly', 'Partly minted'],
  failed: ['failed', 'Mint failed'],
};

export default async function HomePage() {
  const { stats, statsError, upcoming, fetchedAt } = await getDashboardData();
  const next = upcoming.slice(0, 2);

  return (
    <main className="wrap">
      <header className="masthead">
        <div>
          <p className="eyebrow">The ZAO</p>
          <h1>ZAO Fractal</h1>
          <p className="lede">
            Every week ZAO members meet in small rooms, share what they did for the community, and rank each other.
            Rankings become <strong>Respect</strong>, minted on Optimism. This page reads that record live.
          </p>
        </div>
        <aside className="next" aria-labelledby="next-heading">
          <h2 id="next-heading">Next fractal</h2>
          {next.length > 0 ? (
            next.map((e) => (
              <a key={e.url} className="event" href={e.url} target="_blank" rel="noreferrer" style={{ textDecoration: 'none', color: 'inherit' }}>
                <span className="event-time">{etTime(e.startAt)}</span>
                <span className="event-name">{e.name}</span>
              </a>
            ))
          ) : (
            <p className="event-name">Mondays at 6 PM ET. See luma.com/zao for this week.</p>
          )}
          <a className="join" href={DISCORD_URL} target="_blank" rel="noreferrer">
            Join on Discord
          </a>
        </aside>
      </header>

      {stats ? (
        <>
          <div className="stats">
            <div className="stat">
              <div className="stat-value">{nf.format(stats.meetings[0]?.meeting ?? 0)}</div>
              <div className="stat-label">latest meeting on record</div>
            </div>
            <div className="stat">
              <div className="stat-value">{nf.format(stats.wallets)}</div>
              <div className="stat-label">members with Respect</div>
            </div>
            <div className="stat">
              <div className="stat-value">{nf.format(stats.totalExecutedRespect)}</div>
              <div className="stat-label">Respect minted</div>
            </div>
            <div className="stat">
              <div className="stat-value">{nf.format(stats.proposals)}</div>
              <div className="stat-label">proposals on record</div>
            </div>
          </div>

          {stats.tick.ok ? (
            <div className="notice ok" role="status">
              <span className="pill minted">On schedule</span>
              <p>The meeting counter is ready for the next fractal.</p>
            </div>
          ) : (
            <div className="notice warn" role="status">
              <span className="pill pending">Needs a tick</span>
              <p>
                Meeting {stats.tick.latestAwardMeeting} has results, but the tick from {stats.tick.missingTick} has not been
                proposed yet. Until it passes, the next meeting&apos;s results can&apos;t be proposed the usual way.
              </p>
            </div>
          )}

          <section aria-labelledby="meetings-heading">
            <h2 id="meetings-heading">Meetings</h2>
            <p className="sub">
              The last {MEETINGS_SHOWN} meetings with results on record. Respect counts once a proposal is executed; until then it
              shows as awaiting.
            </p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Meeting</th>
                    <th>Proposed</th>
                    <th className="num">Rooms</th>
                    <th className="num">People</th>
                    <th className="num">Respect minted</th>
                    <th className="num">Awaiting</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.meetings.slice(0, MEETINGS_SHOWN).map((m) => {
                    const [cls, label] = STATE_LABEL[m.state];
                    return (
                      <tr key={m.meeting}>
                        <td>#{m.meeting}</td>
                        <td>{m.date}</td>
                        <td className="num">{m.rooms || '-'}</td>
                        <td className="num">{m.people}</td>
                        <td className="num">{nf.format(m.executedRespect)}</td>
                        <td className="num">{m.pendingRespect ? nf.format(m.pendingRespect) : '-'}</td>
                        <td>
                          <span className={`pill ${cls}`}>{label}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section aria-labelledby="respect-heading">
            <h2 id="respect-heading">Respect</h2>
            <p className="sub">Top {LEADERS_SHOWN} wallets by Respect minted through the fractal, from executed proposals only.</p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th className="num">#</th>
                    <th>Wallet</th>
                    <th className="num">Respect</th>
                    <th className="num">Meetings</th>
                    <th className="num">Last seen</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.leaderboard.slice(0, LEADERS_SHOWN).map((r, i) => (
                    <tr key={r.wallet}>
                      <td className="num">{i + 1}</td>
                      <td className="mono">
                        <a href={`https://optimistic.etherscan.io/address/${r.wallet}`} target="_blank" rel="noreferrer">
                          {shortWallet(r.wallet)}
                        </a>
                      </td>
                      <td className="num">{nf.format(r.respect)}</td>
                      <td className="num">{r.meetings}</td>
                      <td className="num">#{r.lastMeeting}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : (
        <div className="notice bad" role="alert">
          <span className="pill failed">Record unavailable</span>
          <p>The Respect record could not be read just now ({statsError}). The page tries again within five minutes.</p>
        </div>
      )}

      <section aria-labelledby="how-heading" className="how">
        <h2 id="how-heading">How a fractal works</h2>
        <p>Join the waiting room on Discord. People are split into rooms of up to six.</p>
        <p>Each person shares what they did for The ZAO that week. The room agrees a ranking from first to sixth.</p>
        <p>The rankings are proposed on-chain and, once the vote passes, minted as Respect on this ladder:</p>
        <ol className="ladder">
          {LADDER.map((v, i) => (
            <li key={v}>
              <b>{i + 1}</b> {v}
            </li>
          ))}
        </ol>
      </section>

      <footer>
        <p>
          Source: the ZAO ornode proposal record, the same one <a href={FRAPPS_URL}>zao.frapps.xyz</a> reads, and the ZAO
          Luma calendar. Read {etTime(fetchedAt)}; refreshed every five minutes.
        </p>
      </footer>
    </main>
  );
}
