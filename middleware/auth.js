// middleware/auth.js
// Pure JWT authentication — no Firebase, no external services.
// Tokens are issued by POST /api/auth/login and verified here.

const jwt = require('jsonwebtoken');

function getSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    console.error('[Auth] JWT_SECRET not set in .env');
    process.exit(1);
  }
  return secret;
}

// ─── requireAuth ─────────────────────────────────────────────
// Blocks the request if no valid JWT is present.
// Attaches req.user = { uid, username } on success.
function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or malformed Authorization header' });
  }

  const token = header.split('Bearer ')[1];
  try {
    const decoded = jwt.verify(token, getSecret());
    req.user = { uid: decoded.uid, username: decoded.username };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token — please log in again' });
  }
}

// ─── requireAdmin ─────────────────────────────────────────────
// Use AFTER requireAuth. Checks is_admin in the database.
const { query } = require('../config/db');
async function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const { rows } = await query(
      'SELECT is_admin FROM users WHERE uid = $1',
      [req.user.uid]
    );
    if (!rows[0]?.is_admin) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    req.isAdmin = true;
    next();
  } catch (err) {
    return res.status(500).json({ error: 'Auth check failed' });
  }
}

module.exports = { requireAuth, requireAdmin };
