// Virtual-credit economy. HARD RULE: play-money only. This module is the
// ONLY code path that ever grants credits, and the grant below is free —
// there is no purchase, payment, or deposit mechanism anywhere in this
// project, and none may be added.
import { Env } from "../types/env";
import { json } from "../auth";
import { requireUser } from "./auth";

/** New accounts start with 10,000.00 virtual credits. */
export const STARTING_BALANCE_CENTS = 1_000_000;
/** A broke account can top up +5,000.00 virtual credits... */
const TOPUP_AMOUNT_CENTS = 500_000;
/** ...but only when its balance is under 1,000.00 credits... */
const TOPUP_THRESHOLD_CENTS = 100_000;
/** ...and at most once per hour. */
const TOPUP_COOLDOWN_MS = 60 * 60 * 1000;

export async function handleTopup(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env);
  if (!user) return json({ ok: false, error: "Authentication required." }, 401);

  const now = Date.now();
  // Single guarded UPDATE — eligibility checks and the grant are atomic,
  // so concurrent requests can never double-grant.
  const grant = await env.DB.prepare(
    `UPDATE users SET balance_cents = balance_cents + ?1, last_topup_at = ?2
     WHERE id = ?3
       AND balance_cents < ?4
       AND (last_topup_at IS NULL OR ?2 - last_topup_at >= ?5)`
  )
    .bind(TOPUP_AMOUNT_CENTS, now, user.id, TOPUP_THRESHOLD_CENTS, TOPUP_COOLDOWN_MS)
    .run();

  if (grant.meta.changes === 0) {
    const row = await env.DB.prepare("SELECT balance_cents, last_topup_at FROM users WHERE id = ?1")
      .bind(user.id)
      .first<{ balance_cents: number; last_topup_at: number | null }>();
    if (row && row.balance_cents >= TOPUP_THRESHOLD_CENTS) {
      return json(
        {
          ok: false,
          error: `Top-up is only available when the balance is under ${(TOPUP_THRESHOLD_CENTS / 100).toFixed(2)} credits.`,
          balanceCents: row.balance_cents,
        },
        400
      );
    }
    const retryAfterMs = row?.last_topup_at ? row.last_topup_at + TOPUP_COOLDOWN_MS - now : TOPUP_COOLDOWN_MS;
    return json(
      {
        ok: false,
        error: "Top-up is on cooldown. Try again later.",
        retryAfterMs: Math.max(0, retryAfterMs),
      },
      429
    );
  }

  const row = await env.DB.prepare("SELECT balance_cents FROM users WHERE id = ?1")
    .bind(user.id)
    .first<{ balance_cents: number }>();
  const balanceCents = row?.balance_cents ?? user.balanceCents + TOPUP_AMOUNT_CENTS;
  return json({
    ok: true,
    grantedCents: TOPUP_AMOUNT_CENTS,
    granted: (TOPUP_AMOUNT_CENTS / 100).toFixed(2),
    balanceCents,
    balance: (balanceCents / 100).toFixed(2),
  });
}
