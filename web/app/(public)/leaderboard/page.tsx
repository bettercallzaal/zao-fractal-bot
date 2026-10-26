import { getLeaderboard } from '../../../lib/getLeaderboard.js';
import { getSupabaseClient } from '../../../lib/supabaseClient.js';

// Reads the v2 database per request; it has no credentials at build time.
export const dynamic = 'force-dynamic';

export default async function LeaderboardPage() {
  const supabase = getSupabaseClient();
  const leaderboard = await getLeaderboard(supabase);

  return (
    <main>
      <h1>ZAO Fractal Respect Leaderboard</h1>
      <table>
        <thead>
          <tr>
            <th>Rank</th>
            <th>Discord ID</th>
            <th>Wallet</th>
            <th>Respect</th>
          </tr>
        </thead>
        <tbody>
          {leaderboard.map((entry, i) => (
            <tr key={entry.discordId}>
              <td>{i + 1}</td>
              <td>{entry.discordId}</td>
              <td>{entry.walletAddress}</td>
              <td>{entry.weight}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
