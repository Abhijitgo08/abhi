// dashboard.js (patched to include full /api/calc contents in output & PDF)

// ----------------- ELEMENTS -----------------
const analyzeBtn = document.getElementById("analyzeBtn");
const analysisResult = document.getElementById("analysisResult");
const designCard = document.getElementById("designCard");
const outputCard = document.getElementById("outputCard");
const userName = document.getElementById("userName");
const roofAreaSpan = document.getElementById("roofArea");
const locationSelect = document.getElementById("locationSelect");
const locationMeta = document.getElementById("locationMeta");

// ===== CONFIG =====
const API_BASE = (location.hostname === 'localhost') ? 'http://localhost:10000' : '';
const token = localStorage.getItem("token");
userName.textContent = localStorage.getItem("userName") || "User";

// ----------------- MAP + DRAW -----------------
// Create map
const map = L.map("map").setView([18.5204, 73.8567], 13);

// Base tiles and smart switching
const osm = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "© OpenStreetMap contributors",
  maxZoom: 19
});
const esriSat = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
  attribution: "Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics",
  maxNativeZoom: 17,
  maxZoom: 20
});
const esriLabels = L.tileLayer("https://services.arcgisonline.com/arcgis/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}", {
  attribution: "Labels © Esri",
  maxNativeZoom: 17,
  maxZoom: 20
});
osm.addTo(map);
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

// Draw layer / control
const drawnItems = new L.FeatureGroup();
map.addLayer(drawnItems);
const drawControl = new L.Control.Draw({
  draw: {
    polyline: false, rectangle: false, circle: false, marker: false, circlemarker: false,
    polygon: { allowIntersection: false, showArea: true, showLength: false }
  },
  edit: { featureGroup: drawnItems }
});
map.addControl(drawControl);

// Utility: convert latlngs to turf polygon
function latlngsToTurfPolygon(latlngs) {
  const coords = latlngs.map((p) => [p.lng, p.lat]);
  if (coords.length && (coords[0][0] !== coords[coords.length-1][0] || coords[0][1] !== coords[coords.length-1][1])) coords.push(coords[0]);
  return turf.polygon([coords]);
}

// When user creates polygon
map.on(L.Draw.Event.CREATED, (e) => {
  drawnItems.clearLayers(); // single polygon only
  const layer = e.layer;
  drawnItems.addLayer(layer);

  const latlngs = layer.getLatLngs()[0];
  try {
    const poly = latlngsToTurfPolygon(latlngs);
    const area = turf.area(poly); // m²
    window.selectedRoofArea = Math.round(area);
    roofAreaSpan.textContent = window.selectedRoofArea;
  } catch (err) {
    console.warn("Area calc failed, falling back", err);
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

// When polygon edited
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

// ----------------- LOCATION: load / save / UI -----------------
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

function populateLocationSelect(options = [], chosenLocation = null) {
  if (!locationSelect) return;
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
      } catch (e) { /* ignore */ }
    }
  }
}

async function loadLocationOptions() {
  if (!locationSelect) return;
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

  const primary = await doFetch(true);
  if (primary.ok) {
    const options = Array.isArray(primary.json.locationOptions) ? primary.json.locationOptions : [];
    const chosen = primary.json.chosenLocation || null;
    populateLocationSelect(options, chosen);
    return;
  }

  // Fallback without auth
  const fallback = await doFetch(false);
  if (fallback.ok) {
    const options = Array.isArray(fallback.json.locationOptions) ? fallback.json.locationOptions : [];
    const chosen = fallback.json.chosenLocation || null;
    populateLocationSelect(options, chosen);
    return;
  }

  const debugMessage = primary.text || fallback.text || (primary.error ? String(primary.error) : `HTTP ${primary.status} / HTTP ${fallback.status}`);
  if (!userId) {
    locationSelect.innerHTML = '';
    const o = document.createElement('option');
    o.value = '';
    o.textContent = 'Error: missing userId in localStorage (please login again)';
    locationSelect.appendChild(o);
    console.error('loadLocationOptions failed: no userId and server response:', debugMessage);
    return;
  }
  locationSelect.innerHTML = '';
  const o = document.createElement('option');
  o.value = '';
  o.textContent = `Error loading locations: ${debugMessage.substring(0, 120)}${debugMessage.length>120?'...':''}`;
  locationSelect.appendChild(o);
  console.error('Failed to load location options (both attempts). Server said:', debugMessage);
}

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

