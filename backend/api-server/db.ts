import { Pool } from 'pg';

if (!process.env.DATABASE_URL) {
  console.warn('WARNING: DATABASE_URL not set — database features will be unavailable');
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('railway') ? { rejectUnauthorized: false } : false,
});

/**
 * Initialize all database tables. Safe to call on every startup (CREATE IF NOT EXISTS).
 */
export async function initDb(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS swap_programs (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      created_by    VARCHAR(50)  NOT NULL,
      name          VARCHAR(255) NOT NULL,
      description   TEXT,
      swap_type     VARCHAR(20)  NOT NULL CHECK (swap_type IN ('nft', 'fungible')),
      from_token_id VARCHAR(50)  NOT NULL,
      to_token_id   VARCHAR(50)  NOT NULL,
      treasury_account_id VARCHAR(50) NOT NULL,
      rate_from     NUMERIC      NOT NULL DEFAULT 1,
      rate_to       NUMERIC      NOT NULL DEFAULT 1,
      total_supply  BIGINT,
      status        VARCHAR(20)  NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed')),
      created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS staking_programs (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      created_by      VARCHAR(50)  NOT NULL,
      name            VARCHAR(255) NOT NULL,
      description     TEXT,
      stake_token_id  VARCHAR(50)  NOT NULL,
      reward_token_id VARCHAR(50)  NOT NULL,
      treasury_account_id VARCHAR(50) NOT NULL,
      reward_rate_per_day NUMERIC  NOT NULL,
      min_stake_amount    BIGINT   NOT NULL DEFAULT 0,
      lock_period_days    INTEGER  NOT NULL DEFAULT 0,
      total_reward_supply BIGINT,
      status          VARCHAR(20)  NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed')),
      created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS swap_transactions (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      swap_program_id UUID         REFERENCES swap_programs(id) ON DELETE SET NULL,
      user_account_id VARCHAR(50)  NOT NULL,
      serial_numbers  INTEGER[],
      amount          BIGINT,
      tx_id           VARCHAR(255),
      status          VARCHAR(20)  NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed')),
      created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS platform_users (
      account_id     VARCHAR(50)  PRIMARY KEY,
      first_seen     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      last_seen      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      total_sessions INTEGER      NOT NULL DEFAULT 1,
      tools_used     TEXT[]       NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS domain_registrations (
      id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name                VARCHAR(100) NOT NULL,
      tld                 VARCHAR(20)  NOT NULL,
      owner_account_id    VARCHAR(50)  NOT NULL,
      years               INTEGER      NOT NULL DEFAULT 1,
      registered_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      expires_at          TIMESTAMPTZ  NOT NULL,
      payment_tx_id       VARCHAR(255) NOT NULL UNIQUE,
      hcs_topic_id        VARCHAR(50),
      hcs_sequence_number BIGINT,
      price_usd           NUMERIC      NOT NULL,
      price_hbar          NUMERIC      NOT NULL,
      status              VARCHAR(20)  NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active', 'expired')),
      created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_domain_registrations_name_tld
      ON domain_registrations (name, tld);
    CREATE INDEX IF NOT EXISTS idx_domain_registrations_owner
      ON domain_registrations (owner_account_id);
  `);

  console.log('Database tables initialized');
}
