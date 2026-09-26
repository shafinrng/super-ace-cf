// Phase 4: provably-fair spin endpoint.
//
// Every spin (base or free) runs as ONE transactional D1 batch:
//   session nonce update + spin insert + balance updates (+ bonus-round
//   state change) — all-or-nothing. Concurrency is guarded by structural
//   constraints rather than read-then-write checks:
//   - UNIQUE(game_sessions.user_id) WHERE active=1  → one seed chain per user
//   - UNIQUE(spins.session_id, spins.nonce)         → a raced duplicate spin
//     fails its whole batch instead of double-spending
//   - users.balance_cents CHECK (>= 0)              → an overdraw aborts the batch
//
// Fairness model (commit-reveal): a session's server seed is committed as
// a SHA-256 hash at creation; the spin's entire random stream is
// HMAC-SHA-256(serverSeed, `${clientSeed}:${nonce}:${counter}`) — see
// src/engine/rng.ts. Rotating the session reveals the server seed, so every
// stored spin can be replayed from its stored seeds. There is no RTP-bias
// hook anywhere: outcomes are a pure function of the seeds.
import { Env } from "../types/env";
import { json } from "../auth";
import { requireUser } from "./auth";
import { spin } from "../engine/SuperAceGame";
import { createSeedRng, sha256Hex } from "../engine/rng";
import { applyFreeSpinResult, BonusRoundState } from "../engine/BonusRound";
import { FREE_SPIN_MULTIPLIER_STEPS } from "../engine/constants";

const MIN_BET_CENTS = 100; // 1.00 credit
const MAX_BET_CENTS = 1_000_000; // 10,000.00 credits

interface GameSessionRow {
  id: string;
  server_seed: string;
  server_seed_hash: string;
  client_seed: string;
  nonce: number;
}

interface BonusRoundRow {
  total_awarded: number;
  remaining: number;
  total_win_cents: number;
  spins_used: number;
  bet_cents: number;
}

function randomHex(bytes: number): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) =>
    b.toString(16).padStart(2, "0")
  ).join("");
}

async function getActiveSession(env: Env, userId: string): Promise<GameSessionRow | null> {
  return env.DB.prepare(
    `SELECT id, server_seed, server_seed_hash, client_seed, nonce
     FROM game_sessions WHERE user_id = ?1 AND active = 1`
  )
    .bind(userId)
    .first<GameSessionRow>();
}

async function createSession(env: Env, userId: string, clientSeed?: string) {
  const now = Date.now();
  const serverSeed = randomHex(32);
  const resolvedClientSeed =
    typeof clientSeed === "string" && clientSeed.trim().length > 0 && clientSeed.length <= 128
      ? clientSeed.trim()
      : randomHex(16);

  const previous = await getActiveSession(env, userId);
  if (previous) {
    await env.DB.prepare("UPDATE game_sessions SET active = 0, closed_at = ?2 WHERE id = ?1")
      .bind(previous.id, now)
      .run();
  }

  const id = crypto.randomUUID();
  const serverSeedHash = sha256Hex(serverSeed);
  await env.DB.prepare(
    `INSERT INTO game_sessions (id, user_id, server_seed, server_seed_hash, client_seed, nonce, active, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, 0, 1, ?6)`
  )
    .bind(id, userId, serverSeed, serverSeedHash, resolvedClientSeed, now)
    .run();

  return {
    id,
    server_seed: serverSeed,
    server_seed_hash: serverSeedHash,
    client_seed: resolvedClientSeed,
    nonce: 0,
    // Revealing the closed session's seed lets the player verify every
    // spin that was stored under it.
    previousServerSeed: previous?.server_seed ?? null,
  };
}

function bonusStateOf(row: BonusRoundRow): BonusRoundState {
  return {
    totalAwarded: row.total_awarded,
    remaining: row.remaining,
    totalWin: row.total_win_cents / 100,
    spinsUsed: row.spins_used,
  };
}

function isConstraintError(err: unknown, kind: "UNIQUE" | "CHECK"): boolean {
  const msg = String((err as Error)?.message ?? err);
  return msg.includes(`${kind} constraint failed`);
}

