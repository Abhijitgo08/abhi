// dashboard.js
// Complete, ready-to-paste file
// - Adds soilType + floors + velocity + wetMonths support
// - Shows detailed backend outputs (runoff, flow, pipe, filters, pit, costs, aquifer)
// - Includes these details in generated PDF
// - Keeps original map/draw/pdf logic as intact as possible

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

// Optional inputs (these must exist in your HTML for the UI to accept them)
// If you haven't added them to HTML yet, script will fallback to defaults
const soilTypeInput = document.getElementById("soilTypeInput"); // <select id="soilTypeInput">...
const floorsInput = document.getElementById("floorsInput");     // <input id="floorsInput" type="number">

// ===== CONFIG =====
const API_BASE = (location.hostname === 'localhost') ? 'http://localhost:10000' : '';
const token = localStorage.getItem("token");
if (!token) window.location.href = "auth.html";
userName.textContent = localStorage.getItem("userName") || "User";

// ----------------- MAP SETUP -----------------
// Ensure there's an element with id="map" in the HTML
const map = L.map("map").setView([18.5204, 73.8567], 13); // Default Pune

// Tile layers
const osm = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "© OpenStreetMap contributors",
  maxZoom: 19,
  crossOrigin: true
});

const esriSat = L.tileLayer(
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  {
    attribution: "Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics",
    // Imagery often available to ~z17. We allow map maxZoom higher but tile provider may not have native tiles.
    maxNativeZoom: 17,
    maxZoom: 20,
    crossOrigin: true
  }
);

const esriLabels = L.tileLayer(
  "https://services.arcgisonline.com/arcgis/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
  {
    attribution: "Labels © Esri",
    maxNativeZoom: 17,
    maxZoom: 20,
    crossOrigin: true
  }
);

// Start with OSM so area names are easy to spot
osm.addTo(map);

