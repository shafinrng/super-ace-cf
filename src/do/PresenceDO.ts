// PresenceDO — global online count + live jackpot push.
//
// One instance (idFromName("global")) holds every connected game client
// as a hibernatable WebSocket (free-tier friendly: idle sockets cost no
// compute). It counts DISTINCT users (tabs don't inflate the number),
// broadcasts presence on joins/leaves, and re-broadcasts the jackpot
// pools on a 10-second alarm — cancelled automatically when nobody is
// connected.
//
// The spin endpoint commits jackpot changes after each spin, so a client
// watching the socket sees pools move within one tick of a spin.
import { Env } from "../types/env";
import { initialPools } from "../jackpot";

const JACKPOT_PUSH_INTERVAL_MS = 10_000;

interface Attachment {
  userId: string;
  username: string;
}

export class PresenceDO {
  constructor(private ctx: DurableObjectState, private env: Env) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/connect") {
      const upgradeHeader = request.headers.get("Upgrade");
      if (!upgradeHeader || upgradeHeader.toLowerCase() !== "websocket") {
        return new Response("Expected a WebSocket upgrade", { status: 426 });
      }

      const userId = request.headers.get("X-User-Id") ?? "anonymous";
      const username = request.headers.get("X-Username") ?? "anonymous";

      const pair = new WebSocketPair();
      // Cheap keepalive: client "ping" frames are answered by the runtime.
      this.ctx.setWebSocketAutoResponse(
        new WebSocketRequestResponsePair("ping", "pong")
      );
      this.ctx.acceptWebSocket(pair[1]);
      pair[1].serializeAttachment({ userId, username } satisfies Attachment);

      await this.broadcastPresence();
      await this.ensureAlarm();

      return new Response(null, { status: 101, webSocket: pair[0] });
    }

    if (url.pathname === "/count") {
      const online = await this.countOnline();
      return Response.json({ ok: true, online });
    }

    return new Response("Not found", { status: 404 });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    // Non-auto pings (e.g. clients that text-ping) get an ack with stats.
    if (message === "ping") {
      ws.send(JSON.stringify({ type: "presence", online: await this.countOnline() }));
    }
  }

  async webSocketClose(_ws: WebSocket): Promise<void> {
    await this.broadcastPresence();
  }

  async webSocketError(_ws: WebSocket): Promise<void> {
    await this.broadcastPresence();
  }

  async alarm(): Promise<void> {
    if (this.ctx.getWebSockets().length === 0) {
      // Nobody listening — stop ticking until the next client connects.
      await this.ctx.storage.deleteAlarm();
      return;
    }
    await this.broadcastJackpots();
    await this.ctx.storage.setAlarm(Date.now() + JACKPOT_PUSH_INTERVAL_MS);
  }

  private async broadcastPresence(): Promise<void> {
    const online = await this.countOnline();
    this.sendAll(JSON.stringify({ type: "presence", online }));
  }

  private async broadcastJackpots(): Promise<void> {
    let payload: string;
    try {
      const stub = this.env.JACKPOT.get(this.env.JACKPOT.idFromName("global"));
      const res = await stub.fetch("https://jackpot.internal/pools");
      const data = (await res.json()) as Record<string, unknown>;
      payload = JSON.stringify({ type: "jackpots", ...data });
    } catch {
      // Jackpot DO unreachable — push last-known seeded defaults rather
      // than dropping the tick; next alarm retries.
      payload = JSON.stringify({ type: "jackpots", ok: true, pools: initialPools(), winners: [] });
    }
    this.sendAll(payload);
  }

  private sendAll(message: string): void {
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(message);
      } catch {
        // A dead socket must not break the loop; close/error callbacks
        // will clean it up.
      }
    }
  }

  private async countOnline(): Promise<number> {
    const users = new Set<string>();
    for (const ws of this.ctx.getWebSockets()) {
      try {
        const a = ws.deserializeAttachment() as Attachment | null;
        if (a?.userId) users.add(a.userId);
      } catch {
        // Socket dying mid-read — ignore for the count.
      }
    }
    return users.size;
  }

  private async ensureAlarm(): Promise<void> {
    if ((await this.ctx.storage.getAlarm()) === null) {
      await this.ctx.storage.setAlarm(Date.now() + JACKPOT_PUSH_INTERVAL_MS);
    }
  }
}
