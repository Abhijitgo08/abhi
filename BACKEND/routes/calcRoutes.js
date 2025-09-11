const express = require("express");
const router = express.Router();
const fs = require("fs");
const path = require("path");

// Load rainfall dataset (sync at startup is OK for small local JSON)
const rainfallDataPath = path.join(__dirname, "../data/rainfall_data.json");
let rainfallData = [];
try {
  rainfallData = JSON.parse(fs.readFileSync(rainfallDataPath, "utf-8"));
} catch (err) {
  console.error("Failed to load rainfall dataset:", err);
  // keep rainfallData empty; route will return 500/404 later
}

// Utility: find rainfall by district (case-insensitive)
function getRainfallByDistrict(districtName) {
  if (!districtName) return null;
  return rainfallData.find(
    (entry) => entry.district && entry.district.toLowerCase() === districtName.toLowerCase()
  );
}

// POST /api/calc
router.post("/", (req, res) => {
  const start = Date.now();
  console.log(`[calc] request from ${req.ip} bodyKeys: ${Object.keys(req.body).join(",")}`);

  try {
    // parse and validate inputs explicitly
    const district = (req.body.district || "").toString().trim();
    const roofArea = Number(req.body.roofArea);
    const roofTypeRaw = (req.body.roofType || "flat").toString().trim();
    const dwellers = Number(req.body.dwellers);

    if (!district || !Number.isFinite(roofArea) || !Number.isFinite(dwellers) || roofArea <= 0 || dwellers <= 0) {
      return res.status(400).json({ success: false, message: "Missing or invalid input fields" });
    }

    // basic limits to avoid huge computations / abuse
    if (roofArea > 100000) return res.status(400).json({ success: false, message: "roofArea too large" });
    if (dwellers > 1000) return res.status(400).json({ success: false, message: "dwellers value unrealistic" });

    const rainfallEntry = getRainfallByDistrict(district);
    if (!rainfallEntry) {
      return res.status(404).json({ success: false, message: "District not found in dataset" });
    }

    const rainfall_mm = Number(rainfallEntry.rainfall_mm) || 0;

    // Runoff coefficients (use lowercase keys for easy lookup)
    const runoffCoeff = {
      concrete: 0.6,
      metal: 0.9,
      flat: 0.75,
      sloped: 0.8,
      tiled: 0.7
    };

    const roofTypeKey = roofTypeRaw.toLowerCase();
    const coeff = runoffCoeff[roofTypeKey] ?? 0.75; // fallback if unknown

    // Core calculation: liters/year = roofArea(m²) * rainfall(m) * 1000 * coeff
    // rainfall_mm / 1000 -> meters
    const litersPerYear = roofArea * (rainfall_mm / 1000) * 1000 * coeff;

    // Estimate cost (example model: ₹350 per m²)
    const estimatedCost = Math.round(roofArea * 350);

    // Family need: approx 85 liters/day per person (your previous value)
    const annualNeed = dwellers * 85 * 365;

    // months of sufficiency, avoid division by zero
    const sufficiencyMonths = Math.round((litersPerYear) / (dwellers * 100 * 30) || 0);

    const response = {
      success: true,
      district,
      rainfall_mm,
      feasibility: litersPerYear > 10000 ? "YES" : "NO",
      litersPerYear: Math.round(litersPerYear),
      estimatedCost,
      sufficiencyMonths,
      suggestion: litersPerYear > annualNeed
        ? "Build Storage Tank + Recharge Pit"
        : "Consider Recharge Pit with supplemental sources",
      // helpful debug info (optional; remove in production)
      _debug: {
        roofType: roofTypeRaw,
        coeff,
        roofArea,
        dwellers,
        calcTimeMs: Date.now() - start
      }
    };

    console.log(`[calc] finished in ${Date.now() - start}ms for district=${district}`);
    res.json(response);
  } catch (error) {
    console.error("[calc] error:", error && error.stack ? error.stack : error);
    res.status(500).json({ success: false, message: "Server error in calculation" });
  }
});

module.exports = router;
