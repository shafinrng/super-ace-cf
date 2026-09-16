// services/game-engine/src/engine/GoldenCard.ts

import { Symbol } from "../types/game";

/**
 * Converts every GOLDEN symbol on the grid to WILD, in place logically
 * (returns a new grid, does not mutate the input).
 *
 * Must be called AFTER generateGrid()/stopsToGrid() and BEFORE
 * calculateWins()/runCascades() — this is the missing step that lets
 * the golden-card -> wild-joker flip actually happen instead of GOLDEN
 * being evaluated as its own independent paying symbol.
 *
 * Returns:
 *  - revealedGrid: the grid with GOLDEN -> WILD already applied (this is
 *    what goes into calculateWins/runCascades)
 *  - goldenPositions: [reel, row] pairs, sorted left-to-right/top-to-bottom,
 *    for the frontend to stagger the flip animation on
 */
export function revealGoldenCards(grid: Symbol[][]): {
  revealedGrid: Symbol[][];
  goldenPositions: number[][];
} {
  const revealedGrid = grid.map(col => [...col]);
  const goldenPositions: number[][] = [];

  for (let reel = 0; reel < revealedGrid.length; reel++) {
    for (let row = 0; row < revealedGrid[reel].length; row++) {
      if (revealedGrid[reel][row] === "GOLDEN") {
        revealedGrid[reel][row] = "WILD";
        goldenPositions.push([reel, row]);
      }
    }
  }

  goldenPositions.sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));

  return { revealedGrid, goldenPositions };
}
