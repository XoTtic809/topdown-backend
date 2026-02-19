// models/user.js
const { query } = require('../config/db');

// ── Upsert on first login (create row if uid doesn't exist yet)
async function upsertUser(uid, { username, email }) {
  const { rows } = await query(`
    INSERT INTO users (uid, username, email)
    VALUES ($1, $2, $3)
    ON CONFLICT (uid) DO UPDATE
      SET username   = EXCLUDED.username,
          email      = EXCLUDED.email,
          updated_at = NOW()
    RETURNING *
  `, [uid, username, email]);
  return rows[0];
}

// ── Full user row (for profile / admin views)
async function getUserById(uid) {
  const { rows } = await query('SELECT * FROM users WHERE uid = $1', [uid]);
  return rows[0] || null;
}

// ── Public profile (safe subset — never returns is_admin to the client)
async function getPublicProfile(uid) {
  const { rows } = await query(`
    SELECT uid, username, high_score, total_coins, current_xp,
           owned_skins, active_skin, created_at
    FROM users WHERE uid = $1
  `, [uid]);
  return rows[0] || null;
}

// ── Update score / coins / XP — called from the game after each round
async function updateProgress(uid, { highScore, totalCoins, currentXp }) {
  const { rows } = await query(`
    UPDATE users SET
      high_score  = GREATEST(high_score, $2),
      total_coins = $3,
      current_xp  = $4,
      updated_at  = NOW()
    WHERE uid = $1
    RETURNING high_score, total_coins, current_xp
  `, [uid, highScore, totalCoins, currentXp]);
  return rows[0] || null;
}

// ── Equip skin (validates ownership server-side)
async function equipSkin(uid, skinId) {
  const { rows } = await query(`
    UPDATE users SET active_skin = $2, updated_at = NOW()
    WHERE uid = $1 AND $2 = ANY(owned_skins)
    RETURNING active_skin
  `, [uid, skinId]);
  return rows[0] || null; // null means skin not owned
}

// ── Check whitelist
async function isWhitelisted(uid) {
  const { rows } = await query(
    'SELECT 1 FROM marketplace_whitelist WHERE uid = $1',
    [uid]
  );
  return rows.length > 0;
}

module.exports = { upsertUser, getUserById, getPublicProfile, updateProgress, equipSkin, isWhitelisted };
