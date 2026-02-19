// routes/traderestrictions.js
const express = require('express');
const router  = express.Router();
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { query } = require('../config/db');

// GET /api/trade-restrictions — public, returns all blocked skin IDs
router.get('/', async (req, res) => {
  try {
    const { rows } = await query(`SELECT skin_id, reason FROM trade_restrictions ORDER BY added_at DESC`);
    return res.json(rows);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to load trade restrictions' });
  }
});

// GET /api/trade-restrictions/admin/list — admin full list
router.get('/admin/list', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { rows } = await query(`SELECT * FROM trade_restrictions ORDER BY added_at DESC`);
    return res.json(rows);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to load trade restrictions' });
  }
});

// POST /api/trade-restrictions/admin/block
router.post('/admin/block', requireAuth, requireAdmin, async (req, res) => {
  const { skinId, reason = 'Restricted by admin' } = req.body;
  if (!skinId) return res.status(400).json({ error: 'skinId required' });
  try {
    await query(`
      INSERT INTO trade_restrictions (skin_id, reason, added_by)
      VALUES ($1, $2, $3)
      ON CONFLICT (skin_id) DO UPDATE SET reason = $2, added_by = $3, added_at = NOW()
    `, [skinId, reason, req.user.username]);
    await query(`
      INSERT INTO activity_logs (admin_id, admin_name, action, details)
      VALUES ($1, $2, 'BLOCK_SKIN_TRADE', $3)
    `, [req.user.uid, req.user.username, `${skinId}: ${reason}`]);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to block skin' });
  }
});

// DELETE /api/trade-restrictions/admin/:skinId
router.delete('/admin/:skinId', requireAuth, requireAdmin, async (req, res) => {
  try {
    await query(`DELETE FROM trade_restrictions WHERE skin_id = $1`, [req.params.skinId]);
    await query(`
      INSERT INTO activity_logs (admin_id, admin_name, action, details)
      VALUES ($1, $2, 'UNBLOCK_SKIN_TRADE', $3)
    `, [req.user.uid, req.user.username, req.params.skinId]);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to unblock skin' });
  }
});

module.exports = router;
