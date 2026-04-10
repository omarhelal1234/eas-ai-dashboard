// ============================================================
// EAS AI Dashboard — Shared Utilities
// Used by: index.html, admin.html
// ============================================================

const EAS_Utils = (() => {

  /** Format number to fixed decimals */
  function fmt(n, d = 1) {
    return n ? Number(n).toFixed(d) : '0';
  }

  /** Format as percentage */
  function fmtPct(n) {
    return n ? (n * 100).toFixed(1) + '%' : '0%';
  }

  /** Format as integer with locale */
  function fmtInt(n) {
    return n ? Math.round(n).toLocaleString() : '0';
  }

  /** Generate a status badge HTML (sanitized) */
  function statusBadge(status) {
    if (!status) return '';
    const s = sanitize(status).toLowerCase().trim();
    let cls = 'status-pending';
    if (s === 'completed') cls = 'status-completed';
    else if (s === 'in progress') cls = 'status-inprogress';
    else if (s === 'testing') cls = 'status-testing';
    return `<span class="status-badge ${cls}">${sanitize(status)}</span>`;
  }

  /** Show a toast notification */
  function showToast(msg, type = 'success') {
    let t = document.getElementById('toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'toast';
      t.className = 'toast';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.className = 'toast toast-' + type + ' show';
    setTimeout(() => t.classList.remove('show'), 3500);
  }

  /**
   * Sanitize a string for safe HTML insertion.
   * Prevents XSS when used with innerHTML.
   */
  function sanitize(str) {
    if (str === null || str === undefined) return '';
    const div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
  }

  /** Sanitize all string values in an object (shallow) */
  function sanitizeObj(obj) {
    const result = {};
    for (const [key, val] of Object.entries(obj)) {
      result[key] = typeof val === 'string' ? sanitize(val) : val;
    }
    return result;
  }

  /**
   * Deep-sanitize the full dashboard dataset from fetchAllData().
   * Escapes all user-controlled strings to prevent XSS via innerHTML.
   */
  function sanitizeDataset(dataset) {
    if (!dataset) return dataset;
    if (dataset.tasks) dataset.tasks = dataset.tasks.map(sanitizeObj);
    if (dataset.accomplishments) dataset.accomplishments = dataset.accomplishments.map(sanitizeObj);
    if (dataset.copilotUsers) dataset.copilotUsers = dataset.copilotUsers.map(sanitizeObj);
    if (dataset.projects) dataset.projects = dataset.projects.map(sanitizeObj);
    if (dataset.summary && dataset.summary.practices) {
      dataset.summary.practices = dataset.summary.practices.map(sanitizeObj);
    }
    if (dataset.lovs) {
      if (dataset.lovs.taskCategories) dataset.lovs.taskCategories = dataset.lovs.taskCategories.map(s => sanitize(s));
      if (dataset.lovs.aiTools) dataset.lovs.aiTools = dataset.lovs.aiTools.map(s => sanitize(s));
    }
    return dataset;
  }

  /**
   * Map practice name aliases to canonical names.
   * data.js uses abbreviations; Supabase uses full names.
   */
  const practiceAliases = {
    'Payments Solutions': 'EPS',
    'ERP Solutions': 'ERP',
    'Financial Services (BFSI)': 'BFSI',
    'Customer Engagement (CES)': 'CES',
    'Enterprise Portfolio & Content (EPCS)': 'EPCS',
  };

  function mapPracticeToShort(name) {
    return practiceAliases[name] || name;
  }

  function mapPracticeToLong(short) {
    const longNames = {
      'BFSI': 'Financial Services (BFSI)',
      'CES': 'Customer Engagement (CES)',
      'ERP': 'ERP Solutions',
      'EPS': 'Payments (EPS)',
      'GRC': 'GRC',
      'EPCS': 'Enterprise Portfolio & Content (EPCS)'
    };
    return longNames[short] || short;
  }

  /** Practice color map */
  const practiceColors = {
    'BFSI': '#3b82f6',
    'CES': '#10b981',
    'ERP': '#f59e0b',
    'EPS': '#8b5cf6',
    'GRC': '#ec4899',
    'EPCS': '#06b6d4'
  };

  /** Chart color palette */
  const chartColors = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316'];

  /**
   * Debounce a function call.
   * @param {Function} fn - Function to debounce
   * @param {number} delay - Delay in ms (default 300)
   */
  function debounce(fn, delay = 300) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), delay);
    };
  }

  /**
   * Parse date from various formats used in data.js
   * Handles: DD/M/YYYY, DD/MM/YYYY, DD-MM-YYYY, YYYY-MM-DD
   * @returns {Date|null}
   */
  function parseDate(dateStr) {
    if (!dateStr) return null;
    const s = String(dateStr).trim();

    // DD/M/YYYY or DD/MM/YYYY
    if (s.includes('/')) {
      const [d, m, y] = s.split('/');
      return new Date(parseInt(y), parseInt(m) - 1, parseInt(d));
    }
    // DD-MM-YYYY
    if (/^\d{1,2}-\d{1,2}-\d{4}$/.test(s)) {
      const [d, m, y] = s.split('-');
      return new Date(parseInt(y), parseInt(m) - 1, parseInt(d));
    }
    // YYYY-MM-DD (possibly with time)
    return new Date(s);
  }

  // ===========================================================
  // Week Calculation Helpers (Sun–Thu work week)
  // ===========================================================

  /**
   * Get the current work week range (Sunday–Thursday).
   * @param {Date} [refDate] — reference date, defaults to today
   * @returns {{ start: string, end: string }} ISO date strings (YYYY-MM-DD)
   */
  function getCurrentWeekRange(refDate) {
    const today = refDate ? new Date(refDate) : new Date();
    const day = today.getDay(); // 0=Sun … 6=Sat
    const sunday = new Date(today);
    sunday.setDate(today.getDate() - day); // go back to Sunday
    const thursday = new Date(sunday);
    thursday.setDate(sunday.getDate() + 4); // Sunday + 4 = Thursday
    return {
      start: sunday.toISOString().split('T')[0],
      end: thursday.toISOString().split('T')[0]
    };
  }

  /**
   * Calculate the quarter-relative week number (1–13).
   * @param {Date|string} date — the date to evaluate
   * @param {Array} quarters — array of quarter objects with start_date, end_date
   * @returns {number} week number (1-based)
   */
  function getQuarterWeekNumber(date, quarters) {
    const d = date instanceof Date ? date : new Date(date);
    if (isNaN(d.getTime())) return 1;
    // Find the quarter this date belongs to
    const q = (quarters || []).find(q => {
      const qs = new Date(q.start_date);
      const qe = new Date(q.end_date);
      qe.setHours(23, 59, 59); // include the end date
      return d >= qs && d <= qe;
    });
    if (!q) return 1; // fallback if date is outside any quarter
    const qStart = new Date(q.start_date);
    const diffDays = Math.floor((d - qStart) / 86400000);
    return Math.min(Math.max(Math.floor(diffDays / 7) + 1, 1), 13);
  }

  return {
    fmt,
    fmtPct,
    fmtInt,
    statusBadge,
    showToast,
    sanitize,
    sanitizeObj,
    sanitizeDataset,
    mapPracticeToShort,
    mapPracticeToLong,
    practiceColors,
    chartColors,
    debounce,
    parseDate,
    getCurrentWeekRange,
    getQuarterWeekNumber
  };
})();
