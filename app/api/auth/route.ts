import { env } from "cloudflare:workers";
import { NextRequest, NextResponse } from "next/server";
import {
  ensureAuth,
  getSession,
  hashPassword,
  logAccess,
  randomPassword,
} from "../../auth-server";
const DB = () => (env as any).DB;
const cookie = (r: NextResponse, token: string, maxAge = 28800) =>
  r.cookies.set("structura_session", token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge,
  });
export async function GET(request: NextRequest) {
  await ensureAuth();
  const action = request.nextUrl.searchParams.get("action") || "me",
    session = await getSession(request);
  if (action === "me")
    return NextResponse.json({
      user: session
        ? {
            id: session.id,
            name: session.name,
            email: session.email,
            role: session.role,
            mustChange: !!session.must_change,
          }
        : null,
    });
  if (action === "logs" && session?.role === "Master Admin") {
    const rows = await DB()
      .prepare(
        "SELECT * FROM structura_access_log ORDER BY created_at DESC LIMIT 100",
      )
      .all();
    return NextResponse.json({ logs: rows.results || [] });
  }
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
export async function POST(request: NextRequest) {
  await ensureAuth();
  const body = await request.json(),
    action = body.action;
  if (action === "login") {
    const email = String(body.email || "")
        .trim()
        .toLowerCase(),
      password = String(body.password || "");
    let user = await DB()
      .prepare("SELECT * FROM structura_users WHERE email=?")
      .bind(email)
      .first();
    if (!user) {
      const count = await DB()
        .prepare("SELECT COUNT(*) total FROM structura_users")
        .first();
      if (
        Number(count?.total || 0) === 0 &&
        email ===
          String((env as any).STRUCTURA_BOOTSTRAP_EMAIL || "").toLowerCase() &&
        password === (env as any).STRUCTURA_BOOTSTRAP_PASSWORD
      ) {
        const salt = crypto.randomUUID(),
          now = new Date().toISOString(),
          id = crypto.randomUUID(),
          hash = await hashPassword(password, salt);
        await DB()
          .prepare(
            "INSERT INTO structura_users (id,name,email,password_hash,salt,role,status,must_change,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
          )
          .bind(
            id,
            "Dean Yong",
            email,
            hash,
            salt,
            "Master Admin",
            "Active",
            1,
            now,
            now,
          )
          .run();
        user = await DB()
          .prepare("SELECT * FROM structura_users WHERE email=?")
          .bind(email)
          .first();
      }
    }
    if (
      !user ||
      user.status !== "Active" ||
      (await hashPassword(password, user.salt)) !== user.password_hash
    ) {
      await logAccess(email, "Login failed");
      return NextResponse.json(
        { error: "Invalid email or password" },
        { status: 401 },
      );
    }
    const token = crypto.randomUUID() + crypto.randomUUID(),
      expires = new Date(Date.now() + 28800000).toISOString();
    await DB()
      .prepare(
        "INSERT INTO structura_sessions (token,user_id,expires_at,created_at) VALUES (?,?,?,?)",
      )
      .bind(token, user.id, expires, new Date().toISOString())
      .run();
    await logAccess(email, "Login successful");
    const res = NextResponse.json({
      ok: true,
      user: {
        name: user.name,
        email: user.email,
        role: user.role,
        mustChange: !!user.must_change,
      },
    });
    cookie(res, token);
    return res;
  }
  const session = await getSession(request);
  if (!session)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (action === "logout") {
    const token = request.cookies.get("structura_session")?.value;
    if (token)
      await DB()
        .prepare("DELETE FROM structura_sessions WHERE token=?")
        .bind(token)
        .run();
    await logAccess(session.email, "Logout");
    const res = NextResponse.json({ ok: true });
    cookie(res, "", 0);
    return res;
  }
  if (action === "change-password") {
    const password = String(body.password || "");
    if (password.length < 10)
      return NextResponse.json(
        { error: "Password must be at least 10 characters" },
        { status: 400 },
      );
    const salt = crypto.randomUUID(),
      hash = await hashPassword(password, salt);
    await DB()
      .prepare(
        "UPDATE structura_users SET password_hash=?,salt=?,must_change=0,updated_at=? WHERE id=?",
      )
      .bind(hash, salt, new Date().toISOString(), session.id)
      .run();
    await logAccess(session.email, "Password changed");
    return NextResponse.json({ ok: true });
  }
  if (session.role !== "Master Admin")
    return NextResponse.json(
      { error: "Full access required" },
      { status: 403 },
    );
  if (action === "create-user") {
    const email = String(body.email || "")
        .trim()
        .toLowerCase(),
      temp = randomPassword(),
      salt = crypto.randomUUID(),
      hash = await hashPassword(temp, salt),
      now = new Date().toISOString(),
      id = crypto.randomUUID();
    try {
      await DB()
        .prepare(
          "INSERT INTO structura_users (id,name,email,password_hash,salt,role,status,must_change,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
        )
        .bind(
          id,
          body.name,
          email,
          hash,
          salt,
          body.role,
          "Active",
          1,
          now,
          now,
        )
        .run();
    } catch {
      return NextResponse.json(
        { error: "Email already exists" },
        { status: 409 },
      );
    }
    await logAccess(session.email, "User created", email);
    return NextResponse.json({ ok: true, id, tempPassword: temp });
  }
  if (action === "update-user") {
    await DB()
      .prepare(
        "UPDATE structura_users SET name=?,email=?,role=?,status=?,updated_at=? WHERE id=?",
      )
      .bind(
        body.name,
        String(body.email).toLowerCase(),
        body.role,
        body.status,
        new Date().toISOString(),
        body.id,
      )
      .run();
    await logAccess(session.email, "User updated", body.email);
    return NextResponse.json({ ok: true });
  }
  if (action === "reset-password") {
    const temp = randomPassword(),
      salt = crypto.randomUUID(),
      hash = await hashPassword(temp, salt);
    await DB()
      .prepare(
        "UPDATE structura_users SET password_hash=?,salt=?,must_change=1,updated_at=? WHERE id=?",
      )
      .bind(hash, salt, new Date().toISOString(), body.id)
      .run();
    await logAccess(session.email, "Password reset", body.id);
    return NextResponse.json({ ok: true, tempPassword: temp });
  }
  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
