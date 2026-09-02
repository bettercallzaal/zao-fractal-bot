#!/usr/bin/env node
// Snapshot the fractal tables to timestamped JSON.
//
// Why this exists: the Respect itself is safe - every award is an immutable
// mint on Optimism. What only exists in Supabase is the human layer: names,
// Discord ids, group names, facilitator, thread links, and anyone who was
// present but earned nothing. None of that is reconstructible from the chain.
//
// Run:  node scripts/backup-fractal-tables.mjs [outDir]
// Env:  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_KEY)
// Cron: 0 3 * * *  cd /path/to/repo && node scripts/backup-fractal-tables.mjs

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;
if (!url || !key) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
  process.exit(1);
}

// Explicit column lists, never "*", for any table that can hold credentials.
// `users` carries Lens tokens, a Hive posting key and a Bluesky app password.
// Dumping it wholesale would write live secrets to a backup file.
const TABLES = {
  fractal_sessions: '*',
  fractal_scores: '*',
  fractal_events: '*',
  respect_members: '*',
  discord_roster: '*',
  discord_fractal_rounds: '*',
  discord_fractal_votes: '*',
  discord_fractal_awards: '*',
  users: 'id,discord_id,primary_wallet,display_name,fid,zid,member_tier,respect_member_id',
};

const FORBIDDEN = /password|token|secret|private_key|posting_key/i;

async function fetchAll(table, cols) {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const res = await fetch(`${url}/rest/v1/${table}?select=${cols}&limit=1000&offset=${offset}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    if (res.status === 404) return null; // table not present yet
    if (!res.ok) throw new Error(`${table}: HTTP ${res.status} ${await res.text()}`);
    const batch = await res.json();
    rows.push(...batch);
    if (batch.length < 1000) return rows;
  }
}

const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '');
const outDir = join(process.argv[2] ?? join(process.env.HOME, '.zao/backups'), `fractal-${stamp}`);
mkdirSync(outDir, { recursive: true });

let total = 0;
for (const [table, cols] of Object.entries(TABLES)) {
  const rows = await fetchAll(table, cols);
  if (rows === null) {
    console.log(`${table.padEnd(24)} not present, skipped`);
    continue;
  }
  const leaked = rows.length ? Object.keys(rows[0]).filter((c) => FORBIDDEN.test(c)) : [];
  if (leaked.length) {
    throw new Error(`${table}: refusing to write credential columns ${leaked.join(', ')}`);
  }
  writeFileSync(join(outDir, `${table}.json`), JSON.stringify(rows, null, 1));
  console.log(`${table.padEnd(24)} ${String(rows.length).padStart(5)} rows`);
  total += rows.length;
}
console.log(`\n${total} rows -> ${outDir}`);
