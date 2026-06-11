// ============================================================
// EAS AI Dashboard — Admin Events Tab
// Spec: docs/superpowers/specs/2026-04-24-upcoming-events-design.md
// ============================================================

const AdminEvents = (() => {
  const sb = getSupabaseClient();
  let _container = null;
  let _filter = 'upcoming'; // upcoming | past | drafts | all
  let _search = '';
  let _view = 'list';       // list | form | registrations
  let _editing = null;      // event being edited (null = new)
  let _regsContext = null;  // event whose registrations we're viewing

  const TYPES = [
    ['ai_session', 'AI Session'], ['summit', 'Summit'],
    ['certification', 'Certification'], ['workshop', 'Workshop'],
    ['webinar', 'Webinar'], ['other', 'Other']
  ];
  const LOCS = [['online', 'Online'], ['in_person', 'In-person'], ['hybrid', 'Hybrid']];
  const TZ = 'Asia/Riyadh';

  function escapeHtml(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }
  function fmtDate(iso) {
    if (!iso) return '';
    return new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
  }
  function toLocalInputValue(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  // ---------- Data ----------

  async function fetchAll() {
    const { data, error } = await sb
      .from('events')
      .select('*')
      .order('start_datetime', { ascending: false });
    if (error) { console.error('AdminEvents.fetchAll:', error.message); return []; }
    return data || [];
  }

  async function fetchRsvpCounts() {
    const { data, error } = await sb
      .from('event_registrations')
      .select('event_id');
    if (error) return {};
    const counts = {};
    (data || []).forEach(r => { counts[r.event_id] = (counts[r.event_id] || 0) + 1; });
    return counts;
  }

  async function saveEvent(payload) {
    const row = {
      title: payload.title.trim(),
      short_description: payload.short_description.trim(),
      long_description: payload.long_description || null,
      event_type: payload.event_type,
      location_type: payload.location_type,
      venue: payload.venue || null,
      start_datetime: new Date(payload.start_datetime).toISOString(),
      end_datetime: new Date(payload.end_datetime).toISOString(),
      registration_url: payload.registration_url || null,
      registration_deadline: payload.registration_deadline ? new Date(payload.registration_deadline).toISOString() : null,
      cover_image_url: payload.cover_image_url || null,
      force_on_every_login: !!payload.force_on_every_login,
      is_published: !!payload.is_published
    };
    if (_editing && _editing.id) {
      const { error } = await sb.from('events').update(row).eq('id', _editing.id);
      return { ok: !error, error: error?.message };
    }
    const user = await EAS_Auth.getUser();
    row.created_by = user?.id || null;
    const { error } = await sb.from('events').insert(row);
    return { ok: !error, error: error?.message };
  }

  async function deleteEvent(id) {
    const { error } = await sb.from('events').delete().eq('id', id);
    return { ok: !error, error: error?.message };
  }

  async function duplicateEvent(ev) {
    const copy = { ...ev, id: undefined, created_at: undefined, updated_at: undefined, is_published: false, title: ev.title + ' (copy)' };
    delete copy.id; delete copy.created_at; delete copy.updated_at;
    const user = await EAS_Auth.getUser();
    copy.created_by = user?.id || null;
    const { error } = await sb.from('events').insert(copy);
    return { ok: !error, error: error?.message };
  }

  async function togglePublish(ev) {
    const { error } = await sb.from('events').update({ is_published: !ev.is_published }).eq('id', ev.id);
    return { ok: !error, error: error?.message };
  }

  async function fetchRegistrations(eventId) {
    const { data, error } = await sb
      .from('event_registrations')
      .select('id, registered_at, external_link_clicked, external_clicked_at, user:users(id, name, email, practice, role)')
      .eq('event_id', eventId)
      .order('registered_at', { ascending: false });
    if (error) { console.error(error.message); return []; }
    return data || [];
  }

  // ---------- Rendering: list ----------

  async function renderList() {
    _view = 'list';
    _editing = null;
    _regsContext = null;

    const [events, counts] = await Promise.all([fetchAll(), fetchRsvpCounts()]);

    const now = new Date();
    const filtered = events.filter(ev => {
      if (_search && !ev.title.toLowerCase().includes(_search.toLowerCase())) return false;
      if (_filter === 'upcoming') return ev.is_published && new Date(ev.end_datetime) > now;
      if (_filter === 'past')     return new Date(ev.end_datetime) <= now;
      if (_filter === 'drafts')   return !ev.is_published;
      return true;
    });

    const filterBtn = (key, label) =>
      `<button class="filter-btn ${_filter === key ? 'active' : ''}" data-filter="${key}">${label}</button>`;

    _container.innerHTML = `
      <div class="events-admin-toolbar">
        <div class="filters">
          ${filterBtn('upcoming','Upcoming')}
          ${filterBtn('past','Past')}
          ${filterBtn('drafts','Drafts')}
          ${filterBtn('all','All')}
        </div>
        <div style="display:flex;gap:10px;align-items:center">
          <input type="search" id="ae-search" placeholder="Search title…" value="${escapeHtml(_search)}">
          <button class="ev-btn ev-btn-primary" data-action="new">+ New Event</button>
        </div>
      </div>

      <table class="events-admin-table">
        <thead>
          <tr>
            <th>Title</th><th>Type</th><th>Start</th><th>End</th><th>Location</th>
            <th>Status</th><th>Force</th><th>RSVPs</th><th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${filtered.length === 0
            ? `<tr><td colspan="9" style="text-align:center;padding:30px;color:var(--text-secondary)">No events match this filter.</td></tr>`
            : filtered.map(ev => `
              <tr data-event-id="${ev.id}">
                <td><strong>${escapeHtml(ev.title)}</strong></td>
                <td>${escapeHtml((TYPES.find(t => t[0] === ev.event_type) || [,ev.event_type])[1])}</td>
                <td>${escapeHtml(fmtDate(ev.start_datetime))}</td>
                <td>${escapeHtml(fmtDate(ev.end_datetime))}</td>
                <td>${escapeHtml((LOCS.find(l => l[0] === ev.location_type) || [,ev.location_type])[1])}</td>
                <td><span class="status-pill ${ev.is_published ? 'pub' : 'draft'}">${ev.is_published ? 'Published' : 'Draft'}</span></td>
                <td>${ev.force_on_every_login ? '<span class="status-pill force">Forced</span>' : '—'}</td>
                <td>${counts[ev.id] || 0}</td>
                <td>
                  <div class="row-actions">
                    <button class="ev-btn ev-btn-ghost ev-btn-sm" data-action="edit" data-id="${ev.id}">Edit</button>
                    <button class="ev-btn ev-btn-ghost ev-btn-sm" data-action="regs" data-id="${ev.id}">Registrations</button>
                    <button class="ev-btn ev-btn-ghost ev-btn-sm" data-action="duplicate" data-id="${ev.id}">Duplicate</button>
                    <button class="ev-btn ev-btn-ghost ev-btn-sm" data-action="toggle-pub" data-id="${ev.id}">${ev.is_published ? 'Unpublish' : 'Publish'}</button>
                    <button class="ev-btn ev-btn-danger ev-btn-sm" data-action="delete" data-id="${ev.id}">Delete</button>
                  </div>
                </td>
              </tr>
            `).join('')}
        </tbody>
      </table>
    `;

    // Handlers
    _container.querySelectorAll('.filter-btn').forEach(b => {
      b.addEventListener('click', () => { _filter = b.dataset.filter; renderList(); });
    });
    const search = _container.querySelector('#ae-search');
    if (search) {
      search.addEventListener('input', (e) => { _search = e.target.value; });
      search.addEventListener('keydown', (e) => { if (e.key === 'Enter') renderList(); });
    }
    _container.addEventListener('click', listClickHandler);
  }

  async function listClickHandler(e) {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    const id = btn.dataset.id;
    const ev = id ? (await fetchAll()).find(x => x.id === id) : null;

    if (action === 'new')        { _editing = null; renderForm(); return; }
    if (action === 'edit' && ev) { _editing = ev;   renderForm(); return; }
    if (action === 'regs' && ev) { _regsContext = ev; renderRegistrations(); return; }
    if (action === 'duplicate' && ev) {
      const res = await duplicateEvent(ev);
      if (res.ok) renderList(); else alert('Duplicate failed: ' + res.error);
      return;
    }
    if (action === 'toggle-pub' && ev) {
      const res = await togglePublish(ev);
      if (res.ok) renderList(); else alert('Publish toggle failed: ' + res.error);
      return;
    }
    if (action === 'delete' && ev) {
      if (!confirm(`Delete event "${ev.title}"?\n\nThis will cascade delete all registrations and dismissals.`)) return;
      const res = await deleteEvent(id);
      if (res.ok) renderList(); else alert('Delete failed: ' + res.error);
      return;
    }
  }

  // ---------- Rendering: form ----------

  function renderForm() {
    _view = 'form';
    const ev = _editing || {};
    _container.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px">
        <button class="ev-btn ev-btn-ghost ev-btn-sm" data-action="back">← Back to list</button>
        <h3 style="margin:0">${_editing ? 'Edit Event' : 'New Event'}</h3>
      </div>

      <form class="events-form-panel" id="ae-form" novalidate>
        <div class="section-title">Basics</div>
        <div class="form-row full">
          <label>Title *</label>
          <input name="title" required maxlength="200" value="${escapeHtml(ev.title || '')}">
        </div>
        <div class="form-row">
          <label>Type *</label>
          <select name="event_type" required>
            ${TYPES.map(([v, l]) => `<option value="${v}" ${ev.event_type === v ? 'selected' : ''}>${l}</option>`).join('')}
          </select>
        </div>
        <div class="form-row">
          <label>Location Type *</label>
          <select name="location_type" required>
            ${LOCS.map(([v, l]) => `<option value="${v}" ${ev.location_type === v ? 'selected' : ''}>${l}</option>`).join('')}
          </select>
        </div>
        <div class="form-row full">
          <label>Short description * (shown on the card, ~280 chars)</label>
          <textarea name="short_description" required maxlength="400" rows="2">${escapeHtml(ev.short_description || '')}</textarea>
        </div>
        <div class="form-row full">
          <label>Long description (markdown, optional)</label>
          <textarea name="long_description" rows="6">${escapeHtml(ev.long_description || '')}</textarea>
        </div>

        <div class="section-title">When (Asia/Riyadh)</div>
        <div class="form-row">
          <label>Start *</label>
          <input type="datetime-local" name="start_datetime" required value="${toLocalInputValue(ev.start_datetime)}">
        </div>
        <div class="form-row">
          <label>End *</label>
          <input type="datetime-local" name="end_datetime" required value="${toLocalInputValue(ev.end_datetime)}">
        </div>
        <div class="form-row full">
          <label>Registration deadline (optional — defaults to Start)</label>
          <input type="datetime-local" name="registration_deadline" value="${toLocalInputValue(ev.registration_deadline)}">
        </div>

        <div class="section-title">Where</div>
        <div class="form-row full">
          <label>Venue (optional — shown when not online)</label>
          <input name="venue" value="${escapeHtml(ev.venue || '')}" placeholder="e.g. Microsoft Teams Live Event, Riyadh HQ, …">
        </div>

        <div class="section-title">Registration</div>
        <div class="form-row full">
          <label>External registration URL</label>
          <input type="url" name="registration_url" value="${escapeHtml(ev.registration_url || '')}" placeholder="https://…">
        </div>

        <div class="section-title">Display</div>
        <div class="form-row full">
          <label>Cover image URL (optional)</label>
          <input type="url" name="cover_image_url" id="ae-cover" value="${escapeHtml(ev.cover_image_url || '')}" placeholder="https://…">
        </div>
        <div class="cover-preview" id="ae-cover-preview" style="${ev.cover_image_url ? `background-image:url('${escapeHtml(ev.cover_image_url)}')` : ''}"></div>
        <div class="form-row">
          <label class="toggle-row"><input type="checkbox" name="force_on_every_login" ${ev.force_on_every_login ? 'checked' : ''}> Force on every login</label>
        </div>
        <div class="form-row">
          <label class="toggle-row"><input type="checkbox" name="is_published" ${ev.is_published ? 'checked' : ''}> Published</label>
        </div>

        <div class="form-actions">
          <button type="button" class="ev-btn ev-btn-ghost" data-action="back">Cancel</button>
          <button type="submit" class="ev-btn ev-btn-ghost" data-action="save-draft">Save as draft</button>
          <button type="submit" class="ev-btn ev-btn-primary" data-action="save-publish">Save &amp; publish</button>
        </div>
      </form>
    `;

    const form = _container.querySelector('#ae-form');
    const cover = form.querySelector('#ae-cover');
    const preview = form.querySelector('#ae-cover-preview');
    cover.addEventListener('input', () => {
      preview.style.backgroundImage = cover.value ? `url('${cover.value.replace(/'/g,"\\'")}')` : '';
    });

    _container.querySelectorAll('[data-action="back"]').forEach(b => b.addEventListener('click', (e) => { e.preventDefault(); renderList(); }));

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const clicked = e.submitter && e.submitter.dataset.action;
      const fd = new FormData(form);
      const payload = Object.fromEntries(fd.entries());
      payload.force_on_every_login = form.elements['force_on_every_login'].checked;
      payload.is_published = clicked === 'save-publish' ? true : form.elements['is_published'].checked;

      // Client-side validation
      if (!payload.title || !payload.short_description || !payload.start_datetime || !payload.end_datetime) {
        alert('Please fill in the required fields.');
        return;
      }
      if (new Date(payload.end_datetime) <= new Date(payload.start_datetime)) {
        alert('End must be after Start.');
        return;
      }
      if (payload.registration_deadline && new Date(payload.registration_deadline) > new Date(payload.start_datetime)) {
        alert('Registration deadline must be on or before Start.');
        return;
      }

      const res = await saveEvent(payload);
      if (res.ok) renderList();
      else alert('Save failed: ' + res.error);
    });
  }

  // ---------- Rendering: registrations ----------

  async function renderRegistrations() {
    _view = 'registrations';
    const ev = _regsContext;
    const regs = await fetchRegistrations(ev.id);

    const clicked = regs.filter(r => r.external_link_clicked).length;
    const daysTo = Math.max(0, Math.ceil((new Date(ev.start_datetime) - new Date()) / 86400000));

    _container.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px">
        <button class="ev-btn ev-btn-ghost ev-btn-sm" data-action="back">← Back to list</button>
        <h3 style="margin:0">${escapeHtml(ev.title)} — Registrations</h3>
      </div>

      <div class="events-regs-header">
        <div class="events-regs-stats">
          <div><div class="stat-label">Registered</div><div class="stat-value">${regs.length}</div></div>
          <div><div class="stat-label">External link clicked</div><div class="stat-value">${clicked}</div></div>
          <div><div class="stat-label">Days to event</div><div class="stat-value">${daysTo}</div></div>
        </div>
        <div style="display:flex;gap:8px">
          <select id="ae-regs-practice-filter" class="filter-btn">
            <option value="">All practices</option>
            ${[...new Set(regs.map(r => r.user?.practice).filter(Boolean))].map(p => `<option>${escapeHtml(p)}</option>`).join('')}
          </select>
          <button class="ev-btn ev-btn-primary ev-btn-sm" data-action="export-csv">Export CSV</button>
        </div>
      </div>

      <table class="events-admin-table" id="ae-regs-table">
        <thead>
          <tr>
            <th>User</th><th>Email</th><th>Practice</th><th>Role</th>
            <th>Registered at</th><th>Clicked?</th><th>Clicked at</th>
          </tr>
        </thead>
        <tbody>
          ${regs.length === 0
            ? `<tr><td colspan="7" style="text-align:center;padding:30px;color:var(--text-secondary)">No registrations yet.</td></tr>`
            : regs.map(r => `
              <tr data-practice="${escapeHtml(r.user?.practice || '')}">
                <td>${escapeHtml(r.user?.name || '—')}</td>
                <td>${escapeHtml(r.user?.email || '—')}</td>
                <td>${escapeHtml(r.user?.practice || '—')}</td>
                <td>${escapeHtml(r.user?.role || '—')}</td>
                <td>${escapeHtml(fmtDate(r.registered_at))}</td>
                <td>${r.external_link_clicked ? '✓' : '—'}</td>
                <td>${escapeHtml(fmtDate(r.external_clicked_at))}</td>
              </tr>
            `).join('')}
        </tbody>
      </table>
    `;

    _container.querySelector('[data-action="back"]').addEventListener('click', renderList);

    const practiceFilter = _container.querySelector('#ae-regs-practice-filter');
    practiceFilter.addEventListener('change', () => {
      const val = practiceFilter.value;
      _container.querySelectorAll('#ae-regs-table tbody tr').forEach(row => {
        if (!row.dataset.practice) return;
        row.style.display = (!val || row.dataset.practice === val) ? '' : 'none';
      });
    });

    _container.querySelector('[data-action="export-csv"]').addEventListener('click', () => {
      const rows = [['User','Email','Practice','Role','Registered at','External link clicked','Clicked at']];
      regs.forEach(r => {
        if (practiceFilter.value && r.user?.practice !== practiceFilter.value) return;
        rows.push([
          r.user?.name || '', r.user?.email || '', r.user?.practice || '', r.user?.role || '',
          fmtDate(r.registered_at), r.external_link_clicked ? 'Yes' : 'No', fmtDate(r.external_clicked_at)
        ]);
      });
      const csv = rows.map(row => row.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `event-${ev.id}-registrations.csv`;
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  // ---------- Public API ----------

  function init(container) {
    _container = container;
    renderList();
  }

  return { init };
})();
