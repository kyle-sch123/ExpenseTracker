// receipts.js — Receipts list page

const state = {
  page: 1, limit: 20, search: '', category: '', sort: 'date',
  total: 0, pages: 1,
};

let searchTimer  = null;
let editingId    = null;

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(amount) {
  return 'R ' + Number(amount).toFixed(2);
}

function fmtDate(dateStr) {
  return new Date(dateStr).toLocaleDateString('en-ZA', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

function fmtDateInput(dateStr) {
  return new Date(dateStr).toISOString().split('T')[0];
}

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function badgeHtml(cat) {
  return `<span class="badge badge-${escHtml(cat)}">${escHtml(cat)}</span>`;
}

// ── Fetch ─────────────────────────────────────────────────────────────────────

async function fetchReceipts() {
  const p = new URLSearchParams({ page: state.page, limit: state.limit, sort: state.sort });
  if (state.search)   p.set('search',   state.search);
  if (state.category) p.set('category', state.category);
  const res = await fetch(`/api/receipts?${p}`);
  if (!res.ok) throw new Error('Fetch failed');
  return res.json();
}

// ── Render ────────────────────────────────────────────────────────────────────

function renderPageCount(n) {
  const el = document.getElementById('pageCount');
  if (el) el.textContent = `${n} receipt${n !== 1 ? 's' : ''}`;
}

function renderReceipts(receipts) {
  const list = document.getElementById('receiptsList');
  if (!list) return;

  if (!receipts.length) {
    list.innerHTML = `<div class="empty-state">
      <div class="empty-state-title">No receipts found</div>
      <div class="empty-state-sub">Try changing your filters or send a receipt photo to the bot</div>
    </div>`;
    return;
  }

  list.innerHTML = receipts.map(r => {
    const imgSrc = r.imageUrl || null;

    return `<div class="receipt-card" data-id="${r.id}">
      <div class="receipt-row" onclick="toggleCard('${r.id}')">
        <span class="receipt-date">${fmtDate(r.date)}</span>
        <span class="receipt-merchant">${escHtml(r.merchant)}</span>
        ${badgeHtml(r.category)}${!r.imageUrl ? '<span class="badge badge-manual">Manual</span>' : ''}
        <span class="receipt-items-count">${r.items?.length || 0} items</span>
        <span class="receipt-total">${fmt(r.total)}</span>
        <span class="receipt-expand-icon">›</span>
      </div>
      <div class="receipt-detail">
        <div class="detail-grid">
          <div>
            ${renderItemsTable(r)}
            ${renderTotals(r)}
          </div>
          <div class="detail-sidebar">
            <div class="receipt-image-wrap">
              ${imgSrc
                ? `<img class="receipt-image" src="${imgSrc}" alt="Receipt image" loading="lazy">`
                : `<div class="receipt-image-placeholder">
                     <span class="image-placeholder-icon">🧾</span>
                     <span class="image-placeholder-text">No image</span>
                   </div>`
              }
            </div>
            <div class="detail-meta">
              ${r.merchantAddress ? `<div class="meta-row"><span class="meta-label">Address</span><span class="meta-value">${escHtml(r.merchantAddress)}</span></div>` : ''}
              ${r.paymentMethod   ? `<div class="meta-row"><span class="meta-label">Payment</span><span class="meta-value">${escHtml(r.paymentMethod)}</span></div>` : ''}
              ${r.time            ? `<div class="meta-row"><span class="meta-label">Time</span><span class="meta-value">${escHtml(r.time)}</span></div>` : ''}
              <div class="meta-row"><span class="meta-label">Currency</span><span class="meta-value">${escHtml(r.currency || 'ZAR')}</span></div>
            </div>
            <div class="detail-actions">
              <button class="btn btn-ghost" onclick="openEdit(event,'${r.id}')">Edit</button>
              <button class="btn btn-danger" onclick="deleteReceipt(event,'${r.id}')">Delete</button>
            </div>
          </div>
        </div>
      </div>
    </div>`;
  }).join('');
}

function renderItemsTable(receipt) {
  if (!receipt.items?.length) {
    return `<div style="font-size:11px;color:var(--text-3);font-family:var(--font-mono);padding:6px 0">No items detected</div>`;
  }
  return `<div class="items-table-wrap">
    <table class="items-table">
      <thead><tr><th>Item</th><th>Qty</th><th class="td-right">Unit</th><th class="td-right">Total</th></tr></thead>
      <tbody>
        ${receipt.items.map(item => `
          <tr>
            <td>${escHtml(item.name)}</td>
            <td>${item.quantity}</td>
            <td class="td-right">${fmt(item.unitPrice)}</td>
            <td class="td-right">${fmt(item.total)}</td>
          </tr>`).join('')}
      </tbody>
    </table>
  </div>`;
}

function renderTotals(r) {
  const rows = [];
  if (r.subtotal != null) rows.push(['Subtotal', fmt(r.subtotal)]);
  if (r.tax  != null && r.tax  > 0) rows.push(['Tax',  fmt(r.tax)]);
  if (r.tip  != null && r.tip  > 0) rows.push(['Tip',  fmt(r.tip)]);
  return `<div class="detail-totals">
    ${rows.map(([l, v]) => `<div class="totals-row"><span class="tl">${l}</span><span class="tr">${v}</span></div>`).join('')}
    <div class="totals-row totals-grand">
      <span class="tl">Total</span>
      <span class="tr">${fmt(r.total)}</span>
    </div>
  </div>`;
}

function renderPagination() {
  const el = document.getElementById('pagination');
  if (!el) return;
  if (state.pages <= 1) { el.innerHTML = ''; return; }

  const btns = [];
  btns.push(`<button class="page-btn" onclick="goPage(${state.page-1})" ${state.page<=1?'disabled':''}>←</button>`);

  const lo = Math.max(1, state.page - 2);
  const hi = Math.min(state.pages, state.page + 2);

  if (lo > 1) btns.push(`<button class="page-btn" onclick="goPage(1)">1</button>`);
  if (lo > 2) btns.push(`<span style="padding:0 4px;color:var(--text-3);font-family:var(--font-mono)">…</span>`);
  for (let i = lo; i <= hi; i++) {
    btns.push(`<button class="page-btn${i===state.page?' active':''}" onclick="goPage(${i})">${i}</button>`);
  }
  if (hi < state.pages - 1) btns.push(`<span style="padding:0 4px;color:var(--text-3);font-family:var(--font-mono)">…</span>`);
  if (hi < state.pages) btns.push(`<button class="page-btn" onclick="goPage(${state.pages})">${state.pages}</button>`);

  btns.push(`<button class="page-btn" onclick="goPage(${state.page+1})" ${state.page>=state.pages?'disabled':''}>→</button>`);
  el.innerHTML = btns.join('');
}

// ── Actions (global scope for inline onclick) ─────────────────────────────────

window.toggleCard = function(id) {
  document.querySelector(`[data-id="${id}"]`)?.classList.toggle('is-expanded');
};

window.goPage = function(p) {
  if (p < 1 || p > state.pages) return;
  state.page = p;
  load();
  window.scrollTo({ top: 0, behavior: 'smooth' });
};

window.openEdit = async function(e, id) {
  e.stopPropagation();
  try {
    const res = await fetch(`/api/receipts/${id}`);
    if (!res.ok) throw new Error();
    const r = await res.json();
    editingId = id;
    document.getElementById('editMerchant').value = r.merchant        || '';
    document.getElementById('editTotal').value    = r.total           || '';
    document.getElementById('editDate').value     = r.date ? fmtDateInput(r.date) : '';
    document.getElementById('editCategory').value = r.category        || 'other';
    document.getElementById('editPayment').value  = r.paymentMethod   || '';
    document.getElementById('editModal').classList.add('is-open');
  } catch {
    alert('Could not load receipt details.');
  }
};

window.deleteReceipt = async function(e, id) {
  e.stopPropagation();
  const card     = document.querySelector(`[data-id="${id}"]`);
  const merchant = card?.querySelector('.receipt-merchant')?.textContent || 'this receipt';
  if (!confirm(`Delete receipt from "${merchant}"?`)) return;
  try {
    const res = await fetch(`/api/receipts/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error();
    card?.remove();
    state.total--;
    renderPageCount(state.total);
  } catch {
    alert('Failed to delete receipt.');
  }
};

// ── Modal ─────────────────────────────────────────────────────────────────────

function closeModal() {
  document.getElementById('editModal').classList.remove('is-open');
  document.getElementById('addExpenseModal').classList.remove('is-open');
  editingId = null;
}

function openAddExpense() {
  document.getElementById('addMerchant').value = '';
  document.getElementById('addTotal').value = '';
  document.getElementById('addCategory').value = 'groceries';
  document.getElementById('addPayment').value = 'Card';
  document.getElementById('addDate').value = new Date().toISOString().split('T')[0];
  document.getElementById('addExpenseModal').classList.add('is-open');
  document.getElementById('addMerchant').focus();
}

document.getElementById('editForm')?.addEventListener('submit', async e => {
  e.preventDefault();
  if (!editingId) return;
  const body = {
    merchant:      document.getElementById('editMerchant').value,
    total:         document.getElementById('editTotal').value,
    date:          document.getElementById('editDate').value,
    category:      document.getElementById('editCategory').value,
    paymentMethod: document.getElementById('editPayment').value,
  };
  try {
    const res = await fetch(`/api/receipts/${editingId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error();
    closeModal();
    load();
  } catch {
    alert('Failed to save changes.');
  }
});

document.getElementById('closeModal')?.addEventListener('click', closeModal);
document.getElementById('cancelEdit')?.addEventListener('click', closeModal);
document.getElementById('editModal')?.addEventListener('click', e => {
  if (e.target === e.currentTarget) closeModal();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeModal();
});

// ── Add Expense Modal ────────────────────────────────────────────────────────

document.getElementById('addExpenseBtn')?.addEventListener('click', openAddExpense);
document.getElementById('closeAddModal')?.addEventListener('click', closeModal);
document.getElementById('cancelAdd')?.addEventListener('click', closeModal);
document.getElementById('addExpenseModal')?.addEventListener('click', e => {
  if (e.target === e.currentTarget) closeModal();
});

document.getElementById('addExpenseForm')?.addEventListener('submit', async e => {
  e.preventDefault();
  const body = {
    merchant:      document.getElementById('addMerchant').value,
    total:         document.getElementById('addTotal').value,
    category:      document.getElementById('addCategory').value,
    paymentMethod: document.getElementById('addPayment').value,
    date:          document.getElementById('addDate').value || undefined,
  };
  try {
    const res = await fetch('/api/receipts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error();
    closeModal();
    load();
  } catch {
    alert('Failed to add expense.');
  }
});

// ── Filters ───────────────────────────────────────────────────────────────────

document.getElementById('searchInput')?.addEventListener('input', e => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.search = e.target.value.trim();
    state.page = 1;
    load();
  }, 300);
});

document.getElementById('categoryFilter')?.addEventListener('change', e => {
  state.category = e.target.value;
  state.page = 1;
  load();
});

document.getElementById('sortFilter')?.addEventListener('change', e => {
  state.sort = e.target.value;
  state.page = 1;
  load();
});

// ── Main load ─────────────────────────────────────────────────────────────────

async function load() {
  const list = document.getElementById('receiptsList');
  if (list) list.innerHTML = '<div class="loading-state">Loading…</div>';

  try {
    const data  = await fetchReceipts();
    state.total = data.total;
    state.pages = data.pages;
    renderPageCount(data.total);
    renderReceipts(data.receipts);
    renderPagination();
  } catch (err) {
    console.error('[Receipts] Load failed:', err);
    if (list) list.innerHTML = `<div class="empty-state">
      <div class="empty-state-title">Could not load receipts</div>
      <div class="empty-state-sub">Make sure the server is running</div>
    </div>`;
  }
}

load();

// Auto-open add expense modal if navigated with #add hash
if (window.location.hash === '#add') {
  openAddExpense();
  history.replaceState(null, '', window.location.pathname);
}
