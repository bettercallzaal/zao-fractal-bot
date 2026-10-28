# Fractal award roster preflight

Run this immediately before preparing each room's award proposal:

```sh
bin/zao-fractal-checklist --check-roster /path/to/fractal-122-group-1.json
```

Example input shape (use the actual named attendees and room):

```json
{
  "meeting": 122,
  "awards": [
    { "name": "Attendee name", "wallet": "0x...", "room": "Group 1", "rank": 1 }
  ]
}
```

`wallet` may be omitted only when the exact attendee name has one wallet in the canonical registry. The check reads `respect_members.name/wallet_address` and `users.display_name/primary_wallet`; it does not use fuzzy name matching or the nonexistent `wallets` table. If the name has no exact verified wallet, the supplied wallet differs from the registry, or the identity is ambiguous, it exits blocked. It also rejects duplicate wallets within one meeting and uses read-only Optimism `balanceOf` calls for the target meeting's packed award IDs across the mint types already observed in ZOR history. Any positive balance or RPC error blocks the roster.

Only `ROSTER CLEAR` means every row resolved and all expected award balances read as zero. Review the output and the room's ranked roster before manually preparing the proposal in zao.frapps.xyz. The command never builds, submits, or executes a transaction. It requires the local bot environment's `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and normal Optimism RPC configuration. Never run it from browser-facing code; the service-role key remains server-side.
