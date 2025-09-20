// routes/location.js
const express = require('express');
const router = express.Router();
const User = require('../models/User');

// Helper: derive userId from request (priority: req.userId (auth middleware) -> x-user-id -> Bearer token -> body/query)
function getUserIdFromReq(req) {
  if (req.userId) return String(req.userId);              // set by auth middleware if used
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
    const lat = Number(o.lat ?? o.latitude ?? (o.center && o.center.lat) ?? o.lat);
    const lng = Number(o.lng ?? o.longitude ?? (o.center && o.center.lon) ?? o.lon);
    return {
      id: o.id || o.place_id || (o.raw && o.raw.place_id) || null,
      lat: Number.isFinite(lat) ? lat : null,
      lng: Number.isFinite(lng) ? lng : null,
      address: o.address || o.display_name || o.name || null,
      distance_m: Number(o.distance_m ?? o.distance ?? null) || null,
      raw: o.raw || o
    };
  }).filter(x => Number.isFinite(x.lat) && Number.isFinite(x.lng));
}

/**
 * POST /api/location/options
 * Body: { userId?, options: [...] }
 * Header: x-user-id (optional)
 */
router.post('/options', async (req, res) => {
  try {
    const userId = getUserIdFromReq(req);
    if (!userId) return res.status(400).json({ success:false, message:'userId required (x-user-id header, Authorization Bearer, or body.userId)' });

    const raw = Array.isArray(req.body.options) ? req.body.options : (req.body.locationOptions || []);
    const options = normalizeOptions(raw);
    if (!options.length) return res.status(400).json({ success:false, message:'options must be a non-empty array with lat & lng' });

    const doc = await User.findOneAndUpdate(
      { userId },
      { $set: { locationOptions: options, updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } },
      { upsert: true, new: true }
    ).lean();

    return res.json({ success: true, savedCount: options.length, locationOptions: doc.locationOptions });
  } catch (err) {
    console.error('POST /api/location/options error:', err && err.message);
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

    const doc = await User.findOne({ userId }).lean();
    return res.json({ success: true, locationOptions: doc?.locationOptions || [], chosenLocation: doc?.chosenLocation || null });
  } catch (err) {
    console.error('GET /api/location/options error:', err && err.message);
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

    const doc = await User.findOneAndUpdate(
      { userId },
      { $set: { chosenLocation: normalized, updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } },
      { upsert: true, new: true }
    ).lean();

    return res.json({ success:true, chosenLocation: doc.chosenLocation });
  } catch (err) {
    console.error('POST /api/location/choice error:', err && err.message);
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

    const doc = await User.findOne({ userId }).lean();
    return res.json({ success:true, chosenLocation: doc?.chosenLocation || null });
  } catch (err) {
    console.error('GET /api/location/choice error:', err && err.message);
    return res.status(500).json({ success:false, message: err && err.message });
  }
});

module.exports = router;
