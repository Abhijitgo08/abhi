// dashboard.js
// Cleaned and ready-to-paste version. Includes deduping and single implementation for location dropdown.

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
const map = L.map("map").setView([18.5204, 73.8567], 13); // Default Pune
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "© OpenStreetMap contributors",
  maxZoom: 19,
  crossOrigin: true
}).addTo(map);

// Draw Control
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

// ----------------- LOCATION: load, display, save (clean) -----------------
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

async function loadLocationOptions() {
  if (!locationSelect) return;
  try {
    const res = await fetch(API_BASE + '/api/location/options', {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` }
    });
    const json = await res.json().catch(() => ({}));
    const options = Array.isArray(json.locationOptions) ? json.locationOptions : [];
    const chosen = json.chosenLocation || null;
    populateLocationSelect(options, chosen);
  } catch (err) {
    console.error('loadLocationOptions error', err);
    if (locationSelect) locationSelect.innerHTML = '<option value="">Error loading locations</option>';
  }
}

/**
 * Populate select with location options.
 * - options: array of objects { id, lat, lng, address, ... }
 * - chosenLocation: optional object to preselect (may match by id or coordinates)
 */
function populateLocationSelect(options = [], chosenLocation = null) {
  if (!locationSelect) return;

  // start with placeholder
  locationSelect.innerHTML = '';
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = '-- Select Location --';
  locationSelect.appendChild(placeholder);

  // dedupe by address+lat+lng (sometimes API returns duplicates)
  const seen = new Set();
  options.forEach((loc, i) => {
    // normalize fields
    const id = (loc && loc.id) ? String(loc.id) : 'loc_' + i;
    const lat = (loc && (loc.lat !== undefined)) ? Number(loc.lat) : null;
    const lng = (loc && (loc.lng !== undefined)) ? Number(loc.lng) : null;
    const address = (loc && loc.address) ? String(loc.address) : (lat !== null && lng !== null ? `${lat}, ${lng}` : `Location ${i+1}`);

    const dedupeKey = `${address.trim()}|${lat}|${lng}`;
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);

    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = address;
    // store full object so we can easily send it back
    opt.dataset.loc = JSON.stringify({ id, address, lat, lng });
    locationSelect.appendChild(opt);
  });

  // try to preselect chosenLocation if provided
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

// single save function (POST chosen location to server)
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

// when user changes selection, show meta & save
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
    // fire-and-forget
    saveChosenLocation(loc);
  });
}

// initialize dropdown
loadLocationOptions();

// ----------------- ANALYSIS (call backend) -----------------
analyzeBtn.addEventListener("click", async () => {
  if (!window.selectedRoofArea || window.selectedRoofArea <= 0) {
    alert("Please draw your roof polygon on the map first!");
    return;
  }

  analysisResult.classList.remove("hidden");
  analysisResult.innerHTML = `<p class="text-lg text-gray-500">🔄 Running analysis...</p>`;

  // Use selected location from dropdown as district if present
  let district = "Pune";
  if (locationSelect && locationSelect.selectedOptions.length > 0) {
    const opt = locationSelect.selectedOptions[0];
    if (opt && opt.dataset.loc && opt.value !== '') {
      try {
        const loc = JSON.parse(opt.dataset.loc);
        district = loc.address || `${loc.lat},${loc.lng}`;
      } catch (err) {
        console.warn('Could not parse selected location for district', err);
      }
    }
  }

  const dwellers = parseInt(document.getElementById("dwellersInput").value) || 4;
  const roofTypeEl = document.getElementById("roofTypeInput") || document.getElementById("roofType");
  const roofType = (roofTypeEl && roofTypeEl.value) ? roofTypeEl.value : "flat";
  const roofArea = window.selectedRoofArea;

  try {
    const url = API_BASE + '/api/calc';
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ district, dwellers, roofType, roofArea })
    });

    const data = await res.json();

    if (!data.success) {
      analysisResult.innerHTML = `<p class="text-red-600">❌ ${data.message || "Calculation failed"}</p>`;
      return;
    }

    // Show result summary
    analysisResult.innerHTML = `
      <p class="text-lg">Feasibility: 
        <span class="font-bold ${data.feasibility === "YES" ? "text-green-600" : "text-red-600"}">
          ${data.feasibility}
        </span>
      </p>
      <p class="mt-2">Estimated Harvesting Capacity: 
        <span class="font-bold">${data.litersPerYear.toLocaleString()} Liters/year</span>
      </p>
      <p class="mt-2">Estimated Cost: 
        <span class="font-bold text-yellow-700">₹${data.estimatedCost.toLocaleString()}</span>
      </p>
      <p class="mt-2">Water Sufficiency: 
        <span class="font-bold">${data.sufficiencyMonths} months</span>
      </p>
      <p class="mt-2">Suggestion: 
        <span class="font-bold text-blue-600">${data.suggestion}</span>
      </p>
    `;

    // design + impact
    designCard.classList.remove("hidden");
    designCard.innerHTML = `
      <h3 class="text-xl font-semibold text-blue-600">Suggested Structure</h3>
      <p class="mt-2 text-gray-700">${data.suggestion}</p>
      <p class="mt-1 text-gray-700">Estimated Cost: ₹${data.estimatedCost.toLocaleString()}</p>
    `;

    outputCard.classList.remove("hidden");
    outputCard.innerHTML = `
      <p class="text-lg font-medium">💧 You can save 
        <span class="font-bold text-green-700">${data.litersPerYear.toLocaleString()} Liters/year</span>
      </p>
      <p class="mt-2">📅 Covers 
        <span class="font-bold">${data.sufficiencyMonths} months</span> of family needs</p>
      <p class="mt-2">🏙 Equivalent to water for 
        <span class="font-bold">${Math.round(data.litersPerYear / 10000)} households</span></p>
      <div class="mt-4 flex flex-col md:flex-row gap-3 justify-center">
        <button id="downloadReportBtn" class=" no-pdf bg-blue-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-blue-700 transition">
          Download Technical Report (PDF)
        </button>
        <button id="govtDocsBtn" class="no-pdf bg-yellow-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-yellow-700 transition">
          📑 Govt Documentation Checklist
        </button>
      </div>
    `;

    // wire download button
    document.getElementById("downloadReportBtn").addEventListener("click", async () => {
      await generatePDF(data);
    });

    // optional: show govt docs (simple modal or link) — for demo we'll alert
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
