/* auth.js - reliable auth + location flow (always request geolocation first) */
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
    const storedUserId = localStorage.getItem('userId');
    if (!storedUserId) {
      L("❌ No userId in localStorage → cannot save options");
      return { ok: false, reason: 'no-userid' };
    }

    function getGeolocationPromise(timeout = 8000) {
      return new Promise((resolve, reject) => {
        if (!navigator.geolocation) return reject(new Error('Geolocation not supported'));

        navigator.geolocation.getCurrentPosition(
          pos => {
            L("✅ Geolocation success");
            resolve({
              latitude: pos.coords.latitude,
              longitude: pos.coords.longitude,
              accuracy: pos.coords.accuracy || 2000
            });
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

    // --- Always try browser geolocation first ---
    let loc = null;
    try {
      loc = await getGeolocationPromise(8000);
    } catch (geoErr) {
      if (geoErr.code === 1) { // PERMISSION_DENIED
        alert("We need your location permission to continue. Please allow access in your browser.");
        return { ok: false, reason: 'permission-denied' };
      }
      L('⚠️ Geolocation failed (timeout or error), using IP fallback');
      loc = await ipFallbackLocation();
    }

    if (!loc) {
      L('❌ No location available; skipping candidates/options save');
      return { ok: false, reason: 'no-location' };
    }

    // --- Fetch candidates ---
    const candResp = await fetch('/api/location/candidates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(loc)
    });
    const candJson = await safeJson(candResp);
    L('/candidates response', candResp.status, candJson);

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
    if (!options.length) return { ok: false, reason: 'no-options' };

    const userId = localStorage.getItem('userId');
    if (!userId) return { ok:false, reason:'no-userid' };

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
    L('/options save response', saveResp.status, saveJson);

    return { ok: saveResp.ok, savedCount: saveJson?.savedCount || 0 };
  }

  // ---- Signup/Login handlers ----
  async function signupHandler(e) {
    e.preventDefault();
    const name = document.getElementById('signupName')?.value.trim();
    const email = document.getElementById('signupEmail')?.value.trim();
    const password = document.getElementById('signupPassword')?.value;
    try {
      const res = await fetch(`${API_BASE}/register`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
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
      } else { alert(data.msg || 'Signup failed'); }
    } catch (err) { console.error(err); alert('Network error'); }
  }

  async function loginHandler(e) {
    e.preventDefault();
    const email = document.getElementById('loginEmail')?.value.trim();
    const password = document.getElementById('loginPassword')?.value;
    try {
      const res = await fetch(`${API_BASE}/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
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
      } else { alert(data.msg || 'Login failed'); }
    } catch (err) { console.error(err); alert('Network error'); }
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
