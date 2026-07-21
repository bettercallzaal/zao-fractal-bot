import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import type { Client } from 'discord.js';
import { executeCommand } from './executeCommand.js';

/** Listens for new rows in bot_commands and executes them. Only reacts to
 * status='pending' inserts - rows inserted directly as 'processing' (e.g.
 * by the HTTP fallback racing ahead) are left alone since executeCommand's
 * own dedupe already claimed them. The live Discord `client` is passed through
 * so actions that read Discord state (captureRoster) can reach it. */
export function subscribeToCommands(supabase: SupabaseClient, client?: Client): RealtimeChannel {
  return supabase
    .channel('bot_commands_listener')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'bot_commands' },
      async (payload) => {
        const row = payload.new as { action: string; params: Record<string, unknown>; idempotency_key: string; requested_by: string; status: string };
        if (row.status !== 'pending') return;

        try {
          await executeCommand(supabase, row.action, row.params, row.idempotency_key, row.requested_by, client);
        } catch (err) {
          console.error(`Failed to execute command ${row.idempotency_key}:`, err);
        }
      },
    )
    .subscribe();
}
