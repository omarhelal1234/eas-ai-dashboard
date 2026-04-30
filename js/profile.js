// ============================================================
// EAS_Profile — self-serve profile edits.
// Backed by the update_my_profile RPC (sql/057) and
// supabase.auth.updateUser for the password path.
// ============================================================

const Profile = (() => {
  const sb = (typeof getSupabaseClient === 'function') ? getSupabaseClient() : null;
  let _current = null; // { user, licensed }

  function _client() {
    if (!sb) throw new Error('Profile: Supabase client not available');
    return sb;
  }

  function _setStatus(elId, kind, msg) {
    const el = document.getElementById(elId);
    if (!el) return;
    el.className = 'status-line ' + (kind || '');
    el.textContent = msg || '';
  }

  async function loadCurrent() {
    const profile = await EAS_Auth.getUserProfile(true);
    if (!profile) throw new Error('No user profile loaded');

    const { data: licensed } = await _client()
      .from('copilot_users')
      .select('id, email, practice, status, github_copilot_status')
      .ilike('email', profile.email)
      .maybeSingle();

    _current = { user: profile, licensed: licensed || null };
    return _current;
  }

  function wireAccount() {
    const nameEl = document.getElementById('pf-name');
    const emailEl = document.getElementById('pf-email');
    const roleEl = document.getElementById('pf-role');
    const btn = document.getElementById('pf-account-save');

    const roleLabels = {
      admin: 'Administrator', spoc: 'AI SPOC', dept_spoc: 'Dept SPOC',
      sector_spoc: 'Sector SPOC', team_lead: 'Team Lead',
      contributor: 'Contributor', viewer: 'Viewer', executive: 'Executive'
    };

    nameEl.value         = _current.user.name || '';
    emailEl.value        = _current.user.email || '';
    roleEl.textContent   = roleLabels[_current.user.role] || _current.user.role || '—';

    btn.addEventListener('click', async () => {
      const name = nameEl.value.trim();
      if (!name) { _setStatus('pf-account-status', 'err', 'Name cannot be empty.'); return; }
      if (name === (_current.user.name || '')) {
        _setStatus('pf-account-status', '', 'No changes.'); return;
      }

      btn.disabled = true;
      _setStatus('pf-account-status', '', 'Saving…');
      const { data, error } = await _client().rpc('update_my_profile', {
        p_changes: { name }
      });
      btn.disabled = false;
      if (error || !data?.ok) {
        _setStatus('pf-account-status', 'err', 'Error: ' + (error?.message || data?.reason || 'unknown'));
        return;
      }
      _current.user.name = name;
      _setStatus('pf-account-status', 'ok', 'Saved.');
    });
  }

  async function wireOrganization() {
    const sectorEl   = document.getElementById('pf-sector');
    const unitEl     = document.getElementById('pf-unit');
    const practiceEl = document.getElementById('pf-practice');
    const btn        = document.getElementById('pf-org-save');

    if (typeof EAS_Hierarchy === 'undefined') {
      _setStatus('pf-org-status', 'err', 'Hierarchy module unavailable.');
      return;
    }

    await EAS_Hierarchy.attachCascade({
      sectorEl, unitEl, practiceEl,
      initial: {
        sectorId:     _current.user.sector_id || null,
        departmentId: _current.user.department_id || null,
        practice:     _current.user.practice || null
      }
    });

    btn.addEventListener('click', async () => {
      const check = await EAS_Hierarchy.validateCascade(sectorEl, unitEl, practiceEl);
      if (!check.ok) { _setStatus('pf-org-status', 'err', check.error); return; }

      btn.disabled = true;
      _setStatus('pf-org-status', '', 'Saving…');
      const { data, error } = await _client().rpc('update_my_profile', {
        p_changes: {
          sector_id:     check.sectorId,
          department_id: check.departmentId,
          practice:      check.practice
        }
      });
      btn.disabled = false;
      if (error || !data?.ok) {
        _setStatus('pf-org-status', 'err', 'Error: ' + (error?.message || data?.reason || 'unknown'));
        return;
      }
      _current.user.sector_id     = check.sectorId;
      _current.user.department_id = check.departmentId;
      _current.user.practice      = check.practice;
      _setStatus('pf-org-status', 'ok', 'Saved.');
    });
  }

  function wireLicensed() {
    const statusEl = document.getElementById('pf-license-status');
    const ghEl     = document.getElementById('pf-gh-status');

    if (!_current.licensed) {
      statusEl.textContent = 'Not in licensed-tool roster';
      ghEl.textContent     = '—';
      return;
    }
    statusEl.textContent = _current.licensed.status || '—';
    ghEl.textContent     = _current.licensed.github_copilot_status || '—';
  }

  function wireSecurity() {
    const curEl     = document.getElementById('pf-pw-current');
    const newEl     = document.getElementById('pf-pw-new');
    const confirmEl = document.getElementById('pf-pw-confirm');
    const btn       = document.getElementById('pf-security-save');

    btn.addEventListener('click', async () => {
      const cur = curEl.value;
      const next = newEl.value;
      const confirm = confirmEl.value;

      if (!cur || !next || !confirm) {
        _setStatus('pf-security-status', 'err', 'Fill all three fields.'); return;
      }
      if (next.length < 8) {
        _setStatus('pf-security-status', 'err', 'New password must be at least 8 characters.'); return;
      }
      if (next !== confirm) {
        _setStatus('pf-security-status', 'err', 'New password and confirmation do not match.'); return;
      }

      btn.disabled = true;
      _setStatus('pf-security-status', '', 'Verifying current password…');

      // Re-auth round-trip to confirm the current password is correct.
      const { error: signInErr } = await _client().auth.signInWithPassword({
        email: _current.user.email,
        password: cur
      });
      if (signInErr) {
        btn.disabled = false;
        _setStatus('pf-security-status', 'err', 'Current password is incorrect.');
        return;
      }

      _setStatus('pf-security-status', '', 'Updating password…');
      const { error: updErr } = await _client().auth.updateUser({ password: next });
      btn.disabled = false;
      if (updErr) {
        _setStatus('pf-security-status', 'err', 'Error: ' + updErr.message);
        return;
      }
      curEl.value = newEl.value = confirmEl.value = '';
      _setStatus('pf-security-status', 'ok', 'Password updated.');
    });
  }

  async function init() {
    await loadCurrent();
    wireAccount();
    await wireOrganization();
    wireLicensed();
    wireSecurity();
  }

  return { init, loadCurrent, _setStatus, _client, get current() { return _current; } };
})();
