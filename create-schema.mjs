/**
 * EAS AI Dashboard — Schema Creator
 * Executes schema SQL against Supabase using the pg_meta API
 * 
 * Usage: node create-schema.mjs
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SUPABASE_URL = 'https://apcfnzbiylhgiutcjigg.supabase.co';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFwY2ZuemJpeWxoZ2l1dGNqaWdnIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTc2MjY4NiwiZXhwIjoyMDkxMzM4Njg2fQ.Q7PNAAqj0NYL9zR5AAbrrlsFOArBlZhda2CPPNxmxEM';

async function execSQL(sql) {
  // Use Supabase's pg_meta endpoint to execute raw SQL
  const res = await fetch(`${SUPABASE_URL}/pg/query`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
      'apikey': SERVICE_ROLE_KEY
    },
    body: JSON.stringify({ query: sql })
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text}`);
  }

  return await res.json();
}

// Split SQL into safe executable chunks
function splitSQL(sql) {
  // Remove comments
  const lines = sql.split('\n');
  const cleaned = lines
    .filter(l => !l.trim().startsWith('--'))
    .join('\n');

  // Split on semicolons, but be careful with function bodies ($$)
  const statements = [];
  let current = '';
  let inDollarQuote = false;

  for (let i = 0; i < cleaned.length; i++) {
    const c = cleaned[i];
    
    // Check for $$ (dollar quoting in PL/pgSQL)
    if (c === '$' && cleaned[i + 1] === '$') {
      inDollarQuote = !inDollarQuote;
      current += '$$';
      i++;
      continue;
    }

    if (c === ';' && !inDollarQuote) {
      const stmt = current.trim();
      if (stmt) statements.push(stmt);
      current = '';
    } else {
      current += c;
    }
  }

  const last = current.trim();
  if (last) statements.push(last);

  return statements;
}

async function main() {
  console.log('🚀 EAS AI Dashboard — Schema Creation');
  console.log('======================================\n');

  const sqlContent = readFileSync(join(__dirname, 'sql', '001_schema.sql'), 'utf8');
  const statements = splitSQL(sqlContent);

  console.log(`Found ${statements.length} SQL statements to execute.\n`);

  let success = 0;
  let errors = 0;

  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];
    const preview = stmt.substring(0, 80).replace(/\n/g, ' ').trim();
    
    try {
      await execSQL(stmt);
      success++;
      console.log(`  ✅ [${i + 1}/${statements.length}] ${preview}...`);
    } catch (err) {
      // Some errors are OK (e.g., "already exists")
      const msg = err.message || '';
      if (msg.includes('already exists') || msg.includes('duplicate')) {
        console.log(`  ⚠️  [${i + 1}/${statements.length}] Already exists: ${preview}...`);
        success++;
      } else {
        errors++;
        console.error(`  ❌ [${i + 1}/${statements.length}] ${preview}...`);
        console.error(`     Error: ${msg.substring(0, 200)}`);
      }
    }
  }

  console.log(`\n📊 Results: ${success} succeeded, ${errors} failed out of ${statements.length} statements`);
  
  if (errors > 0) {
    console.log('\n⚠️  Some statements failed. The /pg/query endpoint may not be available.');
    console.log('   Alternative: Copy sql/001_schema.sql and paste it into Supabase SQL Editor.');
  } else {
    console.log('\n✅ Schema created successfully!');
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
