CREATE TABLE IF NOT EXISTS users (
  telegram_id TEXT PRIMARY KEY,
  username TEXT,
  first_name TEXT,
  balance BIGINT NOT NULL DEFAULT 0,
  taps BIGINT NOT NULL DEFAULT 0,
  energy INTEGER NOT NULL DEFAULT 1000,
  max_energy INTEGER NOT NULL DEFAULT 1000,
  last_energy_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  task_bonus BIGINT NOT NULL DEFAULT 0,
  streak INTEGER NOT NULL DEFAULT 0,
  last_daily DATE,
  referred_by TEXT,
  wallet_address TEXT,
  joined BOOLEAN NOT NULL DEFAULT FALSE,
  risk_score INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS ledger (
  id BIGSERIAL PRIMARY KEY,
  telegram_id TEXT NOT NULL REFERENCES users(telegram_id),
  amount BIGINT NOT NULL,
  reason TEXT NOT NULL,
  idempotency_key TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS tap_batches (
  id BIGSERIAL PRIMARY KEY,
  telegram_id TEXT NOT NULL REFERENCES users(telegram_id),
  count INTEGER NOT NULL,
  client_idempotency_key TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS task_completions (
  telegram_id TEXT NOT NULL REFERENCES users(telegram_id),
  task_id TEXT NOT NULL,
  completed_on DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(telegram_id, task_id, completed_on)
);
CREATE TABLE IF NOT EXISTS user_cards (
  telegram_id TEXT NOT NULL REFERENCES users(telegram_id),
  card_id TEXT NOT NULL,
  level INTEGER NOT NULL DEFAULT 1,
  purchased_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  upgraded_at TIMESTAMPTZ,
  PRIMARY KEY(telegram_id, card_id)
);
CREATE TABLE IF NOT EXISTS payment_intents (
  id UUID PRIMARY KEY,
  telegram_id TEXT NOT NULL REFERENCES users(telegram_id),
  wallet_address TEXT,
  amount_nanoton BIGINT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  tx_hash TEXT UNIQUE,
  verification_attempts INTEGER NOT NULL DEFAULT 0,
  last_checked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  verified_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS referrals (
  id BIGSERIAL PRIMARY KEY,
  referrer_id TEXT NOT NULL REFERENCES users(telegram_id),
  referred_id TEXT NOT NULL REFERENCES users(telegram_id),
  status TEXT NOT NULL DEFAULT 'pending',
  reward BIGINT NOT NULL DEFAULT 500,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  activated_at TIMESTAMPTZ,
  UNIQUE(referred_id),
  CHECK(referrer_id <> referred_id)
);
CREATE TABLE IF NOT EXISTS risk_events (
  id BIGSERIAL PRIMARY KEY,
  telegram_id TEXT NOT NULL REFERENCES users(telegram_id),
  points INTEGER NOT NULL,
  event TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ledger_user ON ledger(telegram_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_user ON task_completions(telegram_id, completed_on);
CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_id,status);
CREATE INDEX IF NOT EXISTS idx_risk_user ON risk_events(telegram_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_user ON payment_intents(telegram_id,created_at DESC);

-- Safe upgrades for databases created by earlier TapNova versions.
ALTER TABLE payment_intents ADD COLUMN IF NOT EXISTS verification_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE payment_intents ADD COLUMN IF NOT EXISTS last_checked_at TIMESTAMPTZ;


CREATE TABLE IF NOT EXISTS airdrop_snapshots (
  id UUID PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'finalized' CHECK(status IN ('finalized','closed')),
  pool_amount NUMERIC(30,6) NOT NULL CHECK(pool_amount > 0),
  total_score NUMERIC(40,6) NOT NULL DEFAULT 0,
  eligible_users INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finalized_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS airdrop_allocations (
  snapshot_id UUID NOT NULL REFERENCES airdrop_snapshots(id) ON DELETE CASCADE,
  telegram_id TEXT NOT NULL REFERENCES users(telegram_id),
  score NUMERIC(40,6) NOT NULL DEFAULT 0,
  allocation NUMERIC(30,6) NOT NULL DEFAULT 0,
  wallet_address TEXT,
  risk_score INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'available' CHECK(status IN ('available','claimed','paid','revoked')),
  claim_id UUID,
  claim_tx_hash TEXT,
  claimed_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  PRIMARY KEY(snapshot_id,telegram_id),
  UNIQUE(claim_id),
  UNIQUE(claim_tx_hash)
);
CREATE TABLE IF NOT EXISTS airdrop_claims (
  id UUID PRIMARY KEY,
  snapshot_id UUID NOT NULL REFERENCES airdrop_snapshots(id) ON DELETE CASCADE,
  telegram_id TEXT NOT NULL REFERENCES users(telegram_id),
  wallet_address TEXT NOT NULL,
  amount NUMERIC(30,6) NOT NULL CHECK(amount > 0),
  status TEXT NOT NULL DEFAULT 'requested' CHECK(status IN ('requested','paid','rejected')),
  payout_tx_hash TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_at TIMESTAMPTZ,
  UNIQUE(snapshot_id,telegram_id)
);
CREATE INDEX IF NOT EXISTS idx_airdrop_alloc_user ON airdrop_allocations(telegram_id,status);
CREATE INDEX IF NOT EXISTS idx_airdrop_claims_user ON airdrop_claims(telegram_id,status);
