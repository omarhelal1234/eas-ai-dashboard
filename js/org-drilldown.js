// ============================================================
// EAS_OrgDrilldown — Phase 3
// Hierarchical drill-down landing: sector tiles → unit tiles → practice tiles.
// Backed by get_sector_summary / get_unit_summary RPCs (sql/039) + the
// sector → department → practice tree from EAS_Hierarchy.
//
// State is URL-driven so back/forward + sharing work:
//   #org                       → sector grid
//   #org/<sectorId>            → unit grid for that sector (breadcrumb: Sector >)
//   #org/<sectorId>/<unitId>   → practice grid for that unit (breadcrumb: Sector > Unit >)
//
// Container element id: `org-drilldown-root`. Render is idempotent — calling
// EAS_OrgDrilldown.render() re-fetches and redraws from the current URL hash.
// ============================================================

const EAS_OrgDrilldown = (() => {
  const sb = (typeof getSupabaseClient === 'function') ? getSupabaseClient() : null;
  let _quarterId = null; // optional caller-supplied quarter filter

  function escapeHtml(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }

  function fmtHours(n) {
    if (n == null || isNaN(Number(n))) return '0h';
    const v = Number(n);
    return v >= 100 ? `${Math.round(v).toLocaleString()}h` : `${v.toFixed(1)}h`;
  }

  function tile({ title, subtitle, contributors, tasks, hours, navHash, accentColor }) {
    const safeTitle = escapeHtml(title);
    const safeSub = escapeHtml(subtitle || '');
    // Constrain accentColor to a hex literal so a malicious sector.brand_color
    // can't break out of the style attribute. Default to brand purple.
    const safeColor = (typeof accentColor === 'string' && /^#[0-9A-Fa-f]{6}$/.test(accentColor))
      ? accentColor : '#7c3aed';
    // Tiles without a navHash (e.g. practice leaves) render as info cards —
    // no role=button, no cursor:pointer, no dead-link nav target.
    const interactive = !!navHash;
    const navAttr = interactive ? `role="button" tabindex="0" data-nav-hash="${escapeHtml(navHash)}"` : '';
    const cursor = interactive ? 'cursor:pointer;' : '';
    return `
      <div class="org-tile" ${navAttr}
           style="${cursor}background:var(--bg-card,#fff);border:1px solid var(--border,#e5e7eb);border-left:4px solid ${safeColor};border-radius:10px;padding:16px;transition:transform 0.15s, box-shadow 0.15s;">
        <div style="font-weight:600;font-size:15px;color:var(--text-primary,#111);">${safeTitle}</div>
        ${safeSub ? `<div style="font-size:12px;color:var(--text-muted,#666);margin-top:2px;">${safeSub}</div>` : ''}
        <div style="display:flex;gap:18px;margin-top:14px;font-size:12px;color:var(--text-muted,#444);">
          <div><div style="font-weight:700;font-size:18px;color:var(--text-primary,#111);">${contributors ?? 0}</div>contributors</div>
          <div><div style="font-weight:700;font-size:18px;color:var(--text-primary,#111);">${tasks ?? 0}</div>tasks</div>
          <div><div style="font-weight:700;font-size:18px;color:var(--text-primary,#111);">${fmtHours(hours)}</div>hours saved</div>
        </div>
      </div>
    `;
  }

  // Event delegation: tile click + Enter key (single listener bound once below).
  let _delegationWired = false;
  function ensureDelegation(root) {
    if (_delegationWired || !root) return;
    _delegationWired = true;
    root.addEventListener('click', (ev) => {
      const tileEl = ev.target.closest('.org-tile[data-nav-hash]');
      if (!tileEl) return;
      const hash = tileEl.getAttribute('data-nav-hash');
      if (hash) window.location.hash = hash;
    });
    root.addEventListener('keypress', (ev) => {
      if (ev.key !== 'Enter') return;
      const tileEl = ev.target.closest('.org-tile[data-nav-hash]');
      if (!tileEl) return;
      const hash = tileEl.getAttribute('data-nav-hash');
      if (hash) window.location.hash = hash;
    });
    root.addEventListener('mouseover', (ev) => {
      const tileEl = ev.target.closest('.org-tile');
      if (tileEl) { tileEl.style.transform = 'translateY(-2px)'; tileEl.style.boxShadow = '0 6px 16px rgba(0,0,0,0.08)'; }
    });
    root.addEventListener('mouseout', (ev) => {
      const tileEl = ev.target.closest('.org-tile');
      if (tileEl) { tileEl.style.transform = ''; tileEl.style.boxShadow = ''; }
    });
  }

  function breadcrumb({ sectorName, unitName, sectorId }) {
    const root = `<a href="#org" style="color:var(--brand,#7c3aed);text-decoration:none;">All Sectors</a>`;
    const parts = [root];
    if (sectorName) {
      parts.push(unitName
        ? `<a href="#org/${sectorId}" style="color:var(--brand,#7c3aed);text-decoration:none;">${escapeHtml(sectorName)}</a>`
        : `<span style="color:var(--text-primary,#111);font-weight:600;">${escapeHtml(sectorName)}</span>`);
    }
    if (unitName) parts.push(`<span style="color:var(--text-primary,#111);font-weight:600;">${escapeHtml(unitName)}</span>`);
    return `<div style="display:flex;gap:6px;align-items:center;font-size:13px;margin-bottom:16px;color:var(--text-muted,#666);">${parts.join('<span style="color:#bbb;">›</span>')}</div>`;
  }

  function gridContainer(html) {
    return `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:14px;">${html}</div>`;
  }

  function emptyState(msg) {
    return `<div style="padding:48px;text-align:center;color:var(--text-muted,#666);">${escapeHtml(msg)}</div>`;
  }

  function loadingState(msg) {
    return `<div style="padding:48px;text-align:center;color:var(--text-muted,#666);">${escapeHtml(msg || 'Loading…')}</div>`;
  }

  // ---------- View renderers ----------

  async function renderSectorGrid(root) {
    root.innerHTML = breadcrumb({}) + loadingState('Loading sectors…');
    const { data: rows, error } = await sb.rpc('get_sector_summary', { p_quarter_id: _quarterId });
    if (error) { root.innerHTML = emptyState('Failed to load sectors: ' + error.message); return; }
    if (!rows?.length) { root.innerHTML = breadcrumb({}) + emptyState('No active sectors yet.'); return; }

    const tiles = rows.map(r => tile({
      title: r.sector_name,
      subtitle: r.sector_spoc ? `SPOC: ${r.sector_spoc}` : 'SPOC: —',
      contributors: r.contributors,
      tasks: r.tasks,
      hours: r.hours_saved,
      navHash: `org/${r.sector_id}`,
      accentColor: r.brand_color || '#7c3aed'
    })).join('');
    root.innerHTML = breadcrumb({}) + gridContainer(tiles);
  }

  async function renderUnitGrid(root, sectorId) {
    // Resolve sector name from cached fetch (so the breadcrumb is correct before RPC returns)
    const sectors = await EAS_Hierarchy.fetchSectors({ activeOnly: false });
    const sec = sectors.find(s => s.id === sectorId);
    if (!sec) { root.innerHTML = emptyState('Sector not found.'); return; }

    root.innerHTML = breadcrumb({ sectorName: sec.name }) + loadingState('Loading units…');
    const { data: rows, error } = await sb.rpc('get_unit_summary', { p_sector_id: sectorId, p_quarter_id: _quarterId });
    if (error) { root.innerHTML = emptyState('Failed to load units: ' + error.message); return; }
    if (!rows?.length) {
      // Flat sector — show a note + a contribute-direct CTA
      root.innerHTML = breadcrumb({ sectorName: sec.name }) + emptyState(
        `${sec.name} has no units. Contributions roll up directly to the sector.`
      );
      return;
    }
    const tiles = rows.map(r => tile({
      title: r.department_name,
      subtitle: r.unit_spoc ? `Unit SPOC: ${r.unit_spoc}` : 'Unit SPOC: —',
      contributors: r.contributors,
      tasks: r.tasks,
      hours: r.hours_saved,
      navHash: `org/${sectorId}/${r.department_id}`,
      accentColor: '#2563eb'
    })).join('');
    root.innerHTML = breadcrumb({ sectorName: sec.name }) + gridContainer(tiles);
  }

  async function renderPracticeGrid(root, sectorId, unitId) {
    const sectors = await EAS_Hierarchy.fetchSectors({ activeOnly: false });
    const sec = sectors.find(s => s.id === sectorId);
    const units = await EAS_Hierarchy.fetchDepartmentsBySector(sectorId, { activeOnly: false });
    const unit = units.find(d => d.id === unitId);
    if (!sec || !unit) { root.innerHTML = emptyState('Path not found.'); return; }

    root.innerHTML = breadcrumb({ sectorName: sec.name, unitName: unit.name, sectorId }) + loadingState('Loading practices…');
    const practices = await EAS_Hierarchy.fetchPracticesByDepartment(unitId, { activeOnly: false });
    if (!practices.length) {
      root.innerHTML = breadcrumb({ sectorName: sec.name, unitName: unit.name, sectorId }) + emptyState(
        `${unit.name} has no practices. Contributions roll up to the unit.`
      );
      return;
    }
    // Practice tiles use the existing get_org_leaderboard at practice level for tasks/hours.
    const { data: lbRows, error: lbErr } = await sb.rpc('get_org_leaderboard', { p_level: 'practice', p_quarter_id: _quarterId });
    if (lbErr) console.warn('renderPracticeGrid: get_org_leaderboard failed:', lbErr.message);
    const lbBy = new Map((lbRows || []).map(r => [r.scope_id, r]));
    const tiles = practices.map(p => {
      const stats = lbBy.get(p.id) || {};
      return tile({
        title: p.name,
        subtitle: p.practice_spoc_email ? `SPOC: ${p.practice_spoc_email}` : 'Multi-SPOC',
        contributors: stats.contributors || 0,
        tasks: stats.tasks || 0,
        hours: stats.hours_saved || 0,
        // Practice leaves are info-only — there is no per-practice detail page.
        navHash: null,
        accentColor: '#059669'
      });
    }).join('');
    root.innerHTML = breadcrumb({ sectorName: sec.name, unitName: unit.name, sectorId }) + gridContainer(tiles);
  }

  // ---------- Public API ----------

  async function render(rootEl, opts = {}) {
    const root = (typeof rootEl === 'string') ? document.getElementById(rootEl) : rootEl;
    if (!root) return;
    if (opts.quarterId !== undefined) _quarterId = opts.quarterId || null;
    ensureDelegation(root);

    // Parse hash: org / org/<sid> / org/<sid>/<uid>
    const h = (window.location.hash || '').replace(/^#/, '');
    const m = h.match(/^org(?:\/([0-9a-f-]+))?(?:\/([0-9a-f-]+))?$/i);
    const sectorId = m?.[1] || null;
    const unitId   = m?.[2] || null;

    if (!sectorId)      return renderSectorGrid(root);
    if (sectorId && !unitId) return renderUnitGrid(root, sectorId);
    return renderPracticeGrid(root, sectorId, unitId);
  }

  // Re-render on hashchange when the hash is in the org/* family.
  window.addEventListener('hashchange', () => {
    const root = document.getElementById('org-drilldown-root');
    if (!root) return;
    const h = (window.location.hash || '').replace(/^#/, '');
    if (/^org(\/|$)/i.test(h)) render(root);
  });

  return { render, setQuarter(qid){ _quarterId = qid || null; } };
})();
