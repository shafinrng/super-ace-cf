/// <reference types="node" />
// tests/monte-carlo/rtp-test.ts
//
// Measures the SHIPPED code paths end to end:
//  1. Every spin — base and free — goes through the real engine entry
//     point (SuperAceGame.spin) with an injected uniform rng, exactly the
//     way the production spin endpoint calls it. The rng here (Node's
//     randomBytes) is statistically identical to the worker's
//     seed-derived stream; provable-fair determinism is pinned separately
//     in tests/provably-fair-test.ts.
//  2. Scatters are counted on the FINAL grid (after cascades) inside the
//     engine itself — the test consumes result.freeSpinsAwarded as-is.
//  3. Free Spins bonus rounds are played through the REAL production
//     state machine (src/engine/BonusRound.ts) with its true cumulative
//     cap (MAX_FREE_SPINS_TOTAL) — once that many spins have EVER been
//     granted in a bonus round, no further retriggers happen, regardless
//     of how many more scatters land. Exact cap semantics are pinned in
//     tests/bonus-round-test.ts.
//
// Ported from super-ace-platform services/game-engine/tests/monte-carlo/rtp-test.ts
// with only the RTP-bias argument removed (the bias hook no longer exists).
//
// Run with: npm run test:monte-carlo

import { randomBytes } from "crypto";
import { spin } from "../../src/engine/SuperAceGame";
import {
  FREE_SPIN_MULTIPLIER_STEPS,
  FREE_SPINS_AWARDED,
} from "../../src/engine/constants";
import { applyFreeSpinResult, createBonusRound } from "../../src/engine/BonusRound";

const SPIN_COUNT = 200_000;
const BET_AMOUNT = 1;

// Node-side uniform [0,1) source — same distribution the worker derives
// from HMAC-SHA-256(serverSeed, `${clientSeed}:${nonce}:${counter}`).
function nodeRng(): () => number {
  return () => {
    const buf = randomBytes(4);
    return new DataView(buf.buffer, buf.byteOffset, buf.byteLength).getUint32(0) / 0xffffffff;
  };
}

async function runSimulation() {
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

    const base = await spin(
      { userId: "monte-carlo", betAmount: BET_AMOUNT, isFreeSpinMode: false },
      nodeRng()
    );
    totalBaseWin += base.totalWin;
    if (base.totalWin > 0) winningSpins++;
    if (base.totalWin > maxSingleSpinWin) maxSingleSpinWin = base.totalWin;

    if (base.freeSpinsAwarded > 0) {
      bonusRoundsTriggered++;
      let round = createBonusRound();
      let hitCap = false;

      while (round.remaining > 0) {
        const freeSpin = await spin(
          {
            userId: "monte-carlo",
            betAmount: BET_AMOUNT,
            isFreeSpinMode: true,
            freeSpinMultiplier: FREE_SPIN_MULTIPLIER_STEPS[0],
          },
          nodeRng()
        );
        const applied = applyFreeSpinResult(round, freeSpin);
        round = applied.state;
        if (freeSpin.freeSpinsAwarded > 0 && applied.retriggered < FREE_SPINS_AWARDED) {
          hitCap = true;
        }
      }

      totalFreeSpinWin += round.totalWin;
      totalBonusSpinsPlayed += round.spinsUsed;
      if (round.totalWin > maxBonusRoundWin) maxBonusRoundWin = round.totalWin;
      if (round.spinsUsed > maxSpinsInBonusRound) maxSpinsInBonusRound = round.spinsUsed;
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
  console.log("MONTE CARLO RTP SIMULATION — BASE GAME + FREE SPINS (v3, shipped paths)");
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
  console.log(`Avg spins per bonus round: ${avgSpinsPerBonusRound.toFixed(1)} (base award: ${FREE_SPINS_AWARDED}, cap: 30)`);
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

runSimulation().catch((err) => {
  console.error(err);
  process.exit(1);
});
