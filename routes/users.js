// routes/users.js

const express = require('express');
const router  = express.Router();
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { getUserById, getPublicProfile, equipSkin, isWhitelisted } = require('../models/user');
const { getOwnedSkins, addSkin } = require('../models/inventory');
const { query, withTransaction } = require('../config/db');

// ─── GET /api/users/:uid/profile  (public)
router.get('/:uid/profile', async (req, res) => {
  try {
    const profile = await getPublicProfile(req.params.uid);
    if (!profile) return res.status(404).json({ error: 'User not found' });
    return res.json(profile);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to load profile' });
  }
});

// ─── POST /api/users/equip  (auth required)
// Body: { skinId: string }
router.post('/equip', requireAuth, async (req, res) => {
  const { skinId } = req.body;
  if (!skinId) return res.status(400).json({ error: 'skinId required' });
  try {
    const result = await equipSkin(req.user.uid, skinId);
    if (!result) return res.status(403).json({ error: 'Skin not owned' });
    return res.json({ activeSkin: result.active_skin });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to equip skin' });
  }
});

// ─────────────────────────────────────────────────────────────
// ADMIN ROUTES  (all require requireAuth + requireAdmin)
// ─────────────────────────────────────────────────────────────

// GET /api/users/admin/list  — all users ordered by high score
router.get('/admin/list', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT uid, username, email, is_admin, is_banned, ban_reason,
             high_score, total_coins, current_xp, created_at
      FROM users ORDER BY high_score DESC
    `);
    return res.json(rows);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to list users' });
  }
});

// POST /api/users/admin/ban
// Body: { targetUid: string, reason?: string }
router.post('/admin/ban', requireAuth, requireAdmin, async (req, res) => {
  const { targetUid, reason = '' } = req.body;
  if (!targetUid) return res.status(400).json({ error: 'targetUid required' });
  try {
    await query(`
      UPDATE users SET is_banned = TRUE, ban_reason = $2, banned_by = $3
      WHERE uid = $1
    `, [targetUid, reason, req.user.uid]);

    await query(`
      INSERT INTO activity_logs (admin_id, admin_name, action, target_uid, details)
      VALUES ($1, $2, 'BAN_USER', $3, $4)
    `, [req.user.uid, req.user.username, targetUid, reason]);

    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to ban user' });
  }
});

// POST /api/users/admin/unban
router.post('/admin/unban', requireAuth, requireAdmin, async (req, res) => {
  const { targetUid } = req.body;
  if (!targetUid) return res.status(400).json({ error: 'targetUid required' });
  try {
    await query(
      `UPDATE users SET is_banned = FALSE, ban_reason = NULL WHERE uid = $1`,
      [targetUid]
    );
    await query(`
      INSERT INTO activity_logs (admin_id, admin_name, action, target_uid)
      VALUES ($1, $2, 'UNBAN_USER', $3)
    `, [req.user.uid, req.user.username, targetUid]);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to unban user' });
  }
});

// POST /api/users/admin/grant-skin
// Body: { targetUid: string, skinId: string }
router.post('/admin/grant-skin', requireAuth, requireAdmin, async (req, res) => {
  const { targetUid, skinId } = req.body;
  if (!targetUid || !skinId) return res.status(400).json({ error: 'targetUid and skinId required' });
  try {
    const user = await getUserById(targetUid);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.owned_skins.includes(skinId)) {
      return res.status(409).json({ error: 'User already owns this skin' });
    }
    await addSkin(targetUid, skinId);
    await query(`
      INSERT INTO activity_logs (admin_id, admin_name, action, target_uid, details)
      VALUES ($1, $2, 'GRANT_SKIN', $3, $4)
    `, [req.user.uid, req.user.username, targetUid, skinId]);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to grant skin' });
  }
});

// POST /api/users/admin/grant-coins
// Body: { targetUid: string, amount: number }
router.post('/admin/grant-coins', requireAuth, requireAdmin, async (req, res) => {
  const { targetUid, amount } = req.body;
  if (!targetUid || !amount) return res.status(400).json({ error: 'targetUid and amount required' });
  if (amount <= 0 || amount > 100000) return res.status(400).json({ error: 'Amount must be 1–100,000' });
  try {
    const { rows } = await query(
      `UPDATE users SET total_coins = total_coins + $2 WHERE uid = $1 RETURNING total_coins`,
      [targetUid, Math.floor(amount)]
    );
    if (!rows[0]) return res.status(404).json({ error: 'User not found' });
    await query(`
      INSERT INTO activity_logs (admin_id, admin_name, action, target_uid, details)
      VALUES ($1, $2, 'GRANT_COINS', $3, $4)
    `, [req.user.uid, req.user.username, targetUid, `+${amount}`]);
    return res.json({ success: true, newBalance: rows[0].total_coins });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to grant coins' });
  }
});

// POST /api/users/admin/reset-score
router.post('/admin/reset-score', requireAuth, requireAdmin, async (req, res) => {
  const { targetUid } = req.body;
  if (!targetUid) return res.status(400).json({ error: 'targetUid required' });
  try {
    await query(`UPDATE users SET high_score = 0 WHERE uid = $1`, [targetUid]);
    await query(`
      INSERT INTO activity_logs (admin_id, admin_name, action, target_uid)
      VALUES ($1, $2, 'RESET_SCORE', $3)
    `, [req.user.uid, req.user.username, targetUid]);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to reset score' });
  }
});

// POST /api/users/admin/reset-cooldowns
// Body: { targetUid: string }
router.post('/admin/reset-cooldowns', requireAuth, requireAdmin, async (req, res) => {
  const { targetUid } = req.body;
  if (!targetUid) return res.status(400).json({ error: 'targetUid required' });
  try {
    await query(
      `UPDATE users SET skin_received_times = '{}', last_trade_at = NULL WHERE uid = $1`,
      [targetUid]
    );
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to reset cooldowns' });
  }
});

// GET /api/users/admin/logs  — activity logs
router.get('/admin/logs', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT * FROM activity_logs ORDER BY created_at DESC LIMIT 200`
    );
    return res.json(rows);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to load logs' });
  }
});

// ─── Marketplace whitelist ────────────────────────────────────

// POST /api/users/admin/whitelist/add
router.post('/admin/whitelist/add', requireAuth, requireAdmin, async (req, res) => {
  const { targetUid } = req.body;
  if (!targetUid) return res.status(400).json({ error: 'targetUid required' });
  try {
    await query(`
      INSERT INTO marketplace_whitelist (uid, whitelisted_by)
      VALUES ($1, $2)
      ON CONFLICT (uid) DO NOTHING
    `, [targetUid, req.user.uid]);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to whitelist user' });
  }
});

// POST /api/users/admin/whitelist/remove
router.post('/admin/whitelist/remove', requireAuth, requireAdmin, async (req, res) => {
  const { targetUid } = req.body;
  if (!targetUid) return res.status(400).json({ error: 'targetUid required' });
  try {
    await query(`DELETE FROM marketplace_whitelist WHERE uid = $1`, [targetUid]);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to remove from whitelist' });
  }
});

// GET /api/users/admin/whitelist
router.get('/admin/whitelist', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT mw.*, u.username FROM marketplace_whitelist mw
       LEFT JOIN users u ON u.uid = mw.uid
       ORDER BY mw.whitelisted_at DESC`
    );
    return res.json(rows);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to load whitelist' });
  }
});

module.exports = router;
