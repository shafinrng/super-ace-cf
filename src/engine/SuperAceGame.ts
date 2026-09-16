import { SpinRequest, SpinResult, Symbol } from "../types/game";
import { generateGrid } from "./ReelGenerator";
import { calculateWins } from "./WinCalculator";
import { runCascades } from "./CascadeEngine";
import { revealGoldenCards } from "./GoldenCard";
import { SCATTER_TRIGGER_COUNT, FREE_SPINS_AWARDED, MULTIPLIER_STEPS, FREE_SPIN_MULTIPLIER_STEPS } from "./constants";
import { stopsToGrid } from "./ReelStrips";

function countScatters(grid: Symbol[][]): number {
  return grid.flat().filter(s => s === "SCATTER").length;
}

export async function spin(req: SpinRequest): Promise<SpinResult> {
  const { userId, betAmount, isFreeSpinMode = false, freeSpinMultiplier = 1 } = req;
  const steps = isFreeSpinMode ? FREE_SPIN_MULTIPLIER_STEPS : MULTIPLIER_STEPS;
  const landedGrid = generateGrid();
  const { revealedGrid: grid, goldenPositions } = revealGoldenCards(landedGrid);
  const initialMultiplier = isFreeSpinMode ? freeSpinMultiplier : steps[0];
  const initialWins = calculateWins(grid, betAmount, initialMultiplier);
  const cascades = runCascades(grid, betAmount, isFreeSpinMode);
  const cascadeWin = cascades.reduce((sum, c) => sum + c.wins.reduce((s, w) => s + w.payout, 0), 0);
  const initialWin = initialWins.reduce((sum, w) => sum + w.payout, 0);
  const totalWin = initialWin + cascadeWin;
  const multiplier = cascades.length > 0
    ? cascades[cascades.length - 1].multiplier
    : initialMultiplier;

  // Check scatters on the FINAL grid (after cascades), not the initial
  // one — a scatter dropped in during a cascade refill still counts.
  const finalGrid = cascades.length > 0 ? cascades[cascades.length - 1].newGrid : grid;
  const scatterCount = countScatters(finalGrid);
  const freeSpinsAwarded = scatterCount >= SCATTER_TRIGGER_COUNT ? FREE_SPINS_AWARDED : 0;

  return {
    grid,
    landedGrid,
    goldenPositions,
    wins: initialWins,
    totalWin,
    cascades,
    multiplier,
    freeSpinsAwarded,
    isFreeSpinMode,
  };
}

export async function calculateWinFromStops(
  stops: number[],
  betAmount: number,
  playerId: string,
  isFreeSpinMode: boolean = false,
  freeSpinMultiplier: number = 1
): Promise<SpinResult> {
  const steps = isFreeSpinMode ? FREE_SPIN_MULTIPLIER_STEPS : MULTIPLIER_STEPS;
  const landedGrid = stopsToGrid(stops);
  const { revealedGrid: grid, goldenPositions } = revealGoldenCards(landedGrid);
  const initialMultiplier = isFreeSpinMode ? freeSpinMultiplier : steps[0];
  const initialWins = calculateWins(grid, betAmount, initialMultiplier);
  const cascades = runCascades(grid, betAmount, isFreeSpinMode);
  const cascadeWin = cascades.reduce((sum, c) => sum + c.wins.reduce((s, w) => s + w.payout, 0), 0);
  const initialWin = initialWins.reduce((sum, w) => sum + w.payout, 0);
  const totalWin = initialWin + cascadeWin;
  const multiplier = cascades.length > 0
    ? cascades[cascades.length - 1].multiplier
    : initialMultiplier;

  // Check scatters on the FINAL grid (after cascades), not the initial
  // one — a scatter dropped in during a cascade refill still counts.
  const finalGrid = cascades.length > 0 ? cascades[cascades.length - 1].newGrid : grid;
  const scatterCount = countScatters(finalGrid);
  const freeSpinsAwarded = scatterCount >= SCATTER_TRIGGER_COUNT ? FREE_SPINS_AWARDED : 0;

  return {
    grid,
    landedGrid,
    goldenPositions,
    wins: initialWins,
    totalWin,
    cascades,
    multiplier,
    freeSpinsAwarded,
    isFreeSpinMode,
  };
}
