#!/usr/bin/env node
// Snapshot the column names of the four ZAO OS tables this bot writes to but
// does not own - fractal_sessions, fractal_scores, users, respect_members -
// into src/lib/testing/zaoos-schema.json, so assertWritable can catch an
// unknown-column write against them the same way it already does for the
// tables this repo's own migrations create.
//
// Why a snapshot and not a live query at test time: CI has no credentials for
// the ZAO OS project, and a schema guard that only works when a database is
// reachable is not a guard a test suite can rely on. So this script is a
// manual, occasional refresh - see the `recheckBy` date it writes into the
// fixture and src/lib/testing/schemaFromMigrations.test.ts, which fails once
// that date has passed.
//
// This is a READ. It never writes to the ZAO OS database, and it must never
// be pointed at any project other than ZAO OS (efsxtoxvigqowjhgcbiz) - see
// docs/superpowers/specs/2026-09-01-respect-game-core-design.md section 4 for
// why a different Supabase project's same-named tables would silently
// corrupt this fixture.
//
// What it reads: PostgREST serves an OpenAPI description of every table at
// the project root (`GET /rest/v1/`), including each column's `format` (its
// Postgres type) under `.definitions.<table>.properties.<column>`. This is
// metadata only - no rows are read or written.
//
// Deliberately NOT captured: PostgREST's `required` array and CHECK
// constraints. `required` mixes genuinely-required columns with every
// primary key (auto-generated, never supplied on insert) - for example
// `fractal_scores.required` is `['id','member_name','score']`, and `id` is a
// primary key whose `description` contains "This is a Primary Key". Treating
// `required` as a not-null rule would reject every correct insert this bot
// makes. CHECK constraints aren't exposed by this endpoint at all. So this
// fixture - and the guard built from it - covers column existence only.
// PARTIALLY_COVERED_TABLES in schemaFromMigrations.ts says this explicitly;
// do not extend this script to synthesize either kind of enforcement from
// `required` without a real source for it.
//
// Run:  node scripts/refresh-zaoos-schema.mjs
// Env:  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_KEY) -
//       must point at the ZAO OS project. Never hardcode or commit these.

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ZAOOS_PROJECT_REF = 'efsxtoxvigqowjhgcbiz';

const TABLES = ['fractal_sessions', 'fractal_scores', 'users', 'respect_members'];

const RECHECK_DAYS = 90;

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;
if (!url || !key) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
  process.exit(1);
}

const host = new URL(url).host;
const projectRef = host.split('.')[0];
if (projectRef !== ZAOOS_PROJECT_REF) {
  console.error(
    `refresh-zaoos-schema: SUPABASE_URL resolves to project "${projectRef}", ` +
      `not the ZAO OS project ("${ZAOOS_PROJECT_REF}"). Refusing to run - this ` +
      `script must only ever snapshot ZAO OS, never point it at another project.`,
  );
  process.exit(1);
}

const res = await fetch(`${url}/rest/v1/`, {
  headers: { apikey: key, Authorization: `Bearer ${key}` },
});
if (!res.ok) {
  throw new Error(`GET /rest/v1/ failed: HTTP ${res.status} ${await res.text()}`);
}
const openapi = await res.json();
const definitions = openapi.definitions ?? {};

const tables = {};
for (const table of TABLES) {
  const def = definitions[table];
  if (!def) {
    throw new Error(
      `refresh-zaoos-schema: table "${table}" is not in the ZAO OS OpenAPI description - ` +
        `has it been renamed or dropped? This fixture must not silently drop a table.`,
    );
  }
  const columns = {};
  for (const [col, spec] of Object.entries(def.properties ?? {})) {
    columns[col] = { format: spec.format ?? null };
  }
  tables[table] = { columns };
}

const fetchedAtUtc = new Date().toISOString().slice(0, 10);
const recheckBy = new Date(Date.now() + RECHECK_DAYS * 24 * 60 * 60 * 1000)
  .toISOString()
  .slice(0, 10);

const fixture = {
  provenance: {
    sourceHost: host,
    projectRef,
    fetchedAtUtc,
    recheckBy,
    note:
      'Column names and PostgREST formats only - column existence coverage, not ' +
      'not-null or CHECK enforcement. See scripts/refresh-zaoos-schema.mjs and ' +
      'PARTIALLY_COVERED_TABLES in src/lib/testing/schemaFromMigrations.ts.',
  },
  tables,
};

const outPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'src/lib/testing/zaoos-schema.json',
);
writeFileSync(outPath, JSON.stringify(fixture, null, 2) + '\n');

console.log(`Wrote ${outPath}`);
for (const table of TABLES) {
  console.log(`  ${table.padEnd(20)} ${Object.keys(tables[table].columns).length} columns`);
}
console.log(`recheckBy: ${recheckBy}`);
