// dashboard.js
// Cleaned single-file ready-to-paste version (minimal changes):
// - Ensures `map` is created before use
// - Single drawnItems + drawControl
// - Smart OSM <-> Satellite switching
// - Keeps your existing loadLocationOptions(), analysis and PDF logic
// - READS `floors` and `soilType` from UI (not constants). Falls back gently if missing.

// ----------------- ELEMENTS -----------------
const analyzeBtn = document.getElementById("analyzeBtn");
const analysisResult = document.getElementById("analysisResult");
const designCard = document.getElementById("designCard");
const outputCard = document.getElementById("outputCard");
const userName = document.getElementById("userName");
const roofAreaSpan = document.getElementById("roofArea");

// New elements for location dropdown
const locationSelect = document.getElementById("locationSelect");
const locationMeta = document.getElementById("locationMeta");

// ===== CONFIG =====
const API_BASE = (location.hostname === 'localhost') ? 'http://localhost:10000' : '';
const token = localStorage.getItem("token");
if (!token) window.location.href = "auth.html";
userName.textContent = localStorage.getItem("userName") || "User";

// ----------------- MAP SETUP -----------------
// Create the Leaflet map (ensure this exists before we add layers / draw controls)
const map = L.map("map").setView([18.5204, 73.8567], 13); // Default Pune

// --- Base layers + smart zoom fallback (Option A) ---
const osm = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "© OpenStreetMap contributors",
  maxZoom: 19
});

const esriSat = L.tileLayer(
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  {
    attribution: "Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics",
    maxNativeZoom: 17, // imagery only to z17 in many places
    maxZoom: 20
  }
);

const esriLabels = L.tileLayer(
  "https://services.arcgisonline.com/arcgis/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
  {
    attribution: "Labels © Esri",
    maxNativeZoom: 17,
    maxZoom: 20
  }
);

// Start with OSM (good for area names at low zoom)
osm.addTo(map);

// Smart switching rules:
// - zoom <= 13  => OSM
// - zoom 14..17 => ESRI Satellite + labels
// - zoom > 17   => OSM (crisp tiles, avoid upscaled satellite blur)
map.on('zoomend', () => {
  const z = map.getZoom();

  if (z >= 14 && z <= 20) {
    if (!map.hasLayer(esriSat)) {
      if (map.hasLayer(osm)) map.removeLayer(osm);
      esriSat.addTo(map);
      esriLabels.addTo(map);
    }
  } else {
    if (!map.hasLayer(osm)) {
      if (map.hasLayer(esriSat)) map.removeLayer(esriSat);
      if (map.hasLayer(esriLabels)) map.removeLayer(esriLabels);
      osm.addTo(map);
    }
  }
});

// ----------------- Draw Control (single, correct setup) -----------------
const drawnItems = new L.FeatureGroup();
map.addLayer(drawnItems);

const drawControl = new L.Control.Draw({
  draw: {
    polyline: false,
    rectangle: false,
    circle: false,
    marker: false,
    circlemarker: false,
    polygon: { allowIntersection: false, showArea: true, showLength: false }
  },
  edit: { featureGroup: drawnItems }
});
map.addControl(drawControl);

// Utility: convert Leaflet latlngs to GeoJSON polygon coordinates for turf
function latlngsToTurfPolygon(latlngs) {
  const coords = latlngs.map((p) => [p.lng, p.lat]);
  if (coords.length && (coords[0][0] !== coords[coords.length-1][0] || coords[0][1] !== coords[coords.length-1][1])) {
    coords.push(coords[0]);
  }
  return turf.polygon([coords]);
}

// When user creates polygon
map.on(L.Draw.Event.CREATED, (e) => {
  drawnItems.clearLayers(); // allow only one polygon at a time
  const layer = e.layer;
  drawnItems.addLayer(layer);

  const latlngs = layer.getLatLngs()[0];
  try {
    const poly = latlngsToTurfPolygon(latlngs);
    const area = turf.area(poly); // m²
    window.selectedRoofArea = Math.round(area);
    roofAreaSpan.textContent = window.selectedRoofArea;
  } catch (err) {
    console.warn("Area calc failed, falling back to L.GeometryUtil if available", err);
    if (L.GeometryUtil && typeof L.GeometryUtil.geodesicArea === "function") {
      const fallback = L.GeometryUtil.geodesicArea(latlngs);
      window.selectedRoofArea = Math.round(fallback);
      roofAreaSpan.textContent = window.selectedRoofArea;
    } else {
      window.selectedRoofArea = 0;
      roofAreaSpan.textContent = 0;
    }
  }
});

