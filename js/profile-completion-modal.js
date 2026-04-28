// ============================================================
// EAS AI Dashboard — Profile Completion Modal (Phase 2)
// Fires when js/auth.js dispatches `eas:profile-incomplete` for
// users whose users.profile_completed = false (typically backfilled
// pre-existing users that the migration couldn't auto-resolve).
//
// Submits via the existing complete_profile RPC and flips
// users.profile_completed = true. Reloads the page on success so
// every cached query re-runs with the user's new scope.
// ============================================================

(() => {
  const sb = (typeof getSupabaseClient === 'function') ? getSupabaseClient() : null;
  let _opened = false;

  function buildModal(profile) {
    const wrap = document.createElement('div');
    wrap.className = 'events-modal-backdrop profile-completion-backdrop';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.innerHTML = `
      <div class="events-modal profile-completion-modal" role="document" style="max-width:560px;">
        <div class="events-modal-header">
          <h2>Complete your profile</h2>
          <button class="events-modal-close" id="pc-close-btn" aria-label="Close" style="display:none;">×</button>
        </div>
        <div class="events-modal-body">
          <p style="margin:0 0 16px;color:var(--text-muted, #555);">
            Welcome back! We've expanded the org hierarchy. Please confirm where you sit so dashboards and approvals route correctly.
          </p>
          <div class="form-group" style="margin-bottom:12px;">
            <label for="pc-sector" style="display:block;font-weight:600;margin-bottom:4px;">Sector *</label>
            <select id="pc-sector" required style="width:100%;padding:8px;">
              <option value="" disabled selected>Loading sectors…</option>
            </select>
          </div>
          <div class="form-group" style="margin-bottom:12px;">
            <label for="pc-unit" style="display:block;font-weight:600;margin-bottom:4px;">Unit / Department *</label>
            <select id="pc-unit" required style="width:100%;padding:8px;">
              <option value="" disabled selected>Select sector first…</option>
            </select>
          </div>
          <div class="form-group" style="margin-bottom:12px;">
            <label for="pc-practice" style="display:block;font-weight:600;margin-bottom:4px;">Practice *</label>
            <select id="pc-practice" required style="width:100%;padding:8px;">
              <option value="" disabled selected>Select unit first…</option>
            </select>
          </div>
          <div id="pc-error" style="color:#c0392b;font-size:13px;margin-top:8px;display:none;"></div>
        </div>
        <div class="events-modal-footer" style="display:flex;justify-content:flex-end;gap:8px;padding:12px 16px;border-top:1px solid var(--border-color, #e0e0e0);">
          <button id="pc-save-btn" class="btn btn-primary">Save</button>
        </div>
      </div>
    `;
    return wrap;
  }

  function showError(modal, msg) {
    const el = modal.querySelector('#pc-error');
    if (el) {
      el.textContent = msg;
      el.style.display = 'block';
    }
  }

  async function open(profile) {
    if (_opened) return;
    _opened = true;

    if (typeof EAS_Hierarchy === 'undefined') {
      console.warn('ProfileCompletionModal: EAS_Hierarchy module not loaded');
      _opened = false;
      return;
    }

    const modal = buildModal(profile);
    document.body.appendChild(modal);

    const sectorEl   = modal.querySelector('#pc-sector');
    const unitEl     = modal.querySelector('#pc-unit');
    const practiceEl = modal.querySelector('#pc-practice');

    await EAS_Hierarchy.attachCascade({
      sectorEl, unitEl, practiceEl,
      initial: {
        sectorId:     profile?.sector_id || null,
        departmentId: profile?.department_id || null,
        practice:     profile?.practice || null
      }
    });

    modal.querySelector('#pc-save-btn').addEventListener('click', async () => {
      const check = EAS_Hierarchy.validateCascade(sectorEl, unitEl, practiceEl);
      if (!check.ok) { showError(modal, check.error); return; }

      const btn = modal.querySelector('#pc-save-btn');
      btn.disabled = true;
      btn.textContent = 'Saving…';

      try {
        const { error } = await sb.from('users').update({
          sector_id:        check.sectorId,
          department_id:    check.departmentId,
          practice:         check.practice,
          profile_completed: true
        }).eq('id', profile.id);
        if (error) {
          showError(modal, 'Failed to save: ' + error.message);
          btn.disabled = false;
          btn.textContent = 'Save';
          return;
        }
        // Sync role from new org path (in case the email matches a *_spoc_email)
        await sb.rpc('sync_user_role_from_org', { p_user_id: profile.id }).catch(() => {});
        // Drop the modal and force a full reload so caches re-fetch with new scope.
        modal.remove();
        window.location.reload();
      } catch (e) {
        showError(modal, 'Unexpected error: ' + (e?.message || e));
        btn.disabled = false;
        btn.textContent = 'Save';
      }
    });
  }

  // Listen for the event dispatched by js/auth.js (Phase 1)
  window.addEventListener('eas:profile-incomplete', (ev) => {
    const profile = ev?.detail?.user;
    if (profile) open(profile);
  });
})();
