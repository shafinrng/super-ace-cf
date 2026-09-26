-- Phase 5: jackpot columns on the spin audit trail.
-- Jackpots are play-money progressive pools funded by 1% of each base
-- bet. A win is credited to the player's virtual balance in the same
-- D1 batch that records the spin; the pool state itself lives in the
-- Jackpot Durable Object.

ALTER TABLE spins ADD COLUMN jackpot_tier TEXT;
ALTER TABLE spins ADD COLUMN jackpot_cents INTEGER NOT NULL DEFAULT 0;
