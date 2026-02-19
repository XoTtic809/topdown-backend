// routes/auth.js
// Complete self-hosted authentication.
// No Firebase — passwords hashed with bcrypt, sessions via JWT.

const express = require('express');
const router  = express.Router();
const bcrypt  = require('bcrypt');
const jwt     = require('jsonwebtoken');
const { query } = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const { updateProgress } = require('../models/user');

const SALT_ROUNDS = 12;

function signToken(uid, username) {
  return jwt.sign(
    { uid, username },
    process.env.JWT_SECRET,
    { expiresIn: '30d' }
  );
}

// ─── POST /api/auth/signup ────────────────────────────────────
// Body: { username, email, password }
router.post('/signup', async (req, res) => {
  const { username, email, password } = req.body;

  if (!username || !email || !password) {
    return res.status(400).json({ error: 'username, email, and password are required' });
  }
  if (username.trim().length < 2 || username.trim().length > 32) {
    return res.status(400).json({ error: 'Username must be 2–32 characters' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  try {
    // Check username and email are not already taken
    const { rows: existing } = await query(
      'SELECT uid FROM users WHERE LOWER(username) = LOWER($1) OR LOWER(email) = LOWER($2)',
      [username.trim(), email.trim()]
    );
    if (existing.length > 0) {
      return res.status(409).json({ error: 'Username or email already taken' });
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    const { rows } = await query(`
      INSERT INTO users (username, email, password_hash)
      VALUES ($1, $2, $3)
      RETURNING uid, username, email, is_admin, total_coins, high_score,
                current_xp, owned_skins, active_skin, created_at
    `, [username.trim(), email.trim().toLowerCase(), passwordHash]);

    const user  = rows[0];
    const token = signToken(user.uid, user.username);

    return res.status(201).json({
      token,
      uid:        user.uid,
      username:   user.username,
      isAdmin:    user.is_admin,
      totalCoins: user.total_coins,
      highScore:  user.high_score,
      currentXp:  user.current_xp,
      ownedSkins: user.owned_skins,
      activeSkin: user.active_skin,
      createdAt:  user.created_at,
    });
  } catch (err) {
    console.error('[Auth] /signup error:', err.message);
    return res.status(500).json({ error: 'Signup failed' });
  }
});

// ─── POST /api/auth/login ─────────────────────────────────────
// Body: { email, password }
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }

  try {
    const { rows } = await query(
      'SELECT * FROM users WHERE LOWER(email) = LOWER($1)',
      [email.trim()]
    );
    const user = rows[0];

    if (!user) {
      // Generic message — don't reveal whether email exists
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    if (user.is_banned) {
      return res.status(403).json({
        error: 'Account banned',
        reason: user.ban_reason || 'No reason provided',
      });
    }

    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = signToken(user.uid, user.username);

    return res.json({
      token,
      uid:               user.uid,
      username:          user.username,
      isAdmin:           user.is_admin,
      totalCoins:        user.total_coins,
      highScore:         user.high_score,
      currentXp:         user.current_xp,
      ownedSkins:        user.owned_skins,
      activeSkin:        user.active_skin,
      skinReceivedTimes: user.skin_received_times,
      createdAt:         user.created_at,
    });
  } catch (err) {
    console.error('[Auth] /login error:', err.message);
    return res.status(500).json({ error: 'Login failed' });
  }
});

// ─── GET /api/auth/me ─────────────────────────────────────────
// Returns current user profile. Requires Authorization: Bearer <token>
router.get('/me', requireAuth, async (req, res) => {
  try {
    const { rows } = await query('SELECT * FROM users WHERE uid = $1', [req.user.uid]);
    const user = rows[0];
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (user.is_banned) {
      return res.status(403).json({ error: 'Account banned', reason: user.ban_reason });
    }

    return res.json({
      uid:               user.uid,
      username:          user.username,
      isAdmin:           user.is_admin,
      totalCoins:        user.total_coins,
      highScore:         user.high_score,
      currentXp:         user.current_xp,
      ownedSkins:        user.owned_skins,
      activeSkin:        user.active_skin,
      skinReceivedTimes: user.skin_received_times,
      createdAt:         user.created_at,
    });
  } catch (err) {
    console.error('[Auth] /me error:', err.message);
    return res.status(500).json({ error: 'Failed to load profile' });
  }
});

// ─── POST /api/auth/progress ──────────────────────────────────
// Saves score/coins/XP after each game round.
// Body: { highScore, totalCoins, currentXp }
router.post('/progress', requireAuth, async (req, res) => {
  try {
    const { highScore = 0, totalCoins = 0, currentXp = 0 } = req.body;

    if (highScore < 0 || highScore > 9_999_999)     return res.status(400).json({ error: 'Invalid score' });
    if (totalCoins < 0 || totalCoins > 10_000_000)  return res.status(400).json({ error: 'Invalid coins' });
    if (currentXp  < 0 || currentXp  > 10_000_000) return res.status(400).json({ error: 'Invalid XP' });

    const updated = await updateProgress(req.user.uid, {
      highScore:  Math.floor(highScore),
      totalCoins: Math.floor(totalCoins),
      currentXp:  Math.floor(currentXp),
    });

    if (!updated) return res.status(404).json({ error: 'User not found' });
    return res.json(updated);
  } catch (err) {
    console.error('[Auth] /progress error:', err.message);
    return res.status(500).json({ error: 'Failed to save progress' });
  }
});

// ─── POST /api/auth/change-password ───────────────────────────
// Body: { currentPassword, newPassword }
router.post('/change-password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'currentPassword and newPassword required' });
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters' });
  }

  try {
    const { rows } = await query('SELECT password_hash FROM users WHERE uid = $1', [req.user.uid]);
    const user = rows[0];
    if (!user) return res.status(404).json({ error: 'User not found' });

    const match = await bcrypt.compare(currentPassword, user.password_hash);
    if (!match) return res.status(401).json({ error: 'Current password is incorrect' });

    const newHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    await query('UPDATE users SET password_hash = $2 WHERE uid = $1', [req.user.uid, newHash]);

    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to change password' });
  }
});

module.exports = router;
