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

    const saveResp = await fetch('/api/location/options', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': authHeader || '',
        'x-user-id': userId
      },
      body: JSON.stringify(payload)
    });
    const saveJson = await safeJson(saveResp);
    L('/options save response', saveResp.status, saveJson?.success ? `savedCount=${saveJson.savedCount}` : saveJson);

    return { ok: saveResp.ok, savedCount: saveJson?.savedCount || 0 };
  }

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

        const saveResult = await handleLocationFlow(data.token);
        alert(`Saved ${saveResult.savedCount || 0} location options`);
        window.location.href = 'dashboard.html';
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

        const saveResult = await handleLocationFlow(data.token);
        alert(`Saved ${saveResult.savedCount || 0} location options`);
        window.location.href = 'dashboard.html';
      } else {
        alert(data.msg || 'Login failed');
      }
    } catch (err) {
      console.error(err);
      alert('Network error');
    }
  }

  // ---- Attach ----
  function init() {
    document.getElementById('signupForm')?.addEventListener('submit', signupHandler);
    document.getElementById('loginForm')?.addEventListener('submit', loginHandler);
    L('auth handlers attached');
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
