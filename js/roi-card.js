/**
 * Conservative ROI Card
 * Single-purpose render module. Mounts only when caller has admin/spoc/team_lead role.
 *
 * Headline: Final Hours Saved + Gross Value (SAR)
 * Sub-line: methodology summary (humility transparency)
 * <details>: per-method breakdown so reviewers can see how the number was built
 * Admin-only: per-practice list
 *
 * NOTE: This codebase exposes the DB layer as window.EAS_DB and the auth layer
 * as window.EAS_Auth (no hasRole helper). This module bridges to those globals.
 */
(function (global) {
  'use strict';

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function fmtNumber(n, d) {
    return new Intl.NumberFormat('en-US', { maximumFractionDigits: d, minimumFractionDigits: d }).format(n || 0);
  }
  const SAR = (n) => fmtNumber(Math.round(n || 0), 0) + ' SAR';
  const HRS = (n) => fmtNumber(n || 0, 1) + ' h';

  function template(data, isAdmin) {
    const byPractice = Array.isArray(data.by_practice) ? data.by_practice : [];
    const adminBlock = (isAdmin && byPractice.length)
      ? '<div class="roi-by-practice"><h5>By Practice</h5><ul>' +
        byPractice.map(p =>
          '<li><span>' + escapeHtml(p.practice) + '</span> <strong>' + HRS(p.final_hours) +
          '</strong> &middot; ' + SAR(p.gross_sar) + '</li>'
        ).join('') +
        '</ul></div>'
      : '';

    return (
      '<div class="kpi-card roi-card">' +
        '<div class="kpi-label">ROI (Conservative)</div>' +
        '<div class="roi-headline">' +
          '<div class="roi-stat">' +
            '<div class="roi-stat-value">' + HRS(data.final_hours) + '</div>' +
            '<div class="roi-stat-label">Final Hours Saved</div>' +
          '</div>' +
          '<div class="roi-stat">' +
            '<div class="roi-stat-value">' + SAR(data.gross_sar) + '</div>' +
            '<div class="roi-stat-label">Gross Value</div>' +
          '</div>' +
        '</div>' +
        '<div class="roi-caption">' +
          'Approved + licensed-tool tasks &middot; min of 3 methods &middot; ' +
          escapeHtml(data.coef) + '&times; humility &middot; ' + escapeHtml(data.cap) + 'h/task cap' +
        '</div>' +
        '<details class="roi-detail">' +
          '<summary>How this is calculated</summary>' +
          '<table>' +
            '<tr><td>Method 1 (capped sum)</td><td>' + HRS(data.method1_hours) + '</td></tr>' +
            '<tr><td>Method 2 (raw sum)</td><td>' + HRS(data.method2_hours) + '</td></tr>' +
            '<tr><td>Method 3 (users &times; median)</td><td>' + HRS(data.method3_hours) + '</td></tr>' +
            '<tr><td>MIN of methods</td><td>' + HRS(data.hours_min) + '</td></tr>' +
            '<tr><td>&times; humility (' + escapeHtml(data.coef) + ')</td><td>' + HRS(data.final_hours) + '</td></tr>' +
            '<tr><td>Rate (SAR/hr)</td><td>' + fmtNumber(data.rate_sar_hr, 4) + '</td></tr>' +
          '</table>' +
        '</details>' +
        adminBlock +
      '</div>'
    );
  }

  function getRole() {
    if (global.EAS_Auth && typeof global.EAS_Auth.getUserRole === 'function') {
      try { return global.EAS_Auth.getUserRole(); } catch (_) { /* noop */ }
    }
    return (global.auth && global.auth.user && global.auth.user.role)
        || (global.currentUser && global.currentUser.role)
        || null;
  }

  function callerHasRole(roles) {
    const role = getRole();
    return !!(role && roles.indexOf(role) !== -1);
  }

  function getDb() {
    return global.EAS_DB || global.db || null;
  }

  async function mount(slotSelector) {
    const slot = document.querySelector(slotSelector);
    if (!slot) return;
    if (!callerHasRole(['admin', 'spoc', 'team_lead'])) {
      slot.innerHTML = '';
      return;
    }
    const dbApi = getDb();
    if (!dbApi || typeof dbApi.getConservativeROI !== 'function') {
      slot.innerHTML = '';
      console.warn('[roi-card] EAS_DB.getConservativeROI unavailable');
      return;
    }
    slot.innerHTML = '<div class="kpi-card roi-card roi-loading">Loading ROI&hellip;</div>';
    try {
      const data = await dbApi.getConservativeROI();
      if (!data) { slot.innerHTML = ''; return; }
      const isAdmin = callerHasRole(['admin']);
      slot.innerHTML = template(data, isAdmin);
    } catch (e) {
      slot.innerHTML = '<div class="kpi-card roi-card roi-error">ROI unavailable</div>';
      console.error('[roi-card]', e);
    }
  }

  global.roiCard = { mount: mount };
})(window);
