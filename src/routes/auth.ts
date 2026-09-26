import { Env } from "../types/env";
import {
  SESSION_TTL_MS,
  clearedSessionCookie,
  getSessionToken,
  hashPassword,
  json,
  mintSessionToken,
  sessionCookie,
  sha256Hex,
  verifyPassword,
} from "../auth";
import { STARTING_BALANCE_CENTS } from "./wallet";

const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,20}$/;
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 128; // cap input length: PBKDF2 cost scales with it

export interface AuthedUser {
  id: string;
  username: string;
  balanceCents: number;
}

function publicUser(u: AuthedUser) {
  return {
    id: u.id,
    username: u.username,
    // Integer cents are the source of truth; `balance` is display-only.
    balanceCents: u.balanceCents,
    balance: (u.balanceCents / 100).toFixed(2),
  };
}

async function readBody<T extends Record<string, unknown>>(request: Request): Promise<T | null> {
  try {
    const body = await request.json();
    return body && typeof body === "object" ? (body as T) : null;
  } catch {
    return null;
  }
}

/** Resolves a raw session token to its user; null when unknown/expired. */
export async function lookupUserByToken(token: string, env: Env): Promise<AuthedUser | null> {
  const tokenHash = await sha256Hex(token);
  const row = await env.DB.prepare(
    `SELECT u.id, u.username, u.balance_cents
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ?1 AND s.expires_at > ?2`
  )
    .bind(tokenHash, Date.now())
    .first<{ id: string; username: string; balance_cents: number }>();
  if (!row) return null;
  return { id: row.id, username: row.username, balanceCents: row.balance_cents };
}

/** Resolves the caller from bearer token or session cookie; null = unauthenticated. */
export async function requireUser(request: Request, env: Env): Promise<AuthedUser | null> {
  const token = getSessionToken(request);
  if (!token) return null;
  return lookupUserByToken(token, env);
}

export async function handleRegister(request: Request, env: Env): Promise<Response> {
  const body = await readBody<{ username?: unknown; password?: unknown }>(request);
  const username = typeof body?.username === "string" ? body.username.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";

  if (!USERNAME_PATTERN.test(username)) {
    return json(
      { ok: false, error: "Username must be 3-20 characters: letters, digits, underscore." },
      400
    );
  }
  if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
    return json({ ok: false, error: `Password must be ${PASSWORD_MIN}-${PASSWORD_MAX} characters.` }, 400);
  }

  const existing = await env.DB.prepare("SELECT id FROM users WHERE username = ?1")
    .bind(username)
    .first();
  if (existing) {
    return json({ ok: false, error: "Username is already taken." }, 409);
  }

  const id = crypto.randomUUID();
  const now = Date.now();
  const { hash, salt } = await hashPassword(password);
  const token = mintSessionToken();
  const tokenHash = await sha256Hex(token);

  // Transactional: either both rows land or neither does.
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO users (id, username, password_hash, password_salt, balance_cents, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)`
    ).bind(id, username, hash, salt, STARTING_BALANCE_CENTS, now),
    env.DB.prepare(
      `INSERT INTO sessions (token_hash, user_id, created_at, expires_at)
       VALUES (?1, ?2, ?3, ?4)`
    ).bind(tokenHash, id, now, now + SESSION_TTL_MS),
  ]);

  const user: AuthedUser = { id, username, balanceCents: STARTING_BALANCE_CENTS };
  return json({ ok: true, token, user: publicUser(user) }, 201, { "Set-Cookie": sessionCookie(token) });
}

export async function handleLogin(request: Request, env: Env): Promise<Response> {
  const body = await readBody<{ username?: unknown; password?: unknown }>(request);
  const username = typeof body?.username === "string" ? body.username.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";

  const row = username
    ? await env.DB.prepare(
        "SELECT id, username, password_hash, password_salt, balance_cents FROM users WHERE username = ?1"
      )
        .bind(username)
        .first<{
          id: string;
          username: string;
          password_hash: string;
          password_salt: string;
          balance_cents: number;
        }>()
    : null;

  const valid = row ? await verifyPassword(password, row.password_hash, row.password_salt) : false;
  if (!row || !valid) {
    // Same message either way so the endpoint can't enumerate usernames.
    return json({ ok: false, error: "Invalid username or password." }, 401);
  }

  const now = Date.now();
  const token = mintSessionToken();
  const tokenHash = await sha256Hex(token);

  await env.DB.batch([
    env.DB.prepare("UPDATE users SET last_login_at = ?2 WHERE id = ?1").bind(row.id, now),
    env.DB.prepare("DELETE FROM sessions WHERE user_id = ?1 AND expires_at <= ?2").bind(row.id, now),
    env.DB.prepare(
      "INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?1, ?2, ?3, ?4)"
    ).bind(tokenHash, row.id, now, now + SESSION_TTL_MS),
  ]);

  const user: AuthedUser = { id: row.id, username: row.username, balanceCents: row.balance_cents };
  return json({ ok: true, token, user: publicUser(user) }, 200, { "Set-Cookie": sessionCookie(token) });
}

export async function handleLogout(request: Request, env: Env): Promise<Response> {
  const token = getSessionToken(request);
  if (token) {
    await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?1").bind(await sha256Hex(token)).run();
  }
  return json({ ok: true }, 200, { "Set-Cookie": clearedSessionCookie() });
}

export async function handleMe(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env);
  if (!user) return json({ ok: false, error: "Authentication required." }, 401);
  return json({ ok: true, user: publicUser(user) });
}