/** Creates a fresh session (closing the previous one and revealing its seed). */
export async function handleCreateSession(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env);
  if (!user) return json({ ok: false, error: "Authentication required." }, 401);

  let clientSeed: string | undefined;
  try {
    const body = (await request.json()) as { clientSeed?: unknown };
    if (typeof body?.clientSeed === "string") clientSeed = body.clientSeed;
  } catch {
    // Empty body is fine — a client seed is generated.
  }

  const session = await createSession(env, user.id, clientSeed);
  return json({
    ok: true,
    session: {
      serverSeedHash: session.server_seed_hash,
      clientSeed: session.client_seed,
      nonce: session.nonce,
    },
    previousServerSeed: session.previousServerSeed,
  });
}

export async function handleGameState(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env);
  if (!user) return json({ ok: false, error: "Authentication required." }, 401);

  const [row, session, bonus] = await Promise.all([
    env.DB.prepare("SELECT balance_cents FROM users WHERE id = ?1").bind(user.id).first<{ balance_cents: number }>(),
    getActiveSession(env, user.id),
    env.DB.prepare(
      "SELECT total_awarded, remaining, total_win_cents, spins_used, bet_cents FROM bonus_rounds WHERE user_id = ?1"
    )
      .bind(user.id)
      .first<BonusRoundRow>(),
  ]);

  return json({
    ok: true,
    balanceCents: row?.balance_cents ?? 0,
    balance: ((row?.balance_cents ?? 0) / 100).toFixed(2),
    session: session
      ? { serverSeedHash: session.server_seed_hash, clientSeed: session.client_seed, nonce: session.nonce }
      : null,
    bonusRound: bonus
      ? {
          active: true,
          totalAwarded: bonus.total_awarded,
          remaining: bonus.remaining,
          totalWinCents: bonus.total_win_cents,
          spinsUsed: bonus.spins_used,
          betCents: bonus.bet_cents,
        }
      : null,
  });
}

