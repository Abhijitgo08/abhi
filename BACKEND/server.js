require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const connectDB = require('./config/db');

const app = express();

// ===== Middleware =====
app.use(cors());
app.use(express.json());

// ===== Connect Database =====
connectDB(); // uses process.env.MONGO_URI from Render env or local .env
// ===== API Routes (register BEFORE listening) =====
app.use(cors());
app.use('/api/auth', require('./routes/auth'));
app.use('/api/rainfall', require('./routes/rainfallRoutes'));
app.use('/api/calc', require('./routes/calcRoutes'));

// ===== Health check =====
app.get('/api/health', (req, res) => res.json({ ok: true, time: Date.now() }));

// ===== Serve static frontend =====
// If your FRONTEND folder is repo/FRONTEND with index.html etc:
const frontendPath = path.join(__dirname, '..', 'FRONTEND');
app.use(express.static(frontendPath));

// Fallback to index.html for any other path (works for SPA or plain pages)
app.get('*', (req, res) => {
  const indexFile = path.join(frontendPath, 'index.html');
  return res.sendFile(indexFile, err => {
    if (err) {
      console.error('Error sending index.html:', err);
      res.status(500).send('Error loading app');
    }
  });
});

// ===== Start server =====
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
