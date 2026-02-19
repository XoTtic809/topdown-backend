// server.js
require('dotenv').config();

const express   = require('express');
const cors      = require('cors');
const rateLimit = require('express-rate-limit');
const { initSchema } = require('./config/db');

const app  = express();
const PORT = process.env.PORT || 3001;

// ─── Middleware ───────────────────────────────────────────────
app.use(cors({
  origin: process.env.ALLOWED_ORIGIN || '*',
  methods: ['GET', 'POST', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json({ limit: '10kb' }));

// Global rate limit — 120 requests per minute per IP
app.use(rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests — slow down' },
}));

// Stricter rate limit for marketplace writes
const writeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: { error: 'Too many trade requests — please wait' },
});

// ─── Routes ───────────────────────────────────────────────────
const authRoutes        = require('./routes/auth');
const usersRoutes       = require('./routes/users');
const marketplaceRoutes = require('./routes/marketplace');
const leaderboardRoutes = require('./routes/leaderboard');

app.use('/api/auth',        authRoutes);
app.use('/api/users',       usersRoutes);
app.use('/api/marketplace', marketplaceRoutes);
app.use('/api/leaderboard', leaderboardRoutes);

// Stricter limit on marketplace write endpoints
app.post('/api/marketplace/buy',    writeLimiter);
app.post('/api/marketplace/list',   writeLimiter);
app.post('/api/marketplace/cancel', writeLimiter);

// ─── Health check ─────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok', ts: Date.now() }));

// ─── 404 ─────────────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// ─── Error handler ───────────────────────────────────────────
app.use((err, req, res, _next) => {
  console.error('[Server] Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ─── Boot ─────────────────────────────────────────────────────
async function boot() {
  try {
    await initSchema();
    app.listen(PORT, () => {
      console.log(`\n🚀  topdown-backend running on port ${PORT}`);
      console.log(`    Health: http://localhost:${PORT}/health\n`);
    });
  } catch (err) {
    console.error('[Boot] Failed to start:', err.message);
    process.exit(1);
  }
}

boot();
