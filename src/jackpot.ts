// Jackpot tier configuration and pure pool math.
//
// Play-money progressive jackpots: 1% of every BASE bet (never free
// spins) funds the pools. Pools start at their seed values, grow with
// contributions, and reset to the seed when hit. The per-spin win draw
// is one extra float from the spin's provably-fair seed stream, so
// jackpot outcomes are exactly as reproducible as game outcomes.
//
// No RTP-bias hook exists anywhere: hit odds are the fixed bands below,
// identical for every player, every spin.

export type TierName = "GRAND" | "MAJOR" | "MINOR" | "MINI";

export const JACKPOT_TIERS: Record<TierName, { seedCents: number }> = {
  GRAND: { seedCents: 5_000_000 }, // 50,000.00 credits
  MAJOR: { seedCents: 1_000_000 }, // 10,000.00 credits
  MINOR: { seedCents: 100_000 }, // 1,000.00 credits
  MINI: { seedCents: 10_000 }, // 100.00 credits
};

export const TIER_NAMES = Object.keys(JACKPOT_TIERS) as TierName[];

/** Basis points of each base bet that fund the pools (100 bps = 1%). */
export const JACKPOT_CONTRIBUTION_BPS = 100;

// Fixed hit bands on one uniform [0,1) draw, rarest first. Odds:
//   GRAND 1/100,000 | MAJOR 1/20,000 | MINOR 1/4,000 | MINI 1/2,000
// (≈ 1 jackpot hit per 1,235 base spins across all tiers combined.)
const HIT_BANDS: Array<{ tier: TierName; upper: number }> = [
  { tier: "GRAND", upper: 0.00001 },
  { tier: "MAJOR", upper: 0.00006 },
  { tier: "MINOR", upper: 0.00031 },
  { tier: "MINI", upper: 0.00081 },
];

/** Resolves one uniform draw to a winning tier, or null (no hit). */
export function selectJackpotTier(draw: number): TierName | null {
  for (const band of HIT_BANDS) {
    if (draw < band.upper) return band.tier;
  }
  return null;
}

export type JackpotPools = Record<TierName, number>;

export function initialPools(): JackpotPools {
  return {
    GRAND: JACKPOT_TIERS.GRAND.seedCents,
    MAJOR: JACKPOT_TIERS.MAJOR.seedCents,
    MINOR: JACKPOT_TIERS.MINOR.seedCents,
    MINI: JACKPOT_TIERS.MINI.seedCents,
  };
}

export interface JackpotWinner {
  tier: TierName;
  username: string;
  amountCents: number;
  at: number;
}

export interface PoolUpdateResult {
  pools: JackpotPools;
  /** Pool value paid to the winner, taken BEFORE this spin's contribution. */
  awardedCents: number;
  winners: JackpotWinner[];
}

/**
 * Applies one spin's jackpot economics atomically (the Durable Object
 * serializes calls, so plain objects are safe here):
 *  - always adds the base-bet contribution
 *  - if a tier was won, the winner is paid the CURRENT pool (prior
 *    contributions included, their own not), then that tier resets to
 *    its seed before this spin's contribution lands
 */
export function applyPoolUpdate(
  pools: JackpotPools,
  winners: JackpotWinner[],
  contributeCents: number,
  tierWon: TierName | null,
  winner: JackpotWinner | null
): PoolUpdateResult {
  if (!Number.isInteger(contributeCents) || contributeCents < 0) {
    throw new Error("contributeCents must be a non-negative integer");
  }

  const next = { ...pools };
  let awardedCents = 0;
  const nextWinners = winners.slice();

  if (tierWon !== null) {
    awardedCents = next[tierWon];
    next[tierWon] = JACKPOT_TIERS[tierWon].seedCents;
    if (winner) nextWinners.unshift(winner);
  }

  nextWinners.length = Math.min(nextWinners.length, 10);

  for (const tier of TIER_NAMES) {
    next[tier] += contributeCents;
  }

  return { pools: next, awardedCents, winners: nextWinners };
}
