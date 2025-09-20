const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const User = require('../models/User');

// Extract userId (_id) from request
function getUserIdFromReq(req) {
  if (req.user && req.user.id) return String(req.user.id); // set by auth middleware
  const hdr = req.headers['x-user-id'];
  if (hdr) return String(hdr);
  if (req.body && req.body.userId) return String(req.body.userId);
  if (req.query && req.query.userId) return String(req.query.userId);
  return null;
}

// Normalize options
// Normalize options
function normalizeOptions(rawArr = []) {
  if (!Array.isArray(rawArr)) return [];

  return rawArr.map(o => {
    // accept many lat/lng keys: lat, latitude, center.lat
    const lat = Number(o.lat ?? o.latitude ?? (o.center && o.center.lat));
    // accept many lng keys: lng, lon, longitude, center.lon
    const lng = Number(o.lng ?? o.lon ?? o.longitude ?? (o.center && o.center.lon));

    // distance may be provided under different keys
    const distanceCandidate = o.distance_m ?? o.distance ?? o.dist ?? null;
    const distance_m = distanceCandidate != null ? Number(distanceCandidate) : null;

    return {
      id: o.id || o.place_id || null,
      lat: Number.isFinite(lat) ? lat : null,
      lng: Number.isFinite(lng) ? lng : null,
      // prefer structured address-like fields but fall back to name
      address: o.address || o.display_name || o.name || null,
      distance_m: Number.isFinite(Number(distance_m)) ? Number(distance_m) : null,
      raw: o
    };
  }).filter(x => Number.isFinite(x.lat) && Number.isFinite(x.lng));
}


/**
 * POST /api/location/candidates
 * Mock response for nearby talukas
 */
router.post('/candidates', (req, res) => {
  const { latitude, longitude } = req.body || {};
  if (!Number.isFinite(Number(latitude)) || !Number.isFinite(Number(longitude))) {
    return res.status(400).json({ success: false, message: 'latitude & longitude required' });
  }

  const lat = Number(latitude);
  const lon = Number(longitude);

  const talukas = [
    { id: 'near_1', name: 'Nearby Place 1', lat, lon, distance_m: 0 },
    { id: 'near_2', name: 'Nearby Place 2', lat: lat + 0.0008, lon: lon - 0.0006, distance_m: 90 },
    { id: 'near_3', name: 'Nearby Place 3', lat: lat - 0.0011, lon: lon + 0.0012, distance_m: 140 },
    { id: 'near_4', name: 'Nearby Place 4', lat: lat + 0.0015, lon: lon + 0.0015, distance_m: 200 }
  ];

  return res.json({ success: true, talukas });
});

/**
 * POST /api/location/options
 */
router.post('/options', async (req, res) => {
  try {
    const userId = getUserIdFromReq(req);
    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ success:false, message:'valid userId required' });
    }

    const raw = Array.isArray(req.body.options) ? req.body.options : (req.body.locationOptions || []);
    const options = normalizeOptions(raw);
    if (!options.length) {
      return res.status(400).json({ success:false, message:'options must be a non-empty array with lat & lng' });
    }

    const doc = await User.findByIdAndUpdate(
  userId,
  { $set: { locationOptions: options, updatedAt: new Date() } },
  { new: true, upsert: false }
).lean();

if (!doc) {
  console.warn(`POST /api/location/options — user ${userId} not found`);
  return res.status(404).json({ success: false, message: 'user not found', code: 'user_not_found' });
}

return res.json({ success: true, savedCount: options.length, locationOptions: doc.locationOptions });

  } catch (err) {
    console.error('POST /api/location/options error:', err);
    return res.status(500).json({ success:false, message: err.message });
  }
});

/**
 * GET /api/location/options
 */
router.get('/options', async (req, res) => {
  try {
    const userId = getUserIdFromReq(req);
    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ success:false, message:'valid userId required' });
    }

    const doc = await User.findById(userId).lean();
    return res.json({ success: true, locationOptions: doc?.locationOptions || [], chosenLocation: doc?.chosenLocation || null });
  } catch (err) {
    console.error('GET /api/location/options error:', err);
    return res.status(500).json({ success:false, message: err.message });
  }
});

/**
 * POST /api/location/choice
 */
router.post('/choice', async (req, res) => {
  try {
    const userId = getUserIdFromReq(req);
    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ success:false, message:'valid userId required' });
    }

    const choice = req.body.choice || req.body.chosen || req.body;
    if (!choice || !Number.isFinite(Number(choice.lat)) || !Number.isFinite(Number(choice.lng))) {
      return res.status(400).json({ success:false, message:'choice must include numeric lat & lng' });
    }

    const normalized = {
      id: choice.id || null,
      lat: Number(choice.lat),
      lng: Number(choice.lng),
      address: choice.address || null,
      raw: choice.raw || choice,
      chosenAt: new Date()
    };

    const doc = await User.findByIdAndUpdate(
      userId,
      { $set: { chosenLocation: normalized, updatedAt: new Date() } },
      { new: true }
    ).lean();

    return res.json({ success:true, chosenLocation: doc.chosenLocation });
  } catch (err) {
    console.error('POST /api/location/choice error:', err);
    return res.status(500).json({ success:false, message: err.message });
  }
});

/**
 * GET /api/location/choice
 */
router.get('/choice', async (req, res) => {
  try {
    const userId = getUserIdFromReq(req);
    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ success:false, message:'valid userId required' });
    }

    const doc = await User.findById(userId).lean();
    return res.json({ success:true, chosenLocation: doc?.chosenLocation || null });
  } catch (err) {
    console.error('GET /api/location/choice error:', err);
    return res.status(500).json({ success:false, message: err.message });
  }
});

module.exports = router;
