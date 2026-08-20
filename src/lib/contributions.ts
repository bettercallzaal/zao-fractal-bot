/** Async contributions - pure logic for logging work outside the live call
 * and digesting it for the circle that ranks.
 *
 * The fractal scores what people contributed, but only what the circle hears
 * about. Members who cannot make the call (or who ship mid-week and forget by
 * Monday) log contributions as they happen; when the meeting runs, the
 * facilitator pulls a per-member digest so async work is on the table during
 * ranking. Year-3 feedback item.
 *
 * Pure data transforms (no DB, no network), same convention as the other lib
 * modules: normalization + validation here, thin Supabase adapters in the
 * submitContribution / listContributions actions.
 */

/** Hard cap well under the 2000-char Discord message limit, leaving room for
 * the digest's member headers around quoted content. */
export const MAX_CONTRIBUTION_LENGTH = 1500;

/** How far back listContributions looks when no meeting number is given. */
export const DEFAULT_LOOKBACK_HOURS = 7 * 24;

const URL_PATTERN = /https?:\/\/[^\s<>"')\]]+/g;

export interface NormalizedContribution {
  content: string;
  links: string[];
}

/** Validate + normalize raw contribution text. Trims whitespace, rejects
 * empty or over-long content, extracts any URLs so they can be stored
 * queryably alongside the prose. Throws on invalid input - the action
 * surfaces the message to the member as-is. */
export function normalizeContribution(raw: string): NormalizedContribution {
  const content = (raw ?? '').trim();
  if (!content) {
    throw new Error('Contribution text is empty - describe what you did.');
  }
  if (content.length > MAX_CONTRIBUTION_LENGTH) {
    throw new Error(
      `Contribution is ${content.length} chars; max is ${MAX_CONTRIBUTION_LENGTH}. ` +
        'Split it into separate contributions.',
    );
  }
  // Trailing sentence punctuation is prose, not part of the URL.
  const links = [
    ...new Set((content.match(URL_PATTERN) ?? []).map((u) => u.replace(/[.,;:!?]+$/, ''))),
  ];
  return { content, links };
}

/** A discord_contributions row, as the actions read it back. */
export interface ContributionRow {
  id: string;
  discord_id: string | null;
  display_name: string;
  content: string;
  links: string[];
  meeting_number: number | null;
  reviewed: boolean;
  created_at: string;
}

export interface MemberContributions {
  displayName: string;
  discordId: string | null;
  items: ContributionRow[];
}

/** Group rows into one bucket per member, ordered by most contributions
 * first (the members with the most logged work lead the digest). Rows are
 * grouped by discord_id when present, else by display name case-insensitively
 * (the same person logging by name twice should not split). */
export function bucketByMember(rows: ContributionRow[]): MemberContributions[] {
  const buckets = new Map<string, MemberContributions>();
  for (const row of rows) {
    const key = row.discord_id ?? `name:${row.display_name.toLowerCase()}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { displayName: row.display_name, discordId: row.discord_id, items: [] };
      buckets.set(key, bucket);
    }
    bucket.items.push(row);
  }
  for (const bucket of buckets.values()) {
    bucket.items.sort((a, b) => a.created_at.localeCompare(b.created_at));
  }
  return [...buckets.values()].sort((a, b) => b.items.length - a.items.length);
}

/** Render the facilitator digest as one Discord-ready message. Content is
 * clipped per item so a prolific week still fits one message; the dashboard
 * shows the full text. */
export function formatContributionDigest(
  buckets: MemberContributions[],
  opts: { meetingNumber?: number | null; clipTo?: number } = {},
): string {
  if (buckets.length === 0) {
    return 'No async contributions logged for this window.';
  }
  const clipTo = opts.clipTo ?? 200;
  const header = opts.meetingNumber
    ? `Async contributions for meeting ${opts.meetingNumber}:`
    : 'Async contributions this week:';

  const lines: string[] = [header];
  for (const bucket of buckets) {
    lines.push('');
    lines.push(`${bucket.displayName} (${bucket.items.length}):`);
    for (const item of bucket.items) {
      const clipped =
        item.content.length > clipTo ? `${item.content.slice(0, clipTo - 3)}...` : item.content;
      lines.push(`- ${clipped.replace(/\s*\n\s*/g, ' ')}`);
    }
  }
  return lines.join('\n');
}
