import type { SupabaseClient } from '@supabase/supabase-js';
import type { Client } from 'discord.js';
import { type Member, resolveRoster } from '../lib/nameResolver.js';
import {
  collectReactionPresence,
  collectTextPresence,
  collectVoicePresence,
} from '../lib/discordPresence.js';
import { buildRoster, type PresenceSignal, type RegistryEntry } from '../lib/rosterCapture.js';
import { fetchFarcasterProfiles } from '../lib/farcaster.js';
import { makeOptimismClient, readOrecConfig, readProposalStatus } from '../lib/governance.js';
import { findEntry, listTopics } from '../lib/fractalKnowledge.js';
import { buildWelcomeMessage } from '../lib/welcome.js';
import {
  bucketByMember,
  type ContributionRow,
  DEFAULT_LOOKBACK_HOURS,
  formatContributionDigest,
  normalizeContribution,
} from '../lib/contributions.js';
import {
  indexIdentities,
  type RespectMemberRow,
  type UnifiedIdentity,
  type UserRow,
  unifyIdentities,
  type WalletRow,
} from '../lib/identityBridge.js';
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

  /** Bridge a member's identity across Discord, chain, and Farcaster. Reads
   * respect_members (name, wallet, fid), users (discord_id, wallet, fid), and
   * wallets (discord_id, wallet), and folds them into one record per member so
   * the bot knows that a Discord user, an on-chain wallet, and a Farcaster fid
   * are the same person. Optionally filter to specific `discordIds` or
   * `wallets` (e.g. the members a roster capture just found). This is the
   * foundation of every Farcaster<->Discord integration. Read-only. */
  bridgeIdentities: async (params, ctx) => {
    const [members, users, wallets] = await Promise.all([
      ctx.supabase.from('respect_members').select('name, wallet_address, fid'),
      ctx.supabase.from('users').select('discord_id, primary_wallet, display_name, fid'),
      ctx.supabase.from('wallets').select('discord_id, wallet_address'),
    ]);
    if (members.error) throw members.error;
    if (users.error) throw users.error;
    if (wallets.error) throw wallets.error;

    const identities = unifyIdentities({
      respectMembers: (members.data ?? []) as RespectMemberRow[],
      users: (users.data ?? []) as UserRow[],
      wallets: (wallets.data ?? []) as WalletRow[],
    });

    // Optional filtering by the caller's scope.
    const wantDiscord = params.discordIds as string[] | undefined;
    const wantWallets = (params.wallets as string[] | undefined)?.map((w) => w.toLowerCase());
    let filtered = identities;
    if (wantDiscord || wantWallets) {
      const dSet = new Set(wantDiscord ?? []);
      const wSet = new Set(wantWallets ?? []);
      filtered = identities.filter(
        (id) => (id.discordId && dSet.has(id.discordId)) || wSet.has(id.wallet),
      );
    }

    return {
      identities: filtered,
      counts: {
        total: filtered.length,
        withDiscord: filtered.filter((i) => i.discordId).length,
        withFid: filtered.filter((i) => i.fid !== null).length,
      },
    };
  },

  /** Read Farcaster awareness for members: given `fids` directly, or `wallets`
   * / `discordIds` (resolved to fids via the identity bridge), return each
   * member's Farcaster profile (username, display name, verified addresses).
   * Reuses ZAO's Neynar path - reads only, no bot FID needed. Read-only. */
  resolveFarcaster: async (params, ctx) => {
    let fids = (params.fids as number[] | undefined) ?? [];
    const wantWallets = params.wallets as string[] | undefined;
    const wantDiscord = params.discordIds as string[] | undefined;

    // If wallets/discordIds were given, resolve them to fids via the bridge.
    if (wantWallets || wantDiscord) {
      const [members, users] = await Promise.all([
        ctx.supabase.from('respect_members').select('name, wallet_address, fid'),
        ctx.supabase.from('users').select('discord_id, primary_wallet, display_name, fid'),
      ]);
      if (members.error) throw members.error;
      if (users.error) throw users.error;
      const idx = indexIdentities(
        unifyIdentities({
          respectMembers: (members.data ?? []) as RespectMemberRow[],
          users: (users.data ?? []) as UserRow[],
        }),
      );
      const resolved: UnifiedIdentity[] = [];
      for (const w of wantWallets ?? []) {
        const hit = idx.byWallet.get(w.toLowerCase());
        if (hit) resolved.push(hit);
      }
      for (const d of wantDiscord ?? []) {
        const hit = idx.byDiscordId.get(d);
        if (hit) resolved.push(hit);
      }
      fids = [...fids, ...resolved.map((r) => r.fid).filter((f): f is number => f !== null)];
    }

    const profiles = await fetchFarcasterProfiles(fids);
    return { profiles: [...profiles.values()] };
  },

  /** Governance awareness: read ZAO's live OREC contract on Optimism. Returns
   * the real governance parameters (voting/veto window lengths, minimum weight
   * to pass, the vote-weight token, the executor owner), and optionally the
   * live stage + vote status of a specific proposal (`propId`). Read-only,
   * on-chain, no ornode config needed. */
  governanceAwareness: async (params) => {
    const client = makeOptimismClient();
    const config = await readOrecConfig(client);
    const propId = params.propId as string | undefined;
    const proposal =
      propId && /^0x[0-9a-fA-F]{64}$/.test(propId)
        ? await readProposalStatus(client, propId as `0x${string}`)
        : undefined;
    return { config, proposal };
  },

  /** Farcaster posting - the write half of the integration, reusing @zolbot's
   * identity (FARCASTER_BOT_FID). DRAFT-ONLY and human-gated by design: it
   * records the intended cast in `discord_bot_events` (event_type
   * 'farcaster_draft') and returns it for review. It never submits to the
   * Farcaster hub - approving + publishing a draft is a deliberate, separate
   * step (same gate ZOL uses). This keeps the bot from ever auto-posting. */
  draftCast: async (params, ctx) => {
    const text = params.text as string | undefined;
    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      throw new Error('draftCast requires non-empty `text`');
    }
    if (text.length > 1024) {
      throw new Error('draftCast text exceeds Farcaster 1024-byte cast limit');
    }
    const fid = Number(process.env.FARCASTER_BOT_FID ?? 0) || null;
    const draft = {
      text: text.trim(),
      fid,
      reason: (params.reason as string | undefined) ?? null,
      createdAt: new Date().toISOString(),
    };
    // Record the draft as an awareness event so it surfaces on the dashboard
    // for human approval. Best-effort; the draft is still returned on failure.
    const { error } = await ctx.supabase.from('discord_bot_events').insert({
      event_type: 'farcaster_draft',
      detail: draft,
      created_at: draft.createdAt,
    });
    if (error) console.error('draftCast: failed to record draft', error.message);
    return { status: 'drafted', draft, note: 'Not posted. Approve + publish separately (human-gated).' };
  },

  /** Serve the fractal's documentation in Discord. Given a `topic`, returns the
   * matching knowledge-base entry (what the fractal is, Respect, the game,
   * scoring, governance with live-verified numbers, the two ledgers, contracts,
   * running a fractal, the roadmap). With no topic - or an unrecognized one -
   * returns the list of topics a member can ask about. Pure, no reads. This is
   * the consolidated fractal documentation, carried inside the bot. */
  explain: (params) => {
    const topic = (params.topic as string | undefined)?.trim();
    const topics = listTopics();

    if (!topic || /^(list|help|topics|\?)$/i.test(topic)) {
      return {
        kind: 'topics',
        prompt: 'Ask me about the fractal. Topics:',
        topics,
      };
    }

    const entry = findEntry(topic);
    if (!entry) {
      return {
        kind: 'not_found',
        message: `No fractal topic matches "${topic}". Try one of these:`,
        topics,
      };
    }

    return {
      kind: 'entry',
      key: entry.key,
      title: entry.title,
      body: entry.body,
      related: entry.see.map((k) => topics.find((t) => t.key === k)).filter(Boolean),
    };
  },

  /** Log a contribution outside the live call, so the circle sees async work
   * when it ranks. Validation + link extraction is pure (contributions lib);
   * this is the thin insert into `discord_contributions`. `displayName` is
   * required because not every contributor has a bound users row; when a
   * discordId IS bound, roster captures resolve identity from it later. */
  submitContribution: async (params, ctx) => {
    const displayName = (params.displayName as string | undefined)?.trim();
    if (!displayName) {
      throw new Error('submitContribution requires a `displayName`');
    }
    const { content, links } = normalizeContribution(params.content as string);
    const discordId = (params.discordId as string | undefined) ?? null;
    const meetingNumber = (params.meetingNumber as number | undefined) ?? null;

    const { data, error } = await ctx.supabase
      .from('discord_contributions')
      .insert({
        discord_id: discordId,
        display_name: displayName,
        content,
        links,
        meeting_number: meetingNumber,
        source: (params.source as string | undefined) ?? 'command',
      })
      .select('id, created_at')
      .single();
    if (error) throw error;

    return {
      recorded: true,
      id: data?.id ?? null,
      displayName,
      links,
      meetingNumber,
      message:
        `Logged for ${displayName}` +
        (meetingNumber ? ` (meeting ${meetingNumber})` : ' (next meeting)') +
        ' - the circle will see it when ranking.',
    };
  },

  /** The facilitator's view of async work: everything logged for a meeting
   * number (plus untagged rows from the lookback window), bucketed per member
   * with a Discord-ready digest. `markReviewed: true` stamps the returned
   * rows so the next listing shows only new arrivals. */
  listContributions: async (params, ctx) => {
    const meetingNumber = (params.meetingNumber as number | undefined) ?? null;
    const lookbackHours =
      (params.lookbackHours as number | undefined) ?? DEFAULT_LOOKBACK_HOURS;
    const unreviewedOnly = (params.unreviewedOnly as boolean | undefined) ?? false;
    // Injectable clock keeps the lookback window deterministic in tests.
    const nowMs = (params.nowMs as number | undefined) ?? Date.now();
    const since = new Date(nowMs - lookbackHours * 3_600_000).toISOString();

    let query = ctx.supabase
      .from('discord_contributions')
      .select('id, discord_id, display_name, content, links, meeting_number, reviewed, created_at');
    query = meetingNumber
      ? query.or(`meeting_number.eq.${meetingNumber},and(meeting_number.is.null,created_at.gte.${since})`)
      : query.gte('created_at', since);
    if (unreviewedOnly) query = query.eq('reviewed', false);
    const { data, error } = await query;
    if (error) throw error;
    const rows = (data ?? []) as ContributionRow[];

    if (params.markReviewed === true && rows.length > 0) {
      const { error: updErr } = await ctx.supabase
        .from('discord_contributions')
        .update({ reviewed: true })
        .in('id', rows.map((r) => r.id));
      if (updErr) throw updErr;
    }

    const buckets = bucketByMember(rows);
    return {
      count: rows.length,
      members: buckets.length,
      buckets,
      digest: formatContributionDigest(buckets, { meetingNumber }),
    };
  },

  /** Personalized onboarding checklist for one member - the message that
   * meets a newcomer with the exact steps between them and their first
   * Respect. Message building is pure (welcome lib); this thin adapter
   * checks the users registry so the wallet step self-marks when already
   * done. Returns the message for the caller to deliver (channel post or
   * DM) - the bot stays passive-record, it does not post on its own. */
  welcome: async (params, ctx) => {
    const displayName = (params.displayName as string | undefined)?.trim();
    if (!displayName) {
      throw new Error('welcome requires a `displayName`');
    }
    const discordId = (params.discordId as string | undefined) ?? null;

    let hasWallet = false;
    if (discordId) {
      const { data, error } = await ctx.supabase
        .from('users')
        .select('primary_wallet')
        .eq('discord_id', discordId)
        .maybeSingle();
      if (error) throw error;
      hasWallet = !!data?.primary_wallet;
    }

    return {
      displayName,
      hasWallet,
      message: buildWelcomeMessage({
        displayName,
        hasWallet,
        hasIntro: (params.hasIntro as boolean | undefined) ?? null,
      }),
    };
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