if (locationSelect) {
  locationSelect.addEventListener('change', (e) => {
    const opt = e.target.selectedOptions[0];
    if (!opt || !opt.dataset.loc || opt.value === '') {
      showLocationMeta(null);
      return;
    }
    let loc;
    try { loc = JSON.parse(opt.dataset.loc); } catch (err) { console.error('Failed to parse selected loc', err); showLocationMeta(null); return; }
    showLocationMeta(loc);
    saveChosenLocation(loc);
    if (loc.lat !== null && loc.lng !== null) {
      map.setView([loc.lat, loc.lng], 12);
    }
  });
}
loadLocationOptions();

// ----------------- ANALYSIS: call backend -----------------
analyzeBtn.addEventListener("click", async () => {
  const roofArea = window.selectedRoofArea || 0;
  if (!roofArea || roofArea <= 0) { alert("Please draw your roof polygon on the map first!"); return; }
  analysisResult.classList.remove("hidden"); analysisResult.innerHTML = `<p class="text-lg text-gray-500">🔄 Running analysis...</p>`;

  // 1) lat/lng from selected location or polygon centroid
  let lat = NaN, lng = NaN;
  if (locationSelect && locationSelect.selectedOptions.length > 0) {
    const opt = locationSelect.selectedOptions[0];
    if (opt && opt.dataset && opt.dataset.loc && opt.value !== '') {
      try {
        const loc = JSON.parse(opt.dataset.loc);
        lat = Number(loc.lat);
        lng = Number(loc.lng);
      } catch (err) {
        console.warn("Could not parse selected location", err);
      }
    }
  }

  // fallback: polygon centroid
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
          const coords = latlngs.map(p => [p.lng, p.lat]);
          if (coords.length && (coords[0][0] !== coords[coords.length-1][0] || coords[0][1] !== coords[coords.length-1][1])) coords.push(coords[0]);
          if (window.turf) {
            const poly = turf.polygon([coords]);
            const c = turf.centroid(poly);
            lat = c?.geometry?.coordinates?.[1];
            lng = c?.geometry?.coordinates?.[0];
          } else {
            const avg = coords.reduce((acc, cur) => [acc[0]+cur[0], acc[1]+cur[1]], [0,0]).map(v=>v/coords.length);
            lng = avg[0]; lat = avg[1];
          }
        }
      }
    } catch (err) {
      console.warn("Could not determine polygon center", err);
    }
  }

  const dwellers = parseInt(document.getElementById("dwellersInput").value) || NaN;
  const roofType = document.getElementById("roofTypeInput")?.value || null;

  // extended inputs
  const payload = {
    lat, lng, roofArea, roofType, dwellers,
    soilType: document.getElementById('soilType')?.value || 'loamy',
    floors: Number(document.getElementById('floors')?.value || 0),
    avgFloorHeight: Number(document.getElementById('avgFloorHeight')?.value || 3),
    velocity_m_s: Number(document.getElementById('velocity_m_s')?.value || 1),
    wetMonths: Number(document.getElementById('wetMonths')?.value || 4),
    safetyFactorFilter: Number(document.getElementById('safetyFactorFilter')?.value || 0.8),
    pit_cost_per_m3: Number(document.getElementById('pit_cost_per_m3')?.value || 800),
    designIntensity_mm_per_hr: document.getElementById('designIntensity_mm_per_hr')?.value ? Number(document.getElementById('designIntensity_mm_per_hr').value) : undefined,
    peak_fraction: Number(document.getElementById('peak_fraction')?.value || 0.02),
    design_duration_hours: Number(document.getElementById('design_duration_hours')?.value || 4)
  };

  if (isNaN(lat) || isNaN(lng) || isNaN(roofArea) || !roofType || isNaN(dwellers)) {
    analysisResult.innerHTML = `<p class="text-red-600">❌ Missing or invalid fields. Required: lat, lng, roofArea, roofType, dwellers</p>`;
    console.warn("Missing inputs for /api/calc", { lat, lng, roofArea, roofType, dwellers });
    return;
  }

  try {
    const res = await fetch(API_BASE + '/api/calc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token || ''}` },
      body: JSON.stringify(payload)
    });
    const data = await res.json().catch(() => null);

    if (!res.ok || !data || !data.success) {
      const msg = (data && data.message) ? data.message : `Server error (${res.status})`;
      analysisResult.innerHTML = `<p class="text-red-600">❌ ${msg}</p>`;
      console.error("Calculation failed", res.status, data);
      return;
    }

    // --- Render using route response fields ---
    const litersPerYear = data.runoff_liters_per_year ?? 0;
    const estimatedCost = data.costs?.total_estimated_installation_cost ?? data.estimatedCost ?? 0;
    const infiltrated = data.infiltrated_liters_per_year ?? null;
    const suffMonthsServer = data.sufficiencyMonths ?? null;
    const suffMonthsClient = (infiltrated && dwellers>0) ? Math.round(infiltrated / (dwellers * 85 * 30)) : null;
    const suffMonths = suffMonthsServer ?? suffMonthsClient;

    const suggestion = data.suggestion || (data.filters?.chosen?.name) || 'Consider Recharge Pit with supplemental sources';
    const feasibilityFlag = (typeof data.feasibility === 'boolean') ? (data.feasibility ? 'YES' : 'NO') : (data.feasibility ? data.feasibility : ((data.coverageRatio && data.coverageRatio>=0.25) ? 'YES' : 'NO'));

    const details = [];
    details.push(`<p><strong>Rainfall (mm/year):</strong> ${data.rainfall_mm ?? 'N/A'}</p>`);
    details.push(`<p><strong>Runoff (L/year):</strong> ${(litersPerYear).toLocaleString()}</p>`);
    details.push(`<p><strong>Infiltrated (L/year):</strong> ${infiltrated ? infiltrated.toLocaleString() : 'N/A'}</p>`);
    details.push(`<p><strong>Annual need (L/year):</strong> ${data.annualNeed ? data.annualNeed.toLocaleString() : 'N/A'}</p>`);
    details.push(`<p><strong>Coverage ratio:</strong> ${data.coverageRatio !== undefined ? Number(data.coverageRatio).toFixed(3) : 'N/A'}</p>`);
    details.push(`<p><strong>Peak flow:</strong> ${data.flow?.peak_Q_m3_s ?? 'N/A'} m³/s (${data.flow?.peak_Q_l_s ?? 'N/A'} L/s)</p>`);
    details.push(`<p><strong>Pipe diameter:</strong> ${data.pipe?.calculated_diameter_mm ?? 'N/A'} mm</p>`);
    details.push(`<p><strong>Pit volume:</strong> ${data.pit?.pit_volume_m3 ?? 'N/A'} m³ — Cost: INR ${data.pit?.pit_cost_estimate ?? 'N/A'}</p>`);

    let filtersHtml = '<em>No filter candidates</em>';
    if (Array.isArray(data.filters?.candidates) && data.filters.candidates.length) {
      filtersHtml = '<table class="mx-auto text-left"><thead><tr><th class="px-2">Product</th><th class="px-2">Units</th><th class="px-2">Total Cost (INR)</th></tr></thead><tbody>' +
        data.filters.candidates.map(f => `<tr><td class="px-2">${f.name}</td><td class="px-2">${f.units_required}</td><td class="px-2">${f.total_cost?.toLocaleString?.() ?? f.total_cost}</td></tr>`).join('') +
        '</tbody></table>';
    }

    let pipeHtml = '<em>No pipe data</em>';
    if (Array.isArray(data.pipe?.options) && data.pipe.options.length) {
      const cheapest = data.pipe.chosen_option || data.pipe.options.reduce((b,c)=> c.total_cost < (b?.total_cost ?? Infinity) ? c : b, null);
      pipeHtml = `<p>Chosen pipe: <strong>${cheapest ? cheapest.name + ' — ₹' + (cheapest.total_cost?.toLocaleString?.() ?? cheapest.total_cost) : 'N/A'}</strong></p>`;
    }

    analysisResult.innerHTML = `
      <div class="text-left max-w-2xl mx-auto">
        <p class="text-lg">Feasibility: <span class="font-bold ${feasibilityFlag === 'YES' ? 'text-green-600' : 'text-red-600'}">${feasibilityFlag}</span></p>
        <p class="mt-2">Potential harvest: <strong>${(litersPerYear).toLocaleString()} L/year</strong></p>
        <p class="mt-2">Estimated installation cost: <strong>₹${(estimatedCost || 0).toLocaleString()}</strong></p>
        <p class="mt-2">Water sufficiency (months): <strong>${suffMonths !== null ? suffMonths : 'N/A'}</strong></p>
        <hr class="my-3">
        ${details.join('\n')}
        <h4 class="mt-3">Filter candidates</h4>
        ${filtersHtml}
        <h4 class="mt-3">Pipe recommendation</h4>
        ${pipeHtml}
      </div>
    `;

    designCard.classList.remove('hidden');
    designCard.innerHTML = `
      <h3 class="text-xl font-semibold text-blue-600">Suggested Intervention</h3>
      <p class="mt-2 text-gray-700">${suggestion}</p>
      <ul class="mt-2 text-gray-700 list-disc pl-5">
        <li>Estimated cost: ₹${(estimatedCost || 0).toLocaleString()}</li>
        <li>Recommended pipe dia: ${data.pipe?.calculated_diameter_mm ?? 'N/A'} mm</li>
        <li>Pit volume: ${data.pit?.pit_volume_m3 ?? 'N/A'} m³</li>
      </ul>
    `;

    outputCard.classList.remove('hidden');
    outputCard.innerHTML = `
      <h3 class="text-lg font-semibold">Impact Summary</h3>
      <p class="mt-2">Annual harvest: <strong>${(litersPerYear).toLocaleString()} L/year</strong></p>
      <p class="mt-2">Infiltration: <strong>${infiltrated ? infiltrated.toLocaleString() + ' L/year' : 'N/A'}</strong></p>
      <p class="mt-2">Covers approx: <strong>${suffMonths !== null ? suffMonths + ' months' : 'N/A'}</strong> of household needs</p>
      <div class="mt-4 flex flex-col md:flex-row gap-3 justify-center">
        <button id="downloadReportBtn" class=" no-pdf bg-blue-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-blue-700 transition">Download Technical Report (PDF)</button>
        <button id="govtDocsBtn" class="no-pdf bg-yellow-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-yellow-700 transition">📑 Govt Documentation Checklist</button>
      </div>
      <details class="mt-4 text-left"><summary class="cursor-pointer">Full JSON from server</summary><pre id="serverJson" class="whitespace-pre-wrap mt-2 p-2 bg-gray-100 rounded text-sm" style="max-height:300px;overflow:auto;background:#fff">${JSON.stringify(data, null, 2)}</pre></details>
    `;

    // Attach PDF button
    document.getElementById('downloadReportBtn').addEventListener('click', async () => {
      await generatePDF({
        district: (locationSelect.selectedOptions[0] && locationSelect.selectedOptions[0].dataset.loc) ? JSON.parse(locationSelect.selectedOptions[0].dataset.loc).address : '',
        roofType, dwellers,
        rainfall_mm: data.rainfall_mm, litersPerYear: litersPerYear,
        estimatedCost: estimatedCost, suffMonths, suggestion, serverData: data
      });
    });

    document.getElementById('govtDocsBtn').addEventListener('click', () => { alert('Govt documentation checklist will be shown (you can convert this to a modal/pdf).'); });

  } catch (err) {
    console.error(err);
    analysisResult.innerHTML = `<p class="text-red-600">❌ Error: Could not connect to server</p>`;
  }
});

