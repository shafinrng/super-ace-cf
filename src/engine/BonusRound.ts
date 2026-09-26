import { FREE_SPINS_AWARDED, MAX_FREE_SPINS_TOTAL } from "./constants";

/**
 * Server-authoritative Free Spins bonus-round state machine.
 *
 * Ported from the reference implementation's client-side tracker
 * (frontend/app/game/page.tsx, freeSpinsTotalAwardedRef) so the Worker
 * can own the round state when the spin endpoint lands in Phase 4.
 * Behavior matches the Monte Carlo simulation exactly:
 *
 *  - a fresh trigger grants FREE_SPINS_AWARDED spins
 *  - 3+ scatters on a free spin's FINAL post-cascade grid award another
 *    FREE_SPINS_AWARDED (the caller reads them off the spin result)
 *  - the cumulative total ever granted this round is hard-capped at
 *    MAX_FREE_SPINS_TOTAL — once hit, no further retriggers are granted,
 *    even if more scatters land. Stricter than capping only the visible
 *    "remaining" counter, which a long retrigger streak could blow past.
 *  - the round ends when remaining spins reach 0
 */

export interface BonusRoundState {
  /** Free spins ever granted this round, including the initial award. */
  totalAwarded: number;
  /** Spins left to play. */
  remaining: number;
  /** Accumulated payout across all free spins played this round. */
  totalWin: number;
  /** Free spins played so far. */
  spinsUsed: number;
}

/** The per-spin fields the round state machine consumes; SpinResult satisfies this. */
export interface FreeSpinOutcome {
  /** Payout of this free spin (initial win + all cascades). */
  totalWin: number;
  /** Raw retrigger award: FREE_SPINS_AWARDED when the final grid held 3+ scatters, else 0. */
  freeSpinsAwarded: number;
}

export function createBonusRound(): BonusRoundState {
  return {
    totalAwarded: FREE_SPINS_AWARDED,
    remaining: FREE_SPINS_AWARDED,
    totalWin: 0,
    spinsUsed: 0,
  };
}

export interface ApplySpinOutcome {
  state: BonusRoundState;
  /** Spins actually granted by this retrigger after the cap (0 if none fit). */
  retriggered: number;
  /** True when this was the round's final spin. */
  complete: boolean;
}

export function applyFreeSpinResult(
  state: BonusRoundState,
  outcome: FreeSpinOutcome
): ApplySpinOutcome {
  const totalAwarded = state.totalAwarded;
  let newTotalAwarded = totalAwarded;
  let retriggered = 0;

  if (outcome.freeSpinsAwarded > 0) {
    newTotalAwarded = Math.min(totalAwarded + outcome.freeSpinsAwarded, MAX_FREE_SPINS_TOTAL);
    retriggered = newTotalAwarded - totalAwarded;
  }

  const remaining = state.remaining - 1 + retriggered;

  return {
    state: {
      totalAwarded: newTotalAwarded,
      remaining,
      totalWin: state.totalWin + outcome.totalWin,
      spinsUsed: state.spinsUsed + 1,
    },
    retriggered,
    complete: remaining <= 0,
  };
}

export function isBonusRoundComplete(state: BonusRoundState): boolean {
  return state.remaining <= 0;
}
