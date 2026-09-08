// Every workspace, in one run.
//
// MEASURED 2026-09-08, and this file exists because of it: CI ran `npm test`,
// which was root `vitest run`, which only included `src/**`. So `packages/shared`
// (2 files, 7 tests) and `web` (8 files, 34 tests) NEVER RAN ON CI - 41 tests
// across 10 files, on every pull request this repo has ever merged. The suite
// reported green at 232 while the real total was 273.
//
// That is the same failure the estate tracks as silent-failure-guard incident
// #3, "a test suite that never runs" - and the honour-system fix (remember to
// type `npm run test:all`) is exactly the kind of rule that measures at 3-40%
// compliance. A workspace file makes the correct behaviour the DEFAULT: plain
// `vitest run`, `npm test`, and CI all now cover everything, and a new package
// under packages/ is picked up without anyone remembering to add it.
export default ['./vitest.config.ts', './packages/*', './web'];
