/**
 * ============================================================
 * Phase 8: Task/Accomplishment Submission with AI Validation
 * Multi-layer Approval Workflow
 * ============================================================
 */

console.log('📦 Phase8 module loading...');

window.Phase8 = (() => {
  console.log('✅ Phase8 IIFE initializing...');
  // Supabase Edge Functions - deployed live for all employees
  const API_BASE = 'https://apcfnzbiylhgiutcjigg.supabase.co/functions/v1';

  // Global state for current submission being worked on
  let _currentSubmission = {
    type: null, // 'task' or 'accomplishment'
    aiValidation: null,
  };

  // ========== EMPLOYEE SEARCHABLE DROPDOWN ==========
  
  /**
   * Initialize a searchable employee dropdown from licensed Copilot users.
   * Admin sees all practices; SPOC sees own practice only.
   * @param {string} searchInputId - ID of the search text input
   * @param {string} practiceId - ID of practice select field
   */
  async function initEmployeeDropdown(searchInputId, practiceId) {
    const searchInput = document.getElementById(searchInputId);
    const practiceSelect = document.getElementById(practiceId);
    if (!searchInput || !practiceSelect) return;

    let allUsers = [];
    const userRole = typeof EAS_Auth !== 'undefined' ? EAS_Auth.getUserRole() : 'contributor';

    // Helper: fetch users based on role and practice
    async function loadUsers(practice) {
      if (userRole === 'admin') {
        // Admin can log tasks for anyone; if practice selected, filter by it
        allUsers = await EAS_DB.fetchCopilotUsersByPractice(practice || null);
      } else {
        // SPOC/contributor: only their own practice
        allUsers = practice ? await EAS_DB.fetchCopilotUsersByPractice(practice) : [];
      }
      renderDropdownOptions('');
    }

    // Helper: render filtered options
    function renderDropdownOptions(filter) {
      const dropdown = document.getElementById(searchInputId.replace('-search', '') + '-dropdown-list');
      if (!dropdown) return;

      const term = filter.toLowerCase();
      const filtered = term
        ? allUsers.filter(u => u.name.toLowerCase().includes(term) || u.email.toLowerCase().includes(term))
        : allUsers;

      dropdown.innerHTML = '';
      if (filtered.length === 0) {
        const empty = document.createElement('div');
        empty.style.cssText = 'padding:10px 12px;color:var(--text-muted);font-size:13px;text-align:center';
        empty.textContent = allUsers.length === 0 ? 'Select a practice first' : 'No matching employees found';
        dropdown.appendChild(empty);
      } else {
        filtered.slice(0, 20).forEach(user => {
          const item = document.createElement('div');
          item.style.cssText = 'padding:8px 12px;cursor:pointer;border-bottom:1px solid var(--border);transition:background 0.15s';
          item.innerHTML = `<div style="font-weight:500">${user.name}</div><div style="font-size:12px;color:var(--text-muted)">${user.email}${user.practice ? ' — ' + user.practice : ''}</div>`;
          item.addEventListener('mouseenter', () => item.style.background = 'var(--hover-bg)');
          item.addEventListener('mouseleave', () => item.style.background = 'transparent');
          item.addEventListener('mousedown', (e) => {
            e.preventDefault(); // prevent blur before click completes
            selectEmployee(user);
          });
          dropdown.appendChild(item);
        });
        if (filtered.length > 20) {
          const more = document.createElement('div');
          more.style.cssText = 'padding:6px 12px;color:var(--text-muted);font-size:12px;text-align:center';
          more.textContent = `...and ${filtered.length - 20} more. Type to narrow results.`;
          dropdown.appendChild(more);
        }
      }
    }

    // Helper: select an employee
    function selectEmployee(user) {
      searchInput.value = user.name;
      document.getElementById('f-employee-id').value = user.id;
      document.getElementById('f-employee-email').value = user.email;
      searchInput.dataset.selectedUserId = user.id;
      searchInput.dataset.selectedEmail = user.email;
      searchInput.dataset.selectedName = user.name;
      hideDropdown();
    }

    // Create and attach the dropdown container
    function ensureDropdown() {
      const existingDropdown = document.getElementById(searchInputId.replace('-search', '') + '-dropdown-list');
      if (existingDropdown) return existingDropdown;

      const container = searchInput.parentElement;
      const dropdown = document.createElement('div');
      dropdown.id = searchInputId.replace('-search', '') + '-dropdown-list';
      dropdown.style.cssText = `
        display:none; position:absolute; top:100%; left:0; right:0; z-index:1001;
        max-height:220px; overflow-y:auto; background:var(--surface); 
        border:1px solid var(--primary); border-top:none; border-radius:0 0 6px 6px;
        box-shadow:0 4px 12px rgba(0,0,0,0.15);
      `;
      container.appendChild(dropdown);
      return dropdown;
    }

    function showDropdown() {
      const dropdown = ensureDropdown();
      dropdown.style.display = 'block';
    }

    function hideDropdown() {
      const dropdown = document.getElementById(searchInputId.replace('-search', '') + '-dropdown-list');
      if (dropdown) dropdown.style.display = 'none';
    }

    // On practice change, reload users — guard prevents duplicate listeners across modal re-opens
    if (!practiceSelect.dataset.empDropdownListenerAttached) {
      practiceSelect.dataset.empDropdownListenerAttached = 'true';
      practiceSelect.addEventListener('change', async () => {
        const practice = practiceSelect.value;
        searchInput.value = '';
        searchInput.dataset.selectedUserId = '';
        searchInput.dataset.selectedEmail = '';
        searchInput.dataset.selectedName = '';
        document.getElementById('f-employee-id').value = '';
        document.getElementById('f-employee-email').value = '';
        await loadUsers(practice);
        // Reveal dropdown immediately so user sees loaded employees without needing to re-focus
        if (practice) { ensureDropdown(); showDropdown(); }
      });
    }

    // Guard search input listeners — only attach once per input element
    if (!searchInput.dataset.empSearchListenerAttached) {
      searchInput.dataset.empSearchListenerAttached = 'true';

      // On search input focus, show dropdown
      searchInput.addEventListener('focus', () => {
        ensureDropdown();
        renderDropdownOptions(searchInput.value);
        showDropdown();
      });

      // On search input typing, filter
      searchInput.addEventListener('input', () => {
        // Clear selected state when user types
        searchInput.dataset.selectedUserId = '';
        searchInput.dataset.selectedEmail = '';
        searchInput.dataset.selectedName = '';
        document.getElementById('f-employee-id').value = '';
        document.getElementById('f-employee-email').value = '';
        renderDropdownOptions(searchInput.value);
        showDropdown();
      });

      // On blur, hide dropdown and validate selection
      searchInput.addEventListener('blur', () => {
        setTimeout(() => {
          hideDropdown();
          // If typed value doesn't match a selection, warn
          if (searchInput.value.trim() && !searchInput.dataset.selectedUserId) {
            searchInput.style.borderColor = 'var(--danger)';
          } else if (searchInput.dataset.selectedUserId) {
            searchInput.style.borderColor = 'var(--success)';
          } else {
            searchInput.style.borderColor = '';
          }
        }, 200);
      });
    }

    // Pre-load users if practice is already selected
    if (practiceSelect.value) {
      await loadUsers(practiceSelect.value);
    }
  }

  /**
   * Legacy wrapper — calls the new dropdown initializer
   */
  function initEmployeeAutocomplete(inputId, practiceId) {
    // Map old input ID to new search input ID
    const searchId = inputId + '-search';
    initEmployeeDropdown(searchId, practiceId);
  }

  // ========== SAVED HOURS CALCULATION ==========

  /**
   * Calculate saved hours in real-time and update display
   * @param {string} withoutHoursId - ID of "time without AI" input
   * @param {string} withHoursId - ID of "time with AI" input
   * @param {string} savedDisplayId - ID of element to show saved hours
   */
  function initSavedHoursCalculation(withoutHoursId, withHoursId, savedDisplayId) {
    const withoutInput = document.getElementById(withoutHoursId);
    const withInput = document.getElementById(withHoursId);
    const savedDisplay = document.getElementById(savedDisplayId);

    if (!withoutInput || !withInput || !savedDisplay) return;

    function updateSavedHours() {
      const without = parseFloat(withoutInput.value) || 0;
      const with_ = parseFloat(withInput.value) || 0;
      const saved = without - with_;
      savedDisplay.textContent = saved.toFixed(1) + 'h';
      savedDisplay.style.color = saved > 0 ? 'var(--success)' : 'var(--danger)';
      savedDisplay.className = saved > 0 ? 'success' : 'error';
      // Trigger approval tier display update if function exists
      if (typeof updateApprovalTierDisplay === 'function') {
        updateApprovalTierDisplay();
      }
      return saved;
    }

    withoutInput.addEventListener('change', updateSavedHours);
    withoutInput.addEventListener('input', updateSavedHours);
    withInput.addEventListener('change', updateSavedHours);
    withInput.addEventListener('input', updateSavedHours);

    updateSavedHours();
  }

  // ========== AI VALIDATION (DISABLED) ==========

  /**
   * AI validation has been disabled. Approval routing is now purely hours-based:
   * - < 5h saved → auto-approved
   * - 5–10h saved → SPOC review
   * - > 10h saved → SPOC → Admin review
   */
  async function validateSubmission() {
    return { isValid: true, reason: 'AI validation disabled — hours-based routing active' };
  }

  // showValidationResult removed — AI validation no longer used

  // ========== USE-CASE LINKAGE STATUS ==========

  /**
   * Poll the tasks.link_status column for up to 90s after a task insert
   * and render an inline message to `hostEl` per status band. The function
   * is fire-and-forget — callers should NOT await it.
   *
   * Status bands (Phase D Task 18):
   *   pending          → "Linking to existing use case…" (spinner)
   *   linked           → "Linked to: <name>"
   *   review           → "Suggested match: <name> — pending SPOC review"
   *   no_match         → "No matching use case yet — your task will be reviewed."
   *   failed_retryable → "Linking…" (spinner, keeps polling)
   *   failed_permanent → "Linkage temporarily unavailable — your task will be reviewed manually."
   *   manual           → "Linked (manual): <name>"
   *
   * @param {string|number} taskId
   * @param {HTMLElement} hostEl
   */
  async function showLinkageStatus(taskId, hostEl, isCancelled) {
    const STATUSES = {
      pending:          { msg: 'Linking to existing use case…', spinner: true },
      linked:           { msg: (n) => 'Linked to: ' + n, spinner: false },
      review:           { msg: (n) => 'Suggested match: ' + n + ' — pending SPOC review', spinner: false },
      no_match:         { msg: 'No matching use case yet — your task will be reviewed.', spinner: false },
      failed_retryable: { msg: 'Linking…', spinner: true },
      failed_permanent: { msg: 'Linkage temporarily unavailable — your task will be reviewed manually.', spinner: false },
      manual:           { msg: (n) => 'Linked (manual): ' + n, spinner: false },
    };
    // Phase D codex review FIX F — bail out as soon as the user dismisses the
    // banner so we don't keep polling tasks.fetchTaskLinkage in the background.
    const cancelled = (typeof isCancelled === 'function') ? isCancelled : () => false;
    const start = Date.now();
    while (Date.now() - start < 90000) {
      if (cancelled()) return null;
      try {
        if (!window.EAS_DB || typeof window.EAS_DB.fetchTaskLinkage !== 'function') {
          if (!cancelled()) hostEl.textContent = 'Linkage status unavailable (DB helper missing).';
          return null;
        }
        const row = await window.EAS_DB.fetchTaskLinkage(taskId);
        if (cancelled()) return null;
        const cfg = STATUSES[row && row.link_status] || STATUSES.pending;
        const name = (row && row.use_cases && (row.use_cases.name || row.use_cases.asset_id)) || '';
        hostEl.textContent = typeof cfg.msg === 'function' ? cfg.msg(name) : cfg.msg;
        hostEl.dataset.status = (row && row.link_status) || 'pending';
        if (!cfg.spinner) return row;
      } catch (e) {
        if (cancelled()) return null;
        hostEl.textContent = 'Could not fetch linkage status: ' + (e && e.message ? e.message : e);
        hostEl.dataset.status = 'error';
        return null;
      }
      await new Promise(r => setTimeout(r, 3000));
    }
    if (cancelled()) return null;
    hostEl.textContent = 'Linkage still processing — refresh to see updates.';
    hostEl.dataset.status = 'timeout';
    return null;
  }

  /**
   * Create a floating, dismissable banner anchored to the bottom-right of the
   * viewport to host linkage-status updates. The submission modal is closed
   * by the caller immediately after submitWithApproval returns, so we cannot
   * append to the form — the banner persists across re-renders.
   * @param {string|number} taskId
   * @returns {{hostEl: HTMLElement, isCancelled: () => boolean, cancel: () => void}}
   *   hostEl     — element showLinkageStatus writes to
   *   isCancelled — pass to showLinkageStatus so it stops polling on dismiss
   *   cancel     — programmatic cancel (e.g. on page navigation)
   */
  function createLinkageStatusBanner(taskId) {
    // Remove any prior banner for the same task to avoid stacking
    const prior = document.getElementById('phase8-link-status-' + taskId);
    if (prior && prior.parentNode) prior.parentNode.removeChild(prior);

    const wrap = document.createElement('div');
    wrap.id = 'phase8-link-status-' + taskId;
    wrap.className = 'phase8-link-status-banner';
    wrap.style.cssText = [
      'position:fixed', 'right:16px', 'bottom:16px', 'z-index:2000',
      'max-width:360px', 'padding:10px 14px',
      'background:var(--surface,#fff)', 'color:var(--text,#111)',
      'border:1px solid var(--primary,#6C5CE7)', 'border-radius:8px',
      'box-shadow:0 4px 12px rgba(0,0,0,0.15)',
      'font-size:13px', 'line-height:1.4',
    ].join(';');

    const status = document.createElement('p');
    status.className = 'phase8-link-status';
    status.dataset.status = 'pending';
    status.style.cssText = 'margin:0';
    status.textContent = 'Linking to existing use case…';

    // Phase D codex review FIX F — closed-over flag flipped by dismiss button
    // (and exposed via cancel()) so the polling loop in showLinkageStatus can
    // exit promptly instead of running for the full 90s budget.
    let cancelled = false;
    const cancel = () => {
      cancelled = true;
      if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
    };

    const close = document.createElement('button');
    close.type = 'button';
    close.setAttribute('aria-label', 'Dismiss linkage status');
    close.textContent = '×';
    close.style.cssText = 'position:absolute;top:4px;right:8px;background:transparent;border:0;font-size:18px;cursor:pointer;color:var(--text-muted,#666)';
    close.addEventListener('click', cancel);

    wrap.appendChild(close);
    wrap.appendChild(status);
    document.body.appendChild(wrap);

    // Backwards-compat: legacy callers that did `const hostEl = createLinkageStatusBanner(...)`
    // still work because we attach the helpers as properties on the host element.
    status.cancel = cancel;
    Object.defineProperty(status, 'isCancelled', { value: () => cancelled });
    return { hostEl: status, isCancelled: () => cancelled, cancel };
  }

  // ========== APPROVAL WORKFLOW ==========

  /**
   * Submit task/accomplishment with approval workflow
   */
  async function submitWithApproval(submissionType, formData) {
    const profile = await EAS_Auth.getUserProfile();
    const isAdmin = profile?.role === 'admin';

    try {
      if (submissionType === 'task') {
        const result = isAdmin && formData.bypassApproval
          ? await EAS_DB.insertTask(formData)
          : await EAS_DB.submitTaskWithApproval(formData);
        
        if (!result) throw new Error('Failed to save task');
        const taskId = result.task?.id || result.id;
        const approval = result.approval;

        // Show appropriate message based on hours-based routing + frequency-based overrides
        const savedHours = (formData.timeWithout || 0) - (formData.timeWith || 0);
        const expectedImpl = formData.expectedImplementations || 1;
        let approvalMsg;
        if (formData.bypassApproval) {
          approvalMsg = 'auto-approved (admin bypass)';
        } else if (approval?.autoApproved) {
          approvalMsg = 'Auto-approved';
        } else if (expectedImpl > 1) {
          // Force SPOC review if expectedImplementations > 1 (frequency-based override)
          approvalMsg = `SPOC review (${expectedImpl}× weekly)`;
        } else if (savedHours > 10) {
          approvalMsg = 'SPOC → Admin review';
        } else {
          approvalMsg = 'SPOC review';
        }

        const copyMsg = expectedImpl > 1 ? ` — ${expectedImpl} task copies created` : '';
        showToast(`Task submitted — ${approvalMsg} (${savedHours.toFixed(1)} hrs saved)${copyMsg}`, 'success');

        // Phase D Task 18: kick off background polling of tasks.link_status
        // and surface the result via a floating banner. Fire-and-forget —
        // do NOT await so the caller (modal close + dashboard refresh) is
        // not blocked by the 3s polling cadence.
        // Skip if user manually linked a use case — no auto-linkage needed.
        if (taskId && !formData.manualUseCaseId) {
          try {
            const banner = createLinkageStatusBanner(taskId);
            // intentionally not awaited; polling stops as soon as the user
            // hits the dismiss × on the banner.
            showLinkageStatus(taskId, banner.hostEl, banner.isCancelled);
          } catch (e) {
            console.warn('Linkage status banner failed to mount:', e);
          }
        }

        return { id: taskId, approval };
      } else if (submissionType === 'accomplishment') {
        const result = isAdmin && formData.bypassApproval
          ? await EAS_DB.insertAccomplishment(formData)
          : await EAS_DB.submitAccomplishmentWithApproval(formData);
        
        if (!result) throw new Error('Failed to save accomplishment');
        const accId = result.acc?.id || result.id;
        const approval = result.approval;

        const msg = approval?.autoApproved ? 'Auto-approved' : 'Submitted for review';
        showToast(`Accomplishment ${msg}`, 'success');
        return { id: accId, approval };
      }
    } catch (err) {
      console.error('Submission error:', err);
      showToast('Submission failed: ' + err.message, 'error');
      return null;
    }
  }

  /**
   * Show approval status badge
   */
  function getApprovalStatusBadge(status) {
    const statusMap = {
      'pending': { label: 'Pending', color: '#FFA500', icon: '⏳' },
      'ai_review': { label: 'AI Review (legacy)', color: '#4A90E2', icon: '🤖' },
      'spoc_review': { label: 'SPOC Reviewing', color: '#6C5CE7', icon: '👤' },
      'admin_review': { label: 'Admin Reviewing', color: '#8B5CF6', icon: '👑' },
      'approved': { label: 'Approved', color: '#27AE60', icon: '✅' },
      'rejected': { label: 'Rejected', color: '#E74C3C', icon: '❌' },
    };
    const info = statusMap[status] || statusMap['pending'];
    return `<span style="color:${info.color};font-weight:600">${info.icon} ${info.label}</span>`;
  }

  // ========== PUBLIC API ==========

  const api = {
    // Initialization
    initEmployeeAutocomplete,
    initEmployeeDropdown,
    initSavedHoursCalculation,

    // AI Features
    validateSubmission,

    // Submission & Approval
    submitWithApproval,
    getApprovalStatusBadge,

    // Use-case linkage status (Phase D Task 18)
    showLinkageStatus,
    createLinkageStatusBanner,

    // State accessors
    getCurrentSubmission: () => _currentSubmission,
    setCurrentSubmission: (type) => { 
      _currentSubmission.type = type;
      _currentSubmission.aiValidation = null;
      console.log('Phase8 submission context set to:', type);
    },
  };

  console.log('✅ Phase8 module fully initialized with API:', Object.keys(api));
  return api;
})();

console.log('✅ Phase8 globally available:', typeof Phase8);
