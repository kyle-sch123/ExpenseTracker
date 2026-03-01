// app.js — Main dashboard logic

const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];

const state = {
  month: new Date().getMonth() + 1,
  year:  new Date().getFullYear(),
};

let chartsReady = false;

// ── Formatting helpers ───────────────────────────────────────────────────────

function fmt(amount) {
  return 'R ' + Number(amount).toFixed(2);
}

function fmtDate(dateStr) {
  return new Date(dateStr).toLocaleDateString('en-ZA', {
    month: 'short', day: 'numeric',
  });
}

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Animated counter ─────────────────────────────────────────────────────────

function animateCount(el, target, renderFn, duration = 550) {
  if (!el) return;
  const start = performance.now();
  function tick(now) {
    const t = Math.min((now - start) / duration, 1);
    const ease = 1 - Math.pow(1 - t, 3);
    el.textContent = renderFn(target * ease);
    if (t < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

// ── Data fetching ─────────────────────────────────────────────────────────────

async function fetchSummary() {
  const res = await fetch(
    `/api/summary?period=month&month=${state.month}&year=${state.year}`
  );
  if (!res.ok) throw new Error('Failed to fetch summary');
  return res.json();
}

// ── Rendering ─────────────────────────────────────────────────────────────────

function updatePeriodLabel() {
  const el = document.getElementById('periodText');
  if (el) el.textContent = `${MONTH_NAMES[state.month - 1]} ${state.year}`;
}

function renderStats(data) {
  animateCount(
    document.getElementById('totalSpent'),
    data.totalSpent || 0,
    v => 'R ' + v.toFixed(2)
  );
  animateCount(
    document.getElementById('receiptCount'),
    data.receiptCount || 0,
    v => String(Math.round(v)),
    400
  );
  animateCount(
    document.getElementById('avgReceipt'),
    data.averagePerReceipt || 0,
    v => 'R ' + v.toFixed(2)
  );

  const sorted = Object.entries(data.byCategory || {}).sort(([, a], [, b]) => b - a);
  const topCatEl  = document.getElementById('topCategory');
  const topAmtEl  = document.getElementById('topCategoryAmount');
  if (sorted.length) {
    const [cat, amt] = sorted[0];
    if (topCatEl) topCatEl.textContent = cat;
    if (topAmtEl) topAmtEl.textContent = fmt(amt);
  } else {
    if (topCatEl) topCatEl.textContent = '—';
    if (topAmtEl) topAmtEl.textContent = 'no data yet';
  }
}

function renderCharts(data) {
  const byCategory = data.byCategory || {};
  const hasData    = Object.keys(byCategory).length > 0;

  // Donut center total
  const donutEl = document.getElementById('donutTotal');
  if (donutEl) donutEl.textContent = 'R ' + Math.round(data.totalSpent || 0).toLocaleString();

  if (hasData) {
    if (!chartsReady) {
      ReceiptCharts.initCategoryChart('categoryChart', byCategory);
    } else {
      ReceiptCharts.updateCategoryChart(byCategory);
    }
  }

  if (data.monthlyTrend) {
    if (!chartsReady) {
      ReceiptCharts.initTrendChart('trendChart', data.monthlyTrend);
    } else {
      ReceiptCharts.updateTrendChart(data.monthlyTrend);
    }
  }

  chartsReady = true;
  renderLegend(byCategory);
}

function renderLegend(byCategory) {
  const legend = document.getElementById('categoryLegend');
  if (!legend) return;

  const sorted = Object.entries(byCategory).sort(([, a], [, b]) => b - a);

  if (!sorted.length) {
    legend.innerHTML = `<div style="font-size:11px;color:var(--text-3);font-family:var(--font-mono)">No data for this period</div>`;
    return;
  }

  legend.innerHTML = sorted.map(([cat, amt]) => {
    const color = ReceiptCharts.getCategoryColor(cat);
    return `<div class="legend-item">
      <span class="legend-dot" style="background:${color}"></span>
      <span class="legend-name">${cat}</span>
      <span class="legend-value">${fmt(amt)}</span>
    </div>`;
  }).join('');
}

function renderRecentReceipts(receipts) {
  const tbody = document.getElementById('recentReceipts');
  if (!tbody) return;

  if (!receipts || !receipts.length) {
    tbody.innerHTML = `<tr class="table-empty"><td colspan="4">No receipts this period — send a photo to your WhatsApp bot!</td></tr>`;
    return;
  }

  tbody.innerHTML = receipts.map(r => `
    <tr>
      <td class="table-date">${fmtDate(r.date)}</td>
      <td class="table-merchant">${escHtml(r.merchant)}</td>
      <td><span class="badge badge-${r.category}">${r.category}</span></td>
      <td class="table-total">${fmt(r.total)}</td>
    </tr>
  `).join('');
}

// ── Load ──────────────────────────────────────────────────────────────────────

async function loadDashboard() {
  try {
    const data = await fetchSummary();
    renderStats(data);
    renderCharts(data);
    renderRecentReceipts(data.recentReceipts);
  } catch (err) {
    console.error('[Dashboard] Load failed:', err);
  }
}

// ── Period navigation ──────────────────────────────────────────────────────────

document.getElementById('prevMonth')?.addEventListener('click', () => {
  state.month--;
  if (state.month < 1) { state.month = 12; state.year--; }
  updatePeriodLabel();
  loadDashboard();
});

document.getElementById('nextMonth')?.addEventListener('click', () => {
  const now = new Date();
  if (state.year === now.getFullYear() && state.month === now.getMonth() + 1) return;
  state.month++;
  if (state.month > 12) { state.month = 1; state.year++; }
  updatePeriodLabel();
  loadDashboard();
});

// ── Init ──────────────────────────────────────────────────────────────────────

updatePeriodLabel();
loadDashboard();
