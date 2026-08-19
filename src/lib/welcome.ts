/** Welcome + onboarding - pure logic for greeting a new member with the
 * exact steps between them and their first Respect.
 *
 * Onboarding friction is the fractal's quiet killer: someone lands in the
 * Discord, does not know a meeting is Monday, has no wallet bound, never
 * posts an intro, and drifts off before their first circle. The welcome
 * message is one Discord-ready checklist, personalized to what the member
 * has already done, so the next step is always obvious.
 *
 * Pure formatting (no DB, no network); the `welcome` action does the users
 * table lookup and hands the state here.
 */

const WHITEPAPER = 'zaofractal.vercel.app';

export interface WelcomeState {
  displayName: string;
  /** Wallet bound in the users registry (discord_id -> wallet). */
  hasWallet: boolean;
  /** Intro known to be posted. Null = unknown (the step still shows, unmarked). */
  hasIntro?: boolean | null;
}

interface Step {
  label: string;
  detail: string;
  done: boolean | null; // null = unknown, render without a marker
}

/** Build the personalized onboarding checklist for one member. */
export function buildWelcomeMessage(state: WelcomeState): string {
  const steps: Step[] = [
    {
      label: 'Register your wallet',
      detail:
        'tell an organizer your Optimism address (or ENS) so your earned Respect mints to you',
      done: state.hasWallet,
    },
    {
      label: 'Post your intro',
      detail:
        'a few lines in the intros channel - who you are, what you make; circles read these before ranking',
      done: state.hasIntro ?? null,
    },
    {
      label: 'Show up',
      detail:
        'weekly fractal, Mondays 6pm ET in the fractal voice channel - join the waiting room and you will be sorted into a circle',
      done: null,
    },
    {
      label: 'Tell your circle what you did',
      detail:
        'each member presents their week\'s contributions, the circle ranks, and Respect mints on Optimism by rank',
      done: null,
    },
  ];

  const lines = [
    `Welcome, ${state.displayName}. ZAO Fractal is the weekly ritual where members ` +
      'show what they contributed, circles rank it, and Respect - earned, soulbound ' +
      'reputation - mints on Optimism. Here is your path to your first Respect:',
    '',
  ];
  let n = 1;
  for (const step of steps) {
    const marker = step.done === true ? ' [DONE]' : '';
    lines.push(`${n}. ${step.label}${marker} - ${step.detail}`);
    n += 1;
  }
  lines.push('');
  lines.push(
    'Cannot make Mondays? Log what you shipped anyway and the circle will see it ' +
      'when it ranks. Ask the bot to explain any topic ("explain scoring"). ' +
      `Full story: ${WHITEPAPER}`,
  );
  return lines.join('\n');
}
