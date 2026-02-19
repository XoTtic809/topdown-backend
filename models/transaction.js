// models/transaction.js
const { query } = require('../config/db');

// ── Insert a trade log row (called inside the buy transaction)
async function logTrade(client, {
  buyerId, buyerName, sellerId, sellerName,
  skinId, skinName, rarity, price, tax, sellerReceived,
}) {
  const { rows } = await client.query(`
    INSERT INTO trade_logs
      (buyer_id, buyer_name, seller_id, seller_name, skin_id, skin_name,
       rarity, price, tax, seller_received)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    RETURNING *
  `, [buyerId, buyerName, sellerId, sellerName, skinId, skinName,
      rarity, price, tax, sellerReceived]);
  return rows[0];
}

// ── Recent trade logs (admin panel)
async function getRecentTrades(limit = 50) {
  const { rows } = await query(
    `SELECT * FROM trade_logs ORDER BY timestamp DESC LIMIT $1`,
    [limit]
  );
  return rows;
}

// ── Economy summary stats
async function getEconomyStats() {
  const { rows: listings } = await query(
    `SELECT COUNT(*) AS active_listings FROM listings WHERE expires_at > NOW()`
  );
  const { rows: trades } = await query(
    `SELECT COUNT(*) AS total_trades, COALESCE(SUM(price),0) AS total_volume, COALESCE(SUM(tax),0) AS total_tax FROM trade_logs`
  );
  return {
    activeListings: parseInt(listings[0].active_listings),
    totalTrades:    parseInt(trades[0].total_trades),
    totalVolume:    parseInt(trades[0].total_volume),
    totalTax:       parseInt(trades[0].total_tax),
  };
}

module.exports = { logTrade, getRecentTrades, getEconomyStats };
