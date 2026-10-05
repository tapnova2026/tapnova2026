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
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  verified_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_ledger_user ON ledger(telegram_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_user ON task_completions(telegram_id, completed_on);
