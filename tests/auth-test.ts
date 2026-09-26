// tests/auth-test.ts
//
// Deterministic checks for the auth primitives in src/auth.ts, run under
// Node's WebCrypto (same API surface the Workers runtime provides):
// password hash/verify roundtrip, wrong-password rejection, salt
// uniqueness, timing-safe comparison, and cookie/bearer token extraction.
//
// Run with: npm run test:auth

import {
  getSessionToken,
  hashPassword,
  mintSessionToken,
  sessionCookie,
  timingSafeEqualHex,
  verifyPassword,
} from "../src/auth";

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

console.log("Auth primitives:");

async function main() {
{
  const { hash, salt } = await hashPassword("correct horse battery staple");
  assert(hash.length === 64 && /^[0-9a-f]+$/.test(hash), "PBKDF2 hash is 64 hex chars");
  assert(salt.length === 32 && /^[0-9a-f]+$/.test(salt), "salt is 16 bytes hex");
  assert(
    await verifyPassword("correct horse battery staple", hash, salt),
    "verify accepts the correct password"
  );
  assert(
    !(await verifyPassword("wrong password", hash, salt)),
    "verify rejects a wrong password"
  );
  const { hash: hash2, salt: salt2 } = await hashPassword("correct horse battery staple");
  assert(hash2 !== hash && salt2 !== salt, "re-hashing the same password gives a fresh salt + hash");
  assert(
    await verifyPassword("correct horse battery staple", hash2, salt2),
    "verify accepts against the second stored pair"
  );
}

{
  assert(timingSafeEqualHex("ab12", "ab12"), "timingSafeEqualHex matches equal strings");
  assert(!timingSafeEqualHex("ab12", "ab13"), "timingSafeEqualHex rejects different strings");
  assert(!timingSafeEqualHex("ab12", "ab1"), "timingSafeEqualHex rejects length mismatch");
}

{
  const token = mintSessionToken();
  assert(/^[0-9a-f]{64}$/.test(token), "session token is 32 random bytes hex");
  assert(mintSessionToken() !== token, "session tokens are unique per mint");

  const request = (headers: Record<string, string>) =>
    new Request("https://example.com/api/auth/me", { headers });
  const cookie = sessionCookie(token);
  assert(cookie.includes("HttpOnly") && cookie.includes("SameSite=Lax"), "cookie is HttpOnly + SameSite=Lax");
  assert(
    getSessionToken(request({ Cookie: `other=1; ${cookie.split(";")[0]}; more=2` })) === token,
    "bearer-or-cookie extraction finds sa_session among other cookies"
  );
  assert(
    getSessionToken(request({ Authorization: `Bearer ${token}` })) === token,
    "bearer-or-cookie extraction accepts Authorization: Bearer"
  );
  assert(getSessionToken(request({})) === null, "no token provided → null");
}
}

main()
  .then(() => {
    console.log(`\n${checks - failures}/${checks} checks passed`);
    if (failures > 0) process.exit(1);
    console.log("ALL AUTH TESTS PASSED");
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
