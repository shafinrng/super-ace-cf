# super-ace-cf

Play-money cascading-slot demo built for Cloudflare Workers. Ported from the
reference repo `super-ace-platform` (kept read-only; the Docker stack stays
untouched).

**Scope of this project (agreed 2026-09-16):** virtual credits only — no
payments, no KYC, no real-money features, no RTP overrides. Fixed, published
RTP with provably-fair seeds once the engine is ported.

## Layout

- `src/index.ts` — Worker entry: `/api/*` routes, everything else falls
  through to static assets.
- `public/` — static frontend assets (Workers Assets).
- `wrangler.jsonc` — config; D1 / Durable Object bindings arrive in later
  phases.
- `../reference/` — read-only snapshot of the old repo for porting reference.

## Commands

```
npm install
npm run dev               # wrangler dev → http://localhost:8787
npm run deploy            # wrangler deploy → *.workers.dev (requires wrangler login)
npm run typecheck
npm test                  # bonus-round + auth unit tests, then the Monte Carlo
npm run test:monte-carlo  # 200k-spin RTP simulation (~96.5%)
npm run test:bonus-round  # deterministic cap-semantics checks
npm run test:auth         # password/session primitive checks
```

## Phase 3 — D1 schema + auth (virtual credits)

- **Schema:** `migrations/0001_users_sessions.sql` — `users`
  (PBKDF2 password hash, integer-cent balance) and `sessions`
  (SHA-256 token digests, 7-day expiry).
- **Endpoints:** `POST /api/auth/register`, `POST /api/auth/login`,
  `POST /api/auth/logout`, `GET /api/auth/me`, `POST /api/wallet/topup`.
  Tokens come back in the JSON body and as an HttpOnly `sa_session`
  cookie; both cookie and `Authorization: Bearer` are accepted.
- **Economy (play-money only):** new accounts start with 10,000.00
  virtual credits; the free top-up grants +5,000.00 when the balance is
  under 1,000.00, at most once per hour, enforced atomically in a single
  guarded `UPDATE`. **There is no purchase mechanism anywhere in this
  project, and none may be added.**
- **Local setup (no auth needed):**
  `npx wrangler d1 execute super-ace-db --local --file migrations/0001_users_sessions.sql`
- **Remote setup (once, on a machine with `wrangler login`):** run
  `npx wrangler d1 create super-ace-db`, paste the real `database_id`
  into `wrangler.jsonc`, then
  `npx wrangler d1 execute super-ace-db --remote --file migrations/0001_users_sessions.sql`
  before the next deploy.

## Phase 4 — provably-fair spin endpoint

- **Schema:** `migrations/0002_game_sessions_spins.sql` — `game_sessions`
  (commit-reveal seed pairs, one active per user), `spins` (per-spin seed
  storage + full result JSON, `UNIQUE(session_id, nonce)`),
  `bonus_rounds` (server-side Free Spins state, one per user).
- **Endpoints:** `POST /api/game/session` (rotate — closes the previous
  session and **reveals its server seed**), `GET /api/game/state`,
  `POST /api/game/spin` (`{"betCents": 100..1000000}`; while a bonus
  round is active the spin is a free spin and the bet is locked to the
  triggering amount).
- **One transaction per spin:** session nonce update + spin insert +
  balance debit/credit + bonus-round state change run as a single D1
  batch. Races lose structurally: a duplicate nonce violates
  `UNIQUE(session_id, nonce)` and an overdraw violates the
  `balance_cents >= 0` CHECK — either aborts the whole batch.
- **Fairness (commit-reveal):** a session's `server_seed` is committed
  as `server_seed_hash` at creation; the spin's entire random stream is
  `HMAC-SHA-256(serverSeed, "clientSeed:nonce:counter")`
  (`src/engine/rng.ts` — dependency-free sync SHA-256/HMAC, verified
  against FIPS 180 + RFC 4231 vectors). Rotating the session reveals the
  server seed so every stored spin replays exactly. No RTP-bias hook
  exists anywhere: outcomes are a pure function of the seeds.
