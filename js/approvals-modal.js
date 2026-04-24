// ============================================================
// EAS AI Dashboard — Pending Approvals Pop-up (approver-facing)
// Mirrors the upcoming-events modal pattern. Shown once per day
// per user when their approval queue is non-empty.
// ============================================================

const ApprovalsModal = (() => {
  const APPROVER_ROLES = ['admin', 'spoc', 'dept_spoc', 'team_lead'];
  let _opened = false;

  function escapeHtml(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }

  function fmtDate(iso) {
    if (!iso) return '';
    try {
      return new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Riyadh',
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: false
      }).format(new Date(iso));
    } catch { return iso; }
  }

  function stageLabel(status) {
    switch (status) {
      case 'spoc_review':  return 'SPOC Review';
      case 'admin_review': return 'Admin Review';
      case 'ai_review':    return 'AI Review';
      case 'pending':      return 'Pending';
      default:             return status || 'Pending';
    }
  }

  function dismissKey(userId) {
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC — good enough for per-day gating)
    return `eas_approvals_popup_dismissed_${userId}_${today}`;
  }

  function isDismissedToday(userId) {
    try { return !!localStorage.getItem(dismissKey(userId)); } catch { return false; }
  }

  function markDismissedToday(userId) {
    try { localStorage.setItem(dismissKey(userId), '1'); } catch {}
  }

  async function fetchQueue() {
    const profile = await EAS_Auth.getUserProfile();
    if (!profile) return { profile: null, items: [] };
    const role = profile.role;
    if (!APPROVER_ROLES.includes(role)) return { profile, items: [] };
    if (typeof EAS_DB === 'undefined' || !EAS_DB.fetchPendingApprovals) return { profile, items: [] };
    try {
      const items = await EAS_DB.fetchPendingApprovals(role, profile.practice, profile.id);
      return { profile, items: items || [] };
    } catch (err) {
      console.warn('ApprovalsModal fetch error:', err?.message || err);
      return { profile, items: [] };
    }
  }

  function rowHtml(a) {
    const type = a.submission_type === 'task' ? '📋 Task' : '🎯 Accomplishment';
    const who = escapeHtml(a.submitted_by_email || 'Unknown');
    const practice = escapeHtml(a.practice || '—');
    const when = escapeHtml(fmtDate(a.submitted_at || a.created_at));
    const stage = escapeHtml(stageLabel(a.approval_status));
    const hours = a.saved_hours ? `${Number(a.saved_hours).toFixed(1)}h saved` : '';
    return `
      <div class="approval-row">
        <div class="approval-row-top">
          <span class="approval-type">${type}</span>
          <span class="approval-stage-pill">${stage}</span>
        </div>
        <div class="approval-row-meta">
          <span>👤 ${who}</span>
          <span>🏷 ${practice}</span>
          ${hours ? `<span>⏱ ${escapeHtml(hours)}</span>` : ''}
          <span>📅 ${when}</span>
        </div>
      </div>
    `;
  }

  function buildModal(profile, items) {
    const MAX_ROWS = 5;
    const shown = items.slice(0, MAX_ROWS);
    const extra = Math.max(0, items.length - MAX_ROWS);
    const approvalsUrl = 'index.html#approvals';

    const wrap = document.createElement('div');
    wrap.className = 'events-modal-backdrop approvals-modal-backdrop';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.innerHTML = `
      <div class="events-modal approvals-modal" role="document">
        <div class="events-modal-header">
          <h2>📝 Pending Approvals <span class="events-badge-pill">${items.length}</span></h2>
          <button class="events-modal-close" aria-label="Close" data-action="close-modal">✕</button>
        </div>
        <div class="events-modal-body">
          <div class="approvals-intro">
            You have <strong>${items.length}</strong> submission${items.length === 1 ? '' : 's'} waiting for your review.
          </div>
          ${shown.map(rowHtml).join('')}
          ${extra > 0 ? `<div class="approvals-more">+ ${extra} more in your queue</div>` : ''}
        </div>
        <div class="events-modal-footer">
          <button class="ev-btn ev-btn-ghost" data-action="dismiss-today">Dismiss for today</button>
          <a class="ev-btn ev-btn-primary" href="${approvalsUrl}" data-action="go-review">Review approvals →</a>
        </div>
      </div>
    `;
    return wrap;
  }

  function attachHandlers(wrap, profile) {
    const close = () => {
      wrap.remove();
      document.removeEventListener('keydown', escHandler);
    };
    const escHandler = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', escHandler);

    wrap.addEventListener('click', (e) => {
      if (e.target === wrap) { close(); return; }
      const action = e.target.dataset && e.target.dataset.action;
      if (!action) return;
      if (action === 'close-modal') { close(); return; }
      if (action === 'dismiss-today') {
        if (profile?.id) markDismissedToday(profile.id);
        close();
        return;
      }
      if (action === 'go-review') {
        // Record dismissal so it doesn't re-open on return
        if (profile?.id) markDismissedToday(profile.id);
        // If we're already on index.html, click the nav-item directly (hash alone
        // doesn't trigger a page switch). Otherwise let the link navigate.
        const onIndex = /\/index\.html(?:$|[?#])/.test(window.location.pathname + window.location.search + window.location.hash)
          || window.location.pathname.endsWith('/index.html')
          || window.location.pathname.endsWith('\\index.html');
        const navItem = document.querySelector('.nav-item[data-page="approvals"]');
        if (onIndex && navItem) {
          e.preventDefault();
          close();
          navItem.click();
          try { history.replaceState(null, '', '#approvals'); } catch {}
          return;
        }
        // Navigating away — close the modal so it doesn't linger if navigation is aborted.
        close();
      }
    });
  }

  async function openForCurrentUser({ auto = false } = {}) {
    if (auto && _opened) return;
    _opened = true;
    const { profile, items } = await fetchQueue();
    if (!profile) return;
    if (!APPROVER_ROLES.includes(profile.role)) return;
    if (items.length === 0) return;
    if (auto && isDismissedToday(profile.id)) return;

    const existing = document.querySelector('.approvals-modal-backdrop');
    if (existing) existing.remove();
    const wrap = buildModal(profile, items);
    document.body.appendChild(wrap);
    attachHandlers(wrap, profile);
  }

  return { openForCurrentUser };
})();
