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

    // On practice change, reload users
    practiceSelect.addEventListener('change', async () => {
      const practice = practiceSelect.value;
      searchInput.value = '';
      searchInput.dataset.selectedUserId = '';
      searchInput.dataset.selectedEmail = '';
      searchInput.dataset.selectedName = '';
      document.getElementById('f-employee-id').value = '';
      document.getElementById('f-employee-email').value = '';
      await loadUsers(practice);
    });

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
      const saved = Math.max(0, without - with_);
      savedDisplay.textContent = saved.toFixed(1) + 'h';
      savedDisplay.className = saved > 0 ? 'success' : '';
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

  // ========== AI VALIDATION ==========

  /**
   * Validate submission against quality rules via AI
   */
  async function validateSubmission(submissionType, savedHours, whyText, whatText, aiTool, category) {
    if (!whyText?.trim() || !whatText?.trim()) {
      showToast('Please fill in all required fields', 'warning');
      return { isValid: false, reason: 'Missing required fields' };
    }

    try {
      showToast('Validating submission with AI...', 'info');
      const response = await fetch(`${API_BASE}/ai-validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ submissionType, savedHours, whyText, whatText, aiTool, category }),
      });

      if (!response.ok) {
        const err = await response.json();
        if (err.fallback) {
          showToast('AI service unavailable, submission will use SPOC approval', 'warning');
          return err.fallback;
        }
        throw new Error(err.error || 'Validation failed');
      }

      const result = await response.json();
      _currentSubmission.aiValidation = result.validation;
      showValidationResult(result.validation);
      return result.validation;
    } catch (err) {
      console.error('Validation error:', err);
      showToast('Validation failed, will proceed to SPOC review', 'warning');
      return { isValid: false, reason: err.message };
    }
  }

  function showValidationResult(validation) {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.style.zIndex = '2000';
    modal.innerHTML = `
      <div class="modal" style="max-width:600px">
        <h3>Validation Result</h3>
        <div style="margin:16px 0">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
            <div style="font-size:24px">${validation.isValid ? '✅' : '⚠️'}</div>
            <div>
              <div style="font-weight:600;font-size:14px">${validation.isValid ? 'Valid' : 'Needs Review'}</div>
              <div style="font-size:12px;color:var(--text-muted)">${validation.reason || ''}</div>
            </div>
          </div>
          
          <div style="background:var(--hover-bg);padding:12px;border-radius:4px;margin:12px 0;font-size:13px">
            <div style="font-weight:600;margin-bottom:8px">Validation Checks:</div>
            ${validation.passedRules?.length ? `
              <div style="color:var(--success);margin-bottom:8px">
                <strong>Passed:</strong> ${validation.passedRules.join(', ')}
              </div>
            ` : ''}
            ${validation.failedRules?.length ? `
              <div style="color:var(--warning)">
                <strong>Review:</strong> ${validation.failedRules.join(', ')}
              </div>
            ` : ''}
          </div>

          ${validation.suggestions?.length ? `
            <div style="margin:12px 0">
              <div style="font-weight:600;margin-bottom:8px">Suggestions:</div>
              <ul style="margin-left:16px;font-size:13px">
                ${validation.suggestions.map(s => `<li>${s}</li>`).join('')}
              </ul>
            </div>
          ` : ''}

          <div style="display:flex;gap:8px;margin-top:16px;font-size:13px">
            <div>Score: <strong>${validation.overallScore || 0}%</strong></div>
          </div>
        </div>
        <div class="modal-actions">
          <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">Close</button>
          ${!validation.isValid ? `<button class="btn btn-primary" onclick="this.closest('.modal-overlay').remove()">Continue Anyway</button>` : ''}
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
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

        // Determine approval routing based on saved_hours
        const savedHours = (formData.timeWithout || 0) - (formData.timeWith || 0);
        const approvalMsg = savedHours >= 15 ? 'SPOC → Admin' : 'SPOC';

        showToast(`Task submitted for ${approvalMsg} review (${savedHours.toFixed(1)} hrs saved)`, 'success');
        return { id: taskId, approval };
      } else if (submissionType === 'accomplishment') {
        const result = isAdmin && formData.bypassApproval
          ? await EAS_DB.insertAccomplishment(formData)
          : await EAS_DB.submitAccomplishmentWithApproval(formData);
        
        if (!result) throw new Error('Failed to save accomplishment');
        const accId = result.acc?.id || result.id;
        const approval = result.approval;

        showToast(`Accomplishment submitted for review`, 'success');
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
      'ai_review': { label: 'AI Reviewing', color: '#4A90E2', icon: '🤖' },
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
