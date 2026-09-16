import { Symbol, WinResult } from "../types/game";
import { PAYOUTS, REELS } from "./constants";

export function calculateWins(grid: Symbol[][], betAmount: number, multiplier: number): WinResult[] {
  const wins: WinResult[] = [];
  const symbols = new Set(grid.flat().filter(s => s !== "SCATTER"));

  for (const symbol of symbols) {
    const target = symbol === "WILD" ? "WILD" : symbol;
    let ways = 1;
    let count = 0;
    const positions: number[][] = [];

    for (let reel = 0; reel < REELS; reel++) {
      const matchesOnReel = grid[reel]
        .map((s, row) => ({ s, row }))
        .filter(({ s }) => s === target || s === "WILD");

      if (matchesOnReel.length === 0) break;
      ways *= matchesOnReel.length;
      count++;
      matchesOnReel.forEach(({ row }) => positions.push([reel, row]));
    }

    if (count >= 3) {
      const basePayout = PAYOUTS[symbol]?.[count] ?? 0;
      const payout = basePayout * betAmount * ways * multiplier;
      if (payout > 0) {
        wins.push({ symbol, count, positions, payout });
      }
    }
  }

  return wins;
}
