import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { getSession, logAccess } from "../../auth-server";

function createRequestSupabaseClient(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    );
  }

  return createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll() {
        // Cookie writes are handled by the auth route.
      },
    },
  });
}

function hasScopeData(payload: any, scope: string) {
  if (!payload) return false;

  const records =
    scope === "org-chart"
      ? payload.nodes
      : payload.entities;

  return Array.isArray(records) && records.length > 0;
}

async function rowFor(
  request: NextRequest,
  organizationId: string,
  scope: string,
) {
  const supabase = createRequestSupabaseClient(request);

  const { data, error } = await supabase
    .from("app_state")
    .select("payload, updated_at")
    .eq("organization_id", organizationId)
    .eq("scope", scope)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

async function trimBackups(
  request: NextRequest,
  organizationId: string,
  scope: string,
) {
  const supabase = createRequestSupabaseClient(request);

  const { data, error } = await supabase
    .from("structura_backups")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("scope", scope)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  const oldIds = (data ?? [])
    .slice(200)
    .map((row) => row.id);

  if (oldIds.length === 0) return;

  const { error: deleteError } = await supabase
    .from("structura_backups")
    .delete()
    .in("id", oldIds);

  if (deleteError) {
    throw new Error(deleteError.message);
  }
}

async function recoverScopeIfEmpty(
  request: NextRequest,
  row: any,
  organizationId: string,
  scope: string,
) {
  if (row && hasScopeData(row.payload, scope)) {
    return row;
  }

  const supabase = createRequestSupabaseClient(request);

  const { data: backups, error } = await supabase
    .from("structura_backups")
    .select("payload, created_at")
    .eq("organization_id", organizationId)
    .eq("scope", scope)
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    throw new Error(error.message);
  }

  const backup = (backups ?? []).find((item) =>
    hasScopeData(item.payload, scope),
  );

  if (!backup) {
    return row;
  }

  const updatedAt = new Date().toISOString();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { error: restoreError } = await supabase
    .from("app_state")
    .upsert(
      {
        organization_id: organizationId,
        scope,
        payload: backup.payload,
        updated_by: user?.id ?? null,
        updated_at: updatedAt,
      },
      {
        onConflict: "organization_id,scope",
      },
    );

  if (restoreError) {
    throw new Error(restoreError.message);
  }

  await logAccess(
    request,
    "Automatic backup recovery",
    `${scope} · ${backup.created_at}`,
  );

  return {
    payload: backup.payload,
    updated_at: updatedAt,
  };
}

// ============================================================
// GET STATE
// ============================================================

export async function GET(request: NextRequest) {
  const session = await getSession(request);

  if (!session) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 },
    );
  }

  const scope =
    request.nextUrl.searchParams.get("scope") ||
    "registry";

  try {
    let row = await rowFor(
      request,
      session.organization_id,
      scope,
    );

    if (
      scope === "registry" ||
      scope === "org-chart"
    ) {
      row = await recoverScopeIfEmpty(
        request,
        row,
        session.organization_id,
        scope,
      );
    }

    return NextResponse.json(
      row
        ? {
            data: row.payload,
            updatedAt: row.updated_at,
            currentEmail: session.email,
          }
        : {
            data: null,
            currentEmail: session.email,
          },
    );
  } catch (error) {
    console.error("State GET failed:", error);

    return NextResponse.json(
      { error: "Unable to load application state" },
      { status: 500 },
    );
  }
}

// ============================================================
// PUT STATE
// ============================================================

