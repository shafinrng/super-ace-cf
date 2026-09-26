-- Phase 3: users, sessions, virtual-credit balances.
-- Play-money only: balances are virtual credits with no cash value.
-- There is no purchase mechanism and none may be added — the only code
-- path that grants credits is the free top-up (src/routes/wallet.ts).

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL COLLATE NOCASE UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  -- Integer cents (100 = 1.00 credit) so no float arithmetic ever
  -- touches a balance. 1000000 = 10,000.00 starting credits.
  balance_cents INTEGER NOT NULL DEFAULT 1000000 CHECK (balance_cents >= 0),
  created_at INTEGER NOT NULL,
  last_topup_at INTEGER,
  last_login_at INTEGER
);

CREATE TABLE IF NOT EXISTS sessions (
  -- SHA-256 of the session token; the raw token only ever lives in the
  -- client's cookie, so a database leak cannot be replayed as a login.
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
