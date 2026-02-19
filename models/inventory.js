// models/inventory.js
const { query } = require('../config/db');

// ── Get owned skins array
async function getOwnedSkins(uid) {
  const { rows } = await query('SELECT owned_skins FROM users WHERE uid = $1', [uid]);
  return rows[0]?.owned_skins || [];
}

// ── Add a skin (idempotent — no-op if already owned)
async function addSkin(uid, skinId, client = null) {
  if (client) {
    await client.query(`
      UPDATE users
      SET owned_skins = array_append(owned_skins, $2),
          skin_received_times = skin_received_times || jsonb_build_object($2, NOW()::TEXT),
          updated_at = NOW()
      WHERE uid = $1 AND NOT ($2 = ANY(owned_skins))
    `, [uid, skinId]);
  } else {
    await query(`
      UPDATE users
      SET owned_skins = array_append(owned_skins, $2),
          skin_received_times = skin_received_times || jsonb_build_object($2, NOW()::TEXT),
          updated_at = NOW()
      WHERE uid = $1 AND NOT ($2 = ANY(owned_skins))
    `, [uid, skinId]);
  }
}

// ── Remove a skin (used when listing on marketplace)
async function removeSkin(uid, skinId, client) {
  await client.query(`
    UPDATE users
    SET owned_skins = array_remove(owned_skins, $2),
        updated_at  = NOW()
    WHERE uid = $1
  `, [uid, skinId]);
}

// ── Check if a skin was received within the last N hours (trade cooldown)
async function getSkinReceivedTime(uid, skinId) {
  const { rows } = await query(
    `SELECT skin_received_times->$2 AS received_at FROM users WHERE uid = $1`,
    [uid, skinId]
  );
  return rows[0]?.received_at || null;
}

module.exports = { getOwnedSkins, addSkin, removeSkin, getSkinReceivedTime };
