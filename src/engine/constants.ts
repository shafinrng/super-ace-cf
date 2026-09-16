import { Symbol } from "../types/game";
export const REELS = 5;
export const ROWS = 4;
export const SYMBOL_WEIGHTS: Record<Symbol, number> = {
  A: 12, K: 12, Q: 14, J: 14,
  SPADE: 10, HEART: 10, CLUB: 10, DIAMOND: 10,
  GOLDEN: 6, WILD: 4, SCATTER: 2,
};
export const PAYOUTS: Record<Symbol, number[]> = {
  A:       [0, 0, 0.0061, 0.0182, 0.0303, 0.0606],
  K:       [0, 0, 0.0047, 0.0154, 0.0243, 0.0485],
  Q:       [0, 0, 0.0036, 0.0121, 0.0182, 0.0364],
  J:       [0, 0, 0.0025, 0.0075, 0.0121, 0.0243],
  SPADE:   [0, 0, 0.0012, 0.0036, 0.0061, 0.0121],
  HEART:   [0, 0, 0.0012, 0.0036, 0.0061, 0.0121],
  CLUB:    [0, 0, 0.0006, 0.0018, 0.0030, 0.0061],
  DIAMOND: [0, 0, 0.0006, 0.0018, 0.0030, 0.0061],
  GOLDEN:  [0, 0, 0.0121, 0.0364, 0.0606, 0.1212],
  WILD:    [0, 0, 0,      0,      0,      0],
  SCATTER: [0, 0, 0,      0,      0,      0],
};
export const MULTIPLIER_STEPS = [1, 2, 3, 5];
export const FREE_SPIN_MULTIPLIER_STEPS = [2, 4, 6, 10];
export const SCATTER_TRIGGER_COUNT = 3;
export const FREE_SPINS_AWARDED = 10;