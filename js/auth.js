// ============================================================
// EAS AI Dashboard — Authentication Module
// Phase 2: Auth & Sessions
// ============================================================

const EAS_Auth = (() => {
  const sb = getSupabaseClient();
  let _currentUser = null;
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

  /** Get user profile from public.users table (cached) */
  async function getUserProfile(forceRefresh = false) {
    if (_userProfile && !forceRefresh) return _userProfile;

    // Try localStorage cache first
    const cached = localStorage.getItem('eas_user_profile');
    if (cached && !forceRefresh) {
      _userProfile = JSON.parse(cached);
      return _userProfile;
    }

    const user = await getUser();
    if (!user) return null;

    const { data, error } = await sb
      .from('users')
      .select('id, name, email, role, practice, is_active')
      .eq('auth_id', user.id)
      .single();

    if (error || !data) return null;

    _userProfile = data;
    localStorage.setItem('eas_user_profile', JSON.stringify(data));
    return data;
  }

  /** Sign out and redirect to login */
  async function signOut() {
    await sb.auth.signOut();
    localStorage.removeItem('eas_user_profile');
    localStorage.removeItem('eas_selected_quarter');
    _currentUser = null;
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

    const profile = await getUserProfile();
    if (!profile) {
      await signOut();
      return false;
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

  /** Update user info display in sidebar */
  function updateUserDisplay() {
    const nameEl = document.getElementById('user-display-name');
    const roleEl = document.getElementById('user-display-role');
    const practiceEl = document.getElementById('user-display-practice');

    if (nameEl) nameEl.textContent = getUserName();
    if (roleEl) {
      const roleLabels = { admin: 'Administrator', spoc: 'AI SPOC', contributor: 'Contributor' };
      roleEl.textContent = roleLabels[getUserRole()] || getUserRole();
    }
    if (practiceEl) practiceEl.textContent = getUserPractice();
  }

  // ---- Auth State Listener ----

  function onAuthStateChange(callback) {
    sb.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        _userProfile = null;
        localStorage.removeItem('eas_user_profile');
      }
      if (callback) callback(event, session);
    });
  }

  return {
    getSession,
    getUser,
    getUserProfile,
    signOut,
    isAdmin,
    isSPOC,
    isContributor,
    getUserRole,
    getUserPractice,
    getUserName,
    requireAuth,
    applyRoleVisibility,
    updateUserDisplay,
    onAuthStateChange
  };
})();
