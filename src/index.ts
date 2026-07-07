import 'dotenv/config';
import { Client, Events, GatewayIntentBits } from 'discord.js';
import { getSupabaseClient } from './lib/supabaseClient.js';
import { subscribeToCommands } from './commands/subscribeToCommands.js';
import { createHttpServer } from './http/server.js';

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
  ],
});

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);

  const supabase = getSupabaseClient();
  subscribeToCommands(supabase);
  console.log('Subscribed to bot_commands');

  const port = Number(process.env.HTTP_PORT ?? 8080);
  createHttpServer(supabase, apiSecret).listen(port, () => {
    console.log(`HTTP fallback server listening on port ${port}`);
  });
});

await client.login(token);
