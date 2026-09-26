// JackpotDO — the single, global owner of the four progressive pools.
//
// One Durable Object instance (idFromName("global")) serializes every
// update, so contribution + payout + reset are atomic without any
// locking. State persists in DO storage. The spin endpoint reads pools
// BEFORE its D1 batch (so the jackpot win is credited atomically with
// the spin) and commits the contribution/reset AFTER the batch commits —
// crash windows can only drift the pool in the player-favoring
// direction; a player is never left unpaid.
import { Env } from "../types/env";
import {
  JackpotPools,
  JackpotWinner,
  PoolUpdateResult,
  TierName,
  applyPoolUpdate,
  initialPools,
} from "../jackpot";

interface StoredState {
  pools: JackpotPools;
  winners: JackpotWinner[];
}

export class JackpotDO {
  constructor(private ctx: DurableObjectState, private env: Env) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/pools") {
      const state = await this.load();
      return Response.json({ ok: true, ...state });
    }

    if (request.method === "POST" && url.pathname === "/update") {
      const body = (await request.json()) as {
        contributeCents?: unknown;
        tierWon?: unknown;
        winner?: unknown;
      };
      const contributeCents = body.contributeCents as number;
      const tierWon = (body.tierWon as TierName) ?? null;
      const winner = (body.winner as JackpotWinner) ?? null;

      const state = await this.load();
      const result: PoolUpdateResult = applyPoolUpdate(
        state.pools,
        state.winners,
        contributeCents,
        tierWon,
        winner
      );
      // The Worker can't know the payout before the DO computes it —
      // stamp the awarded amount onto the winner entry before storing.
      if (result.awardedCents > 0 && result.winners[0]) {
        result.winners[0] = { ...result.winners[0], amountCents: result.awardedCents };
      }
      await this.ctx.storage.put<StoredState>("state", {
        pools: result.pools,
        winners: result.winners,
      });
      return Response.json({
        ok: true,
        pools: result.pools,
        awardedCents: result.awardedCents,
        winners: result.winners,
      });
    }

    return new Response("Not found", { status: 404 });
  }

  private async load(): Promise<StoredState> {
    const stored = await this.ctx.storage.get<StoredState>("state");
    if (stored && stored.pools && stored.winners) return stored;
    return { pools: initialPools(), winners: [] };
  }
}
