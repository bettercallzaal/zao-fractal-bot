// A small discord.js test harness - built to drive src/discord/gameCommands.ts's
// handleStart and handleVote, no more. This is not a general discord.js mock
// and should not become one; extend it only when the next handler needs
// something the current fakes do not cover.
//
// Follows the shape of src/lib/testing/fakeSupabase.ts: every call the
// production code makes into a fake is pushed onto a shared `calls` array, so
// a test can assert on what was said and done (replies, sends, threads
// created, members added) instead of re-deriving it from return values.
//
// What this fakes, and why each one is shaped the way it is:
//
//   - Client: NOT faked. `makeClient()` returns a genuine
//     `new Client({ intents: [] })`. Client (via BaseClient) is a real
//     EventEmitter and is never connected here - `.login()` is never called -
//     so `registerGameCommands(client, supabase)` wires its
//     `interactionCreate` listener exactly as it would against a live
//     client, and `dispatchInteraction` finds that real listener with
//     `client.listeners(...)` and invokes it directly, awaiting the promise
//     `EventEmitter#emit` would otherwise drop on the floor. Nothing about
//     Client is fictional.
//
//   - ChatInputCommandInteraction, ButtonInteraction, ThreadChannel (both the
//     "current thread" and any thread created by a split), ThreadMember,
//     GuildTextThreadManager / the parent text channel: these are real
//     discord.js classes with PRIVATE constructors (checked against
//     node_modules/discord.js/typings/index.d.ts - ThreadChannel,
//     ButtonInteraction, ChatInputCommandInteraction's own base, ThreadMember
//     and GuildTextThreadManager's underlying ThreadManager all declare
//     `private constructor(...)`), so building genuine instances is not
//     possible from outside the library. Each is instead declared as a
//     narrow object literal covering only the members gameCommands.ts
//     actually reads or calls, then handed back through
//     `as unknown as <RealType>` at the point a handler expects the real
//     type. This is an honest gap, not a silent one: TypeScript still checks
//     every call gameCommands.ts makes against the real discord.js method
//     signatures it imports, so a signature change to something this fake
//     implements breaks the caller. What it will NOT catch is new code
//     starting to call a discord.js member this fake never implemented -
//     only a test exercising that new path catches that, same as any mock.
//
//   - Collection (member lists): genuinely `discord.js`'s own `Collection`
//     class - a real, publicly-constructible utility, not faked at all.
//
// Bot filtering: handleStart drops `m.user?.bot` members before building the
// roster. Test fixtures that care about this should include at least one
// `{ bot: true }` member so that filter is exercised, not merely assumed.

import { ChannelType, Client, Collection, Events } from 'discord.js';
import type {
  AnyThreadChannel,
  ButtonInteraction,
  ChatInputCommandInteraction,
  TextChannel,
  ThreadMember,
} from 'discord.js';

export interface Call {
  type: string;
  [key: string]: unknown;
}

export interface FakeMemberInput {
  id: string;
  displayName?: string;
  bot?: boolean;
}

export interface FakeThreadOptions {
  id: string;
  /** Members `channel.members.fetch()` resolves with. Threads minted by a
   * split never call `.fetch()` in production (they only ever `.add()`), so
   * this is only meaningful for the thread the interaction ran in. */
  members?: FakeMemberInput[];
  /** The parent text channel, as returned by `.parent`. `null` mimics a
   * thread whose parent is not a text channel (or is inaccessible). */
  parent?: TextChannel | null;
}

export interface FakeNonThreadChannel {
  isThread(): false;
}

/** One outcome for a single `threads.create()` call, addressed by call
 * index (0-based) so a test can make the Nth split group fail without
 * needing to model the ones before or after it. */
export type CreateOutcome = { fail: Error } | { thread: AnyThreadChannel };

export interface FakeParentOptions {
  id: string;
  /** callIndex -> outcome. A call with no entry auto-succeeds with a freshly
   * minted, empty thread (no pre-seeded members - split threads are
   * populated purely via `.members.add()`, matching production). */
  createOutcomes?: Record<number, CreateOutcome>;
}

export interface FakeChatInputOptions {
  meetingNumber: number;
  group?: string | null;
  channel?: AnyThreadChannel | FakeNonThreadChannel | null;
  guildId?: string | null;
  userId?: string;
}

export interface FakeButtonOptions {
  customId: string;
  userId: string;
  channel?: AnyThreadChannel | null;
}

// Bumped once per `fakeDiscord()` call, across the whole test run, and baked
// into every auto-generated id below. `live` in gameCommands.ts (the
// in-flight session cache, keyed by thread id) is module-level state that is
// never reset between tests, so if two different tests' fakes both minted
// "thread-1" they would collide in that shared map. Nothing reads those ids
// back today, but a future restart/recovery test on an auto-generated split
// thread id would hit that silently - a prefix unique to this fakeDiscord()
// instance rules it out without touching production code.
let instanceCounter = 0;

/** One harness per test, mirroring `fakeSupabase()`'s one-fake-per-test shape.
 * Everything created through it shares one `calls` log and one thread-id
 * counter, so ids never collide across a parent channel and the thread the
 * interaction started in - and, via the instance prefix, never collide with
 * another test's fake either. */
