// ============================================================
// EAS AI Dashboard — Use Case Review Queue
// Sub-project 1 of Use Case Library v2
// ============================================================

const EAS_UseCaseReview = (() => {

  function _badge(status) {
    const map = {
      pending: ['#fef3c7', '#92400e', 'Pending'],
      revision_requested: ['#ffedd5', '#9a3412', 'Revision requested'],
    };
    const [bg, fg, label] = map[status] || ['#e5e7eb', '#374151', status];
    return `<span class="uc-review-badge" style="background:${bg};color:${fg}">${label}</span>`;
  }

  function _escHtml(str) {
    if (!str) return '';
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function _row(uc) {
    const dept = _escHtml(uc.department?.name) || '—';
    const practice = uc.practice?.name ? ` · ${_escHtml(uc.practice.name)}` : '';
    const author = _escHtml(uc.author?.name || uc.author?.email) || 'Unknown';
    return `
      <tr data-uc-id="${_escHtml(uc.id)}">
        <td>
          <div class="uc-review-name">${_escHtml(uc.name) || '(untitled)'}</div>
          <div class="uc-review-meta">${_escHtml(uc.asset_id)} · ${dept}${practice} · by ${author}</div>
          ${_badge(uc.approval_status)}
          <details class="uc-review-detail">
            <summary>Show details</summary>
            <p><strong>Description:</strong> ${_escHtml(uc.description) || '—'}</p>
            <p><strong>Category:</strong> ${_escHtml(uc.category) || '—'} / ${_escHtml(uc.subcategory) || '—'}</p>
            <p><strong>SDLC phase:</strong> ${_escHtml(uc.sdlc_phase) || '—'}</p>
            <p><strong>AI tools:</strong> ${_escHtml(uc.ai_tools) || '—'}</p>
            <p><strong>Business benefits:</strong> ${_escHtml(uc.business_benefits) || '—'}</p>
            <p><strong>Implementation guidelines:</strong> ${_escHtml(uc.implementation_guidelines) || '—'}</p>
            <p><strong>How to apply:</strong> ${_escHtml(uc.suggestion_how_to_apply) || '—'}</p>
            <p><strong>Hours saved / impl:</strong> ${uc.hours_saved_per_impl ?? '—'}</p>
            <p><strong>Effort w/o AI:</strong> ${_escHtml(uc.efforts_without_ai) || '—'} ·
               <strong>w/ AI:</strong> ${_escHtml(uc.efforts_with_ai) || '—'}</p>
            ${uc.review_notes ? `<p><strong>Prior reviewer notes:</strong> ${_escHtml(uc.review_notes)}</p>` : ''}
          </details>
          <textarea class="uc-review-notes" placeholder="Reviewer notes (required for reject / request changes)"></textarea>
          <div class="uc-review-actions">
            <button data-action="approved" class="uc-btn uc-btn-approve">Approve</button>
            <button data-action="revision_requested" class="uc-btn uc-btn-revise">Request changes</button>
            <button data-action="rejected" class="uc-btn uc-btn-reject">Reject</button>
          </div>
        </td>
      </tr>
    `;
  }

  async function render(container) {
    container.innerHTML = '<p>Loading review queue…</p>';
    let queue;
    try {
      queue = await EAS_DB.getReviewQueue();
    } catch (e) {
      container.innerHTML = `<p class="uc-review-error">Failed to load: ${_escHtml(e.message)}</p>`;
      return;
    }
    if (!queue.length) {
      container.innerHTML = '<p class="uc-review-empty">No use cases awaiting review.</p>';
      return;
    }
    container.innerHTML = `
      <table class="uc-review-table">
        <tbody>${queue.map(_row).join('')}</tbody>
      </table>
    `;
    container.querySelectorAll('button[data-action]').forEach(btn => {
      btn.addEventListener('click', async ev => {
        const tr = ev.target.closest('tr[data-uc-id]');
        const id = tr.dataset.ucId;
        const decision = ev.target.dataset.action;
        const notes = tr.querySelector('.uc-review-notes').value.trim();
        if (decision !== 'approved' && !notes) {
          alert('Notes are required when rejecting or requesting changes.');
          return;
        }
        ev.target.disabled = true;
        try {
          await EAS_DB.reviewUseCase(id, decision, notes || null);
          tr.remove();
          // Update the badge count
          const badge = document.getElementById('uc-review-count-badge');
          if (badge) {
            const remaining = container.querySelectorAll('tr[data-uc-id]').length;
            if (remaining > 0) {
              badge.textContent = remaining;
            } else {
              badge.hidden = true;
            }
          }
          if (!container.querySelector('tr[data-uc-id]')) {
            container.innerHTML = '<p class="uc-review-empty">No use cases awaiting review.</p>';
          }
        } catch (e) {
          alert(`Review failed: ${e.message}`);
          ev.target.disabled = false;
        }
      });
    });
  }

  return { render };
})();
