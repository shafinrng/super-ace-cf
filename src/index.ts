export interface Env {
  /**
   * Static assets binding (./public). Set in wrangler.jsonc.
   * Later phases add: DB (D1), JACKPOT / PRESENCE (Durable Objects).
   */
  ASSETS: Fetcher;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/hello") {
      return Response.json({
        ok: true,
        service: "super-ace-cf",
        phase: "1 - scaffold",
        message: "Worker pipeline is alive. Static assets + API routing working.",
        time: new Date().toISOString(),
      });
    }

    if (url.pathname === "/api/health") {
      return Response.json({
        ok: true,
        uptimeCheck: "worker responding",
      });
    }

    // Everything else falls through to the static asset server.
    // (When ./public/index.html exists it is served at "/".)
    return env.ASSETS.fetch(request);
  },
};
