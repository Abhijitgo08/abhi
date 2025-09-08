require('dotenv').config();
const express = require('express');
const cors = require('cors');
const connectDB = require('./config/db');

const app = express(); // <-- app must be initialized BEFORE using it

// Connect Database
connectDB();

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use('/api/auth', require('./routes/auth'));

// Start Server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
const rainfallRoutes = require("./routes/rainfallRoutes");
app.use("/api/rainfall", rainfallRoutes);
const calcRoutes = require("./routes/calcRoutes");
app.use("/api/calc", calcRoutes);
