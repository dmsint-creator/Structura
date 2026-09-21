import { env } from "cloudflare:workers";
import { NextRequest } from "next/server";
const DB = () => (env as any).DB;
const enc = new TextEncoder();
const hex = (b: ArrayBuffer) =>
  Array.from(new Uint8Array(b))
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
export async function hashPassword(password: string, salt: string) {
  const key = await crypto.subtle.importKey(
      "raw",
      enc.encode(password),
      "PBKDF2",
      false,
      ["deriveBits"],
    ),
    bits = await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        hash: "SHA-256",
        salt: enc.encode(salt),
        iterations: 100000,
      },
      key,
      256,
    );
  return hex(bits);
}
export async function ensureAuth() {
  await DB()
    .prepare(
      "CREATE TABLE IF NOT EXISTS structura_users (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, salt TEXT NOT NULL, role TEXT NOT NULL, status TEXT NOT NULL, must_change INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)",
    )
    .run();
  await DB()
    .prepare(
      "CREATE TABLE IF NOT EXISTS structura_sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL)",
    )
    .run();
  await DB()
    .prepare(
      "CREATE TABLE IF NOT EXISTS structura_access_log (id TEXT PRIMARY KEY, user_email TEXT, action TEXT NOT NULL, detail TEXT, created_at TEXT NOT NULL)",
    )
    .run();
}
export async function logAccess(email: string, action: string, detail = "") {
  await ensureAuth();
  await DB()
    .prepare(
      "INSERT INTO structura_access_log (id,user_email,action,detail,created_at) VALUES (?,?,?,?,?)",
    )
    .bind(crypto.randomUUID(), email, action, detail, new Date().toISOString())
    .run();
}
export async function getSession(request: NextRequest) {
  await ensureAuth();
  const token = request.cookies.get("structura_session")?.value;
  if (!token) return null;
  const row = await DB()
    .prepare(
      "SELECT u.id,u.name,u.email,u.role,u.status,u.must_change,s.expires_at FROM structura_sessions s JOIN structura_users u ON u.id=s.user_id WHERE s.token=?",
    )
    .bind(token)
    .first();
  if (
    !row ||
    row.status !== "Active" ||
    new Date(row.expires_at) < new Date()
  ) {
    if (token)
      await DB()
        .prepare("DELETE FROM structura_sessions WHERE token=?")
        .bind(token)
        .run();
    return null;
  }
  return row as {
    id: string;
    name: string;
    email: string;
    role: string;
    status: string;
    must_change: number;
    expires_at: string;
  };
}
export function randomPassword() {
  const chars =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
  const bytes = crypto.getRandomValues(new Uint8Array(14));
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}
