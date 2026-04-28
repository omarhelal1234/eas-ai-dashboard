// ============================================================
// EAS Admin — Org Hierarchy tree view (Phase 2)
// Renders sectors → units → practices with scoped edit rights:
//   * admin       — edit everything
//   * sector_spoc — edit only their sector's units/practices
//   * dept_spoc   — edit only their unit's practices
// Read-only rendering for everyone else (we still show the tree).
// Writes go through EAS_Hierarchy.* upserts; RLS rejects out-of-scope.
// ============================================================

const OrgTree = (() => {
  const sb = (typeof getSupabaseClient === 'function') ? getSupabaseClient() : null;
  let _profile = null;
  let _editCtx = null; // { kind: 'sector'|'unit'|'practice', id?, parent_id? }

  function escapeHtml(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }

  function canEditSector(sector) {
    if (!_profile) return false;
    if (_profile.role === 'admin') return true;
    if (_profile.role === 'sector_spoc' && sector.id === _profile.sector_id) return true;
    return false;
  }
  function canEditUnit(unit) {
    if (!_profile) return false;
    if (_profile.role === 'admin') return true;
    if (_profile.role === 'sector_spoc' && unit.sector_id === _profile.sector_id) return true;
    if (_profile.role === 'dept_spoc' && unit.id === _profile.department_id) return true;
    return false;
  }
  function canEditPractice(practice, unit) {
    if (!_profile) return false;
    if (_profile.role === 'admin') return true;
    if (_profile.role === 'sector_spoc' && unit?.sector_id === _profile.sector_id) return true;
    if (_profile.role === 'dept_spoc' && practice.department_id === _profile.department_id) return true;
    return false;
  }
  function canAddSector() { return _profile?.role === 'admin'; }
  function canAddUnitTo(sector) {
    if (!_profile) return false;
    if (_profile.role === 'admin') return true;
    if (_profile.role === 'sector_spoc' && sector.id === _profile.sector_id) return true;
    return false;
  }
  function canAddPracticeTo(unit) {
    if (!_profile) return false;
    if (_profile.role === 'admin') return true;
    if (_profile.role === 'sector_spoc' && unit.sector_id === _profile.sector_id) return true;
    if (_profile.role === 'dept_spoc' && unit.id === _profile.department_id) return true;
    return false;
  }

  function rowStyle(level) {
    const indent = level * 24;
    return `padding:8px 12px 8px ${indent + 12}px;border-bottom:1px solid var(--border, #eee);display:flex;align-items:center;gap:12px;`;
  }
  function dimIfInactive(active) {
    return active === false ? 'opacity:0.45;' : '';
  }
  function btn(label, handler) {
    return `<button class="btn btn-sm" style="padding:2px 8px;font-size:12px;" onclick="${handler}">${label}</button>`;
  }

  function rowHtml(kind, row, opts = {}) {
    const { level = 0, parent } = opts;
    const editable = (kind === 'sector') ? canEditSector(row)
                    : (kind === 'unit')  ? canEditUnit(row)
                    : canEditPractice(row, parent);
    const addChild = (kind === 'sector' && canAddUnitTo(row))
                    ? btn('+ Unit', `OrgTree.openUnitModal('${row.id}')`)
                    : (kind === 'unit' && canAddPracticeTo(row))
                    ? btn('+ Practice', `OrgTree.openPracticeModal('${row.id}')`)
                    : '';
    const editBtn = editable
      ? btn('Edit', `OrgTree.open${kind === 'sector' ? 'Sector' : kind === 'unit' ? 'Unit' : 'Practice'}Modal('${row.id}')`)
      : '';
    const spocLabel = kind === 'sector' ? (row.sector_spoc_name || row.sector_spoc_email || '—')
                    : kind === 'unit'   ? (row.unit_spoc_name   || row.unit_spoc_email   || '—')
                    : (row.practice_spoc_email || '—');
    const inactiveTag = row.is_active === false ? '<span style="font-size:11px;color:#c0392b;background:#fde8e8;padding:1px 6px;border-radius:4px;">inactive</span>' : '';
    const kindLabel = kind === 'sector' ? 'SECTOR' : kind === 'unit' ? 'UNIT' : 'PRACTICE';
    const kindColor = kind === 'sector' ? '#7c3aed' : kind === 'unit' ? '#2563eb' : '#059669';
    return `
      <div style="${rowStyle(level)}${dimIfInactive(row.is_active)}">
        <span style="font-size:10px;font-weight:700;color:white;background:${kindColor};padding:2px 6px;border-radius:3px;width:62px;text-align:center;">${kindLabel}</span>
        <strong style="flex:1;">${escapeHtml(row.name)}</strong>
        <span style="font-size:12px;color:var(--text-muted, #666);">${escapeHtml(spocLabel)}</span>
        ${inactiveTag}
        <span style="display:flex;gap:6px;">${addChild}${editBtn}</span>
      </div>
    `;
  }

  async function render() {
    const container = document.getElementById('org-tree-container');
    if (!container) return;
    container.innerHTML = '<div style="padding:24px;color:var(--text-muted, #888);">Loading hierarchy…</div>';

    _profile = (typeof EAS_Auth !== 'undefined') ? await EAS_Auth.getUserProfile() : null;
    const tree = await EAS_Hierarchy.fetchOrgTree({ activeOnly: false });

    const addBtn = document.getElementById('org-add-sector-btn');
    if (addBtn) addBtn.style.display = canAddSector() ? '' : 'none';

    if (!tree.length) {
      container.innerHTML = '<div style="padding:24px;color:var(--text-muted, #888);">No sectors found.</div>';
      return;
    }

    const html = tree.map(s => {
      const sectorRow = rowHtml('sector', s, { level: 0 });
      const unitRows = (s.departments || []).map(u => {
        const unitRow = rowHtml('unit', u, { level: 1 });
        const pracRows = (u.practices || []).map(p =>
          rowHtml('practice', p, { level: 2, parent: u })
        ).join('');
        return unitRow + pracRows;
      }).join('');
      return sectorRow + unitRows;
    }).join('');

    container.innerHTML = `<div style="background:var(--bg-card);border:1px solid var(--border, #ddd);border-radius:8px;overflow:hidden;">${html}</div>`;

    const countBadge = document.getElementById('admin-orgtree-count');
    if (countBadge) countBadge.textContent = tree.length;
  }

  // ---------- Edit modal ----------
  function showError(msg) {
    const el = document.getElementById('org-edit-error');
    if (!el) return;
    el.textContent = msg;
    el.style.display = msg ? 'block' : 'none';
  }

  function closeEditModal() {
    const m = document.getElementById('org-edit-modal');
    if (m) m.style.display = 'none';
    _editCtx = null;
    showError('');
  }

  function openModal(title, fields, ctx) {
    _editCtx = ctx;
    showError('');
    document.getElementById('org-edit-title').textContent = title;
    document.getElementById('org-edit-fields').innerHTML = fields;
    const m = document.getElementById('org-edit-modal');
    m.style.display = 'flex';
  }

  async function openSectorModal(sectorId) {
    const sectors = await EAS_Hierarchy.fetchSectors({ activeOnly: false });
    const s = sectorId ? sectors.find(x => x.id === sectorId) : null;
    const fields = `
      <label style="display:block;margin-bottom:4px;">Name *</label>
      <input id="org-f-name" type="text" value="${escapeHtml(s?.name || '')}" style="width:100%;padding:6px;margin-bottom:8px;">
      <label style="display:block;margin-bottom:4px;">Sector SPOC name</label>
      <input id="org-f-spoc-name" type="text" value="${escapeHtml(s?.sector_spoc_name || '')}" style="width:100%;padding:6px;margin-bottom:8px;">
      <label style="display:block;margin-bottom:4px;">Sector SPOC email (drives auto-promotion)</label>
      <input id="org-f-spoc-email" type="email" value="${escapeHtml(s?.sector_spoc_email || '')}" style="width:100%;padding:6px;margin-bottom:8px;">
      <label style="display:block;"><input id="org-f-active" type="checkbox" ${s?.is_active !== false ? 'checked' : ''}> Active</label>
    `;
    openModal(s ? `Edit Sector: ${s.name}` : 'New Sector', fields, { kind: 'sector', id: sectorId || null });
  }

  async function openUnitModal(unitId, parentSectorId) {
    let u = null;
    if (unitId) {
      const tree = await EAS_Hierarchy.fetchOrgTree({ activeOnly: false });
      for (const s of tree) for (const d of (s.departments||[])) if (d.id === unitId) u = d;
    }
    const sectors = await EAS_Hierarchy.fetchSectors({ activeOnly: false });
    const sectorOpts = sectors.map(s =>
      `<option value="${s.id}" ${ (u?.sector_id || parentSectorId) === s.id ? 'selected' : '' }>${escapeHtml(s.name)}</option>`
    ).join('');
    const fields = `
      <label style="display:block;margin-bottom:4px;">Sector *</label>
      <select id="org-f-sector" style="width:100%;padding:6px;margin-bottom:8px;">${sectorOpts}</select>
      <label style="display:block;margin-bottom:4px;">Name *</label>
      <input id="org-f-name" type="text" value="${escapeHtml(u?.name || '')}" style="width:100%;padding:6px;margin-bottom:8px;">
      <label style="display:block;margin-bottom:4px;">Unit SPOC name</label>
      <input id="org-f-spoc-name" type="text" value="${escapeHtml(u?.unit_spoc_name || '')}" style="width:100%;padding:6px;margin-bottom:8px;">
      <label style="display:block;margin-bottom:4px;">Unit SPOC email (drives auto-promotion)</label>
      <input id="org-f-spoc-email" type="email" value="${escapeHtml(u?.unit_spoc_email || '')}" style="width:100%;padding:6px;margin-bottom:8px;">
      <label style="display:block;"><input id="org-f-active" type="checkbox" ${u?.is_active !== false ? 'checked' : ''}> Active</label>
    `;
    openModal(u ? `Edit Unit: ${u.name}` : 'New Unit', fields, { kind: 'unit', id: unitId || null, parent_id: parentSectorId || u?.sector_id });
  }

  async function openPracticeModal(practiceId, parentUnitId) {
    let p = null;
    if (practiceId) {
      const tree = await EAS_Hierarchy.fetchOrgTree({ activeOnly: false });
      for (const s of tree) for (const d of (s.departments||[])) for (const pr of (d.practices||[])) if (pr.id === practiceId) p = pr;
    }
    const tree = await EAS_Hierarchy.fetchOrgTree({ activeOnly: false });
    const unitOpts = tree.flatMap(s => (s.departments||[]).map(d =>
      `<option value="${d.id}" ${ (p?.department_id || parentUnitId) === d.id ? 'selected' : '' }>${escapeHtml(s.name)} → ${escapeHtml(d.name)}</option>`
    )).join('');
    const fields = `
      <label style="display:block;margin-bottom:4px;">Unit *</label>
      <select id="org-f-unit" style="width:100%;padding:6px;margin-bottom:8px;">${unitOpts}</select>
      <label style="display:block;margin-bottom:4px;">Name *</label>
      <input id="org-f-name" type="text" value="${escapeHtml(p?.name || '')}" style="width:100%;padding:6px;margin-bottom:8px;">
      <label style="display:block;margin-bottom:4px;">Practice SPOC email (org-chart metadata; multi-SPOC table is authoritative)</label>
      <input id="org-f-spoc-email" type="email" value="${escapeHtml(p?.practice_spoc_email || '')}" style="width:100%;padding:6px;margin-bottom:8px;">
      <label style="display:block;"><input id="org-f-active" type="checkbox" ${p?.is_active !== false ? 'checked' : ''}> Active</label>
    `;
    openModal(p ? `Edit Practice: ${p.name}` : 'New Practice', fields, { kind: 'practice', id: practiceId || null, parent_id: parentUnitId || p?.department_id });
  }

  async function submitEdit() {
    if (!_editCtx) return;
    showError('');
    const btn = document.getElementById('org-edit-save-btn');
    btn.disabled = true;
    btn.textContent = 'Saving…';

    try {
      const name      = document.getElementById('org-f-name')?.value?.trim();
      const spocName  = document.getElementById('org-f-spoc-name')?.value?.trim() || '';
      const spocEmail = document.getElementById('org-f-spoc-email')?.value?.trim() || null;
      const isActive  = document.getElementById('org-f-active')?.checked;

      if (!name) { showError('Name is required.'); btn.disabled = false; btn.textContent = 'Save'; return; }

      let res;
      if (_editCtx.kind === 'sector') {
        res = await EAS_Hierarchy.upsertSector({
          id: _editCtx.id, name, sector_spoc_name: spocName, sector_spoc_email: spocEmail, is_active: isActive
        });
      } else if (_editCtx.kind === 'unit') {
        const sector_id = document.getElementById('org-f-sector')?.value;
        if (!sector_id) { showError('Sector is required.'); btn.disabled = false; btn.textContent = 'Save'; return; }
        res = await EAS_Hierarchy.upsertDepartment({
          id: _editCtx.id, name, sector_id, unit_spoc_name: spocName, unit_spoc_email: spocEmail, is_active: isActive
        });
      } else if (_editCtx.kind === 'practice') {
        const department_id = document.getElementById('org-f-unit')?.value;
        if (!department_id) { showError('Unit is required.'); btn.disabled = false; btn.textContent = 'Save'; return; }
        res = await EAS_Hierarchy.upsertPractice({
          id: _editCtx.id, name, department_id, practice_spoc_email: spocEmail, is_active: isActive
        });
      }

      if (res?.error) {
        showError('Save failed: ' + res.error.message);
        btn.disabled = false;
        btn.textContent = 'Save';
        return;
      }

      closeEditModal();
      await render();
    } catch (e) {
      showError('Unexpected error: ' + (e?.message || e));
      btn.disabled = false;
      btn.textContent = 'Save';
    }
  }

  // ---------- Page wiring ----------
  // Render when the Org Hierarchy page becomes active.
  function onPageChange(pageId) {
    if (pageId === 'manage-org-tree') render();
  }

  // Hook into admin.html's nav-item change. The existing pattern dispatches
  // hashchange, so we listen for hashchange and check the new hash.
  window.addEventListener('hashchange', () => {
    const h = (window.location.hash || '').replace('#', '');
    if (h === 'manage-org-tree') render();
  });

  // Also intercept clicks on the nav-item directly.
  document.addEventListener('click', (ev) => {
    const target = ev.target.closest('[data-page="manage-org-tree"]');
    if (target) setTimeout(render, 50);
  });

  // Initial render if the page is the active one on load.
  document.addEventListener('DOMContentLoaded', () => {
    const h = (window.location.hash || '').replace('#', '');
    if (h === 'manage-org-tree') render();
  });

  return {
    render,
    openSectorModal,
    openUnitModal,
    openPracticeModal,
    submitEdit,
    closeEditModal,
    onPageChange
  };
})();
