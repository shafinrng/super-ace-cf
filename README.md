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

## Phase checklist

- [x] Phase 1: scaffold + hello-world deploy pipeline
- [x] Phase 2: port game engine (strip RTP controller, RTP re-verified 96.452%)
- [x] Phase 3: D1 schema + auth + virtual-credit balance
- [x] Phase 4: spin endpoint (single D1 batch transaction, provably-fair seeds per spin)
- [ ] Phase 5: Durable Objects (jackpot tiers, online presence)
- [ ] Phase 6: frontend port
- [ ] Phase 7: final deploy + custom domain