export function fakeDiscord() {
  const calls: Call[] = [];
  const instanceId = ++instanceCounter;
  let counter = 0;
  const nextId = (prefix: string) => `${prefix}-${instanceId}-${++counter}`;

  function makeThreadMember(input: FakeMemberInput): ThreadMember {
    const fake = {
      id: input.id,
      user: { bot: input.bot ?? false, displayName: input.displayName ?? input.id },
    };
    return fake as unknown as ThreadMember;
  }

  function makeThread(opts: FakeThreadOptions): AnyThreadChannel {
    const collection = new Collection<string, ThreadMember>();
    for (const m of opts.members ?? []) {
      collection.set(m.id, makeThreadMember(m));
    }

    const thread = {
      id: opts.id,
      parent: opts.parent ?? null,
      isThread: () => true as const,
      isSendable: () => true as const,
      members: {
        fetch: async () => {
          calls.push({ type: 'membersFetch', threadId: opts.id });
          return collection;
        },
        add: async (discordId: string) => {
          calls.push({ type: 'memberAdd', threadId: opts.id, discordId });
          return discordId;
        },
      },
      send: async (payload: unknown) => {
        calls.push({ type: 'send', threadId: opts.id, payload });
        return { id: nextId('msg') };
      },
    };
    return thread as unknown as AnyThreadChannel;
  }

  function makeNonThreadChannel(): FakeNonThreadChannel {
    return { isThread: () => false };
  }

  function makeParentChannel(opts: FakeParentOptions): TextChannel {
    let callIndex = 0;
    const parent = {
      id: opts.id,
      type: ChannelType.GuildText,
      threads: {
        create: async (options: { name: string; type?: ChannelType; reason?: string }) => {
          const index = callIndex;
          callIndex += 1;
          const outcome = opts.createOutcomes?.[index];
          if (outcome && 'fail' in outcome) {
            calls.push({ type: 'threadCreate', parentId: opts.id, name: options.name, ok: false });
            throw outcome.fail;
          }
          const thread =
            outcome && 'thread' in outcome
              ? outcome.thread
              : makeThread({ id: nextId('thread'), parent: parent as unknown as TextChannel });
          calls.push({
            type: 'threadCreate',
            parentId: opts.id,
            name: options.name,
            ok: true,
            threadId: (thread as unknown as { id: string }).id,
          });
          return thread;
        },
      },
    };
    return parent as unknown as TextChannel;
  }

  function makeChatInputInteraction(opts: FakeChatInputOptions): ChatInputCommandInteraction {
    const interaction = {
      commandName: 'start',
      isChatInputCommand: () => true as const,
      isButton: () => false as const,
      channel: opts.channel ?? null,
      guildId: opts.guildId ?? 'guild-1',
      user: { id: opts.userId ?? 'facilitator-1' },
      options: {
        getInteger: (name: string) => {
          if (name !== 'meeting') {
            throw new Error(`fakeDiscord: makeChatInputInteraction has no value for getInteger("${name}")`);
          }
          return opts.meetingNumber;
        },
        getString: (name: string) => {
          if (name !== 'group') {
            throw new Error(`fakeDiscord: makeChatInputInteraction has no value for getString("${name}")`);
          }
          return opts.group ?? null;
        },
      },
      deferReply: async () => {
        calls.push({ type: 'deferReply' });
      },
      editReply: async (content: unknown) => {
        calls.push({ type: 'editReply', content });
        return {};
      },
    };
    return interaction as unknown as ChatInputCommandInteraction;
  }

  function makeButtonInteraction(opts: FakeButtonOptions): ButtonInteraction {
    const interaction = {
      customId: opts.customId,
      isChatInputCommand: () => false as const,
      isButton: () => true as const,
      user: { id: opts.userId },
      channel: opts.channel ?? null,
      reply: async (payload: unknown) => {
        calls.push({ type: 'reply', payload });
        return {};
      },
    };
    return interaction as unknown as ButtonInteraction;
  }

  function makeClient(): Client {
    // Genuine discord.js Client - see the file header. Never connected.
    return new Client({ intents: [] });
  }

  /** Finds the real `interactionCreate` listener `registerGameCommands`
   * registered on `client` and invokes it directly, awaiting the promise.
   * `EventEmitter#emit` returns a boolean and does not wait for an async
   * listener, so calling through `.listeners()` instead is what lets a test
   * await handleStart/handleVote actually finishing. */
  async function dispatchInteraction(
    client: Client,
    interaction: ChatInputCommandInteraction | ButtonInteraction,
  ): Promise<void> {
    const listeners = client.listeners(Events.InteractionCreate) as ((
      interaction: unknown,
    ) => unknown)[];
    if (listeners.length === 0) {
      throw new Error(
        'fakeDiscord.dispatch: no interactionCreate listener registered - ' +
          'call registerGameCommands(client, supabase) before dispatching.',
      );
    }
    await Promise.all(listeners.map((listener) => listener(interaction)));
  }

  return {
    calls,
    makeThread,
    makeNonThreadChannel,
    makeParentChannel,
    makeChatInputInteraction,
    makeButtonInteraction,
    makeClient,
    dispatch: dispatchInteraction,
  };
}
