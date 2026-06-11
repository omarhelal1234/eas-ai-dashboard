// ============================================================
// EAS AI Dashboard -- Runtime Configuration
// ------------------------------------------------------------
// Backend configuration with an environment-aware seam so the app
// can target either Supabase Cloud (today) or the Ejada GCP
// deployment (post-migration) WITHOUT editing application code.
//
// Resolution order (first hit wins):
//   1. window.EAIS_CONFIG -- set by an optional, environment-specific
//      js/config.runtime.js loaded BEFORE this file. That file is
//      git-ignored; see js/config.runtime.example.js for its shape.
//      This is the single injection point the GCP deployment uses.
//   2. Built-in defaults below -- the current Supabase Cloud project,
//      so the existing GitHub Pages build keeps working unchanged
//      when no runtime override is present.
//
// Nothing in this file is a secret: the only key is the Supabase
// *publishable* (anon) key, which is designed to be exposed in client
// code. Never put a service-role key or a DB password here.
//
// See docs/migration/SOURCE_CODE_MIGRATION_ASSESSMENT.md for how this
// seam is used across the Supabase -> GCP migration passes.
// ============================================================

(function () {
  // ---- 1. Built-in defaults (current Supabase Cloud project) ----
  var DEFAULTS = {
    // 'supabase' (today) | 'gcp' (post-migration)
    backend: 'supabase',
    supabaseUrl: 'https://apcfnzbiylhgiutcjigg.supabase.co',
    supabaseAnonKey: 'sb_publishable_fO29UdOY1Wa8_LOgjDj2Pg_iZ7bhKJ3',
    // Base URL for serverless backend functions. On Supabase these live
    // at <supabaseUrl>/functions/v1; on GCP they become Cloud Run
    // services fronted by the SAML gateway. null => derived below.
    functionsBaseUrl: null
  };

  // ---- 2. Merge any environment override ----
  var override = (typeof window !== 'undefined' && window.EAIS_CONFIG) || {};
  var cfg = Object.assign({}, DEFAULTS, override);

  // Derive functionsBaseUrl when the environment did not set it explicitly.
  if (!cfg.functionsBaseUrl) {
    cfg.functionsBaseUrl = cfg.supabaseUrl
      ? cfg.supabaseUrl.replace(/\/+$/, '') + '/functions/v1'
      : '';
  }

  // Expose the resolved config for any code that wants structured access.
  if (typeof window !== 'undefined') {
    window.EAIS_CONFIG = cfg;
    // ---- 3. Back-compat globals ----
    // Existing code reads SUPABASE_URL directly (e.g. db.js builds
    // the string SUPABASE_URL + '/functions/v1/...') and calls
    // getSupabaseClient(). Keep those working by mirroring onto window.
    window.SUPABASE_URL = cfg.supabaseUrl;
    window.SUPABASE_ANON_KEY = cfg.supabaseAnonKey;
  }
})();

// Bare globals for legacy references. These mirror window.* (set above),
// which remains the single source of truth.
var SUPABASE_URL = window.SUPABASE_URL;
var SUPABASE_ANON_KEY = window.SUPABASE_ANON_KEY;

// Initialize the Supabase client (requires the supabase-js CDN script first):
// <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"></script>
function getSupabaseClient() {
  if (!window._supabase) {
    window._supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return window._supabase;
}

// Migration seam: base URL for backend functions. Today this resolves to
// the Supabase Edge Functions endpoint; post-migration the GCP runtime
// config points it at the Cloud Run services. New code should call this
// instead of hardcoding the Supabase functions path.
function getFunctionsBaseUrl() {
  return (window.EAIS_CONFIG && window.EAIS_CONFIG.functionsBaseUrl) || '';
}
