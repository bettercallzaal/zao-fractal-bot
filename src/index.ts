import 'dotenv/config';
import { Client, Events, GatewayIntentBits } from 'discord.js';
import { getSupabaseClient } from './lib/supabaseClient.js';
import { subscribeToCommands } from './commands/subscribeToCommands.js';
import { registerGameCommands, startCommand } from './discord/gameCommands.js';
import { createHttpServer } from './http/server.js';
import { startVoiceTracker } from './awareness/voiceTracker.js';
import { startHeartbeat } from './awareness/heartbeat.js';
import { trackGatewayReadiness } from './awareness/gatewayReadiness.js';

const token = process.env.DISCORD_TOKEN;
if (!token) {
  throw new Error('DISCORD_TOKEN is required - see .env.example');
}
const apiSecret = process.env.BOT_API_SECRET;
if (!apiSecret) {
  throw new Error('BOT_API_SECRET is required - see .env.example');
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers,
    // Roster capture reads message *authors* (text-active presence) and
    // reactors (attendance-post presence). Neither needs the privileged
    // MessageContent intent - we key on presence, not message text.
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
  ],
});

// The HTTP server starts before login, not inside ClientReady, so a Discord
// outage mid-session leaves health answerable instead of leaving no server at
// all. Note what this does NOT buy: an invalid token still kills the process
// (see the login catch below), because an invalid token is not transient and a
// panel restarting a crashed process is more honest than a process that stays
// up serving 503 forever.
const isDiscordReady = trackGatewayReadiness(client);
const supabaseForHttp = getSupabaseClient();

const rawPort = process.env.HTTP_PORT ?? '8080';
const port = Number(rawPort);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error(`HTTP_PORT must be a port number, got ${JSON.stringify(rawPort)}`);
}

// Loopback by default. On a shared panel host, binding every interface puts the
// command surface on the public internet, and nothing consumes that surface in
// this deployment - the dashboard is not deployed. Set HTTP_BIND explicitly to
// widen it, and only once it is behind TLS.
const host = process.env.HTTP_BIND ?? '127.0.0.1';

// The command API is off unless asked for, for the same reason.
const enableCommandApi = process.env.ENABLE_COMMAND_API === 'true';

const server = createHttpServer(supabaseForHttp, apiSecret, {
  isDiscordReady,
  enableCommandApi,
}).listen(port, host, () => {
  console.log(
    `HTTP server listening on ${host}:${port} (health at /healthz, command API ${enableCommandApi ? 'ENABLED' : 'disabled'})`,
  );
});
server.on('error', (err: NodeJS.ErrnoException) => {
  // EADDRINUSE is the realistic first-run mistake here: a second bot on a host
  // that already runs v1, both defaulting to 8080. Uncaught, it reads as a
  // random startup crash instead of a port collision.
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${port} is already in use. Set HTTP_PORT to the port the host gave you.`);
  } else {
    console.error('HTTP server failed:', err.message);
  }
  process.exit(1);
});

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);

  const supabase = supabaseForHttp;
  subscribeToCommands(supabase, readyClient);
  console.log('Subscribed to bot_commands');

  // Respect Game core (Phase 1): /start plus in-thread vote buttons.
  registerGameCommands(readyClient, supabase);

  // Guild-scoped when DISCORD_GUILD_ID is set, global otherwise. Global
  // registration publishes /start to every server this bot is ever added to,
  // and /start writes real rows into fractal_sessions and fractal_scores - the
  // same tables humans read when building an onchain award. This bot is meant
  // to go into more than one server, so the default has to be the narrow one.
  const guildId = process.env.DISCORD_GUILD_ID;
  const commandTarget = guildId
    ? readyClient.guilds.cache.get(guildId)?.commands
    : readyClient.application?.commands;
  if (guildId && !commandTarget) {
    console.error(`DISCORD_GUILD_ID ${guildId} is not a guild this bot is in - /start not registered`);
  } else {
    if (!guildId) {
      console.warn('DISCORD_GUILD_ID is not set - registering /start GLOBALLY, in every server');
    }
    void commandTarget
      ?.create(startCommand.toJSON())
      .then(() => console.log(`Respect Game commands registered (${guildId ? `guild ${guildId}` : 'global'})`))
      .catch((err) => console.error('Failed to register /start:', err));
  }

  // Awareness layer (passive): the bot now watches the room and records it.
  const trackedVoice = (process.env.FRACTAL_VOICE_CHANNEL_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  startVoiceTracker(client, supabase, trackedVoice);
  startHeartbeat(client, supabase);
  console.log(
    `Awareness active: voice tracker (${trackedVoice.length ? trackedVoice.length + ' tracked channel(s)' : 'all channels'}) + heartbeat`,
  );

});

// An invalid token is not transient, so this exits rather than serving 503
// forever. It catches the rejection only to say which failure it was: the bare
// top-level await dumped a discord.js stack trace into the panel console, where
// the useful signal is one line.
await client.login(token).catch((err: Error) => {
  console.error(
    `Discord login failed: ${err.message}\n` +
      'Check DISCORD_TOKEN, and that the Server Members intent is enabled for this application.',
  );
  process.exit(1);
});
