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

  return {
    fmt,
    fmtPct,
    fmtInt,
    statusBadge,
    showToast,
    sanitize,
    sanitizeObj,
    mapPracticeToShort,
    mapPracticeToLong,
    practiceColors,
    chartColors,
    debounce,
    parseDate
  };
})();
