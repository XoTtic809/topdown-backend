// routes/leaderboard.js

const express = require('express');
const router  = express.Router();
const { query } = require('../config/db');

// GET /api/leaderboard/scores?limit=50
router.get('/scores', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 100);
  try {
    const { rows } = await query(`
      SELECT uid, username, high_score, created_at
      FROM users
      WHERE is_banned = FALSE
      ORDER BY high_score DESC
      LIMIT $1
    `, [limit]);
    return res.json(rows);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to load leaderboard' });
  }
});

// GET /api/leaderboard/coins?limit=50
router.get('/coins', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 100);
  try {
    const { rows } = await query(`
      SELECT uid, username, total_coins
      FROM users
      WHERE is_banned = FALSE
      ORDER BY total_coins DESC
      LIMIT $1
    `, [limit]);
    return res.json(rows);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to load coins leaderboard' });
  }
});

// GET /api/leaderboard/levels?limit=50
router.get('/levels', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 100);
  try {
    const { rows } = await query(`
      SELECT uid, username, current_xp
      FROM users
      WHERE is_banned = FALSE
      ORDER BY current_xp DESC
      LIMIT $1
    `, [limit]);
    return res.json(rows);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to load level leaderboard' });
  }
});

module.exports = router;
