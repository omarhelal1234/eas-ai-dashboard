// ============================================================
// EAS — Use Case Library (Phase D, Task 17)
// New linked + filterable view that complements the legacy
// renderUseCases() block in index.html. Mounts into
// <div id="use-case-library-root">.
//
// Adapts to the project's actual globals:
//   • EAS_DB    (window.EAS_DB)  — fetchUseCases, spocCreateUseCase,
//                                  fetchUseCaseLinkedTasks
//   • EAS_Auth  (window.EAS_Auth)— getUserProfile, getUserRole
//   • EAS_Utils (window.EAS_Utils) — showToast
// Departments + practices are fetched directly via the supabase
// client, mirroring the admin-orphans pattern. Modal/toast helpers
// are implemented inline (the project does not export ui.openModal
// in a reusable way for this module).
// ============================================================

(function () {
  'use strict';

  const root = document.getElementById('use-case-library-root');
  if (!root) return;

  const sb = (typeof getSupabaseClient === 'function') ? getSupabaseClient() : null;

  const state = {
    items: [],
    linkCounts: {},   // { useCaseId: number of linked tasks }
    totalCount: 0,    // total use cases in DB (regardless of approvedOnly)
    approvedCount: 0, // approved-reference count
    pendingCount: 0,  // pending review count
    rejectedCount: 0, // rejected count
    communityCount: 0,// spoc_authored count
    totalLinkedTasks: 0,  // total tasks linked across all use cases
    totalHoursSaved: 0,   // aggregate hours_saved_per_impl across all
    departments: [],
    practices: [],
    deptCounts: {},   // { departmentId: count of use cases }
    filters: { departmentId: '', approvedOnly: false, search: '' },
    groupByDept: false,
    user: null,
    loaded: false,
  };

  async function loadLinkCounts() {
    if (!sb) return;
    try {
      const { data, error } = await sb
        .from('tasks')
        .select('linked_use_case_id, time_saved')
        .not('linked_use_case_id', 'is', null);
      if (error) { console.warn('[ucl] link counts failed', error); return; }
      const counts = {};
      let totalLinked = 0;
      (data || []).forEach(r => {
        const k = r.linked_use_case_id;
        counts[k] = (counts[k] || 0) + 1;
        totalLinked++;
      });
      state.linkCounts = counts;
      state.totalLinkedTasks = totalLinked;
    } catch (err) {
      console.warn('[ucl] link counts exception', err);
    }
  }

  async function loadTotals() {
    if (!sb) return;
    try {
      // Count-only queries use limit(0) on a GET instead of head:true —
      // HTTP HEAD requests to PostgREST intermittently 503 through some
      // proxies, while the count still arrives in Content-Range on GET.
      const [allRes, apprRes, pendRes, rejRes, commRes, hoursRes] = await Promise.all([
        sb.from('use_cases').select('id', { count: 'exact' }).limit(0),
        sb.from('use_cases').select('id', { count: 'exact' }).eq('is_approved_reference', true).limit(0),
        sb.from('use_cases').select('id', { count: 'exact' }).eq('approval_status', 'pending').limit(0),
        sb.from('use_cases').select('id', { count: 'exact' }).eq('approval_status', 'rejected').limit(0),
        sb.from('use_cases').select('id', { count: 'exact' }).eq('source', 'spoc_authored').limit(0),
        sb.from('use_cases').select('hours_saved_per_impl'),
      ]);
      if (typeof allRes.count === 'number') state.totalCount = allRes.count;
      if (typeof apprRes.count === 'number') state.approvedCount = apprRes.count;
      if (typeof pendRes.count === 'number') state.pendingCount = pendRes.count;
      if (typeof rejRes.count === 'number') state.rejectedCount = rejRes.count;
      if (typeof commRes.count === 'number') state.communityCount = commRes.count;
      if (!hoursRes.error && Array.isArray(hoursRes.data)) {
        state.totalHoursSaved = hoursRes.data.reduce((s, r) => s + (Number(r.hours_saved_per_impl) || 0), 0);
      }
    } catch (err) {
      console.warn('[ucl] totals load failed', err);
    }
  }

  // ------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------
  function escapeHtml(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }
  function escapeAttr(s) { return escapeHtml(s); }

  function toast(msg, type = 'success') {
    if (window.EAS_Utils && typeof window.EAS_Utils.showToast === 'function') {
      window.EAS_Utils.showToast(msg, type);
    } else {
      console[type === 'error' ? 'error' : 'log']('[ucl]', msg);
    }
  }

  // Minimal modal fallback — single overlay reused for all opens.
  function openModal(title, htmlBody) {
    closeModal();
    const overlay = document.createElement('div');
    overlay.id = 'ucl-modal-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(8,12,20,0.65);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;';
    overlay.innerHTML = `
      <div class="ucl-modal" role="dialog" aria-modal="true" style="background:var(--card-bg,#0f1624);color:var(--text,#e6eaf3);border:1px solid var(--border,#23304a);border-radius:12px;max-width:720px;width:100%;max-height:90vh;overflow:auto;box-shadow:0 24px 64px rgba(0,0,0,0.5);">
        <div class="ucl-modal-header" style="display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid var(--border,#23304a);">
          <h3 style="margin:0;font-size:16px;">${escapeHtml(title)}</h3>
          <button type="button" id="ucl-modal-close" aria-label="Close" style="background:transparent;border:0;color:inherit;font-size:22px;cursor:pointer;line-height:1;">&times;</button>
        </div>
        <div class="ucl-modal-content" style="padding:20px;">${htmlBody}</div>
      </div>`;
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
    document.body.appendChild(overlay);
    const closeBtn = document.getElementById('ucl-modal-close');
    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    document.addEventListener('keydown', escClose);
  }
  function escClose(e) { if (e.key === 'Escape') closeModal(); }
  function closeModal() {
    const ov = document.getElementById('ucl-modal-overlay');
    if (ov) ov.remove();
    document.removeEventListener('keydown', escClose);
  }

  // ------------------------------------------------------------
  // Permissions
  // ------------------------------------------------------------
  function canAuthor() {
    if (!state.user) return false;
    const role = state.user.role || (window.EAS_Auth && window.EAS_Auth.getUserRole && window.EAS_Auth.getUserRole());
    return ['admin', 'sector_spoc', 'dept_spoc', 'department_spoc', 'spoc'].includes(role);
  }

  // ------------------------------------------------------------
  // Lookups
  // ------------------------------------------------------------
  async function loadLookups() {
    if (!sb) return;
    try {
      const [deptRes, pracRes, deptCountRes] = await Promise.all([
        sb.from('departments').select('id,name').order('name'),
        sb.from('practices').select('id,name,department_id').order('name'),
        sb.from('use_cases').select('department_id').eq('is_approved_reference', true),
      ]);
      if (!deptRes.error && Array.isArray(deptRes.data)) state.departments = deptRes.data;
      if (!pracRes.error && Array.isArray(pracRes.data)) state.practices = pracRes.data;
      // Count approved use cases per department
      const counts = {};
      if (!deptCountRes.error && Array.isArray(deptCountRes.data)) {
        deptCountRes.data.forEach(r => {
          if (r.department_id) counts[r.department_id] = (counts[r.department_id] || 0) + 1;
        });
      }
      state.deptCounts = counts;
    } catch (err) {
      console.warn('[ucl] lookup load failed', err);
    }
  }

  // ------------------------------------------------------------
  // Data load + render
  // ------------------------------------------------------------
  async function load() {
    try {
      if (!state.loaded) {
        if (window.EAS_Auth && typeof window.EAS_Auth.getUserProfile === 'function') {
          try { state.user = await window.EAS_Auth.getUserProfile(); } catch (_) { /* anonymous */ }
        }
        // Read URL params for department filter persistence
        const urlParams = new URLSearchParams(window.location.search);
        const urlDept = urlParams.get('dept');
        if (urlDept) state.filters.departmentId = urlDept;
        // Restore group-by toggle from localStorage
        state.groupByDept = localStorage.getItem('ucl_group_by_dept') === '1';
        await Promise.all([loadLookups(), loadTotals()]);
        state.loaded = true;
      }
      await loadLinkCounts();
      if (!window.EAS_DB || typeof window.EAS_DB.fetchUseCases !== 'function') {
        root.innerHTML = '<div class="ucl-empty" style="padding:16px;color:var(--text-muted)">Use case library unavailable.</div>';
        return;
      }
      state.items = await window.EAS_DB.fetchUseCases({
        approvedOnly: state.filters.approvedOnly,
        departmentId: state.filters.departmentId || null,
        search: state.filters.search,
      });
      render();
    } catch (err) {
      console.error('[ucl] load failed', err);
      root.innerHTML = `<div class="ucl-empty" style="padding:16px;color:#f87171">Failed to load use cases: ${escapeHtml(err.message || String(err))}</div>`;
    }
  }

  // Helper: approval status badge for author's own pending/rejected/revision items
  function approvalBadge(uc) {
    if (!state.user || uc.author_user_id !== state.user.id) return '';
    if (uc.approval_status === 'approved' || !uc.approval_status) return '';
    const map = {
      pending:              ['#fef3c7', '#92400e', 'Pending review'],
      revision_requested:   ['#ffedd5', '#9a3412', 'Revision requested'],
      rejected:             ['#fee2e2', '#991b1b', 'Rejected'],
    };
    const [bg, fg, label] = map[uc.approval_status] || ['#e5e7eb', '#374151', uc.approval_status];
    const tooltip = (uc.approval_status !== 'pending' && uc.review_notes)
      ? ` title="${escapeAttr(uc.review_notes)}"`
      : '';
    return `<span class="ucl-approval-badge" style="background:${bg};color:${fg};padding:2px 8px;border-radius:999px;font-size:11px;font-weight:600;cursor:${uc.review_notes ? 'help' : 'default'}"${tooltip}>${escapeHtml(label)}</span>`;
  }

  // Helper: practice chip
  function practiceChip(uc) {
    const practiceName = uc.practice || '';
    if (!practiceName) return '';
    return `<span class="ucl-practice-chip" style="background:rgba(139,92,246,0.15);color:#a78bfa;padding:2px 8px;border-radius:999px;font-size:11px">${escapeHtml(practiceName)}</span>`;
  }

  function render() {
    // Update URL with dept filter
    const url = new URL(window.location);
    if (state.filters.departmentId) {
      url.searchParams.set('dept', state.filters.departmentId);
    } else {
      url.searchParams.delete('dept');
    }
    window.history.replaceState({}, '', url);

    // Compute per-view stats
    const useCasesWithLinks = Object.keys(state.linkCounts).length;
    const seedCount = state.totalCount - state.communityCount;

    // --- KPI Summary Cards ---
    const kpiBar = `
      <div class="ucl-kpi-bar" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:20px">
        <div class="ucl-kpi" style="background:var(--card-bg,#0f1624);border:1px solid var(--border,#23304a);border-radius:10px;padding:14px 16px;text-align:center">
          <div style="font-size:28px;font-weight:700;color:var(--text-primary,#e6eaf3)">${state.totalCount}</div>
          <div style="font-size:12px;color:var(--text-muted);margin-top:4px">Total Use Cases</div>
        </div>
        <div class="ucl-kpi" style="background:var(--card-bg,#0f1624);border:1px solid rgba(34,197,94,0.3);border-radius:10px;padding:14px 16px;text-align:center">
          <div style="font-size:28px;font-weight:700;color:#4ade80">${state.approvedCount}</div>
          <div style="font-size:12px;color:var(--text-muted);margin-top:4px">Approved by AI Innovation</div>
        </div>
        <div class="ucl-kpi" style="background:var(--card-bg,#0f1624);border:1px solid rgba(251,191,36,0.3);border-radius:10px;padding:14px 16px;text-align:center">
          <div style="font-size:28px;font-weight:700;color:#fbbf24">${state.pendingCount}</div>
          <div style="font-size:12px;color:var(--text-muted);margin-top:4px">Pending Review</div>
        </div>
        <div class="ucl-kpi" style="background:var(--card-bg,#0f1624);border:1px solid rgba(96,165,250,0.3);border-radius:10px;padding:14px 16px;text-align:center">
          <div style="font-size:28px;font-weight:700;color:#60a5fa">${state.communityCount}</div>
          <div style="font-size:12px;color:var(--text-muted);margin-top:4px">Community Authored</div>
        </div>
        <div class="ucl-kpi" style="background:var(--card-bg,#0f1624);border:1px solid rgba(168,85,247,0.3);border-radius:10px;padding:14px 16px;text-align:center">
          <div style="font-size:28px;font-weight:700;color:#a855f7">${state.totalLinkedTasks}</div>
          <div style="font-size:12px;color:var(--text-muted);margin-top:4px">Tasks Linked</div>
        </div>
        <div class="ucl-kpi" style="background:var(--card-bg,#0f1624);border:1px solid rgba(244,114,182,0.3);border-radius:10px;padding:14px 16px;text-align:center">
          <div style="font-size:28px;font-weight:700;color:#f472b6">${state.totalHoursSaved.toLocaleString()}<span style="font-size:14px;font-weight:400">h</span></div>
          <div style="font-size:12px;color:var(--text-muted);margin-top:4px">Potential Hours Saved</div>
        </div>
      </div>`;

    const filterBar = `
      <div class="ucl-filters" style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-bottom:14px">
        <input id="ucl-search" class="search-input" placeholder="Search..." value="${escapeAttr(state.filters.search)}" style="min-width:220px">
        <select id="ucl-dept" class="filter-select">
          <option value="">All departments</option>
          ${state.departments.map(d => {
            const cnt = state.deptCounts[d.id] || 0;
            return `<option value="${escapeAttr(d.id)}" ${String(d.id) === String(state.filters.departmentId) ? 'selected' : ''}>${escapeHtml(d.name)} (${cnt})</option>`;
          }).join('')}
        </select>
        <label style="display:inline-flex;align-items:center;gap:6px;color:var(--text-muted);font-size:13px" title="Approved reference use cases are curated by AI Innovation. Uncheck to see all community + reference use cases.">
          <input type="checkbox" id="ucl-approved" ${state.filters.approvedOnly ? 'checked' : ''}> Approved only
        </label>
        <label style="display:inline-flex;align-items:center;gap:6px;color:var(--text-muted);font-size:13px" title="Group use cases by department">
          <input type="checkbox" id="ucl-group-dept" ${state.groupByDept ? 'checked' : ''}> Group by dept
        </label>
        <span style="color:var(--text-muted);font-size:12px;margin-left:auto;background:rgba(148,163,184,0.1);padding:4px 10px;border-radius:6px">Showing <strong style="color:var(--text-primary)">${state.items.length}</strong> of ${state.totalCount}</span>
        ${canAuthor() ? `<button id="ucl-add" class="btn btn-primary" type="button">+ Add use case</button>` : ''}
      </div>`;

    let cardsHtml;
    if (state.items.length === 0) {
      cardsHtml = '<div class="empty-state" style="padding:24px;text-align:center;color:var(--text-muted)"><h4 style="margin:0 0 6px">No use cases found</h4><p style="margin:0">Try adjusting filters.</p></div>';
    } else if (state.groupByDept) {
      // Group items by department
      const groups = {};
      const noGroup = [];
      state.items.forEach(uc => {
        const deptId = uc.department_id;
        if (deptId) {
          if (!groups[deptId]) groups[deptId] = [];
          groups[deptId].push(uc);
        } else {
          noGroup.push(uc);
        }
      });
      const deptMap = {};
      state.departments.forEach(d => { deptMap[d.id] = d.name; });
      const sortedKeys = Object.keys(groups).sort((a, b) => (deptMap[a] || '').localeCompare(deptMap[b] || ''));
      cardsHtml = sortedKeys.map(deptId => {
        const deptName = deptMap[deptId] || 'Unknown';
        const items = groups[deptId];
        return `
          <details class="ucl-dept-group" open>
            <summary class="ucl-dept-header" style="cursor:pointer;font-size:15px;font-weight:600;color:var(--text-primary);padding:10px 0;border-bottom:1px solid var(--border,#23304a);margin-bottom:12px">
              ${escapeHtml(deptName)} <span style="font-weight:400;color:var(--text-muted);font-size:13px">(${items.length})</span>
            </summary>
            <div class="ucl-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px;margin-bottom:20px">${items.map(renderCard).join('')}</div>
          </details>`;
      }).join('');
      if (noGroup.length) {
        cardsHtml += `
          <details class="ucl-dept-group" open>
            <summary class="ucl-dept-header" style="cursor:pointer;font-size:15px;font-weight:600;color:var(--text-primary);padding:10px 0;border-bottom:1px solid var(--border,#23304a);margin-bottom:12px">
              No department <span style="font-weight:400;color:var(--text-muted);font-size:13px">(${noGroup.length})</span>
            </summary>
            <div class="ucl-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px;margin-bottom:20px">${noGroup.map(renderCard).join('')}</div>
          </details>`;
      }
    } else {
      cardsHtml = `<div class="ucl-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px">${state.items.map(renderCard).join('')}</div>`;
    }

    root.innerHTML = kpiBar + filterBar + cardsHtml;

    // Wire filter events
    const searchEl = document.getElementById('ucl-search');
    const deptEl = document.getElementById('ucl-dept');
    const apprEl = document.getElementById('ucl-approved');
    const groupEl = document.getElementById('ucl-group-dept');
    if (searchEl) {
      let t = null;
      searchEl.addEventListener('input', (e) => {
        clearTimeout(t);
        const v = e.target.value;
        t = setTimeout(() => { state.filters.search = v; load(); }, 250);
      });
    }
    if (deptEl) deptEl.addEventListener('change', (e) => { state.filters.departmentId = e.target.value; load(); });
    if (apprEl) apprEl.addEventListener('change', (e) => { state.filters.approvedOnly = e.target.checked; load(); });
    if (groupEl) groupEl.addEventListener('change', (e) => {
      state.groupByDept = e.target.checked;
      localStorage.setItem('ucl_group_by_dept', e.target.checked ? '1' : '0');
      render();
    });
    if (canAuthor()) {
      const addBtn = document.getElementById('ucl-add');
      if (addBtn) addBtn.addEventListener('click', () => openAuthor(null));
    }
    root.querySelectorAll('.ucl-card').forEach(el => {
      el.addEventListener('click', () => openDetail(el.dataset.id));
    });
  }

  function renderCard(uc) {
    const isSeed = uc.source === 'excel_seed';
    const badge = isSeed
      ? '<span class="ucl-badge" style="background:rgba(59,130,246,0.15);color:#60a5fa;padding:2px 8px;border-radius:999px;font-size:11px">Reference</span>'
      : '<span class="ucl-badge ucl-badge-spoc" style="background:rgba(34,197,94,0.15);color:#4ade80;padding:2px 8px;border-radius:999px;font-size:11px">Authored</span>';
    const statusBadge = approvalBadge(uc);
    const pracChip = practiceChip(uc);
    const desc = uc.description || '';
    const truncDesc = desc.length > 120 ? desc.slice(0, 120) + '...' : desc;
    const linkCount = state.linkCounts[uc.id] || 0;
    const hoursSaved = Number(uc.hours_saved_per_impl || 0);
    const adoptions = Number(uc.no_of_adoptions || 0);

    // Linked tasks indicator — prominent
    const linkPill = linkCount > 0
      ? `<div style="display:flex;align-items:center;gap:6px;background:rgba(34,197,94,0.12);border:1px solid rgba(34,197,94,0.25);padding:6px 10px;border-radius:8px">
           <span style="font-size:18px;font-weight:700;color:#4ade80">${linkCount}</span>
           <span style="font-size:11px;color:#86efac;line-height:1.2">task${linkCount === 1 ? '' : 's'}<br>linked</span>
         </div>`
      : `<div style="display:flex;align-items:center;gap:6px;background:rgba(148,163,184,0.08);border:1px solid rgba(148,163,184,0.15);padding:6px 10px;border-radius:8px">
           <span style="font-size:18px;font-weight:700;color:var(--text-muted)">0</span>
           <span style="font-size:11px;color:var(--text-muted);line-height:1.2">tasks<br>linked</span>
         </div>`;

    // Hours saved indicator
    const hoursPill = hoursSaved > 0
      ? `<div style="display:flex;align-items:center;gap:6px;background:rgba(244,114,182,0.12);border:1px solid rgba(244,114,182,0.25);padding:6px 10px;border-radius:8px">
           <span style="font-size:18px;font-weight:700;color:#f472b6">${hoursSaved}</span>
           <span style="font-size:11px;color:#f9a8d4;line-height:1.2">hrs<br>saved</span>
         </div>`
      : '';

    // Adoptions indicator
    const adoptionPill = adoptions > 0
      ? `<div style="display:flex;align-items:center;gap:6px;background:rgba(96,165,250,0.12);border:1px solid rgba(96,165,250,0.25);padding:6px 10px;border-radius:8px">
           <span style="font-size:18px;font-weight:700;color:#60a5fa">${adoptions}</span>
           <span style="font-size:11px;color:#93c5fd;line-height:1.2">adoption${adoptions === 1 ? '' : 's'}<br>ref</span>
         </div>`
      : '';

    // For revision_requested items by the current author, add an edit hint
    const editHint = (state.user && uc.author_user_id === state.user.id && uc.approval_status === 'revision_requested')
      ? `<span style="font-size:11px;color:#f97316;margin-left:4px">✏️ Click to edit & resubmit</span>`
      : '';
    return `
      <article class="ucl-card" data-id="${escapeAttr(uc.id)}" style="background:var(--card-bg,#0f1624);border:1px solid var(--border,#23304a);border-radius:10px;padding:14px;cursor:pointer;display:flex;flex-direction:column;gap:8px;transition:border-color .15s,box-shadow .15s${uc.approval_status === 'rejected' ? ';opacity:0.6' : ''}">
        <header style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
          <span class="ucl-asset" style="font-family:monospace;font-size:12px;color:var(--text-muted)">${escapeHtml(uc.asset_id || '')}</span>
          <div style="display:flex;gap:4px;flex-wrap:wrap">${badge}${statusBadge ? ' ' + statusBadge : ''}${pracChip ? ' ' + pracChip : ''}</div>
        </header>
        <h3 style="margin:0;font-size:15px;line-height:1.35">${escapeHtml(uc.name || '(unnamed)')}</h3>
        <p style="margin:0;font-size:13px;color:var(--text-muted);line-height:1.5;flex:1">${escapeHtml(truncDesc)}</p>
        <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:stretch;margin-top:auto">${linkPill}${hoursPill}${adoptionPill}</div>
        ${editHint ? `<div>${editHint}</div>` : ''}
      </article>`;
  }

  // ------------------------------------------------------------
  // Detail modal
  // ------------------------------------------------------------
  async function openDetail(id) {
    const uc = state.items.find(x => String(x.id) === String(id));
    if (!uc) return;

    // If this is the author's own revision_requested item, open edit modal instead
    if (state.user && uc.author_user_id === state.user.id && uc.approval_status === 'revision_requested') {
      openAuthor(uc, true); // true = edit mode (resubmit)
      return;
    }

    let linked = [];
    try {
      if (window.EAS_DB && typeof window.EAS_DB.fetchUseCaseLinkedTasks === 'function') {
        linked = await window.EAS_DB.fetchUseCaseLinkedTasks(uc.id);
      }
    } catch (err) {
      console.warn('[ucl] linked tasks fetch failed', err);
    }
    const totalSaved = linked.reduce((s, t) => s + (Number(t.time_saved) || 0), 0);
    const completedTasks = linked.filter(t => t.status === 'completed' || t.status === 'done').length;
    const isSeed = uc.source === 'excel_seed';
    const cloneBtn = (isSeed && canAuthor())
      ? `<button id="ucl-clone" class="btn btn-primary" type="button">Clone &amp; customise</button>`
      : '';

    // Show review notes for author's own rejected items
    const reviewNotesHtml = (state.user && uc.author_user_id === state.user.id && uc.review_notes && uc.approval_status !== 'approved')
      ? `<div style="background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);border-radius:8px;padding:12px;margin-bottom:14px">
           <h4 style="margin:0 0 4px;font-size:13px;color:#f87171">Reviewer notes</h4>
           <p style="margin:0;font-size:13px;color:var(--text-primary)">${escapeHtml(uc.review_notes)}</p>
         </div>`
      : '';

    // Linked tasks stats block
    const linkedStatsHtml = `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;margin-bottom:14px">
        <div style="background:rgba(34,197,94,0.08);border:1px solid rgba(34,197,94,0.2);border-radius:8px;padding:10px;text-align:center">
          <div style="font-size:22px;font-weight:700;color:#4ade80">${linked.length}</div>
          <div style="font-size:11px;color:var(--text-muted)">Linked Tasks</div>
        </div>
        <div style="background:rgba(96,165,250,0.08);border:1px solid rgba(96,165,250,0.2);border-radius:8px;padding:10px;text-align:center">
          <div style="font-size:22px;font-weight:700;color:#60a5fa">${completedTasks}</div>
          <div style="font-size:11px;color:var(--text-muted)">Completed</div>
        </div>
        <div style="background:rgba(244,114,182,0.08);border:1px solid rgba(244,114,182,0.2);border-radius:8px;padding:10px;text-align:center">
          <div style="font-size:22px;font-weight:700;color:#f472b6">${totalSaved.toFixed(1)}<span style="font-size:12px">h</span></div>
          <div style="font-size:11px;color:var(--text-muted)">Hours Saved</div>
        </div>
        <div style="background:rgba(251,191,36,0.08);border:1px solid rgba(251,191,36,0.2);border-radius:8px;padding:10px;text-align:center">
          <div style="font-size:22px;font-weight:700;color:#fbbf24">${Number(uc.no_of_adoptions || 0)}</div>
          <div style="font-size:11px;color:var(--text-muted)">Adoptions (ref)</div>
        </div>
      </div>`;

    // Linked tasks list (show up to 10)
    const linkedListHtml = linked.length > 0
      ? `<div style="margin-top:8px;max-height:200px;overflow-y:auto">
           <table style="width:100%;font-size:12px;border-collapse:collapse">
             <thead><tr style="color:var(--text-muted);text-align:left;border-bottom:1px solid var(--border,#23304a)">
               <th style="padding:6px 8px">Task</th>
               <th style="padding:6px 8px">Status</th>
               <th style="padding:6px 8px">Time Saved</th>
               <th style="padding:6px 8px">Confidence</th>
             </tr></thead>
             <tbody>${linked.slice(0, 15).map(t => `
               <tr style="border-bottom:1px solid rgba(35,48,74,0.5)">
                 <td style="padding:6px 8px;color:var(--text-primary)">${escapeHtml(t.task_description || t.id || '—')}</td>
                 <td style="padding:6px 8px"><span style="font-size:11px;padding:2px 6px;border-radius:4px;background:${t.status === 'completed' || t.status === 'done' ? 'rgba(34,197,94,0.15);color:#4ade80' : 'rgba(148,163,184,0.12);color:var(--text-muted)'}">${escapeHtml(t.status || '—')}</span></td>
                 <td style="padding:6px 8px;color:var(--text-muted)">${Number(t.time_saved || 0)}h</td>
                 <td style="padding:6px 8px;color:var(--text-muted)">${t.link_confidence ? (Number(t.link_confidence) * 100).toFixed(0) + '%' : '—'}</td>
               </tr>`).join('')}
             </tbody>
           </table>
           ${linked.length > 15 ? `<div style="text-align:center;padding:6px;font-size:11px;color:var(--text-muted)">+ ${linked.length - 15} more tasks</div>` : ''}
         </div>`
      : `<div style="text-align:center;padding:12px;color:var(--text-muted);font-size:13px">No tasks linked to this use case yet</div>`;

    const html = `
      <div class="ucl-modal-body">
        ${reviewNotesHtml}
        <p style="margin:0 0 4px"><strong>${escapeHtml(uc.asset_id || '')}</strong>
          <span style="color:var(--text-muted)">
            ${uc.category ? ' &middot; ' + escapeHtml(uc.category) : ''}
            ${uc.sdlc_phase ? ' &middot; ' + escapeHtml(uc.sdlc_phase) : ''}
          </span>
        </p>
        <p style="margin:0 0 14px;color:var(--text-muted)">${escapeHtml(uc.description || '')}</p>
        ${linkedStatsHtml}
        ${uc.implementation_guidelines ? `<h4 style="margin:14px 0 6px;font-size:13px">Implementation guidelines</h4><pre style="white-space:pre-wrap;font-family:inherit;background:rgba(0,0,0,0.2);padding:10px;border-radius:6px;font-size:12px;color:var(--text-muted)">${escapeHtml(uc.implementation_guidelines)}</pre>` : ''}
        ${uc.suggestion_how_to_apply ? `<h4 style="margin:14px 0 6px;font-size:13px">Suggestion to apply</h4><pre style="white-space:pre-wrap;font-family:inherit;background:rgba(0,0,0,0.2);padding:10px;border-radius:6px;font-size:12px;color:var(--text-muted)">${escapeHtml(uc.suggestion_how_to_apply)}</pre>` : ''}
        <h4 style="margin:14px 0 6px;font-size:13px">Linked Tasks</h4>
        ${linkedListHtml}
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">${cloneBtn}</div>
      </div>`;
    openModal(uc.name || 'Use case', html);
    if (cloneBtn) {
      const btn = document.getElementById('ucl-clone');
      if (btn) btn.addEventListener('click', () => openAuthor(uc));
    }
  }

  // ------------------------------------------------------------
  // Author / clone modal
  // ------------------------------------------------------------
  function openAuthor(seed, isEdit = false) {
    const seedDept = seed ? seed.department_id : '';
    const seedPractice = seed ? seed.practice_id : '';
    const editId = isEdit ? seed?.id : null;

    // Show reviewer notes banner for edit (revision_requested) mode
    const reviewBanner = (isEdit && seed?.review_notes)
      ? `<div style="background:rgba(249,115,22,0.12);border:1px solid rgba(249,115,22,0.3);border-radius:8px;padding:12px;margin-bottom:12px">
           <strong style="color:#f97316;font-size:13px">Reviewer feedback:</strong>
           <p style="margin:4px 0 0;font-size:13px;color:var(--text-primary)">${escapeHtml(seed.review_notes)}</p>
         </div>`
      : '';

    const html = `
      ${reviewBanner}
      <form id="ucl-form" class="ucl-form" style="display:grid;gap:10px">
        <label style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--text-muted)">Name
          <input name="name" required value="${escapeAttr(seed?.name || '')}" style="padding:8px;border-radius:6px;border:1px solid var(--border,#23304a);background:var(--input-bg,#0a0f1a);color:inherit"></label>
        <label style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--text-muted)">Description
          <textarea name="description" required rows="3" style="padding:8px;border-radius:6px;border:1px solid var(--border,#23304a);background:var(--input-bg,#0a0f1a);color:inherit;font-family:inherit">${escapeHtml(seed?.description || '')}</textarea></label>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <label style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--text-muted)">SDLC Phase
            <input name="sdlc_phase" value="${escapeAttr(seed?.sdlc_phase || '')}" style="padding:8px;border-radius:6px;border:1px solid var(--border,#23304a);background:var(--input-bg,#0a0f1a);color:inherit"></label>
          <label style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--text-muted)">Category
            <input name="category" value="${escapeAttr(seed?.category || '')}" style="padding:8px;border-radius:6px;border:1px solid var(--border,#23304a);background:var(--input-bg,#0a0f1a);color:inherit"></label>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <label style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--text-muted)">Subcategory
            <input name="subcategory" value="${escapeAttr(seed?.subcategory || '')}" style="padding:8px;border-radius:6px;border:1px solid var(--border,#23304a);background:var(--input-bg,#0a0f1a);color:inherit"></label>
          <label style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--text-muted)">AI Tools
            <input name="ai_tools" value="${escapeAttr(seed?.ai_tools || '')}" style="padding:8px;border-radius:6px;border:1px solid var(--border,#23304a);background:var(--input-bg,#0a0f1a);color:inherit"></label>
        </div>
        <label style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--text-muted)">Hours saved per implementation
          <input name="hours_saved_per_impl" type="number" step="0.5" min="0" value="${escapeAttr(seed?.hours_saved_per_impl || '')}" style="padding:8px;border-radius:6px;border:1px solid var(--border,#23304a);background:var(--input-bg,#0a0f1a);color:inherit"></label>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <label style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--text-muted)">Effort without AI
            <input name="efforts_without_ai" value="${escapeAttr(seed?.efforts_without_ai || '')}" style="padding:8px;border-radius:6px;border:1px solid var(--border,#23304a);background:var(--input-bg,#0a0f1a);color:inherit"></label>
          <label style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--text-muted)">Effort with AI
            <input name="efforts_with_ai" value="${escapeAttr(seed?.efforts_with_ai || '')}" style="padding:8px;border-radius:6px;border:1px solid var(--border,#23304a);background:var(--input-bg,#0a0f1a);color:inherit"></label>
        </div>
        <label style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--text-muted)">Business benefits
          <textarea name="business_benefits" rows="2" style="padding:8px;border-radius:6px;border:1px solid var(--border,#23304a);background:var(--input-bg,#0a0f1a);color:inherit;font-family:inherit">${escapeHtml(seed?.business_benefits || '')}</textarea></label>
        <label style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--text-muted)">Implementation guidelines
          <textarea name="implementation_guidelines" rows="2" style="padding:8px;border-radius:6px;border:1px solid var(--border,#23304a);background:var(--input-bg,#0a0f1a);color:inherit;font-family:inherit">${escapeHtml(seed?.implementation_guidelines || '')}</textarea></label>
        <label style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--text-muted)">How to apply
          <textarea name="suggestion_how_to_apply" rows="2" style="padding:8px;border-radius:6px;border:1px solid var(--border,#23304a);background:var(--input-bg,#0a0f1a);color:inherit;font-family:inherit">${escapeHtml(seed?.suggestion_how_to_apply || '')}</textarea></label>
        <label style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--text-muted)">Department
          <select name="department_id" required style="padding:8px;border-radius:6px;border:1px solid var(--border,#23304a);background:var(--input-bg,#0a0f1a);color:inherit">
            <option value="">— select —</option>
            ${state.departments.map(d =>
              `<option value="${escapeAttr(d.id)}" ${String(d.id) === String(seedDept) ? 'selected' : ''}>${escapeHtml(d.name)}</option>`
            ).join('')}
          </select></label>
        <label style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--text-muted)">Practice (optional)
          <select name="practice_id" style="padding:8px;border-radius:6px;border:1px solid var(--border,#23304a);background:var(--input-bg,#0a0f1a);color:inherit">
            <option value="">— none —</option>
            ${state.practices.map(p =>
              `<option value="${escapeAttr(p.id)}" data-dept="${escapeAttr(p.department_id)}" ${String(p.id) === String(seedPractice) ? 'selected' : ''}>${escapeHtml(p.name)}</option>`
            ).join('')}
          </select></label>
        <input type="hidden" name="cloned_from_use_case_id" value="${escapeAttr((!isEdit && seed?.id) || '')}">
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:6px">
          <button type="button" id="ucl-form-cancel" class="btn">Cancel</button>
          <button type="submit" class="btn btn-primary">${isEdit ? 'Resubmit for review' : 'Create use case'}</button>
        </div>
      </form>`;

    openModal(isEdit ? 'Edit & resubmit' : (seed ? 'Clone & customise' : 'Add use case'), html);

    const cancelBtn = document.getElementById('ucl-form-cancel');
    if (cancelBtn) cancelBtn.addEventListener('click', closeModal);

    const form = document.getElementById('ucl-form');
    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(form);
        const payload = {};
        for (const [k, v] of fd.entries()) {
          if (v === '' || v === null) continue;
          payload[k] = (k === 'hours_saved_per_impl') ? Number(v) : v;
        }
        try {
          if (editId) {
            // Edit mode: update existing use case and reset to pending
            if (!sb) throw new Error('Supabase client not available');
            const { error } = await sb.from('use_cases')
              .update({
                name: payload.name,
                description: payload.description,
                sdlc_phase: payload.sdlc_phase || null,
                category: payload.category || null,
                subcategory: payload.subcategory || null,
                ai_tools: payload.ai_tools || null,
                hours_saved_per_impl: payload.hours_saved_per_impl || null,
                implementation_guidelines: payload.implementation_guidelines || null,
                suggestion_how_to_apply: payload.suggestion_how_to_apply || null,
                business_benefits: payload.business_benefits || null,
                efforts_without_ai: payload.efforts_without_ai || null,
                efforts_with_ai: payload.efforts_with_ai || null,
                approval_status: 'pending',
                review_notes: null,
              })
              .eq('id', editId);
            if (error) throw error;
            toast('Resubmitted to AI Innovation for review.');
          } else {
            // Create mode
            if (!window.EAS_DB || typeof window.EAS_DB.spocCreateUseCase !== 'function') {
              throw new Error('spocCreateUseCase not available');
            }
            const row = await window.EAS_DB.spocCreateUseCase(payload);
            const assetId = (row && (row.asset_id || (Array.isArray(row) && row[0]?.asset_id))) || '';
            toast(`Submitted ${assetId || 'use case'} to AI Innovation for review.`);
          }
          closeModal();
          load();
        } catch (err) {
          console.error('[ucl] create/edit failed', err);
          toast(`Error: ${err.message || err}`, 'error');
        }
      });
    }
  }

  // ------------------------------------------------------------
  // Boot — load on DOMContentLoaded; also re-load when the
  // Use Case Library nav item is clicked (in case of late mount).
  // ------------------------------------------------------------
  function boot() { load(); }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
  document.addEventListener('click', (ev) => {
    const t = ev.target.closest && ev.target.closest('[data-page="usecases"]');
    if (t) setTimeout(load, 60);
  });

  // Expose a tiny handle for debugging.
  window.EAS_UseCaseLibrary = { reload: load };
})();
