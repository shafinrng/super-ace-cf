/// <reference types="node" />
// tests/monte-carlo/rtp-test.ts
//
// Corrected to match production exactly:
//  1. Scatters are counted on the FINAL grid (after cascades), matching
//     the SuperAceGame.ts fix — cascades can drop new scatters in during
//     refills, and those count toward triggering/retriggering.
//  2. Free Spins bonus rounds are played through the REAL production state
//     machine (src/engine/BonusRound.ts) with its true cumulative cap
//     (MAX_FREE_SPINS_TOTAL) — once that many spins have EVER been granted
//     in a bonus round, no further retriggers happen, regardless of how
//     many more scatters land. This is the same module the spin endpoint
//     uses from Phase 4 on, so the test measures shipped behavior, not a
//     copy of it. Exact cap semantics are pinned in tests/bonus-round-test.ts.
//
// Ported from super-ace-platform services/game-engine/tests/monte-carlo/rtp-test.ts
// with only the RTP-bias argument removed (the bias hook no longer exists).
//
// Run with: npm run test:monte-carlo

import { generateGrid } from "../../src/engine/ReelGenerator";
import { revealGoldenCards } from "../../src/engine/GoldenCard";
import { calculateWins } from "../../src/engine/WinCalculator";
import { runCascades } from "../../src/engine/CascadeEngine";
import {
  MULTIPLIER_STEPS,
  FREE_SPIN_MULTIPLIER_STEPS,
  SCATTER_TRIGGER_COUNT,
  FREE_SPINS_AWARDED,
} from "../../src/engine/constants";
import { Symbol } from "../../src/types/game";
import { applyFreeSpinResult, createBonusRound } from "../../src/engine/BonusRound";
import { MAX_FREE_SPINS_TOTAL } from "../../src/engine/constants";

const SPIN_COUNT = 200_000;
const BET_AMOUNT = 1;

function countScatters(grid: Symbol[][]): number {
  return grid.flat().filter((s) => s === "SCATTER").length;
}

// Evaluates one full spin (initial win + all cascades) and returns both
// the total payout AND the final settled grid — needed because scatter
// counting must happen on the post-cascade grid, not the pre-cascade one.
function evaluateSpin(isFreeSpinMode: boolean): { finalGrid: Symbol[][]; totalWin: number } {
  const landedGrid = generateGrid();
  const { revealedGrid: grid } = revealGoldenCards(landedGrid);

  const initialMultiplier = isFreeSpinMode ? FREE_SPIN_MULTIPLIER_STEPS[0] : MULTIPLIER_STEPS[0];
  const initialWins = calculateWins(grid, BET_AMOUNT, initialMultiplier);
  const cascades = runCascades(grid, BET_AMOUNT, isFreeSpinMode);

  const initialWinAmount = initialWins.reduce((sum, w) => sum + w.payout, 0);
  const cascadeWinAmount = cascades.reduce(
    (sum, c) => sum + c.wins.reduce((s, w) => s + w.payout, 0),
    0
  );

  const finalGrid = cascades.length > 0 ? cascades[cascades.length - 1].newGrid : grid;

  return { finalGrid, totalWin: initialWinAmount + cascadeWinAmount };
}

// Simulates one full bonus round, including retriggers, by driving the
// real production state machine (src/engine/BonusRound.ts).
function runBonusRound(): { totalWin: number; spinsUsed: number; hitCap: boolean } {
  let round = createBonusRound();
  let hitCap = false;

  while (round.remaining > 0) {
    const { finalGrid, totalWin: spinWin } = evaluateSpin(true);
    const scatterCount = countScatters(finalGrid);
    const result = applyFreeSpinResult(round, {
      totalWin: spinWin,
      freeSpinsAwarded: scatterCount >= SCATTER_TRIGGER_COUNT ? FREE_SPINS_AWARDED : 0,
    });
    round = result.state;
    // A retrigger was attempted but the cap blocked (part of) the award.
    if (scatterCount >= SCATTER_TRIGGER_COUNT && result.retriggered < FREE_SPINS_AWARDED) {
      hitCap = true;
    }
  }

  return { totalWin: round.totalWin, spinsUsed: round.spinsUsed, hitCap };
}

