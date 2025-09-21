// routes/calcRoutes.js
const express = require("express");
const router = express.Router();
const axios = require("axios");

// Fetch average annual rainfall using Open-Meteo (2000–2020)
async function getAverageRainfall(lat, lng) {
  const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lng}&start_date=2000-01-01&end_date=2020-12-31&daily=precipitation_sum&timezone=UTC`;

  const resp = await axios.get(url, { timeout: 20_000 });
  const dailyValues = resp.data?.daily?.precipitation_sum;
  if (!dailyValues || !Array.isArray(dailyValues) || dailyValues.length === 0) {
    return null;
  }

  const totalMm = dailyValues.reduce((a, b) => a + (Number(b) || 0), 0);
  const years = 21; // 2000–2020 inclusive
  return Math.round(totalMm / years); // mm/year
}

// POST /api/calc
router.post("/", async (req, res) => {
  try {
    let { lat, lng, roofArea, roofType, dwellers } = req.body;

    // convert to numbers
    lat = Number(lat);
    lng = Number(lng);
    roofArea = Number(roofArea);
    dwellers = Number(dwellers);

    // validation
    if (
      isNaN(lat) ||
      isNaN(lng) ||
      isNaN(roofArea) ||
      !roofType ||
      isNaN(dwellers)
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Missing or invalid fields. Required: lat, lng, roofArea, roofType, dwellers",
      });
    }

    // get rainfall
    const rainfall_mm = await getAverageRainfall(lat, lng);
    if (!rainfall_mm) {
      return res
        .status(404)
        .json({ success: false, message: "Rainfall data not available" });
    }

    // runoff coefficients
    const runoffCoeff = {
      concrete: 0.6,
      metal: 0.9,
    };
    const coeff = runoffCoeff[String(roofType).toLowerCase()] ?? 0.75;

    // calculation
    const runoff = roofArea * (rainfall_mm / 1000) * 1000 * coeff;
    
    const estimatedCost = Math.round(roofArea * 200);
    
    const annualNeed = dwellers * 140 * 360;
    
    const sufficiencyMonths = Math.round(
      runoff / (dwellers * 140 * 30)
    );

    res.json({
      success: true,
      lat,
      lng,
      rainfall_mm,
      feasibility: runoff > 10000 ? "YES" : "NO",
      runoff: Math.round(runoff),
      estimatedCost,
      sufficiencyMonths,
      suggestion:
        runoff > annualNeed
          ? "Build Storage Tank + Recharge Pit"
          : "Consider Recharge Pit with supplemental sources",
    });
  } catch (error) {
    console.error("calc route error:", error);
    res
      .status(500)
      .json({ success: false, message: error.message || "Internal error" });
  }
});

module.exports = router;
