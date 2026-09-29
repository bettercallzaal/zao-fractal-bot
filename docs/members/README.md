# Members roster

`roster.json` lists every wallet that has ever been named in a ZOR Respect award proposal. It is rebuilt from ZAO's ornode (`zao-ornode.frapps.xyz`, the same store zao.frapps.xyz reads).

## Capturing new people

After any fractal, or after someone submits an intro proposal:

```
npm run newcomers            # report wallets roster.json has not seen
npm run newcomers -- --write # add them, then commit roster.json
```

A line tagged `NEW-TO-ZAO` is a pending award to a wallet that holds no ZOR and no OG Respect. That is someone brand new, and the time to onboard them is before the vote closes.

## Fields

- `label`: the person's name, filled in by a human. `--write` never overwrites it.
- `firstSeen` / `firstMeeting`: when the wallet was first proposed. Sort by `firstSeen`. `firstMeeting` comes from the award id, and proposers sometimes mistype it (Dank Phart's meeting-110 intro was minted as meeting 1).
- `firstStatus`: `Executed`, `NotExecuted` (still pending) or `ExecutionFailed`.
- `executedRespect`: ZOR Respect from executed proposals only.
- `zorAtCapture` / `ogAtCapture`: on-chain balances read when the wallet was first captured. They are not updated afterwards.

## Coverage

ornode's history starts around meeting 68 (2025-09-15). OG-era members who never received a ZOR award are not in this file.
