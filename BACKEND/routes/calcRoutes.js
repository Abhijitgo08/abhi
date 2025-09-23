const express = require("express");
const router = express.Router();

let _axios = null;
try { _axios = require("axios"); } catch (e) { _axios = null; }

async function httpGetJson(url, timeoutMs = 20000) {
  if (_axios) {
    const resp = await _axios.get(url, { timeout: timeoutMs });
    return resp.data;
  }
  if (typeof fetch !== "undefined") {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const resp = await fetch(url, { signal: controller.signal });
      clearTimeout(id);
      if (!resp.ok) {
        const txt = await resp.text().catch(() => "");
        throw new Error(`HTTP ${resp.status} ${txt}`);
      }
      return await resp.json();
    } catch (err) { clearTimeout(id); throw err; }
  }
  throw new Error("No HTTP client available. Install axios or run on Node 18+ (global fetch).");
}

async function getAverageRainfall(lat, lng) {
  const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lng)}&start_date=2000-01-01&end_date=2020-12-31&daily=precipitation_sum&timezone=UTC`;
  const data = await httpGetJson(url, 20000);
  const dailyValues = data?.daily?.precipitation_sum;
  if (!dailyValues || !Array.isArray(dailyValues) || dailyValues.length === 0) return null;
  const totalMm = dailyValues.reduce((a,b) => a + (Number(b) || 0), 0);
  const years = 21;
  return Math.round(totalMm / years);
}

// ------------------ CONFIG / DATASETS ------------------
const RUNOFF_COEFF = { concrete: 0.6, metal: 0.9 };
const SOIL_INFILTRATION = { sandy: 0.8, loamy: 0.475, clayey: 0.175 };

const GROUND_IMPERMEABILITY = {
  water_tight: 0.825, asphalt: 0.875, stone_brick: 0.8, open_joints: 0.6,
  inferior_blocks: 0.45, macadam: 0.425, gravel: 0.225, unpaved: 0.2, parks: 0.15, dense_built: 0.8
};

const DEFAULT_VELOCITY = 2.5; // fallback
const DEFAULT_FLOOR_HEIGHT = 3.0;
const DEFAULT_WET_MONTHS = 4;
const DEFAULT_FILTER_SAFETY_FACTOR = 0.8;
const DEFAULT_PIT_COST_PER_M3 = 800;

// Channel cost assumptions
const CHANNEL_DEPTH_M = 0.5;
const CHANNEL_UNIT_COST_PER_M = 1200;
const CHANNEL_END_BLOCK_COST = 1500;
const CHANNEL_STEEL_GRILL_COST_PER_M = 200;

// Manning defaults (for velocity)
const MANNING_N_DEFAULT = 0.013;
const DEFAULT_SLOPE = 0.02; // 2% slope

const PIPE_STANDARDS = [
  { id: "PVC_3m", name: "PVC pipe (3 m)", length_m: 3, unit_cost_per_meter: 80 },
  { id: "PVC_6m", name: "PVC pipe (6 m)", length_m: 6, unit_cost_per_meter: 85 },
  { id: "HDPE_6m", name: "HDPE pipe (6 m)", length_m: 6, unit_cost_per_meter: 65 },
  { id: "HDPE_12m", name: "HDPE pipe (12 m)", length_m: 12, unit_cost_per_meter: 65 }
];

const FILTER_PRODUCTS = [
  { id: "RAINY_FL80", name: "Rainy FL-80", capacity_m2: 75, unit_cost: 8500 },
  { id: "NEERAIN_BASIC", name: "NeeRain Basic", capacity_m2: 150, unit_cost: 6500 },
  { id: "RAINY_FL250", name: "Rainy FL-250", capacity_m2: 250, unit_cost: 13750 }
];

const AQUIFER_CATEGORIES = [
  { type: "Dug Well / Small Pit", min_l_per_year: 0, max_l_per_year: 50_000 },
  { type: "Percolation Pit / Tank", min_l_per_year: 50_001, max_l_per_year: 200_000 },
  { type: "Recharge Shaft / Large Pit", min_l_per_year: 200_001, max_l_per_year: 500_000 },
  { type: "Injection Well / Large-scale recharge", min_l_per_year: 500_001, max_l_per_year: Infinity }
];

// ---------- GEOMETRY helpers ----------
function deg2rad(deg) { return deg * (Math.PI/180); }
function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = deg2rad(lat2 - lat1);
  const dLon = deg2rad(lon2 - lon1);
  const a = Math.sin(dLat/2)*Math.sin(dLat/2) + Math.cos(deg2rad(lat1))*Math.cos(deg2rad(lat2))*Math.sin(dLon/2)*Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

function polygonPerimeterMeters(coords) {
  if (!Array.isArray(coords) || coords.length < 2) return 0;
  let per = 0;
  for (let i=0;i<coords.length;i++){
    const a = coords[i];
    const b = coords[(i+1)%coords.length];
    per += haversineMeters(a.lat, a.lng, b.lat, b.lng);
  }
  return per;
}

function bboxOfCoords(coords) {
  let minLat=Infinity, maxLat=-Infinity, minLng=Infinity, maxLng=-Infinity;
  coords.forEach(p => {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
  });
  return { minLat, maxLat, minLng, maxLng };
}

function bboxWidthHeightMeters(coords) {
  const bb = bboxOfCoords(coords);
  const width_m = haversineMeters(bb.minLat, bb.minLng, bb.minLat, bb.maxLng);
  const height_m = haversineMeters(bb.minLat, bb.minLng, bb.maxLat, bb.minLng);
  return { width_m, height_m };
}

// ---------- ROUTE ----------
router.post("/", async (req, res) => {
  try {
    let {
      lat, lng, roofArea, roofType, dwellers, soilType, floors,
      avgFloorHeight, velocity_m_s, wetMonths, safetyFactorFilter, pit_cost_per_m3,
      includeGround, groundArea, groundSurfaces, groundRunoffCoeffClient,
      roofPolygon, groundPolygon
    } = req.body;

    lat = Number(lat);
    lng = Number(lng);
    roofArea = Number(roofArea);
    dwellers = Number(dwellers);
    floors = (floors === undefined || floors === null) ? 0 : Number(floors);
    avgFloorHeight = (avgFloorHeight === undefined || avgFloorHeight === null) ? DEFAULT_FLOOR_HEIGHT : Number(avgFloorHeight);
    velocity_m_s = (velocity_m_s === undefined || velocity_m_s === null) ? DEFAULT_VELOCITY : Number(velocity_m_s);
    wetMonths = (wetMonths === undefined || wetMonths === null) ? DEFAULT_WET_MONTHS : Number(wetMonths);
    safetyFactorFilter = (safetyFactorFilter === undefined || safetyFactorFilter === null) ? DEFAULT_FILTER_SAFETY_FACTOR : Number(safetyFactorFilter);
    pit_cost_per_m3 = (pit_cost_per_m3 === undefined || pit_cost_per_m3 === null) ? DEFAULT_PIT_COST_PER_M3 : Number(pit_cost_per_m3);

    includeGround = !!includeGround;
    groundArea = includeGround ? Number(groundArea || 0) : 0;
    groundSurfaces = Array.isArray(groundSurfaces) ? groundSurfaces : [];

    if (isNaN(lat) || isNaN(lng) || isNaN(roofArea) || !roofType || isNaN(dwellers)) {
      return res.status(400).json({ success:false, message:"Missing or invalid fields. Required: lat, lng, roofArea, roofType, dwellers" });
    }

    const rainfall_mm = await getAverageRainfall(lat, lng);
    if (!rainfall_mm) return res.status(404).json({ success:false, message:"Rainfall data not available for location" });

    // Roof runoff (L/yr)
    const coeffRoof = RUNOFF_COEFF[String(roofType).toLowerCase()] ?? 0.75;
    const runoff_roof_liters_per_year = Math.round(roofArea * (rainfall_mm/1000) * 1000 * coeffRoof);

    // Ground runoff (if included)
    let ground_runoff_coeff = null;
    let runoff_ground_liters_per_year = 0;
    if (includeGround && groundArea > 0) {
      const coeffs = (groundSurfaces || []).map(k => (GROUND_IMPERMEABILITY[k] ?? null)).filter(v=>v!==null);
      if (coeffs.length > 0) ground_runoff_coeff = coeffs.reduce((a,b)=>a+b,0)/coeffs.length;
      else if (groundRunoffCoeffClient && Number(groundRunoffCoeffClient) > 0) ground_runoff_coeff = Number(groundRunoffCoeffClient);
      else ground_runoff_coeff = 0.3;
      runoff_ground_liters_per_year = Math.round(groundArea * (rainfall_mm/1000) * 1000 * ground_runoff_coeff);
    }

    const runoff_liters_per_year = runoff_roof_liters_per_year + runoff_ground_liters_per_year;

    // ---------------- velocity & pipe sizing using Manning-like formula ----------------
    let R_m = null;
    if (Array.isArray(roofPolygon) && roofPolygon.length >= 3) {
      const perimeter_m = polygonPerimeterMeters(roofPolygon);
      if (perimeter_m > 0) R_m = (roofArea / perimeter_m);
    }
    let V_m_s = Number(velocity_m_s) || DEFAULT_VELOCITY;
    if (R_m !== null && R_m > 0) {
      V_m_s = (1 / MANNING_N_DEFAULT) * Math.sqrt(DEFAULT_SLOPE) * Math.pow(R_m, 2/3);
      if (!isFinite(V_m_s) || V_m_s <= 0) V_m_s = Number(velocity_m_s) || DEFAULT_VELOCITY;
    }

    // Use roofArea as catchment area for pipe conveyance
    const Q_m3_s = Math.max(0, (roofArea * V_m_s));
    const Q_l_s = Q_m3_s * 1000;

    let D_m = 0;
    if (V_m_s > 0 && Q_m3_s > 0) D_m = Math.sqrt((4 * Q_m3_s) / (Math.PI * V_m_s));
    const D_mm = Math.round(D_m * 1000);

    // ---------------- pipe length: vertical + horizontal ----------------
    const vertical_length_m = Math.round((floors * avgFloorHeight) * 100) / 100;

    let horizontal_length_m = 0;
    if (Array.isArray(roofPolygon) && roofPolygon.length >= 2) {
      const { width_m, height_m } = bboxWidthHeightMeters(roofPolygon);
      horizontal_length_m = Math.sqrt(width_m*width_m + height_m*height_m);
    } else {
      horizontal_length_m = Math.sqrt(Math.max(1, roofArea));
    }
    horizontal_length_m = Math.round(horizontal_length_m * 100) / 100;

    const pipeLength_m = Math.max(0, vertical_length_m + horizontal_length_m);

    // ---------------- pipe options/costs (used_meters computed from pipeLength_m) ----------------
    const pipeOptions = PIPE_STANDARDS.map(p => {
      const units_required = p.length_m > 0 ? Math.ceil(pipeLength_m / p.length_m) : 0;
      const used_meters = units_required * p.length_m;
      const cost = Math.round(used_meters * p.unit_cost_per_meter);
      return {
        id: p.id, name: p.name, standard_length_m: p.length_m, used_meters,
        units_required, unit_cost_per_meter: p.unit_cost_per_meter, total_cost: cost
      };
    });
    const cheapestPipe = pipeOptions.reduce((best, cur) => (cur.total_cost < (best?.total_cost ?? Infinity) ? cur : best), null);

    // ---------------- filter selection (best-fit capacity) ----------------
    const filtersCalculated = FILTER_PRODUCTS.map(fp => {
      const effective_capacity = fp.capacity_m2 * (safetyFactorFilter || 1);
      const units_required = effective_capacity > 0 ? Math.ceil(roofArea / effective_capacity) : 0;
      const total_capacity = units_required * fp.capacity_m2;
      const total_cost = units_required * fp.unit_cost;
      return {
        id: fp.id, name: fp.name, capacity_m2: fp.capacity_m2,
        effective_capacity_per_unit: effective_capacity, units_required, total_capacity, unit_cost: fp.unit_cost, total_cost
      };
    });

    let chosenFilter = null;
    if (filtersCalculated.length) {
      filtersCalculated.sort((a,b) => {
        const surplusA = (a.total_capacity - roofArea);
        const surplusB = (b.total_capacity - roofArea);
        if (surplusA === surplusB) return a.total_cost - b.total_cost;
        return surplusA - surplusB;
      });
      chosenFilter = filtersCalculated[0];
      if (chosenFilter.units_required === 0) chosenFilter = filtersCalculated[0];
    }

    // ---------------- infiltration & pit sizing (based on combined runoff) ----------------
    const soilKey = (soilType || "loamy").toString().toLowerCase();
    const infiltrationFraction = SOIL_INFILTRATION[soilKey] ?? SOIL_INFILTRATION["loamy"];
    const infiltrated_liters_per_year = Math.round(runoff_liters_per_year * infiltrationFraction);

    const wetMonthsSafe = Math.max(1, Math.round(Number(wetMonths || DEFAULT_WET_MONTHS)));
    const pitVolume_m3 = Math.round((infiltrated_liters_per_year / 1000) / wetMonthsSafe * 100) / 100;
    const pit_cost_estimate = Math.round(pitVolume_m3 * (pit_cost_per_m3 || DEFAULT_PIT_COST_PER_M3));

    // ---------------- channel length & cost for ground polygon (geometry-based) ----------------
    let channel_length_m = 0;
    let channel_cost = 0;
    if (includeGround && Array.isArray(groundPolygon) && groundPolygon.length >= 2) {
      const { width_m, height_m } = bboxWidthHeightMeters(groundPolygon);
      channel_length_m = Math.max(1, Math.round(Math.min(width_m, height_m)));
      const grill_cost = Math.round(channel_length_m * CHANNEL_STEEL_GRILL_COST_PER_M);
      const channel_work_cost = Math.round(channel_length_m * CHANNEL_UNIT_COST_PER_M);
      channel_cost = channel_work_cost + grill_cost + CHANNEL_END_BLOCK_COST;
    } else if (includeGround && groundArea > 0) {
      channel_length_m = Math.max(1, Math.round(Math.sqrt(groundArea)));
      channel_cost = Math.round(channel_length_m * CHANNEL_UNIT_COST_PER_M) + CHANNEL_END_BLOCK_COST + Math.round(channel_length_m * CHANNEL_STEEL_GRILL_COST_PER_M);
    }

    // ---------------- aquifer / costs / feasibility ----------------
    const aquiferCategory = AQUIFER_CATEGORIES.find(a => runoff_liters_per_year >= a.min_l_per_year && runoff_liters_per_year <= a.max_l_per_year);
    const aquiferType = aquiferCategory ? aquiferCategory.type : "Unknown";

    const chosenPipeCost = cheapestPipe ? cheapestPipe.total_cost : 0;
    const chosenFilterCost = chosenFilter ? chosenFilter.total_cost : 0;
    const totalEstimatedInstallationCost = Math.round(chosenPipeCost + chosenFilterCost + pit_cost_estimate + channel_cost);

    const ANNUAL_NEED_PER_PERSON_LPD = 85;
    const annualNeed = Math.round(dwellers * ANNUAL_NEED_PER_PERSON_LPD * 365);
    const coverageRatio = annualNeed > 0 ? (runoff_liters_per_year / annualNeed) : 0;
    const feasible = (coverageRatio >= 0.25) || (runoff_liters_per_year >= 15000);

    const result = {
      success: true,
      inputs: {
        lat, lng, roofArea, roofType, dwellers, soilType: soilKey, floors, avgFloorHeight, velocity_m_s: V_m_s, wetMonths: wetMonthsSafe,
        safetyFactorFilter, pit_cost_per_m3, includeGround, groundArea, groundSurfaces, roofPolygonProvided: !!roofPolygon, groundPolygonProvided: !!groundPolygon
      },

      rainfall_mm,
      runoff_liters_per_year,
      runoff_roof_liters_per_year,
      runoff_ground_liters_per_year,
      infiltrationFraction,
      infiltrated_liters_per_year,
      annualNeed,
      coverageRatio: Number(coverageRatio.toFixed(3)),

      flow: {
        Q_m3_s: Number(Q_m3_s.toFixed(6)),
        Q_l_s: Math.round(Q_l_s),
        velocity_m_s: Number(V_m_s.toFixed(4)),
        R_m: R_m
      },

      pipe: {
        calculated_diameter_mm: D_mm,
        pipe_length_m: pipeLength_m,
        vertical_length_m,
        horizontal_length_m,
        options: pipeOptions,
        chosen_option: cheapestPipe
      },

      filters: {
        candidates: filtersCalculated,
        chosen: chosenFilter
      },

      pit: { pit_volume_m3: pitVolume_m3, pit_cost_estimate },

      channel: { channel_length_m, channel_cost },

      aquifer: { type: aquiferType },

      costs: {
        chosen_pipe_cost: chosenPipeCost,
        chosen_filter_cost: chosenFilterCost,
        pit_cost: pit_cost_estimate,
        channel_cost,
        total_estimated_installation_cost: totalEstimatedInstallationCost
      },

      feasibility: feasible
    };

    return res.json(result);
  } catch (err) {
    console.error("calc route error:", err);
    return res.status(500).json({ success:false, message: err.message || "Internal error" });
  }
});

module.exports = router;
