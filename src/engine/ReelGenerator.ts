import { randomBytes } from "crypto";
import { Symbol } from "../types/game";
import { SYMBOL_WEIGHTS, REELS, ROWS } from "./constants";
const SYMBOLS = Object.keys(SYMBOL_WEIGHTS) as Symbol[];
const TOTAL_WEIGHT = Object.values(SYMBOL_WEIGHTS).reduce((a, b) => a + b, 0);
function secureRandom(): number {
  const buf = randomBytes(4);
  return buf.readUInt32BE(0) / 0xFFFFFFFF;
}
function pickSymbol(): Symbol {
  let rand = secureRandom() * TOTAL_WEIGHT;
  for (const sym of SYMBOLS) {
    rand -= SYMBOL_WEIGHTS[sym];
    if (rand <= 0) return sym;
  }
  return SYMBOLS[SYMBOLS.length - 1];
}
export function generateGrid(): Symbol[][] {
  const grid: Symbol[][] = [];
  for (let reel = 0; reel < REELS; reel++) {
    const col: Symbol[] = [];
    for (let row = 0; row < ROWS; row++) col.push(pickSymbol());
    grid.push(col);
  }
  return grid;
}