export async function PUT(request: NextRequest) {
  const session = await getSession(request);

  if (!session) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 },
    );
  }

  if (session.role === "Viewer") {
    return NextResponse.json(
      { error: "Read-only access" },
      { status: 403 },
    );
  }

  const scope =
    request.nextUrl.searchParams.get("scope") ||
    "registry";

  const incoming = await request.json();

  try {
    const existingRow = await rowFor(
      request,
      session.organization_id,
      scope,
    );

    const existing = existingRow?.payload ?? null;

    // --------------------------------------------------------
    // Protect registry against accidental empty writes.
    // --------------------------------------------------------

    if (
      scope === "registry" &&
      Array.isArray(existing?.entities) &&
      existing.entities.length > 0 &&
      (!Array.isArray(incoming?.entities) ||
        incoming.entities.length === 0)
    ) {
      return NextResponse.json(
        {
          error:
            "Empty registry write blocked to protect existing data.",
        },
        { status: 409 },
      );
    }

    // --------------------------------------------------------
    // Protect organisation chart against accidental empty writes.
    // --------------------------------------------------------

    if (
      scope === "org-chart" &&
      Array.isArray(existing?.nodes) &&
      existing.nodes.length > 0 &&
      (!Array.isArray(incoming?.nodes) ||
        incoming.nodes.length === 0)
    ) {
      return NextResponse.json(
        {
          error:
            "Empty organisation chart write blocked to protect existing data.",
        },
        { status: 409 },
      );
    }

    // --------------------------------------------------------
    // Admin Assistant may edit existing records but cannot
    // create/delete records.
    // --------------------------------------------------------

    if (
      session.role === "Admin Assistant" &&
      existing
    ) {
      const keys =
        scope === "org-chart"
          ? ["nodes"]
          : [
              "entities",
              "ownerships",
              "officers",
              "branches",
              "documents",
            ];

      const same = (key: string) =>
        JSON.stringify(
          (existing[key] || [])
            .map((item: any) => item.id)
            .sort(),
        ) ===
        JSON.stringify(
          (incoming[key] || [])
            .map((item: any) => item.id)
            .sort(),
        );

      if (!keys.every(same)) {
        return NextResponse.json(
          {
            error:
              "This role may edit existing records but cannot create or delete records.",
          },
          { status: 403 },
        );
      }

      if (scope === "registry") {
        incoming.users = existing.users || [];
      }
    }

    const supabase =
      createRequestSupabaseClient(request);

    // --------------------------------------------------------
    // Backup current state before overwriting it.
    // --------------------------------------------------------

    if (existingRow) {
      const { error: backupError } = await supabase
        .from("structura_backups")
        .insert({
          organization_id:
            session.organization_id,
          scope,
          payload: existingRow.payload,
          created_by: session.id,
        });

      if (backupError) {
        throw new Error(backupError.message);
      }
    }

    await trimBackups(
      request,
      session.organization_id,
      scope,
    );

    const updatedAt = new Date().toISOString();

    const { error: stateError } = await supabase
      .from("app_state")
      .upsert(
        {
          organization_id:
            session.organization_id,
          scope,
          payload: incoming,
          updated_by: session.id,
          updated_at: updatedAt,
        },
        {
          onConflict: "organization_id,scope",
        },
      );

    if (stateError) {
      throw new Error(stateError.message);
    }

    return NextResponse.json({
      ok: true,
      updatedAt,
    });
  } catch (error) {
    console.error("State PUT failed:", error);

    return NextResponse.json(
      { error: "Unable to save application state" },
      { status: 500 },
    );
  }
}

// ============================================================
// BACKUP / RESTORE OPERATIONS
// MASTER ADMIN ONLY
// ============================================================

