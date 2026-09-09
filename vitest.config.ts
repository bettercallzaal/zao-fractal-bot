import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Tests resolve @fractalbot/shared from SOURCE, not from its built dist/.
  // Without this, the suite tests whatever was last built: on 2026-09-07 a new
  // export was invisible to the runner until someone rebuilt, so a guard
  // silently did not fire and a test failed for an unrelated-looking reason.
  // dist/ is gitignored, so staleness leaves no trace in the diff.
  // CI still proves the built artifact exists and resolves - see the
  // "shared package built by install" step and `npm run typecheck`.
  resolve: {
    alias: {
      '@fractalbot/shared': fileURLToPath(
        new URL('./packages/shared/src/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
});