// ----------------- PDF GENERATION (includes route contents) -----------------
async function generatePDF(reportData) {
  if (!window.jspdf) { alert("PDF library (jsPDF) not loaded."); return; }
  if (!window.html2canvas) { alert("html2canvas not loaded."); return; }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 40; let cursorY = 48;

  // Header
  doc.setFontSize(18); doc.text("JalRakshak — Technical Report", margin, cursorY); cursorY += 20; doc.setFontSize(11);

  const user = localStorage.getItem("userName") || "User";
  const server = reportData.serverData || {};

  const metaLines = [
    `Prepared for: ${user}`,
    `Location: ${reportData.district || 'N/A'}`,
    `Roof Area (m²): ${window.selectedRoofArea || 'N/A'}`,
    `Roof Type: ${reportData.roofType || 'N/A'}`,
    `Dwellers: ${reportData.dwellers || 'N/A'}`,
    `Annual Rainfall used: ${server.rainfall_mm ?? 'N/A'} mm`,
    `Potential harvest: ${reportData.litersPerYear ? reportData.litersPerYear.toLocaleString() + ' L/year' : 'N/A'}`,
    `Estimated cost: ${reportData.estimatedCost ? '₹' + reportData.estimatedCost.toLocaleString() : 'N/A'}`,
    `Water sufficiency (months): ${reportData.suffMonths ?? 'N/A'}`,
    `Suggestion: ${reportData.suggestion || 'N/A'}`
  ];

  doc.setFont('helvetica', 'normal'); doc.setFontSize(11);
  for (const ln of metaLines) {
    if (cursorY > pageH - 120) { doc.addPage(); cursorY = 48; }
    doc.text(ln, margin, cursorY);
    cursorY += 14;
  }

  // Key numbers
  const keyPairs = [
    ['Rainfall (mm/yr)', server.rainfall_mm ?? 'N/A'],
    ['Runoff (L/yr)', server.runoff_liters_per_year ? server.runoff_liters_per_year.toLocaleString() : 'N/A'],
    ['Infiltrated (L/yr)', server.infiltrated_liters_per_year ? server.infiltrated_liters_per_year.toLocaleString() : 'N/A'],
    ['Peak flow (L/s)', server.flow?.peak_Q_l_s ?? 'N/A'],
    ['Pipe dia (mm)', server.pipe?.calculated_diameter_mm ?? 'N/A'],
    ['Pit volume (m3)', server.pit?.pit_volume_m3 ?? 'N/A'],
    ['Estimated cost (INR)', reportData.estimatedCost ? '₹' + reportData.estimatedCost.toLocaleString() : 'N/A']
  ];

  cursorY += 8;
  doc.setFontSize(10);
  for (const [k, v] of keyPairs) {
    if (cursorY > pageH - 80) { doc.addPage(); cursorY = 48; }
    doc.text(`${k}: ${v}`, margin, cursorY);
    cursorY += 12;
  }

  // Filters
  if (Array.isArray(server.filters?.candidates) && server.filters.candidates.length) {
    if (cursorY > pageH - 160) { doc.addPage(); cursorY = 48; }
    doc.setFontSize(12); doc.text('Filter candidates:', margin, cursorY); cursorY += 14; doc.setFontSize(10);
    for (const f of server.filters.candidates) {
      if (cursorY > pageH - 80) { doc.addPage(); cursorY = 48; }
      const line = `${f.name} — units: ${f.units_required} — cost: ₹${f.total_cost?.toLocaleString?.() ?? f.total_cost}`;
      doc.text(line, margin + 8, cursorY);
      cursorY += 12;
    }
  }

  // Pipe options
  if (Array.isArray(server.pipe?.options) && server.pipe.options.length) {
    if (cursorY > pageH - 160) { doc.addPage(); cursorY = 48; }
    doc.setFontSize(12); doc.text('Pipe options (summary):', margin, cursorY); cursorY += 14; doc.setFontSize(10);
    for (const p of server.pipe.options.slice(0, 8)) {
      if (cursorY > pageH - 80) { doc.addPage(); cursorY = 48; }
      const line = `${p.name} — used m: ${p.used_meters} — cost: ₹${p.total_cost?.toLocaleString?.() ?? p.total_cost}`;
      doc.text(line, margin + 8, cursorY);
      cursorY += 12;
    }
  }

  // Capture map + output snapshot
  const mapEl = document.getElementById('map');
  const outputEl = document.getElementById('outputCard');
  const pdfHideEls = Array.from(document.querySelectorAll('.no-pdf'));
  pdfHideEls.forEach(el => el.style.display = 'none');

  async function capture(el, scale=1) {
    if (!el) return null;
    const canvas = await html2canvas(el, { scale, useCORS: true, logging: false, backgroundColor: null });
    return canvas.toDataURL('image/png');
  }

  try {
    const mapImg = await capture(mapEl, 1.5);
    if (mapImg) {
      if (cursorY > pageH - 160) { doc.addPage(); cursorY = 48; }
      const img = new Image(); img.src = mapImg;
      await new Promise((resolve) => {
        img.onload = () => {
          const maxW = pageW - margin * 2;
          const ratio = Math.min(maxW / img.width, (pageH - cursorY - 80) / img.height, 1);
          const w = img.width * ratio;
          const h = img.height * ratio;
          doc.addImage(mapImg, 'PNG', margin, cursorY, w, h);
          cursorY += h + 12;
          resolve();
        };
        img.onerror = () => resolve();
      });
    }
  } catch (err) { console.warn('Map capture failed', err); }

  try {
    const outImg = await capture(outputEl, 1.5);
    if (outImg) {
      if (cursorY > pageH - 160) { doc.addPage(); cursorY = 48; }
      const img = new Image(); img.src = outImg;
      await new Promise((resolve) => {
        img.onload = () => {
          const maxW = pageW - margin * 2;
          const ratio = Math.min(maxW / img.width, (pageH - cursorY - 80) / img.height, 1);
          const w = img.width * ratio;
          const h = img.height * ratio;
          doc.addImage(outImg, 'PNG', margin, cursorY, w, h);
          cursorY += h + 12;
          resolve();
        };
        img.onerror = () => resolve();
      });
    }
  } catch (err) { console.warn('Output capture failed', err); }

  doc.setFontSize(9); doc.text('Generated by JalRakshak 1.0', margin, pageH - 28);
  const districtSafe = (reportData.district || 'report').replace(/[^\w\-]/g, '_');
  const filename = `JalRakshak_Report_${districtSafe}.pdf`;
  try {
    doc.save(filename);
    console.log('PDF saved:', filename);
  } catch (err) {
    console.error('Failed to save PDF:', err);
    alert('PDF generation failed. See console for details.');
  }
  pdfHideEls.forEach(el => el.style.display = '');
}
