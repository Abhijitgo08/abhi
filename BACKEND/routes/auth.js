// routes/location.js
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const User = require('../models/User');

// Helper: derive userId from request (priority: req.userId (auth middleware) -> x-user-id -> body/query)
function getUserIdFromReq(req) {
  if (req.userId) return String(req.userId);
  const hdr = req.headers['x-user-id'];
  if (hdr) return String(hdr);
  const auth = (req.headers['authorization'] || req.headers['Authorization'] || '').trim();
  if (auth && auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  if (req.body && req.body.userId) return String(req.body.userId);
  if (req.query && req.query.userId) return String(req.query.userId);
  return null;
}

function normalizeOptions(rawArr = []) {
  if (!Array.isArray(rawArr)) return [];
  return rawArr.map(o => {
    const lat = Number(o.lat ?? o.latitude ?? (o.center && o.center.lat));
    const lng = Number(o.lng ?? o.longitude ?? (o.center && o.center.lon));
    return {
      id: o.id || o.place_id || null,
      lat: Number.isFinite(lat) ? lat : null,
      lng: Number.isFinite(lng) ? lng : null,
      address: o.address || o.display_name || o.name || null,
      distance_m: Number(o.distance_m ?? o.distance ?? null) || null,
      raw: o.raw || o
    };
  }).filter(x => Number.isFinite(x.lat) && Number.isFinite(x.lng));
}

/**
 * POST /api/location/candidates
 * Body: { latitude, longitude, accuracy? }
 * Returns mock nearby talukas for testing
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
 * Body: { userId?, options: [...] }
 * Header: x-user-id (optional)
 */
router.post('/options', async (req, res) => {
  try {
    // debug: log headers & body keys (helps diagnose missing payloads)
    console.log('>>> /api/location/options called; headers:', JSON.stringify(req.headers || {}), 'bodyKeys:', Object.keys(req.body || {}));

    const userId = getUserIdFromReq(req);
    if (!userId) return res.status(400).json({ success:false, message:'userId required (x-user-id header, Authorization Bearer, or body.userId)' });

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ success:false, message:'invalid userId format' });
    }

    const raw = Array.isArray(req.body.options) ? req.body.options : (req.body.locationOptions || []);
    const options = normalizeOptions(raw);
    if (!options.length) return res.status(400).json({ success:false, message:'options must be a non-empty array with lat & lng' });

    // Update existing user by _id (do NOT upsert here - we expect the user document to already exist)
    const doc = await User.findByIdAndUpdate(
      userId,
      { $set: { locationOptions: options, updatedAt: new Date() } },
      { new: true } // return the updated document if exists
    ).lean();

    if (!doc) {
      // If doc is null, the provided userId didn't match any user
      console.warn('>>> /api/location/options - user not found for id:', userId);
      return res.status(404).json({ success:false, message:'user not found' });
    }

    return res.json({ success: true, savedCount: options.length, locationOptions: doc.locationOptions });
  } catch (err) {
    console.error('POST /api/location/options error:', err && err.stack ? err.stack : err);
    return res.status(500).json({ success:false, message: err && err.message });
  }
});

/**
 * GET /api/location/options
 * Query or header: userId
 */
router.get('/options', async (req, res) => {
  try {
    const userId = getUserIdFromReq(req);
    if (!userId) return res.status(400).json({ success:false, message:'userId required' });

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ success:false, message:'invalid userId format' });
    }

    const doc = await User.findById(userId).lean();
    if (!doc) return res.status(404).json({ success:false, message:'user not found' });

    return res.json({ success: true, locationOptions: doc.locationOptions || [], chosenLocation: doc.chosenLocation || null });
  } catch (err) {
    console.error('GET /api/location/options error:', err && err.stack ? err.stack : err);
    return res.status(500).json({ success:false, message: err && err.message });
  }
});

/**
 * POST /api/location/choice
 * Body: { userId?, choice: { lat, lng, address?, id? } }
 */
router.post('/choice', async (req, res) => {
  try {
    const userId = getUserIdFromReq(req);
    if (!userId) return res.status(400).json({ success:false, message:'userId required' });
    if (!mongoose.Types.ObjectId.isValid(userId)) return res.status(400).json({ success:false, message:'invalid userId format' });

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

    if (!doc) {
      console.warn('>>> /api/location/choice - user not found for id:', userId);
      return res.status(404).json({ success:false, message:'user not found' });
    }

    return res.json({ success:true, chosenLocation: doc.chosenLocation });
  } catch (err) {
    console.error('POST /api/location/choice error:', err && err.stack ? err.stack : err);
    return res.status(500).json({ success:false, message: err && err.message });
  }
});

/**
 * GET /api/location/choice
 * Query or header: userId
 */
router.get('/choice', async (req, res) => {
  try {
    const userId = getUserIdFromReq(req);
    if (!userId) return res.status(400).json({ success:false, message:'userId required' });
    if (!mongoose.Types.ObjectId.isValid(userId)) return res.status(400).json({ success:false, message:'invalid userId format' });

    const doc = await User.findById(userId).lean();
    if (!doc) return res.status(404).json({ success:false, message:'user not found' });

    return res.json({ success:true, chosenLocation: doc.chosenLocation || null });
  } catch (err) {
    console.error('GET /api/location/choice error:', err && err.stack ? err.stack : err);
    return res.status(500).json({ success:false, message: err && err.message });
  }
});

module.exports = router;
