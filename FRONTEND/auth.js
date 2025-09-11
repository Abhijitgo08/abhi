/* auth.js - safe, relative API calls, logging & error handling */

(() => {
  const API_BASE = '/api/auth'; // <-- relative path: works locally + on Render

  function L(...args){ console.log('[AUTH]', ...args); }

  async function safeJson(res){
    try { return await res.json(); }
    catch (e) {
      const text = await res.text().catch(()=>'(no body)');
      return { __rawStatus: res.status, __rawText: text };
    }
  }

  async function signupHandler(e){
    e.preventDefault();
    L('signup clicked');
    const name = document.getElementById('signupName')?.value.trim() || '';
    const email = document.getElementById('signupEmail')?.value.trim() || '';
    const password = document.getElementById('signupPassword')?.value || '';

    L('payload', { name, email, password: password ? '●●●' : '(empty)' });

    try {
      const res = await fetch(`${API_BASE}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password }),
        credentials: 'include' // keep only if you use cookie-based sessions
      });
      L('signup status', res.status);
      const data = await safeJson(res);
      L('signup body', data);

      if (res.ok && data.token) {
        localStorage.setItem('token', data.token);
        localStorage.setItem('userName', (data.user && data.user.name) || name || '');
        window.location.href = 'dashboard.html';
      } else {
        alert(data.msg || data.message || `Signup failed (status ${res.status})`);
      }
    } catch (err) {
      L('signup error', err);
      alert('Network error — check console and server logs');
    }
  }

  async function loginHandler(e){
    e.preventDefault();
    L('login clicked');
    const email = document.getElementById('loginEmail')?.value.trim() || '';
    const password = document.getElementById('loginPassword')?.value || '';

    L('payload', { email, password: password ? '●●●' : '(empty)' });

    try {
      const res = await fetch(`${API_BASE}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      L('login status', res.status);
      const data = await safeJson(res);
      L('login body', data);

      if (res.ok && data.token) {
        localStorage.setItem('token', data.token);
        localStorage.setItem('userName', (data.user && data.user.name) || '');
        window.location.href = 'dashboard.html';
      } else {
        alert(data.msg || data.message || `Login failed (status ${res.status})`);
      }
    } catch (err) {
      L('login error', err);
      alert('Network error — check console and server logs');
    }
  }

  // Attach listeners when DOM ready
  function init(){
    const signupForm = document.getElementById('signupForm');
    const loginForm = document.getElementById('loginForm');

    if (!signupForm) L('signupForm not found');
    if (!loginForm) L('loginForm not found');

    signupForm?.addEventListener('submit', signupHandler);
    loginForm?.addEventListener('submit', loginHandler);

    L('auth handlers attached');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
