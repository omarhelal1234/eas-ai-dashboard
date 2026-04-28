// ============================================================
// EAS AI Dashboard — Authentication Module
// Phase 2: Auth & Sessions
// ============================================================

const EAS_Auth = (() => {
  const sb = getSupabaseClient();
  let _userProfile = null;

  // ---- Session Management ----

  /** Check if user is authenticated; returns session or null */
  async function getSession() {
    const { data: { session } } = await sb.auth.getSession();
    return session;
  }

  /** Get current auth user */
  async function getUser() {
    const { data: { user } } = await sb.auth.getUser();
    return user;
  }

  /** Get user profile from public.users table (cached with 5-min TTL) */
  async function getUserProfile(forceRefresh = false) {
    if (_userProfile && !forceRefresh) return _userProfile;

    // Try localStorage cache with TTL check
    const cached = localStorage.getItem('eas_user_profile');
    const cachedAt = localStorage.getItem('eas_user_profile_ts');
    const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
    if (cached && cachedAt && !forceRefresh) {
      if (Date.now() - parseInt(cachedAt) < CACHE_TTL) {
        _userProfile = JSON.parse(cached);
        return _userProfile;
      }
    }

    const user = await getUser();
    if (!user) return null;

    const { data, error } = await sb
      .from('users')
      .select('id, name, email, role, practice, is_active, department_id, sector_id, profile_completed')
      .eq('auth_id', user.id)
      .single();

    if (error || !data) {
      console.error('getUserProfile error:', error?.message);
      return null;
    }

    _userProfile = data;
    localStorage.setItem('eas_user_profile', JSON.stringify(data));
    localStorage.setItem('eas_user_profile_ts', String(Date.now()));
    return data;
  }

  /** Get cached user id (public.users.id) if available */
  function getUserId() {
    return _userProfile?.id || null;
  }

  /** Sign out and redirect to login */
  async function signOut() {
    await sb.auth.signOut();
    localStorage.removeItem('eas_user_profile');
    localStorage.removeItem('eas_user_profile_ts');
    localStorage.removeItem('eas_selected_quarter');
    _userProfile = null;
    window.location.href = 'login.html';
  }

  // ---- Role Checks ----

  function isAdmin() {
    return _userProfile?.role === 'admin';
  }

  function isSPOC() {
    return _userProfile?.role === 'spoc';
  }

  function isContributor() {
    return _userProfile?.role === 'contributor';
  }

  function isTeamLead() {
    return _userProfile?.role === 'team_lead';
  }

  function isDeptSpoc() {
    return _userProfile?.role === 'dept_spoc';
  }

  function isSectorSpoc() {
    return _userProfile?.role === 'sector_spoc';
  }

  function getUserDepartmentId() {
    return _userProfile?.department_id || null;
  }

  function getUserSectorId() {
    return _userProfile?.sector_id || null;
  }

  function getUserRole() {
    return _userProfile?.role || 'contributor';
  }

  function getUserPractice() {
    return _userProfile?.practice || '';
  }

  function getUserName() {
    return _userProfile?.name || '';
  }

  // ---- Auth Guard ----

  /** Check auth on page load; redirect to login if not authenticated */
  async function requireAuth() {
    // Use getUser() instead of getSession() — validates with server, not just local cache
    const user = await getUser();
    if (!user) {
      window.location.href = 'login.html';
      return false;
    }

    // Always force-refresh on page load: prevents stale localStorage cache
    // from hiding new columns (e.g. department_id) or role changes.
    let profile = await getUserProfile(true);
    if (!profile) {
      await signOut();
      return false;
    }

    // Auto-promote based on org-chart email match (spec §9). Never demotes.
    // sync_user_role_from_org returns the new role on promotion or a string
    // sentinel ('no_match', 'protected_role', 'no_demote') otherwise.
    try {
      const { data: promoted } = await sb.rpc('sync_user_role_from_org', { p_user_id: profile.id });
      if (promoted && !['no_match', 'protected_role', 'no_demote', 'no_user'].includes(promoted)) {
        profile = await getUserProfile(true); // refresh — role/scope changed
      }
    } catch (e) {
      console.warn('sync_user_role_from_org failed (non-fatal):', e?.message || e);
    }

    // Profile-completion event (spec §8.2). Phase 1 dispatches the event;
    // Phase 2 wires the cascading-dropdown modal to it.
    if (profile && profile.profile_completed === false) {
      try {
        window.dispatchEvent(new CustomEvent('eas:profile-incomplete', { detail: { user: profile } }));
      } catch (_) { /* CustomEvent unavailable — skip */ }
    }

    // Fire-and-forget: mount the header bell and open the upcoming-events
    // pop-up once per page load. Guard ensures no-op when EventsModal module
    // isn't loaded on a page.
    if (typeof EventsModal !== 'undefined' && EventsModal.openForCurrentUser) {
      setTimeout(() => {
        const slot = document.getElementById('events-bell-slot');
        if (slot) EventsModal.mountBell(slot);
        EventsModal.openForCurrentUser({ auto: true }).catch(() => {});
      }, 400);
    }

    // Pending approvals pop-up for approver roles (admin/spoc/dept_spoc/team_lead).
    // Fires after the events modal; each modal gates itself to once per page load
    // and approvals additionally gates once per user per day via localStorage.
    if (typeof ApprovalsModal !== 'undefined' && ApprovalsModal.openForCurrentUser) {
      setTimeout(() => {
        ApprovalsModal.openForCurrentUser({ auto: true }).catch(() => {});
      }, 1200);
    }

    return true;
  }

  // ---- UI Helpers ----

  /** Apply role-based visibility to DOM elements */
  function applyRoleVisibility() {
    const role = getUserRole();

    // Elements with data-role attribute: show only for specified roles
    document.querySelectorAll('[data-role]').forEach(el => {
      const allowedRoles = el.dataset.role.split(',').map(r => r.trim());
      el.style.display = allowedRoles.includes(role) ? '' : 'none';
    });

    // Elements with data-hide-role: hide for specified roles
    document.querySelectorAll('[data-hide-role]').forEach(el => {
      const hiddenRoles = el.dataset.hideRole.split(',').map(r => r.trim());
      el.style.display = hiddenRoles.includes(role) ? 'none' : '';
    });
  }

  /**
   * Apply admin-managed view permissions from the database.
   * Hides nav items (and their corresponding page divs) where
   * is_visible === false. Runs AFTER applyRoleVisibility() so
   * the intersection model holds: data-role gates first, then
   * DB permissions further restrict.
   *
   * Fail-open: if a view_key has no entry in the map, it stays visible.
   *
   * @param {Map<string, boolean>} permissionsMap - Map of view_key → is_visible
   */
  function applyViewPermissions(permissionsMap) {
    if (!permissionsMap || permissionsMap.size === 0) return;

    document.querySelectorAll('[data-view-key]').forEach(el => {
      const viewKey = el.dataset.viewKey;
      const isVisible = permissionsMap.get(viewKey);

      // Only hide if explicitly set to false (fail-open for missing keys)
      if (isVisible === false) {
        el.style.display = 'none';

        // Also hide the corresponding page div if it has a data-page
        const pageKey = el.dataset.page;
        if (pageKey) {
          const pageDiv = document.getElementById('page-' + pageKey);
          if (pageDiv) pageDiv.classList.add('hidden');
        }
      }
    });
  }

  /** Update user info display in sidebar */
  function updateUserDisplay() {
    const nameEl = document.getElementById('user-display-name');
    const roleEl = document.getElementById('user-display-role');
    const practiceEl = document.getElementById('user-display-practice');

    if (nameEl) nameEl.textContent = getUserName();
    if (roleEl) {
      const roleLabels = { admin: 'Administrator', spoc: 'AI SPOC', dept_spoc: 'Dept SPOC', sector_spoc: 'Sector SPOC', contributor: 'Contributor', viewer: 'Viewer', executive: 'Executive', team_lead: 'Team Lead' };
      roleEl.textContent = roleLabels[getUserRole()] || getUserRole();
    }
    if (practiceEl) practiceEl.textContent = getUserPractice();
  }

  return {
    getSession,
    getUser,
    getUserProfile,
    signOut,
    isAdmin,
    isSPOC,
    isDeptSpoc,
    isSectorSpoc,
    isContributor,
    isTeamLead,
    getUserRole,
    getUserPractice,
    getUserDepartmentId,
    getUserSectorId,
    getUserName,
    getUserId,
    requireAuth,
    applyRoleVisibility,
    applyViewPermissions,
    updateUserDisplay
  };
})();