// Smart switching OSM <-> Satellite on zoomend
map.on('zoomend', () => {
  const z = map.getZoom();
  // Show satellite in the mid zoom band, fallback to OSM at very high zoom to avoid stretched satellite tiles
  if (z >= 14 && z <= 18) {
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

// ----------------- DRAW CONTROL -----------------
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
  if (!Array.isArray(latlngs)) return null;
  const coords = latlngs.map((p) => [p.lng, p.lat]);
  if (coords.length && (coords[0][0] !== coords[coords.length-1][0] || coords[0][1] !== coords[coords.length-1][1])) {
    coords.push(coords[0]);
  }
  return turf.polygon([coords]);
}

// When user creates polygon (mark roof)
map.on(L.Draw.Event.CREATED, (e) => {
  drawnItems.clearLayers(); // allow only one polygon at a time
  const layer = e.layer;
  drawnItems.addLayer(layer);

  // compute area
  const latlngs = layer.getLatLngs && layer.getLatLngs()[0];
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
    const latlngs = layer.getLatLngs && layer.getLatLngs()[0];
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
 * Keeps it minimal and predictable.
 */
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

    // store minimal useful object
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

  // try to preselect chosenLocation
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
   - tries GET with Authorization, logs details for debugging
*/
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
  console.log('loadLocationOptions primary result:', primary);

  if (primary.ok) {
    const options = Array.isArray(primary.json.locationOptions) ? primary.json.locationOptions : [];
    const chosen = primary.json.chosenLocation || null;
    populateLocationSelect(options, chosen);
    return;
  }

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

  const debugMessage = primary.text || fallback.text || (primary.error ? String(primary.error) : `HTTP ${primary.status} / HTTP ${fallback.status}`);

  if (!userId) {
    locationSelect.innerHTML = '';
    const o = document.createElement('option');
    o.value = '';
    o.textContent = 'Error: missing userId in localStorage (please login again)';
    locationSelect.appendChild(o);
    console.error('loadLocationOptions failed: no userId in localStorage and server response:', debugMessage);
    return;
  }

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

// wire selection change: show meta, save, and center map (no pin)
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

    showLocationMeta(loc);
    saveChosenLocation(loc);

    if (loc.lat !== null && loc.lng !== null) {
      // center map without adding a marker
      map.setView([loc.lat, loc.lng], 12);
    }
  });
}

// initialize dropdown
loadLocationOptions();

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

  // Get other inputs
  const dwellers = parseInt(document.getElementById("dwellersInput").value) || NaN;
  const roofTypeEl = document.getElementById("roofTypeInput") || document.getElementById("roofType");
  const roofType = (roofTypeEl && roofTypeEl.value) ? roofTypeEl.value : null;

  // New optional inputs (if present in HTML)
  const soilType = soilTypeInput?.value || 'loamy';
  const floors = Number(floorsInput?.value) || 0;

  // Validate required fields (backend expects: lat, lng, roofArea, roofType, dwellers)
  if (isNaN(lat) || isNaN(lng) || isNaN(roofArea) || !roofType || isNaN(dwellers)) {
    analysisResult.innerHTML = `<p class="text-red-600">❌ Missing or invalid fields. Required: lat, lng, roofArea, roofType, dwellers</p>`;
    console.warn("Missing inputs for /api/calc", { lat, lng, roofArea, roofType, dwellers });
    return;
  }

  // Prepare payload including new fields and constants
  const payload = {
    lat,
    lng,
    roofArea,
    roofType,
    dwellers,
    soilType,
    floors,
    velocity_m_s: 2.5, // constant requested
    wetMonths: 3       // constant requested
  };

  try {
    const url = API_BASE + '/api/calc';
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

    // Normalize some commonly used fields from backend (handle naming variations)
    const rainfall_mm = data.rainfall_mm ?? data.rainfall ?? data.avg_rainfall_mm ?? null;
    const runoff_liters_per_year = data.runoff_liters_per_year ?? data.runoff ?? data.litersPerYear ?? null;
    const infiltrated_liters_per_year = data.infiltrated_liters_per_year ?? data.infiltrated ?? null;
    const flow = data.flow ?? data.flow_rate ?? null;
    const pipe = data.pipe ?? null;
    const filters = data.filters ?? null;
    const pit = data.pit ?? null;
    const aquifer = data.aquifer ?? null;
    const costs = data.costs ?? data.cost_summary ?? null;

    // Show result summary
    analysisResult.innerHTML = `
      <p class="text-lg">Feasibility: 
        <span class="font-bold ${data.feasibility === "YES" || data.feasibility === true ? "text-green-600" : "text-red-600"}">
          ${data.feasibility === "YES" || data.feasibility === true ? "YES" : "NO"}
        </span>
      </p>
      <p class="mt-2">Rainfall: <span class="font-bold">${rainfall_mm ?? 'N/A'} mm/year</span></p>
      <p class="mt-2">Runoff: <span class="font-bold">${runoff_liters_per_year ? Number(runoff_liters_per_year).toLocaleString() : 'N/A'} L/year</span></p>
      <p class="mt-2">Infiltrated: <span class="font-bold">${infiltrated_liters_per_year ? Number(infiltrated_liters_per_year).toLocaleString() : 'N/A'} L/year</span></p>
      <p class="mt-2">Flow Q: <span class="font-bold">${flow?.Q_l_s ?? flow?.Q_lps ?? flow?.Q || 'N/A'} L/s</span></p>
      <p class="mt-2">Pipe: <span class="font-bold">${pipe?.chosen_option?.name || pipe?.selected?.name || 'N/A'}</span></p>
      <p class="mt-2">Filter: <span class="font-bold">${filters?.chosen?.name || filters?.selected?.name || 'N/A'}</span></p>
      <p class="mt-2">Pit Volume: <span class="font-bold">${pit?.pit_volume_m3 ?? pit?.volume_m3 ?? 'N/A'} m³</span></p>
      <p class="mt-2">Total Cost: <span class="font-bold text-yellow-700">₹${costs?.total_estimated_installation_cost ? Number(costs.total_estimated_installation_cost).toLocaleString() : 'N/A'}</span></p>
    `;

    // design + impact
    designCard.classList.remove("hidden");
    designCard.innerHTML = `
      <h3 class="text-xl font-semibold text-blue-600">Design Summary</h3>
      <div class="mt-2 text-left text-gray-700">
        <strong>Pipe:</strong> ${JSON.stringify(pipe?.chosen_option || pipe?.selected || pipe || 'N/A')}<br/>
        <strong>Filter:</strong> ${JSON.stringify(filters?.chosen || filters?.selected || filters || 'N/A')}<br/>
        <strong>Pit:</strong> ${JSON.stringify(pit || 'N/A')}<br/>
        <strong>Aquifer:</strong> ${JSON.stringify(aquifer || 'N/A')}
      </div>
    `;

    // output card
    outputCard.classList.remove("hidden");
    outputCard.innerHTML = `
      <p class="text-lg font-medium">💧 Annual runoff: <span class="font-bold text-green-700">${runoff_liters_per_year ? Number(runoff_liters_per_year).toLocaleString() : 'N/A'} L</span></p>
      <p class="mt-2">📉 Infiltrated: <span class="font-bold">${infiltrated_liters_per_year ? Number(infiltrated_liters_per_year).toLocaleString() : 'N/A'} L</span></p>
      <p class="mt-2">🏗 Aquifer: <span class="font-bold">${aquifer?.type || 'N/A'}</span></p>
      <div class="mt-4 flex flex-col md:flex-row gap-3 justify-center">
        <button id="downloadReportBtn" class=" no-pdf bg-blue-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-blue-700 transition">
          Download Technical Report (PDF)
        </button>
        <button id="govtDocsBtn" class="no-pdf bg-yellow-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-yellow-700 transition">
          📑 Govt Documentation Checklist
        </button>
      </div>
    `;

    // wire download button (generate PDF using the full backend response)
    document.getElementById("downloadReportBtn").addEventListener("click", async () => {
      // pass the normalized structure to generatePDF: include both original data and normalized names
      const reportData = Object.assign({}, data, {
        rainfall_mm,
        runoff_liters_per_year,
        infiltrated_liters_per_year,
        flow,
        pipe,
        filters,
        pit,
        aquifer,
        costs
      });
      await generatePDF(reportData);
    });

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
  cursorY += 22;
  doc.setFontSize(11);

  const user = localStorage.getItem("userName") || "User";
  const districtSafe = (reportData.district || reportData.address || "report").toString().replace(/[^\w\-]/g, "_");

  // Metadata / Inputs
  const metaLines = [
    `Prepared for: ${user}`,
    `Date: ${new Date().toLocaleDateString()}`,
    `Location (lat,lng): ${reportData.lat ?? 'N/A'}, ${reportData.lng ?? 'N/A'}`,
    `Roof Area (m²): ${window.selectedRoofArea || reportData.roofArea || 'N/A'}`,
    `Roof Type: ${reportData.roofType || 'N/A'}`,
    `Dwellers: ${reportData.dwellers || 'N/A'}`,
    `Floors: ${reportData.floors ?? 'N/A'}`,
    `Soil Type: ${reportData.soilType ?? 'N/A'}`,
    `Annual Rainfall used: ${reportData.rainfall_mm ?? 'N/A'} mm`
  ];

  doc.setFont("helvetica", "normal");
  for (const ln of metaLines) {
    if (cursorY > pageH - 120) { doc.addPage(); cursorY = 48; }
    doc.text(ln, margin, cursorY);
    cursorY += 14;
  }

  cursorY += 8;
  doc.setFontSize(14);
  doc.text("Hydrology & Runoff", margin, cursorY);
  cursorY += 16;
  doc.setFontSize(11);

  const runoffLine = `Runoff (L/year): ${reportData.runoff_liters_per_year ? Number(reportData.runoff_liters_per_year).toLocaleString() : (reportData.runoff ? reportData.runoff : 'N/A')}`;
  const infilLine = `Infiltrated (L/year): ${reportData.infiltrated_liters_per_year ? Number(reportData.infiltrated_liters_per_year).toLocaleString() : 'N/A'}`;
  const feasibilityLine = `Feasibility: ${(reportData.feasibility === "YES" || reportData.feasibility === true) ? "YES" : "NO"}`;

  [runoffLine, infilLine, feasibilityLine].forEach(ln => {
    if (cursorY > pageH - 120) { doc.addPage(); cursorY = 48; }
    doc.text(ln, margin, cursorY);
    cursorY += 14;
  });

  cursorY += 8;
  doc.setFontSize(14);
  doc.text("Flow & Pipe Design", margin, cursorY);
  cursorY += 16;
  doc.setFontSize(11);

  if (reportData.flow) {
    const Q = reportData.flow.Q_l_s ?? reportData.flow.Q_lps ?? reportData.flow.Q ?? 'N/A';
    const vel = reportData.flow.velocity_m_s ?? reportData.flow.velocity ?? 'N/A';
    const dia = reportData.flow.diameter_mm ?? reportData.flow.diameter ?? 'N/A';
    const plen = reportData.flow.pipe_length_m ?? reportData.flow.pipe_length_m ?? 'N/A';

    const flowLines = [
      `Q (L/s): ${Q}`,
      `Velocity (m/s): ${vel}`,
      `Diameter (mm): ${dia}`,
      `Pipe length (m): ${plen}`
    ];
    flowLines.forEach(ln => {
      if (cursorY > pageH - 120) { doc.addPage(); cursorY = 48; }
      doc.text(ln, margin, cursorY);
      cursorY += 14;
    });
  } else {
    if (cursorY > pageH - 120) { doc.addPage(); cursorY = 48; }
    doc.text("Flow data: N/A", margin, cursorY);
    cursorY += 14;
  }

  cursorY += 8;
  doc.setFontSize(14);
  doc.text("Filter Design", margin, cursorY);
  cursorY += 16;
  doc.setFontSize(11);

  if (reportData.filters && reportData.filters.chosen) {
    const f = reportData.filters.chosen;
    const filterLines = [
      `Filter: ${f.name || 'N/A'}`,
      `Capacity (L/s): ${f.capacity_l_s ?? f.capacity ?? 'N/A'}`,
      `Unit cost: ₹${f.cost ?? 'N/A'}`,
      `Number required: ${reportData.filters.count ?? f.count ?? 'N/A'}`
    ];
    filterLines.forEach(ln => {
      if (cursorY > pageH - 120) { doc.addPage(); cursorY = 48; }
      doc.text(ln, margin, cursorY);
      cursorY += 14;
    });
  } else {
    if (cursorY > pageH - 120) { doc.addPage(); cursorY = 48; }
    doc.text("Filter selection: N/A", margin, cursorY);
    cursorY += 14;
  }

  cursorY += 8;
  doc.setFontSize(14);
  doc.text("Recharge Pit", margin, cursorY);
  cursorY += 16;
  doc.setFontSize(11);

  if (reportData.pit) {
    const pv = reportData.pit.pit_volume_m3 ?? reportData.pit.volume_m3 ?? 'N/A';
    const pc = reportData.pit.estimated_cost ?? reportData.pit.cost ?? 'N/A';
    const pitLines = [
      `Pit volume (m³): ${pv}`,
      `Pit estimated cost: ₹${pc}`
    ];
    pitLines.forEach(ln => {
      if (cursorY > pageH - 120) { doc.addPage(); cursorY = 48; }
      doc.text(ln, margin, cursorY);
      cursorY += 14;
    });
  } else {
    if (cursorY > pageH - 120) { doc.addPage(); cursorY = 48; }
    doc.text("Pit design: N/A", margin, cursorY);
    cursorY += 14;
  }

  cursorY += 8;
  doc.setFontSize(14);
  doc.text("Aquifer / Infiltration", margin, cursorY);
  cursorY += 16;
  doc.setFontSize(11);

  if (reportData.aquifer) {
    const aqLines = [
      `Aquifer type: ${reportData.aquifer.type ?? 'N/A'}`,
      `Estimated infiltration (L/year): ${reportData.infiltrated_liters_per_year ? Number(reportData.infiltrated_liters_per_year).toLocaleString() : 'N/A'}`
    ];
    aqLines.forEach(ln => {
      if (cursorY > pageH - 120) { doc.addPage(); cursorY = 48; }
      doc.text(ln, margin, cursorY);
      cursorY += 14;
    });
  } else {
    if (cursorY > pageH - 120) { doc.addPage(); cursorY = 48; }
    doc.text("Aquifer data: N/A", margin, cursorY);
    cursorY += 14;
  }

  cursorY += 8;
  doc.setFontSize(14);
  doc.text("Cost Summary", margin, cursorY);
  cursorY += 16;
  doc.setFontSize(11);

  if (reportData.costs) {
    const c = reportData.costs;
    const costLines = [
      `Pipe cost: ₹${c.pipe_cost ?? 'N/A'}`,
      `Filter cost: ₹${c.filter_cost ?? 'N/A'}`,
      `Pit cost: ₹${c.pit_cost ?? 'N/A'}`,
      `Other costs: ₹${c.other_costs ?? 'N/A'}`,
      `Total estimated installation cost: ₹${c.total_estimated_installation_cost ? Number(c.total_estimated_installation_cost).toLocaleString() : 'N/A'}`
    ];
    costLines.forEach(ln => {
      if (cursorY > pageH - 120) { doc.addPage(); cursorY = 48; }
      doc.text(ln, margin, cursorY);
      cursorY += 14;
    });
  } else {
    if (cursorY > pageH - 120) { doc.addPage(); cursorY = 48; }
    doc.text("Cost summary: N/A", margin, cursorY);
    cursorY += 14;
  }

  // Try to include map snapshot and output card visually if possible
  const mapEl = document.getElementById("map");
  const outputEl = document.getElementById("outputCard");
  const pdfHideEls = Array.from(document.querySelectorAll('.no-pdf'));
  pdfHideEls.forEach(el => el.style.display = 'none');

  async function captureElementToDataURL(el, scale = 1) {
    if (!el) return null;
    const canvas = await html2canvas(el, { scale: scale, useCORS: true, logging: false, backgroundColor: null });
    try { return canvas.toDataURL("image/png"); }
    catch (err) { console.warn("Canvas toDataURL failed (likely CORS/taint):", err); return null; }
  }

  try {
    const mapDataUrl = mapEl ? await captureElementToDataURL(mapEl, 1.2) : null;
    const outputDataUrl = outputEl ? await captureElementToDataURL(outputEl, 1.2) : null;

    if (mapDataUrl) {
      if (cursorY > pageH - 250) { doc.addPage(); cursorY = 48; }
      const maxW = pageW - margin * 2;
      const img = new Image();
      img.src = mapDataUrl;
      await new Promise((resolve) => {
        img.onload = () => {
          const ratio = Math.min(maxW / img.width, 220 / img.height, 1);
          const drawW = img.width * ratio;
          const drawH = img.height * ratio;
          doc.addImage(mapDataUrl, "PNG", margin, cursorY, drawW, drawH);
          cursorY += drawH + 10;
          resolve();
        };
        img.onerror = () => resolve();
      });
    }

    if (outputDataUrl) {
      if (cursorY > pageH - 200) { doc.addPage(); cursorY = 48; }
      const maxW = pageW - margin * 2;
      const img2 = new Image();
      img2.src = outputDataUrl;
      await new Promise((resolve) => {
        img2.onload = () => {
          const ratio = Math.min(maxW / img2.width, 200 / img2.height, 1);
          const drawW = img2.width * ratio;
          const drawH = img2.height * ratio;
          doc.addImage(outputDataUrl, "PNG", margin, cursorY, drawW, drawH);
          cursorY += drawH + 10;
          resolve();
        };
        img2.onerror = () => resolve();
      });
    }
  } catch (err) {
    console.warn("Map/output capture into PDF failed:", err);
  } finally {
    pdfHideEls.forEach(el => el.style.display = '');
  }

  // Footer
  doc.setFontSize(9);
  doc.text(`Generated by JalRakshak 1.0 — ${new Date().toLocaleString()}`, margin, pageH - 28);

  // Save
  const filename = `JalRakshak_Report_${districtSafe}.pdf`;
  try {
    doc.save(filename);
    console.log("PDF saved:", filename);
  } catch (err) {
    console.error("Failed to save PDF:", err);
    alert("PDF generation failed. See console for details.");
  }
}
