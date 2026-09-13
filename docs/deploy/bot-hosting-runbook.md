# Deploying The ZAO Agent on bot-hosting.net

First deployment of fractal bot v2. Nothing in this repo has ever run outside a
laptop, so this document assumes nothing exists yet.

Written 2026-09-13. Every command here is meant to be run by a human at the
panel, in order. Where a step needs a secret, the secret is typed into the
panel by Zaal and never into a chat, a file, or a commit.

## Before you touch the panel

**The one rule that matters: this is a SECOND bot.** v1 is live and running the
weekly game. Two bots sharing one token means every vote is counted twice, and
the damage is silent. The ZAO Agent gets its own Discord application and its own
token. If you find yourself copying a token out of the v1 host, stop.

## 1. Create the Discord application

1. https://discord.com/developers/applications, New Application, name it
   **The ZAO Agent**. The name is deliberate: it is meant to go into more than
   one server and answer questions, not to be fractal-only.
2. Bot tab, Reset Token, copy it once. This is the only time Discord shows it.
   Paste it straight into the panel in step 4, not into a note.
3. Bot tab, Privileged Gateway Intents, enable **Server Members Intent**. The
   roster and voice awareness code needs it (`GatewayIntentBits.GuildMembers`
   in `src/index.ts`). Leave Message Content **off** - the bot keys on who
   spoke and who reacted, never on message text, and the code comment at
   `src/index.ts` says so.
4. Installation tab, or OAuth2 URL Generator: scopes `bot` and
   `applications.commands`. Bot permissions: View Channels, Send Messages,
   Send Messages in Threads, Create Public Threads, Embed Links, Add
   Reactions, Read Message History, Connect, View Voice Channel Members.
   Nothing administrative. Invite it to the ZAO server with the generated URL.

## 2. Create the server on bot-hosting.net

- Panel: https://bot-hosting.net/panel/
- Node.js server. **Node 20 or newer** (`engines` in `package.json`).
- Give it the smallest plan that holds the process; this bot is idle most of
  the time and wakes on gateway events.

## 3. Get the code onto it

The repo is a workspace monorepo (`packages/shared` + root + `web`), so the
panel has to install and build, not just run a file.

Startup command:

```
npm ci && npm run build && npm start
```

`npm run build` builds `@fractalbot/shared` first and then compiles the root
(see `scripts.build`), and `npm start` runs `node dist/index.js`.

Upload by whichever of these the panel offers, in order of preference:

1. Git pull from the repo, if you can give it a deploy key or token.
2. SFTP the working tree **without** `node_modules`, `dist`, `.git` and `.env`.

Never upload a `.env` file. Environment goes in the panel (next step) so the
values live in one place and are not sitting in the file manager.

## 4. Environment variables (set in the panel, not in a file)

Required, or the process exits on boot by design:

| Variable | What it is | Where it comes from |
|---|---|---|
| `DISCORD_TOKEN` | The ZAO Agent's token | Step 1.2. **Not v1's token** |
| `BOT_API_SECRET` | Shared secret for the HTTP control surface | Generate a long random string; the dashboard needs the same value |
| `SUPABASE_URL` | ZAO OS project URL | The ZAO OS project (`efsxtoxvigqowjhgcbiz`), **not** the cowork project. The two have same-named tables and pointing at the wrong one corrupts data silently |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key for that project | ZAO OS project settings |

Optional:

| Variable | Default | Notes |
|---|---|---|
| `HTTP_PORT` | 8080 | Use whatever port the panel allocates |
| `FRACTAL_VOICE_CHANNEL_IDS` | empty (all channels) | Comma-separated channel ids to narrow voice tracking |
| `OPTIMISM_RPC_URL` | `https://mainnet.optimism.io` | Governance reads |
| `NEYNAR_API_KEY` | unset | Farcaster awareness reads |
| `FARCASTER_BOT_FID` | unset | Only used by the (not yet live) write path |

## 5. Verify, in this order

1. **Panel console** shows `HTTP server listening on port <port> (health at /healthz)`,
   then `Logged in as The ZAO Agent#....`. The HTTP line comes first on
   purpose: it appears even when Discord login fails, so a missing second line
   means the token or intents are wrong, not that the box is dead.
2. **Health**: `GET /healthz` returns `{"status":"ok","discord":"connected",...}`.
   It needs no secret. While the gateway is down it returns 503 with
   `"discord":"disconnected"`, which is the difference between "process died"
   and "Discord is unreachable".
3. **Heartbeat row**: the bot upserts `discord_bot_heartbeats` about every 60s.
   If `last_seen` is advancing, Supabase credentials are right. If the console
   looks healthy but this table is not moving, the service role key is wrong -
   which is exactly the failure that left v1 writing nothing for months.
4. **Slash command**: `/start` registers on boot (console prints
   `Respect Game commands registered`). Do NOT run a real fractal as the first
   test. Use a private test channel.

## 6. The thing to check before it touches a real fractal

v1 is still the bot running the game. Until you deliberately hand the game
over, The ZAO Agent should be in the server **without** anyone using `/start`
on it during a live session. Two bots recording one fractal is the same
double-count risk as a shared token, one layer up.

## Rollback

Stop the server in the panel. Nothing else to undo: this bot only ever writes
to its own `discord_*` tables plus `fractal_sessions`, and stopping the process
stops all of it. The v1 bot is untouched by anything here.

## What this does not cover yet

- The `web/` dashboard (leaderboard, `/me`, admin pages) is a separate Next.js
  app and is not deployed by these steps.
- The @-mentionable answering behaviour is not built yet. This runbook gets the
  process running; the agent behaviour is the next piece of work.
