import 'dotenv/config';
import { Client, Events, GatewayIntentBits } from 'discord.js';
import { getSupabaseClient } from './lib/supabaseClient.js';
import { subscribeToCommands } from './commands/subscribeToCommands.js';
import { registerGameCommands, startCommand } from './discord/gameCommands.js';
import { createHttpServer } from './http/server.js';
import { startVoiceTracker } from './awareness/voiceTracker.js';
import { startHeartbeat } from './awareness/heartbeat.js';

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

// The HTTP server starts before login, not inside ClientReady. A host asking
// "is this process healthy" most needs an answer when the gateway is NOT up -
// a bad token or a Discord outage used to mean no server at all, which looks
// identical to a dead box.
let discordReady = false;
const supabaseForHttp = getSupabaseClient();
const port = Number(process.env.HTTP_PORT ?? 8080);
createHttpServer(supabaseForHttp, apiSecret, { isDiscordReady: () => discordReady }).listen(
  port,
  () => {
    console.log(`HTTP server listening on port ${port} (health at /healthz)`);
  },
);

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);
  discordReady = true;

  const supabase = supabaseForHttp;
  subscribeToCommands(supabase, readyClient);
  console.log('Subscribed to bot_commands');

  // Respect Game core (Phase 1): /start plus in-thread vote buttons.
  registerGameCommands(readyClient, supabase);
  void readyClient.application?.commands
    .create(startCommand.toJSON())
    .then(() => console.log('Respect Game commands registered'))
    .catch((err) => console.error('Failed to register /start:', err));

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

client.on(Events.ShardDisconnect, () => {
  discordReady = false;
});
client.on(Events.ShardResume, () => {
  discordReady = true;
});

await client.login(token);
