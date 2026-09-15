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
   `applications.commands`. Bot permissions, and only these: View Channels,
   Send Messages, Send Messages in Threads, Create Public Threads, Embed
   Links, Read Message History. Nothing administrative.
   Invite it to the ZAO server with the generated URL.

   Deliberately NOT requested: **Connect** (the bot never joins a voice
   channel - there is no @discordjs/voice dependency; voice presence comes
   from reading `channel.members` and `VoiceStateUpdate`) and **Add
   Reactions** (it reads reactors, it never reacts). An earlier version of
   this list asked for both, plus a "View Voice Channel Members" that is not
   a Discord permission at all.

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
2. SFTP the working tree **without** `node_modules`, `dist`, `.git`, `.env`,
   `.handoffs` and `.serena`. The last two hold session notes that have no
   business on a host, and the repo's secret scanner does not cover untracked
   files.

Never upload a `.env` file. Environment goes in the panel (next step) so the
values live in one place and are not sitting in the file manager.

**A known weakness of building on the host, worth fixing when there is time.**
`package.json` lists `web` as a workspace, so `npm ci` here also installs the
dashboard's tree - Next.js, next-auth, wagmi, siwe, React - hundreds of
packages this process never imports, whose install scripts run in the same
environment that holds the Discord token and the Supabase service role key,
on every restart including crash restarts. The better shape is to build in CI
and ship `dist/` with a production-only install, leaving the startup command
as `npm start` alone.

## 4. Environment variables (set in the panel, not in a file)

Required, or the process exits on boot by design:

| Variable | What it is | Where it comes from |
|---|---|---|
| `DISCORD_TOKEN` | The ZAO Agent's token | Step 1.2. **Not v1's token** |
| `BOT_API_SECRET` | Secret for the HTTP control surface | Generate with `openssl rand -hex 32` on the machine you will paste from. Not a passphrase: there is no rate limiting on that endpoint, so the entropy is the whole defence. Never reuse it as `NEXTAUTH_SECRET` |
| `SUPABASE_URL` | ZAO OS project URL | The ZAO OS project (`efsxtoxvigqowjhgcbiz`), **not** the cowork project. The two have same-named tables and pointing at the wrong one corrupts data silently |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key for that project | ZAO OS project settings |

Optional:

| Variable | Default | Notes |
|---|---|---|
| `DISCORD_GUILD_ID` | unset | **Set this.** Unset registers `/start` globally, in every server the bot is ever added to. Set to the ZAO server id, it registers there only. The console says which it did |
| `BOT_INSTANCE_NAME` | `fractalbot` | The heartbeat row this instance owns. Give the hosted bot its own name (e.g. `zao-agent-prod`), otherwise two instances share one row and look like one |
| `HTTP_BIND` | `127.0.0.1` | Loopback by default, so the command surface is not on the public internet of a shared host. Widen only behind TLS |
| `ENABLE_COMMAND_API` | off | `true` mounts `POST /commands/:action`. Leave it off: nothing consumes it until the dashboard is deployed, and a route that does not exist cannot be brute-forced |
| `HTTP_PORT` | 8080 | Use whatever port the panel allocates. A non-numeric value now fails at boot rather than silently binding a random port |
| `FRACTAL_VOICE_CHANNEL_IDS` | empty (all channels) | Comma-separated channel ids to narrow voice tracking |
| `OPTIMISM_RPC_URL` | `https://mainnet.optimism.io` | Governance reads |
| `NEYNAR_API_KEY` | unset | Farcaster awareness reads |
| `FARCASTER_BOT_FID` | unset | Only used by the (not yet live) write path |

## 5. Verify, in this order

1. **Panel console** shows
   `HTTP server listening on 127.0.0.1:<port> (health at /healthz, command API disabled)`,
   then `Logged in as The ZAO Agent#...`, then
   `Respect Game commands registered (guild <id>)`.

   If the token is wrong you get one line, `Discord login failed: An invalid
   token was provided.`, and the process exits 1 and the panel restarts it.
   **Health is not reachable in that state** - the process is gone. An earlier
   version of this document claimed otherwise; it was measured and it is wrong.
   Health survives a gateway outage *after* a successful login, which is the
   case it is for.
