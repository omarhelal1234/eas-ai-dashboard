/**
 * EAS AI Dashboard — Phase 1: Database Migration
 * 
 * Migrates all data from data.js to Supabase
 * 
 * Usage: SUPABASE_URL=xxx SUPABASE_SERVICE_ROLE_KEY=xxx node scripts/run-migration.mjs
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ============ CONFIG ============
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Error: Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables.');
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

// ============ LOAD DATA.JS ============
const dataJsContent = readFileSync(join(__dirname, '..', 'data.js'), 'utf8');
// Execute data.js in a safe way to extract APP_DATA
let APP_DATA;
const wrappedCode = dataJsContent.replace('const APP_DATA', 'APP_DATA');
eval(wrappedCode);

const data = APP_DATA;
console.log(`\n📊 Data loaded from data.js:`);
console.log(`   Tasks: ${data.tasks.length}`);
console.log(`   Accomplishments: ${data.accomplishments.length}`);
console.log(`   Copilot Users: ${data.copilotUsers.length}`);
console.log(`   Projects: ${data.projects.length}`);
console.log('');

// ============ HELPERS ============
function parseDate(dateStr) {
  if (!dateStr || dateStr.trim() === '' || dateStr === '\u00a0') return null;

  // Handle "YYYY-MM-DD HH:MM:SS"
  if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) {
    const d = new Date(dateStr);
    if (!isNaN(d)) return d.toISOString().split('T')[0];
  }

  // Handle "DD/MM/YYYY" or "DD-MM-YYYY"
  const parts = dateStr.split(/[\/\-]/);
  if (parts.length === 3) {
    let day = parseInt(parts[0]);
    let month = parseInt(parts[1]);
    let year = parseInt(parts[2]);
    if (year < 100) year += 2000;
    const d = new Date(year, month - 1, day);
    if (!isNaN(d)) return d.toISOString().split('T')[0];
  }

  return null;
}

function getQuarterId(dateStr) {
  const d = parseDate(dateStr);
  if (!d) return 'Q1-2026';
  const date = new Date(d);
  const month = date.getMonth() + 1;
  const year = date.getFullYear();
  const q = Math.ceil(month / 3);
  return `Q${q}-${year}`;
}

function mapPractice(name) {
  if (!name) return 'BFSI';
  const n = name.trim();
  if (n === 'Payments Solutions') return 'EPS';
  if (n === 'ERP') return 'ERP Solutions';
  return n;
}

function clean(s) {
  if (!s) return null;
  return s.toString().trim().replace(/\u00a0/g, '') || null;
}

// ============ STEP 1: RUN SCHEMA SQL ============
async function runSchema() {
  console.log('📋 Step 1: Running schema SQL...');
  
  const sqlContent = readFileSync(join(__dirname, 'sql', '001_schema.sql'), 'utf8');
  
  // Split into individual statements and run them
  // We need to use the Supabase REST API to execute raw SQL
  const { data: result, error } = await sb.rpc('exec_sql', { sql: sqlContent }).maybeSingle();
  
  if (error) {
    // If exec_sql doesn't exist, we need to use the management API
    console.log('   ⚠ Cannot run SQL via RPC (expected). Please run sql/001_schema.sql in Supabase SQL Editor first.');
    console.log('   Checking if tables exist...');
    
    // Try to read from practices to see if schema exists
    const { data: practices, error: pErr } = await sb.from('practices').select('name');
    if (pErr) {
      console.error('   ❌ Tables do not exist. Please run sql/001_schema.sql in Supabase SQL Editor first.');
      console.error(`   Error: ${pErr.message}`);
      return false;
    }
    
    console.log(`   ✅ Schema exists — found ${practices.length} practices`);
    return true;
  }
  
  console.log('   ✅ Schema created successfully');
  return true;
}

// ============ STEP 2: MIGRATE TASKS ============
async function migrateTasks() {
  console.log(`\n📋 Step 2: Migrating ${data.tasks.length} tasks...`);
  
  const rows = data.tasks.map(t => ({
    quarter_id: getQuarterId(t.weekStart),
    practice: mapPractice(t.practice),
    week_number: parseInt(t.week) || null,
    week_start: parseDate(t.weekStart),
    week_end: parseDate(t.weekEnd),
    project: clean(t.project),
    project_code: clean(t.projectCode),
    employee_name: clean(t.employee) || 'Unknown',
    employee_email: null,
    task_description: clean(t.task) || 'Untitled',
    category: clean(t.category) || 'Development',
    ai_tool: clean(t.aiTool) || 'Github Copilot',
    prompt_used: clean(t.prompt),
    time_without_ai: parseFloat(t.timeWithout) || 0,
    time_with_ai: parseFloat(t.timeWith) || 0,
    quality_rating: parseFloat(t.quality) || 0,
    status: clean(t.status) || 'Completed',
    notes: clean(t.notes)
  }));

  let inserted = 0;
  let errors = 0;
  
  // Batch insert (50 at a time)
  for (let i = 0; i < rows.length; i += 50) {
    const batch = rows.slice(i, i + 50);
    const { error } = await sb.from('tasks').insert(batch);
    if (error) {
      console.error(`   ❌ Batch ${i+1}-${i+batch.length}: ${error.message}`);
      errors++;
    } else {
      inserted += batch.length;
      console.log(`   ✅ Tasks ${i+1}-${i+batch.length} inserted`);
    }
  }
  
  console.log(`   → ${inserted} tasks inserted, ${errors} errors`);
  return errors === 0;
}

// ============ STEP 3: MIGRATE ACCOMPLISHMENTS ============
async function migrateAccomplishments() {
  console.log(`\n📋 Step 3: Migrating ${data.accomplishments.length} accomplishments...`);
  
  const rows = data.accomplishments.map(a => ({
    quarter_id: getQuarterId(a.date),
    practice: mapPractice(a.practice),
    date: parseDate(a.date),
    project: clean(a.project),
    project_code: clean(a.projectCode),
    spoc: clean(a.spoc),
    employees: clean(a.employees),
    title: clean(a.title),
    details: clean(a.details),
    ai_tool: clean(a.aiTool),
    category: clean(a.category),
    before_baseline: clean(a.before),
    after_result: clean(a.after),
    quantified_impact: clean(a.impact),
    business_gains: clean(a.businessGains),
    cost: clean(a.cost) || 'Free of Cost',
    effort_saved: parseFloat(a.effortSaved) || null,
    status: clean(a.status) || 'Completed',
    evidence: clean(a.evidence),
    notes: clean(a.notes)
  }));

  const { error } = await sb.from('accomplishments').insert(rows);
  if (error) {
    console.error(`   ❌ ${error.message}`);
    return false;
  }
  
  console.log(`   ✅ ${rows.length} accomplishments inserted`);
  return true;
}

// ============ STEP 4: MIGRATE COPILOT USERS ============
async function migrateCopilotUsers() {
  console.log(`\n📋 Step 4: Migrating ${data.copilotUsers.length} copilot users...`);
  
  // Deduplicate by email
  const seenEmails = new Set();
  const rows = [];
  let skipped = 0;
  
  // Build a set of employee names who logged tasks
  const taskEmployees = new Set(
    data.tasks.map(t => (t.employee || '').trim().toLowerCase()).filter(Boolean)
  );
  
  data.copilotUsers.forEach(u => {
    const email = (u.email || '').trim().replace(/\u00a0/g, '');
    if (!email || seenEmails.has(email.toLowerCase())) {
      skipped++;
      return;
    }
    seenEmails.add(email.toLowerCase());
    
    const hasTask = taskEmployees.has((u.name || '').trim().toLowerCase());
    
    rows.push({
      practice: mapPractice(u.practice),
      name: (u.name || '').trim(),
      email: email,
      role_skill: clean(u.skill),
      status: clean(u.remarks) || 'access granted',
      remarks: clean(u.remarks),
      has_logged_task: hasTask
    });
  });
  
  if (skipped > 0) {
    console.log(`   ⚠ Skipped ${skipped} duplicate/empty email entries`);
  }
  
  let inserted = 0;
  let errors = 0;
  
  for (let i = 0; i < rows.length; i += 50) {
    const batch = rows.slice(i, i + 50);
    const { error } = await sb.from('copilot_users').insert(batch);
    if (error) {
      console.error(`   ❌ Batch ${i+1}-${i+batch.length}: ${error.message}`);
      errors++;
    } else {
      inserted += batch.length;
      console.log(`   ✅ Copilot users ${i+1}-${i+batch.length} inserted`);
    }
  }
  
  console.log(`   → ${inserted} copilot users inserted, ${errors} errors`);
  return errors === 0;
}

// ============ STEP 5: MIGRATE PROJECTS ============
async function migrateProjects() {
  console.log(`\n📋 Step 5: Migrating ${data.projects.length} projects...`);
  
  const rows = data.projects.map(p => ({
    practice: mapPractice(p.practice),
    project_name: clean(p.projectName) || clean(p.name) || 'Unnamed',
    project_code: clean(p.projectCode),
    contract_number: clean(p.contractNumber),
    customer: clean(p.customer),
    contract_value: parseFloat(p.contractValue || p.value) || 0,
    start_date: parseDate(p.startDate || p.start),
    end_date: parseDate(p.endDate || p.end),
    revenue_type: clean(p.revenueType),
    line_type: clean(p.lineType),
    project_manager: clean(p.projectManager || p.pm),
    is_active: true
  }));

  const { error } = await sb.from('projects').insert(rows);
  if (error) {
    console.error(`   ❌ ${error.message}`);
    return false;
  }
  
  console.log(`   ✅ ${rows.length} projects inserted`);
  return true;
}

// ============ STEP 6: VERIFY ============
async function verify() {
  console.log('\n🔍 Verifying migration...');
  
  const tables = ['practices', 'quarters', 'users', 'tasks', 'accomplishments', 'copilot_users', 'projects', 'lovs'];
  
  for (const table of tables) {
    const { count, error } = await sb.from(table).select('*', { count: 'exact', head: true });
    if (error) {
      console.log(`   ❌ ${table}: ${error.message}`);
    } else {
      console.log(`   ✅ ${table}: ${count} rows`);
    }
  }
}

// ============ MAIN ============
async function main() {
  console.log('🚀 EAS AI Dashboard — Data Migration');
  console.log('=====================================\n');
  
  // Step 1: Check schema
  const schemaReady = await runSchema();
  if (!schemaReady) {
    console.log('\n❌ Migration aborted. Run the schema SQL first.');
    process.exit(1);
  }
  
  // Step 2-5: Migrate data
  await migrateTasks();
  await migrateAccomplishments();
  await migrateCopilotUsers();
  await migrateProjects();
  
  // Step 6: Verify
  await verify();
  
  console.log('\n✅ Migration complete!\n');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
