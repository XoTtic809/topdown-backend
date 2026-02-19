// models/listing.js
const { query } = require('../config/db');

const PAGE_SIZE = 20;

// ── Fetch active (non-expired) listings with optional rarity filter + pagination
async function getListings({ rarity = 'all', sort = 'price_asc', page = 1 } = {}) {
  const offset = (page - 1) * PAGE_SIZE;
  const orderClause = sort === 'price_desc' ? 'price DESC' : 'price ASC';

  let sql = `
    SELECT id, seller_id, seller_name, skin_id, skin_name, rarity, price, created_at, expires_at
    FROM listings
    WHERE expires_at > NOW()
  `;
  const params = [];

  if (rarity !== 'all') {
    params.push(rarity);
    sql += ` AND rarity = $${params.length}`;
  }

  sql += ` ORDER BY ${orderClause} LIMIT ${PAGE_SIZE} OFFSET ${offset}`;

  const { rows } = await query(sql, params);
  return rows;
}

// ── Get a single listing (including expired — needed for admin purge)
async function getListingById(id, client = null) {
  const q = client ? client.query.bind(client) : query;
  const { rows } = await q(
    'SELECT * FROM listings WHERE id = $1',
    [id]
  );
  return rows[0] || null;
}

// ── Count active listings for a seller
async function countActiveListingsBySeller(uid) {
  const { rows } = await query(
    `SELECT COUNT(*) AS cnt FROM listings WHERE seller_id = $1 AND expires_at > NOW()`,
    [uid]
  );
  return parseInt(rows[0].cnt);
}

// ── Get all active listings for a seller (My Listings panel)
async function getListingsBySeller(uid) {
  const { rows } = await query(
    `SELECT * FROM listings WHERE seller_id = $1 ORDER BY created_at DESC`,
    [uid]
  );
  return rows;
}

// ── Create a listing (called inside a transaction)
async function createListing(client, { sellerId, sellerName, skinId, skinName, rarity, price }) {
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
  const { rows } = await client.query(`
    INSERT INTO listings (seller_id, seller_name, skin_id, skin_name, rarity, price, expires_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING *
  `, [sellerId, sellerName, skinId, skinName, rarity, price, expiresAt]);
  return rows[0];
}

// ── Delete a listing by id (called inside a transaction)
async function deleteListing(client, id) {
  await client.query('DELETE FROM listings WHERE id = $1', [id]);
}

// ── Admin: all expired listings
async function getExpiredListings() {
  const { rows } = await query(`SELECT * FROM listings WHERE expires_at <= NOW()`);
  return rows;
}

module.exports = {
  getListings, getListingById, countActiveListingsBySeller,
  getListingsBySeller, createListing, deleteListing, getExpiredListings,
};
