import type { SupabaseClient } from '@supabase/supabase-js';
import type { Client } from 'discord.js';
import { type Member, resolveRoster } from '../lib/nameResolver.js';
import {
  collectReactionPresence,
  collectTextPresence,
  collectVoicePresence,
} from '../lib/discordPresence.js';
import { buildRoster, type PresenceSignal, type RegistryEntry } from '../lib/rosterCapture.js';
import { distributeIntoGroups } from './randomize.js';

type ActionResult = { status: 'done' | 'failed' | 'already_processed'; result?: unknown };

/** Action runner context. Actions that only transform their params ignore it
 * (e.g. randomize); actions that read state use `ctx.supabase`. Actions that
 * read live Discord state (captureRoster) need `ctx.client` - it is optional
 * because the HTTP fallback path and unit tests run without a logged-in bot. */
interface ActionContext {
  supabase: SupabaseClient;
  client?: Client;
}

const ACTIONS: Record<
  string,
  (params: Record<string, unknown>, ctx: ActionContext) => unknown | Promise<unknown>
> = {
  randomize: (params) => {
    const memberIds = params.memberIds as string[];
    const maxGroupSize = params.maxGroupSize as number;
    return { groups: distributeIntoGroups(memberIds, maxGroupSize) };
  },

  /** Resolve a roster of raw Discord display names to Respect members
   * (name + wallet), so a fractal's scoring writes to the right rows.
   * Returns matched / ambiguous / unmatched so the caller can score the
   * clean matches, prompt a human on the ambiguous ones, and register the
   * unmatched. Reads the shared `respect_members` table. */
  resolveMembers: async (params, ctx) => {
    const names = params.names as string[];
    if (!Array.isArray(names)) {
      throw new Error('resolveMembers requires a `names` string array');
    }
    const { data, error } = await ctx.supabase
      .from('respect_members')
      .select('name, wallet_address, fid');
    if (error) throw error;
    const members = (data ?? []) as Member[];
    const resolution = resolveRoster(names, members);
    return {
      matched: resolution.matched.map((m) => ({
        query: m.query,
        name: m.member?.name ?? null,
        wallet: m.member?.wallet_address ?? null,
        fid: m.member?.fid ?? null,
        confidence: m.confidence,
      })),
      ambiguous: resolution.ambiguous.map((m) => ({
        query: m.query,
        candidates: (m.candidates ?? []).map((c) => ({
          name: c.name,
          wallet: c.wallet_address,
        })),
      })),
      unmatched: resolution.unmatched,
    };
  },

  /** Snapshot who is actually present in a fractal session and resolve them to
   * Respect members - the missing piece that lets a fractal run without hand-
   * typing the roster. Reads presence from every configured source (voice
   * channel members, recently-active text authors, reactors on an attendance
   * post, plus a manual name list), merges them, then resolves each person:
   * bound users (users.discord_id -> wallet) win, everyone else falls to name
   * matching. Writes the snapshot to `discord_roster` and returns the
   * matched / ambiguous / unmatched buckets so the operator can /register the
   * stragglers. Requires the live bot client for the Discord reads. */
  captureRoster: async (params, ctx) => {
    if (!ctx.client) {
      throw new Error('captureRoster requires the live bot client (not available on the HTTP path)');
    }
    const guildId = params.guildId as string | undefined;
    if (!guildId) throw new Error('captureRoster requires a `guildId`');

    const voiceChannelId = params.voiceChannelId as string | undefined;
    const textChannelId = params.textChannelId as string | undefined;
    const lookbackMinutes = (params.lookbackMinutes as number | undefined) ?? 90;
    const reaction = params.reaction as { channelId: string; messageId: string } | undefined;
    const manualPresent = (params.manualPresent as string[] | undefined) ?? [];
    const sessionId = (params.sessionId as string | undefined) ?? null;
    // Injectable clock keeps the text-lookback window deterministic in tests.
    const nowMs = (params.nowMs as number | undefined) ?? Date.now();

    // 1. Gather presence from every configured source. Each collector is
    //    defensive (empty list on failure), so one dead source never sinks
    //    the whole capture. Track which sources actually ran + returned.
    const signalLists: PresenceSignal[][] = [];
    const sourcesUsed: Record<string, number> = {};

    if (voiceChannelId) {
      const voice = await collectVoicePresence(ctx.client, guildId, voiceChannelId);
      signalLists.push(voice);
      sourcesUsed.voice = voice.length;
    }
    if (textChannelId) {
      const text = await collectTextPresence(
        ctx.client,
        guildId,
        textChannelId,
        lookbackMinutes * 60_000,
        nowMs,
      );
      signalLists.push(text);
      sourcesUsed.text = text.length;
    }
    if (reaction?.channelId && reaction?.messageId) {
      const reacted = await collectReactionPresence(
        ctx.client,
        guildId,
        reaction.channelId,
        reaction.messageId,
      );
      signalLists.push(reacted);
      sourcesUsed.reaction = reacted.length;
    }
    if (manualPresent.length > 0) {
      const manual: PresenceSignal[] = manualPresent.map((name) => ({
        discordId: null,
        displayName: name,
        source: 'manual',
      }));
      signalLists.push(manual);
      sourcesUsed.manual = manual.length;
    }

    // 2. Load the resolution inputs: Respect members + the registry (users)
    //    rows for just the Discord ids we saw.
    const { data: memberData, error: memberErr } = await ctx.supabase
      .from('respect_members')
      .select('name, wallet_address, fid');
    if (memberErr) throw memberErr;
    const members = (memberData ?? []) as Member[];

    const discordIds = [
      ...new Set(signalLists.flat().map((s) => s.discordId).filter((id): id is string => !!id)),
    ];
    let registry: RegistryEntry[] = [];
    if (discordIds.length > 0) {
      const { data: userData, error: userErr } = await ctx.supabase
        .from('users')
        .select('discord_id, primary_wallet, display_name, fid')
        .in('discord_id', discordIds);
      if (userErr) throw userErr;
      registry = (userData ?? []) as RegistryEntry[];
    }

    // 3. Merge + resolve (pure).
    const roster = buildRoster(signalLists, members, registry);

    // 4. Persist the snapshot. Replace any prior snapshot for this session so
    //    a re-capture is a clean overwrite, not a duplicate pile-up.
    const capturedAt = new Date(nowMs).toISOString();
    if (sessionId) {
      const { error: delErr } = await ctx.supabase
        .from('discord_roster')
        .delete()
        .eq('session_id', sessionId);
      if (delErr) throw delErr;
    }
    const rows = roster.entries.map((e) => ({
      session_id: sessionId,
      discord_id: e.discordId,
      display_name: e.displayName,
      sources: e.sources,
      confidence: e.confidence,
      member_name: e.member?.name ?? null,
      wallet_address: e.member?.wallet ?? null,
      fid: e.member?.fid ?? null,
      captured_at: capturedAt,
    }));
    if (rows.length > 0) {
      const { error: insErr } = await ctx.supabase.from('discord_roster').insert(rows);
      if (insErr) throw insErr;
    }

    // 5. Return the buckets. `unmatched` + `ambiguous` are what the operator
    //    still has to resolve via /register.
    const shape = (e: (typeof roster.entries)[number]) => ({
      discordId: e.discordId,
      displayName: e.displayName,
      sources: e.sources,
      confidence: e.confidence,
      member: e.member,
      candidates: e.candidates,
    });
    return {
      sessionId,
      present: roster.entries.length,
      sourcesUsed,
      matched: roster.matched.map(shape),
      ambiguous: roster.ambiguous.map(shape),
      unmatched: roster.unmatched.map(shape),
    };
  },

  /** Bind a Discord user to a Respect member permanently, so future roster
   * captures resolve them by id (the `registry` tier) instead of guessing by
   * name. The binding lives in the shared ZAO OS `users` table (keyed on
   * discord_id). Given a Respect `memberName`, we look up its canonical wallet
   * and upsert the users row; a raw `wallet` may be passed instead to bind a
   * user who has no Respect member row yet. */
  registerMember: async (params, ctx) => {
    const discordId = params.discordId as string | undefined;
    if (!discordId) throw new Error('registerMember requires a `discordId`');
    const memberName = params.memberName as string | undefined;
    const displayName = params.displayName as string | undefined;
    const fid = (params.fid as number | undefined) ?? null;
    let wallet = (params.wallet as string | undefined) ?? null;

    // Resolve a Respect member name to its canonical wallet if given.
    if (memberName && !wallet) {
      const { data, error } = await ctx.supabase
        .from('respect_members')
        .select('name, wallet_address')
        .eq('name', memberName)
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error(`No Respect member named "${memberName}"`);
      wallet = (data as { wallet_address: string | null }).wallet_address;
    }
    if (!wallet) {
      throw new Error('registerMember requires either a resolvable `memberName` or a `wallet`');
    }

    const { data, error } = await ctx.supabase
      .from('users')
      .upsert(
        {
          discord_id: discordId,
          primary_wallet: wallet,
          ...(displayName ? { display_name: displayName } : {}),
          ...(fid !== null ? { fid } : {}),
        },
        { onConflict: 'discord_id' },
      )
      .select('discord_id, primary_wallet, display_name, fid')
      .single();
    if (error) throw error;

    return { bound: data };
  },
};

