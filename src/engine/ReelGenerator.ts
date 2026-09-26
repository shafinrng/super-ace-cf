import { Symbol } from "../types/game";
import { SYMBOL_WEIGHTS, REELS, ROWS } from "./constants";

// Every random draw in the engine flows through the injected rng() so a
// spin is fully reproducible from its provably-fair seeds (src/engine/rng.ts).
// Distribution is identical to the Monte-Carlo-verified design: one uniform
// float per weighted symbol pick.
const SYMBOLS = Object.keys(SYMBOL_WEIGHTS) as Symbol[];
const TOTAL_WEIGHT = Object.values(SYMBOL_WEIGHTS).reduce((a, b) => a + b, 0);

function pickSymbol(rng: () => number): Symbol {
  let rand = rng() * TOTAL_WEIGHT;
  for (const sym of SYMBOLS) {
    rand -= SYMBOL_WEIGHTS[sym];
    if (rand <= 0) return sym;
  }
  return SYMBOLS[SYMBOLS.length - 1];
}

export function generateGrid(rng: () => number): Symbol[][] {
  const grid: Symbol[][] = [];
  for (let reel = 0; reel < REELS; reel++) {
    const col: Symbol[] = [];
    for (let row = 0; row < ROWS; row++) col.push(pickSymbol(rng));
    grid.push(col);
  }
  return grid;
}
