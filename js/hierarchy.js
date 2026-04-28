// ============================================================
// EAS_Hierarchy — shared cascading-dropdown + tree helpers
// Used by signup.html, profile-completion modal, and admin tree view.
// All reads go through Supabase; writes go through RPCs/policies.
// ============================================================

const EAS_Hierarchy = (() => {
  const sb = (typeof getSupabaseClient === 'function') ? getSupabaseClient() : null;

  let _sectorsCache = null;
  let _depsCache    = new Map(); // sector_id → departments[]
  let _pracsCache   = new Map(); // department_id → practices[]

  function _client() {
    if (!sb) throw new Error('EAS_Hierarchy: Supabase client not available');
    return sb;
  }

  // ---------- Reads ----------

  async function fetchSectors({ activeOnly = true } = {}) {
    if (_sectorsCache) return _sectorsCache;
    let q = _client().from('sectors').select('id, name, sector_spoc_name, sector_spoc_email, is_active').order('name');
    if (activeOnly) q = q.eq('is_active', true);
    const { data, error } = await q;
    if (error) { console.error('fetchSectors error:', error); return []; }
    _sectorsCache = data || [];
    return _sectorsCache;
  }

  async function fetchDepartmentsBySector(sectorId, { activeOnly = true } = {}) {
    if (!sectorId) return [];
    if (_depsCache.has(sectorId)) return _depsCache.get(sectorId);
    let q = _client().from('departments')
      .select('id, name, sector_id, unit_spoc_name, unit_spoc_email, is_active')
      .eq('sector_id', sectorId)
      .order('name');
    if (activeOnly) q = q.eq('is_active', true);
    const { data, error } = await q;
    if (error) { console.error('fetchDepartmentsBySector error:', error); return []; }
    _depsCache.set(sectorId, data || []);
    return data || [];
  }

  async function fetchPracticesByDepartment(deptId, { activeOnly = true } = {}) {
    if (!deptId) return [];
    if (_pracsCache.has(deptId)) return _pracsCache.get(deptId);
    let q = _client().from('practices')
      .select('id, name, department_id, practice_spoc_email, is_active')
      .eq('department_id', deptId)
      .order('name');
    if (activeOnly) q = q.eq('is_active', true);
    const { data, error } = await q;
    if (error) { console.error('fetchPracticesByDepartment error:', error); return []; }
    _pracsCache.set(deptId, data || []);
    return data || [];
  }

  /**
   * Fetch the entire tree in one query — useful for the admin view.
   * Returns sectors[].departments[].practices[].
   */
  async function fetchOrgTree({ activeOnly = false } = {}) {
    const [sectors, departments, practices] = await Promise.all([
      _client().from('sectors').select('*').order('name'),
      _client().from('departments').select('*').order('name'),
      _client().from('practices').select('*').order('name')
    ]);
    if (sectors.error)     { console.error('fetchOrgTree sectors error:', sectors.error); return []; }
    if (departments.error) { console.error('fetchOrgTree depts error:', departments.error); return []; }
    if (practices.error)   { console.error('fetchOrgTree practices error:', practices.error); return []; }

    const filterActive = (arr) => activeOnly ? arr.filter(r => r.is_active !== false) : arr;
    const tree = filterActive(sectors.data || []).map(s => ({
      ...s,
      departments: filterActive((departments.data || []).filter(d => d.sector_id === s.id))
        .map(d => ({
          ...d,
          practices: filterActive((practices.data || []).filter(p => p.department_id === d.id))
        }))
    }));
    return tree;
  }

  function clearCache() {
    _sectorsCache = null;
    _depsCache.clear();
    _pracsCache.clear();
  }

  // ---------- Cascading dropdown wiring ----------

  /**
   * Wire three <select> elements into a sector → unit → practice cascade.
   * Each level is filtered by the parent selection. When a level has no
   * children, it shows a locked "N/A — sector has no units" placeholder.
   *
   * opts:
   *   sectorEl   — required HTMLSelectElement
   *   unitEl     — required HTMLSelectElement
   *   practiceEl — required HTMLSelectElement
   *   onChange   — optional ({sectorId, departmentId, practice, practiceName}) => void
   *   initial    — optional { sectorId, departmentId, practice } to pre-select
   */
  async function attachCascade({ sectorEl, unitEl, practiceEl, onChange, initial } = {}) {
    if (!sectorEl || !unitEl || !practiceEl) {
      throw new Error('attachCascade: sectorEl, unitEl, practiceEl required');
    }

    const fire = () => {
      if (typeof onChange === 'function') {
        onChange({
          sectorId:     sectorEl.value || null,
          departmentId: unitEl.value === '__NA__' ? null : (unitEl.value || null),
          practice:     practiceEl.value === '__NA__' ? null : (practiceEl.value || null),
          practiceName: practiceEl.value === '__NA__' ? null : (practiceEl.value || null)
        });
      }
    };

    function reset(el, placeholderLabel) {
      el.innerHTML = '';
      const opt = document.createElement('option');
      opt.value = '';
      opt.disabled = true;
      opt.selected = true;
      opt.textContent = placeholderLabel;
      el.appendChild(opt);
    }

    function lockNA(el, label) {
      el.innerHTML = '';
      const opt = document.createElement('option');
      opt.value = '__NA__';
      opt.textContent = label;
      opt.selected = true;
      el.appendChild(opt);
    }

    // Step 1: populate sectors
    reset(sectorEl, 'Loading sectors…');
    const sectors = await fetchSectors();
    reset(sectorEl, 'Select your sector...');
    sectors.forEach(s => {
      const o = document.createElement('option');
      o.value = s.id; o.textContent = s.name;
      sectorEl.appendChild(o);
    });

    // Step 2: when sector changes, populate units
    async function onSectorChange() {
      const sid = sectorEl.value;
      reset(unitEl, 'Loading units…');
      reset(practiceEl, 'Select unit first…');
      if (!sid) { fire(); return; }
      const units = await fetchDepartmentsBySector(sid);
      if (!units.length) {
        lockNA(unitEl, 'N/A — sector has no units');
        lockNA(practiceEl, 'N/A — sector has no practices');
        fire();
        return;
      }
      reset(unitEl, 'Select your unit...');
      units.forEach(u => {
        const o = document.createElement('option');
        o.value = u.id; o.textContent = u.name;
        unitEl.appendChild(o);
      });
      fire();
    }
    sectorEl.addEventListener('change', onSectorChange);

    // Step 3: when unit changes, populate practices
    async function onUnitChange() {
      const uid = unitEl.value;
      reset(practiceEl, 'Loading practices…');
      if (!uid || uid === '__NA__') {
        lockNA(practiceEl, 'N/A — unit has no practices');
        fire();
        return;
      }
      const pracs = await fetchPracticesByDepartment(uid);
      if (!pracs.length) {
        lockNA(practiceEl, 'N/A — unit has no practices');
        fire();
        return;
      }
      reset(practiceEl, 'Select your practice...');
      pracs.forEach(p => {
        const o = document.createElement('option');
        o.value = p.name;          // backend keys on practice name (existing convention)
        o.dataset.practiceId = p.id;
        o.textContent = p.name;
        practiceEl.appendChild(o);
      });
      fire();
    }
    unitEl.addEventListener('change', onUnitChange);

    practiceEl.addEventListener('change', fire);

    // Initial selections (e.g. profile-completion modal pre-fill)
    if (initial?.sectorId) {
      sectorEl.value = initial.sectorId;
      await onSectorChange();
      if (initial.departmentId) {
        unitEl.value = initial.departmentId;
        await onUnitChange();
        if (initial.practice) practiceEl.value = initial.practice;
      }
    }
  }

  /**
   * Validate that the cascade selection is internally consistent + all required levels are picked.
   * Returns { ok: boolean, error: string|null, sectorId, departmentId, practice }.
   */
  function validateCascade(sectorEl, unitEl, practiceEl) {
    const sectorId = sectorEl?.value || null;
    if (!sectorId) return { ok: false, error: 'Please select your sector.' };

    const unitVal = unitEl?.value || '';
    const practiceVal = practiceEl?.value || '';

    const departmentId = unitVal === '__NA__' ? null : unitVal || null;
    const practice     = practiceVal === '__NA__' ? null : practiceVal || null;

    // Unit dropdown must be either a real unit, an N/A lock (which means no units exist), or empty (must pick).
    if (!unitVal && unitEl?.options?.length > 1) {
      return { ok: false, error: 'Please select your unit.' };
    }
    // Practice dropdown likewise.
    if (!practiceVal && practiceEl?.options?.length > 1) {
      return { ok: false, error: 'Please select your practice.' };
    }
    return { ok: true, error: null, sectorId, departmentId, practice };
  }

  // ---------- Admin write helpers ----------
  // Scoped writes are enforced by RLS + the admin/sector_spoc/dept_spoc role.
  // These helpers just wrap the table writes; the DB rejects unauthorised callers.

  async function upsertSector({ id, name, sector_spoc_name, sector_spoc_email, is_active }) {
    const payload = { name, sector_spoc_name: sector_spoc_name || '', sector_spoc_email: sector_spoc_email || null };
    if (typeof is_active === 'boolean') payload.is_active = is_active;
    if (id) {
      const { data, error } = await _client().from('sectors').update(payload).eq('id', id).select().single();
      if (!error) clearCache();
      return { data, error };
    } else {
      const { data, error } = await _client().from('sectors').insert(payload).select().single();
      if (!error) clearCache();
      return { data, error };
    }
  }

  async function upsertDepartment({ id, name, sector_id, unit_spoc_name, unit_spoc_email, is_active }) {
    const payload = { name, sector_id, unit_spoc_name: unit_spoc_name || '', unit_spoc_email: unit_spoc_email || null };
    if (typeof is_active === 'boolean') payload.is_active = is_active;
    if (id) {
      const { data, error } = await _client().from('departments').update(payload).eq('id', id).select().single();
      if (!error) clearCache();
      return { data, error };
    } else {
      const { data, error } = await _client().from('departments').insert(payload).select().single();
      if (!error) clearCache();
      return { data, error };
    }
  }

  async function upsertPractice({ id, name, department_id, practice_spoc_email, is_active }) {
    const payload = { name, department_id, practice_spoc_email: practice_spoc_email || null };
    if (typeof is_active === 'boolean') payload.is_active = is_active;
    if (id) {
      const { data, error } = await _client().from('practices').update(payload).eq('id', id).select().single();
      if (!error) clearCache();
      return { data, error };
    } else {
      const { data, error } = await _client().from('practices').insert(payload).select().single();
      if (!error) clearCache();
      return { data, error };
    }
  }

  return {
    fetchSectors,
    fetchDepartmentsBySector,
    fetchPracticesByDepartment,
    fetchOrgTree,
    clearCache,
    attachCascade,
    validateCascade,
    upsertSector,
    upsertDepartment,
    upsertPractice
  };
})();