export async function handleSpin(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env);
  if (!user) return json({ ok: false, error: "Authentication required." }, 401);

  let body: { betCents?: unknown } = {};
  try {
    body = (await request.json()) as { betCents?: unknown };
  } catch {
    return json({ ok: false, error: "Request body must be JSON." }, 400);
  }

  const [bonus, session] = await Promise.all([
    env.DB.prepare(
      "SELECT total_awarded, remaining, total_win_cents, spins_used, bet_cents FROM bonus_rounds WHERE user_id = ?1"
    )
      .bind(user.id)
      .first<BonusRoundRow>(),
    getActiveSession(env, user.id),
  ]);
  const activeSession = session ?? (await createSession(env, user.id, undefined));
  const now = Date.now();
  const nonce = activeSession.nonce + 1;

  const isFreeSpin = bonus !== null;
  let betCents: number;
  let result;

  if (isFreeSpin) {
    // Free spin: bet is ignored and locked to the triggering spin's amount.
    betCents = bonus.bet_cents;
    result = await spin(
      {
        userId: user.id,
        betAmount: betCents / 100,
        isFreeSpinMode: true,
        freeSpinMultiplier: FREE_SPIN_MULTIPLIER_STEPS[0],
      },
      createSeedRng(activeSession.server_seed, activeSession.client_seed, nonce)
    );
  } else {
    betCents = body.betCents as number;
    if (!Number.isInteger(betCents) || betCents < MIN_BET_CENTS || betCents > MAX_BET_CENTS) {
      return json(
        { ok: false, error: `betCents must be an integer between ${MIN_BET_CENTS} and ${MAX_BET_CENTS}.` },
        400
      );
    }
    if (user.balanceCents < betCents) {
      return json({ ok: false, error: "Insufficient balance." }, 400);
    }
    result = await spin(
      { userId: user.id, betAmount: betCents / 100, isFreeSpinMode: false },
      createSeedRng(activeSession.server_seed, activeSession.client_seed, nonce)
    );
  }

  const winCents = Math.round(result.totalWin * 100);
  const balanceAfterCents = user.balanceCents - (isFreeSpin ? 0 : betCents) + winCents;

  const statements: D1PreparedStatement[] = [
    // The debit has no WHERE guard on purpose: if it would push the balance
    // negative, the CHECK constraint throws and the WHOLE batch rolls back.
    env.DB.prepare("UPDATE users SET balance_cents = balance_cents - ?1 WHERE id = ?2").bind(
      isFreeSpin ? 0 : betCents,
      user.id
    ),
    env.DB.prepare("UPDATE users SET balance_cents = balance_cents + ?1 WHERE id = ?2").bind(
      winCents,
      user.id
    ),
    env.DB.prepare(
      `INSERT INTO spins (user_id, session_id, nonce, bet_cents, win_cents, balance_after_cents,
        is_free_spin, free_spins_awarded, server_seed_hash, client_seed, result_json, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`
    ).bind(
      user.id,
      activeSession.id,
      nonce,
      betCents,
      winCents,
      balanceAfterCents,
      isFreeSpin ? 1 : 0,
      isFreeSpin ? 0 : result.freeSpinsAwarded,
      activeSession.server_seed_hash,
      activeSession.client_seed,
      JSON.stringify({
        grid: result.grid,
        landedGrid: result.landedGrid,
        goldenPositions: result.goldenPositions,
        wins: result.wins,
        cascades: result.cascades,
        multiplier: result.multiplier,
        totalWin: result.totalWin,
      }),
      now
    ),
    env.DB.prepare("UPDATE game_sessions SET nonce = ?2 WHERE id = ?1").bind(activeSession.id, nonce),
  ];

  let bonusView: Record<string, unknown>;
  if (isFreeSpin) {
    const applied = applyFreeSpinResult(bonusStateOf(bonus), result);
    if (applied.complete) {
      statements.push(
        env.DB.prepare("DELETE FROM bonus_rounds WHERE user_id = ?1").bind(user.id)
      );
    } else {
      statements.push(
        env.DB.prepare(
          `UPDATE bonus_rounds SET total_awarded = ?2, remaining = ?3, total_win_cents = ?4, spins_used = ?5
           WHERE user_id = ?1`
        ).bind(user.id, applied.state.totalAwarded, applied.state.remaining, bonus.total_win_cents + winCents, applied.state.spinsUsed)
      );
    }
    bonusView = {
      triggered: false,
      active: !applied.complete,
      completed: applied.complete,
      retriggered: applied.retriggered,
      remaining: applied.state.remaining,
      totalAwarded: applied.state.totalAwarded,
      spinsUsed: applied.state.spinsUsed,
      totalWinCents: bonus.total_win_cents + winCents,
      betCents: bonus.bet_cents,
    };
  } else {
    if (result.freeSpinsAwarded > 0) {
      statements.push(
        env.DB.prepare(
          `INSERT INTO bonus_rounds (user_id, total_awarded, remaining, total_win_cents, spins_used, bet_cents, started_at)
           VALUES (?1, ?2, ?3, 0, 0, ?4, ?5)`
        ).bind(user.id, result.freeSpinsAwarded, result.freeSpinsAwarded, betCents, now)
      );
    }
    bonusView = {
      triggered: result.freeSpinsAwarded > 0,
      active: result.freeSpinsAwarded > 0,
      remaining: result.freeSpinsAwarded > 0 ? result.freeSpinsAwarded : 0,
      totalAwarded: result.freeSpinsAwarded,
    };
  }

  try {
    await env.DB.batch(statements);
  } catch (err) {
    if (isConstraintError(err, "UNIQUE")) {
      return json({ ok: false, error: "Concurrent spin detected — retry." }, 409);
    }
    if (isConstraintError(err, "CHECK")) {
      return json({ ok: false, error: "Insufficient balance." }, 400);
    }
    throw err;
  }

  return json({
    ok: true,
    spin: {
      nonce,
      isFreeSpinMode: result.isFreeSpinMode,
      grid: result.grid,
      landedGrid: result.landedGrid,
      goldenPositions: result.goldenPositions,
      wins: result.wins,
      cascades: result.cascades,
      multiplier: result.multiplier,
      totalWin: result.totalWin,
      freeSpinsAwarded: result.freeSpinsAwarded,
    },
    betCents,
    winCents,
    balanceCents: balanceAfterCents,
    balance: (balanceAfterCents / 100).toFixed(2),
    bonusRound: bonusView,
    fairness: {
      serverSeedHash: activeSession.server_seed_hash,
      clientSeed: activeSession.client_seed,
      nonce,
    },
  });
}