// If polygon edited, update area too
map.on(L.Draw.Event.EDITED, (e) => {
  const layers = e.layers;
  layers.eachLayer((layer) => {
    const latlngs = layer.getLatLngs()[0];
    try {
      const poly = latlngsToTurfPolygon(latlngs);
      const area = turf.area(poly);
      window.selectedRoofArea = Math.round(area);
      roofAreaSpan.textContent = window.selectedRoofArea;
    } catch (err) {
      console.warn("Edited area calc fallback", err);
      window.selectedRoofArea = window.selectedRoofArea || 0;
    }
  });
});

// ----------------- LOCATION: load, display, save -----------------
function showLocationMeta(loc) {
  if (!locationMeta) return;
  if (!loc) {
    locationMeta.classList.add('hidden');
    locationMeta.textContent = '';
    return;
  }
  locationMeta.classList.remove('hidden');
  locationMeta.textContent = `${loc.address || 'Unknown'} — lat:${loc.lat ?? 'N/A'}, lng:${loc.lng ?? 'N/A'}`;
}

/**
 * Populate select with location options.
 * Minimal, safe implementation — creates options and stores a JSON string on data-loc.
 */
function populateLocationSelect(options = [], chosenLocation = null) {
  if (!locationSelect) return;

  // start fresh with placeholder
  locationSelect.innerHTML = '';
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = '-- Select Location --';
  locationSelect.appendChild(placeholder);

  options.forEach((loc, i) => {
    const opt = document.createElement('option');
    const idStr = (loc && loc.id) ? String(loc.id) : ('loc_' + i);
    opt.value = idStr;
    opt.textContent = loc.address || (loc.lat !== undefined && loc.lng !== undefined ? `${loc.lat}, ${loc.lng}` : `Location ${i+1}`);

    // store minimal useful object so caller can POST it back
    opt.dataset.loc = JSON.stringify({
      id: idStr,
      address: loc.address || null,
      lat: loc.lat ?? null,
      lng: loc.lng ?? null,
      raw: loc.raw ?? null,
      distance_m: loc.distance_m ?? null
    });

    locationSelect.appendChild(opt);
  });

  // preselect chosenLocation if provided (match by id or coords)
  if (chosenLocation) {
    const chosenId = (chosenLocation.id !== undefined) ? String(chosenLocation.id) : null;
    for (let i = 0; i < locationSelect.options.length; i++) {
      const o = locationSelect.options[i];
      if (!o.dataset.loc) continue;
      try {
        const L = JSON.parse(o.dataset.loc);
        if (chosenId && String(L.id) === chosenId) {
          locationSelect.selectedIndex = i;
          showLocationMeta(L);
          break;
        }
        if (chosenLocation.lat !== undefined && chosenLocation.lng !== undefined &&
            Number(L.lat) === Number(chosenLocation.lat) && Number(L.lng) === Number(chosenLocation.lng)) {
          locationSelect.selectedIndex = i;
          showLocationMeta(L);
          break;
        }
      } catch (e) { /* ignore parse errors */ }
    }
  }
}

