// ============================================================
// EAS Admin — Org Hierarchy tree view (Phases 2 + 4)
// Renders sectors → units → practices with role-scoped edit rights:
//   * admin       — edit everything, drag-to-reparent any node
//   * sector_spoc — edit only their sector's units/practices, drag within sector
//   * dept_spoc   — edit only their unit's practices, drag practices within unit
// Read-only rendering for everyone else.
//
// Phase 4 changes (codex review fallout):
//   * Inline onclick / onkeypress replaced with event delegation + data-attrs (XSS hygiene).
//   * `+ Unit` / `+ Practice` buttons now correctly preselect the parent (was a bug:
//      row.id was passed as the FIRST positional arg → opened a malformed edit modal).
//   * Brand color picker on sector edit modal (sectors.brand_color).
//   * HTML5 drag-and-drop reparenting via move_unit / move_practice RPCs.
// ============================================================

const OrgTree = (() => {
  const sb = (typeof getSupabaseClient === 'function') ? getSupabaseClient() : null;
  let _profile = null;
  let _editCtx = null; // { kind: 'sector'|'unit'|'practice', id?, parent_id? }

  function escapeHtml(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }
  function escapeAttr(s) {
    // For attribute values — same as escapeHtml but explicit so intent is clear.
    return escapeHtml(s);
  }

  // ---------- Permissions ----------
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
  // Drag eligibility (move source). Destination eligibility is checked again on drop.
  function canDragUnit(unit) {
    if (!_profile) return false;
    if (_profile.role === 'admin') return true;
    if (_profile.role === 'sector_spoc' && unit.sector_id === _profile.sector_id) return true;
    return false;
  }
  function canDragPractice(practice, unit) {
    if (!_profile) return false;
    if (_profile.role === 'admin') return true;
    if (_profile.role === 'sector_spoc' && unit?.sector_id === _profile.sector_id) return true;
    if (_profile.role === 'dept_spoc' && practice.department_id === _profile.department_id) return true;
    return false;
  }

  // ---------- Row rendering ----------
  function rowStyle(level) {
    const indent = level * 24;
    return `padding:8px 12px 8px ${indent + 12}px;border-bottom:1px solid var(--border, #eee);display:flex;align-items:center;gap:12px;`;
  }
  function dimIfInactive(active) {
    return active === false ? 'opacity:0.45;' : '';
  }

  function rowHtml(kind, row, opts = {}) {
    const { level = 0, parent } = opts;
    const editable = (kind === 'sector') ? canEditSector(row)
                    : (kind === 'unit')  ? canEditUnit(row)
                    : canEditPractice(row, parent);

    const isDraggable = (kind === 'unit' && canDragUnit(row))
                     || (kind === 'practice' && canDragPractice(row, parent));

    const addChildBtn = (kind === 'sector' && canAddUnitTo(row))
                      ? `<button class="btn btn-sm" data-org-action="add-unit" data-parent-id="${escapeAttr(row.id)}" style="padding:2px 8px;font-size:12px;">+ Unit</button>`
                      : (kind === 'unit' && canAddPracticeTo(row))
                      ? `<button class="btn btn-sm" data-org-action="add-practice" data-parent-id="${escapeAttr(row.id)}" style="padding:2px 8px;font-size:12px;">+ Practice</button>`
                      : '';
    const editBtn = editable
      ? `<button class="btn btn-sm" data-org-action="edit-${kind}" data-row-id="${escapeAttr(row.id)}" style="padding:2px 8px;font-size:12px;">Edit</button>`
      : '';

    const spocLabel = kind === 'sector' ? (row.sector_spoc_name || row.sector_spoc_email || '—')
                    : kind === 'unit'   ? (row.unit_spoc_name   || row.unit_spoc_email   || '—')
                    : (row.practice_spoc_email || '—');
    const inactiveTag = row.is_active === false ? '<span style="font-size:11px;color:#c0392b;background:#fde8e8;padding:1px 6px;border-radius:4px;">inactive</span>' : '';
    const kindLabel = kind === 'sector' ? 'SECTOR' : kind === 'unit' ? 'UNIT' : 'PRACTICE';
    const defaultColor = kind === 'sector' ? '#7c3aed' : kind === 'unit' ? '#2563eb' : '#059669';
    // Defense-in-depth: validate brand_color matches the hex regex before injecting into a style
    // attribute, even though sectors_brand_color_chk enforces it server-side. Migrations or
    // direct SQL access could still seed bad values; this guard prevents an XSS break-out.
    const kindColor = (kind === 'sector' && row.brand_color && /^#[0-9A-Fa-f]{6}$/.test(row.brand_color))
      ? row.brand_color
      : defaultColor;

    const dragAttrs = isDraggable
      ? `draggable="true" data-drag-kind="${kind}" data-drag-id="${escapeAttr(row.id)}" data-drag-parent="${escapeAttr(parent?.id || '')}" data-drag-sector="${escapeAttr(parent?.sector_id || row.sector_id || '')}"`
      : '';
    const dropAttrs = (kind === 'sector') ? `data-drop-target="sector" data-drop-id="${escapeAttr(row.id)}"`
                    : (kind === 'unit')  ? `data-drop-target="unit"   data-drop-id="${escapeAttr(row.id)}"`
                    : '';

    return `
      <div class="org-row" ${dragAttrs} ${dropAttrs} style="${rowStyle(level)}${dimIfInactive(row.is_active)}${isDraggable ? 'cursor:grab;' : ''}">
        <span style="font-size:10px;font-weight:700;color:white;background:${kindColor};padding:2px 6px;border-radius:3px;width:62px;text-align:center;">${kindLabel}</span>
        <strong style="flex:1;">${escapeHtml(row.name)}</strong>
        <span style="font-size:12px;color:var(--text-muted, #666);">${escapeHtml(spocLabel)}</span>
        ${inactiveTag}
        <span style="display:flex;gap:6px;">${addChildBtn}${editBtn}</span>
      </div>
    `;
  }

  async function render() {
    const container = document.getElementById('org-tree-container');
    if (!container) return;
    container.innerHTML = '<div style="padding:24px;color:var(--text-muted, #888);">Loading hierarchy…</div>';

    _profile = (typeof EAS_Auth !== 'undefined') ? await EAS_Auth.getUserProfile() : null;
    EAS_Hierarchy.clearCache();
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
        const unitRow = rowHtml('unit', u, { level: 1, parent: s });
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

    wireDragDrop(container);
  }

  // ---------- Drag-to-reparent ----------
  // Listeners are bound ONCE per container; render() replaces innerHTML but
  // keeps the same container DOM node, so we guard against re-binding to
  // avoid duplicate confirms/RPC dispatches (codex Phase 4 [HIGH]).
  let _dragInflight = false;
  function wireDragDrop(container) {
    if (container.__easDragWired) return;
    container.__easDragWired = true;
    let _drag = null; // { kind, id, parent_id, sector_id }

    container.addEventListener('dragstart', (e) => {
      const row = e.target.closest('[data-drag-id]');
      if (!row) return;
      _drag = {
        kind:      row.getAttribute('data-drag-kind'),
        id:        row.getAttribute('data-drag-id'),
        parent_id: row.getAttribute('data-drag-parent') || null,
        sector_id: row.getAttribute('data-drag-sector') || null
      };
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', _drag.id); } catch (_) {}
      row.style.opacity = '0.5';
    });

    container.addEventListener('dragend', (e) => {
      const row = e.target.closest('[data-drag-id]');
      if (row) row.style.opacity = '';
      // Clear any drop-target outlines left behind by dragover/dragleave races.
      container.querySelectorAll('[data-drop-target]').forEach(el => el.style.outline = '');
      _drag = null;
    });

    container.addEventListener('dragover', (e) => {
      if (!_drag) return;
      const drop = e.target.closest('[data-drop-target]');
      if (!drop) return;
      const dropKind = drop.getAttribute('data-drop-target');
      // Units can be dropped onto sectors; practices onto units. No cross.
      if ((_drag.kind === 'unit' && dropKind !== 'sector') ||
          (_drag.kind === 'practice' && dropKind !== 'unit')) return;
      e.preventDefault();
      drop.style.outline = '2px dashed var(--brand, #7c3aed)';
    });

    container.addEventListener('dragleave', (e) => {
      const drop = e.target.closest('[data-drop-target]');
      if (drop) drop.style.outline = '';
    });

    container.addEventListener('drop', async (e) => {
      const drop = e.target.closest('[data-drop-target]');
      if (!drop || !_drag) return;
      e.preventDefault();
      drop.style.outline = '';
      const dropId = drop.getAttribute('data-drop-id');
      if (!dropId || dropId === _drag.parent_id) { _drag = null; return; }
      if (_dragInflight) { _drag = null; return; }
      _dragInflight = true;

      try {
        let res;
        if (_drag.kind === 'unit') {
          if (!confirm('Move this unit to the new sector?')) { _drag = null; return; }
          res = await EAS_Hierarchy.moveUnit(_drag.id, dropId);
        } else if (_drag.kind === 'practice') {
          if (!confirm('Move this practice to the new unit?')) { _drag = null; return; }
          res = await EAS_Hierarchy.movePractice(_drag.id, dropId);
        }
        if (res?.error || (res?.data && res.data.success === false)) {
          alert('Move failed: ' + (res?.error?.message || res?.data?.error || 'unknown error'));
        } else {
          await render();
        }
      } catch (err) {
        alert('Move failed: ' + (err?.message || err));
      } finally {
        _drag = null;
        _dragInflight = false;
      }
    });
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
    const brand = s?.brand_color || '#7c3aed';
    const fields = `
      <label style="display:block;margin-bottom:4px;">Name *</label>
      <input id="org-f-name" type="text" value="${escapeAttr(s?.name || '')}" style="width:100%;padding:6px;margin-bottom:8px;">
      <label style="display:block;margin-bottom:4px;">Sector SPOC name</label>
      <input id="org-f-spoc-name" type="text" value="${escapeAttr(s?.sector_spoc_name || '')}" style="width:100%;padding:6px;margin-bottom:8px;">
      <label style="display:block;margin-bottom:4px;">Sector SPOC email (drives auto-promotion)</label>
      <input id="org-f-spoc-email" type="email" value="${escapeAttr(s?.sector_spoc_email || '')}" style="width:100%;padding:6px;margin-bottom:8px;">
      <label style="display:block;margin-bottom:4px;">Brand color (used for sector tiles + breadcrumbs)</label>
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;">
        <input id="org-f-brand-color" type="color" value="${escapeAttr(brand)}" style="width:48px;height:32px;padding:0;border:1px solid var(--border, #ccc);">
        <input id="org-f-brand-color-text" type="text" value="${escapeAttr(brand)}" placeholder="#7c3aed" pattern="^#[0-9A-Fa-f]{6}$" style="flex:1;padding:6px;font-family:monospace;">
      </div>
      <label style="display:block;"><input id="org-f-active" type="checkbox" ${s?.is_active !== false ? 'checked' : ''}> Active</label>
    `;
    openModal(s ? `Edit Sector: ${s.name}` : 'New Sector', fields, { kind: 'sector', id: sectorId || null });
    // wire color/text two-way
    const colorEl = document.getElementById('org-f-brand-color');
    const textEl  = document.getElementById('org-f-brand-color-text');
    colorEl?.addEventListener('input', () => textEl.value = colorEl.value);
    textEl?.addEventListener('input', () => {
      if (/^#[0-9A-Fa-f]{6}$/.test(textEl.value)) colorEl.value = textEl.value;
    });
  }

  async function openUnitModal(unitId, parentSectorId) {
    let u = null;
    if (unitId) {
      const tree = await EAS_Hierarchy.fetchOrgTree({ activeOnly: false });
      for (const s of tree) for (const d of (s.departments||[])) if (d.id === unitId) u = d;
    }
    const sectors = await EAS_Hierarchy.fetchSectors({ activeOnly: false });
    const sectorOpts = sectors.map(s => {
      const selected = (u?.sector_id || parentSectorId) === s.id ? 'selected' : '';
      return `<option value="${escapeAttr(s.id)}" ${selected}>${escapeHtml(s.name)}</option>`;
    }).join('');
    const fields = `
      <label style="display:block;margin-bottom:4px;">Sector *</label>
      <select id="org-f-sector" style="width:100%;padding:6px;margin-bottom:8px;">${sectorOpts}</select>
      <label style="display:block;margin-bottom:4px;">Name *</label>
      <input id="org-f-name" type="text" value="${escapeAttr(u?.name || '')}" style="width:100%;padding:6px;margin-bottom:8px;">
      <label style="display:block;margin-bottom:4px;">Unit SPOC name</label>
      <input id="org-f-spoc-name" type="text" value="${escapeAttr(u?.unit_spoc_name || '')}" style="width:100%;padding:6px;margin-bottom:8px;">
      <label style="display:block;margin-bottom:4px;">Unit SPOC email (drives auto-promotion)</label>
      <input id="org-f-spoc-email" type="email" value="${escapeAttr(u?.unit_spoc_email || '')}" style="width:100%;padding:6px;margin-bottom:8px;">
      <label style="display:block;"><input id="org-f-active" type="checkbox" ${u?.is_active !== false ? 'checked' : ''}> Active</label>
    `;
    openModal(u ? `Edit Unit: ${u.name}` : 'New Unit', fields, { kind: 'unit', id: unitId || null, parent_id: parentSectorId || u?.sector_id });
  }

  async function openPracticeModal(practiceId, parentUnitId) {
    let p = null;
    const tree = await EAS_Hierarchy.fetchOrgTree({ activeOnly: false });
    if (practiceId) {
      for (const s of tree) for (const d of (s.departments||[])) for (const pr of (d.practices||[])) if (pr.id === practiceId) p = pr;
    }
    const unitOpts = tree.flatMap(s => (s.departments||[]).map(d => {
      const selected = (p?.department_id || parentUnitId) === d.id ? 'selected' : '';
      return `<option value="${escapeAttr(d.id)}" ${selected}>${escapeHtml(s.name)} → ${escapeHtml(d.name)}</option>`;
    })).join('');
    const fields = `
      <label style="display:block;margin-bottom:4px;">Unit *</label>
      <select id="org-f-unit" style="width:100%;padding:6px;margin-bottom:8px;">${unitOpts}</select>
      <label style="display:block;margin-bottom:4px;">Name *</label>
      <input id="org-f-name" type="text" value="${escapeAttr(p?.name || '')}" style="width:100%;padding:6px;margin-bottom:8px;">
      <label style="display:block;margin-bottom:4px;">Practice SPOC email (org-chart metadata; multi-SPOC table is authoritative)</label>
      <input id="org-f-spoc-email" type="email" value="${escapeAttr(p?.practice_spoc_email || '')}" style="width:100%;padding:6px;margin-bottom:8px;">
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
        const brandColorRaw = document.getElementById('org-f-brand-color-text')?.value?.trim();
        const brandColor = (brandColorRaw && /^#[0-9A-Fa-f]{6}$/.test(brandColorRaw)) ? brandColorRaw : null;
        if (brandColorRaw && !brandColor) {
          showError('Brand color must be a 6-digit hex like #7c3aed.');
          btn.disabled = false; btn.textContent = 'Save'; return;
        }
        res = await EAS_Hierarchy.upsertSector({
          id: _editCtx.id, name, sector_spoc_name: spocName, sector_spoc_email: spocEmail,
          is_active: isActive, brand_color: brandColor
        });
      } else if (_editCtx.kind === 'unit') {
        const sector_id = document.getElementById('org-f-sector')?.value;
        if (!sector_id) { showError('Sector is required.'); btn.disabled = false; btn.textContent = 'Save'; return; }

        // If editing an existing unit and the sector changed, route the parent change through
        // move_unit (sql/044) — that RPC enforces destination scope server-side. Then upsert
        // the rest of the metadata. Fixes codex finding: sector_spoc/dept_spoc could try to
        // bypass the move RPC by using the generic upsert path.
        if (_editCtx.id) {
          const tree = await EAS_Hierarchy.fetchOrgTree({ activeOnly: false });
          let oldSectorId = null;
          for (const s of tree) for (const d of (s.departments || [])) if (d.id === _editCtx.id) oldSectorId = d.sector_id;
          if (oldSectorId && oldSectorId !== sector_id) {
            const moveRes = await EAS_Hierarchy.moveUnit(_editCtx.id, sector_id);
            if (moveRes?.error || (moveRes?.data && moveRes.data.success === false)) {
              showError('Reparent failed: ' + (moveRes?.error?.message || moveRes?.data?.error || 'unknown'));
              btn.disabled = false; btn.textContent = 'Save'; return;
            }
          }
        }
        res = await EAS_Hierarchy.upsertDepartment({
          id: _editCtx.id, name, sector_id, unit_spoc_name: spocName, unit_spoc_email: spocEmail, is_active: isActive
        });
      } else if (_editCtx.kind === 'practice') {
        const department_id = document.getElementById('org-f-unit')?.value;
        if (!department_id) { showError('Unit is required.'); btn.disabled = false; btn.textContent = 'Save'; return; }

        // Same parent-change routing for practices via move_practice RPC.
        if (_editCtx.id) {
          const tree = await EAS_Hierarchy.fetchOrgTree({ activeOnly: false });
          let oldDeptId = null;
          for (const s of tree) for (const d of (s.departments || [])) for (const p of (d.practices || [])) if (p.id === _editCtx.id) oldDeptId = p.department_id;
          if (oldDeptId && oldDeptId !== department_id) {
            const moveRes = await EAS_Hierarchy.movePractice(_editCtx.id, department_id);
            if (moveRes?.error || (moveRes?.data && moveRes.data.success === false)) {
              showError('Reparent failed: ' + (moveRes?.error?.message || moveRes?.data?.error || 'unknown'));
              btn.disabled = false; btn.textContent = 'Save'; return;
            }
          }
        }
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

  // ---------- Event delegation (replaces inline onclicks for XSS hygiene) ----------
  function wireActionDelegation() {
    document.addEventListener('click', (ev) => {
      const target = ev.target.closest('[data-org-action]');
      if (!target) return;
      const action = target.getAttribute('data-org-action');
      const rowId  = target.getAttribute('data-row-id');
      const parentId = target.getAttribute('data-parent-id');
      switch (action) {
        case 'edit-sector':   openSectorModal(rowId);          break;
        case 'edit-unit':     openUnitModal(rowId);            break;
        case 'edit-practice': openPracticeModal(rowId);        break;
        case 'add-unit':      openUnitModal(null, parentId);   break;
        case 'add-practice':  openPracticeModal(null, parentId); break;
      }
    });
  }
  wireActionDelegation();

  // ---------- Page wiring ----------
  window.addEventListener('hashchange', () => {
    const h = (window.location.hash || '').replace('#', '');
    if (h === 'manage-org-tree') render();
  });
  document.addEventListener('click', (ev) => {
    const target = ev.target.closest('[data-page="manage-org-tree"]');
    if (target) setTimeout(render, 50);
  });
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
    closeEditModal
  };
})();

// Expose to global scope so inline `onclick="OrgTree.foo()"` handlers in
// admin.html (Add Sector / Cancel / Save) can resolve the binding. Classic
// scripts declared with `const` are not added to window, but inline event
// handlers run in a scope chain that only sees globals — without this they
// fail silently with ReferenceError. Static handlers with no interpolation
// have no XSS risk.
window.OrgTree = OrgTree;