/** Single entry point for running a bot command, called by both the
 * Supabase Realtime listener and the HTTP fallback route. Dedupes by
 * `idempotencyKey`: claims the pending row via UPDATE transition from
 * 'pending' to 'processing'. Only one caller can win the claim race. */
export async function executeCommand(
  supabase: SupabaseClient,
  action: string,
  params: Record<string, unknown>,
  idempotencyKey: string,
  requestedBy: string,
  client?: Client,
): Promise<ActionResult> {
  // Reject unknown actions before attempting to claim the row.
  // This ensures invalid actions fail fast without wasting a database claim.
  const runner = ACTIONS[action];
  if (!runner) {
    throw new Error(`Unknown action: ${action}`);
  }

  // Attempt to claim the pending row by transitioning it to 'processing'.
  // This is a conditional update that only matches rows in 'pending' status.
  const { data: claimed, error: claimError } = await supabase
    .from('bot_commands')
    .update({ status: 'processing' })
    .eq('idempotency_key', idempotencyKey)
    .eq('status', 'pending')
    .select()
    .single();

  // If the update did not match any rows, determine why: another caller
  // already claimed it, or there's no row at all (caller error).
  if (claimError) {
    // Supabase returns PGRST116 "no rows returned" when .single() has no matches.
    // This means the row exists but is not in 'pending' state (already claimed
    // or finished), or no row exists at all.
    if (claimError.code === 'PGRST116') {
      const { data: existing } = await supabase
        .from('bot_commands')
        .select()
        .eq('idempotency_key', idempotencyKey)
        .maybeSingle();

      if (existing) {
        // Row exists but is not pending - another caller already claimed or finished it.
        return { status: 'already_processed', result: existing.result };
      }

      // No row exists at all - this is a genuine error, not a race condition.
      throw new Error(`No pending command found for idempotency_key: ${idempotencyKey}`);
    }

    // Some other database error occurred during the claim attempt.
    throw claimError;
  }

  // Successfully claimed the row - now run the action. `await` handles both
  // sync actions (randomize) and async ones (resolveMembers, which reads the DB).
  let result: unknown;
  try {
    result = await runner(params, { supabase, client });
  } catch (err) {
    // Runner threw - update row with failure status and re-throw the error
    // after recording it in the database.
    const { error: updateError } = await supabase
      .from('bot_commands')
      .update({ status: 'failed', result: { error: String(err) }, completed_at: new Date().toISOString() })
      .eq('id', claimed.id);

    if (updateError) {
      // Safe access to error message with fallback to String() conversion
      const errorMessage = updateError?.message ?? String(updateError);
      throw new Error(`Failed to update row after execution failure: ${errorMessage}`);
    }

    return { status: 'failed' };
  }

  // Runner succeeded - update row with success status
  const { error: updateError } = await supabase
    .from('bot_commands')
    .update({ status: 'done', result, completed_at: new Date().toISOString() })
    .eq('id', claimed.id);

  if (updateError) {
    // Safe access to error message with fallback to String() conversion
    const errorMessage = updateError?.message ?? String(updateError);
    throw new Error(`Failed to update row after successful execution: ${errorMessage}`);
  }

  return { status: 'done', result };
}
