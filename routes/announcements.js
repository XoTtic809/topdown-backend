// routes/announcements.js
const express = require('express');
const router  = express.Router();
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { query } = require('../config/db');

// GET /api/announcements/active — public, returns active non-expired announcements
router.get('/active', async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT id, title, message, type, priority, show_to_guests, expires_at, created_at
      FROM announcements
      WHERE active = TRUE
        AND (expires_at IS NULL OR expires_at > NOW())
      ORDER BY
        CASE priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 ELSE 3 END,
        created_at DESC
      LIMIT 5
    `);
    return res.json(rows);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to load announcements' });
  }
});

// POST /api/announcements/seen — mark announcements as seen for logged-in user
router.post('/seen', requireAuth, async (req, res) => {
  const { announcementId } = req.body;
  if (!announcementId) return res.status(400).json({ error: 'announcementId required' });
  try {
    await query(`
      UPDATE users
      SET seen_announcements = array_append(seen_announcements, $2),
          updated_at = NOW()
      WHERE uid = $1 AND NOT ($2 = ANY(seen_announcements))
    `, [req.user.uid, announcementId]);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to mark as seen' });
  }
});

// GET /api/announcements/admin/list — admin only
router.get('/admin/list', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT * FROM announcements ORDER BY created_at DESC LIMIT 50`
    );
    return res.json(rows);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to load announcements' });
  }
});

// POST /api/announcements/admin/create
router.post('/admin/create', requireAuth, requireAdmin, async (req, res) => {
  const { title, message, type = 'info', priority = 'normal', active = true, showToGuests = true, expiresAt = null } = req.body;
  if (!title || !message) return res.status(400).json({ error: 'title and message required' });
  if (title.length > 100)   return res.status(400).json({ error: 'Title max 100 chars' });
  if (message.length > 500) return res.status(400).json({ error: 'Message max 500 chars' });
  try {
    const { rows } = await query(`
      INSERT INTO announcements (title, message, type, priority, admin_id, admin_name, active, show_to_guests, expires_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `, [title, message, type, priority, req.user.uid, req.user.username, active, showToGuests, expiresAt || null]);
    return res.json({ success: true, announcement: rows[0] });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to create announcement' });
  }
});

// POST /api/announcements/admin/toggle
router.post('/admin/toggle', requireAuth, requireAdmin, async (req, res) => {
  const { announcementId, active } = req.body;
  if (!announcementId || active === undefined) return res.status(400).json({ error: 'announcementId and active required' });
  try {
    await query(`UPDATE announcements SET active = $2 WHERE id = $1`, [announcementId, active]);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to toggle announcement' });
  }
});

// DELETE /api/announcements/admin/:id
router.delete('/admin/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    await query(`DELETE FROM announcements WHERE id = $1`, [req.params.id]);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to delete announcement' });
  }
});

module.exports = router;