function runSimulation() {
  let totalWagered = 0;
  let totalBaseWin = 0;
  let totalFreeSpinWin = 0;
  let bonusRoundsTriggered = 0;
  let winningSpins = 0;
  let maxSingleSpinWin = 0;
  let maxBonusRoundWin = 0;
  let maxSpinsInBonusRound = 0;
  let bonusRoundsThatHitCap = 0;
  let totalBonusSpinsPlayed = 0;

  for (let i = 0; i < SPIN_COUNT; i++) {
    totalWagered += BET_AMOUNT; // only the base spin is ever actually wagered

    const { finalGrid, totalWin: baseWin } = evaluateSpin(false);
    totalBaseWin += baseWin;
    if (baseWin > 0) winningSpins++;
    if (baseWin > maxSingleSpinWin) maxSingleSpinWin = baseWin;

    const scatterCount = countScatters(finalGrid);
    if (scatterCount >= SCATTER_TRIGGER_COUNT) {
      bonusRoundsTriggered++;
      const { totalWin: bonusWin, spinsUsed, hitCap } = runBonusRound();
      totalFreeSpinWin += bonusWin;
      totalBonusSpinsPlayed += spinsUsed;
      if (bonusWin > maxBonusRoundWin) maxBonusRoundWin = bonusWin;
      if (spinsUsed > maxSpinsInBonusRound) maxSpinsInBonusRound = spinsUsed;
      if (hitCap) bonusRoundsThatHitCap++;
    }
  }

  const totalPaid = totalBaseWin + totalFreeSpinWin;
  const rtp = (totalPaid / totalWagered) * 100;
  const baseRtpContribution = (totalBaseWin / totalWagered) * 100;
  const freeSpinRtpContribution = (totalFreeSpinWin / totalWagered) * 100;
  const hitFrequency = (winningSpins / SPIN_COUNT) * 100;
  const bonusFrequency = SPIN_COUNT / Math.max(bonusRoundsTriggered, 1);
  const avgBonusRoundWin = totalFreeSpinWin / Math.max(bonusRoundsTriggered, 1);
  const avgSpinsPerBonusRound = totalBonusSpinsPlayed / Math.max(bonusRoundsTriggered, 1);
  const capHitRate = (bonusRoundsThatHitCap / Math.max(bonusRoundsTriggered, 1)) * 100;

  console.log("=".repeat(60));
  console.log("MONTE CARLO RTP SIMULATION — BASE GAME + FREE SPINS (v2)");
  console.log("=".repeat(60));
  console.log(`Base spins simulated:      ${SPIN_COUNT.toLocaleString()}`);
  console.log(`Total wagered:             $${totalWagered.toLocaleString()}`);
  console.log(`Total paid (base game):    $${totalBaseWin.toFixed(2)}`);
  console.log(`Total paid (free spins):   $${totalFreeSpinWin.toFixed(2)}`);
  console.log(`Total paid (combined):     $${totalPaid.toFixed(2)}`);
  console.log("-".repeat(60));
  console.log(`COMBINED RTP:              ${rtp.toFixed(3)}%`);
  console.log(`  - base game contributes: ${baseRtpContribution.toFixed(3)}%`);
  console.log(`  - free spins contribute: ${freeSpinRtpContribution.toFixed(3)}%`);
  console.log("-".repeat(60));
  console.log(`Base game hit frequency:   ${hitFrequency.toFixed(2)}% of spins won something`);
  console.log(`Bonus round trigger rate:  1 in ${bonusFrequency.toFixed(0)} spins (post-cascade scatter count)`);
  console.log(`Bonus rounds simulated:    ${bonusRoundsTriggered.toLocaleString()}`);
  console.log(`Avg win per bonus round:   $${avgBonusRoundWin.toFixed(2)}`);
  console.log(`Avg spins per bonus round: ${avgSpinsPerBonusRound.toFixed(1)} (base award: ${FREE_SPINS_AWARDED}, cap: ${MAX_FREE_SPINS_TOTAL})`);
  console.log(`Largest bonus round size:  ${maxSpinsInBonusRound} spins`);
  console.log(`Bonus rounds that hit cap: ${bonusRoundsThatHitCap.toLocaleString()} (${capHitRate.toFixed(2)}% of all bonus rounds)`);
  console.log(`Largest single base win:   $${maxSingleSpinWin.toFixed(2)}`);
  console.log(`Largest bonus round win:   $${maxBonusRoundWin.toFixed(2)}`);
  console.log("=".repeat(60));
  console.log(
    rtp > 90 && rtp < 104
      ? "RTP is in a plausible range for a real slot (typically 90-98%)."
      : "WARNING: RTP is outside a typical real-slot range (90-98%) — rebalance needed."
  );
}

runSimulation();
