// ============================================================
// EAS AI Dashboard — Runtime Configuration OVERRIDE (example)
// ------------------------------------------------------------
// Copy this file to  js/config.runtime.js  and edit the values for
// the target environment, THEN load it BEFORE js/config.js on each
// HTML page:
//
//   <script src="../../js/config.runtime.js"></script>  <!-- optional, env-specific -->
//   <script src="../../js/config.js"></script>
//
// js/config.runtime.js is GIT-IGNORED on purpose — each environment
// (GitHub Pages today, GCP later, on-prem staging) ships its own. If
// the file is absent — as on the current GitHub Pages build — config.js
// falls back to its built-in Supabase defaults, so omitting it is
// always safe and the app is unchanged.
//
// Nothing in this file is a secret. The Supabase anon key is a
// *publishable* key. The GCP build carries no client-side data key at
// all — auth and the data API move behind the SAML gateway. Never put
// a service-role key, DB password, or client secret here.
// ============================================================

window.EAIS_CONFIG = {
  // Which backend the frontend talks to:
  //   'supabase' — Supabase Cloud (current production)
  //   'gcp'      — Ejada GCP deployment (post-migration)
  backend: 'supabase',

  // --- When backend: 'supabase' ---------------------------------
  // The Supabase project URL and publishable (anon) key.
  supabaseUrl: 'https://YOUR-PROJECT.supabase.co',
  supabaseAnonKey: 'sb_publishable_XXXXXXXXXXXXXXXXXXXX',

  // --- When backend: 'gcp' --------------------------------------
  // Served from GCP behind the SAML gateway. The gateway terminates
  // Entra ID SAML, then reverse-proxies:
  //   /rest/*       -> self-hosted PostgREST  (the sb.from(...) data layer)
  //   /functions/*  -> the Cloud Run services (former Edge Functions)
  // Point functionsBaseUrl at that gateway path; leave supabaseUrl
  // pointing at the gateway origin so getSupabaseClient() resolves.
  //
  // backend: 'gcp',
  // supabaseUrl: 'https://e-ai-s.ejada.internal',
  // supabaseAnonKey: '',                       // no client key on GCP
  // functionsBaseUrl: 'https://e-ai-s.ejada.internal/functions'
};
