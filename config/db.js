// config/db.js
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: false }
    : false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
  console.error('[DB] Pool error:', err.message);
});

async function initSchema() {
  const client = await pool.connect();
  try {
    await client.query(`
      -- Enable UUID generation
      CREATE EXTENSION IF NOT EXISTS "pgcrypto";

      -- Users
      CREATE TABLE IF NOT EXISTS users (
        uid            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
        username       TEXT NOT NULL UNIQUE,
        email          TEXT NOT NULL UNIQUE,
        password_hash  TEXT NOT NULL,
        is_admin       BOOLEAN   NOT NULL DEFAULT FALSE,
        is_banned      BOOLEAN   NOT NULL DEFAULT FALSE,
        ban_reason     TEXT,
        banned_by      TEXT,
        high_score     INTEGER   NOT NULL DEFAULT 0,
        total_coins    INTEGER   NOT NULL DEFAULT 0,
        current_xp     INTEGER   NOT NULL DEFAULT 0,
        owned_skins    TEXT[]    NOT NULL DEFAULT ARRAY['agent'],
        active_skin    TEXT      NOT NULL DEFAULT 'agent',
        skin_received_times  JSONB NOT NULL DEFAULT '{}',
        last_trade_at        TIMESTAMPTZ,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      -- Marketplace whitelist
      CREATE TABLE IF NOT EXISTS marketplace_whitelist (
        uid             TEXT PRIMARY KEY REFERENCES users(uid) ON DELETE CASCADE,
        whitelisted_by  TEXT NOT NULL,
        whitelisted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      -- Marketplace listings
      CREATE TABLE IF NOT EXISTS listings (
        id           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
        seller_id    TEXT NOT NULL REFERENCES users(uid),
        seller_name  TEXT NOT NULL,
        skin_id      TEXT NOT NULL,
        skin_name    TEXT NOT NULL,
        rarity       TEXT NOT NULL,
        price        INTEGER NOT NULL,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at   TIMESTAMPTZ NOT NULL
      );

      -- Trade logs
      CREATE TABLE IF NOT EXISTS trade_logs (
        id               TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
        buyer_id         TEXT NOT NULL,
        buyer_name       TEXT NOT NULL,
        seller_id        TEXT NOT NULL,
        seller_name      TEXT NOT NULL,
        skin_id          TEXT NOT NULL,
        skin_name        TEXT NOT NULL,
        rarity           TEXT NOT NULL,
        price            INTEGER NOT NULL,
        tax              INTEGER NOT NULL,
        seller_received  INTEGER NOT NULL,
        timestamp        TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      -- Admin activity logs
      CREATE TABLE IF NOT EXISTS activity_logs (
        id         SERIAL PRIMARY KEY,
        admin_id   TEXT NOT NULL,
        admin_name TEXT NOT NULL,
        action     TEXT NOT NULL,
        target_uid TEXT,
        details    TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      -- Indexes
      CREATE INDEX IF NOT EXISTS idx_listings_expires     ON listings(expires_at);
      CREATE INDEX IF NOT EXISTS idx_listings_seller      ON listings(seller_id);
      CREATE INDEX IF NOT EXISTS idx_listings_price       ON listings(price);
      CREATE INDEX IF NOT EXISTS idx_trade_logs_buyer     ON trade_logs(buyer_id, timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_trade_logs_seller    ON trade_logs(seller_id, timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_trade_logs_timestamp ON trade_logs(timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_users_high_score     ON users(high_score DESC);
      CREATE INDEX IF NOT EXISTS idx_users_total_coins    ON users(total_coins DESC);
    `);
    console.log('[DB] Schema ready');
  } finally {
    client.release();
  }
}

async function query(sql, params) {
  return pool.query(sql, params);
}

async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, query, withTransaction, initSchema };
