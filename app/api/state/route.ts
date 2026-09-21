import { env } from "cloudflare:workers";
import { NextRequest, NextResponse } from "next/server";
import { getSession, logAccess } from "../../auth-server";
const DB = () => (env as any).DB,
  SHARED = "structura-group";
async function ensureBackup() {
  await DB()
    .prepare(
      "CREATE TABLE IF NOT EXISTS structura_backups (id TEXT PRIMARY KEY, scope TEXT NOT NULL, payload TEXT NOT NULL, created_by TEXT, created_at TEXT NOT NULL)",
    )
    .run();
}
async function rowFor(scope: string) {
  return DB()
    .prepare(
      "SELECT payload,updated_at FROM app_state WHERE user_id=? AND scope=?",
    )
    .bind(SHARED, scope)
    .first();
}
const hasScopeData = (
  payload: string | null | undefined,
  scope: string,
) => {
  if (!payload) return false;
  try {
    const data = JSON.parse(payload);
    const records = scope === "org-chart" ? data.nodes : data.entities;
    return Array.isArray(records) && records.length > 0;
  } catch {
    return false;
  }
};
async function recoverScopeIfEmpty(row: any, scope: string, email: string) {
  if (row && hasScopeData(row.payload, scope)) return row;
  const legacyResult = await DB()
    .prepare(
      "SELECT user_id,payload,updated_at FROM app_state WHERE scope=? AND user_id<>? ORDER BY updated_at DESC",
    )
    .bind(scope, SHARED)
    .all();
  const legacy = (legacyResult.results || []).find((item: any) =>
    hasScopeData(item.payload, scope),
  ) as any;
  if (legacy) {
    const updatedAt = new Date().toISOString();
    await DB()
      .prepare(
        "INSERT INTO app_state (user_id,scope,payload,updated_at) VALUES (?,?,?,?) ON CONFLICT(user_id,scope) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at",
      )
      .bind(SHARED, scope, legacy.payload, updatedAt)
      .run();
    await logAccess(
      email,
      "Legacy data recovered",
      `${scope} · ${legacy.updated_at}`,
    );
    return { payload: legacy.payload, updated_at: updatedAt };
  }
  await ensureBackup();
  const result = await DB()
    .prepare(
      "SELECT payload,created_at FROM structura_backups WHERE scope=? ORDER BY created_at DESC LIMIT 200",
    )
    .bind(scope)
    .all();
  const backup = (result.results || []).find((item: any) =>
    hasScopeData(item.payload, scope),
  ) as any;
  if (!backup) return row;
  const updatedAt = new Date().toISOString();
  await DB()
    .prepare(
      "INSERT INTO app_state (user_id,scope,payload,updated_at) VALUES (?,?,?,?) ON CONFLICT(user_id,scope) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at",
    )
    .bind(SHARED, scope, backup.payload, updatedAt)
    .run();
  await logAccess(email, "Automatic backup recovery", `${scope} · ${backup.created_at}`);
  return { payload: backup.payload, updated_at: updatedAt };
}
export async function GET(request: NextRequest) {
  const session = await getSession(request);
  if (!session)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const scope = request.nextUrl.searchParams.get("scope") || "registry";
  let row = await rowFor(scope);
  if (scope === "registry" || scope === "org-chart")
    row = await recoverScopeIfEmpty(row, scope, session.email);
  return NextResponse.json(
    row
      ? {
          data: JSON.parse(row.payload),
          updatedAt: row.updated_at,
          currentEmail: session.email,
        }
      : { data: null, currentEmail: session.email },
  );
}
export async function PUT(request: NextRequest) {
  const session = await getSession(request);
  if (!session)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role === "Viewer")
    return NextResponse.json({ error: "Read-only access" }, { status: 403 });
  const scope = request.nextUrl.searchParams.get("scope") || "registry",
    incoming = await request.json(),
    existingRow = await rowFor(scope),
    existing = existingRow ? JSON.parse(existingRow.payload) : null;
  if (
    scope === "registry" &&
    Array.isArray(existing?.entities) &&
    existing.entities.length > 0 &&
    (!Array.isArray(incoming?.entities) || incoming.entities.length === 0)
  )
    return NextResponse.json(
      { error: "Empty registry write blocked to protect existing data." },
      { status: 409 },
    );
  if (
    scope === "org-chart" &&
    Array.isArray(existing?.nodes) &&
    existing.nodes.length > 0 &&
    (!Array.isArray(incoming?.nodes) || incoming.nodes.length === 0)
  )
    return NextResponse.json(
      { error: "Empty organisation chart write blocked to protect existing data." },
      { status: 409 },
    );
  if (session.role === "Admin Assistant" && existing) {
    const keys =
        scope === "org-chart"
          ? ["nodes"]
          : ["entities", "ownerships", "officers", "branches", "documents"],
      same = (key: string) =>
        JSON.stringify((existing[key] || []).map((x: any) => x.id).sort()) ===
        JSON.stringify((incoming[key] || []).map((x: any) => x.id).sort());
    if (!keys.every(same))
      return NextResponse.json(
        {
          error:
            "This role may edit existing records but cannot create or delete records.",
        },
        { status: 403 },
      );
    if (scope === "registry") incoming.users = existing.users || [];
  }
  await ensureBackup();
  if (existingRow)
    await DB()
      .prepare(
        "INSERT INTO structura_backups (id,scope,payload,created_by,created_at) VALUES (?,?,?,?,?)",
      )
      .bind(
        crypto.randomUUID(),
        scope,
        existingRow.payload,
        session.email,
        new Date().toISOString(),
      )
      .run();
  await DB()
    .prepare(
      "DELETE FROM structura_backups WHERE id IN (SELECT id FROM structura_backups WHERE scope=? ORDER BY created_at DESC LIMIT -1 OFFSET 200)",
    )
    .bind(scope)
    .run();
  const updatedAt = new Date().toISOString();
  await DB()
    .prepare(
      "INSERT INTO app_state (user_id,scope,payload,updated_at) VALUES (?,?,?,?) ON CONFLICT(user_id,scope) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at",
    )
    .bind(SHARED, scope, JSON.stringify(incoming), updatedAt)
    .run();
  return NextResponse.json({ ok: true, updatedAt });
}
export async function POST(request: NextRequest) {
  const session = await getSession(request);
  if (!session || session.role !== "Master Admin")
    return NextResponse.json(
      { error: "Full access required" },
      { status: 403 },
    );
  const body = await request.json();
  if (body.action === "list-backups") {
    await ensureBackup();
    const scope = body.scope || "registry",
      result = await DB()
        .prepare(
          "SELECT id,payload,created_by,created_at FROM structura_backups WHERE scope=? ORDER BY created_at DESC LIMIT 200",
        )
        .bind(scope)
        .all();
    return NextResponse.json({
      backups: (result.results || []).map((item: any) => {
        try {
          const data = JSON.parse(item.payload);
          return {
            id: item.id,
            createdAt: item.created_at,
            createdBy: item.created_by,
            entities: data.entities?.length || 0,
            ownerships: data.ownerships?.length || 0,
            branches: data.branches?.length || 0,
            officers: data.officers?.length || 0,
          };
        } catch {
          return null;
        }
      }).filter(Boolean),
    });
  }
  if (body.action === "restore-version" && body.id) {
    await ensureBackup();
    const scope = body.scope || "registry",
      selected = await DB()
        .prepare(
          "SELECT payload,created_at FROM structura_backups WHERE id=? AND scope=?",
        )
        .bind(body.id, scope)
        .first(),
      current = await rowFor(scope);
    if (!selected)
      return NextResponse.json({ error: "Backup version not found" }, { status: 404 });
    if (current)
      await DB()
        .prepare(
          "INSERT INTO structura_backups (id,scope,payload,created_by,created_at) VALUES (?,?,?,?,?)",
        )
        .bind(crypto.randomUUID(), scope, current.payload, session.email, new Date().toISOString())
        .run();
    await DB()
      .prepare(
        "INSERT INTO app_state (user_id,scope,payload,updated_at) VALUES (?,?,?,?) ON CONFLICT(user_id,scope) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at",
      )
      .bind(SHARED, scope, selected.payload, new Date().toISOString())
      .run();
    await logAccess(session.email, "Selected backup restored", `${scope} · ${selected.created_at}`);
    return NextResponse.json({ ok: true, restoredAt: selected.created_at });
  }
  if (
    body.action === "restore-latest" ||
    body.action === "restore-latest-nonempty"
  ) {
    await ensureBackup();
    const scope = body.scope || "registry",
      backupResult = await DB()
        .prepare(
          "SELECT payload,created_at FROM structura_backups WHERE scope=? ORDER BY created_at DESC LIMIT 200",
        )
        .bind(scope)
        .all(),
      backup = (backupResult.results || []).find((item: any) =>
        body.action === "restore-latest-nonempty" && scope === "registry"
          ? hasScopeData(item.payload, scope)
          : true,
      ) as any;
    if (!backup)
      return NextResponse.json(
        { error: "No backup available" },
        { status: 404 },
      );
    await DB()
      .prepare(
        "UPDATE app_state SET payload=?,updated_at=? WHERE user_id=? AND scope=?",
      )
      .bind(backup.payload, new Date().toISOString(), SHARED, scope)
      .run();
    await logAccess(
      session.email,
      "Backup restored",
      `${scope} · ${backup.created_at || "latest available"}`,
    );
    return NextResponse.json({ ok: true, restoredAt: backup.created_at || null });
  }
  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
