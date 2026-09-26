// scripts/replay-verify.ts
//
// Offline fairness verifier — the player-side check the Worker enables:
//   sha256(revealed serverSeed) == the serverSeedHash published at
//   session creation, and every stored spin reproduces bit-for-bit from
//   its stored (serverSeed, clientSeed, nonce).
//
// Usage: npx tsx scripts/replay-verify.ts <revealedServerSeed> <spins.json> [expectedServerSeedHash]
//   where spins.json is an array of rows like the `spins` table exports:
//   [{ nonce, bet_cents, win_cents, client_seed, result_json }, ...]
//   Pass the hash that was published at session creation as the third
//   argument to also verify the commit.
//
// Exits non-zero if ANY check fails.

import { readFileSync } from "fs";
import { spin } from "../src/engine/SuperAceGame";
import { createSeedRng, sha256Hex } from "../src/engine/rng";

const [serverSeed, spinsPath, expectedHash] = process.argv.slice(2);
if (!serverSeed || !spinsPath) {
  console.error("usage: tsx scripts/replay-verify.ts <revealedServerSeed> <spins.json> [expectedServerSeedHash]");
  process.exit(2);
}

interface SpinRow {
  nonce: number;
  bet_cents: number;
  win_cents: number;
  client_seed: string;
  result_json: string;
}

const rows: SpinRow[] = JSON.parse(readFileSync(spinsPath, "utf8"));
if (rows.length === 0) {
  console.error("no spins to verify");
  process.exit(2);
}

let failures = 0;

async function main() {
for (const row of rows) {
  const stored = JSON.parse(row.result_json);
  const replayed = await spin(
    { userId: "replay", betAmount: row.bet_cents / 100, isFreeSpinMode: false },
    createSeedRng(serverSeed, row.client_seed, row.nonce)
  );

  const gridOk = JSON.stringify(replayed.grid) === JSON.stringify(stored.grid);
  const landedOk = JSON.stringify(replayed.landedGrid) === JSON.stringify(stored.landedGrid);
  const cascadesOk = JSON.stringify(replayed.cascades) === JSON.stringify(stored.cascades);
  const winOk = Math.round(replayed.totalWin * 100) === row.win_cents;

  const ok = gridOk && landedOk && cascadesOk && winOk;
  if (ok) {
    console.log(
      `  PASS  nonce ${row.nonce}: grid + cascades + win (${row.win_cents}c) reproduce exactly`
    );
  } else {
    failures++;
    console.error(
      `  FAIL  nonce ${row.nonce}: grid=${gridOk} landed=${landedOk} cascades=${cascadesOk} win=${winOk}`
    );
  }
}

const computedHash = sha256Hex(serverSeed);
if (expectedHash) {
  if (computedHash === expectedHash) {
    console.log("  PASS  sha256(revealed serverSeed) matches the committed serverSeedHash");
  } else {
    failures++;
    console.error("  FAIL  sha256(revealed serverSeed) does NOT match the committed hash — seed was swapped!");
  }
} else {
  console.log(`  INFO  computed serverSeedHash: ${computedHash}`);
}

if (failures > 0) process.exit(1);
console.log(`REPLAY VERIFIED: ${rows.length}/${rows.length} spins reproduce from the revealed seed`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
