import { Symbol, WinResult, CascadeResult } from "../types/game";
import { revealGoldenCards } from "./GoldenCard";
import { generateGrid } from "./ReelGenerator";
import { calculateWins } from "./WinCalculator";
import { MULTIPLIER_STEPS, FREE_SPIN_MULTIPLIER_STEPS } from "./constants";

function removeWinningSymbols(grid: Symbol[][], wins: WinResult[]): Symbol[][] {
  const newGrid = grid.map(col => [...col]) as Symbol[][];
  const toRemove = new Set(wins.flatMap(w => w.positions.map(([r, c]) => `${r},${c}`)));

  for (const key of toRemove) {
    const [reel, row] = key.split(",").map(Number);
    newGrid[reel][row] = null as any;
  }

  for (let reel = 0; reel < newGrid.length; reel++) {
    const filled = newGrid[reel].filter(s => s !== null);
    const newSymbols = generateGrid()[reel].slice(0, newGrid[reel].length - filled.length);
    newGrid[reel] = [...newSymbols, ...filled];
  }

  // Any GOLDEN symbols dropped in during this refill must also flip to
  // WILD before the next evaluation — same rule as the initial grid.
  const { revealedGrid } = revealGoldenCards(newGrid);
  return revealedGrid;
}

export function runCascades(
  initialGrid: Symbol[][],
  betAmount: number,
  isFreeSpinMode: boolean
): CascadeResult[] {
  const cascades: CascadeResult[] = [];
  const steps = isFreeSpinMode ? FREE_SPIN_MULTIPLIER_STEPS : MULTIPLIER_STEPS;
  let currentGrid = initialGrid;
  let cascadeCount = 0;

  while (true) {
    const multiplierIndex = Math.min(cascadeCount, steps.length - 1);
    const multiplier = steps[multiplierIndex];
    const wins = calculateWins(currentGrid, betAmount, multiplier);

    if (wins.length === 0) break;

    const removedPositions = wins.flatMap(w => w.positions);
    const newGrid = removeWinningSymbols(currentGrid, wins);

    cascades.push({ removedPositions, newGrid, wins, multiplier });
    currentGrid = newGrid;
    cascadeCount++;
  }

  return cascades;
}
