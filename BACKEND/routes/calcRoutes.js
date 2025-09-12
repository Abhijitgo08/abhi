const express = require("express");
const router = express.Router();
const fs = require("fs");
const path = require("path");

// Load rainfall dataset
const rainfallDataPath = path.join(__dirname, "../data/rainfall_data.json");
const rainfallData = JSON.parse(fs.readFileSync(rainfallDataPath, "utf-8"));

// Utility: find rainfall by district
function getRainfallByDistrict(districtName) {
  return rainfallData.find(
    (entry) => entry.district.toLowerCase() === districtName.toLowerCase()
  );
}

// Default rainfall if district not found
const DEFAULT_RAINFALL = 1000;

// POST /
router.post("/", (req, res) => {
  try {
    // read and normalize inputs
    let { district, roofArea, roofType, dwellers } = req.body;

    // basic presence check
    if (!district || roofArea === undefined || !roofType || dwellers === undefined) {
      return res.status(400).json({ success: false, message: "Missing input fields" });
    }

    // coerce to numbers and validate
    roofArea = Number(roofArea);
    dwellers = Number(dwellers);

    if (Number.isNaN(roofArea) || roofArea <= 0) {
      return res.status(400).json({ success: false, message: "Invalid roofArea (must be > 0)" });
    }

    // require non-negative integer for dwellers (0 allowed if you want)
    if (!Number.isInteger(dwellers) || dwellers < 0) {
      return res.status(400).json({ success: false, message: "Invalid dwellers (must be non-negative integer)" });
    }

    // lookup rainfall (case-insensitive)
    const rainfallEntry = getRainfallByDistrict(district || "");
    // use dataset value if found, otherwise fallback to default
    const rainfall_mm = rainfallEntry ? rainfallEntry.rainfall : DEFAULT_RAINFALL;

    // runoff coefficients: use lowercase keys for easier matching
    const runoffCoeff = {
      concrete: 0.6,
      metal: 0.9,
      // add more types as needed
      // tiled, thatch, etc.
    };

    // get coefficient (case-insensitive). default to 0.75 if unknown
    const coeff = runoffCoeff[(roofType || "").toLowerCase()] ?? 0.75;

    // Core calculation
    // litersPerYear = roofArea(m²) * rainfall(m) * 1000(L/m³) * coeff
    // rainfall_mm / 1000 converts mm -> m
    const litersPerYear = roofArea * (rainfall_mm / 1000) * 1000 * coeff;

    // rough cost model (you used 200 earlier; keep or change)
    const estimatedCost = Math.round(roofArea * 200);

    // Family need: 85 liters/day per person (you used 85 in previous code)
    const dailyPerPerson = 85;
    const annualNeed = dwellers * dailyPerPerson * 365;

    // months of sufficiency: avoid divide by zero when dwellers === 0
    const monthlyDemand = dwellers > 0 ? (dwellers * 100 * 30) : 1;
    const sufficiencyMonths = Math.round(litersPerYear / monthlyDemand);

    // If we fell back to default rainfall, add a note in response
    const usedDefaultRainfall = !rainfallEntry;

    res.json({
      success: true,
      district,
      usedDefaultRainfall,
      rainfall_mm,
      feasibility: litersPerYear > 10000 ? "YES" : "NO",
      litersPerYear: Math.round(litersPerYear),
      estimatedCost,
      sufficiencyMonths,
      suggestion: litersPerYear > annualNeed
        ? "Build Storage Tank + Recharge Pit"
        : "Consider Recharge Pit with supplemental sources"
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});