/*
  loadLocationOptions:
   - first tries GET with Authorization
   - if response non-OK (400/401/5xx), logs response body and then tries a second GET without Authorization (fallback test)
   - if still non-OK, it writes the server message into the dropdown and logs details to console
*/
async function loadLocationOptions() {
  if (!locationSelect) return;

  // include userId query param if present (server requires valid userId)
  const userId = localStorage.getItem('userId') || '';
  const qs = userId ? ('?userId=' + encodeURIComponent(userId)) : '';
  const url = API_BASE + '/api/location/options' + qs;

  async function doFetch(withAuth) {
    const headers = {};
    if (withAuth && token) headers['Authorization'] = `Bearer ${token}`;
    try {
      const res = await fetch(url, { method: 'GET', headers });
      const text = await res.text().catch(() => '');
      let json = {};
      try { json = text ? JSON.parse(text) : {}; } catch (e) { /* not json */ }
      return { ok: res.ok, status: res.status, text, json };
    } catch (err) {
      return { ok: false, status: 0, text: '', json: null, error: err };
    }
  }

  // 1) Try with Authorization header (if token present)
  const primary = await doFetch(true);
  console.log('loadLocationOptions primary result:', primary);

  if (primary.ok) {
    const options = Array.isArray(primary.json.locationOptions) ? primary.json.locationOptions : [];
    const chosen = primary.json.chosenLocation || null;
    populateLocationSelect(options, chosen);
    return;
  }

  // 2) Fallback: try without Authorization (debug)
  console.warn('Primary /api/location/options fetch failed', primary.status, primary.text || primary.error);
  const fallback = await doFetch(false);
  console.log('loadLocationOptions fallback result (no auth):', fallback);

  if (fallback.ok) {
    const options = Array.isArray(fallback.json.locationOptions) ? fallback.json.locationOptions : [];
    const chosen = fallback.json.chosenLocation || null;
    populateLocationSelect(options, chosen);
    console.warn('Options loaded without Authorization header — check backend auth rules.');
    return;
  }

  // 3) If both failed, show server message or helpful hint
  const debugMessage = primary.text || fallback.text || (primary.error ? String(primary.error) : `HTTP ${primary.status} / HTTP ${fallback.status}`);

  // If there was no userId, give a clearer hint
  if (!userId) {
    locationSelect.innerHTML = '';
    const o = document.createElement('option');
    o.value = '';
    o.textContent = 'Error: missing userId in localStorage (please login again)';
    locationSelect.appendChild(o);
    console.error('loadLocationOptions failed: no userId in localStorage and server response:', debugMessage);
    return;
  }

  // Otherwise show server response snippet
  locationSelect.innerHTML = '';
  const o = document.createElement('option');
  o.value = '';
  o.textContent = `Error loading locations: ${debugMessage.substring(0, 120)}${debugMessage.length>120?'...':''}`;
  locationSelect.appendChild(o);
  console.error('Failed to load location options (both attempts). Server said:', debugMessage);
}

