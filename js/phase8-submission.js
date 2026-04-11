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
    fieldType: null, // 'why' or 'what'
    currentText: null,
    suggestions: [],
    aiValidation: null,
    selectedSuggestion: null,
  };

  // ========== EMPLOYEE AUTOCOMPLETE ==========
  
  /**
   * Initialize employee autocomplete in a text input
   * @param {string} inputId - ID of employee input field
   * @param {string} practiceId - ID of practice select field
   */
  async function initEmployeeAutocomplete(inputId, practiceId) {
    const input = document.getElementById(inputId);
    const practiceSelect = document.getElementById(practiceId);
    if (!input || !practiceSelect) return;

    let currentList = [];

    // On practice change, update employee list
    practiceSelect.addEventListener('change', async () => {
      const practice = practiceSelect.value;
      currentList = practice ? await EAS_DB.fetchCopilotUsersByPractice(practice) : [];
    });

    // On input, show autocomplete dropdown
    input.addEventListener('input', async (e) => {
      const practice = practiceSelect.value;
      const searchTerm = e.target.value.toLowerCase();

      if (!searchTerm) {
        hideAutocompleteSuggestions(inputId);
        return;
      }

      if (!currentList.length && practice) {
        currentList = await EAS_DB.fetchCopilotUsersByPractice(practice);
      }

      const filtered = currentList.filter(u => 
        u.name.toLowerCase().includes(searchTerm) || 
        u.email.toLowerCase().includes(searchTerm)
      );

      showAutocompleteSuggestions(inputId, filtered, (user) => {
        input.value = user.name;
        input.dataset.selectedUserId = user.id;
        input.dataset.selectedEmail = user.email;
        hideAutocompleteSuggestions(inputId);
      });
    });

    // Handle manual entry (not in Copilot users)
    input.addEventListener('blur', () => {
      setTimeout(() => {
        if (!input.dataset.selectedUserId && input.value.trim()) {
          // User manually typed a name not in Copilot users
          // Show prompt to add user
          showToast('Employee not found in Copilot users. Click "Add New Employee" to register.', 'info');
        }
      }, 200);
    });
  }

  function showAutocompleteSuggestions(inputId, users, onSelect) {
    // Remove existing dropdown
    const existing = document.getElementById(inputId + '-dropdown');
    if (existing) existing.remove();

    if (!users.length) return;

    const container = document.getElementById(inputId).parentElement;
    const dropdown = document.createElement('div');
    dropdown.id = inputId + '-dropdown';
    dropdown.style.cssText = `
      position: absolute; top: 100%; left: 0; right: 0; 
      background: var(--surface); border: 1px solid var(--border); 
      border-radius: 4px; max-height: 200px; overflow-y: auto; 
      z-index: 1000; margin-top: -2px;
    `;

    users.slice(0, 10).forEach(user => {
      const item = document.createElement('div');
      item.style.cssText = `
        padding: 8px 12px; cursor: pointer; border-bottom: 1px solid var(--border);
        hover: background: var(--hover-bg);
      `;
      item.innerHTML = `<div style="font-weight:500">${user.name}</div><div style="font-size:12px;color:var(--text-muted)">${user.email}</div>`;
      item.onclick = () => onSelect(user);
      dropdown.appendChild(item);
    });

    container.style.position = 'relative';
    container.appendChild(dropdown);
  }

  function hideAutocompleteSuggestions(inputId) {
    const dropdown = document.getElementById(inputId + '-dropdown');
    if (dropdown) dropdown.remove();
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

  // ========== AI SUGGESTIONS ==========

  /**
   * Generate AI suggestions for a field (why OR what)
   * @param {string} fieldType - 'why' or 'what'
   * @param {string} currentText - current field value
   * @param {object} context - optional context {category, aiTool, practice}
   */
  async function getAISuggestions(fieldType, currentText, context = {}) {
    if (!currentText.trim()) {
      showToast('Please enter some text first', 'warning');
      return [];
    }

    try {
      showToast('Generating AI suggestions...', 'info');
      console.log('Calling:', `${API_BASE}/ai-suggestions`, { fieldType, currentText });
      
      const response = await fetch(`${API_BASE}/ai-suggestions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fieldType, currentText, context }),
      });

      console.log('Response status:', response.status, response.statusText);

      if (!response.ok) {
        const text = await response.text();
        console.error('Error response:', text);
        try {
          const err = JSON.parse(text);
          throw new Error(err.error || `HTTP ${response.status}`);
        } catch (e) {
          throw new Error(`HTTP ${response.status}: ${text}`);
        }
      }

      const result = await response.json();
      console.log('Suggestions received:', result);
      
      _currentSubmission.fieldType = fieldType;
      _currentSubmission.currentText = currentText;
      _currentSubmission.suggestions = result.suggestions || [];

      showSuggestionsDropdown(_currentSubmission.suggestions, fieldType);
      showToast('💡 ' + result.suggestions.length + ' suggestions ready - click one to apply', 'success');
      return result.suggestions;
    } catch (err) {
      console.error('AI suggestions error:', err);
      showToast('AI suggestions error: ' + (err.message || 'Network error - check console'), 'error');
      return [];
    }
  }

  function showSuggestionsDropdown(suggestions, fieldType) {
    console.log('showSuggestionsDropdown called:', { suggestions: suggestions.length, fieldType, submissionType: _currentSubmission.type });
    
    // Remove any existing suggestions dropdown
    const existing = document.getElementById('ai-suggestions-dropdown');
    if (existing) existing.remove();

    // Find the input field that was being edited
    let inputElement = null;
    if (_currentSubmission.type === 'task') {
      inputElement = fieldType === 'why' 
        ? document.getElementById('f-task-why')  // Correct ID for "Why is this important" field
        : document.getElementById('f-task');
    } else if (_currentSubmission.type === 'accomplishment') {
      inputElement = fieldType === 'why' 
        ? document.getElementById('fa-impact')   // Use impact for accomplishment
        : document.getElementById('fa-title');
    }

    console.log('Input element found:', inputElement ? inputElement.id : 'NOT FOUND');
    if (!inputElement) {
      console.error('Could not find input element for field type:', fieldType, 'in type:', _currentSubmission.type);
      return;
    }

    // Create dropdown container
    const dropdown = document.createElement('div');
    dropdown.id = 'ai-suggestions-dropdown';
    
    // Get the parent form for positioning context
    let parentContainer = inputElement.closest('.form-group') || inputElement.parentElement;
    if (!parentContainer) {
      console.error('Could not find parent container for positioning');
      return;
    }
    
    // Set parent position for absolute child positioning
    if (getComputedStyle(parentContainer).position === 'static') {
      parentContainer.style.position = 'relative';
    }
    
    dropdown.style.cssText = `
      position: absolute;
      bottom: -270px;
      left: 0;
      right: 0;
      background: var(--surface);
      border: 2px solid var(--primary);
      border-radius: 6px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      z-index: 1001;
      max-height: 300px;
      overflow-y: auto;
      backdrop-filter: blur(10px);
    `;

    // Add header
    const header = document.createElement('div');
    header.style.cssText = `
      padding: 10px 12px;
      background: linear-gradient(135deg, var(--primary), var(--info));
      color: white;
      font-weight: 600;
      font-size: 12px;
      border-bottom: 1px solid var(--border);
    `;
    header.textContent = '✨ AI Suggestions - Click to apply';
    dropdown.appendChild(header);

    // Add suggestion items
    suggestions.forEach((suggestion, index) => {
      const item = document.createElement('div');
      item.style.cssText = `
        padding: 12px;
        border-bottom: 1px solid var(--border);
        cursor: pointer;
        transition: background 0.2s;
        font-size: 13px;
        line-height: 1.4;
      `;
      item.innerHTML = `
        <div style="display: flex; gap: 8px">
          <span style="color: var(--primary); font-weight: 600; min-width: 20px">${index + 1}.</span>
          <span>${suggestion}</span>
        </div>
      `;
      
      item.onmouseover = () => {
        item.style.background = 'var(--hover-bg)';
      };
      item.onmouseout = () => {
        item.style.background = 'transparent';
      };
      
      item.onclick = () => {
        inputElement.value = suggestion;
        inputElement.focus();
        dropdown.remove();
        showToast('✅ Suggestion applied!', 'success');
        // Trigger change event for dependents
        inputElement.dispatchEvent(new Event('change', { bubbles: true }));
        inputElement.dispatchEvent(new Event('input', { bubbles: true }));
      };
      
      dropdown.appendChild(item);
    });

    // Add dismiss button
    const footer = document.createElement('div');
    footer.style.cssText = `
      padding: 8px 12px;
      text-align: center;
      border-top: 1px solid var(--border);
      background: var(--hover-bg);
    `;
    const dismissBtn = document.createElement('button');
    dismissBtn.textContent = '✕ Dismiss';
    dismissBtn.style.cssText = `
      background: transparent;
      border: none;
      color: var(--text);
      cursor: pointer;
      font-size: 12px;
      padding: 4px 8px;
    `;
    dismissBtn.onclick = () => dropdown.remove();
    footer.appendChild(dismissBtn);
    dropdown.appendChild(footer);

    // Append to parent form group (not document.body)
    parentContainer.appendChild(dropdown);
    console.log('Suggestions dropdown appended to:', parentContainer.querySelector('label')?.textContent || 'unknown');
    setTimeout(() => {
      document.addEventListener('click', function closeDropdown(e) {
        if (!dropdown.contains(e.target) && e.target !== inputElement) {
          dropdown.remove();
          document.removeEventListener('click', closeDropdown);
        }
      });
    }, 100);
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
        const approvalLayer = savedHours >= 15 ? 'admin' : 'ai';

        showToast(`Task submitted for ${approvalLayer} review (${savedHours.toFixed(1)} hrs saved)`, 'success');
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
    initSavedHoursCalculation,

    // AI Features
    getAISuggestions,
    validateSubmission,

    // Submission & Approval
    submitWithApproval,
    getApprovalStatusBadge,

    // State accessors
    getCurrentSubmission: () => _currentSubmission,
    setCurrentSubmission: (type) => { 
      _currentSubmission.type = type;
      _currentSubmission.fieldType = null;
      _currentSubmission.currentText = null;
      _currentSubmission.suggestions = [];
      console.log('Phase8 submission context set to:', type);
    },
  };

  console.log('✅ Phase8 module fully initialized with API:', Object.keys(api));
  return api;
})();

console.log('✅ Phase8 globally available:', typeof Phase8);
