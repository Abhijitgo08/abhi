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

  // helper: try browser geolocation with timeout
  function getGeolocationPromise(timeout = 12000) {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) return reject(new Error('Geolocation not supported'));
      navigator.geolocation.getCurrentPosition(
        pos => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: pos.coords.accuracy || 2000 }),
        err => reject(err),
        { enableHighAccuracy: true, timeout, maximumAge: 0 }
      );
    });
  }

  // helper: IP fallback (ipapi.co)
  async function ipFallbackLocation() {
    try {
      const r = await fetch('https://ipapi.co/json/');
      if (!r.ok) throw new Error('IP lookup failed');
      const j = await r.json();
      return { latitude: Number(j.latitude), longitude: Number(j.longitude), accuracy: 5000 };
    } catch (e) {
      L('ipFallback failed', e);
      return null;
    }
  }

  // normalize /candidates -> options expected shape
  function normalizeCandidatesPayload(payload) {
    const arr = Array.isArray(payload?.talukas) ? payload.talukas : [];
    return arr.map(t => ({
      id: (t.id ? String(t.id) : (t.type && t.type + '/' + t.id) || null),
      lat: Number(t.lat ?? t.center?.lat ?? t.latitude ?? null),
      lng: Number(t.lon ?? t.center?.lon ?? t.longitude ?? null),
      address: t.name || t.display_name || null,
      distance_m: t.distance_m ?? null,
      raw: t
    })).filter(o => Number.isFinite(o.lat) && Number.isFinite(o.lng));
  }

  // main flow: login -> on success get coords -> call /candidates -> POST /api/location/options
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
      // store token & username early
      localStorage.setItem('token', data.token);
      localStorage.setItem('userName', (data.user && data.user.name) || '');

      // ensure we have a client id fallback
      const CLIENT_ID_KEY = 'rwh_client_id';
      if (!localStorage.getItem(CLIENT_ID_KEY)) {
        localStorage.setItem(CLIENT_ID_KEY, 'guest_' + Math.random().toString(36).slice(2,9));
      }
      const clientId = localStorage.getItem(CLIENT_ID_KEY);
      const authHeader = 'Bearer ' + data.token;
      const xUserId = data.token || clientId;

      // Try geolocation, then IP fallback
      let loc = null;
      try {
        loc = await getGeolocationPromise(12000);
        L('got browser geolocation', loc);
      } catch (geoErr) {
        L('browser geolocation failed, trying IP fallback', geoErr && (geoErr.message || geoErr.code));
        loc = await ipFallbackLocation();
        L('ip fallback location', loc);
      }

      if (loc && Number.isFinite(loc.latitude) && Number.isFinite(loc.longitude)) {
        try {
          // call /candidates
          const candResp = await fetch('/candidates', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ latitude: loc.latitude, longitude: loc.longitude, accuracy: loc.accuracy || 2000 })
          });
          const candJson = await safeJson(candResp);
          L('/candidates result', candResp.status, candJson);

          // normalize and prepare options array
          const options = normalizeCandidatesPayload(candJson);

          // send to server: POST /api/location/options
          // include Authorization and x-user-id header
          const saveResp = await fetch('/api/location/options', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-user-id': xUserId,
              'Authorization': authHeader
            },
            body: JSON.stringify({ options })
          });
          const saveJson = await safeJson(saveResp);
          L('/api/location/options save response', saveResp.status, saveJson);

          if (saveResp.ok) {
            localStorage.setItem('rwh_location_options', JSON.stringify(options));
            L('saved options locally and to DB', options.length);
          } else {
            L('save options failed', saveJson);
          }
        } catch (err) {
          L('candidates/save flow error', err);
          // proceed; don't block login
        }
      } else {
        L('no location available to fetch candidates');
      }

      // finished: redirect to dashboard
      window.location.href = 'dashboard.html';
      return;
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
