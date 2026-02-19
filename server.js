// server.js
require('dotenv').config();

const express   = require('express');
const cors      = require('cors');
const rateLimit = require('express-rate-limit');
const { initSchema } = require('./config/db');

const app  = express();
const PORT = process.env.PORT || 3001;

app.use(cors({
  origin: process.env.ALLOWED_ORIGIN || '*',
  methods: ['GET', 'POST', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json({ limit: '10kb' }));

app.use(rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests — slow down' },
}));

const writeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: { error: 'Too many trade requests — please wait' },
});

// ─── Routes ───────────────────────────────────────────────────
app.use('/api/auth',               require('./routes/auth'));
app.use('/api/users',              require('./routes/users'));
app.use('/api/marketplace',        require('./routes/marketplace'));
app.use('/api/leaderboard',        require('./routes/leaderboard'));
app.use('/api/battlepass',         require('./routes/battlepass'));
app.use('/api/announcements',      require('./routes/announcements'));
app.use('/api/trade-restrictions', require('./routes/traderestrictions'));

// Stricter limit on marketplace writes
app.post('/api/marketplace/buy',    writeLimiter);
app.post('/api/marketplace/list',   writeLimiter);
app.post('/api/marketplace/cancel', writeLimiter);

app.get('/health', (req, res) => res.json({ status: 'ok', ts: Date.now() }));

app.use((req, res) => res.status(404).json({ error: 'Not found' }));

app.use((err, req, res, _next) => {
  console.error('[Server] Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

async function boot() {
  try {
    await initSchema();
    app.listen(PORT, () => {
      console.log(`\n🚀  topdown-backend v2 running on port ${PORT}`);
      console.log(`    Health: http://localhost:${PORT}/health\n`);
    });
  } catch (err) {
    console.error('[Boot] Failed to start:', err.message);
    process.exit(1);
  }
}

boot();
