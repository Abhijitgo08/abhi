// ----------------- ELEMENTS -----------------
const analyzeBtn = document.getElementById("analyzeBtn");
const analysisResult = document.getElementById("analysisResult");
const designCard = document.getElementById("designCard");
const outputCard = document.getElementById("outputCard");
const userName = document.getElementById("userName");
const roofAreaSpan = document.getElementById("roofArea");

// ===== CONFIG =====
const API_BASE = (location.hostname === 'localhost')
  ? 'http://localhost:10000'   // local dev port
  : '';                        // same-origin in production


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
   const url = API_BASE + '/api/calc';
  const res = await fetch(url, {
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

    ooutputCard.classList.remove("hidden");
outputCard.innerHTML = `
  <p class="text-lg font-medium">💧 You can save 
    <span class="font-bold text-green-700">${data.litersPerYear.toLocaleString()} Liters/year</span>
  </p>
  <p class="mt-2">📅 Covers 
    <span class="font-bold">${data.sufficiencyMonths} months</span> of family needs</p>
  <p class="mt-2">🏙 Equivalent to water for 
    <span class="font-bold">${Math.round(data.litersPerYear / 10000)} households</span></p>
  <div class="mt-4 flex flex-col md:flex-row gap-3 justify-center">
    <button id="downloadReportBtn" 
      class="no-pdf bg-blue-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-blue-700 transition">
      Download Technical Report (PDF)
    </button>
    <button id="govtDocsBtn" 
      class="no-pdf bg-yellow-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-yellow-700 transition">
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
  // Basic library checks
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

  // --- Elements to hide during capture ---
  const selectorsToHide = [
    'nav',
    'footer',
    '.leaflet-control-container',
    '.leaflet-control',
    '.no-pdf',
    '[data-pdf-hide]'
  ];
  const elementsHidden = [];
  // helper to hide and record previous inline display/visibility
  function hideEl(el) {
    if (!el) return;
    elementsHidden.push(el);
    el.dataset._prevDisplay = el.style.display || '';
    el.dataset._prevVisibility = el.style.visibility || '';
    el.style.display = 'none';
    el.style.visibility = 'hidden';
  }

  // hide by selector
  selectorsToHide.forEach(sel => {
    document.querySelectorAll(sel).forEach(hideEl);
  });

  // Specifically hide buttons inside #outputCard (covers dynamically injected buttons)
  const outputCard = document.getElementById("outputCard");
  const outputButtons = outputCard ? Array.from(outputCard.querySelectorAll("button")) : [];
  outputButtons.forEach(hideEl);

  // Also hide any element explicitly marked via "no-pdf" class added later (defensive)
  document.querySelectorAll('.no-pdf').forEach(hideEl);

  // Now proceed with PDF creation
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 40;
  let cursorY = 48;

  try {
    // Header
    doc.setFontSize(18);
    doc.text("JalRakshak — Technical Report", margin, cursorY);
    cursorY += 20;
    doc.setFontSize(11);

    // Meta lines
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

    // Try to capture map and outputCard using html2canvas
    const mapEl = document.getElementById("map");
    const outputEl = document.getElementById("outputCard");

    async function captureElementToDataURL(el, scale = 1) {
      if (!el) return null;
      const canvas = await html2canvas(el, { scale: scale, useCORS: true, logging: false, backgroundColor: null });
      try {
        return canvas.toDataURL("image/png");
      } catch (err) {
        console.warn("Canvas toDataURL failed (likely CORS/taint):", err);
        throw err;
      }
    }

    let mapDataUrl = null;
    let outputDataUrl = null;

    try {
      if (mapEl) {
        mapDataUrl = await captureElementToDataURL(mapEl, 1.5);
        console.log("Map captured successfully");
      }
      if (outputEl) {
        outputDataUrl = await captureElementToDataURL(outputEl, 1.5);
        console.log("Output card captured successfully");
      }
    } catch (captureErr) {
      console.warn("Element capture failed. Will generate PDF without map/image. Error:", captureErr);
      // continue with a text-only PDF
    }

    // Add map image if available
    if (mapDataUrl) {
      await new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          const maxW = pageW - margin * 2;
          const maxH = pageH - cursorY - 100;
          const ratio = Math.min(maxW / img.width, maxH / img.height, 1);
          const drawW = img.width * ratio;
          const drawH = img.height * ratio;
          if (cursorY + drawH > pageH - 60) { doc.addPage(); cursorY = 48; }
          doc.addImage(mapDataUrl, "PNG", margin, cursorY, drawW, drawH);
          cursorY += drawH + 12;
          resolve();
        };
        img.onerror = (e) => {
          console.warn("Failed to load captured map image into Image object", e);
          resolve();
        };
        img.src = mapDataUrl;
      });
    }

    // Add output card image if available
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

    // Footer & save
    doc.setFontSize(9);
    doc.text("Generated by JalRakshak 1.0", margin, pageH - 28);

    const districtSafe = (reportData.district || "report").replace(/[^\w\-]/g, "_");
    const filename = `JalRakshak_Report_${districtSafe}.pdf`;
    doc.save(filename);
    console.log("PDF saved:", filename);

  } catch (err) {
    console.error("Failed to generate PDF:", err);
    alert("PDF generation failed. See console for details.");
  } finally {
    // restore hidden elements
    elementsHidden.forEach(el => {
      try {
        el.style.display = el.dataset._prevDisplay || '';
        el.style.visibility = el.dataset._prevVisibility || '';
        delete el.dataset._prevDisplay;
        delete el.dataset._prevVisibility;
      } catch (e) { /* ignore restore errors */ }
    });
  }
}
