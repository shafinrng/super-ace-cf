export type Symbol = "A" | "K" | "Q" | "J" | "SPADE" | "HEART" | "CLUB" | "DIAMOND" | "GOLDEN" | "WILD" | "SCATTER";
export interface SpinResult {
  grid: Symbol[][];
  landedGrid: Symbol[][];
  goldenPositions: number[][];
  wins: WinResult[];
  totalWin: number;
  cascades: CascadeResult[];
  multiplier: number;
  freeSpinsAwarded: number;
  isFreeSpinMode: boolean;
}
export interface WinResult {
  symbol: Symbol;
  count: number;
  positions: number[][];
  payout: number;
}
export interface CascadeResult {
  removedPositions: number[][];
  newGrid: Symbol[][];
  wins: WinResult[];
  multiplier: number;
}
export interface SpinRequest {
  userId: string;
  betAmount: number;
  isFreeSpinMode?: boolean;
  freeSpinMultiplier?: number;
}