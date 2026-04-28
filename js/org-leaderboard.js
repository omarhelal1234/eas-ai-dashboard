// ============================================================
// EAS_OrgLeaderboard — Phase 3
// Three-tab leaderboard (Sector / Unit / Practice) backed by the
// get_org_leaderboard(p_level, p_quarter_id) RPC (sql/039).
// Tab state persisted in URL via ?lb=sector|unit|practice.
//
// Container element id: `org-leaderboard-root`. Idempotent render.
// ============================================================

const EAS_OrgLeaderboard = (() => {
  const sb = (typeof getSupabaseClient === 'function') ? getSupabaseClient() : null;
  let _quarterId = null;
  let _activeLevel = 'sector';

  function escapeHtml(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }
  function fmtHours(n) {
    if (n == null || isNaN(Number(n))) return '0';
    const v = Number(n);
    return v >= 100 ? Math.round(v).toLocaleString() : v.toFixed(1);
  }

  function getLevelFromUrl() {
    try {
      const u = new URL(window.location.href);
      const lb = u.searchParams.get('lb');
      if (lb === 'sector' || lb === 'unit' || lb === 'practice') return lb;
    } catch {}
    return 'sector';
  }

  function setLevelInUrl(level) {
    try {
      const u = new URL(window.location.href);
      u.searchParams.set('lb', level);
      window.history.replaceState(null, '', u.toString());
    } catch {}
  }

  function tabs(active) {
    const opts = ['sector', 'unit', 'practice'];
    return `
      <div role="tablist" style="display:flex;gap:4px;border-bottom:1px solid var(--border,#e5e7eb);margin-bottom:14px;">
        ${opts.map(lvl => `
          <button role="tab" aria-selected="${lvl === active}"
                  data-lb-tab="${lvl}"
                  style="padding:10px 18px;background:none;border:none;border-bottom:3px solid ${lvl === active ? 'var(--brand,#7c3aed)' : 'transparent'};font-weight:${lvl === active ? '700' : '500'};color:${lvl === active ? 'var(--text-primary,#111)' : 'var(--text-muted,#666)'};cursor:pointer;text-transform:capitalize;font-family:inherit;">
            ${lvl}
          </button>
        `).join('')}
      </div>
    `;
  }

  function tableHtml(rows, level) {
    if (!rows?.length) {
      return '<div style="padding:32px;text-align:center;color:var(--text-muted,#666);">No data yet at this level.</div>';
    }
    const head = `
      <thead>
        <tr style="background:var(--bg-section,#f9fafb);text-align:left;">
          <th style="padding:10px 12px;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-muted,#666);">Rank</th>
          <th style="padding:10px 12px;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-muted,#666);text-transform:capitalize;">${level}</th>
          <th style="padding:10px 12px;text-align:right;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-muted,#666);">Contributors</th>
          <th style="padding:10px 12px;text-align:right;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-muted,#666);">Tasks</th>
          <th style="padding:10px 12px;text-align:right;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-muted,#666);">Hours saved</th>
        </tr>
      </thead>
    `;
    const body = rows.map((r, i) => `
      <tr style="border-top:1px solid var(--border,#e5e7eb);">
        <td style="padding:10px 12px;font-weight:600;">${i + 1}</td>
        <td style="padding:10px 12px;">${escapeHtml(r.scope_name || '—')}</td>
        <td style="padding:10px 12px;text-align:right;">${r.contributors ?? 0}</td>
        <td style="padding:10px 12px;text-align:right;">${r.tasks ?? 0}</td>
        <td style="padding:10px 12px;text-align:right;font-weight:600;">${fmtHours(r.hours_saved)}</td>
      </tr>
    `).join('');
    return `<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:14px;">${head}<tbody>${body}</tbody></table></div>`;
  }

  async function render(rootEl, opts = {}) {
    const root = (typeof rootEl === 'string') ? document.getElementById(rootEl) : rootEl;
    if (!root) return;
    if (opts.quarterId !== undefined) _quarterId = opts.quarterId || null;

    _activeLevel = getLevelFromUrl();

    root.innerHTML = tabs(_activeLevel) + '<div style="padding:32px;text-align:center;color:var(--text-muted,#666);">Loading…</div>';

    const { data: rows, error } = await sb.rpc('get_org_leaderboard', { p_level: _activeLevel, p_quarter_id: _quarterId });
    if (error) {
      root.innerHTML = tabs(_activeLevel) + `<div style="padding:24px;color:#c0392b;">Failed to load: ${escapeHtml(error.message)}</div>`;
      return;
    }
    root.innerHTML = tabs(_activeLevel) + tableHtml(rows || [], _activeLevel);

    // Tab clicks
    root.querySelectorAll('[data-lb-tab]').forEach(btn => {
      btn.addEventListener('click', async () => {
        _activeLevel = btn.getAttribute('data-lb-tab');
        setLevelInUrl(_activeLevel);
        await render(root);
      });
    });
  }

  return { render, setQuarter(qid){ _quarterId = qid || null; } };
})();
