// tests/bonus-round-test.ts
//
// Deterministic unit tests for the Free Spins bonus-round state machine
// (src/engine/BonusRound.ts). The Monte Carlo test exercises the same
// module statistically; this file pins the exact cap semantics:
//
//   1. fresh trigger grants FREE_SPINS_AWARDED spins
//   2. no-scatter rounds end after exactly the initial award
//   3. retriggers keep granting until cumulative total = MAX_FREE_SPINS_TOTAL
//   4. a retrigger near the cap grants only what fits, not the full award
//   5. once the cap is hit, further scatters grant NOTHING (round still ends)
//   6. totalWin accumulates and complete flags fire exactly once, at the end
//
// Run with: npm run test:bonus-round

import {
  BonusRoundState,
  applyFreeSpinResult,
  createBonusRound,
  isBonusRoundComplete,
} from "../src/engine/BonusRound";
import { FREE_SPINS_AWARDED, MAX_FREE_SPINS_TOTAL } from "../src/engine/constants";

let failures = 0;
let checks = 0;

function assert(cond: boolean, label: string) {
  checks++;
  if (cond) {
    console.log(`  PASS  ${label}`);
  } else {
    failures++;
    console.error(`  FAIL  ${label}`);
  }
}

function assertEq<T>(actual: T, expected: T, label: string) {
  assert(Object.is(actual, expected), `${label} (got ${actual}, expected ${expected})`);
}

// Free-spin outcome stubs — no RNG, no engine involvement.
const blankSpin = { totalWin: 0, freeSpinsAwarded: 0 };
const retriggerSpin = { totalWin: 0, freeSpinsAwarded: FREE_SPINS_AWARDED };

function play(round: BonusRoundState, outcome: { totalWin: number; freeSpinsAwarded: number }) {
  return applyFreeSpinResult(round, outcome);
}

console.log("Bonus round state machine:");
{
  // 1. Fresh trigger
  const r = createBonusRound();
  assertEq(r.totalAwarded, FREE_SPINS_AWARDED, "fresh round totalAwarded = initial award");
  assertEq(r.remaining, FREE_SPINS_AWARDED, "fresh round remaining = initial award");
  assert(!isBonusRoundComplete(r), "fresh round not complete");
}

{
  // 2. No scatters: round ends after exactly the initial award
  let r = createBonusRound();
  let complete = false;
  let retriggered = -1;
  for (let i = 0; i < FREE_SPINS_AWARDED; i++) {
    const res = play(r, blankSpin);
    r = res.state;
    complete = res.complete;
    retriggered = res.retriggered;
  }
  assertEq(r.spinsUsed, FREE_SPINS_AWARDED, "plain round plays exactly the initial award");
  assertEq(r.remaining, 0, "plain round remaining hits 0");
  assert(complete, "final spin flagged complete");
  assertEq(retriggered, 0, "no retrigger without scatters");
}

{
  // 3. Constant retriggers: cumulative total capped at MAX_FREE_SPINS_TOTAL,
  //    round plays exactly MAX_FREE_SPINS_TOTAL spins.
  let r = createBonusRound();
  let complete = false;
  let guard = 0;
  while (!complete && guard < 1000) {
    const res = play(r, retriggerSpin);
    r = res.state;
    complete = res.complete;
    guard++;
  }
  assert(complete, "retrigger-streak round terminates");
  assertEq(r.totalAwarded, MAX_FREE_SPINS_TOTAL, "retrigger streak totalAwarded = cap");
  assertEq(r.spinsUsed, MAX_FREE_SPINS_TOTAL, "retrigger streak plays exactly cap spins");
  assertEq(r.remaining, 0, "retrigger streak remaining = 0 at end");
}

{
  // 4. Partial retrigger near the cap: 25 granted + 10-scatter retrigger grants 5
  let r: BonusRoundState = { totalAwarded: 25, remaining: 1, totalWin: 0, spinsUsed: 24 };
  const res = play(r, retriggerSpin);
  assertEq(res.retriggered, MAX_FREE_SPINS_TOTAL - 25, "near-cap retrigger grants only what fits");
  assertEq(res.state.totalAwarded, MAX_FREE_SPINS_TOTAL, "totalAwarded lands exactly on cap");
  assertEq(res.state.remaining, MAX_FREE_SPINS_TOTAL - 25, "granted spins added to remaining");
  assert(!res.complete, "round continues after partial retrigger");
}

{
  // 5. Cap already hit: scatters keep landing but grant nothing, round ends
  let r: BonusRoundState = { totalAwarded: MAX_FREE_SPINS_TOTAL, remaining: 2, totalWin: 0, spinsUsed: MAX_FREE_SPINS_TOTAL - 2 };
  const first = play(r, retriggerSpin);
  assertEq(first.retriggered, 0, "post-cap scatter grants 0 spins");
  assertEq(first.state.totalAwarded, MAX_FREE_SPINS_TOTAL, "post-cap totalAwarded unchanged");
  assertEq(first.state.remaining, 1, "post-cap remaining just decrements");
  assert(!first.complete, "not complete while spins remain");
  const second = play(first.state, retriggerSpin);
  assertEq(second.retriggered, 0, "post-cap scatter still grants 0 on final spin");
  assert(second.complete, "final spin flagged complete");
}

{
  // 6. Winnings accumulate across spins, including the capped tail
  let r = createBonusRound();
  r = play(r, { totalWin: 1.5, freeSpinsAwarded: 0 }).state;
  r = play(r, { totalWin: 2.5, freeSpinsAwarded: 0 }).state;
  assertEq(r.totalWin, 4, "totalWin accumulates");
  assertEq(r.spinsUsed, 2, "spinsUsed accumulates");
}

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) {
  process.exit(1);
}
console.log("ALL BONUS-ROUND TESTS PASSED");
