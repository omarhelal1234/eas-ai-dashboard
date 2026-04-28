// ============================================================
// EAS Admin — Migration Orphans review (Phase 4)
// Surfaces rows that the 036 backfill couldn't resolve to a sector.
// Admin-only (RLS migration_orphans_admin_all from sql/040). Lets the
// admin pick a sector for each orphan and write the resolution back to
// the source table.
// ============================================================

const OrgOrphans = (() => {
  const sb = (typeof getSupabaseClient === 'function') ? getSupabaseClient() : null;
  let _orphans = [];
  let _sectors = [];

  function escapeHtml(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }
  function escapeAttr(s) { return escapeHtml(s); }

  async function fetch() {
    const [orphans, sectors] = await Promise.all([
      sb.from('migration_orphans').select('*').order('id'),
      EAS_Hierarchy.fetchSectors({ activeOnly: true })
    ]);
    if (orphans.error) {
      console.error('migration_orphans read failed:', orphans.error);
      return { orphans: [], sectors: [] };
    }
    return { orphans: orphans.data || [], sectors: sectors || [] };
  }

  function rowHtml(o) {
    const opts = _sectors.map(s =>
      `<option value="${escapeAttr(s.id)}">${escapeHtml(s.name)}</option>`
    ).join('');
    return `
      <tr data-orphan-id="${escapeAttr(o.id)}" style="border-top:1px solid var(--border, #e5e7eb);">
        <td style="padding:8px 12px;font-size:12px;color:var(--text-muted,#666);">${escapeHtml(o.id)}</td>
        <td style="padding:8px 12px;"><code>${escapeHtml(o.source_table || '')}</code></td>
        <td style="padding:8px 12px;font-family:monospace;font-size:11px;">${escapeHtml(o.source_id || '—')}</td>
        <td style="padding:8px 12px;">${escapeHtml(o.practice || '—')}</td>
        <td style="padding:8px 12px;font-family:monospace;font-size:11px;">${escapeHtml(o.department_id || '—')}</td>
        <td style="padding:8px 12px;font-size:12px;color:var(--text-muted,#666);">${escapeHtml(o.reason || '')}</td>
        <td style="padding:8px 12px;">
          <select data-orphan-sector style="padding:4px;font-family:inherit;">
            <option value="">— pick sector —</option>
            ${opts}
          </select>
        </td>
        <td style="padding:8px 12px;">
          <button class="btn btn-sm" data-orphan-action="resolve" data-orphan-id="${escapeAttr(o.id)}" style="padding:4px 10px;font-size:12px;">Resolve</button>
          <button class="btn btn-sm" data-orphan-action="dismiss" data-orphan-id="${escapeAttr(o.id)}" style="padding:4px 10px;font-size:12px;color:#c0392b;">Dismiss</button>
        </td>
      </tr>
    `;
  }

  async function render() {
    const root = document.getElementById('orphans-root');
    if (!root) return;
    root.innerHTML = '<div style="padding:24px;color:var(--text-muted,#666);">Loading…</div>';

    const { orphans, sectors } = await fetch();
    _orphans = orphans;
    _sectors = sectors;

    const countBadge = document.getElementById('admin-orphans-count');
    if (countBadge) countBadge.textContent = orphans.length;

    if (!orphans.length) {
      root.innerHTML = '<div style="padding:24px;color:var(--text-muted,#666);">No unresolved orphans. 🎉</div>';
      return;
    }

    root.innerHTML = `
      <div style="overflow-x:auto;background:var(--bg-card);border:1px solid var(--border,#e5e7eb);border-radius:8px;">
        <table style="width:100%;border-collapse:collapse;font-size:13px;">
          <thead style="background:var(--bg-section,#f9fafb);">
            <tr>
              <th style="padding:10px 12px;text-align:left;text-transform:uppercase;font-size:11px;letter-spacing:0.5px;color:var(--text-muted,#666);">#</th>
              <th style="padding:10px 12px;text-align:left;text-transform:uppercase;font-size:11px;letter-spacing:0.5px;color:var(--text-muted,#666);">Source table</th>
              <th style="padding:10px 12px;text-align:left;text-transform:uppercase;font-size:11px;letter-spacing:0.5px;color:var(--text-muted,#666);">Row id</th>
              <th style="padding:10px 12px;text-align:left;text-transform:uppercase;font-size:11px;letter-spacing:0.5px;color:var(--text-muted,#666);">Practice</th>
              <th style="padding:10px 12px;text-align:left;text-transform:uppercase;font-size:11px;letter-spacing:0.5px;color:var(--text-muted,#666);">Dept</th>
              <th style="padding:10px 12px;text-align:left;text-transform:uppercase;font-size:11px;letter-spacing:0.5px;color:var(--text-muted,#666);">Reason</th>
              <th style="padding:10px 12px;text-align:left;text-transform:uppercase;font-size:11px;letter-spacing:0.5px;color:var(--text-muted,#666);">Assign sector</th>
              <th style="padding:10px 12px;text-align:left;text-transform:uppercase;font-size:11px;letter-spacing:0.5px;color:var(--text-muted,#666);">Action</th>
            </tr>
          </thead>
          <tbody>${orphans.map(rowHtml).join('')}</tbody>
        </table>
      </div>
    `;
  }

  async function resolve(orphanId) {
    const row = document.querySelector(`tr[data-orphan-id="${CSS.escape(String(orphanId))}"]`);
    if (!row) return;
    const sectorEl = row.querySelector('[data-orphan-sector]');
    const sectorId = sectorEl?.value;
    if (!sectorId) { alert('Pick a sector first.'); return; }

    const orphan = _orphans.find(o => String(o.id) === String(orphanId));
    if (!orphan) return;

    if (!orphan.source_table || !orphan.source_id) {
      alert('Cannot resolve: missing source_table or source_id.');
      return;
    }

    // Whitelist source tables — RLS will also reject anything else, but this saves a round-trip.
    const allowed = new Set(['users','tasks','accomplishments','copilot_users','projects','submission_approvals','use_cases','prompt_library','practice_spoc','departments']);
    if (!allowed.has(orphan.source_table)) {
      alert('Unsupported source table: ' + orphan.source_table);
      return;
    }

    const btn = row.querySelector('[data-orphan-action="resolve"]');
    btn.disabled = true; btn.textContent = '…';

    try {
      const { error } = await sb
        .from(orphan.source_table)
        .update({ sector_id: sectorId })
        .eq('id', orphan.source_id);
      if (error) {
        alert('Failed to update ' + orphan.source_table + ': ' + error.message);
        btn.disabled = false; btn.textContent = 'Resolve';
        return;
      }
      // Remove the orphan row (admin-only RLS allows DELETE).
      await sb.from('migration_orphans').delete().eq('id', orphan.id);
      await render();
    } catch (e) {
      alert('Unexpected error: ' + (e?.message || e));
      btn.disabled = false; btn.textContent = 'Resolve';
    }
  }

  async function dismiss(orphanId) {
    if (!confirm('Dismiss this orphan without resolving? The source row will keep sector_id = NULL.')) return;
    const { error } = await sb.from('migration_orphans').delete().eq('id', orphanId);
    if (error) { alert('Failed to dismiss: ' + error.message); return; }
    await render();
  }

  document.addEventListener('click', (ev) => {
    const target = ev.target.closest('[data-orphan-action]');
    if (!target) return;
    const action = target.getAttribute('data-orphan-action');
    const id = target.getAttribute('data-orphan-id');
    if (action === 'resolve') resolve(id);
    else if (action === 'dismiss') dismiss(id);
  });

  window.addEventListener('hashchange', () => {
    const h = (window.location.hash || '').replace('#', '');
    if (h === 'manage-orphans') render();
  });
  document.addEventListener('click', (ev) => {
    const target = ev.target.closest('[data-page="manage-orphans"]');
    if (target) setTimeout(render, 50);
  });

  return { render };
})();
