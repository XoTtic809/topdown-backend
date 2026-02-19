// server.js
require('dotenv').config();

const express      = require('express');
const cors         = require('cors');
const rateLimit    = require('express-rate-limit');
const http         = require('http');
const { Server }   = require('socket.io');
const { initSchema } = require('./config/db');
const { initSocketHandler } = require('./multiplayer/socketHandler');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: {
    origin:  process.env.ALLOWED_ORIGIN || '*',
    methods: ['GET', 'POST'],
  },
  pingTimeout:  20000,
  pingInterval: 10000,
});

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
    initSocketHandler(io);
    server.listen(PORT, () => {
      console.log(`\n🚀  topdown-backend v2 running on port ${PORT}`);
      console.log(`    Health:     http://localhost:${PORT}/health`);
      console.log(`    WebSocket:  ws://localhost:${PORT}\n`);
    });
  } catch (err) {
    console.error('[Boot] Failed to start:', err.message);
    process.exit(1);
  }
}

boot();
