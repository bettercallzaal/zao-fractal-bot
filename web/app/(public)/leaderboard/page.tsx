import { getLeaderboard } from '../../../lib/getLeaderboard.js';
import { getSupabaseClient } from '../../../lib/supabaseClient.js';
import { PublicLeaderboard } from '../../../components/PublicLeaderboard.js';

// Reads the v2 database per request; it has no credentials at build time.
export const dynamic = 'force-dynamic';

export default async function LeaderboardPage() {
  const supabase = getSupabaseClient();
  const leaderboard = await getLeaderboard(supabase);

  return (
    <main>
      <h1>ZAO Fractal Respect Leaderboard</h1>
      <PublicLeaderboard
        entries={leaderboard.map(({ walletAddress, weight }) => ({ walletAddress, weight }))}
      />
    </main>
  );
}
