import { Symbol } from "../types/game";
import { SYMBOL_WEIGHTS, ROWS } from "./constants";

// Fixed, published reel strips - this is what makes provably-fair verification meaningful.
// Built deterministically from SYMBOL_WEIGHTS so the distribution matches game design.
// Strip length must be large enough to represent every symbol proportional to its weight;
// using a multiple of the total weight ensures every symbol actually appears.
function buildStrip(): Symbol[] {
  const symbols = Object.keys(SYMBOL_WEIGHTS) as Symbol[];
  const totalWeight = symbols.reduce((sum, s) => sum + SYMBOL_WEIGHTS[s], 0);
  const REPEAT_FACTOR = 3; // repeat the full weighted set a few times for a longer, better-mixed strip
  const strip: Symbol[] = [];
  for (let r = 0; r < REPEAT_FACTOR; r++) {
    for (const sym of symbols) {
      for (let w = 0; w < SYMBOL_WEIGHTS[sym]; w++) strip.push(sym);
    }
  }
  // Deterministic seeded shuffle (Fisher-Yates with an LCG) - fixed per server restart,
  // but properly mixes all symbols instead of leaving them clustered by weight-run.
  let seed = 2463534242;
  const rand = () => {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    return ((seed >>> 0) / 4294967296);
  };
  for (let j = strip.length - 1; j > 0; j--) {
    const k = Math.floor(rand() * (j + 1));
    [strip[j], strip[k]] = [strip[k], strip[j]];
  }
  return strip;
}

export const REEL_STRIPS: Symbol[][] = [0, 1, 2, 3, 4].map(() => buildStrip());
export const REEL_STRIP_LENGTH = REEL_STRIPS[0].length;

export function stopsToGrid(stops: number[]): Symbol[][] {
  return stops.map((stop, reelIndex) => {
    const strip = REEL_STRIPS[reelIndex] || REEL_STRIPS[0];
    const window: Symbol[] = [];
    for (let row = 0; row < ROWS; row++) {
      window.push(strip[(stop + row) % strip.length]);
    }
    return window;
  });
}
