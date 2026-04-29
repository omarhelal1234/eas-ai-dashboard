// ============================================================
// EAS AI Dashboard — Rotate test.* and admin passwords
//
// Phase 4 QA fallout: the seeded `test.*@ejada.com` accounts and
// the admin `omar.helal.1234@gmail.com` were left with weak, shared
// passwords that are checked into creds.txt. This script rotates
// each one to a strong, freshly-generated value and prints the new
// credentials so the operator can paste them into the secrets store.
//
// USAGE
//   SUPABASE_URL=https://<project>.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
//   node scripts/rotate-test-passwords.mjs
//
// SAFETY
//   * Dry run by default (set ROTATE=1 to actually update).
//   * Refuses to touch any auth user not in the explicit allow-list.
//   * Skips users that don't exist (so re-runs are idempotent).
// ============================================================

import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'node:crypto';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ROTATE = process.env.ROTATE === '1';

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before running.');
  process.exit(1);
}

const TARGETS = [
  'omar.helal.1234@gmail.com',
  'test.ecc.spoc@ejada.com',
  'test.hr.spoc@ejada.com',
  'test.eas.dept@ejada.com',
  'test.orphan@ejada.com',
];

function generatePassword() {
  // 24 bytes → 32 base64 chars, URL-safe, comfortably above any
  // typical Supabase password-strength threshold.
  return randomBytes(24).toString('base64url');
}

const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function listAllAuthUsers() {
  // Paginate — listUsers caps at 1000/page, so a single call would
  // silently miss targets in larger tenants. (codex P2.)
  const all = [];
  const perPage = 1000;
  for (let page = 1; ; page += 1) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(`listUsers page=${page}: ${error.message}`);
    all.push(...data.users);
    if (data.users.length < perPage) break;
  }
  return all;
}

async function main() {
  console.log(ROTATE ? '🔁 LIVE rotation' : '🧪 DRY RUN (set ROTATE=1 to apply)');
  console.log('');

  const users = await listAllAuthUsers();
  const byEmail = new Map(users.map((u) => [u.email?.toLowerCase(), u]));
  const rotated = [];
  const failures = [];

  // In dry-run mode we never generate passwords — printing them would
  // tempt the operator to store credentials that were never applied,
  // and a subsequent live run would generate different values, leaving
  // the secret store and Supabase out of sync. (codex review fallout.)
  let rotateableCount = 0;
  for (const email of TARGETS) {
    const user = byEmail.get(email.toLowerCase());
    if (!user) {
      console.log(`  ⏭  ${email} — no auth user, skipping`);
      continue;
    }

    if (!ROTATE) {
      console.log(`  🧪 ${email} — would rotate (run with ROTATE=1 to apply)`);
      rotateableCount += 1;
      continue;
    }

    const newPassword = generatePassword();
    const { error } = await sb.auth.admin.updateUserById(user.id, { password: newPassword });
    if (error) {
      console.log(`  ❌ ${email} — ${error.message}`);
      failures.push({ email, error: error.message });
      continue;
    }
    console.log(`  ✅ ${email} — rotated`);
    rotated.push({ email, password: newPassword });
  }

  if (!ROTATE) {
    console.log(`\n${rotateableCount} account(s) would be rotated. Re-run with ROTATE=1 to commit and emit credentials.`);
    return;
  }

  if (rotated.length > 0) {
    console.log('\nNew credentials (store immediately, this output is the only copy):');
    for (const { email, password } of rotated) {
      console.log(`  ${email.padEnd(36)} ${password}`);
    }
  } else {
    console.log('\nNo accounts were rotated.');
  }

  if (failures.length > 0) {
    // Exit non-zero so a CI / wrapper script can react. Codex P2: silent
    // partial failure leaves weak passwords in place under a "success" log.
    console.log('\nFailures:');
    for (const { email, error } of failures) {
      console.log(`  ${email.padEnd(36)} ${error}`);
    }
    process.exit(2);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
