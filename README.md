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
npm run dev      # wrangler dev → http://localhost:8787
npm run deploy   # wrangler deploy → *.workers.dev (requires wrangler login)
npm run typecheck
```

## Phase checklist

- [x] Phase 1: scaffold + hello-world deploy pipeline
- [x] Phase 2: port game engine (strip RTP controller, RTP re-verified 96.452%)
- [ ] Phase 3: D1 schema + auth + virtual-credit balance
- [ ] Phase 4: spin endpoint (single D1 batch transaction, provably-fair seeds per spin)
- [ ] Phase 5: Durable Objects (jackpot tiers, online presence)
- [ ] Phase 6: frontend port
- [ ] Phase 7: final deploy + custom domain
