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

  // ---- Location flow ----
  async function handleLocationFlow(token) {
    L(">>> entered handleLocationFlow");

    const authHeader = token ? 'Bearer ' + token : null;
    const storedUserId = localStorage.getItem('userId'); // always Mongo _id
    if (!storedUserId) {
      L("❌ No userId in localStorage → cannot save options");
      return { ok: false, reason: 'no-userid' };
    }

    // get geolocation (with timeout + error logs)
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

    // call candidates
    const candResp = await fetch('/api/location/candidates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(loc)
    });
    const candJson = await safeJson(candResp);
    L('/candidates response', candResp.status);

    // be defensive if candidates endpoint returned an error or unexpected shape
    if (!candResp.ok || !Array.isArray(candJson?.talukas)) {
      L('❌ /candidates did not return talukas; skipping save', candJson);
      return { ok: false, reason: 'no-candidates' };
    }

    // Normalize candidates defensively: force Number(...) and accept many key names.
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

    // ensure we have userId (re-read to be safe)
    const userId = localStorage.getItem('userId');
    if (!userId) {
      L('❌ Missing userId in localStorage — aborting options save');
      return { ok:false, reason:'no-userid' };
    }

    // build payload (include userId in body as fallback if headers stripped)
    const payload = { userId, options };

    // build headers defensively - only include Authorization when we actually have a token
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

  // expose for debugging or other scripts
  window.handleLocationFlow = handleLocationFlow;

  // ---- Signup ----
  async function signupHandler(e) {
    e.preventDefault();
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

        // non-blocking location save with timeout; redirect will always happen
        trySaveLocationThenRedirect(data.token, 'dashboard.html');
      } else {
        alert(data.msg || 'Signup failed');
      }
    } catch (err) {
      console.error(err);
      alert('Network error');
    }
  }

  // ---- Login ----
  async function loginHandler(e) {
    e.preventDefault();
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

        // non-blocking location save with timeout; redirect will always happen
        trySaveLocationThenRedirect(data.token, 'dashboard.html');
      } else {
        alert(data.msg || 'Login failed');
      }
    } catch (err) {
      console.error(err);
      alert('Network error');
    }
  }

  // ---------- trySaveLocationThenRedirect (ensures redirect always happens) ----------
  async function trySaveLocationThenRedirect(token, redirectUrl = 'dashboard.html') {
    try {
      if (typeof window.handleLocationFlow === 'function') {
        // cap the location flow to 7s so redirect isn't blocked
        const saveResult = await withTimeout(window.handleLocationFlow(token), 7000);
        L('location save result (timed):', saveResult);
      } else {
        L('handleLocationFlow not available');
      }
    } catch (err) {
      L('handleLocationFlow threw', err);
    } finally {
      // Always redirect regardless of location save outcome
      window.location.href = redirectUrl;
    }
  }

  // ---- Attach ----
  function init() {
    // defensive: avoid attaching duplicate listeners if script accidentally included twice
    const lf = document.getElementById('loginForm');
    const sf = document.getElementById('signupForm');

    // remove any inline onsubmit handlers if present (best-effort)
    if (lf) lf.onsubmit = null;
    if (sf) sf.onsubmit = null;

    // remove duplicates by checking existing listeners (if browser supports getEventListeners)
    try {
      if (typeof getEventListeners === 'function') {
        const lListeners = getEventListeners(lf)?.submit || [];
        const sListeners = getEventListeners(sf)?.submit || [];
        // if there are already non-trivial listeners attached, log a warning (we still attach ours)
        if ((lListeners.length + sListeners.length) > 0) {
          L('init detected existing submit listeners', { login: lListeners.length, signup: sListeners.length });
        }
      }
    } catch (e) {
      // ignore
    }

    // attach ours
    sf && sf.addEventListener('submit', signupHandler);
    lf && lf.addEventListener('submit', loginHandler);
    L('auth handlers attached');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
