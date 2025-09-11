// ----------------- ELEMENTS -----------------
const analyzeBtn = document.getElementById("analyzeBtn");
const analysisResult = document.getElementById("analysisResult");
const designCard = document.getElementById("designCard");
const outputCard = document.getElementById("outputCard");
const userName = document.getElementById("userName");
const roofAreaSpan = document.getElementById("roofArea");

// Protect dashboard
const token = localStorage.getItem("token");
if (!token) window.location.href = "auth.html";

// User name
userName.textContent = localStorage.getItem("userName") || "User";

// ----------------- MAP SETUP -----------------
// NOTE: add crossOrigin: true to tileLayer (helps html2canvas attempt)
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
  // latlngs is array of L.LatLng objects (single ring)
  const coords = latlngs.map((p) => [p.lng, p.lat]);
  // ensure closed ring
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

  // get latlngs (first ring)
  const latlngs = layer.getLatLngs()[0];
  // convert and compute area via turf (returns m²)
  try {
    const poly = latlngsToTurfPolygon(latlngs);
    const area = turf.area(poly); // m²
    window.selectedRoofArea = Math.round(area);
    roofAreaSpan.textContent = window.selectedRoofArea;
  } catch (err) {
    console.warn("Area calc failed, falling back to L.GeometryUtil if available", err);
    // fallback: use L.GeometryUtil if present
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

// ----------------- ANALYSIS (call backend) -----------------
analyzeBtn.addEventListener("click", async () => {
  // Basic validation
  if (!window.selectedRoofArea || window.selectedRoofArea <= 0) {
    alert("Please draw your roof polygon on the map first!");
    return;
  }

  analysisResult.classList.remove("hidden");
  analysisResult.innerHTML = `<p class="text-lg text-gray-500">🔄 Running analysis...</p>`;

  // Grab inputs from form (support both id names if present)
  const district = (document.getElementById("locationInput").value || "Pune").trim();
  const dwellers = parseInt(document.getElementById("dwellersInput").value) || 4;
  const roofTypeEl = document.getElementById("roofTypeInput") || document.getElementById("roofType");
  const roofType = (roofTypeEl && roofTypeEl.value) ? roofTypeEl.value : "flat";
  const roofArea = window.selectedRoofArea;

  try {
    const res = await fetch("http://localhost:5000/api/calc", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${localStorage.getItem("token")}`
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
        <button id="downloadReportBtn" class="bg-blue-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-blue-700 transition">
          Download Technical Report (PDF)
        </button>
        <button id="govtDocsBtn" class="bg-yellow-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-yellow-700 transition">
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
  // modern jsPDF UMD exposes window.jspdf
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "pt", format: "a4" });

  // Title
  doc.setFontSize(18);
  doc.text("JalRakshak — Technical Report", 40, 50);
  doc.setFontSize(11);
  let y = 80;

  // Meta
  const user = localStorage.getItem("userName") || "User";
  const lines = [
    `Prepared for: ${user}`,
    `District: ${reportData.district}`,
    `Roof Area (m²): ${window.selectedRoofArea}`,
    `Roof Type: ${reportData.roofType || "N/A"}`,
    `Dwellers: ${reportData.dwellers || "N/A"}`,
    `Annual Rainfall used: ${reportData.rainfall_mm} mm`,
    `Potential harvest: ${reportData.litersPerYear.toLocaleString()} litres/year`,
    `Estimated cost: ₹${reportData.estimatedCost.toLocaleString()}`,
    `Water sufficiency: ${reportData.sufficiencyMonths} months`,
    `Suggestion: ${reportData.suggestion}`
  ];

  lines.forEach((ln) => {
    if (y > 740) { doc.addPage(); y = 40; }
    doc.text(ln, 40, y);
    y += 18;
  });

  // Try to include map snapshot (best-effort). This may fail due to CORS on tile images.
  // ===== CONFIG =====
// For local testing use 'http://localhost:10000' (or whichever port your server runs on).
// For production / same-origin (Render) use '' so it calls relative paths like /api/calc.
const API_BASE = (location.hostname === 'localhost') ? 'http://localhost:10000' : ''; 

// ...existing code...

// Inside analyzeBtn click handler replace the fetch block with this:
try {
  const url = API_BASE + '/api/calc'; // relative on production, http://localhost:10000 for local dev
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${localStorage.getItem("token")}`
    },
    body: JSON.stringify({ district, dwellers, roofType, roofArea })
  });

  // parse JSON safely
  let data = null;
  try { data = await res.json(); } catch (e) { /* no JSON returned */ }

  if (!res.ok) {
    // server returned non-2xx — show useful message
    const serverMsg = data?.message || data?.msg || data?.error || JSON.stringify(data) || `Status ${res.status}`;
    analysisResult.innerHTML = `<p class="text-red-600">❌ ${serverMsg}</p>`;
    return;
  }

  if (!data || !data.success) {
    analysisResult.innerHTML = `<p class="text-red-600">❌ ${data?.message || data?.msg || 'Calculation failed'}</p>`;
    return;
  }

  // ... proceed with rendering results (existing code) ...
} catch (err) {
  console.error('Fetch error:', err);
  analysisResult.innerHTML = `<p class="text-red-600">❌ Error: Could not connect to server — ${err.message}</p>`;
}


  // Footer
  doc.setFontSize(9);
  doc.text("Generated by JalRakshak 1.0", 40, doc.internal.pageSize.height - 30);

  // Save file
  const filename = `JalRakshak_Report_${reportData.district || "report"}.pdf`;
  doc.save(filename);
}
