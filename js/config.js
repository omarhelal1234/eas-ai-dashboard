// ============================================================
// EAS AI Dashboard — Supabase Configuration
// Phase 1: Database Migration
// ============================================================

const SUPABASE_URL = 'https://apcfnzbiylhgiutcjigg.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_fO29UdOY1Wa8_LOgjDj2Pg_iZ7bhKJ3';

// Initialize Supabase client (requires CDN script loaded first)
// <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"></script>
function getSupabaseClient() {
  if (!window._supabase) {
    window._supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return window._supabase;
}
