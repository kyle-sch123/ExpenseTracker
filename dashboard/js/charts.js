// charts.js — Chart.js wrappers for the dashboard

const CAT_COLORS = {
  groceries:     '#4ade80',
  dining:        '#fb923c',
  shopping:      '#c084fc',
  gas:           '#38bdf8',
  pharmacy:      '#f472b6',
  entertainment: '#facc15',
  utilities:     '#94a3b8',
  other:         '#6b7280',
};

// Apply dark theme defaults
Chart.defaults.color = '#3a3f4a';
Chart.defaults.borderColor = '#1f2229';
Chart.defaults.font.family = "'DM Mono', monospace";
Chart.defaults.font.size = 11;

let _categoryChart = null;
let _trendChart = null;

window.ReceiptCharts = {

  getCategoryColor(cat) {
    return CAT_COLORS[cat] || '#6b7280';
  },

  initCategoryChart(canvasId, byCategory) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;

    const labels = Object.keys(byCategory);
    const data   = Object.values(byCategory);
    const colors = labels.map(l => CAT_COLORS[l] || '#6b7280');

    if (_categoryChart) _categoryChart.destroy();

    _categoryChart = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{
          data,
          backgroundColor: colors.map(c => c + '28'),
          borderColor: colors,
          borderWidth: 2,
          hoverBorderWidth: 3,
          hoverBackgroundColor: colors.map(c => c + '50'),
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '72%',
        animation: { animateRotate: true, duration: 600 },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#161820',
            borderColor: '#282e38',
            borderWidth: 1,
            titleColor: '#e2ddd0',
            bodyColor: '#78808f',
            padding: 10,
            callbacks: {
              label: ctx => ` R ${Number(ctx.raw).toFixed(2)}`,
            },
          },
        },
      },
    });

    return _categoryChart;
  },

  updateCategoryChart(byCategory) {
    if (!_categoryChart) return;
    const labels = Object.keys(byCategory);
    const data   = Object.values(byCategory);
    const colors = labels.map(l => CAT_COLORS[l] || '#6b7280');

    _categoryChart.data.labels = labels;
    _categoryChart.data.datasets[0].data = data;
    _categoryChart.data.datasets[0].backgroundColor = colors.map(c => c + '28');
    _categoryChart.data.datasets[0].borderColor = colors;
    _categoryChart.update();
  },

  initTrendChart(canvasId, monthlyTrend) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;

    if (_trendChart) _trendChart.destroy();

    const labels = monthlyTrend.map(d => {
      const [y, m] = d.month.split('-');
      return new Date(+y, +m - 1).toLocaleString('en-ZA', { month: 'short', year: '2-digit' });
    });
    const data   = monthlyTrend.map(d => d.amount);
    const maxVal = Math.max(...data, 1);

    _trendChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          data,
          backgroundColor: ctx => {
            const v = ctx.raw || 0;
            const a = (v / maxVal) * 0.55 + 0.12;
            return `rgba(181,242,112,${a})`;
          },
          borderColor: 'rgba(181,242,112,0.7)',
          borderWidth: 0,
          borderRadius: 5,
          borderSkipped: false,
          hoverBackgroundColor: 'rgba(181,242,112,0.65)',
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 600 },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#161820',
            borderColor: '#282e38',
            borderWidth: 1,
            titleColor: '#e2ddd0',
            bodyColor: '#78808f',
            padding: 10,
            callbacks: {
              label: ctx => ` R ${Number(ctx.raw).toFixed(2)}`,
            },
          },
        },
        scales: {
          x: {
            grid: { display: false },
            border: { display: false },
            ticks: { color: '#3a3f4a' },
          },
          y: {
            grid: { color: '#1f2229', drawTicks: false },
            border: { display: false, dash: [3, 3] },
            ticks: {
              color: '#3a3f4a',
              padding: 8,
              callback: v => 'R ' + v.toLocaleString(),
            },
          },
        },
      },
    });

    return _trendChart;
  },

  updateTrendChart(monthlyTrend) {
    if (!_trendChart) return;
    const labels = monthlyTrend.map(d => {
      const [y, m] = d.month.split('-');
      return new Date(+y, +m - 1).toLocaleString('en-ZA', { month: 'short', year: '2-digit' });
    });
    _trendChart.data.labels = labels;
    _trendChart.data.datasets[0].data = monthlyTrend.map(d => d.amount);
    _trendChart.update();
  },
};