- **Local setup:** also run
  `npx wrangler d1 execute super-ace-db --local --file migrations/0002_game_sessions_spins.sql`

## Phase 5 — Durable Objects (jackpots + presence)

- **JackpotDO** (`src/do/JackpotDO.ts`, global singleton): owns the four
  progressive pools (Grand 50,000 / Major 10,000 / Minor 1,000 / Mini
  100.00 credits at seed). Every base spin contributes **1% of the bet**
  to all pools; per-spin hit odds are fixed bands on one extra draw from
  the spin's seed stream (Grand 1/100k, Major 1/20k, Minor 1/4k, Mini
  1/2,000 — same reproducible stream as the game outcome). A hit pays
  the pool value, then resets that tier to its seed.
- **Ordering:** the spin endpoint *peeks* the pools → credits a jackpot
  win inside the same D1 batch as the spin (player is always paid) →
  *commits* the contribution/reset to the DO only after the batch.
  Crash windows can only drift the pot upward; never short a player.
- **PresenceDO** (`src/do/PresenceDO.ts`, global singleton): hibernatable
  WebSocket at `GET /api/presence` (auth via session cookie or
  `?token=`, since browsers cannot set WS headers). Broadcasts the
  **distinct-user online count** on joins/leaves and pushes live jackpot
  pools on a 10-second alarm that cancels itself when nobody listens.
- **Endpoints:** `GET /api/jackpots` (public: pool values + last 10
  winners). Jackpots are base-game only; total return to players is the
  game RTP plus the jackpot pools (all virtual credits).
- **Local setup:** also run
  `npx wrangler d1 execute super-ace-db --local --file migrations/0003_jackpot_columns.sql`

## Phase 6 — frontend port (static, no build step)

- `public/index.html` + `public/style.css` + `public/app.js`: the
  reference JDB/JILI-style mobile layout (430px column, gold/black
  theme, real symbol art in `public/assets/`) as a dependency-free
  static client served by the same Worker.
- **Test credentials from the reference login screen are stripped** —
  registration and login are plain username/password. There are no
  payment/KYC references anywhere.
- Full game flow: register/login → spins with the landed-grid /
  golden-card-flip / cascade-refill animation sequence → win, retrigger
  and Free-Spins popups → server-driven bonus rounds (auto-played,
  resumable after a page reload) → jackpot banners. Turbo, bet ladder
  (1.00–10,000.00 credits), auto-spin, free top-up button, provably-fair
  panel (seed hash + client seed + nonce, one-click session rotation
  with seed reveal), jackpot drawer.
- Live data: presence WebSocket (`/api/presence`) drives the online
  counter and pushes jackpot pools every tick; falls back to polling
  `/api/jackpots` when the socket is down.
- The client is a pure renderer — every outcome, balance and bonus-round
  state comes from the Worker API.

## Phase checklist

- [x] Phase 1: scaffold + hello-world deploy pipeline
- [x] Phase 2: port game engine (strip RTP controller, RTP re-verified 96.452%)
- [x] Phase 3: D1 schema + auth + virtual-credit balance
- [x] Phase 4: spin endpoint (single D1 batch transaction, provably-fair seeds per spin)
- [x] Phase 5: Durable Objects (jackpot tiers, online presence)
- [x] Phase 6: frontend port
- [x] Phase 7: final deploy — **live at https://super-ace-cf.agenticmarketingpro.workers.dev** (deployed 2026-09-26, version b8847d7c; custom domain not needed yet)

## Live deployment notes

- Deploy: `npx wrangler deploy` (Worker + static assets + Durable Object
  migration v1 in one shot).
- Remote D1 (`super-ace-db`, APAC) has all three migrations applied —
  apply future migrations with
  `npx wrangler d1 execute super-ace-db --remote --file migrations/…`
  BEFORE the next deploy.
- Verified live: health/hello/jackpots endpoints, real registration,
  provably-fair spin with jackpot contribution committed on the live DO,
  presence WebSocket over wss, full UI flow in a browser.
