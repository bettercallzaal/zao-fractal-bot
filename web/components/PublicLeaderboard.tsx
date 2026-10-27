import React from 'react';

export interface PublicLeaderboardEntry {
  walletAddress: string | null;
  weight: number;
}

function shortWallet(wallet: string): string {
  return wallet.length > 14 ? `${wallet.slice(0, 6)}…${wallet.slice(-4)}` : wallet;
}

export function PublicLeaderboard({ entries }: { entries: PublicLeaderboardEntry[] }) {
  return (
    <table>
      <thead>
        <tr>
          <th>Rank</th>
          <th>Wallet</th>
          <th>Respect</th>
        </tr>
      </thead>
      <tbody>
        {entries.map((entry, i) => (
          <tr key={entry.walletAddress ?? `missing-wallet-${i}`}>
            <td>{i + 1}</td>
            <td>
              {entry.walletAddress ? (
                <a href={`https://optimistic.etherscan.io/address/${entry.walletAddress}`}>
                  {shortWallet(entry.walletAddress)}
                </a>
              ) : (
                'Wallet unavailable'
              )}
            </td>
            <td>{entry.weight}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
