// ============================================================
// EAS AI Dashboard — Upcoming Events Modal (user-facing)
// Spec: docs/superpowers/specs/2026-04-24-upcoming-events-design.md
// ============================================================

const EventsModal = (() => {
  const sb = getSupabaseClient();
  let _opened = false; // guard: auto-open only once per page load

  // ---------- Helpers ----------

  const TZ = 'Asia/Riyadh';

  function formatRange(startIso, endIso) {
    const s = new Date(startIso), e = new Date(endIso);
    const dateFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
    const timeFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
    const sameDay = dateFmt.format(s) === dateFmt.format(e);
    if (sameDay) return `${dateFmt.format(s)} · ${timeFmt.format(s)} – ${timeFmt.format(e)} (Riyadh)`;
    return `${dateFmt.format(s)} ${timeFmt.format(s)} → ${dateFmt.format(e)} ${timeFmt.format(e)} (Riyadh)`;
  }

  function escapeHtml(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }

  // Minimal markdown: bold, line breaks, bullet lists, headings
  function renderMarkdown(md) {
    if (!md) return '';
    let html = escapeHtml(md);
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/^### (.*)$/gm, '<h4>$1</h4>');
    html = html.replace(/^## (.*)$/gm, '<h3>$1</h3>');
    // Group consecutive "- " lines into <ul>
    html = html.replace(/(?:^|\n)((?:- .+(?:\n|$))+)/g, (m, block) => {
      const items = block.trim().split(/\n/).map(l => `<li>${l.replace(/^- /, '')}</li>`).join('');
      return `\n<ul>${items}</ul>`;
    });
    html = html.split(/\n{2,}/).map(p => p.startsWith('<') ? p : `<p>${p.replace(/\n/g,'<br>')}</p>`).join('');
    return html;
  }

  const TYPE_LABELS = {
    ai_session: 'AI Session', summit: 'Summit', certification: 'Certification',
    workshop: 'Workshop', webinar: 'Webinar', other: 'Event'
  };
  const LOC_LABELS = {
    online: '🌐 Online', in_person: '📍 In-person', hybrid: '🔀 Hybrid'
  };

  // ---------- Data ----------

  async function fetchActive() {
    const { data, error } = await sb
      .from('v_active_events_for_user')
      .select('*')
      .order('start_datetime', { ascending: true });
    if (error) { console.warn('EventsModal fetch error:', error.message); return []; }
    return data || [];
  }

  async function fetchActiveCountForBell() {
    // Events the user has NOT registered for yet — drives the badge number.
    const { count, error } = await sb
      .from('v_active_events_for_user')
      .select('id', { count: 'exact', head: true })
      .eq('already_registered', false);
    if (error) return 0;
    return count || 0;
  }

  async function register(eventId) {
    const user = await EAS_Auth.getUserProfile();
    if (!user) return { ok: false, error: 'Not signed in' };
    const { error } = await sb
      .from('event_registrations')
      .insert({ event_id: eventId, user_id: user.id });
    if (error && !String(error.message).includes('duplicate')) {
      return { ok: false, error: error.message };
    }
    return { ok: true };
  }

  async function markExternalClicked(eventId) {
    const user = await EAS_Auth.getUserProfile();
    if (!user) return;
    await sb
      .from('event_registrations')
      .update({ external_link_clicked: true, external_clicked_at: new Date().toISOString() })
      .eq('event_id', eventId)
      .eq('user_id', user.id);
  }

  async function dismiss(eventId) {
    const user = await EAS_Auth.getUserProfile();
    if (!user) return;
    await sb
      .from('event_dismissals')
      .insert({ event_id: eventId, user_id: user.id });
  }

  // ---------- Rendering ----------

  function cardHtml(ev) {
    const cover = ev.cover_image_url
      ? `<div class="event-card-cover" style="background-image:url('${escapeHtml(ev.cover_image_url)}')">`
      : `<div class="event-card-cover type-${escapeHtml(ev.event_type)}">`;

    const deadlinePassed = ev.registration_deadline && new Date(ev.registration_deadline) < new Date();
    const registered = !!ev.already_registered;
    const registerDisabled = registered || deadlinePassed;
    const registerLabel = registered ? '✓ Registered' : deadlinePassed ? 'Registration closed' : 'Register';

    const venueLine = ev.location_type !== 'online' && ev.venue
      ? `<span>📌 ${escapeHtml(ev.venue)}</span>` : '';

    return `
      <div class="event-card" data-event-id="${ev.id}">
        ${cover}
          <div class="event-card-badges">
            <span class="event-type-badge">${escapeHtml(TYPE_LABELS[ev.event_type] || ev.event_type)}</span>
            <span class="event-location-badge">${LOC_LABELS[ev.location_type] || ev.location_type}</span>
          </div>
        </div>
        <div class="event-card-body">
          <div class="event-card-title">${escapeHtml(ev.title)}</div>
          <div class="event-card-meta">
            <span>🗓 ${escapeHtml(formatRange(ev.start_datetime, ev.end_datetime))}</span>
            ${venueLine}
          </div>
          <div class="event-card-desc">${escapeHtml(ev.short_description)}</div>
          ${ev.long_description ? `<button class="event-card-toggle" data-action="toggle-details">Show details ▾</button>` : ''}
        </div>
        ${ev.long_description ? `<div class="event-card-details" hidden>${renderMarkdown(ev.long_description)}</div>` : ''}
        <div class="event-card-actions">
          <button class="ev-btn ev-btn-primary" data-action="register" ${registerDisabled ? 'disabled' : ''}>
            ${registerLabel}
          </button>
          ${!ev.force_on_every_login ? `<button class="ev-btn ev-btn-ghost" data-action="dismiss">Dismiss</button>` : ''}
          ${ev.registration_url ? `<a class="ev-btn ev-btn-ghost" href="${escapeHtml(ev.registration_url)}" target="_blank" rel="noopener noreferrer" data-action="open-external">Open registration link ↗</a>` : ''}
        </div>
      </div>
    `;
  }

  function buildModal(events) {
    const wrap = document.createElement('div');
    wrap.className = 'events-modal-backdrop';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.innerHTML = `
      <div class="events-modal" role="document">
        <div class="events-modal-header">
          <h2>🔔 Upcoming Events <span class="events-badge-pill">${events.length}</span></h2>
          <button class="events-modal-close" aria-label="Close" data-action="close-modal">✕</button>
        </div>
        <div class="events-modal-body">
          ${events.length === 0
            ? `<div class="events-modal-empty">No upcoming events right now.<br>Check back soon — your admin will post new sessions here.</div>`
            : events.map(cardHtml).join('')}
        </div>
        ${events.length > 0 ? `
          <div class="events-modal-footer">
            <button class="ev-btn ev-btn-ghost" data-action="close-all">Close all</button>
          </div>
        ` : `
          <div class="events-modal-footer">
            <button class="ev-btn ev-btn-ghost" data-action="close-modal">Close</button>
          </div>
        `}
      </div>
    `;
    return wrap;
  }

  // ---------- Wiring ----------

  function attachHandlers(wrap, events) {
    const close = () => {
      wrap.remove();
      document.removeEventListener('keydown', escHandler);
      refreshBellBadge();
    };
    const escHandler = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', escHandler);

    wrap.addEventListener('click', async (e) => {
      if (e.target === wrap) { close(); return; }
      const action = e.target.dataset && e.target.dataset.action;
      if (!action) return;

      if (action === 'close-modal') { close(); return; }
      if (action === 'close-all') {
        // Dismiss every non-forced event shown, then close
        const nonForced = events.filter(ev => !ev.force_on_every_login && !ev.already_registered);
        await Promise.all(nonForced.map(ev => dismiss(ev.id)));
        close();
        return;
      }

      const card = e.target.closest('.event-card');
      if (!card) return;
      const eventId = card.dataset.eventId;
      const ev = events.find(x => x.id === eventId);
      if (!ev) return;

      if (action === 'toggle-details') {
        const details = card.querySelector('.event-card-details');
        if (details) {
          const nowHidden = details.hasAttribute('hidden');
          if (nowHidden) details.removeAttribute('hidden'); else details.setAttribute('hidden', '');
          e.target.textContent = nowHidden ? 'Hide details ▴' : 'Show details ▾';
        }
        return;
      }

      if (action === 'register') {
        e.target.disabled = true;
        e.target.textContent = 'Registering…';
        const res = await register(eventId);
        if (!res.ok) {
          e.target.disabled = false;
          e.target.textContent = 'Register';
          alert('Registration failed: ' + res.error);
          return;
        }
        ev.already_registered = true;
        e.target.textContent = '✓ Registered';
        e.target.classList.remove('ev-btn-primary');
        e.target.classList.add('ev-btn-success');
        if (ev.registration_url) {
          window.open(ev.registration_url, '_blank', 'noopener,noreferrer');
          await markExternalClicked(eventId);
        }
        return;
      }

      if (action === 'dismiss') {
        await dismiss(eventId);
        card.style.transition = 'opacity 0.2s, transform 0.2s';
        card.style.opacity = '0';
        card.style.transform = 'translateX(12px)';
        setTimeout(() => {
          card.remove();
          const remaining = wrap.querySelectorAll('.event-card').length;
          const pill = wrap.querySelector('.events-badge-pill');
          if (pill) pill.textContent = remaining;
          if (remaining === 0) close();
        }, 220);
        return;
      }

      if (action === 'open-external') {
        await markExternalClicked(eventId);
      }
    });
  }

  function openWith(events) {
    closeExisting();
    const wrap = buildModal(events);
    document.body.appendChild(wrap);
    attachHandlers(wrap, events);
  }

  function closeExisting() {
    const existing = document.querySelector('.events-modal-backdrop');
    if (existing) existing.remove();
  }

  // ---------- Public API ----------

  async function openForCurrentUser({ auto = false } = {}) {
    if (auto && _opened) return;
    _opened = true;
    const events = await fetchActive();
    if (auto && events.length === 0) return; // don't auto-open empty
    openWith(events);
  }

  async function openAll() {
    _opened = true;
    const events = await fetchActive();
    openWith(events);
  }

  async function refreshBellBadge() {
    const bell = document.querySelector('[data-events-bell]');
    if (!bell) return;
    const count = await fetchActiveCountForBell();
    const badge = bell.querySelector('.events-bell-badge');
    if (badge) badge.textContent = count;
    bell.classList.toggle('empty', count === 0);
    bell.setAttribute('title', count === 0 ? 'No upcoming events' : `${count} upcoming event${count === 1 ? '' : 's'}`);
  }

  function mountBell(container) {
    if (!container) return;
    if (container.querySelector('[data-events-bell]')) return;
    const bell = document.createElement('button');
    bell.type = 'button';
    bell.className = 'events-bell empty';
    bell.setAttribute('data-events-bell', '');
    bell.setAttribute('aria-label', 'Upcoming events');
    bell.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
        <path d="M13.73 21a2 2 0 01-3.46 0"></path>
      </svg>
      <span class="events-bell-badge">0</span>
    `;
    bell.addEventListener('click', () => openAll());
    container.appendChild(bell);
    refreshBellBadge();
  }

  return {
    openForCurrentUser,
    openAll,
    refreshBellBadge,
    mountBell
  };
})();