// save chosen location to server
async function saveChosenLocation(locObj) {
  if (!locObj) return;
  try {
    const url = API_BASE + '/api/location/choice' + (localStorage.getItem('userId') ? ('?userId=' + encodeURIComponent(localStorage.getItem('userId'))) : '');
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token || ''}`
      },
      body: JSON.stringify({ choice: locObj })
    });
    const json = await res.json().catch(() => null);
    if (res.ok && json && json.success) {
      console.log('chosenLocation saved', json.chosenLocation || locObj);
    } else {
      console.warn('Could not save chosenLocation', res.status, json);
    }
  } catch (err) {
    console.error('saveChosenLocation error', err);
  }
}

// wire selection change: when user selects, show meta, save, and move map
if (locationSelect) {
  locationSelect.addEventListener('change', (e) => {
    const opt = e.target.selectedOptions[0];
    if (!opt || !opt.dataset.loc || opt.value === '') {
      showLocationMeta(null);
      return;
    }
    let loc;
    try {
      loc = JSON.parse(opt.dataset.loc);
    } catch (err) {
      console.error('Failed to parse selected loc', err);
      showLocationMeta(null);
      return;
    }

    // display in UI
    showLocationMeta(loc);

    // save (fire-and-forget)
    saveChosenLocation(loc);

    // Center map on coordinates (no pin)
    if (loc.lat !== null && loc.lng !== null) {
      map.setView([loc.lat, loc.lng], 12); // adjust zoom as needed
    }
  });
}

// initialize dropdown
loadLocationOptions();

// ----------------- ANALYSIS (call backend) -----------------
// ----------------- ANALYSIS (call backend) -----------------
analyzeBtn.addEventListener("click", async () => {
  // Ensure roof polygon exists / area is selected
  const roofArea = window.selectedRoofArea || 0;
  if (!roofArea || roofArea <= 0) {
    alert("Please draw your roof polygon on the map first!");
    return;
  }

  // Show running UI
  analysisResult.classList.remove("hidden");
  analysisResult.innerHTML = `<p class="text-lg text-gray-500">🔄 Running analysis...</p>`;

  // 1) Try to obtain lat/lng: prefer selected dropdown location
  let lat = NaN, lng = NaN;
  if (locationSelect && locationSelect.selectedOptions.length > 0) {
    const opt = locationSelect.selectedOptions[0];
    if (opt && opt.dataset && opt.dataset.loc && opt.value !== '') {
      try {
        const loc = JSON.parse(opt.dataset.loc);
        lat = Number(loc.lat);
        lng = Number(loc.lng);
      } catch (err) {
        console.warn("Could not parse dataset.loc from selected option", err);
      }
    }
  }

  // 2) If dropdown didn't provide coords, fallback to polygon centroid (if drawn)
  if ((isNaN(lat) || isNaN(lng)) && typeof drawnItems !== "undefined" && drawnItems.getLayers().length > 0) {
    try {
      const layer = drawnItems.getLayers()[0];
      if (layer && typeof layer.getBounds === "function") {
        const c = layer.getBounds().getCenter();
        lat = Number(c.lat);
        lng = Number(c.lng);
      } else if (layer && typeof layer.getLatLngs === "function") {
        const latlngs = layer.getLatLngs()[0] || [];
        if (latlngs && latlngs.length) {
          // try turf centroid if available
          const coords = latlngs.map(p => [p.lng, p.lat]);
          if (coords.length && (coords[0][0] !== coords[coords.length-1][0] || coords[0][1] !== coords[coords.length-1][1])) coords.push(coords[0]);
          if (window.turf) {
            const poly = turf.polygon([coords]);
            const c = turf.centroid(poly);
            lat = c?.geometry?.coordinates?.[1];
            lng = c?.geometry?.coordinates?.[0];
          } else {
            // simple average fallback
            const avg = coords.reduce((acc, cur) => [acc[0]+cur[0], acc[1]+cur[1]], [0,0]).map(v=>v/coords.length);
            lng = avg[0]; lat = avg[1];
          }
        }
      }
    } catch (err) {
      console.warn("Could not determine polygon center", err);
    }
  }

  // Get other inputs
  const dwellers = parseInt(document.getElementById("dwellersInput").value) || NaN;
  const roofTypeEl = document.getElementById("roofTypeInput") || document.getElementById("roofType");
  const roofType = (roofTypeEl && roofTypeEl.value) ? roofTypeEl.value : null;

  // NEW: read floors from UI (if present). If missing, try parseInt on #floors; else NaN.
  let floors = NaN;
  const floorsEl = document.getElementById("floors");
  if (floorsEl) {
    const fRaw = (floorsEl.value ?? '').toString().trim();
    floors = fRaw === '' ? NaN : parseInt(fRaw);
    if (!isNaN(floors) && floors < 0) floors = NaN;
  }

  // NEW: read soilType from UI if present
  const soilEl = document.getElementById("soilType");
  const soilType = soilEl ? (soilEl.value || null) : null;

  // Validate required fields (backend expects: lat, lng, roofArea, roofType, dwellers)
  if (isNaN(lat) || isNaN(lng) || isNaN(roofArea) || !roofType || isNaN(dwellers) || isNaN(floors)) {
    analysisResult.innerHTML = `<p class="text-red-600">❌ Missing or invalid fields. Required: lat, lng, roofArea, roofType, dwellers, floors</p>`;
    console.warn("Missing inputs for /api/calc", { lat, lng, roofArea, roofType, dwellers, floors });
    return;
  }

  try {
    const url = API_BASE + '/api/calc';

    // Build payload: include floors and soilType if available
    const payload = { lat, lng, roofArea, roofType, dwellers, floors };
    if (soilType) payload.soilType = soilType;

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(payload)
    });

    const data = await res.json().catch(() => null);

    if (!res.ok || !data || !data.success) {
      const msg = (data && data.message) ? data.message : `Server error (${res.status})`;
      analysisResult.innerHTML = `<p class="text-red-600">❌ ${msg}</p>`;
      console.error("Calculation failed", res.status, data);
      return;
    }

    // Normalize server fields (be tolerant of different naming):
    const litersPerYear = data.runoff_liters_per_year ?? data.litersPerYear ?? data.runoff ?? 0;
    const estimatedCost = data.costs?.total_estimated_installation_cost ?? data.estimatedCost ?? data.cost ?? 0;
    const suffMonths = data.sufficiencyMonths ?? data.sufficiency_months ?? data.sufficiency ?? null;
    const suggestion = data.suggestion ?? data.recommendation ?? null;
    const feasibilityFlag = (typeof data.feasibility === 'boolean') ? (data.feasibility ? "YES" : "NO") : (data.feasibility ?? ((data.coverageRatio && data.coverageRatio >= 0.25) ? "YES" : "NO"));

    // Show result summary (keeps your existing UI)
    analysisResult.innerHTML = `
      <p class="text-lg">Feasibility: 
        <span class="font-bold ${feasibilityFlag === "YES" ? "text-green-600" : "text-red-600"}">
          ${feasibilityFlag}
        </span>
      </p>
      <p class="mt-2">Estimated Harvesting Capacity: 
        <span class="font-bold">${(litersPerYear || 0).toLocaleString()} Liters/year</span>
      </p>
      <p class="mt-2">Estimated Cost: 
        <span class="font-bold text-yellow-700">₹${Number(estimatedCost || 0).toLocaleString()}</span>
      </p>
      <p class="mt-2">Water Sufficiency: 
        <span class="font-bold">${suffMonths !== null ? suffMonths : (data.coverageRatio ? Math.round((data.coverageRatio || 0) * 12) : "N/A")} months</span>
      </p>
      <p class="mt-2">Suggestion: 
        <span class="font-bold text-blue-600">${suggestion || (data.filters?.chosen?.name) || "Consider Recharge Pit with supplemental sources"}</span>
      </p>
    `;

    // design + impact (same as before)
    designCard.classList.remove("hidden");
    designCard.innerHTML = `
      <h3 class="text-xl font-semibold text-blue-600">Suggested Structure</h3>
      <p class="mt-2 text-gray-700">${suggestion || (data.filters?.chosen?.name) || "See detailed recommendations below."}</p>
      <p class="mt-1 text-gray-700">Estimated Cost: ₹${Number(estimatedCost || 0).toLocaleString()}</p>
    `;

    outputCard.classList.remove("hidden");
    outputCard.innerHTML = `
      <p class="text-lg font-medium">💧 You can save 
        <span class="font-bold text-green-700">${(litersPerYear || 0).toLocaleString()} Liters/year</span>
      </p>
      <p class="mt-2">📅 Covers 
        <span class="font-bold">${suffMonths !== null ? suffMonths : (data.coverageRatio ? Math.round((data.coverageRatio || 0) * 12) : "N/A")} months</span> of family needs</p>
      <p class="mt-2">🏙 Equivalent to water for 
        <span class="font-bold">${Math.round((litersPerYear || 0) / 10000)} households</span></p>
      <div class="mt-4 flex flex-col md:flex-row gap-3 justify-center">
        <button id="downloadReportBtn" class=" no-pdf bg-blue-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-blue-700 transition">
          Download Technical Report (PDF)
        </button>
        <button id="govtDocsBtn" class="no-pdf bg-yellow-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-yellow-700 transition">
          📑 Govt Documentation Checklist
        </button>
      </div>
    `;

    // wire download button - pass a consistent reportData object expected by generatePDF
    document.getElementById("downloadReportBtn").addEventListener("click", async () => {
      const reportData = {
        district: (locationSelect.selectedOptions[0] && locationSelect.selectedOptions[0].dataset.loc) ? JSON.parse(locationSelect.selectedOptions[0].dataset.loc).address : "",
        roofType,
        dwellers,
        rainfall_mm: data.rainfall_mm ?? data.rainfall ?? null,
        litersPerYear,
        estimatedCost,
        sufficiencyMonths: suffMonths,
        suggestion: suggestion,
        // include raw server payload for full detail in PDF if needed
        server: data
      };
      await generatePDF(reportData);
    });

    // optional: show govt docs (simple modal or link)
    document.getElementById("govtDocsBtn").addEventListener("click", () => {
      alert("Govt documentation checklist will be shown (you can convert this to a modal/pdf).");
    });

  } catch (err) {
    console.error(err);
    analysisResult.innerHTML = `<p class="text-red-600">❌ Error: Could not connect to server</p>`;
  }
});


// ----------------- PDF GENERATION -----------------
async function generatePDF(reportData) {
  if (!window.jspdf) {
    alert("PDF library (jsPDF) not loaded. Confirm jspdf script is included.");
    console.error("jsPDF missing");
    return;
  }
  if (!window.html2canvas) {
    alert("html2canvas not loaded. Confirm html2canvas script is included.");
    console.error("html2canvas missing");
    return;
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 40;
  let cursorY = 48;

  // Header
  doc.setFontSize(18);
  doc.text("JalRakshak — Technical Report", margin, cursorY);
  cursorY += 20;
  doc.setFontSize(11);

  const user = localStorage.getItem("userName") || "User";
  const metaLines = [
    `Prepared for: ${user}`,
    `District: ${reportData.district || "N/A"}`,
    `Roof Area (m²): ${window.selectedRoofArea || "N/A"}`,
    `Roof Type: ${reportData.roofType || "N/A"}`,
    `Dwellers: ${reportData.dwellers || "N/A"}`,
    `Annual Rainfall used: ${reportData.rainfall_mm || "N/A"} mm`,
    `Potential harvest: ${reportData.litersPerYear ? reportData.litersPerYear.toLocaleString() + " litres/year" : "N/A"}`,
    `Estimated cost: ${reportData.estimatedCost ? "₹" + reportData.estimatedCost.toLocaleString() : "N/A"}`,
    `Water sufficiency: ${reportData.sufficiencyMonths || "N/A"} months`,
    `Suggestion: ${reportData.suggestion || "N/A"}`
  ];

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  for (const ln of metaLines) {
    if (cursorY > pageH - 120) { doc.addPage(); cursorY = 48; }
    doc.text(ln, margin, cursorY);
    cursorY += 16;
  }

  // capture map + output card
  const mapEl = document.getElementById("map");
  const outputEl = document.getElementById("outputCard");
  const pdfHideEls = Array.from(document.querySelectorAll('.no-pdf'));
  pdfHideEls.forEach(el => el.style.display = 'none');

  async function captureElementToDataURL(el, scale = 1) {
    if (!el) return null;
    const canvas = await html2canvas(el, { scale: scale, useCORS: true, logging: false, backgroundColor: null });
    try { return canvas.toDataURL("image/png"); }
    catch (err) { console.warn("Canvas toDataURL failed (likely CORS/taint):", err); throw err; }
  }

  let mapDataUrl = null;
  let outputDataUrl = null;
  try {
    if (mapEl) mapDataUrl = await captureElementToDataURL(mapEl, 1.5);
    if (outputEl) outputDataUrl = await captureElementToDataURL(outputEl, 1.5);
  } catch (captureErr) {
    console.warn("Element capture failed. Will generate PDF without map/image.", captureErr);
  }

  try {
    if (mapDataUrl) {
      await new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          const maxW = pageW - margin * 2;
          const maxH = pageH - cursorY - 150;
          const ratio = Math.min(maxW / img.width, maxH / img.height, 1);
          const drawW = (img.width * ratio) - 100;
          const drawH = img.height * ratio;
          if (cursorY + drawH > pageH - 60) { doc.addPage(); cursorY = 48; }
          doc.addImage(mapDataUrl, "PNG", margin, cursorY, drawW, drawH);
          cursorY += drawH + 12;
          resolve();
        };
        img.onerror = () => resolve();
        img.src = mapDataUrl;
      });
    }
  } catch (err) { console.warn("Inserting map image into PDF failed:", err); }

  try {
    if (outputDataUrl) {
      await new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          const maxW = pageW - margin * 2;
          const maxH = pageH - cursorY - 80;
          const ratio = Math.min(maxW / img.width, maxH / img.height, 1);
          const drawW = img.width * ratio;
          const drawH = img.height * ratio;
          if (cursorY + drawH > pageH - 60) { doc.addPage(); cursorY = 48; }
          doc.addImage(outputDataUrl, "PNG", margin, cursorY, drawW, drawH);
          cursorY += drawH + 12;
          resolve();
        };
        img.onerror = () => resolve();
        img.src = outputDataUrl;
      });
    }
  } catch (err) { console.warn("Inserting output image into PDF failed:", err); }

  doc.setFontSize(9);
  doc.text("Generated by JalRakshak 1.0", margin, pageH - 28);

  const districtSafe = (reportData.district || "report").replace(/[^\w\-]/g, "_");
  const filename = `JalRakshak_Report_${districtSafe}.pdf`;
  try {
    doc.save(filename);
    console.log("PDF saved:", filename);
  } catch (err) {
    console.error("Failed to save PDF:", err);
    alert("PDF generation failed. See console for details.");
  }

  pdfHideEls.forEach(el => el.style.display = '');
}
