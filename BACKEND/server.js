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
connectDB(); // connects using process.env.MONGO_URI

// ===== API Routes (register BEFORE listening) =====
app.use('/api/auth', require('./routes/auth'));
app.use('/api/rainfall', require('./routes/rainfallRoutes'));
app.use('/api/calc', require('./routes/calcRoutes'));

// ===== Health check =====
app.get('/api/health', (req, res) => res.json({ ok: true, time: Date.now() }));

// ===== Serve static frontend =====
const frontendPath = path.join(__dirname, '..', 'FRONTEND');
app.use(express.static(frontendPath));

// ===== Fallback for non-API requests (REGEX catch-all) =====
// Using a regex avoids path-to-regexp parsing issues on some versions.
app.get(/.*/, (req, res) => {
  // If it's an API route, return 404 JSON instead of index.html
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ ok: false, msg: 'API route not found' });
  }

  const indexFile = path.join(frontendPath, 'index.html');
  res.sendFile(indexFile, err => {
    if (err) {
      console.error('Error sending index.html:', err);
      res.status(500).send('Error loading app');
    }
  });
});

// ===== Start server =====
// safe start: use Render's PORT, bind to 0.0.0.0, and increase timeouts
const PORT = Number(process.env.PORT) || 10000; // Render uses 10000 by default
const HOST = '0.0.0.0';

const start = async () => {
  try {
    await connectDB(); // wait for DB connection (optional but recommended)

    const server = app.listen(PORT, HOST, () => {
      console.log(`🚀 Server running on ${HOST}:${PORT}`);
    });

    // increase timeouts to avoid Render LB 502s for long requests
    server.keepAliveTimeout = 120000; // 120s
    server.headersTimeout   = 120000; // 120s
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
};

start();
