export interface Env {
  /** Static assets binding (./public). Set in wrangler.jsonc. */
  ASSETS: Fetcher;
  /** D1 binding — schema in migrations/000{1,2,3}_*.sql. */
  DB: D1Database;
  /** Global jackpot pools Durable Object (JackpotDO). */
  JACKPOT: DurableObjectNamespace;
  /** Global online-count + live-push Durable Object (PresenceDO). */
  PRESENCE: DurableObjectNamespace;
}
