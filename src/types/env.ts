export interface Env {
  /** Static assets binding (./public). Set in wrangler.jsonc. */
  ASSETS: Fetcher;
  /** D1 binding — schema in migrations/0001_users_sessions.sql. */
  DB: D1Database;
}
