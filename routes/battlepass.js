// routes/battlepass.js
const express = require('express');
const router  = express.Router();
const { requireAuth } = require('../middleware/auth');
const { query } = require('../config/db');

// GET /api/battlepass/me — load battle pass + crate inventory
router.get('/me', requireAuth, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT battle_pass_data, crate_inventory FROM users WHERE uid = $1`,
      [req.user.uid]
    );
    if (!rows[0]) return res.status(404).json({ error: 'User not found' });
    return res.json({
      battlePassData:  rows[0].battle_pass_data  || {},
      crateInventory:  rows[0].crate_inventory   || {},
    });
  } catch (err) {
    console.error('[BP] GET /me error:', err.message);
    return res.status(500).json({ error: 'Failed to load battle pass' });
  }
});

// POST /api/battlepass/save — save battle pass + crate inventory
router.post('/save', requireAuth, async (req, res) => {
  try {
    const { battlePassData, crateInventory } = req.body;
    if (!battlePassData && !crateInventory) {
      return res.status(400).json({ error: 'battlePassData or crateInventory required' });
    }
    await query(`
      UPDATE users SET
        battle_pass_data = $2,
        crate_inventory  = $3,
        updated_at       = NOW()
      WHERE uid = $1
    `, [
      req.user.uid,
      JSON.stringify(battlePassData || {}),
      JSON.stringify(crateInventory || {}),
    ]);
    return res.json({ success: true });
  } catch (err) {
    console.error('[BP] POST /save error:', err.message);
    return res.status(500).json({ error: 'Failed to save battle pass' });
  }
});

module.exports = router;
