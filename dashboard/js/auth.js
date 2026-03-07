// auth.js — Token extraction and authenticated fetch wrapper

(function() {
  const params = new URLSearchParams(window.location.search);
  const urlToken = params.get('token');

  if (urlToken) {
    sessionStorage.setItem('dashboardToken', urlToken);
    // Strip token from URL bar to prevent accidental sharing
    params.delete('token');
    const clean = params.toString();
    const newUrl = window.location.pathname + (clean ? '?' + clean : '') + window.location.hash;
    history.replaceState(null, '', newUrl);
  }

  const token = sessionStorage.getItem('dashboardToken');

  if (!token) {
    document.addEventListener('DOMContentLoaded', () => {
      const app = document.querySelector('.app');
      if (app) {
        app.innerHTML = `
          <div style="display:flex;align-items:center;justify-content:center;min-height:80vh;text-align:center;padding:2rem;">
            <div>
              <h2 style="color:var(--text-1);margin-bottom:0.5rem;">No Access</h2>
              <p style="color:var(--text-3);font-size:14px;">
                Send <strong>dashboard</strong> to the WhatsApp bot to get your personal link.
              </p>
            </div>
          </div>`;
      }
    });
  }

  window.authFetch = function(url, options = {}) {
    const t = sessionStorage.getItem('dashboardToken');
    if (!t) return Promise.reject(new Error('No auth token'));
    const headers = { ...(options.headers || {}) };
    headers['Authorization'] = 'Bearer ' + t;
    return fetch(url, { ...options, headers });
  };

  // Propagate token to navigation links
  function addTokenToLinks() {
    const t = sessionStorage.getItem('dashboardToken');
    if (!t) return;
    document.querySelectorAll('a[href]').forEach(a => {
      const href = a.getAttribute('href');
      if (href && !href.startsWith('http') && !href.startsWith('#') && !href.startsWith('javascript')) {
        // Don't modify if already has logic — just ensure sessionStorage is set
        // Links will work because auth.js runs on every page and reads from sessionStorage
      }
    });
  }

  document.addEventListener('DOMContentLoaded', addTokenToLinks);
})();
