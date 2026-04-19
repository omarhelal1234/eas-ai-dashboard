// ============================================================
// EAS AI Dashboard — Database / Data Layer
// Phase 3: Full Supabase integration (re-fetch per quarter)
// ============================================================

const EAS_DB = (() => {
  const sb = getSupabaseClient();

  // ---- Quarter State ----
  let _quarters = [];
  let _selectedQuarter = null; // 'Q1-2026', 'Q2-2026', etc. or 'all'

  /** Fetch all quarters from Supabase */
  async function loadQuarters() {
    const { data, error } = await sb
      .from('quarters')
      .select('*')
      .order('start_date', { ascending: true });

    if (error) {
      console.error('Failed to load quarters:', error.message);
      return [];
    }
    _quarters = data || [];
    return _quarters;
  }

  function getQuarters() { return _quarters; }

  function getActiveQuarter() {
    return _quarters.find(q => q.is_active) || _quarters[_quarters.length - 1];
  }

  function getSelectedQuarter() {
    if (!_selectedQuarter) {
      const saved = localStorage.getItem('eas_selected_quarter');
      if (saved) {
        _selectedQuarter = saved;
      } else {
        const active = getActiveQuarter();
        _selectedQuarter = active ? active.id : 'all';
      }
    }
    return _selectedQuarter;
  }

  function setSelectedQuarter(quarterId) {
    _selectedQuarter = quarterId;
    localStorage.setItem('eas_selected_quarter', quarterId);
  }

  function getQuarterLabel(quarterId) {
    if (quarterId === 'all') return 'All Time';
    const q = _quarters.find(q => q.id === quarterId);
    return q ? q.label : quarterId;
  }

  // ---- Quarter Selector UI ----

  function populateQuarterSelector(selectId = 'quarter-selector') {
    const select = document.getElementById(selectId);
    if (!select) return;

    select.innerHTML = '';

    const allOpt = document.createElement('option');
    allOpt.value = 'all';
    allOpt.textContent = 'All Time';
    select.appendChild(allOpt);

    _quarters.forEach(q => {
      const opt = document.createElement('option');
      opt.value = q.id;
      opt.textContent = q.label + (q.is_active ? ' (Current)' : '') + (q.is_locked ? ' 🔒' : '');
      select.appendChild(opt);
    });

    select.value = getSelectedQuarter();

    select.addEventListener('change', (e) => {
      setSelectedQuarter(e.target.value);
      window.dispatchEvent(new CustomEvent('quarter-changed', { detail: { quarter: e.target.value } }));
    });
  }

  /**
   * Populate a page-specific quarter selector (no global side-effects).
   * @param {string} selectId — element ID of the <select>
   * @param {function} onChange — callback receiving the selected quarter value
   */
  function populatePageQuarterSelector(selectId, onChange) {
    const select = document.getElementById(selectId);
    if (!select) return;
    select.innerHTML = '';

    const allOpt = document.createElement('option');
    allOpt.value = 'all';
    allOpt.textContent = 'All Time';
    select.appendChild(allOpt);

    _quarters.forEach(q => {
      const opt = document.createElement('option');
      opt.value = q.id;
      opt.textContent = q.label + (q.is_active ? ' (Current)' : '') + (q.is_locked ? ' 🔒' : '');
      select.appendChild(opt);
    });

    // Default to the global selected quarter
    select.value = getSelectedQuarter();

    if (typeof onChange === 'function') {
      select.addEventListener('change', () => onChange(select.value));
    }
  }

  // ---- Quarter Comparison Helpers ----

  function getPreviousQuarter(quarterId) {
    if (!quarterId || quarterId === 'all') return null;
    const idx = _quarters.findIndex(q => q.id === quarterId);
    return idx > 0 ? _quarters[idx - 1].id : null;
  }

  function calcDelta(current, previous) {
    if (!previous || previous === 0) return null;
    return ((current - previous) / previous) * 100;
  }

  function formatDelta(delta) {
    if (delta === null || delta === undefined) return '';
    const sign = delta >= 0 ? '↑' : '↓';
    const color = delta >= 0 ? 'var(--success)' : 'var(--danger)';
    return `<span style="color:${color};font-size:12px;font-weight:600">${sign} ${Math.abs(delta).toFixed(1)}%</span>`;
  }

  // ===========================================================
  // Supabase Data Queries — Full Fetch Layer (Phase 3)
  // ===========================================================

  /**
   * Fetch practice summary (quarter-aware via RPC).
   * If quarterId is 'all' or null, fetches aggregated across all quarters.
   * Returns array of practice objects matching the APP_DATA.summary.practices shape.
   */
  async function fetchPracticeSummary(quarterId) {
    const qid = (!quarterId || quarterId === 'all') ? null : quarterId;
    const { data, error } = await sb.rpc('get_practice_summary', { p_quarter_id: qid });
    if (error) {
      console.error('fetchPracticeSummary error:', error.message);
      return [];
    }
    // Transform snake_case DB → camelCase APP_DATA shape
    return (data || []).map(p => ({
      name:         p.practice,
      head:         p.head,
      spoc:         p.spoc,
      tasks:        Number(p.tasks) || 0,
      timeWithout:  Number(p.time_without) || 0,
      timeWith:     Number(p.time_with) || 0,
      timeSaved:    Number(p.time_saved) || 0,
      efficiency:   Number(p.efficiency_pct) || 0,
      quality:      Number(p.avg_quality) || 0,
      completed:    Number(p.completed) || 0,
      projects:     Number(p.project_count) || 0,
      licensedUsers: Number(p.licensed_users) || 0,
      activeUsers:  Number(p.active_users) || 0
    }));
  }

  /**
   * Fetch tasks from Supabase (quarter-filtered).
   * @param {string} quarterId - quarter filter
   * @param {object} opts - { approvedOnly: true } to only return approved tasks
   * Returns array matching APP_DATA.tasks shape.
   */
  async function fetchTasks(quarterId, opts = {}) {
    let query = sb.from('tasks').select('*').order('week_start', { ascending: false }).limit(1000);
    if (quarterId && quarterId !== 'all') {
      query = query.eq('quarter_id', quarterId);
    }
    // By default, only return approved tasks for counting/display
    if (opts.approvedOnly) {
      query = query.eq('approval_status', 'approved');
    }
    const { data, error } = await query;
    if (error) {
      console.error('fetchTasks error:', error.message);
      return [];
    }
    return (data || []).map(t => ({
      id:          t.id,
      practice:    t.practice,
      week:        t.week_number,
      weekStart:   t.week_start,
      weekEnd:     t.week_end,
      project:     t.project,
      projectCode: t.project_code,
      employee:    t.employee_name,
      employeeEmail: t.employee_email,
      task:        t.task_description,
      taskDetails: t.task_details || '',
      category:    t.category,
      aiTool:      t.ai_tool,
      isLicensedTool: isLicensedTool(t.ai_tool),
      prompt:      t.prompt_used,
      timeWithout: Number(t.time_without_ai) || 0,
      timeWith:    Number(t.time_with_ai) || 0,
      timeSaved:   Number(t.time_saved) || 0,
      efficiency:  Number(t.efficiency) || 0,
      quality:     Number(t.quality_rating) || 0,
      status:      t.status,
      approvalStatus: t.approval_status || 'pending',
      submittedForApproval: t.submission_approved || false,
      notes:       t.notes,
      quarterId:   t.quarter_id
    }));
  }

  /**
   * Fetch accomplishments (quarter-filtered).
   * @param {string} quarterId - quarter filter
   * @param {object} opts - { approvedOnly: true } to only return approved accomplishments
   * Returns array matching APP_DATA.accomplishments shape.
   */
  async function fetchAccomplishments(quarterId, opts = {}) {
    let query = sb.from('accomplishments').select('*').order('date', { ascending: false }).limit(500);
    if (quarterId && quarterId !== 'all') {
      query = query.eq('quarter_id', quarterId);
    }
    if (opts.approvedOnly) {
      query = query.eq('approval_status', 'approved');
    }
    const { data, error } = await query;
    if (error) {
      console.error('fetchAccomplishments error:', error.message);
      return [];
    }
    return (data || []).map(a => ({
      id:            a.id,
      date:          a.date,
      practice:      a.practice,
      project:       a.project,
      projectCode:   a.project_code,
      spoc:          a.spoc,
      employees:     a.employees,
      title:         a.title,
      details:       a.details,
      aiTool:        a.ai_tool,
      category:      a.category,
      before:        a.before_baseline,
      after:         a.after_result,
      impact:        a.quantified_impact,
      businessGains: a.business_gains,
      cost:          a.cost,
      effortSaved:   Number(a.effort_saved) || 0,
      status:        a.status,
      approvalStatus: a.approval_status || 'pending',
      submittedForApproval: a.submission_approved || false,
      evidence:      a.evidence,
      notes:         a.notes,
      quarterId:     a.quarter_id
    }));
  }

  /**
   * Fetch copilot users (NOT quarter-filtered — global license list).
   * Returns array matching APP_DATA.copilotUsers shape.
   */
  async function fetchCopilotUsers() {
    const { data, error } = await sb
      .from('copilot_users')
      .select('*')
      .order('practice', { ascending: true })
      .order('name', { ascending: true })
      .limit(1000);
    if (error) {
      console.error('fetchCopilotUsers error:', error.message);
      return [];
    }
    return (data || []).map(u => ({
      id:            u.id,
      practice:      u.practice,
      name:          u.name,
      email:         u.email,
      skill:         u.role_skill,
      status:        u.status,
      hasLoggedTask: u.has_logged_task,
      lastTaskDate:  u.last_task_date,
      copilotAccessDate: u.copilot_access_date,
      githubCopilotStatus: u.github_copilot_status || 'inactive',
      m365CopilotStatus:   u.m365_copilot_status || 'inactive',
      githubCopilotActivatedAt: u.github_copilot_activated_at,
      m365CopilotActivatedAt:   u.m365_copilot_activated_at
    }));
  }

  /**
   * Fetch projects (NOT quarter-filtered — global project list).
   * Returns array matching APP_DATA.projects shape.
   */
  async function fetchProjects() {
    const { data, error } = await sb
      .from('projects')
      .select('*')
      .order('practice', { ascending: true })
      .order('project_name', { ascending: true });
    if (error) {
      console.error('fetchProjects error:', error.message);
      return [];
    }
    return (data || []).map(p => ({
      id:             p.id,
      practice:       p.practice,
      projectCode:    p.project_code,
      contractNumber: p.contract_number,
      customer:       p.customer,
      contractValue:  Number(p.contract_value) || 0,
      startDate:      p.start_date,
      endDate:        p.end_date,
      projectName:    p.project_name,
      revenueType:    p.revenue_type,
      lineType:       p.line_type,
      projectManager: p.project_manager,
      isActive:       p.is_active
    }));
  }

  /**
   * Fetch AI Innovation approved use cases from the use_cases table.
   * These are reference use cases approved by the AI Innovation committee.
   * Returns array of use case objects.
   */
  async function fetchApprovedUseCases() {
    const { data, error } = await sb
      .from('use_cases')
      .select('*')
      .eq('is_approved_reference', true)
      .eq('is_active', true)
      .order('practice', { ascending: true })
      .order('name', { ascending: true });
    if (error) {
      console.error('fetchApprovedUseCases error:', error.message);
      return [];
    }
    return (data || []).map(uc => ({
      id:                     uc.id,
      assetId:                uc.asset_id,
      name:                   uc.name,
      description:            uc.description,
      practice:               uc.practice,
      sdlcPhase:              uc.sdlc_phase,
      category:               uc.category,
      subcategory:            uc.subcategory,
      aiTools:                uc.ai_tools,
      effortsWithoutAi:       uc.efforts_without_ai,
      effortsWithAi:          uc.efforts_with_ai,
      hoursSavedPerImpl:      uc.hours_saved_per_impl,
      businessBenefits:       uc.business_benefits,
      implementationGuidelines: uc.implementation_guidelines,
      strategicTakeaways:     uc.strategic_takeaways,
      suggestionHowToApply:   uc.suggestion_how_to_apply,
      validationFeedback:     uc.validation_feedback,
      validationDetail:       uc.validation_detail,
      validationNotes:        uc.validation_notes,
      realityDoability:       uc.reality_doability,
      ownerSpoc:              uc.owner_spoc,
      currentStatus:          uc.current_status,
      noOfAdoptions:          uc.no_of_adoptions,
      selectedUseCase:        uc.selected_use_case,
      isApprovedReference:    true
    }));
  }

  // Licensed tools — Ejada-paid, primary adoption targets
  const LICENSED_TOOLS = ['Github Copilot', 'M365 Copilot'];

  /**
   * Check if an AI tool name is a licensed (Ejada-paid) tool.
   * @param {string} toolName
   * @returns {boolean}
   */
  function isLicensedTool(toolName) {
    if (!toolName) return false;
    const lower = toolName.toLowerCase();
    return lower.includes('github copilot') || lower.includes('m365 copilot');
  }

  /**
   * Fetch LOV values (lists of values for dropdowns).
   * Returns object: { taskCategories: [], aiTools: [], licensedTools: [], otherTools: [] }
   */
  async function fetchLovs() {
    const { data, error } = await sb
      .from('lovs')
      .select('*')
      .order('sort_order', { ascending: true });
    if (error) {
      console.error('fetchLovs error:', error.message);
      return { taskCategories: [], aiTools: [], licensedTools: [], otherTools: [] };
    }
    const lovs = { taskCategories: [], aiTools: [], licensedTools: [], otherTools: [] };
    (data || []).forEach(row => {
      if (row.category === 'taskCategory') lovs.taskCategories.push(row.value);
      else if (row.category === 'aiTool') {
        lovs.aiTools.push(row.value);
        if (row.is_licensed || isLicensedTool(row.value)) {
          lovs.licensedTools.push(row.value);
        } else {
          lovs.otherTools.push(row.value);
        }
      }
    });
    return lovs;
  }

  /**
   * Fetch licensed tool adoption summary per practice (quarter-aware via RPC).
   * Returns per-practice breakdown of GitHub Copilot vs M365 Copilot vs other tool usage.
   */
  async function fetchLicensedToolAdoption(quarterId) {
    const qid = (!quarterId || quarterId === 'all') ? null : quarterId;
    const { data, error } = await sb.rpc('get_licensed_tool_adoption', { p_quarter_id: qid });
    if (error) {
      console.error('fetchLicensedToolAdoption error:', error.message);
      return [];
    }
    return (data || []).map(r => ({
      practice:             r.practice,
      licensedUsers:        Number(r.licensed_users) || 0,
      ghCopilotActive:      Number(r.gh_copilot_active) || 0,
      m365CopilotActive:    Number(r.m365_copilot_active) || 0,
      licensedToolTasks:    Number(r.licensed_tool_tasks) || 0,
      otherToolTasks:       Number(r.other_tool_tasks) || 0,
      licensedHoursSaved:   Number(r.licensed_hours_saved) || 0,
      otherHoursSaved:      Number(r.other_hours_saved) || 0,
      ghCopilotTasks:       Number(r.gh_copilot_tasks) || 0,
      m365CopilotTasks:     Number(r.m365_copilot_tasks) || 0,
      ghCopilotHours:       Number(r.gh_copilot_hours) || 0,
      m365CopilotHours:     Number(r.m365_copilot_hours) || 0,
      adoptionRateLicensed: Number(r.adoption_rate_licensed) || 0
    }));
  }

  /**
   * Fetch quarter summary from Supabase view.
   */
  async function fetchQuarterSummary() {
    const { data, error } = await sb.from('quarter_summary').select('*');
    if (error) { console.error('fetchQuarterSummary error:', error.message); return []; }
    return data || [];
  }

  // ===========================================================
  // Unified Data Loader — replaces inline APP_DATA
  // ===========================================================

  /**
   * Fetch all dashboard data for a given quarter.
   * Returns an object matching the legacy APP_DATA shape:
   * {
   *   summary: { practices: [...], totals: {...} },
   *   tasks: [...],
   *   accomplishments: [...],
   *   copilotUsers: [...],
   *   projects: [...],
   *   lovs: { taskCategories: [...], aiTools: [...] }
   * }
   */
  async function fetchAllData(quarterId) {
    // Parallel fetch for speed
    // Tasks and accomplishments include ALL statuses (UI shows approval badges)
    // But practice summary RPC already filters to approved-only server-side
    const [practices, tasks, accomplishments, copilotUsers, projects, lovs, approvedUseCases, licensedToolAdoption] = await Promise.all([
      fetchPracticeSummary(quarterId),
      fetchTasks(quarterId),
      fetchAccomplishments(quarterId),
      fetchCopilotUsers(),
      fetchProjects(),
      fetchLovs(),
      fetchApprovedUseCases(),
      fetchLicensedToolAdoption(quarterId)
    ]);

    // Compute totals from practice summaries
    const totals = practices.reduce((acc, p) => {
      acc.tasks       += p.tasks;
      acc.timeWithout += p.timeWithout;
      acc.timeWith    += p.timeWith;
      acc.timeSaved   += p.timeSaved;
      acc.completed   += p.completed;
      acc.projects    += p.projects;
      return acc;
    }, { tasks: 0, timeWithout: 0, timeWith: 0, timeSaved: 0, completed: 0, projects: 0 });

    // Calculate overall efficiency and quality from totals
    totals.efficiency = totals.timeWithout > 0
      ? (totals.timeSaved / totals.timeWithout * 100)
      : 0;

    // Weighted average quality (by task count)
    const qualitySum = practices.reduce((s, p) => s + (p.quality * p.tasks), 0);
    totals.quality = totals.tasks > 0 ? qualitySum / totals.tasks : 0;

    // Compute licensed tool totals
    const licensedTotals = (licensedToolAdoption || []).reduce((acc, r) => {
      acc.licensedToolTasks  += r.licensedToolTasks;
      acc.otherToolTasks     += r.otherToolTasks;
      acc.licensedHoursSaved += r.licensedHoursSaved;
      acc.otherHoursSaved    += r.otherHoursSaved;
      acc.ghCopilotTasks     += r.ghCopilotTasks;
      acc.m365CopilotTasks   += r.m365CopilotTasks;
      acc.ghCopilotHours     += r.ghCopilotHours;
      acc.m365CopilotHours   += r.m365CopilotHours;
      return acc;
    }, { licensedToolTasks: 0, otherToolTasks: 0, licensedHoursSaved: 0, otherHoursSaved: 0, ghCopilotTasks: 0, m365CopilotTasks: 0, ghCopilotHours: 0, m365CopilotHours: 0 });

    return {
      summary: { practices, totals },
      tasks,
      accomplishments,
      copilotUsers,
      projects,
      lovs,
      approvedUseCases,
      licensedToolAdoption,
      licensedTotals
    };
  }

  // ===========================================================
  // Write Operations — Phase 4: CRUD
  // ===========================================================

  /**
   * Insert a new task into Supabase.
   * Accepts camelCase form data, maps to snake_case DB columns.
   * time_saved & efficiency are GENERATED columns — never sent.
   * @returns {object|null} Inserted row (camelCase) or null on error.
   */
  async function insertTask(taskData) {
    const profile = await EAS_Auth.getUserProfile();
    const quarterId = getSelectedQuarter();
    const payload = {
      practice:        taskData.practice,
      week_number:     taskData.week || null,
      week_start:      taskData.weekStart || null,
      week_end:        taskData.weekEnd || null,
      project:         taskData.project || null,
      project_code:    taskData.projectCode || null,
      employee_name:   taskData.employee || profile?.name || null,
      employee_email:  taskData.employeeEmail || profile?.email || null,
      task_description: taskData.task || null,
      task_details:    taskData.taskDetails || null,
      category:        taskData.category || null,
      ai_tool:         taskData.aiTool || null,
      prompt_used:     taskData.prompt || null,
      time_without_ai: taskData.timeWithout || 0,
      time_with_ai:    taskData.timeWith || 0,
      quality_rating:  taskData.quality || null,
      status:          taskData.status || 'Pending',
      notes:           taskData.notes || null,
      quarter_id:      quarterId !== 'all' ? quarterId : (getActiveQuarter()?.id || null),
      logged_by:       profile?.id || null
    };
    const { data, error } = await sb.from('tasks').insert(payload).select().single();
    if (error) { console.error('insertTask error:', error.message); return null; }
    await logActivity('INSERT', 'tasks', data.id, { task: payload.task_description });
    return data;
  }

  /**
   * Update an existing task.
   * Resets approval_status to 'pending' so the task requires re-approval.
   * @param {string} id — task UUID
   * @param {object} taskData — camelCase fields to update
   */
  async function updateTask(id, taskData) {
    const payload = {};
    if (taskData.practice !== undefined)    payload.practice        = taskData.practice;
    if (taskData.week !== undefined)        payload.week_number     = taskData.week;
    if (taskData.weekStart !== undefined)   payload.week_start      = taskData.weekStart;
    if (taskData.weekEnd !== undefined)     payload.week_end        = taskData.weekEnd;
    if (taskData.project !== undefined)     payload.project         = taskData.project;
    if (taskData.projectCode !== undefined) payload.project_code    = taskData.projectCode;
    if (taskData.employee !== undefined)    payload.employee_name   = taskData.employee;
    if (taskData.employeeEmail !== undefined) payload.employee_email = taskData.employeeEmail;
    if (taskData.task !== undefined)        payload.task_description = taskData.task;
    if (taskData.taskDetails !== undefined) payload.task_details     = taskData.taskDetails;
    if (taskData.category !== undefined)    payload.category        = taskData.category;
    if (taskData.aiTool !== undefined)      payload.ai_tool         = taskData.aiTool;
    if (taskData.prompt !== undefined)      payload.prompt_used     = taskData.prompt;
    if (taskData.timeWithout !== undefined) payload.time_without_ai = taskData.timeWithout;
    if (taskData.timeWith !== undefined)    payload.time_with_ai    = taskData.timeWith;
    if (taskData.quality !== undefined)     payload.quality_rating  = taskData.quality;
    if (taskData.status !== undefined)      payload.status          = taskData.status;
    if (taskData.notes !== undefined)       payload.notes           = taskData.notes;

    // Reset approval status — edits require re-approval
    // Admin bypass: if calling user is admin and explicitly sets approval
    const profile = await EAS_Auth.getUserProfile();
    const isAdmin = profile?.role === 'admin';
    if (!isAdmin) {
      payload.approval_status = 'pending';
      payload.submission_approved = false;
      payload.approved_by = null;
      payload.approved_by_name = null;
    }

    const { data, error } = await sb.from('tasks').update(payload).eq('id', id).select().single();
    if (error) { console.error('updateTask error:', error.message); return null; }
    await logActivity('UPDATE', 'tasks', id, payload);

    // Create new approval workflow for the update (unless admin)
    if (!isAdmin && data) {
      // Delete the old approval record to prevent orphans
      if (data.approval_id) {
        await sb.from('submission_approvals').delete().eq('id', data.approval_id);
      }
      const savedHours = (data.time_without_ai || 0) - (data.time_with_ai || 0);
      const approval = await createSubmissionApproval('task', data.id, savedHours, data.practice);
      if (approval?.autoApproved) {
        // Auto-approved: clear approval_id and mark task as approved directly
        await sb.from('tasks').update({
          approval_id: null,
          approval_status: 'approved'
        }).eq('id', data.id);
        await logActivity('AUTO_APPROVE', 'tasks', data.id, { saved_hours: savedHours, reason: 'edit_less_than_5h' });
      } else if (approval) {
        await sb.from('tasks').update({
          approval_id: approval.id
        }).eq('id', data.id);
      }
    }

    return data;
  }

  /**
   * Delete a task by ID.
   */
  async function deleteTask(id) {
    const { error } = await sb.from('tasks').delete().eq('id', id);
    if (error) { console.error('deleteTask error:', error.message); return false; }
    await logActivity('DELETE', 'tasks', id);
    return true;
  }

  /**
   * Insert a new accomplishment.
   */
  async function insertAccomplishment(accData) {
    const profile = await EAS_Auth.getUserProfile();
    const quarterId = getSelectedQuarter();
    const payload = {
      date:             accData.date || null,
      practice:         accData.practice,
      project:          accData.project || null,
      project_code:     accData.projectCode || null,
      spoc:             accData.spoc || null,
      employees:        accData.employees || null,
      title:            accData.title || null,
      details:          accData.details || null,
      ai_tool:          accData.aiTool || null,
      category:         accData.category || null,
      before_baseline:  accData.before || null,
      after_result:     accData.after || null,
      quantified_impact: accData.impact || null,
      business_gains:   accData.businessGains || null,
      cost:             accData.cost || 'Free of Cost',
      effort_saved:     accData.effortSaved || 0,
      status:           accData.status || 'Completed',
      evidence:         accData.evidence || null,
      notes:            accData.notes || null,
      quarter_id:       quarterId !== 'all' ? quarterId : (getActiveQuarter()?.id || null),
      logged_by:        profile?.id || null
    };
    const { data, error } = await sb.from('accomplishments').insert(payload).select().single();
    if (error) { console.error('insertAccomplishment error:', error.message); return null; }
    await logActivity('INSERT', 'accomplishments', data.id, { title: payload.title });
    return data;
  }

  /**
   * Update an existing accomplishment.
   * Resets approval_status to 'pending' so the accomplishment requires re-approval.
   */
  async function updateAccomplishment(id, accData) {
    const payload = {};
    if (accData.date !== undefined)          payload.date             = accData.date;
    if (accData.practice !== undefined)      payload.practice         = accData.practice;
    if (accData.project !== undefined)       payload.project          = accData.project;
    if (accData.projectCode !== undefined)   payload.project_code     = accData.projectCode;
    if (accData.spoc !== undefined)          payload.spoc             = accData.spoc;
    if (accData.employees !== undefined)     payload.employees        = accData.employees;
    if (accData.title !== undefined)         payload.title            = accData.title;
    if (accData.details !== undefined)       payload.details          = accData.details;
    if (accData.aiTool !== undefined)        payload.ai_tool          = accData.aiTool;
    if (accData.category !== undefined)      payload.category         = accData.category;
    if (accData.before !== undefined)        payload.before_baseline  = accData.before;
    if (accData.after !== undefined)         payload.after_result     = accData.after;
    if (accData.impact !== undefined)        payload.quantified_impact = accData.impact;
    if (accData.businessGains !== undefined) payload.business_gains   = accData.businessGains;
    if (accData.cost !== undefined)          payload.cost             = accData.cost;
    if (accData.effortSaved !== undefined)   payload.effort_saved     = accData.effortSaved;
    if (accData.status !== undefined)        payload.status           = accData.status;
    if (accData.evidence !== undefined)      payload.evidence         = accData.evidence;
    if (accData.notes !== undefined)         payload.notes            = accData.notes;

    // Reset approval status — edits require re-approval
    const profile = await EAS_Auth.getUserProfile();
    const isAdmin = profile?.role === 'admin';
    if (!isAdmin) {
      payload.approval_status = 'pending';
      payload.submission_approved = false;
      payload.approved_by = null;
      payload.approved_by_name = null;
    }

    const { data, error } = await sb.from('accomplishments').update(payload).eq('id', id).select().single();
    if (error) { console.error('updateAccomplishment error:', error.message); return null; }
    await logActivity('UPDATE', 'accomplishments', id, payload);

    // Create new approval workflow for the update (unless admin)
    if (!isAdmin && data) {
      // Delete the old approval record to prevent orphans
      if (data.approval_id) {
        await sb.from('submission_approvals').delete().eq('id', data.approval_id);
      }
      const savedHours = data.effort_saved || 0;
      const approval = await createSubmissionApproval('accomplishment', data.id, savedHours, data.practice);
      if (approval) {
        await sb.from('accomplishments').update({
          approval_id: approval.id
        }).eq('id', data.id);
      }
    }

    return data;
  }

  /**
   * Delete an accomplishment by ID.
   */
  async function deleteAccomplishment(id) {
    const { error } = await sb.from('accomplishments').delete().eq('id', id);
    if (error) { console.error('deleteAccomplishment error:', error.message); return false; }
    await logActivity('DELETE', 'accomplishments', id);
    return true;
  }

  /**
   * Insert a new copilot user.
   */
  async function insertCopilotUser(userData) {
    const payload = {
      practice:    userData.practice,
      name:        userData.name || null,
      email:       userData.email || null,
      role_skill:  userData.skill || null,
      status:      userData.status || 'pending'
    };
    const { data, error } = await sb.from('copilot_users').insert(payload).select().single();
    if (error) { console.error('insertCopilotUser error:', error.message); return null; }
    await logActivity('INSERT', 'copilot_users', data.id, { name: payload.name, email: payload.email });
    return data;
  }

  /**
   * Update an existing copilot user.
   */
  async function updateCopilotUser(id, userData) {
    const payload = {};
    if (userData.practice !== undefined) payload.practice   = userData.practice;
    if (userData.name !== undefined)     payload.name       = userData.name;
    if (userData.email !== undefined)    payload.email      = userData.email;
    if (userData.skill !== undefined)    payload.role_skill = userData.skill;
    if (userData.status !== undefined)   payload.status     = userData.status;

    const { data, error } = await sb.from('copilot_users').update(payload).eq('id', id).select().single();
    if (error) { console.error('updateCopilotUser error:', error.message); return null; }
    await logActivity('UPDATE', 'copilot_users', id, payload);
    return data;
  }

  /**
   * Delete a copilot user by ID.
   */
  async function deleteCopilotUser(id) {
    const { error } = await sb.from('copilot_users').delete().eq('id', id);
    if (error) { console.error('deleteCopilotUser error:', error.message); return false; }
    await logActivity('DELETE', 'copilot_users', id);
    return true;
  }

  // ===========================================================
  // Projects CRUD — Phase 11
  // ===========================================================

  /**
   * Insert a new project into Supabase.
   * @param {object} projData — camelCase fields
   * @returns {object|null} Inserted row or null on error.
   */
  async function insertProject(projData) {
    const profile = await EAS_Auth.getUserProfile();
    const payload = {
      practice:        projData.practice,
      project_name:    projData.projectName || projData.name || '',
      project_code:    projData.projectCode || projData.code || null,
      contract_number: projData.contractNumber || null,
      customer:        projData.customer || null,
      contract_value:  projData.contractValue || projData.value || 0,
      start_date:      projData.startDate || projData.start || null,
      end_date:        projData.endDate || projData.end || null,
      revenue_type:    projData.revenueType || null,
      line_type:       projData.lineType || null,
      project_manager: projData.projectManager || projData.pm || null,
      is_active:       projData.isActive !== undefined ? projData.isActive : true
    };
    const { data, error } = await sb.from('projects').insert(payload).select().single();
    if (error) { console.error('insertProject error:', error.message); return null; }
    await logActivity('INSERT', 'projects', data.id, { project: payload.project_name });
    return data;
  }

  /**
   * Update an existing project.
   * @param {string} id — project UUID
   * @param {object} projData — camelCase fields to update
   */
  async function updateProject(id, projData) {
    const payload = {};
    if (projData.practice !== undefined)       payload.practice        = projData.practice;
    if (projData.projectName !== undefined || projData.name !== undefined)
      payload.project_name = projData.projectName || projData.name;
    if (projData.projectCode !== undefined || projData.code !== undefined)
      payload.project_code = projData.projectCode || projData.code;
    if (projData.contractNumber !== undefined)  payload.contract_number = projData.contractNumber;
    if (projData.customer !== undefined)        payload.customer        = projData.customer;
    if (projData.contractValue !== undefined || projData.value !== undefined)
      payload.contract_value = projData.contractValue || projData.value;
    if (projData.startDate !== undefined || projData.start !== undefined)
      payload.start_date = projData.startDate || projData.start;
    if (projData.endDate !== undefined || projData.end !== undefined)
      payload.end_date = projData.endDate || projData.end;
    if (projData.revenueType !== undefined)     payload.revenue_type    = projData.revenueType;
    if (projData.lineType !== undefined)        payload.line_type       = projData.lineType;
    if (projData.projectManager !== undefined || projData.pm !== undefined)
      payload.project_manager = projData.projectManager || projData.pm;
    if (projData.isActive !== undefined)        payload.is_active       = projData.isActive;

    const { data, error } = await sb.from('projects').update(payload).eq('id', id).select().single();
    if (error) { console.error('updateProject error:', error.message); return null; }
    await logActivity('UPDATE', 'projects', id, payload);
    return data;
  }

  /**
   * Delete a project by ID.
   */
  async function deleteProject(id) {
    const { error } = await sb.from('projects').delete().eq('id', id);
    if (error) { console.error('deleteProject error:', error.message); return false; }
    await logActivity('DELETE', 'projects', id);
    return true;
  }

  // ===========================================================
  // Reported Issues / Blockers — Phase 11
  // ===========================================================

  /**
   * Fetch all reported issues/blockers.
   * @returns {Array} issues in camelCase format
   */
  async function fetchReportedIssues() {
    const { data, error } = await sb
      .from('reported_issues')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) {
      console.error('fetchReportedIssues error:', error.message);
      return [];
    }
    return (data || []).map(i => ({
      id:             i.id,
      title:          i.title,
      description:    i.description,
      severity:       i.severity,
      aiTool:         i.ai_tool,
      practice:       i.practice,
      reportedBy:     i.reported_by,
      reportedByName: i.reported_by_name,
      reportedByEmail:i.reported_by_email,
      status:         i.status,
      resolution:     i.resolution,
      resolvedBy:     i.resolved_by,
      resolvedAt:     i.resolved_at,
      createdAt:      i.created_at,
      updatedAt:      i.updated_at
    }));
  }

  /**
   * Insert a new reported issue / blocker.
   * @param {object} issueData — camelCase fields
   * @returns {object|null} Inserted row or null on error.
   */
  async function insertReportedIssue(issueData) {
    const profile = await EAS_Auth.getUserProfile();
    const payload = {
      title:             issueData.title,
      description:       issueData.description || '',
      severity:          issueData.severity || 'medium',
      ai_tool:           issueData.aiTool || null,
      practice:          issueData.practice || profile?.practice || '',
      reported_by:       profile?.id || null,
      reported_by_name:  profile?.name || '',
      reported_by_email: profile?.email || '',
      status:            'open'
    };
    const { data, error } = await sb.from('reported_issues').insert(payload).select().single();
    if (error) { console.error('insertReportedIssue error:', error.message); return null; }
    await logActivity('INSERT', 'reported_issues', data.id, { title: payload.title });
    return data;
  }

  /**
   * Update an existing reported issue.
   * @param {string} id — issue UUID
   * @param {object} issueData — camelCase fields to update
   */
  async function updateReportedIssue(id, issueData) {
    const payload = {};
    if (issueData.title !== undefined)       payload.title       = issueData.title;
    if (issueData.description !== undefined) payload.description = issueData.description;
    if (issueData.severity !== undefined)    payload.severity    = issueData.severity;
    if (issueData.aiTool !== undefined)      payload.ai_tool     = issueData.aiTool;
    if (issueData.status !== undefined)      payload.status      = issueData.status;
    if (issueData.resolution !== undefined)  payload.resolution  = issueData.resolution;

    // If resolving, track who resolved it
    if (issueData.status === 'resolved' || issueData.status === 'closed') {
      const profile = await EAS_Auth.getUserProfile();
      payload.resolved_by = profile?.id || null;
      payload.resolved_at = new Date().toISOString();
    }

    const { data, error } = await sb.from('reported_issues').update(payload).eq('id', id).select().single();
    if (error) { console.error('updateReportedIssue error:', error.message); return null; }
    await logActivity('UPDATE', 'reported_issues', id, payload);
    return data;
  }

  /**
   * Delete a reported issue by ID.
   */
  async function deleteReportedIssue(id) {
    const { error } = await sb.from('reported_issues').delete().eq('id', id);
    if (error) { console.error('deleteReportedIssue error:', error.message); return false; }
    await logActivity('DELETE', 'reported_issues', id);
    return true;
  }

  // ===========================================================
  // Password Management — Phase 11
  // ===========================================================

  /**
   * Change the current user's password (requires being logged in).
   * Uses Supabase Auth updateUser.
   * @param {string} newPassword — the new password (min 6 chars)
   * @returns {object} — { success: boolean, error?: string }
   */
  async function changePassword(newPassword) {
    const { data, error } = await sb.auth.updateUser({ password: newPassword });
    if (error) {
      console.error('changePassword error:', error.message);
      return { success: false, error: error.message };
    }
    await logActivity('UPDATE', 'auth', null, { action: 'password_changed' });
    return { success: true };
  }

  // ===========================================================
  // Audit Logging — Phase 4
  // ===========================================================

  /**
   * Log an activity to the activity_log table.
   * @param {string} action   — INSERT, UPDATE, DELETE
   * @param {string} entity   — table name (tasks, accomplishments, copilot_users)
   * @param {string} entityId — UUID of the affected row
   * @param {object} details  — optional JSON payload with change data
   */
  async function logActivity(action, entity, entityId, details = {}) {
    try {
      const profile = await EAS_Auth.getUserProfile();
      await sb.from('activity_log').insert({
        action,
        entity_type: entity,
        entity_id:   entityId || null,
        details:     details,
        user_id:     profile?.id || null,
        user_email:  profile?.email || null
      });
    } catch (err) {
      // Logging should never block the main operation
      console.warn('logActivity failed:', err.message);
    }
  }

  /**
   * Create a data dump (snapshot) of specified entities.
   * @param {string} name — descriptive dump name
   * @param {string[]} entityTypes — ['tasks','accomplishments','copilot_users']
   * @returns {object|null} — the created dump record
   */
  async function createDump(name, entityTypes = ['tasks', 'accomplishments', 'copilot_users']) {
    const profile = await EAS_Auth.getUserProfile();
    const dumpData = {};
    const rowCounts = {};

    for (const entity of entityTypes) {
      const { data, error } = await sb.from(entity).select('*').limit(5000);
      if (error) {
        console.error(`createDump: failed to fetch ${entity}:`, error.message);
        dumpData[entity] = [];
        rowCounts[entity] = 0;
      } else {
        dumpData[entity] = data || [];
        rowCounts[entity] = (data || []).length;
      }
    }

    const { data: dump, error } = await sb.from('data_dumps').insert({
      dump_name:    name,
      dump_type:    'manual',
      entity_types: entityTypes,
      data:         dumpData,
      row_counts:   rowCounts,
      created_by:   profile?.id || null,
      notes:        `Created by ${profile?.name || 'unknown'} at ${new Date().toISOString()}`
    }).select().single();

    if (error) { console.error('createDump error:', error.message); return null; }
    await logActivity('DUMP', 'data_dumps', dump.id, { name, entityTypes, rowCounts });
    return dump;
  }

  // ===========================================================
  // Phase 5: Leaderboard, Badges, Nudge Queries
  // ===========================================================

  /**
   * Fetch employee leaderboard ranked by time saved.
   * @param {string|null} practice — filter to one practice, or null for all
   * @param {string|null} quarterId — filter to one quarter, or null for all
   */
  async function fetchEmployeeLeaderboard(practice = null, quarterId = null) {
    const p = practice || null;
    const q = (!quarterId || quarterId === 'all') ? null : quarterId;
    const { data, error } = await sb.rpc('get_employee_leaderboard', {
      p_practice: p,
      p_quarter_id: q
    });
    if (error) { console.error('fetchEmployeeLeaderboard error:', error.message); return []; }
    return (data || []).map(e => ({
      name:          e.employee_name,
      email:         e.employee_email,
      practice:      e.practice,
      tasks:         Number(e.task_count) || 0,
      timeSaved:     Number(e.total_time_saved) || 0,
      timeWithout:   Number(e.total_time_without) || 0,
      efficiency:    Number(e.avg_efficiency) || 0,
      quality:       Number(e.avg_quality) || 0,
      completed:     Number(e.completed_count) || 0,
      firstTask:     e.first_task_date,
      lastTask:      e.last_task_date,
      streakWeeks:   Number(e.streak_weeks) || 0
    }));
  }

  /**
   * Fetch practice leaderboard (cross-practice ranking).
   */
  async function fetchPracticeLeaderboard(quarterId = null) {
    const q = (!quarterId || quarterId === 'all') ? null : quarterId;
    const { data, error } = await sb.rpc('get_practice_leaderboard', {
      p_quarter_id: q
    });
    if (error) { console.error('fetchPracticeLeaderboard error:', error.message); return []; }
    return (data || []).map(p => ({
      practice:           p.practice,
      tasks:              Number(p.task_count) || 0,
      employees:          Number(p.employee_count) || 0,
      timeSaved:          Number(p.total_time_saved) || 0,
      timeWithout:        Number(p.total_time_without) || 0,
      efficiency:         Number(p.avg_efficiency) || 0,
      quality:            Number(p.avg_quality) || 0,
      completed:          Number(p.completed_count) || 0,
      accomplishments:    Number(p.accomplishment_count) || 0,
      copilotUsers:       Number(p.copilot_users) || 0,
      score:              Number(p.score) || 0
    }));
  }

  /**
   * Compute achievement badges for an employee from their stats.
   * Returns array of badge objects { id, icon, title, description, earned }.
   */
  function computeBadges(employee) {
    const badges = [];
    // Combined time saved: tasks + accomplishment effort
    const totalTimeSaved = (employee.timeSaved || 0) + (employee.accomplishmentEffort || 0);
    // First Task
    badges.push({
      id: 'first-task', icon: '🚀', title: 'First Task',
      description: 'Logged your first AI task',
      earned: employee.tasks >= 1
    });
    // Streak Master (3+ weeks)
    badges.push({
      id: 'streak', icon: '🔥', title: 'Streak Master',
      description: 'Logged tasks for 3+ weeks',
      earned: employee.streakWeeks >= 3
    });
    // Time Saver (10+ hours — tasks + accomplishments)
    badges.push({
      id: 'time-saver', icon: '⏱️', title: 'Time Saver',
      description: 'Saved 10+ hours with AI (tasks + accomplishments)',
      earned: totalTimeSaved >= 10
    });
    // Efficiency Pro (80%+)
    badges.push({
      id: 'efficiency-pro', icon: '⚡', title: 'Efficiency Pro',
      description: 'Achieved 80%+ efficiency',
      earned: employee.efficiency >= 80
    });
    // Quality Champion (4.5+ avg)
    badges.push({
      id: 'quality-champion', icon: '🏆', title: 'Quality Champion',
      description: 'Maintained 4.5+ quality rating',
      earned: employee.quality >= 4.5
    });
    // Prolific (20+ tasks)
    badges.push({
      id: 'prolific', icon: '📊', title: 'Prolific',
      description: 'Logged 20+ AI tasks',
      earned: employee.tasks >= 20
    });
    // Centurion (50+ hours saved — tasks + accomplishments)
    badges.push({
      id: 'centurion', icon: '💎', title: 'Centurion',
      description: 'Saved 50+ hours with AI (tasks + accomplishments)',
      earned: totalTimeSaved >= 50
    });
    // Innovator (1+ approved accomplishment)
    badges.push({
      id: 'innovator', icon: '💡', title: 'Innovator',
      description: 'Submitted your first approved accomplishment',
      earned: (employee.accomplishments || 0) >= 1
    });
    // Impact Maker (3+ approved accomplishments)
    badges.push({
      id: 'impact-maker', icon: '🌟', title: 'Impact Maker',
      description: 'Achieved 3+ approved accomplishments',
      earned: (employee.accomplishments || 0) >= 3
    });
    return badges;
  }

  /**
  * Fetch inactive team members (copilot users whose task activity is stale).
   * @param {string} practice — practice to check
   * @param {number} daysSince — inactivity threshold in days (default 14)
   */
  async function fetchInactiveMembers(practice, daysSince = 14) {
    const { data: users, error } = await sb
      .from('copilot_users')
      .select('id, name, email, practice, nudged_at, status, ide_days_active, ide_last_active_date')
      .eq('practice', practice)
      .eq('status', 'access granted')
      .order('name', { ascending: true });
    if (error) { console.error('fetchInactiveMembers error:', error.message); return []; }

    const emails = (users || [])
      .map(u => (u.email || '').trim())
      .filter(email => email.length > 0);

    const lastTaskByEmail = new Map();
    if (emails.length > 0) {
      const pageSize = 1000;
      for (let from = 0; ; from += pageSize) {
        const { data: tasks, error: taskError } = await sb
          .from('tasks')
          .select('employee_email, created_at')
          .eq('practice', practice)
          .in('employee_email', emails)
          .order('created_at', { ascending: false })
          .range(from, from + pageSize - 1);
        if (taskError) {
          console.error('fetchInactiveMembers tasks error:', taskError.message);
          break;
        }
        (tasks || []).forEach(t => {
          const emailKey = (t.employee_email || '').trim().toLowerCase();
          if (!emailKey) return;
          const existing = lastTaskByEmail.get(emailKey);
          if (!existing || new Date(t.created_at) > new Date(existing)) {
            lastTaskByEmail.set(emailKey, t.created_at);
          }
        });
        if (!tasks || tasks.length < pageSize) break;
      }
    }

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysSince);

    return (users || []).filter(u => {
      const emailKey = (u.email || '').trim().toLowerCase();
      const lastTask = emailKey ? lastTaskByEmail.get(emailKey) : null;
      // User is active if they have a recent task
      if (lastTask && new Date(lastTask) >= cutoff) return false;
      // User is active if they have recent IDE activity
      if (u.ide_last_active_date) {
        const ideDate = new Date(u.ide_last_active_date);
        if (ideDate >= cutoff) return false;
      }
      return true;
    }).map(u => {
      const emailKey = (u.email || '').trim().toLowerCase();
      const lastTask = emailKey ? lastTaskByEmail.get(emailKey) : null;
      const ideActive = u.ide_last_active_date ? new Date(u.ide_last_active_date) : null;
      // Last activity = most recent of task or IDE
      const lastActivity = (lastTask && ideActive)
        ? (new Date(lastTask) > ideActive ? lastTask : u.ide_last_active_date)
        : (lastTask || u.ide_last_active_date || null);
      return {
        id:           u.id,
        name:         u.name,
        email:        u.email,
        practice:     u.practice,
        hasLoggedTask: Boolean(lastTask),
        lastTaskDate: lastTask || null,
        lastActivity: lastActivity,
        ideDaysActive: Number(u.ide_days_active) || 0,
        ideLastActive: u.ide_last_active_date || null,
        nudgedAt:     u.nudged_at,
        status:       u.status,
        daysSinceTask: lastTask
          ? Math.floor((Date.now() - new Date(lastTask).getTime()) / 86400000)
          : null,
        daysSinceActivity: lastActivity
          ? Math.floor((Date.now() - new Date(lastActivity).getTime()) / 86400000)
          : null
      };
    });
  }

  /**
   * Mark a copilot user as nudged (update nudged_at timestamp).
   */
  async function nudgeUser(userId) {
    const { data, error } = await sb
      .from('copilot_users')
      .update({ nudged_at: new Date().toISOString() })
      .eq('id', userId)
      .select()
      .single();
    if (error) { console.error('nudgeUser error:', error.message); return null; }
    await logActivity('NUDGE', 'copilot_users', userId, { action: 'nudge_inactive' });
    return data;
  }

  /**
   * Get Copilot users by practice for autocomplete.
   * Returns ALL users regardless of status so every team member
   * can be selected when logging a task.
   */
  async function fetchCopilotUsersByPractice(practice) {
    if (!practice) {
      const { data, error } = await sb
        .from('copilot_users')
        .select('id, name, email, practice, role_skill, status')
        .order('name');
      if (error) { console.error('fetchCopilotUsersByPractice error:', error.message); return []; }
      return data || [];
    }
    const { data, error } = await sb
      .from('copilot_users')
      .select('id, name, email, practice, role_skill, status')
      .eq('practice', practice)
      .order('name');
    if (error) { console.error('fetchCopilotUsersByPractice error:', error.message); return []; }
    return data || [];
  }

  /**
   * Get SPOC for a practice.
   * Returns the first active SPOC (legacy single-SPOC callers).
   */
  async function getSpocForPractice(practice) {
    const spocs = await getSpocsForPractice(practice);
    return spocs.length > 0 ? spocs[0] : null;
  }

  /**
   * Get ALL active SPOCs for a practice (multi-SPOC support).
   * Returns array of { spoc_id, spoc_name, spoc_email }.
   */
  async function getSpocsForPractice(practice) {
    const { data, error } = await sb
      .from('practice_spoc')
      .select('spoc_id, spoc_name, spoc_email')
      .eq('practice', practice)
      .eq('is_active', true)
      .order('spoc_name', { ascending: true });
    if (error) { console.error('getSpocsForPractice error:', error.message); return []; }
    return data || [];
  }

  /**
   * Sync practice_spoc when a user's role changes.
   * - Role set to 'spoc': upsert an active row for user+practice.
   * - Role changed away from 'spoc': deactivate (is_active = false).
   */
  async function syncPracticeSpoc(userId, newRole, practice, userName, userEmail) {
    if (newRole === 'spoc' && practice) {
      // Upsert: insert or reactivate
      const { data: existing } = await sb
        .from('practice_spoc')
        .select('id, is_active')
        .eq('spoc_id', userId)
        .eq('practice', practice)
        .maybeSingle();

      if (existing) {
        if (!existing.is_active) {
          await sb.from('practice_spoc').update({ is_active: true, spoc_name: userName, spoc_email: userEmail }).eq('id', existing.id);
        }
      } else {
        await sb.from('practice_spoc').insert({
          practice,
          spoc_id: userId,
          spoc_name: userName || null,
          spoc_email: userEmail || null,
          is_active: true
        });
      }
      await logActivity('SPOC_ASSIGN', 'practice_spoc', userId, { practice, spoc_name: userName });
    } else if (newRole !== 'spoc') {
      // Deactivate any practice_spoc rows for this user
      const { data: rows } = await sb
        .from('practice_spoc')
        .select('id')
        .eq('spoc_id', userId)
        .eq('is_active', true);
      if (rows && rows.length > 0) {
        await sb.from('practice_spoc').update({ is_active: false }).eq('spoc_id', userId);
        await logActivity('SPOC_REMOVE', 'practice_spoc', userId, { reason: 'role_changed_to_' + newRole });
      }
    }
  }

  /**
   * Determine approval routing based on saved hours.
   * RULES (AI validation removed):
   * - savedHours < 5    → auto-approve (no approval record needed)
   * - 5 ≤ savedHours ≤ 10 → SPOC review only
   * - savedHours > 10   → SPOC review first, then Admin review
   * On any rejection: status becomes 'rejected'
   */
  async function determineApprovalRouting(practice, savedHours, submissionType = 'task') {
    // Auto-approve: tasks with less than 5 hours saved (accomplishments never auto-approve)
    if (submissionType === 'task' && savedHours < 5) {
      return { approvalStatus: 'approved', approvalLayer: null, spocId: null, adminId: null, needsAdminReview: false, autoApproved: true };
    }

    let approvalStatus = 'spoc_review';
    let approvalLayer = 'spoc';
    let spocId = null;
    let adminId = null;
    // Accomplishments always require admin review after SPOC; tasks only if >10h
    let needsAdminReview = submissionType === 'accomplishment' ? true : savedHours > 10;

    // Look up SPOCs for this practice (multi-SPOC support)
    const spocs = await getSpocsForPractice(practice);
    if (spocs.length > 0) {
      // Store the first SPOC id for the approval record (any SPOC can approve)
      spocId = spocs[0].spoc_id;
    } else {
      // No SPOC configured — fall back to admin
      console.warn(`No SPOC found for practice "${practice}", falling back to admin`);
      const { data: adminData } = await sb
        .from('users')
        .select('id')
        .eq('role', 'admin')
        .limit(1)
        .single();
      adminId = adminData?.id || null;
      approvalLayer = 'admin';
      approvalStatus = 'admin_review';
    }

    // Pre-fetch admin ID if high-hours task (will need it after SPOC approves)
    if (needsAdminReview && !adminId) {
      const { data: adminData } = await sb
        .from('users')
        .select('id')
        .eq('role', 'admin')
        .limit(1)
        .single();
      adminId = adminData?.id || null;
    }

    return { approvalStatus, approvalLayer, spocId, adminId, needsAdminReview, autoApproved: false };
  }

  /**
   * Create a submission approval workflow entry with proper routing.
   * AI validation has been removed — routing is purely hours-based.
   */
  async function createSubmissionApproval(submissionType, submissionId, savedHours, practice = null) {
    const profile = await EAS_Auth.getUserProfile();
    
    // Determine routing (hours-based, no AI; accomplishments always need full review)
    const routing = await determineApprovalRouting(practice, savedHours, submissionType);

    // Auto-approved tasks skip the approval record entirely
    if (routing.autoApproved) {
      return { id: null, autoApproved: true, approval_status: 'approved' };
    }
    
    const payload = {
      submission_type: submissionType,
      submission_id: submissionId,
      approval_status: routing.approvalStatus,
      approval_layer: routing.approvalLayer,
      saved_hours: savedHours,
      practice: practice,
      submitted_by: profile?.id,
      submitted_by_email: profile?.email,
      ai_validation_result: null,
      ai_validation_failed: false,
      spoc_id: routing.spocId,
      admin_id: routing.adminId
    };
    
    const { data, error } = await sb.from('submission_approvals').insert(payload).select().single();
    if (error) { 
      console.error('createSubmissionApproval error:', error);
      if (error.message && error.message.includes('submission_approvals')) {
        console.warn('⚠️ Approval workflow tables not found. Please run SQL migration: sql/002_approval_workflow.sql');
      }
      return null; 
    }
    return data;
  }

  /**
   * Fetch submission approval status
   */
  async function fetchSubmissionApproval(submissionId, submissionType) {
    const { data, error } = await sb
      .from('submission_approvals')
      .select('*')
      .eq('submission_id', submissionId)
      .eq('submission_type', submissionType)
      .single();
    if (error && error.code !== 'PGRST116') { console.error('fetchSubmissionApproval error:', error); }
    return data || null;
  }

  /**
   * Update submission approval status
   */
  async function updateSubmissionApproval(approvalId, updates) {
    const payload = {};
    if (updates.approvalStatus !== undefined) payload.approval_status = updates.approvalStatus;
    if (updates.aiValidationResult !== undefined) payload.ai_validation_result = updates.aiValidationResult;
    if (updates.approverName !== undefined) payload.approver_name = updates.approverName;
    if (updates.approvalNotes !== undefined) payload.approval_notes = updates.approvalNotes;
    if (updates.rejectedReason !== undefined) payload.rejection_reason = updates.rejectedReason;

    const { data, error } = await sb.from('submission_approvals').update(payload).eq('id', approvalId).select().single();
    if (error) { console.error('updateSubmissionApproval error:', error.message); return null; }
    return data;
  }

  /**
   * Submit task with approval workflow
   */
  async function submitTaskWithApproval(taskData) {
    // Insert task
    const task = await insertTask(taskData);
    if (!task) return null;

    // Create approval workflow with hours-based routing (no AI validation)
    const savedHours = (taskData.timeWithout || 0) - (taskData.timeWith || 0);
    const practice = taskData.practice;
    
    const approval = await createSubmissionApproval('task', task.id, savedHours, practice);
    
    // Auto-approved: mark task as approved directly, no approval record
    if (approval?.autoApproved) {
      await sb.from('tasks').update({ 
        approval_status: 'approved'
      }).eq('id', task.id);
      await logActivity('AUTO_APPROVE', 'tasks', task.id, { saved_hours: savedHours, reason: 'Less than 5 hours saved' });
      return { task, approval: { autoApproved: true, approval_status: 'approved' } };
    }

    // Normal approval flow: link approval record to task
    if (approval) {
      await sb.from('tasks').update({ 
        approval_id: approval.id
      }).eq('id', task.id);
    }

    return { task, approval };
  }

  /**
   * Submit accomplishment with approval workflow
   */
  async function submitAccomplishmentWithApproval(accData) {
    // Insert accomplishment
    const acc = await insertAccomplishment(accData);
    if (!acc) return null;

    // Create approval workflow with hours-based routing (no AI validation)
    const savedHours = accData.effortSaved || 0;
    const practice = accData.practice;
    
    const approval = await createSubmissionApproval('accomplishment', acc.id, savedHours, practice);

    // Accomplishments always require full review (SPOC → Admin), no auto-approve
    if (approval) {
      await sb.from('accomplishments').update({
        approval_id: approval.id
      }).eq('id', acc.id);
    }

    return { acc, approval };
  }

  /**
   * Fetch pending approvals for admin/SPOC.
   * SPOC matching uses spoc_id first, with practice-based fallback for
   * legacy records where spoc_id was never backfilled.
   */
  async function fetchPendingApprovals(userRole, userPractice, userId) {
    try {
      let query = sb
        .from('submission_approvals')
        .select('*')
        .order('submitted_at', { ascending: false });

      if (userRole === 'admin') {
        // Admin sees items at their layer (admin_review) + all other pending for visibility
        query = query.in('approval_status', ['pending', 'admin_review', 'spoc_review']);
      } else if (userRole === 'spoc') {
        // Any SPOC in a practice can approve any task for that practice.
        // Match by practice rather than individual spoc_id.
        query = query
          .eq('approval_status', 'spoc_review')
          .eq('practice', userPractice);
      } else if (userRole === 'team_lead') {
        // Team Lead sees approvals for their assigned members only
        const memberEmails = await fetchTeamLeadMemberEmails(userId);
        if (memberEmails.length === 0) return [];
        query = query
          .eq('approval_status', 'spoc_review')
          .eq('practice', userPractice)
          .in('submitted_by_email', memberEmails);
      }

      const { data, error } = await query;
      if (error) {
        console.error('fetchPendingApprovals error:', error);
        throw new Error(`Failed to fetch pending approvals: ${error.message}`);
      }
      return data || [];
    } catch (err) {
      console.error('fetchPendingApprovals exception:', err);
      throw err;
    }
  }

  /**
   * Fetch completed approvals (approved/rejected) for dashboard
   */
  async function fetchApprovalHistory(userRole, userPractice, limit = 50) {
    try {
      let query = sb
        .from('submission_approvals')
        .select('*')
        .in('approval_status', ['approved', 'rejected'])
        .order('approved_at', { ascending: false })
        .limit(limit);

      if (userRole === 'spoc') {
        query = query.eq('practice', userPractice);
      } else if (userRole === 'team_lead') {
        query = query.eq('practice', userPractice);
        // Further filter to assigned members client-side after fetch
      }

      const { data, error } = await query;
      if (error) {
        console.error('fetchApprovalHistory error:', error);
        throw new Error(`Failed to fetch approval history: ${error.message}`);
      }

      // For team_lead, filter to only their assigned members
      if (userRole === 'team_lead') {
        const profile = await EAS_Auth.getUserProfile();
        const memberEmails = await fetchTeamLeadMemberEmails(profile?.id);
        return (data || []).filter(a => memberEmails.includes(a.submitted_by_email));
      }

      return data || [];
    } catch (err) {
      console.error('fetchApprovalHistory exception:', err);
      throw err;
    }
  }

  /**
   * Approve a task/accomplishment — implements state machine:
   * AI → SPOC (mandatory) → Admin (if ≥15h) → approved
   * Each approval advances to the next layer, not directly to 'approved'.
   */
  async function approveSubmission(approvalId, approvalNotes = '') {
    const profile = await EAS_Auth.getUserProfile();
    const userRole = profile?.role;

    // Fetch current approval state
    const { data: current, error: fetchErr } = await sb
      .from('submission_approvals')
      .select('*')
      .eq('id', approvalId)
      .single();
    if (fetchErr || !current) {
      console.error('approveSubmission: could not fetch approval', fetchErr);
      return null;
    }

    const currentStatus = current.approval_status;
    const savedHours = current.saved_hours || 0;
    let nextStatus = 'approved';
    let nextLayer = null;

    // State machine: determine next state
    // Tasks:          spoc_review → (admin_review if >10h, else approved) → approved
    // Accomplishments: spoc_review → admin_review (always) → approved
    // Admin override: admin can approve at any stage directly
    const isAccomplishment = current.submission_type === 'accomplishment';

    if (userRole === 'admin') {
      // Admin bypasses normal flow — approve immediately regardless of stage
      nextStatus = 'approved';
      nextLayer = null;
    } else if (currentStatus === 'spoc_review') {
      if (isAccomplishment) {
        // Accomplishments always require admin review after SPOC
        nextStatus = 'admin_review';
        nextLayer = 'admin';
      } else if (savedHours > 10) {
        // Tasks >10h need admin review
        nextStatus = 'admin_review';
        nextLayer = 'admin';
      } else {
        nextStatus = 'approved';
        nextLayer = null;
      }
    } else if (currentStatus === 'admin_review') {
      // Admin reviewed → final approval
      nextStatus = 'approved';
      nextLayer = null;
    } else if (currentStatus === 'ai_review') {
      // Legacy: if somehow still at ai_review, advance to SPOC
      nextStatus = 'spoc_review';
      nextLayer = 'spoc';
    }

    const payload = {
      approval_status: nextStatus,
      approval_layer: nextLayer || current.approval_layer,
    };

    // Track who acted at each layer
    if (currentStatus === 'ai_review') {
      payload.ai_reviewed_at = new Date().toISOString();
      payload.ai_approval_notes = approvalNotes || null;
    } else if (currentStatus === 'spoc_review') {
      payload.spoc_reviewed_by = profile?.id;
      payload.spoc_reviewed_by_name = profile?.name;
      payload.spoc_reviewed_at = new Date().toISOString();
      payload.spoc_approval_notes = approvalNotes || null;
    }

    // Mark final approval metadata
    if (nextStatus === 'approved') {
      payload.approved_by = profile?.id;
      payload.approved_by_name = profile?.name;
      payload.approved_by_email = profile?.email;
      payload.approved_at = new Date().toISOString();
      payload.admin_approval_notes = approvalNotes || null;
      payload.admin_reviewed_at = new Date().toISOString();
    } else if (currentStatus === 'admin_review') {
      payload.approved_by = profile?.id;
      payload.approved_by_name = profile?.name;
      payload.approved_by_email = profile?.email;
      payload.approved_at = new Date().toISOString();
      payload.admin_approval_notes = approvalNotes || null;
      payload.admin_reviewed_at = new Date().toISOString();
    }

    const { data: approval, error } = await sb
      .from('submission_approvals')
      .update(payload)
      .eq('id', approvalId)
      .select()
      .single();
    
    if (error) { console.error('approveSubmission error:', error.message); return null; }

    // Update the actual task/accomplishment status to match (only for final states)
    if (approval) {
      const table = approval.submission_type === 'task' ? 'tasks' : 'accomplishments';
      // tasks/accomplishments only allow: pending, approved, rejected
      const mappedStatus = (nextStatus === 'approved' || nextStatus === 'rejected') ? nextStatus : 'pending';
      const taskUpdate = { approval_status: mappedStatus };
      if (nextStatus === 'approved') {
        taskUpdate.approved_by = profile?.id;
        taskUpdate.approved_by_name = profile?.name;
      }
      await sb.from(table).update(taskUpdate).eq('id', approval.submission_id);

      const actionLabel = nextStatus === 'approved' ? 'APPROVE' : 'ADVANCE';
      await logActivity(actionLabel, `submission_approvals`, approvalId, { 
        submission_type: approval.submission_type,
        submission_id: approval.submission_id,
        saved_hours: approval.saved_hours,
        from_status: currentStatus,
        to_status: nextStatus
      });
    }

    return approval;
  }

  /**
   * Reject a task/accomplishment
   */
  async function rejectSubmission(approvalId, rejectionReason) {
    const profile = await EAS_Auth.getUserProfile();
    const payload = {
      approval_status: 'rejected',
      rejection_reason: rejectionReason || 'No reason provided',
      admin_approved: false,
      admin_reviewed_at: new Date().toISOString()
    };

    const { data: approval, error } = await sb
      .from('submission_approvals')
      .update(payload)
      .eq('id', approvalId)
      .select()
      .single();
    
    if (error) { console.error('rejectSubmission error:', error.message); return null; }

    // Update the actual task/accomplishment
    if (approval) {
      const table = approval.submission_type === 'task' ? 'tasks' : 'accomplishments';
      await sb.from(table).update({
        approval_status: 'rejected'
      }).eq('id', approval.submission_id);

      await logActivity('REJECT', `submission_approvals`, approvalId, { 
        submission_type: approval.submission_type,
        submission_id: approval.submission_id,
        reason: rejectionReason
      });
    }

    return approval;
  }

  /**
   * Fetch employee's task approval status
   */
  async function fetchEmployeeTaskApprovals(employeeEmail) {
    try {
      const { data, error } = await sb
        .from('employee_task_approvals')
        .select('*')
        .eq('employee_email', employeeEmail)
        .order('submitted_at', { ascending: false });

      if (error) {
        console.error('fetchEmployeeTaskApprovals error:', error);
        throw new Error(`Failed to fetch task approvals: ${error.message}`);
      }
      return data || [];
    } catch (err) {
      console.error('fetchEmployeeTaskApprovals exception:', err);
      throw err;
    }
  }

  // ===========================================================
  // Prompt Library (Guide Me)
  // ===========================================================

  /**
   * Fetch all active prompts from the prompt_library table.
   * Returns array of grouped-friendly objects sorted by role + sort_order.
   * Includes author name by looking up created_by (auth UUID) in public.users.
   */
  async function fetchPromptLibrary() {
    const { data, error } = await sb
      .from('prompt_library')
      .select('*')
      .eq('is_active', true)
      .order('role', { ascending: true })
      .order('sort_order', { ascending: true });
    if (error) {
      console.error('fetchPromptLibrary error:', error.message);
      return [];
    }

    // Collect unique auth UUIDs to look up author names
    const authIds = [...new Set((data || []).map(p => p.created_by).filter(Boolean))];
    let authorMap = {};
    if (authIds.length > 0) {
      const { data: users, error: uErr } = await sb
        .from('users')
        .select('auth_id, name')
        .in('auth_id', authIds);
      if (!uErr && users) {
        users.forEach(u => { authorMap[u.auth_id] = u.name; });
      }
    }

    return (data || []).map(p => ({
      id:         p.id,
      role:       p.role,
      roleLabel:  p.role_label,
      category:   p.category,
      text:       p.prompt_text,
      sortOrder:  p.sort_order,
      copyCount:  p.copy_count,
      createdBy:  p.created_by,
      authorName: authorMap[p.created_by] || null
    }));
  }

  /**
   * Increment the copy count for a prompt via the DB RPC.
   * Fire-and-forget — does not block the UI.
   */
  async function incrementPromptCopy(promptId) {
    const { error } = await sb.rpc('increment_prompt_copy', { p_prompt_id: promptId });
    if (error) console.error('incrementPromptCopy error:', error.message);
  }

  /**
   * Add a community-submitted prompt. Any authenticated user can call this.
   * @param {string} role     – role key (pm, sa, ba, dev, dba, admin, dm)
   * @param {string} roleLabel – human-readable role name
   * @param {string} category  – prompt category
   * @param {string} promptText – the prompt content
   * @returns {Object|null} the newly created prompt, or null on error
   */
  async function addCommunityPrompt(role, roleLabel, category, promptText) {
    const { data, error } = await sb.rpc('add_community_prompt', {
      p_role: role,
      p_role_label: roleLabel,
      p_category: category,
      p_prompt_text: promptText
    });
    if (error) {
      console.error('addCommunityPrompt error:', error.message);
      return null;
    }
    return data;
  }

  /**
   * Cast, change, or remove a vote on a prompt.
   * @param {string} promptId  – UUID of the prompt
   * @param {string|null} voteType – 'like', 'dislike', or null to remove vote
   * @returns {Object} { deleted, like_count, dislike_count, user_vote }
   */
  async function votePrompt(promptId, voteType) {
    const { data, error } = await sb.rpc('vote_prompt', {
      p_prompt_id: promptId,
      p_vote_type: voteType
    });
    if (error) {
      console.error('votePrompt error:', error.message);
      return null;
    }
    return data;
  }

  /**
   * Fetch aggregated like/dislike counts for all prompts.
   * @returns {Object} map of promptId → { likeCount, dislikeCount }
   */
  async function fetchPromptVoteCounts() {
    const { data, error } = await sb.rpc('get_prompt_vote_counts');
    if (error) {
      console.error('fetchPromptVoteCounts error:', error.message);
      return {};
    }
    const map = {};
    (data || []).forEach(r => {
      map[r.prompt_id] = {
        likeCount:    r.like_count,
        dislikeCount: r.dislike_count
      };
    });
    return map;
  }

  /**
   * Fetch the current user's votes on all prompts.
   * @returns {Object} map of promptId → voteType ('like' | 'dislike')
   */
  async function fetchMyVotes() {
    const { data, error } = await sb
      .from('prompt_votes')
      .select('prompt_id, vote_type');
    if (error) {
      console.error('fetchMyVotes error:', error.message);
      return {};
    }
    const map = {};
    (data || []).forEach(r => { map[r.prompt_id] = r.vote_type; });
    return map;
  }

  // ===========================================================
  // User Management (Admin)
  // ===========================================================

  /**
   * Fetch all users for admin management.
   */
  async function fetchUsers() {
    const { data, error } = await sb
      .from('users')
      .select('id, auth_id, email, name, role, practice, is_active, last_login, created_at')
      .order('practice', { ascending: true })
      .order('name', { ascending: true });
    if (error) {
      console.error('fetchUsers error:', error.message);
      return [];
    }
    return data || [];
  }

  /**
   * Update a user's role.
   */
  async function updateUserRole(userId, newRole) {
    const { data, error } = await sb
      .from('users')
      .update({ role: newRole })
      .eq('id', userId)
      .select()
      .single();
    if (error) {
      console.error('updateUserRole error:', error.message);
      return null;
    }
    await logActivity('UPDATE', 'users', userId, { field: 'role', newValue: newRole });
    return data;
  }

  /**
   * Update a user's active status.
   */
  async function updateUserStatus(userId, isActive) {
    const { data, error } = await sb
      .from('users')
      .update({ is_active: isActive })
      .eq('id', userId)
      .select()
      .single();
    if (error) {
      console.error('updateUserStatus error:', error.message);
      return null;
    }
    await logActivity('UPDATE', 'users', userId, { field: 'is_active', newValue: isActive });
    return data;
  }

  /**
   * Update a user's profile fields (name, email, practice, role, is_active).
   */
  async function updateUser(userId, updates) {
    const payload = {};
    if (updates.name !== undefined)      payload.name = updates.name;
    if (updates.email !== undefined)     payload.email = updates.email;
    if (updates.practice !== undefined)  payload.practice = updates.practice;
    if (updates.role !== undefined)      payload.role = updates.role;
    if (updates.is_active !== undefined) payload.is_active = updates.is_active;

    const { data, error } = await sb
      .from('users')
      .update(payload)
      .eq('id', userId)
      .select()
      .single();
    if (error) {
      console.error('updateUser error:', error.message);
      return null;
    }
    await logActivity('UPDATE', 'users', userId, payload);
    return data;
  }

  // ===========================================================
  // Role-Based View Permissions (Admin)
  // ===========================================================

  /**
   * Fetch all role_view_permissions rows for the admin grid.
   */
  async function fetchRolePermissions() {
    const { data, error } = await sb
      .from('role_view_permissions')
      .select('*')
      .order('role', { ascending: true })
      .order('view_key', { ascending: true });
    if (error) {
      console.error('fetchRolePermissions error:', error.message);
      return [];
    }
    return data || [];
  }

  /**
   * Update a single permission toggle.
   */
  async function updateRolePermission(role, viewKey, isVisible) {
    const { data, error } = await sb
      .from('role_view_permissions')
      .update({ is_visible: isVisible })
      .eq('role', role)
      .eq('view_key', viewKey)
      .select()
      .single();
    if (error) {
      console.error('updateRolePermission error:', error.message);
      return null;
    }
    await logActivity('UPDATE', 'role_view_permissions', data.id, {
      role, view_key: viewKey, is_visible: isVisible
    });
    return data;
  }

  /**
   * Fetch view permissions for a single role (lightweight).
   * Returns a Map<viewKey, boolean> — used by the dashboard to
   * show/hide nav items based on admin-managed permissions.
   * Falls back to empty map on error (fail-open: all views visible).
   * @param {string} role - One of 'admin', 'spoc', 'contributor', 'viewer'
   * @returns {Promise<Map<string, boolean>>}
   */
  async function fetchMyViewPermissions(role) {
    try {
      const { data, error } = await sb
        .from('role_view_permissions')
        .select('view_key, is_visible')
        .eq('role', role);
      if (error) {
        console.error('fetchMyViewPermissions error:', error.message);
        return new Map();
      }
      const map = new Map();
      (data || []).forEach(row => map.set(row.view_key, row.is_visible));
      return map;
    } catch (err) {
      console.error('fetchMyViewPermissions exception:', err);
      return new Map();
    }
  }

  // ===========================================================
  // Grafana IDE Stats — Practice-scoped for SPOCs
  // ===========================================================

  /**
   * Fetch Grafana IDE usage stats for copilot_users.
   * If practice is provided, filters to that practice only (SPOC view).
   * If practice is null/undefined, returns all users (Admin view).
   * Returns array of objects with user info + ide_* columns.
   */
  async function fetchGrafanaStats(practice) {
    let query = sb
      .from('copilot_users')
      .select('id, name, email, practice, role_skill, status, ide_days_active, ide_total_interactions, ide_code_generations, ide_code_acceptances, ide_agent_days, ide_chat_days, ide_loc_suggested, ide_loc_added, ide_last_active_date, ide_data_period, ide_data_updated_at')
      .order('practice', { ascending: true })
      .order('name', { ascending: true })
      .limit(2000);

    if (practice) {
      query = query.eq('practice', practice);
    }

    const { data, error } = await query;
    if (error) {
      console.error('fetchGrafanaStats error:', error.message);
      return [];
    }
    return (data || []).map(u => ({
      id:                  u.id,
      name:                u.name,
      email:               u.email,
      practice:            u.practice,
      roleSkill:           u.role_skill,
      status:              u.status,
      ideDaysActive:       u.ide_days_active || 0,
      ideTotalInteractions:u.ide_total_interactions || 0,
      ideCodeGenerations:  u.ide_code_generations || 0,
      ideCodeAcceptances:  u.ide_code_acceptances || 0,
      ideAgentDays:        u.ide_agent_days || 0,
      ideChatDays:         u.ide_chat_days || 0,
      ideLocSuggested:     u.ide_loc_suggested || 0,
      ideLocAdded:         u.ide_loc_added || 0,
      ideLastActiveDate:   u.ide_last_active_date,
      ideDataPeriod:       u.ide_data_period,
      ideDataUpdatedAt:    u.ide_data_updated_at
    }));
  }

  // ===========================================================
  // Team Lead Assignments
  // ===========================================================

  /** Cache for team lead member emails */
  let _teamLeadMembersCache = null;
  let _teamLeadMembersCacheTs = 0;
  const TL_CACHE_TTL = 2 * 60 * 1000; // 2 minutes

  /**
   * Fetch emails of members assigned to a specific team lead.
   * @param {string} teamLeadUserId — the team lead's users.id
   * @returns {string[]} array of member emails
   */
  async function fetchTeamLeadMemberEmails(teamLeadUserId) {
    if (!teamLeadUserId) return [];
    // Use cache if fresh
    if (_teamLeadMembersCache && (Date.now() - _teamLeadMembersCacheTs < TL_CACHE_TTL)) {
      return _teamLeadMembersCache;
    }
    const { data, error } = await sb
      .from('team_lead_assignments')
      .select('member_email')
      .eq('team_lead_id', teamLeadUserId);
    if (error) { console.error('fetchTeamLeadMemberEmails error:', error.message); return []; }
    _teamLeadMembersCache = (data || []).map(d => d.member_email);
    _teamLeadMembersCacheTs = Date.now();
    return _teamLeadMembersCache;
  }

  /**
   * Fetch full team lead assignments for a practice (used by SPOC management UI).
   * @param {string} practice — the practice name
   * @returns {Array} assignment records
   */
  async function fetchTeamLeadAssignments(practice) {
    const { data, error } = await sb
      .from('team_lead_assignments')
      .select('id, team_lead_id, member_email, practice, assigned_by, created_at')
      .eq('practice', practice)
      .order('team_lead_id', { ascending: true })
      .order('member_email', { ascending: true });
    if (error) { console.error('fetchTeamLeadAssignments error:', error.message); return []; }
    return data || [];
  }

  /**
   * Assign a member to a team lead.
   * @param {string} teamLeadId — users.id of the team lead
   * @param {string} memberEmail — email of the contributor to assign
   * @param {string} practice — practice name
   * @returns {object|null} the created assignment
   */
  async function assignMemberToTeamLead(teamLeadId, memberEmail, practice) {
    const profile = await EAS_Auth.getUserProfile();
    const { data, error } = await sb
      .from('team_lead_assignments')
      .upsert({
        team_lead_id: teamLeadId,
        member_email: memberEmail,
        practice: practice,
        assigned_by: profile?.id
      }, { onConflict: 'member_email,practice' })
      .select()
      .single();
    if (error) { console.error('assignMemberToTeamLead error:', error.message); return null; }
    _teamLeadMembersCache = null; // invalidate cache
    await logActivity('ASSIGN_TEAM_LEAD_MEMBER', 'team_lead_assignments', data?.id, {
      team_lead_id: teamLeadId, member_email: memberEmail, practice
    });
    return data;
  }

  /**
   * Remove a member from a team lead.
   * @param {string} assignmentId — the assignment row id
   */
  async function removeMemberFromTeamLead(assignmentId) {
    const { error } = await sb
      .from('team_lead_assignments')
      .delete()
      .eq('id', assignmentId);
    if (error) { console.error('removeMemberFromTeamLead error:', error.message); return false; }
    _teamLeadMembersCache = null; // invalidate cache
    await logActivity('REMOVE_TEAM_LEAD_MEMBER', 'team_lead_assignments', assignmentId, {});
    return true;
  }

  /**
   * Remove all member assignments for a team lead (used when demoting).
   * @param {string} teamLeadId — users.id of the team lead
   * @param {string} practice — practice name
   */
  async function removeAllTeamLeadAssignments(teamLeadId, practice) {
    const { error } = await sb
      .from('team_lead_assignments')
      .delete()
      .eq('team_lead_id', teamLeadId)
      .eq('practice', practice);
    if (error) { console.error('removeAllTeamLeadAssignments error:', error.message); return false; }
    _teamLeadMembersCache = null;
    return true;
  }

  // ===========================================================
  // Featured Banner & Likes — Phase 12
  // ===========================================================

  /**
   * Fetch banner candidates from the v_banner_candidates view.
   * @param {string|null} quarterId — filter by quarter or null for all
   * @returns {Array} candidates sorted by pinned, like_count, metric_value
   */
  async function fetchBannerCandidates(quarterId) {
    let query = sb.from('v_banner_candidates').select('*');
    if (quarterId && quarterId !== 'all') {
      // Tasks & accomplishments are quarter-scoped; prompts & use cases have null quarter_id
      query = query.or(`quarter_id.eq.${quarterId},quarter_id.is.null`);
    }
    const { data, error } = await query;
    if (error) { console.error('fetchBannerCandidates error:', error.message); return []; }
    // Sort: pinned first, then by like_count desc, then metric_value desc
    return (data || []).sort((a, b) => {
      if (a.is_pinned && !b.is_pinned) return -1;
      if (!a.is_pinned && b.is_pinned) return 1;
      if (b.like_count !== a.like_count) return b.like_count - a.like_count;
      return (b.metric_value || 0) - (a.metric_value || 0);
    });
  }

  /**
   * Fetch banner config (slots per type).
   * @returns {Object} map of item_type → { slots, is_active }
   */
  async function fetchBannerConfig() {
    const { data, error } = await sb.from('featured_banner_config').select('*');
    if (error) { console.error('fetchBannerConfig error:', error.message); return {}; }
    const map = {};
    (data || []).forEach(r => { map[r.item_type] = { slots: r.slots, is_active: r.is_active, id: r.id }; });
    return map;
  }

  /**
   * Update banner config for a specific item_type.
   */
  async function updateBannerConfig(itemType, updates) {
    const profile = await EAS_Auth.getUserProfile();
    const { error } = await sb.from('featured_banner_config')
      .update({ ...updates, updated_by: profile?.id, updated_at: new Date().toISOString() })
      .eq('item_type', itemType);
    if (error) { console.error('updateBannerConfig error:', error.message); return false; }
    return true;
  }

  /**
   * Fetch all active banner pins.
   */
  async function fetchBannerPins() {
    const { data, error } = await sb.from('featured_banner_pins')
      .select('*, pinned_user:users!featured_banner_pins_pinned_by_fkey(name)')
      .or('expires_at.is.null,expires_at.gte.' + new Date().toISOString().split('T')[0]);
    if (error) { console.error('fetchBannerPins error:', error.message); return []; }
    return data || [];
  }

  /**
   * Pin an item to the banner.
   */
  async function insertBannerPin(itemType, itemId, pinLabel, expiresAt) {
    const profile = await EAS_Auth.getUserProfile();
    const { data, error } = await sb.from('featured_banner_pins').insert({
      item_type: itemType,
      item_id: itemId,
      pin_label: pinLabel || 'Admin Pick',
      pinned_by: profile?.id,
      expires_at: expiresAt || null
    }).select().single();
    if (error) { console.error('insertBannerPin error:', error.message); return null; }
    return data;
  }

  /**
   * Remove a pin from the banner.
   */
  async function deleteBannerPin(pinId) {
    const { error } = await sb.from('featured_banner_pins').delete().eq('id', pinId);
    if (error) { console.error('deleteBannerPin error:', error.message); return false; }
    return true;
  }

  /**
   * Toggle a like on an item (task, accomplishment, use_case).
   * Uses the toggle_like RPC function.
   * @returns {{ liked: boolean, like_count: number } | null}
   */
  async function toggleLike(itemType, itemId) {
    const { data, error } = await sb.rpc('toggle_like', {
      p_item_type: itemType,
      p_item_id: itemId
    });
    if (error) { console.error('toggleLike error:', error.message); return null; }
    return data;
  }

  /**
   * Fetch the current user's likes (all item types).
   * @returns {Object} map of "item_type:item_id" → true
   */
  async function fetchMyLikes() {
    const profile = await EAS_Auth.getUserProfile();
    if (!profile) return {};
    const { data, error } = await sb.from('likes')
      .select('item_type, item_id')
      .eq('user_id', profile.id);
    if (error) { console.error('fetchMyLikes error:', error.message); return {}; }
    const map = {};
    (data || []).forEach(r => { map[`${r.item_type}:${r.item_id}`] = true; });
    return map;
  }

  /**
   * Fetch like counts for a specific item type.
   * @returns {Object} map of item_id → like_count
   */
  async function fetchLikeCounts(itemType) {
    const { data, error } = await sb.from('likes')
      .select('item_id')
      .eq('item_type', itemType);
    if (error) { console.error('fetchLikeCounts error:', error.message); return {}; }
    const map = {};
    (data || []).forEach(r => {
      map[r.item_id] = (map[r.item_id] || 0) + 1;
    });
    return map;
  }

  // ===========================================================
  //  AI News Feed
  // ===========================================================

  async function fetchAiNews({ limit = 20, offset = 0, source = null, topic = null } = {}) {
    let query = sb
      .from('ai_news')
      .select('*', { count: 'exact' })
      .order('published_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (source) query = query.eq('source', source);
    if (topic) query = query.eq('topic', topic);

    const { data, error, count } = await query;
    if (error) {
      console.error('fetchAiNews error:', error.message);
      return { items: [], total: 0 };
    }
    return { items: data || [], total: count || 0 };
  }

  async function getAiNewsLastUpdated() {
    const { data, error } = await sb
      .from('ai_news')
      .select('fetched_at')
      .order('fetched_at', { ascending: false })
      .limit(1)
      .single();

    if (error || !data) return null;
    return data.fetched_at;
  }

  async function triggerAiNewsRefresh() {
    const session = await sb.auth.getSession();
    const token = session?.data?.session?.access_token;
    if (!token) throw new Error('Not authenticated');

    const res = await fetch(`${SUPABASE_URL}/functions/v1/ai-news-aggregator`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || 'Refresh failed');
    }
    return res.json();
  }

  // ===========================================================
  // Public API
  // ===========================================================

  return {
    // Quarter management
    loadQuarters,
    getQuarters,
    getActiveQuarter,
    getSelectedQuarter,
    setSelectedQuarter,
    getQuarterLabel,
    populateQuarterSelector,
    populatePageQuarterSelector,
    getPreviousQuarter,
    calcDelta,
    formatDelta,

    // Data queries (read)
    fetchTasks,
    fetchPracticeSummary,
    fetchQuarterSummary,
    fetchAccomplishments,
    fetchCopilotUsers,
    fetchCopilotUsersByPractice,
    fetchGrafanaStats,
    fetchProjects,
    fetchLovs,
    fetchApprovedUseCases,
    fetchLicensedToolAdoption,
    fetchAllData,

    // Licensed tool helpers
    isLicensedTool,
    LICENSED_TOOLS,

    // Leaderboard & gamification (Phase 5)
    fetchEmployeeLeaderboard,
    fetchPracticeLeaderboard,
    computeBadges,
    fetchInactiveMembers,
    nudgeUser,

    // Data mutations (write)
    insertTask,
    updateTask,
    deleteTask,
    insertAccomplishment,
    updateAccomplishment,
    deleteAccomplishment,
    insertCopilotUser,
    updateCopilotUser,
    deleteCopilotUser,
    submitTaskWithApproval,
    submitAccomplishmentWithApproval,

    // Approval workflow (Phase 8)
    getSpocForPractice,
    getSpocsForPractice,
    syncPracticeSpoc,
    determineApprovalRouting,
    createSubmissionApproval,
    fetchSubmissionApproval,
    updateSubmissionApproval,
    fetchPendingApprovals,
    fetchApprovalHistory,
    approveSubmission,
    rejectSubmission,
    fetchEmployeeTaskApprovals,
    // Audit & dumps
    logActivity,
    createDump,

    // Prompt Library (Guide Me)
    fetchPromptLibrary,
    incrementPromptCopy,
    addCommunityPrompt,
    votePrompt,
    fetchPromptVoteCounts,
    fetchMyVotes,

    // User Management (Admin)
    fetchUsers,
    updateUserRole,
    updateUserStatus,
    updateUser,

    // Role-Based View Permissions (Admin)
    fetchRolePermissions,
    updateRolePermission,

    // View Permissions (Dashboard consumer)
    fetchMyViewPermissions,

    // Projects CRUD (Phase 11)
    insertProject,
    updateProject,
    deleteProject,

    // Reported Issues / Blockers (Phase 11)
    fetchReportedIssues,
    insertReportedIssue,
    updateReportedIssue,
    deleteReportedIssue,

    // Team Lead Assignments
    fetchTeamLeadMemberEmails,
    fetchTeamLeadAssignments,
    assignMemberToTeamLead,
    removeMemberFromTeamLead,
    removeAllTeamLeadAssignments,

    // Password Management (Phase 11)
    changePassword,

    // Featured Banner & Likes
    fetchBannerCandidates,
    fetchBannerConfig,
    updateBannerConfig,
    fetchBannerPins,
    insertBannerPin,
    deleteBannerPin,
    toggleLike,
    fetchMyLikes,
    fetchLikeCounts,

    // AI News Feed
    fetchAiNews,
    getAiNewsLastUpdated,
    triggerAiNewsRefresh
  };
})();
