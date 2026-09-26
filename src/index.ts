import { Env } from "./types/env";
import {
  handleLogin,
  handleLogout,
  handleMe,
  handleRegister,
  lookupUserByToken,
  requireUser,
} from "./routes/auth";
import { handleTopup } from "./routes/wallet";
import { handleCreateSession, handleGameState, handleSpin } from "./routes/game";
import { handleGetJackpots } from "./routes/jackpot";
import { JackpotDO } from "./do/JackpotDO";
import { PresenceDO } from "./do/PresenceDO";

// Durable Objects must be exported from the Worker entry module.
export { JackpotDO, PresenceDO };

/**
 * Route table: exact matches under /api/*; everything else falls through
 * to the static asset server (the game frontend).
 *
 * Phase 5 adds Durable Objects: GET /api/jackpots (public pool values +
 * winners) and GET /api/presence (authenticated WebSocket carrying the
 * online count and live jackpot pushes).
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const method = request.method;

    if (method === "GET" && url.pathname === "/api/hello") {
      return Response.json({
        ok: true,
        service: "super-ace-cf",
        phase: "5 - Durable Objects (jackpot + presence)",
        message: "Worker pipeline is alive. Static assets + API routing working.",
        time: new Date().toISOString(),
      });
    }

    if (method === "GET" && url.pathname === "/api/health") {
      return Response.json({
        ok: true,
        uptimeCheck: "worker responding",
      });
    }

    if (method === "POST" && url.pathname === "/api/auth/register") {
      return handleRegister(request, env);
    }
    if (method === "POST" && url.pathname === "/api/auth/login") {
      return handleLogin(request, env);
    }
    if (method === "POST" && url.pathname === "/api/auth/logout") {
      return handleLogout(request, env);
    }
    if (method === "GET" && url.pathname === "/api/auth/me") {
      return handleMe(request, env);
    }
    if (method === "POST" && url.pathname === "/api/wallet/topup") {
      return handleTopup(request, env);
    }

    if (method === "POST" && url.pathname === "/api/game/session") {
      return handleCreateSession(request, env);
    }
    if (method === "GET" && url.pathname === "/api/game/state") {
      return handleGameState(request, env);
    }
    if (method === "POST" && url.pathname === "/api/game/spin") {
      return handleSpin(request, env);
    }

    if (method === "GET" && url.pathname === "/api/jackpots") {
      return handleGetJackpots(request, env);
    }

    if (method === "GET" && url.pathname === "/api/presence") {
      // Browsers cannot set headers on a WebSocket, so the session token
      // may arrive as ?token= (dev/testing) or via the session cookie.
      const upgradeHeader = request.headers.get("Upgrade") ?? "";
      if (upgradeHeader.toLowerCase() !== "websocket") {
        return Response.json({ ok: false, error: "WebSocket upgrade required." }, { status: 426 });
      }
      const queryToken = url.searchParams.get("token");
      const user = queryToken
        ? await lookupUserByToken(queryToken, env)
        : await requireUser(request, env);
      if (!user) {
        return Response.json({ ok: false, error: "Authentication required." }, { status: 401 });
      }
      const stub = env.PRESENCE.get(env.PRESENCE.idFromName("global"));
      const headers = new Headers(request.headers);
      headers.set("X-User-Id", user.id);
      headers.set("X-Username", user.username);
      return stub.fetch(new Request("https://presence.internal/connect", { headers }));
    }

    // Everything else falls through to the static asset server.
    // (When ./public/index.html exists it is served at "/".)
    return env.ASSETS.fetch(request);
  },
};
