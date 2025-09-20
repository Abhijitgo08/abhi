/* auth.js - reliable auth + location flow (clean, safe for production) */
(() => {
  const API_BASE = '/api/auth';

  function L(...args) { console.log('[AUTH]', ...args); }

  async function safeJson(res) {
    try { return await res.json(); }
    catch (e) {
      const text = await res.text().catch(()=>'(no body)');
      return { __rawStatus: res.status, __rawText: text };
    }
  }

  // ---------- small util: race promise against timeout ----------
  function withTimeout(promise, ms = 8000, timeoutValue = { ok: false, reason: 'timeout' }) {
    return Promise.race([
      promise.catch(err => ({ ok: false, reason: err && err.message ? err.message : String(err) })),
      new Promise(resolve => setTimeout(() => resolve(timeoutValue), ms))
    ]);
  }

  // ---------- wrapper to prevent double submissions ----------
  function singleSubmission(handler) {
    let locked = false;
    return async function wrapped(e) {
      if (locked) {
        e.preventDefault();
        console.warn('[AUTH] ⏳ Double submit prevented');
        return;
      }
      locked = true;
      try {
        await handler.call(this, e);
      } finally {
        locked = false;
      }
    };
  }

  // ---------- helper: set button loading state ----------
  function setBtnLoading(btn, loading, text) {
    if (!btn) return;
    btn.disabled = loading;
    btn.classList.toggle('opacity-60', loading);
    btn.classList.toggle('cursor-not-allowed', loading);
    if (loading) {
      btn._oldHtml = btn.innerHTML;
      btn.innerHTML = (text || 'Please wait...') + ' <span class="animate-pulse">⏳</span>';
    } else if (btn._oldHtml) {
      btn.innerHTML = btn._oldHtml;
      delete btn._oldHtml;
    }
  }

  // ---- Location flow ----
  async function handleLocationFlow(token) {
    L(">>> entered handleLocationFlow");

    const authHeader = token ? 'Bearer ' + token : null;
    const storedUserId = localStorage.getItem('userId'); // always Mongo _id
    if (!storedUserId) {
      L("❌ No userId in localStorage → cannot save options");
      return { ok: false, reason: 'no-userid' };
    }

    function getGeolocationPromise(timeout = 10000) {
      return new Promise((resolve, reject) => {
        if (!navigator.geolocation) return reject(new Error('Geolocation not supported'));

        navigator.geolocation.getCurrentPosition(
          pos => {
            L("✅ Geolocation success");
            resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: pos.coords.accuracy || 2000 });
          },
          err => {
            L("❌ Geolocation error:", err);
            reject(err);
          },
          { enableHighAccuracy: true, timeout, maximumAge: 0 }
        );
      });
    }

    async function ipFallbackLocation() {
      try {
        const r = await fetch('https://ipapi.co/json/');
        if (!r.ok) throw new Error(`ipapi failed ${r.status}`);
        const j = await r.json();
        L("🌐 IP fallback success");
        return { latitude: Number(j.latitude), longitude: Number(j.longitude), accuracy: 5000 };
      } catch (e) {
        L("❌ ipFallback failed:", e);
        return null;
      }
    }

    let loc = null;
    try {
      loc = await getGeolocationPromise(8000);
    } catch (geoErr) {
      L('⚠️ Geolocation failed, trying IP fallback');
      loc = await ipFallbackLocation();
    }

    if (!loc) {
      L('❌ No location available; skipping candidates/options save');
      return { ok: false, reason: 'no-location' };
    }

    const candResp = await fetch('/api/location/candidates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(loc)
    });
    const candJson = await safeJson(candResp);
    L('/candidates response', candResp.status);

    if (!candResp.ok || !Array.isArray(candJson?.talukas)) {
      L('❌ /candidates did not return talukas; skipping save', candJson);
      return { ok: false, reason: 'no-candidates' };
    }

    const options = (candJson.talukas || []).map(t => {
      const lat = Number(t.lat ?? t.latitude ?? (t.center && t.center.lat));
      const lng = Number(t.lng ?? t.lon ?? t.longitude ?? (t.center && t.center.lon));
      return {
        id: t.id || t.place_id || null,
        lat: Number.isFinite(lat) ? lat : null,
        lng: Number.isFinite(lng) ? lng : null,
        address: t.address || t.display_name || t.name || null,
        distance_m: Number(t.distance_m ?? t.distance ?? null) || null,
        raw: t
      };
    }).filter(o => Number.isFinite(o.lat) && Number.isFinite(o.lng));

    L('normalized options (client count)', options.length);

    if (!options.length) {
      L('❌ No normalized options returned from candidates; skipping save');
      return { ok: false, reason: 'no-options' };
    }

    const userId = localStorage.getItem('userId');
    if (!userId) {
      L('❌ Missing userId in localStorage — aborting options save');
      return { ok:false, reason:'no-userid' };
    }

    const payload = { userId, options };
    const headers = { 'Content-Type': 'application/json', 'x-user-id': userId };
    if (authHeader) headers['Authorization'] = authHeader;

    const saveResp = await fetch('/api/location/options', {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });
    const saveJson = await safeJson(saveResp);
    L('/options save response', saveResp.status, saveJson?.success ? `savedCount=${saveJson.savedCount}` : saveJson);

    return { ok: saveResp.ok, savedCount: saveJson?.savedCount || 0, body: saveJson };
  }

  window.handleLocationFlow = handleLocationFlow;

  // ---- Signup ----
  async function signupHandler(e) {
    e.preventDefault();
    const btn = document.querySelector('#signupForm button[type="submit"]');
    setBtnLoading(btn, true, 'Signing up');

    const name = document.getElementById('signupName')?.value.trim();
    const email = document.getElementById('signupEmail')?.value.trim();
    const password = document.getElementById('signupPassword')?.value;

    try {
      const res = await fetch(`${API_BASE}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password })
      });
      const data = await safeJson(res);
      if (res.ok && data.token) {
        localStorage.setItem('token', data.token);
        localStorage.setItem('userName', data.user?.name || '');
        localStorage.setItem('userId', data.user?.id || data.user?._id || '');

        trySaveLocationThenRedirect(data.token, 'dashboard.html');
      } else {
        alert(data.msg || 'Signup failed');
      }
    } catch (err) {
      console.error(err);
      alert('Network error');
    } finally {
      setBtnLoading(btn, false);
    }
  }

  // ---- Login ----
  async function loginHandler(e) {
    e.preventDefault();
    const btn = document.querySelector('#loginForm button[type="submit"]');
    setBtnLoading(btn, true, 'Logging in');

    const email = document.getElementById('loginEmail')?.value.trim();
    const password = document.getElementById('loginPassword')?.value;

    try {
      const res = await fetch(`${API_BASE}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const data = await safeJson(res);
      if (res.ok && data.token) {
        localStorage.setItem('token', data.token);
        localStorage.setItem('userName', data.user?.name || '');
        localStorage.setItem('userId', data.user?.id || data.user?._id || '');

        trySaveLocationThenRedirect(data.token, 'dashboard.html');
      } else {
        alert(data.msg || 'Login failed');
      }
    } catch (err) {
      console.error(err);
      alert('Network error');
    } finally {
      setBtnLoading(btn, false);
    }
  }

  async function trySaveLocationThenRedirect(token, redirectUrl = 'dashboard.html') {
    try {
      if (typeof window.handleLocationFlow === 'function') {
        const saveResult = await withTimeout(window.handleLocationFlow(token), 7000);
        L('location save result (timed):', saveResult);
      }
    } catch (err) {
      L('handleLocationFlow threw', err);
    } finally {
      window.location.href = redirectUrl;
    }
  }

  // ---- Attach ----
  function init() {
    const lf = document.getElementById('loginForm');
    const sf = document.getElementById('signupForm');

    if (lf) {
      lf.onsubmit = null;
      lf.addEventListener('submit', singleSubmission(loginHandler));
    }
    if (sf) {
      sf.onsubmit = null;
      sf.addEventListener('submit', singleSubmission(signupHandler));
    }

    L('auth handlers attached (with debounce + loading state)');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
