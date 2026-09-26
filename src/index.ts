import { Env } from "./types/env";
import { handleLogin, handleLogout, handleMe, handleRegister } from "./routes/auth";
import { handleTopup } from "./routes/wallet";

/**
 * Route table: POST/GET exact matches under /api/*; everything else
 * falls through to the static asset server (the game frontend).
 *
 * Phase 4 will add POST /api/spin (session + spin + balance update in
 * one D1 batch, provably-fair seeds stored per spin). Phase 5 adds
 * Durable Object-backed jackpot and presence routes.
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const method = request.method;

    if (method === "GET" && url.pathname === "/api/hello") {
      return Response.json({
        ok: true,
        service: "super-ace-cf",
        phase: "3 - D1 schema + auth",
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

    // Everything else falls through to the static asset server.
    // (When ./public/index.html exists it is served at "/".)
    return env.ASSETS.fetch(request);
  },
};
