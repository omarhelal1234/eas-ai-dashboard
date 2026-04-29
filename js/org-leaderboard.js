// ============================================================
// EAS_OrgLeaderboard — Phase 3
// Three-tab leaderboard (Sector / Unit / Practice) backed by the
// get_org_leaderboard(p_level, p_quarter_id) RPC (sql/039).
// Tab state persisted in URL via ?lb=sector|unit|practice.
//
// Container element id: `org-leaderboard-root`. Idempotent render.
// Card-based layout matches Practice Rankings (.leaderboard-card,
// .leaderboard-tabs in css/dashboard.css).
// ============================================================

const EAS_OrgLeaderboard = (() => {
  const sb = (typeof getSupabaseClient === 'function') ? getSupabaseClient() : null;
  let _quarterId = null;
  let _activeLevel = 'sector';

  // Practice colors mirror src/pages/index.html `practiceColors`.
  // For sector/unit scope (no canonical color), hash the name into the
  // accent palette so each row stays visually stable across renders.
  const PRACTICE_COLORS = {
    'BFSI': '#3b82f6', 'CES': '#10b981', 'ERP': '#f59e0b',
    'EPS': '#8b5cf6', 'GRC': '#ec4899', 'EPCS': '#06b6d4'
  };
  const ACCENT_PALETTE = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4'];

  function escapeHtml(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }
  function fmtHours(n) {
    if (n == null || isNaN(Number(n))) return '0';
    const v = Number(n);
    return v >= 100 ? Math.round(v).toLocaleString() : v.toFixed(1);
  }
  function fmtScore(n) {
    if (n == null || isNaN(Number(n))) return '0';
    return Math.round(Number(n)).toLocaleString();
  }
  function fmtPct(v) {
    if (v == null || isNaN(Number(v))) return '—';
    return `${Number(v).toFixed(1)}%`;
  }
  function fmtNum(v) {
    if (v == null || isNaN(Number(v))) return '—';
    return Number(v).toFixed(2);
  }

  function colorFor(level, name) {
    if (level === 'practice') {
      // Match exact then prefix (e.g. "ERP Solutions" → ERP).
      if (PRACTICE_COLORS[name]) return PRACTICE_COLORS[name];
      const prefix = String(name || '').split(/\s+/)[0].toUpperCase();
      if (PRACTICE_COLORS[prefix]) return PRACTICE_COLORS[prefix];
    }
    let h = 0;
    for (const ch of String(name || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return ACCENT_PALETTE[h % ACCENT_PALETTE.length];
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

  function tabsHtml(active) {
    const opts = [
      { id: 'sector',   label: 'Sector' },
      { id: 'unit',     label: 'Unit'   },
      { id: 'practice', label: 'Practice' }
    ];
    // Segmented-button group (not WAI-ARIA tabs): aria-pressed is correct,
    // role="tab" / aria-selected would require roving tabindex + arrow-key
    // navigation + tabpanel linkage, which we don't implement here.
    return `
      <div class="leaderboard-tabs" role="group" aria-label="Org leaderboard scope">
        ${opts.map(o => `
          <button type="button"
                  data-lb-tab="${o.id}"
                  aria-pressed="${o.id === active}">
            ${o.label}
          </button>
        `).join('')}
      </div>
    `;
  }

  function rankBadge(i) {
    if (i === 0) return '🥇';
    if (i === 1) return '🥈';
    if (i === 2) return '🥉';
    return `#${i + 1}`;
  }

  function cardsHtml(rows, level) {
    if (!rows?.length) {
      return `<div class="leaderboard-card" style="opacity:0.65;justify-content:center">
        <div class="leaderboard-info" style="text-align:center">No data yet at this level.</div>
      </div>`;
    }
    return rows.map((r, i) => {
      const name = r.scope_name || '—';
      const color = colorFor(level, name);
      const eff = fmtPct(r.efficiency_pct);
      const qual = fmtNum(r.quality_avg);
      return `<div class="leaderboard-card" style="border-left:4px solid ${color}">
        <div class="leaderboard-rank">${rankBadge(i)}</div>
        <div class="leaderboard-info">
          <div class="leaderboard-name" style="color:${color}">${escapeHtml(name)}</div>
          <div class="leaderboard-stats">
            <span>${r.contributors ?? 0} contributors</span>
            <span>${r.tasks ?? 0} tasks</span>
            <span>${fmtHours(r.hours_saved)} hrs saved</span>
            <span>${eff} eff</span>
            <span>${qual === '—' ? '—' : qual + '/5'} quality</span>
          </div>
        </div>
        <div class="leaderboard-score" title="Weighted score (hours·0.4 + tasks·0.3 + eff·0.2 + quality·2)">${fmtScore(r.score)}</div>
      </div>`;
    }).join('');
  }

  function loadingHtml() {
    return `<div class="leaderboard-card" style="opacity:0.6;justify-content:center">
      <div class="leaderboard-info" style="text-align:center">Loading…</div>
    </div>`;
  }

  function errorHtml(msg) {
    return `<div class="leaderboard-card" style="border-left:4px solid var(--danger,#ef4444)">
      <div class="leaderboard-info" style="color:var(--danger,#ef4444)">Failed to load: ${escapeHtml(msg)}</div>
    </div>`;
  }

  function bindTabs(root) {
    root.querySelectorAll('[data-lb-tab]').forEach(btn => {
      btn.addEventListener('click', async () => {
        _activeLevel = btn.getAttribute('data-lb-tab');
        setLevelInUrl(_activeLevel);
        await render(root);
      });
    });
  }

  async function render(rootEl, opts = {}) {
    const root = (typeof rootEl === 'string') ? document.getElementById(rootEl) : rootEl;
    if (!root) return;
    if (opts.quarterId !== undefined) _quarterId = opts.quarterId || null;

    _activeLevel = getLevelFromUrl();
    root.innerHTML = tabsHtml(_activeLevel) + loadingHtml();
    bindTabs(root);

    if (!sb) {
      root.innerHTML = tabsHtml(_activeLevel) + errorHtml('Supabase client not initialized');
      bindTabs(root);
      return;
    }

    const { data: rows, error } = await sb.rpc('get_org_leaderboard', { p_level: _activeLevel, p_quarter_id: _quarterId });
    if (error) {
      root.innerHTML = tabsHtml(_activeLevel) + errorHtml(error.message);
      bindTabs(root);
      return;
    }
    root.innerHTML = tabsHtml(_activeLevel) + cardsHtml(rows || [], _activeLevel);
    bindTabs(root);
  }

  return { render, setQuarter(qid){ _quarterId = qid || null; } };
})();
