-- Phase 4: provably-fair game sessions, per-spin seed storage, and
-- server-authoritative bonus-round state.
-- Play-money only. No purchase mechanism exists in this project and
-- none may be added.

-- One ACTIVE session per user (partial unique index below): its nonce
-- sequence serializes all spins, and rotating it reveals the server
-- seed so every stored spin can be replayed and verified.
CREATE TABLE IF NOT EXISTS game_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Kept secret until the session is rotated/closed; its SHA-256 hash
  -- is published at creation (commit-reveal).
  server_seed TEXT NOT NULL,
  server_seed_hash TEXT NOT NULL,
  client_seed TEXT NOT NULL,
  nonce INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  closed_at INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_game_sessions_one_active
  ON game_sessions(user_id) WHERE active = 1;

-- One row per spin: the seed material is denormalized onto every spin so
-- any single outcome is verifiable on its own once the server seed is
-- revealed. UNIQUE(session_id, nonce) is the concurrency guard — a raced
-- duplicate spin fails the batch transaction instead of double-spending.
CREATE TABLE IF NOT EXISTS spins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
  nonce INTEGER NOT NULL,
  bet_cents INTEGER NOT NULL,
  win_cents INTEGER NOT NULL,
  balance_after_cents INTEGER NOT NULL,
  is_free_spin INTEGER NOT NULL DEFAULT 0,
  free_spins_awarded INTEGER NOT NULL DEFAULT 0,
  server_seed_hash TEXT NOT NULL,
  client_seed TEXT NOT NULL,
  -- Full engine SpinResult (grids, cascades, wins) for replay/audit.
  result_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (session_id, nonce)
);

CREATE INDEX IF NOT EXISTS idx_spins_user ON spins(user_id, created_at);

-- Server-side Free Spins bonus-round state (src/engine/BonusRound.ts),
-- persisted across requests. One row per user at most (PRIMARY KEY).
CREATE TABLE IF NOT EXISTS bonus_rounds (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  total_awarded INTEGER NOT NULL,
  remaining INTEGER NOT NULL,
  total_win_cents INTEGER NOT NULL DEFAULT 0,
  spins_used INTEGER NOT NULL DEFAULT 0,
  -- Bet is locked at the triggering base spin's amount.
  bet_cents INTEGER NOT NULL,
  started_at INTEGER NOT NULL
);
