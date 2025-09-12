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


// POST /api/calc
router.post("/", (req, res) => {
  try {
    const { district, roofArea, roofType, dwellers } = req.body;

    if (!district || !roofArea || !roofType || !dwellers) {
      return res.status(400).json({ success: false, message: "Missing input fields" });
    }

    const rainfallEntry = getRainfallByDistrict(district);
    if (!rainfallEntry) {
      return res.status(404).json({ success: false, message: "District not found in dataset" });
    }
    const DEFAULT_RAINFALL = 1000;
    
    const rainfall_mm = rainfallEntry ? rainfallEntry.rainfall : DEFAULT_RAINFALL;
    

    // Runoff coefficients (rough values)
    const runoffCoeff = {
      Concrete: 0.6,
      Metal: 0.9,
    };

    const coeff = runoffCoeff[roofType.toLowerCase()] || 0.75;

    // Core calculation
    const litersPerYear = roofArea * (rainfall_mm / 1000) * 1000 * coeff;

    // Estimate cost (very rough model: ₹1200 per m² roof area)
    const estimatedCost = roofArea * 200;

    // Family need: 100 liters/day per person
    const annualNeed = dwellers * 85 * 365;

    const sufficiencyMonths = Math.round(litersPerYear / (dwellers * 100 * 30));

    res.json({
      success: true,
      district,
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

module.exports = router;