export async function POST(request: NextRequest) {
  const session = await getSession(request);

  if (
    !session ||
    session.role !== "Master Admin"
  ) {
    return NextResponse.json(
      { error: "Full access required" },
      { status: 403 },
    );
  }

  const body = await request.json();

  const supabase =
    createRequestSupabaseClient(request);

  // ==========================================================
  // LIST BACKUPS
  // ==========================================================

  if (body.action === "list-backups") {
    const scope = body.scope || "registry";

    const { data, error } = await supabase
      .from("structura_backups")
      .select(
        "id, payload, created_by, created_at",
      )
      .eq(
        "organization_id",
        session.organization_id,
      )
      .eq("scope", scope)
      .order("created_at", {
        ascending: false,
      })
      .limit(200);

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500 },
      );
    }

    const backups = (data ?? []).map((item) => {
      const payload = item.payload ?? {};

      return {
        id: item.id,
        createdAt: item.created_at,
        createdBy: item.created_by,
        entities:
          payload.entities?.length || 0,
        ownerships:
          payload.ownerships?.length || 0,
        branches:
          payload.branches?.length || 0,
        officers:
          payload.officers?.length || 0,
      };
    });

    return NextResponse.json({
      backups,
    });
  }

  // ==========================================================
  // RESTORE SELECTED VERSION
  // ==========================================================

  if (
    body.action === "restore-version" &&
    body.id
  ) {
    const scope = body.scope || "registry";

    const { data: selected, error } =
      await supabase
        .from("structura_backups")
        .select("payload, created_at")
        .eq("id", body.id)
        .eq(
          "organization_id",
          session.organization_id,
        )
        .eq("scope", scope)
        .maybeSingle();

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500 },
      );
    }

    if (!selected) {
      return NextResponse.json(
        { error: "Backup version not found" },
        { status: 404 },
      );
    }

    const current = await rowFor(
      request,
      session.organization_id,
      scope,
    );

    // Preserve current state before restoring.
    if (current) {
      const { error: backupError } =
        await supabase
          .from("structura_backups")
          .insert({
            organization_id:
              session.organization_id,
            scope,
            payload: current.payload,
            created_by: session.id,
          });

      if (backupError) {
        return NextResponse.json(
          { error: backupError.message },
          { status: 500 },
        );
      }
    }

    const updatedAt =
      new Date().toISOString();

    const { error: restoreError } =
      await supabase
        .from("app_state")
        .upsert(
          {
            organization_id:
              session.organization_id,
            scope,
            payload: selected.payload,
            updated_by: session.id,
            updated_at: updatedAt,
          },
          {
            onConflict:
              "organization_id,scope",
          },
        );

    if (restoreError) {
      return NextResponse.json(
        { error: restoreError.message },
        { status: 500 },
      );
    }

    await trimBackups(
      request,
      session.organization_id,
      scope,
    );

    await logAccess(
      request,
      "Selected backup restored",
      `${scope} · ${selected.created_at}`,
    );

    return NextResponse.json({
      ok: true,
      restoredAt: selected.created_at,
    });
  }

  // ==========================================================
  // RESTORE LATEST
  // ==========================================================

  if (
    body.action === "restore-latest" ||
    body.action ===
      "restore-latest-nonempty"
  ) {
    const scope = body.scope || "registry";

    const { data, error } = await supabase
      .from("structura_backups")
      .select("payload, created_at")
      .eq(
        "organization_id",
        session.organization_id,
      )
      .eq("scope", scope)
      .order("created_at", {
        ascending: false,
      })
      .limit(200);

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500 },
      );
    }

    const backup = (data ?? []).find(
      (item) =>
        body.action !==
          "restore-latest-nonempty" ||
        scope !== "registry" ||
        hasScopeData(item.payload, scope),
    );

    if (!backup) {
      return NextResponse.json(
        { error: "No backup available" },
        { status: 404 },
      );
    }

    const current = await rowFor(
      request,
      session.organization_id,
      scope,
    );

    // Preserve the current state before restoring.
    if (current) {
      const { error: backupError } =
        await supabase
          .from("structura_backups")
          .insert({
            organization_id:
              session.organization_id,
            scope,
            payload: current.payload,
            created_by: session.id,
          });

      if (backupError) {
        return NextResponse.json(
          { error: backupError.message },
          { status: 500 },
        );
      }
    }

    const updatedAt =
      new Date().toISOString();

    const { error: restoreError } =
      await supabase
        .from("app_state")
        .upsert(
          {
            organization_id:
              session.organization_id,
            scope,
            payload: backup.payload,
            updated_by: session.id,
            updated_at: updatedAt,
          },
          {
            onConflict:
              "organization_id,scope",
          },
        );

    if (restoreError) {
      return NextResponse.json(
        { error: restoreError.message },
        { status: 500 },
      );
    }

    await trimBackups(
      request,
      session.organization_id,
      scope,
    );

    await logAccess(
      request,
      "Backup restored",
      `${scope} · ${
        backup.created_at ||
        "latest available"
      }`,
    );

    return NextResponse.json({
      ok: true,
      restoredAt:
        backup.created_at || null,
    });
  }

  return NextResponse.json(
    { error: "Unknown action" },
    { status: 400 },
  );
}