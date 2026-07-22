/// <reference path="./types/next-auth.d.ts" />

import NextAuth, { type Session } from 'next-auth';
import type { JWT } from 'next-auth/jwt';
import Discord from 'next-auth/providers/discord';
import Credentials from 'next-auth/providers/credentials';
import { verifySiweSignature, getCsrfNonce } from './lib/siwe.js';
import { resolveMemberIdentity } from './lib/resolveMemberIdentity.js';
import { getGuildMemberRoleIds } from './lib/getGuildMemberRoleIds.js';
import { getCachedRoles, setCachedRoles } from './lib/guildRoleCache.js';
import { getSupabaseClient } from './lib/supabaseClient.js';

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Discord({
      clientId: process.env.DISCORD_CLIENT_ID!,
      clientSecret: process.env.DISCORD_CLIENT_SECRET!,
    }),
    Credentials({
      id: 'siwe',
      name: 'Ethereum',
      credentials: {
        message: { label: 'Message', type: 'text' },
        signature: { label: 'Signature', type: 'text' },
      },
      async authorize(credentials, request) {
        const message = credentials?.message as string | undefined;
        const signature = credentials?.signature as `0x${string}` | undefined;
        if (!message || !signature) return null;

        // Bind the signature to this app's domain and the per-session CSRF
        // nonce, so a signature captured elsewhere (or replayed) is rejected.
        // SIWE_DOMAIN must be set; without it we refuse rather than fall open.
        const domain = process.env.SIWE_DOMAIN;
        if (!domain) {
          console.error('SIWE_DOMAIN is not set - refusing SIWE login (see .env.example)');
          return null;
        }
        const nonce = getCsrfNonce(request as unknown as Request);

        const { address, valid, reason } = await verifySiweSignature(message, signature, {
          domain,
          nonce,
        });
        if (!valid) {
          console.warn(`SIWE login rejected: ${reason ?? 'invalid'}`);
          return null;
        }

        return { id: address, walletAddress: address };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, account, user }) {
      const supabase = getSupabaseClient();

      if (account?.provider === 'discord') {
        const identity = await resolveMemberIdentity(supabase, { discordId: account.providerAccountId });
        token.discordId = identity.discordId;
        token.walletAddress = identity.walletAddress;
      } else if (account?.provider === 'siwe' && user) {
        const identity = await resolveMemberIdentity(supabase, { walletAddress: user.walletAddress });
        token.discordId = identity.discordId;
        token.walletAddress = identity.walletAddress;
      }

      if (token.discordId) {
        const guildId = process.env.DISCORD_GUILD_ID;
        const botToken = process.env.DISCORD_BOT_TOKEN;

        if (!guildId || !botToken) {
          throw new Error('Missing required environment variables: DISCORD_GUILD_ID and DISCORD_BOT_TOKEN are required for guild role lookup');
        }

        // Check cache first to avoid repeated API calls
        let roles = getCachedRoles(token.discordId);
        if (!roles) {
          roles = await getGuildMemberRoleIds(token.discordId, guildId, botToken);
          setCachedRoles(token.discordId, roles);
        }
        token.discordRoleIds = roles;
      } else {
        token.discordRoleIds = [];
      }

      return token;
    },
    async session({ session, token }) {
      session.discordId = token.discordId ?? null;
      session.walletAddress = token.walletAddress ?? null;
      session.discordRoleIds = token.discordRoleIds ?? [];
      return session;
    },
  },
});
