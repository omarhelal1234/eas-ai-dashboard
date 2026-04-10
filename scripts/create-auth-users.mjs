// ============================================================
// EAS AI Dashboard — Create Supabase Auth Users
// Phase 2: Authentication Setup
// Run: node scripts/create-auth-users.mjs
// Requires: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars
// ============================================================

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Error: Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables.');
  console.error('Example: SUPABASE_URL=https://xxx.supabase.co SUPABASE_SERVICE_ROLE_KEY=xxx node scripts/create-auth-users.mjs');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

// Default password for all users (they can change later)
const DEFAULT_PASSWORD = 'EAS@2026!';

async function createAuthUsers() {
  console.log('🔐 Creating Supabase Auth users...\n');

  // Fetch all users from public.users table
  const { data: users, error: fetchErr } = await supabase
    .from('users')
    .select('id, email, name, role, practice')
    .order('role');

  if (fetchErr) {
    console.error('❌ Failed to fetch users:', fetchErr.message);
    return;
  }

  console.log(`Found ${users.length} users to create auth accounts for:\n`);

  for (const user of users) {
    console.log(`  Creating auth for: ${user.name} (${user.email}) [${user.role}]`);

    // Check if auth user already exists
    const { data: existingUsers } = await supabase.auth.admin.listUsers();
    const existing = existingUsers?.users?.find(u => u.email === user.email);

    if (existing) {
      console.log(`    ⚠️  Auth user already exists (${existing.id}), linking...`);
      // Update users table with auth_id
      const { error: updateErr } = await supabase
        .from('users')
        .update({ auth_id: existing.id })
        .eq('id', user.id);

      if (updateErr) {
        console.log(`    ❌ Failed to link: ${updateErr.message}`);
      } else {
        console.log(`    ✅ Linked auth_id = ${existing.id}`);
      }
      continue;
    }

    // Create new auth user
    const { data: authUser, error: createErr } = await supabase.auth.admin.createUser({
      email: user.email,
      password: DEFAULT_PASSWORD,
      email_confirm: true, // Skip email verification
      user_metadata: {
        name: user.name,
        role: user.role,
        practice: user.practice
      },
      app_metadata: {
        role: user.role,
        practice: user.practice
      }
    });

    if (createErr) {
      console.log(`    ❌ Failed: ${createErr.message}`);
      continue;
    }

    // Link auth user to public.users table
    const { error: updateErr } = await supabase
      .from('users')
      .update({ auth_id: authUser.user.id })
      .eq('id', user.id);

    if (updateErr) {
      console.log(`    ❌ Auth created but link failed: ${updateErr.message}`);
    } else {
      console.log(`    ✅ Created & linked: auth_id = ${authUser.user.id}`);
    }
  }

  // Verify linkage
  console.log('\n📋 Verification:');
  const { data: linked } = await supabase
    .from('users')
    .select('name, email, role, practice, auth_id')
    .order('role');

  linked.forEach(u => {
    const status = u.auth_id ? '✅' : '❌';
    console.log(`  ${status} ${u.name} (${u.role}/${u.practice}) → auth_id: ${u.auth_id || 'NOT LINKED'}`);
  });

  console.log('\n🔑 Default password for all users: ' + DEFAULT_PASSWORD);
  console.log('   Users can change their password after first login.\n');
}

createAuthUsers().catch(console.error);
