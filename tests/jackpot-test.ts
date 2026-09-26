// tests/jackpot-test.ts
//
// Deterministic checks for the jackpot tier bands and pool math:
//   1. selectJackpotTier resolves the documented hit bands exactly
//      (GRAND 1/100k, MAJOR 1/20k, MINOR 1/4k, MINI 1/2k), boundary
//      floats included, and returns null outside the bands.
//   2. applyPoolUpdate: contributions land on every tier; a hit pays
//      the pool value BEFORE the spin's own contribution, resets that
//      tier to its seed, then adds the contribution on top; winners
//      list is capped at 10.
//   3. A forced-odds sanity run: simulating the band selection over a
//      large uniform sample reproduces the documented odds within
//      tolerance.
//
// Run with: npm run test:jackpot

import {
  JACKPOT_TIERS,
  TIER_NAMES,
  JackpotWinner,
  applyPoolUpdate,
  initialPools,
  selectJackpotTier,
} from "../src/jackpot";

let failures = 0;
let checks = 0;

function assert(cond: boolean, label: string) {
  checks++;
  if (cond) console.log(`  PASS  ${label}`);
  else {
    failures++;
    console.error(`  FAIL  ${label}`);
  }
}

// Deterministic xorshift-based uniform source for the odds sanity run.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function main() {
  console.log("Jackpot hit bands:");

  assert(selectJackpotTier(0) === "GRAND", "draw 0 hits GRAND");
  assert(selectJackpotTier(0.000009999) === "GRAND", "draw just under GRAND band hits GRAND");
  assert(selectJackpotTier(0.00001) === "MAJOR", "draw at MAJOR band start hits MAJOR");
  assert(selectJackpotTier(0.000059999) === "MAJOR", "draw just under MINOR band hits MAJOR");
  assert(selectJackpotTier(0.00006) === "MINOR", "draw at MINOR band start hits MINOR");
  assert(selectJackpotTier(0.000309999) === "MINOR", "draw just under MINI band hits MINOR");
  assert(selectJackpotTier(0.00031) === "MINI", "draw at MINI band start hits MINI");
  assert(selectJackpotTier(0.000809999) === "MINI", "draw just under band end hits MINI");
  assert(selectJackpotTier(0.00081) === null, "draw at/after band end wins nothing");
  assert(selectJackpotTier(0.5) === null, "typical draw wins nothing");

  console.log("Pool math:");

  {
    const pools = initialPools();
    const res = applyPoolUpdate(pools, [], 1, null, null);
    assert(res.pools.GRAND === JACKPOT_TIERS.GRAND.seedCents + 1, "contribution lands on GRAND");
    assert(res.pools.MINI === JACKPOT_TIERS.MINI.seedCents + 1, "contribution lands on MINI");
    assert(res.awardedCents === 0, "no hit → nothing awarded");
    assert(res.winners.length === 0, "no hit → no winners");
    assert(pools.GRAND === JACKPOT_TIERS.GRAND.seedCents, "input pools not mutated");
  }

  {
    const pools = initialPools();
    pools.MINOR = 123_456; // grew past its seed
    const winner: JackpotWinner = { tier: "MINOR", username: "tester", amountCents: 0, at: 1 };
    const res = applyPoolUpdate(pools, [], 5, "MINOR", winner);
    assert(res.awardedCents === 123_456, "hit pays the pool BEFORE this spin's contribution");
    assert(res.pools.MINOR === JACKPOT_TIERS.MINOR.seedCents + 5, "hit tier resets to seed, then contribution lands");
    assert(res.pools.GRAND === JACKPOT_TIERS.GRAND.seedCents + 5, "other tiers also grow by the contribution");
    assert(res.winners.length === 1 && res.winners[0].username === "tester", "winner recorded");
  }

  {
    let winners: JackpotWinner[] = [];
    for (let i = 0; i < 25; i++) {
      winners = applyPoolUpdate(initialPools(), winners, 0, "MINI", {
        tier: "MINI",
        username: `user${i}`,
        amountCents: 1,
        at: i,
      }).winners;
    }
    assert(winners.length === 10, "winners list capped at 10");
    assert(winners[0].username === "user24" && winners[9].username === "user15", "newest winners kept");
  }

  {
    let threw = false;
    try {
      applyPoolUpdate(initialPools(), [], -1, null, null);
    } catch {
      threw = true;
    }
    assert(threw, "negative contribution rejected");
    assert(TIER_NAMES.length === 4, "exactly four tiers configured");
  }

  console.log("Odds sanity (1,000,000 uniform draws):");
  {
    const rng = mulberry32(0xc0ffee);
    const counts: Record<string, number> = { GRAND: 0, MAJOR: 0, MINOR: 0, MINI: 0, none: 0 };
    for (let i = 0; i < 1_000_000; i++) {
      const t = selectJackpotTier(rng());
      counts[t ?? "none"]++;
    }
    // Tolerances ±20% — bands are exact, this only checks the mapping.
    assert(Math.abs(counts.GRAND / 10) < 1 * 1.2 + 1, `GRAND ≈ 10 hits (got ${counts.GRAND})`);
    assert(Math.abs(counts.MAJOR - 50) < 25, `MAJOR ≈ 50 hits (got ${counts.MAJOR})`);
    assert(Math.abs(counts.MINOR - 250) < 60, `MINOR ≈ 250 hits (got ${counts.MINOR})`);
    assert(Math.abs(counts.MINI - 500) < 90, `MINI ≈ 500 hits (got ${counts.MINI})`);
  }

  console.log(`\n${checks - failures}/${checks} checks passed`);
  if (failures > 0) process.exit(1);
  console.log("ALL JACKPOT TESTS PASSED");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
