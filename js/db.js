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
   * Returns array matching APP_DATA.tasks shape.
   */
  async function fetchTasks(quarterId) {
    let query = sb.from('tasks').select('*').order('week_start', { ascending: false }).limit(1000);
    if (quarterId && quarterId !== 'all') {
      query = query.eq('quarter_id', quarterId);
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
      category:    t.category,
      aiTool:      t.ai_tool,
      prompt:      t.prompt_used,
      timeWithout: Number(t.time_without_ai) || 0,
      timeWith:    Number(t.time_with_ai) || 0,
      timeSaved:   Number(t.time_saved) || 0,
      efficiency:  Number(t.efficiency) || 0,
      quality:     Number(t.quality_rating) || 0,
      status:      t.status,
      notes:       t.notes,
      quarterId:   t.quarter_id
    }));
  }

  /**
   * Fetch accomplishments (quarter-filtered).
   * Returns array matching APP_DATA.accomplishments shape.
   */
  async function fetchAccomplishments(quarterId) {
    let query = sb.from('accomplishments').select('*').order('date', { ascending: false }).limit(500);
    if (quarterId && quarterId !== 'all') {
      query = query.eq('quarter_id', quarterId);
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
      remarks:       u.remarks,
      copilotAccessDate: u.copilot_access_date
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
   * Fetch LOV values (lists of values for dropdowns).
   * Returns object: { taskCategories: [], aiTools: [] }
   */
  async function fetchLovs() {
    const { data, error } = await sb
      .from('lovs')
      .select('*')
      .order('sort_order', { ascending: true });
    if (error) {
      console.error('fetchLovs error:', error.message);
      return { taskCategories: [], aiTools: [] };
    }
    const lovs = { taskCategories: [], aiTools: [] };
    (data || []).forEach(row => {
      if (row.category === 'taskCategory') lovs.taskCategories.push(row.value);
      else if (row.category === 'aiTool') lovs.aiTools.push(row.value);
    });
    return lovs;
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
    const [practices, tasks, accomplishments, copilotUsers, projects, lovs] = await Promise.all([
      fetchPracticeSummary(quarterId),
      fetchTasks(quarterId),
      fetchAccomplishments(quarterId),
      fetchCopilotUsers(),
      fetchProjects(),
      fetchLovs()
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

    return {
      summary: { practices, totals },
      tasks,
      accomplishments,
      copilotUsers,
      projects,
      lovs
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
    if (taskData.category !== undefined)    payload.category        = taskData.category;
    if (taskData.aiTool !== undefined)      payload.ai_tool         = taskData.aiTool;
    if (taskData.prompt !== undefined)      payload.prompt_used     = taskData.prompt;
    if (taskData.timeWithout !== undefined) payload.time_without_ai = taskData.timeWithout;
    if (taskData.timeWith !== undefined)    payload.time_with_ai    = taskData.timeWith;
    if (taskData.quality !== undefined)     payload.quality_rating  = taskData.quality;
    if (taskData.status !== undefined)      payload.status          = taskData.status;
    if (taskData.notes !== undefined)       payload.notes           = taskData.notes;

    const { data, error } = await sb.from('tasks').update(payload).eq('id', id).select().single();
    if (error) { console.error('updateTask error:', error.message); return null; }
    await logActivity('UPDATE', 'tasks', id, payload);
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

    const { data, error } = await sb.from('accomplishments').update(payload).eq('id', id).select().single();
    if (error) { console.error('updateAccomplishment error:', error.message); return null; }
    await logActivity('UPDATE', 'accomplishments', id, payload);
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
      status:      userData.status || 'active',
      remarks:     userData.remarks || userData.status || null
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
    if (userData.remarks !== undefined)  payload.remarks    = userData.remarks;

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
    // Time Saver (10+ hours)
    badges.push({
      id: 'time-saver', icon: '⏱️', title: 'Time Saver',
      description: 'Saved 10+ hours with AI',
      earned: employee.timeSaved >= 10
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
    // Centurion (50+ hours saved)
    badges.push({
      id: 'centurion', icon: '💎', title: 'Centurion',
      description: 'Saved 50+ hours with AI',
      earned: employee.timeSaved >= 50
    });
    return badges;
  }

  /**
   * Fetch inactive team members (copilot users who haven't logged tasks recently).
   * @param {string} practice — practice to check
   * @param {number} daysSince — inactivity threshold in days (default 14)
   */
  async function fetchInactiveMembers(practice, daysSince = 14) {
    const { data, error } = await sb
      .from('copilot_users')
      .select('id, name, email, practice, has_logged_task, last_task_date, nudged_at, status')
      .eq('practice', practice)
      .order('last_task_date', { ascending: true, nullsFirst: true });
    if (error) { console.error('fetchInactiveMembers error:', error.message); return []; }
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysSince);
    return (data || []).filter(u => {
      if (!u.has_logged_task) return true; // Never logged
      if (!u.last_task_date) return true;
      return new Date(u.last_task_date) < cutoff;
    }).map(u => ({
      id:           u.id,
      name:         u.name,
      email:        u.email,
      practice:     u.practice,
      hasLoggedTask: u.has_logged_task,
      lastTaskDate: u.last_task_date,
      nudgedAt:     u.nudged_at,
      status:       u.status,
      daysSinceTask: u.last_task_date
        ? Math.floor((Date.now() - new Date(u.last_task_date).getTime()) / 86400000)
        : null
    }));
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
   * Get Copilot users by practice for autocomplete
   */
  async function fetchCopilotUsersByPractice(practice) {
    if (!practice) {
      const { data, error } = await sb
        .from('copilot_users')
        .select('id, name, email, practice, role_skill, status')
        .eq('status', 'access granted')
        .order('name');
      if (error) { console.error('fetchCopilotUsersByPractice error:', error.message); return []; }
      return data || [];
    }
    const { data, error } = await sb
      .from('copilot_users')
      .select('id, name, email, practice, role_skill, status')
      .eq('practice', practice)
      .eq('status', 'access granted')
      .order('name');
    if (error) { console.error('fetchCopilotUsersByPractice error:', error.message); return []; }
    return data || [];
  }

  /**
   * Get SPOC for a practice
   */
  async function getSpocForPractice(practice) {
    const { data, error } = await sb
      .from('practice_spoc')
      .select('spoc_id, spoc_name, spoc_email')
      .eq('practice', practice)
      .eq('is_active', true)
      .single();
    if (error) { console.error('getSpocForPractice error:', error.message); return null; }
    return data;
  }

  /**
   * Determine approval routing based on business rules
   * - If saved_hours >= 15: Always goes to admin (Omar Ibrahim)
   * - If AI validation fails: Goes to SPOC for that practice
   * - Otherwise: AI validation first, then SPOC approval if AI passes
   */
  async function determineApprovalRouting(practice, savedHours, aiValidationFailed) {
    let approvalStatus = 'pending';
    let approvalLayer = 'ai';
    let spocId = null;
    let adminId = null;

    // Always go to admin if saved_hours >= 15
    if (savedHours >= 15) {
      approvalStatus = 'admin_review';
      approvalLayer = 'admin';
      // Get admin user (Omar Ibrahim for now - hardcoded for BFSI admin)
      const { data: adminData } = await sb
        .from('users')
        .select('id')
        .eq('role', 'admin')
        .limit(1)
        .single();
      adminId = adminData?.id || null;
    } 
    // If AI validation failed, go to SPOC
    else if (aiValidationFailed) {
      approvalStatus = 'spoc_review';
      approvalLayer = 'spoc';
      const spocData = await getSpocForPractice(practice);
      if (spocData?.spoc_id) {
        spocId = spocData.spoc_id;
      } else {
        // Fallback to admin if SPOC not found
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
    } 
    // Default: AI review first
    else {
      approvalStatus = 'ai_review';
      approvalLayer = 'ai';
    }

    return { approvalStatus, approvalLayer, spocId, adminId };
  }

  /**
   * Create a submission approval workflow entry with proper routing
   */
  async function createSubmissionApproval(submissionType, submissionId, savedHours, aiValidationResult = null, practice = null, aiValidationFailed = false) {
    const profile = await EAS_Auth.getUserProfile();
    
    // Determine routing
    const routing = await determineApprovalRouting(practice, savedHours, aiValidationFailed);
    
    const payload = {
      submission_type: submissionType,
      submission_id: submissionId,
      approval_status: routing.approvalStatus,
      approval_layer: routing.approvalLayer,
      saved_hours: savedHours,
      practice: practice,
      submitted_by: profile?.id,
      submitted_by_email: profile?.email,
      ai_validation_result: aiValidationResult || null,
      ai_validation_failed: aiValidationFailed,
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
    if (updates.rejectedReason !== undefined) payload.rejected_reason = updates.rejectedReason;

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

    // Create approval workflow with proper routing
    const savedHours = (taskData.timeWithout || 0) - (taskData.timeWith || 0);
    const practice = taskData.practice;
    const aiValidationFailed = taskData.aiValidationFailed || false;
    
    const approval = await createSubmissionApproval('task', task.id, savedHours, null, practice, aiValidationFailed);
    
    // Update task with approval ID and status
    if (approval) {
      await sb.from('tasks').update({ 
        approval_id: approval.id,
        approval_status: approval.approval_status,
        submitted_for_approval: true
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

    // Create approval workflow with proper routing
    const savedHours = accData.effortSaved || 0;
    const practice = accData.practice;
    const aiValidationFailed = accData.aiValidationFailed || false;
    
    const approval = await createSubmissionApproval('accomplishment', acc.id, savedHours, null, practice, aiValidationFailed);
    
    // Update accomplishment with approval ID and status
    if (approval) {
      await sb.from('accomplishments').update({ 
        approval_id: approval.id,
        approval_status: approval.approval_status,
        submitted_for_approval: true
      }).eq('id', acc.id);
    }

    return { acc, approval };
  }

  /**
   * Fetch pending approvals for admin/SPOC
   */
  async function fetchPendingApprovals(userRole, userPractice, userId) {
    let query = sb
      .from('submission_approvals')
      .select('*')
      .order('submitted_at', { ascending: false });

    if (userRole === 'admin') {
      // Admin sees all pending approvals
      query = query.in('approval_status', ['pending', 'admin_review', 'ai_review', 'spoc_review']);
    } else if (userRole === 'spoc') {
      // SPOC sees approvals pending for their practice
      query = query
        .eq('approval_status', 'spoc_review')
        .eq('spoc_id', userId);
    }

    const { data, error } = await query;
    if (error) { console.error('fetchPendingApprovals error:', error.message); return []; }
    return data || [];
  }

  /**
   * Fetch completed approvals (approved/rejected) for dashboard
   */
  async function fetchApprovalHistory(userRole, userPractice, limit = 50) {
    const query = sb
      .from('submission_approvals')
      .select('*')
      .in('approval_status', ['approved', 'rejected'])
      .order('approved_at', { ascending: false })
      .limit(limit);

    if (userRole === 'spoc') {
      query.eq('practice', userPractice);
    }

    const { data, error } = await query;
    if (error) { console.error('fetchApprovalHistory error:', error.message); return []; }
    return data || [];
  }

  /**
   * Approve a task/accomplishment
   */
  async function approveSubmission(approvalId, approvalNotes = '') {
    const profile = await EAS_Auth.getUserProfile();
    const payload = {
      approval_status: 'approved',
      approved_by: profile?.id,
      approved_by_name: profile?.name,
      approved_by_email: profile?.email,
      approved_at: new Date().toISOString(),
      admin_approval_notes: approvalNotes || null,
      admin_reviewed_at: new Date().toISOString()
    };

    const { data: approval, error } = await sb
      .from('submission_approvals')
      .update(payload)
      .eq('id', approvalId)
      .select()
      .single();
    
    if (error) { console.error('approveSubmission error:', error.message); return null; }

    // Update the actual task/accomplishment
    if (approval) {
      const table = approval.submission_type === 'task' ? 'tasks' : 'accomplishments';
      await sb.from(table).update({
        approval_status: 'approved',
        approved_by: profile?.id,
        approved_by_name: profile?.name
      }).eq('id', approval.submission_id);

      await logActivity('APPROVE', `submission_approvals`, approvalId, { 
        submission_type: approval.submission_type,
        submission_id: approval.submission_id,
        saved_hours: approval.saved_hours
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
    const { data, error } = await sb
      .from('employee_task_approvals')
      .select('*')
      .eq('employee_email', employeeEmail)
      .order('submitted_at', { ascending: false });
    
    if (error) { console.error('fetchEmployeeTaskApprovals error:', error.message); return []; }
    return data || [];
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
    fetchProjects,
    fetchLovs,
    fetchAllData,

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
    createDump
  };
})();
