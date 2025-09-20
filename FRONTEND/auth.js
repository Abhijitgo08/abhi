/* auth.js - cleaned, reliable auth + location flow (awaits save before redirect) */
(() => {
  const API_BASE = '/api/auth';

  function L(...args) { console.log('[AUTH]', ...args); }

  async function safeJson(res) {
    try { return await res.json(); } catch (e) {
      const text = await res.text().catch(()=>'(no body)');
      return { __rawStatus: res.status, __rawText: text };
    }
  }

  // JWT payload parser (base64url decode)
  function jwtParsePayload(token){
    try {
      const part = token.split('.')[1];
      if (!part) return null;
      const b64 = part.replace(/-/g,'+').replace(/_/g,'/');
      const json = decodeURIComponent(atob(b64).split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''));
      return JSON.parse(json);
    } catch (e) {
      return null;
    }
  }

  // ---- Location flow helper ----
  async function handleLocationFlow(token) {
    L(">>> entered handleLocationFlow");

    // token: JWT string
    const authHeader = token ? 'Bearer ' + token : null;
    const clientIdKey = 'rwh_client_id';
    if (!localStorage.getItem(clientIdKey)) {
      localStorage.setItem(clientIdKey, 'guest_' + Math.random().toString(36).slice(2,9));
    }
    const clientId = localStorage.getItem(clientIdKey);
    // prefer explicit stored userId (set on login/signup), then token, then fallback clientId
    const xUserId = localStorage.getItem('userId') || token || clientId;

    // helper: geolocation with timeout
    function getGeolocationPromise(timeout = 10000) {
      return new Promise((resolve, reject) => {
        if (!navigator.geolocation) return reject(new Error('Geolocation not supported'));
        const timer = setTimeout(() => reject(new Error('Geolocation timed out')), timeout);
        navigator.geolocation.getCurrentPosition(
          pos => { clearTimeout(timer); resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: pos.coords.accuracy || 2000 }); },
          err => { clearTimeout(timer); reject(err); },
          { enableHighAccuracy: true, timeout, maximumAge: 0 }
        );
      });
    }

    async function ipFallbackLocation() {
      try {
        const r = await fetch('https://ipapi.co/json/');
        if (!r.ok) throw new Error('IP lookup failed');
        const j = await r.json();
        return { latitude: Number(j.latitude), longitude: Number(j.longitude), accuracy: 5000 };
      } catch (e) { L('ipFallback failed', e); return null; }
    }

    // normalize /candidates -> options expected shape (accepts lon or lng)
    function normalizeCandidatesPayload(payload) {
      const arr = Array.isArray(payload?.talukas) ? payload.talukas : [];
      return arr.map(t => {
        const lat = Number(t.lat ?? t.center?.lat ?? t.latitude ?? null);
        const lng = Number(t.lng ?? t.lon ?? t.center?.lon ?? t.longitude ?? null);
        return {
          id: t.id ? String(t.id) : (t.place_id || null),
          lat: Number.isFinite(lat) ? lat : null,
          lng: Number.isFinite(lng) ? lng : null,
          address: t.name || t.display_name || t.address || null,
          distance_m: t.distance_m ?? t.distance ?? null,
          raw: t
        };
      }).filter(o => Number.isFinite(o.lat) && Number.isFinite(o.lng));
    }

    // Try to obtain location
    let loc = null;
    try {
      loc = await getGeolocationPromise(8000);
      L('got browser geolocation', loc);
    } catch (geoErr) {
      L('browser geolocation failed, trying IP fallback', geoErr && (geoErr.message || geoErr.code));
      loc = await ipFallbackLocation();
      L('ip fallback location', loc);
    }

    if (!loc || !Number.isFinite(loc.latitude) || !Number.isFinite(loc.longitude)) {
      L('No location available; skipping candidates/options save');
      return { ok: false, reason: 'no-location' };
    }

    // call /api/location/candidates
    try {
      const candResp = await fetch('/api/location/candidates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ latitude: loc.latitude, longitude: loc.longitude, accuracy: loc.accuracy || 2000 })
      });
      const candJson = await safeJson(candResp);
      L('/api/location/candidates', candResp.status, candJson);

      const options = normalizeCandidatesPayload(candJson);
      L('normalized options', options);

      if (!options.length) {
        L('No normalized options returned from candidates; skipping save');
        return { ok: false, reason: 'no-options' };
      }

      // POST /api/location/options and await completion
      const saveResp = await fetch('/api/location/options', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authHeader ? { Authorization: authHeader } : {}),
          'x-user-id': xUserId
        },
        body: JSON.stringify({ options })
      });
      const saveJson = await safeJson(saveResp);
      L('/api/location/options save response', saveResp.status, saveJson);

      return { ok: saveResp.ok, status: saveResp.status, body: saveJson, savedCount: Array.isArray(saveJson?.locationOptions) ? saveJson.locationOptions.length : (saveJson?.savedCount ?? 0) };
    } catch (err) {
      L('handleLocationFlow error', err);
      return { ok: false, err };
    }
  }

  // ---- Signup handler ----
  async function signupHandler(e) {
    e.preventDefault();
    L('signup clicked');
    const name = document.getElementById('signupName')?.value.trim() || '';
    const email = document.getElementById('signupEmail')?.value.trim() || '';
    const password = document.getElementById('signupPassword')?.value || '';

    L('signup payload', { name, email, password: password ? '●●●' : '(empty)' });

    try {
      const res = await fetch(`${API_BASE}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password }),
        credentials: 'include'
      });
      const data = await safeJson(res);
      L('signup response', res.status, data);

      if (res.ok && data.token) {
        localStorage.setItem('token', data.token);
        localStorage.setItem('userName', (data.user && data.user.name) || '');

        // Try to persist a usable user id.
        let returnedUserId = (data.user && (data.user.id || data.user._id || data.user.userId)) || '';
        if (!returnedUserId && data.token) {
          const payload = jwtParsePayload(data.token);
          if (payload) {
            returnedUserId = payload.sub || payload.id || payload._id || (payload.user && (payload.user.id || payload.user._id));
          }
        }
        if (returnedUserId) {
          localStorage.setItem('userId', String(returnedUserId));
        } else {
          // ensure rwh_client_id exists (guest fallback)
          const clientIdKey = 'rwh_client_id';
          if (!localStorage.getItem(clientIdKey)) localStorage.setItem(clientIdKey, 'guest_' + Math.random().toString(36).slice(2,9));
        }

        // Ensure location saved before redirect
        await handleLocationFlow(data.token);

        window.location.href = 'dashboard.html';
        return;
      } else {
        alert(data.msg || data.message || `Signup failed (${res.status})`);
      }
    } catch (err) {
      L('signup error', err);
      alert('Network error — check console and server logs');
    }
  }

  // ---- Login handler (REPLACED) ----
  // ---- Login handler (improved: start geolocation immediately to trigger prompt) ----
async function loginHandler(e) {
  e.preventDefault();
  L('login clicked');
  const email = document.getElementById('loginEmail')?.value.trim() || '';
  const password = document.getElementById('loginPassword')?.value || '';
  L('login payload', { email, password: password ? '●●●' : '(empty)' });

  // Start geolocation immediately (so browser prompt appears while we do network work)
  const geolocate = (() => {
    // same helper as in handleLocationFlow but invoked earlier
    return new Promise((resolve) => {
      if (!navigator.geolocation) return resolve(null);
      const called = { done: false };
      const timer = setTimeout(() => {
        if (!called.done) { called.done = true; resolve(null); }
      }, 10000); // give 10s to user to respond

      navigator.geolocation.getCurrentPosition(
        pos => {
          if (called.done) return;
          called.done = true;
          clearTimeout(timer);
          resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: pos.coords.accuracy || 2000 });
        },
        err => {
          if (called.done) return;
          called.done = true;
          clearTimeout(timer);
          resolve(null); // we'll fallback to IP later
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
      );
    });
  })();

  try {
    // perform login while the geolocation permission prompt is visible
    const res = await fetch(`${API_BASE}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await safeJson(res);
    L('login response', res.status, data);

    if (!(res.ok && data.token)) {
      alert(data.msg || data.message || `Login failed (status ${res.status})`);
      return;
    }

    // save token & name asap
    localStorage.setItem('token', data.token);
    localStorage.setItem('userName', (data.user && data.user.name) || '');

    // persist userId (try data.user then decode token)
    let returnedUserId = (data.user && (data.user.id || data.user._id || data.user.userId)) || '';
    if (!returnedUserId && data.token) {
      const payload = jwtParsePayload(data.token);
      if (payload) {
        returnedUserId = payload.sub || payload.id || payload._id || (payload.user && (payload.user.id || payload.user._id));
      }
    }
    if (returnedUserId) localStorage.setItem('userId', String(returnedUserId));
    else {
      const clientIdKey = 'rwh_client_id';
      if (!localStorage.getItem(clientIdKey)) localStorage.setItem(clientIdKey, 'guest_' + Math.random().toString(36).slice(2,9));
    }

    // Wait for the geolocation promise we started earlier (or fallback to IP)
    let loc = await geolocate;
    if (!loc) {
      // try IP fallback
      try {
        const r = await fetch('https://ipapi.co/json/');
        if (r.ok) {
          const j = await r.json();
          loc = { latitude: Number(j.latitude), longitude: Number(j.longitude), accuracy: 5000 };
        }
      } catch (e) { L('ipFallback failed', e); }
    }

    // If we have a location, run the candidates + save flow (this reuses your existing handleLocationFlow logic)
    if (loc && Number.isFinite(loc.latitude) && Number.isFinite(loc.longitude)) {
      try {
        // call /api/location/candidates
        const candResp = await fetch('/api/location/candidates', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ latitude: loc.latitude, longitude: loc.longitude, accuracy: loc.accuracy || 2000 })
        });
        const candJson = await safeJson(candResp);
        L('/candidates result', candResp.status, candJson);

        // normalize and prepare options array
        const options = (Array.isArray(candJson?.talukas) ? candJson.talukas : []).map(t => ({
          id: t.id ? String(t.id) : (t.place_id || null),
          lat: Number(t.lat ?? t.latitude ?? t.center?.lat),
          lng: Number(t.lng ?? t.lon ?? t.center?.lon ?? t.longitude),
          address: t.name || t.display_name || null,
          distance_m: t.distance_m ?? t.distance ?? null,
          raw: t
        })).filter(o => Number.isFinite(o.lat) && Number.isFinite(o.lng));

        if (options.length) {
          const authHeader = 'Bearer ' + data.token;
          const xUserId = localStorage.getItem('userId') || data.token || localStorage.getItem('rwh_client_id');
          const saveResp = await fetch('/api/location/options', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': authHeader,
              'x-user-id': xUserId
            },
            body: JSON.stringify({ options })
          });
          const saveJson = await safeJson(saveResp);
          L('/api/location/options save response', saveResp.status, saveJson);
        } else {
          L('no options built from candidates');
        }
      } catch (err) {
        L('candidates/save flow error', err);
      }
    } else {
      L('no location available to fetch candidates');
    }

    // finally redirect (after everything attempted/saved)
    window.location.href = 'dashboard.html';
    return;

  } catch (err) {
    L('login error', err);
    alert('Network error — check console and server logs');
  }
}


  // ---- Attach listeners ----
  function init() {
    const signupForm = document.getElementById('signupForm');
    const loginForm = document.getElementById('loginForm');

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
