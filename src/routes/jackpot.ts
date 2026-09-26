// Public jackpot read endpoint + the peek/commit helpers the spin
// endpoint uses. Ordering (see src/do/JackpotDO.ts): the spin PEeks the
// pools before its D1 batch — so a jackpot win is credited to the
// balance in the same batch that records the spin — and COMMITS the
// contribution/pool-reset only after the batch has committed.
import { Env } from "../types/env";
import { json } from "../auth";
import { JACKPOT_TIERS, JackpotPools, JackpotWinner, TierName, initialPools } from "../jackpot";

function jackpotStub(env: Env) {
  return env.JACKPOT.get(env.JACKPOT.idFromName("global"));
}

export interface JackpotState {
  pools: JackpotPools;
  winners: JackpotWinner[];
}

const SEED_FALLBACK: JackpotState = { pools: initialPools(), winners: [] };

/** Reads the current pools; falls back to seeds if the DO is unreachable. */
export async function peekJackpots(env: Env): Promise<JackpotState> {
  try {
    const res = await jackpotStub(env).fetch("https://jackpot.internal/pools");
    const data = (await res.json()) as { ok: boolean; pools: JackpotPools; winners: JackpotWinner[] };
    if (!data.ok || !data.pools) return SEED_FALLBACK;
    return { pools: data.pools, winners: data.winners ?? [] };
  } catch {
    return SEED_FALLBACK;
  }
}

export async function commitJackpot(
  env: Env,
  contributeCents: number,
  tierWon: TierName | null,
  username: string
): Promise<JackpotState & { awardedCents: number }> {
  try {
    const res = await jackpotStub(env).fetch("https://jackpot.internal/update", {
      method: "POST",
      body: JSON.stringify({
        contributeCents,
        tierWon,
        winner: tierWon ? { tier: tierWon, username, amountCents: 0, at: Date.now() } : null,
      }),
    });
    const data = (await res.json()) as {
      ok: boolean;
      pools: JackpotPools;
      winners: JackpotWinner[];
      awardedCents: number;
    };
    if (!data.ok || !data.pools) return { ...SEED_FALLBACK, awardedCents: 0 };
    return { pools: data.pools, winners: data.winners ?? [], awardedCents: data.awardedCents ?? 0 };
  } catch {
    // Pool update failed after the spin committed — the pot drifts
    // slightly high (player-favoring); the next successful commit heals
    // contributions. Never fail the spin response for this.
    return { ...SEED_FALLBACK, awardedCents: 0 };
  }
}

/** GET /api/jackpots — public: pool values + recent winners, no auth. */
export async function handleGetJackpots(_request: Request, env: Env): Promise<Response> {
  const state = await peekJackpots(env);
  const tiers = Object.fromEntries(
    Object.entries(state.pools).map(([tier, cents]) => [
      tier,
      { seedCents: JACKPOT_TIERS[tier as TierName].seedCents, cents, credits: (cents / 100).toFixed(2) },
    ])
  );
  return json({ ok: true, tiers, winners: state.winners });
}
