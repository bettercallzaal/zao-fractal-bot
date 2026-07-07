/** Matches the same Supreme Admin role concept the bot itself checks
 * (SUPREME_ADMIN_ROLE_ID in the Python bot's config). discordRoleIds is
 * the caller's list of role IDs in the guild, fetched separately via the
 * Discord API using the OAuth access token. */
export function isSupremeAdmin(discordRoleIds: string[], supremeAdminRoleId: string): boolean {
  return discordRoleIds.includes(supremeAdminRoleId);
}