2. **Health**: `GET /healthz` returns `{"status":"ok","discord":"connected",...}`.
   No secret needed. During a gateway outage it returns 503 with
   `"discord":"disconnected"`. Because `HTTP_BIND` is loopback, you check this
   from the panel's own console, not from your laptop.
3. **Heartbeat row**: the bot upserts `discord_bot_heartbeats` about every 60s
   under `BOT_INSTANCE_NAME`. Two things to check, not one:
   - `last_seen` for this instance is advancing. If the console looks healthy
     but this is still, the service role key is wrong - exactly the failure
     that left v1 writing nothing for months.
   - **exactly one** row is advancing for this instance name. Two advancing
     rows for one name means two processes are running, which is the
     double-recording risk in section 6.
4. **Slash command**: `/start` registers on boot (console prints
   `Respect Game commands registered`). Do NOT run a real fractal as the first
   test. Use a private test channel.

## 6. Two bots, one game

v1 is still the bot running the game. Until you deliberately hand the game
over, nobody should run `/start` on The ZAO Agent during a live session.

That used to be a sentence in a document and nothing else. As of the security
review on 2026-09-13 there are three real controls:

- **`/start` is permission-gated** (Manage Threads) instead of runnable by
  every member. The group minimum is 2 and a two-person majority is unanimity,
  so before this, any two accounts could rank each other into a 110 and 68
  result recorded against a real meeting number.
- **`/start` registers to one guild** when `DISCORD_GUILD_ID` is set, instead
  of to every server the bot joins.
- **Migration `0007` makes the double-record a database error.** One active
  `fractal_sessions` row per thread, enforced by a partial unique index. Apply
  it before the bot goes near a live fractal. Without it, two instances that
  both answer one `/start` write two sessions, every vote lands twice, and
  `completeSession` writes two full sets of scores - 110 plus 110 - into the
  table a human reads when building the onchain award.

**Migration 0007 is not applied yet.** It is in `supabase/migrations/`, and it
is the only one of the three that needs a step outside this runbook.

## Rollback

Stop the server in the panel. Nothing else to undo: this bot only ever writes
to its own `discord_*` tables plus `fractal_sessions`, and stopping the process
stops all of it. The v1 bot is untouched by anything here.

## The risk this deployment does not remove, and Zaal has to decide on

`SUPABASE_SERVICE_ROLE_KEY` bypasses row-level security on every table in the
ZAO OS project, and that project's `users` table holds members' Lens access and
refresh tokens, a Hive posting key, a Bluesky app password, a Farcaster signer
uuid, and their payout wallets. `scripts/backup-fractal-tables.mjs` already
refuses to dump that table wholesale for exactly this reason. Putting that key
on a cheap shared panel host means a panel-side compromise is not "fractal data
leaked" - it is members' social accounts taken over, and
`update users set primary_wallet = ...` redirecting future Respect awards at
the source. Rotating the key is all-or-nothing: it also breaks the ZAO OS app
and the dashboard.

Two ways out, cheapest first, neither done:

1. **Move the credential columns out of `users`.** The bot reads only
   `discord_id, primary_wallet, display_name, fid`. Splitting the tokens and
   keys into their own table removes them from the blast radius without
   touching how anything authenticates. Biggest reduction per hour of work.
2. **Replace the service role key with a scoped Postgres role** that has
   column-level grants on `users` and table grants on the `discord_*` and
   `fractal_*` tables. Needs RLS policies for that role on tables that
   currently rely on service-role bypass (`bot_commands` has RLS on with no
   policies at all), and Realtime needs re-verifying under it.

Neither is a code change in this repo, which is why neither is in the pull
request that added this document.

## What this does not cover yet

- The `web/` dashboard (leaderboard, `/me`, admin pages) is a separate Next.js
  app and is not deployed by these steps.
- The @-mentionable answering behaviour is not built yet. This runbook gets the
  process running; the agent behaviour is the next piece of work.
