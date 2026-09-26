// tests/provably-fair-test.ts
//
// Pins the provably-fair guarantees:
//   1. The dependency-free SHA-256/HMAC implementations match published
//      test vectors (FIPS 180 / RFC 4231) — they are the fairness kernel.
//   2. The seed RNG stream is a pure function of (serverSeed, clientSeed,
//      nonce): same inputs → identical stream.
//   3. A full engine spin is reproducible: same seeds + nonce → identical
//      grids, wins, cascades. This is what a player verifies once the
//      server seed is revealed on session rotation.
//   4. Different nonce or client seed → different outcome.
//
// Run with: npm run test:provably-fair

import { spin } from "../src/engine/SuperAceGame";
import { createSeedRng, hmacSha256, sha256Hex, hexToBytes } from "../src/engine/rng";

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

async function main() {
  console.log("Hash primitives (published vectors):");

  assert(
    sha256Hex("") === "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    "SHA-256 of empty string matches FIPS vector"
  );
  assert(
    sha256Hex("abc") === "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    "SHA-256 of 'abc' matches FIPS vector"
  );
  assert(
    sha256Hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq") ===
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
    "SHA-256 of 448-bit vector matches FIPS vector"
  );

  // RFC 4231 HMAC-SHA-256 test cases 1 and 2.
  const rfc1 = Array.from(hexToBytes("0b".repeat(20)), (b) => b);
  const hmac1 = Array.from(hmacSha256(new Uint8Array(rfc1), new TextEncoder().encode("Hi There")), (b) =>
    b.toString(16).padStart(2, "0")
  ).join("");
  assert(
    hmac1 === "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7",
    "HMAC-SHA-256 RFC 4231 case 1 matches"
  );
  const hmac2 = Array.from(
    hmacSha256(new TextEncoder().encode("Jefe"), new TextEncoder().encode("what do ya want for nothing?")),
    (b) => b.toString(16).padStart(2, "0")
  ).join("");
  assert(
    hmac2 === "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843",
    "HMAC-SHA-256 RFC 4231 case 2 matches"
  );
  // Keys longer than the 64-byte block must be hashed first (RFC 4231 case 6:
  // 0xaa repeated 131 times).
  const hmac6 = Array.from(
    hmacSha256(new Uint8Array(131).fill(0xaa), new TextEncoder().encode("Test Using Larger Than Block-Size Key - Hash Key First")),
    (b) => b.toString(16).padStart(2, "0")
  ).join("");
  assert(
    hmac6 === "60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54",
    "HMAC-SHA-256 RFC 4231 case 6 (key > block size) matches"
  );

  console.log("Seed RNG stream:");

  const SERVER_SEED = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

  {
    const a = createSeedRng(SERVER_SEED, "client-seed", 1);
    const b = createSeedRng(SERVER_SEED, "client-seed", 1);
    const streamA = Array.from({ length: 500 }, () => a());
    const streamB = Array.from({ length: 500 }, () => b());
    assert(
      JSON.stringify(streamA) === JSON.stringify(streamB),
      "same serverSeed + clientSeed + nonce → identical 500-float stream"
    );
    assert(streamA.every((v) => v >= 0 && v < 1), "stream values are uniform in [0,1)");
  }

  {
    const n1 = createSeedRng(SERVER_SEED, "client-seed", 1)();
    const n2 = createSeedRng(SERVER_SEED, "client-seed", 2)();
    const c1 = createSeedRng(SERVER_SEED, "client-seed-a", 1)();
    const c2 = createSeedRng(SERVER_SEED, "client-seed-b", 1)();
    assert(n1 !== n2, "different nonce → different stream");
    assert(c1 !== c2, "different client seed → different stream");
  }

  console.log("Full-spin reproducibility:");

  const serverSeed2 = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
  {
    const req = { userId: "test", betAmount: 1, isFreeSpinMode: false } as const;
    const r1 = await spin(req, createSeedRng(serverSeed2, "player-seed", 7));
    const r2 = await spin(req, createSeedRng(serverSeed2, "player-seed", 7));
    assert(
      JSON.stringify({ g: r1.grid, l: r1.landedGrid, w: r1.wins, c: r1.cascades, t: r1.totalWin }) ===
        JSON.stringify({ g: r2.grid, l: r2.landedGrid, w: r2.wins, c: r2.cascades, t: r2.totalWin }),
      "same seeds + nonce → byte-identical spin (grids, cascades, wins)"
    );

    const r3 = await spin(req, createSeedRng(serverSeed2, "player-seed", 8));
    assert(
      JSON.stringify(r1.landedGrid) !== JSON.stringify(r3.landedGrid),
      "nonce + 1 → different landed grid"
    );

    const r4 = await spin(req, createSeedRng(serverSeed2, "other-seed", 7));
    assert(
      JSON.stringify(r1.landedGrid) !== JSON.stringify(r4.landedGrid),
      "different client seed → different landed grid"
    );

    // Free-spin mode reproducibility too (multiplier steps + refills).
    const f1 = await spin(
      { userId: "test", betAmount: 1, isFreeSpinMode: true, freeSpinMultiplier: 2 },
      createSeedRng(serverSeed2, "player-seed", 7)
    );
    const f2 = await spin(
      { userId: "test", betAmount: 1, isFreeSpinMode: true, freeSpinMultiplier: 2 },
      createSeedRng(serverSeed2, "player-seed", 7)
    );
    assert(
      JSON.stringify({ c: f1.cascades, t: f1.totalWin }) === JSON.stringify({ c: f2.cascades, t: f2.totalWin }),
      "free-spin mode is equally reproducible"
    );
  }

  console.log(`\n${checks - failures}/${checks} checks passed`);
  if (failures > 0) process.exit(1);
  console.log("ALL PROVABLY-FAIR TESTS PASSED");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
