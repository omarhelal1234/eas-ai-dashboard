// ============================================================
// EAS Admin — Task ↔ Use-Case Linkage Queue (Phase D / Task 19)
// Surfaces tasks the auto-linker flagged for human review:
//   - review            → low-confidence suggestion, awaiting SPOC sign-off
//   - no_match          → auto-linker found nothing, allow manual link
//   - failed_permanent  → linker gave up after retries
//
// Per-row actions (all hit set_task_use_case_link RPC via EAS_DB):
//   Approve  → confirm the suggested linked_use_case_id as spoc_override
//   Change…  → prompt for a different use_case_id (UUID)
//   No match → set use_case_id = NULL, locking the row out of further auto-linking
//
// Uses the admin SPA pattern: nav-item[data-page="manage-link-queue"] activates
// page-manage-link-queue and renderCurrentPage('manage-link-queue') calls render.
// ============================================================

(function () {
  'use strict';

  const STATUSES = ['review', 'no_match', 'failed_permanent'];
  const LABELS = {
    review: 'Review',
    no_match: 'No match',
    failed_permanent: 'Failed'
  };

  const state = { tab: 'review', items: [], loading: false };

  function escapeHtml(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function toast(msg, type) {
    if (window.EAS_Utils && typeof window.EAS_Utils.showToast === 'function') {
      window.EAS_Utils.showToast(msg, type || 'success');
    } else {
      console.log('[link-queue]', msg);
    }
  }

  function db() {
    return (typeof EAS_DB !== 'undefined') ? EAS_DB : window.EAS_DB;
  }

  async function load() {
    const root = document.getElementById('admin-link-queue-root');
    if (!root) return;
    state.loading = true;
    renderShell();
    try {
      const items = await db().fetchUnlinkedQueue({ status: state.tab, limit: 100 });
      state.items = Array.isArray(items) ? items : [];
    } catch (err) {
      console.error('[link-queue] fetchUnlinkedQueue failed:', err);
      state.items = [];
      toast('Failed to load queue: ' + (err?.message || err), 'error');
    } finally {
      state.loading = false;
      renderShell();
    }
  }

  function renderShell() {
    const root = document.getElementById('admin-link-queue-root');
    if (!root) return;

    const tabsHtml = STATUSES.map(t => {
      const isActive = t === state.tab;
      const count = isActive ? (state.loading ? '…' : state.items.length) : '';
      return `<button type="button" class="alq-tab ${isActive ? 'active' : ''}" data-tab="${t}"
        style="padding:8px 16px;border:1px solid var(--border,#334155);background:${isActive ? 'var(--accent,#3b82f6)' : 'transparent'};color:${isActive ? '#fff' : 'var(--text-primary,#f1f5f9)'};cursor:pointer;border-radius:6px 6px 0 0;font-size:13px;font-weight:500;">
        ${escapeHtml(LABELS[t])}${count !== '' ? ' (' + count + ')' : ''}
      </button>`;
    }).join('');

    let body;
    if (state.loading) {
      body = `<div style="padding:24px;color:var(--text-muted,#64748b);">Loading…</div>`;
    } else if (!state.items.length) {
      body = `<div style="padding:24px;color:var(--text-muted,#64748b);">No tasks in <b>${escapeHtml(LABELS[state.tab])}</b>. 🎉</div>`;
    } else {
      body = `
        <div style="overflow-x:auto;background:var(--bg-card,#1e293b);border:1px solid var(--border,#334155);border-radius:0 8px 8px 8px;">
          <table style="width:100%;border-collapse:collapse;font-size:13px;">
            <thead style="background:var(--bg-card-hover,#334155);">
              <tr>
                <th style="padding:10px 12px;text-align:left;text-transform:uppercase;font-size:11px;letter-spacing:0.5px;color:var(--text-muted,#94a3b8);">Task</th>
                <th style="padding:10px 12px;text-align:left;text-transform:uppercase;font-size:11px;letter-spacing:0.5px;color:var(--text-muted,#94a3b8);">Tool</th>
                <th style="padding:10px 12px;text-align:left;text-transform:uppercase;font-size:11px;letter-spacing:0.5px;color:var(--text-muted,#94a3b8);">Suggested use case</th>
                <th style="padding:10px 12px;text-align:left;text-transform:uppercase;font-size:11px;letter-spacing:0.5px;color:var(--text-muted,#94a3b8);">Confidence</th>
                <th style="padding:10px 12px;text-align:right;text-transform:uppercase;font-size:11px;letter-spacing:0.5px;color:var(--text-muted,#94a3b8);">Actions</th>
              </tr>
            </thead>
            <tbody>
              ${state.items.map(rowHtml).join('')}
            </tbody>
          </table>
        </div>`;
    }

    root.innerHTML = `
      <div class="alq-tabs" style="display:flex;gap:4px;margin-bottom:-1px;">${tabsHtml}</div>
      ${body}
    `;

    root.querySelectorAll('.alq-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        const t = btn.dataset.tab;
        if (t && t !== state.tab) {
          state.tab = t;
          load();
        }
      });
    });

    root.querySelectorAll('[data-act]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const tr = e.currentTarget.closest('tr[data-id]');
        if (!tr) return;
        handleAction(tr.dataset.id, e.currentTarget.dataset.act, e.currentTarget);
      });
    });
  }

  function rowHtml(r) {
    const uc = r.use_cases || null;
    const ucLabel = uc
      ? `${escapeHtml(uc.name || '')}${uc.asset_id ? ' <code style="color:var(--text-muted,#94a3b8);font-size:11px;">' + escapeHtml(uc.asset_id) + '</code>' : ''}`
      : '<span style="color:var(--text-muted,#64748b);">—</span>';
    const confPct = (typeof r.link_confidence === 'number')
      ? (r.link_confidence * 100).toFixed(0) + '%'
      : '—';
    const desc = r.task_description || '';
    const descShort = desc.length > 140 ? desc.slice(0, 140) + '…' : desc;
    const canApprove = !!r.linked_use_case_id;

    return `
      <tr data-id="${escapeHtml(r.id)}" style="border-top:1px solid var(--border,#334155);">
        <td style="padding:10px 12px;max-width:420px;" title="${escapeHtml(desc)}">${escapeHtml(descShort)}</td>
        <td style="padding:10px 12px;color:var(--text-secondary,#94a3b8);">${escapeHtml(r.ai_tool || '—')}</td>
        <td style="padding:10px 12px;">${ucLabel}</td>
        <td style="padding:10px 12px;">${confPct}</td>
        <td style="padding:10px 12px;text-align:right;white-space:nowrap;">
          <button data-act="approve" ${canApprove ? '' : 'disabled title="No suggestion to approve"'} style="padding:4px 10px;font-size:12px;margin-right:4px;background:var(--success,#10b981);color:#fff;border:none;border-radius:4px;cursor:${canApprove ? 'pointer' : 'not-allowed'};opacity:${canApprove ? '1' : '0.5'};">Approve</button>
          <button data-act="change" style="padding:4px 10px;font-size:12px;margin-right:4px;background:var(--accent,#3b82f6);color:#fff;border:none;border-radius:4px;cursor:pointer;">Change…</button>
          <button data-act="nomatch" style="padding:4px 10px;font-size:12px;background:transparent;color:var(--danger,#ef4444);border:1px solid var(--danger,#ef4444);border-radius:4px;cursor:pointer;">No match</button>
        </td>
      </tr>`;
  }

  // Loose UUID v4-ish guard so a fat-fingered prompt doesn't burn an RPC.
  function isUuid(s) {
    return typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s.trim());
  }

  async function handleAction(taskId, act, btnEl) {
    const row = state.items.find(x => String(x.id) === String(taskId));
    if (!row) return;

    let useCaseId = null;
    if (act === 'approve') {
      if (!row.linked_use_case_id) {
        toast('No suggested use case to approve.', 'error');
        return;
      }
      useCaseId = row.linked_use_case_id;
    } else if (act === 'nomatch') {
      useCaseId = null;
    } else if (act === 'change') {
      const input = window.prompt('Enter use_case_id (UUID) to link this task to:');
      if (!input) return;
      const trimmed = input.trim();
      if (!isUuid(trimmed)) {
        toast('Not a valid UUID.', 'error');
        return;
      }
      useCaseId = trimmed;
    } else {
      return;
    }

    if (btnEl) { btnEl.disabled = true; btnEl.textContent = '…'; }

    try {
      // Phase D codex review FIX D — admin actions land as 'manual' (audit
      // trail), SPOC actions remain 'spoc_override'. Fall back to
      // 'spoc_override' when the role helper is unavailable.
      const userRole = (window.EAS_Auth && typeof window.EAS_Auth.getUserRole === 'function')
        ? (window.EAS_Auth.getUserRole() || '')
        : '';
      const source = userRole === 'admin' ? 'manual' : 'spoc_override';
      await db().setTaskUseCaseLink(taskId, useCaseId, source);
      toast('Linkage updated', 'success');
      // Drop the row optimistically; reload to refresh counts.
      state.items = state.items.filter(x => String(x.id) !== String(taskId));
      renderShell();
      load();
    } catch (err) {
      console.error('[link-queue] setTaskUseCaseLink failed:', err);
      toast('Update failed: ' + (err?.message || err), 'error');
      if (btnEl) { btnEl.disabled = false; }
      load();
    }
  }

  // Mount: integrate with admin.html SPA nav. The page calls
  // renderCurrentPage('manage-link-queue') after click, so we expose a global
  // for that switch and also handle hashchange / direct nav-item clicks as
  // fallbacks (matches admin-orphans.js pattern).
  window.AdminLinkQueue = { render: load };

  window.addEventListener('hashchange', () => {
    const h = (window.location.hash || '').replace('#', '');
    if (h === 'manage-link-queue') load();
  });
  document.addEventListener('click', (ev) => {
    const target = ev.target.closest('[data-page="manage-link-queue"]');
    if (target) setTimeout(load, 50);
  });
})();
