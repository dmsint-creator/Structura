import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import {
  getSession,
  logAccess,
  randomPassword,
  type StructuraRole,
} from "../../auth-server";
import { createSupabaseAdminClient } from "../../../lib/supabase/admin";

function createRequestClient(
  request: NextRequest,
  response: NextResponse,
) {
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

      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });
}

function validRole(role: unknown): role is StructuraRole {
  return (
    role === "Master Admin" ||
    role === "Admin Assistant" ||
    role === "Viewer"
  );
}

// ============================================================
// GET
// ============================================================

export async function GET(request: NextRequest) {
  const action =
    request.nextUrl.searchParams.get("action") || "me";

  // ----------------------------------------------------------
  // Current user
  // ----------------------------------------------------------

  if (action === "me") {
    const session = await getSession(request);

    if (!session) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 },
      );
    }

    return NextResponse.json({
      user: {
        id: session.id,
        name: session.name,
        email: session.email,
        role: session.role,
        accountType: session.account_type,
        mustChange: session.must_change,
      },
    });
  }

  // ----------------------------------------------------------
  // Access logs
  // ----------------------------------------------------------

  if (action === "logs") {
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

    const response = NextResponse.json({
      logs: [],
    });

    const supabase = createRequestClient(
      request,
      response,
    );

    const { data, error } = await supabase
      .from("structura_access_log")
      .select(
        "id, user_email, action, detail, created_at",
      )
      .eq(
        "organization_id",
        session.organization_id,
      )
      .order("created_at", {
        ascending: false,
      })
      .limit(100);

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500 },
      );
    }

    return NextResponse.json({
      logs: (data ?? []).map((row) => ({
        id: row.id,
        email: row.user_email,
        action: row.action,
        detail: row.detail,
        createdAt: row.created_at,
      })),
    });
  }

  return NextResponse.json(
    { error: "Unknown action" },
    { status: 400 },
  );
}

// ============================================================
// POST
// ============================================================

export async function POST(request: NextRequest) {
  const body = await request.json();

  // ==========================================================
  // REGISTER NEW ORGANISATION
  // ==========================================================

  if (body.action === "register") {
    const organizationName =
      typeof body.organizationName === "string"
        ? body.organizationName.trim()
        : "";

    const name =
      typeof body.name === "string"
        ? body.name.trim()
        : "";

    const email =
      typeof body.email === "string"
        ? body.email.trim().toLowerCase()
        : "";

    const password =
      typeof body.password === "string"
        ? body.password
        : "";

    if (!organizationName || !name || !email || !password) {
      return NextResponse.json(
        {
          error:
            "Organisation name, full name, email and password are required",
        },
        { status: 400 },
      );
    }

    if (password.length < 10) {
      return NextResponse.json(
        {
          error:
            "Password must contain at least 10 characters",
        },
        { status: 400 },
      );
    }

    const admin = createSupabaseAdminClient();

    // --------------------------------------------------------
    // Create Supabase Auth user.
    // --------------------------------------------------------

    const {
      data: created,
      error: createError,
    } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (createError || !created.user) {
      return NextResponse.json(
        {
          error:
            createError?.message ||
            "Unable to create account",
        },
        { status: 400 },
      );
    }

    const userId = created.user.id;

    try {
      // ------------------------------------------------------
      // Create organisation.
      // Use a unique internal slug so duplicate company names
      // do not collide.
      // ------------------------------------------------------

      const baseSlug =
        organizationName
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "")
          .slice(0, 50) || "organisation";

      const slug =
        `${baseSlug}-${crypto.randomUUID().slice(0, 8)}`;

      const {
        data: organization,
        error: organizationError,
      } = await admin
        .from("organizations")
        .insert({
          name: organizationName,
          slug,
          status: "Active",
        })
        .select("id")
        .single();

      if (organizationError || !organization) {
        throw new Error(
          organizationError?.message ||
            "Unable to create organisation",
        );
      }

      const organizationId = organization.id;

      // ------------------------------------------------------
      // Create Structura profile.
      // ------------------------------------------------------

      const { error: profileError } =
        await admin
          .from("profiles")
          .insert({
            id: userId,
            name,
            status: "Active",
            account_type: "client",
            must_change_password: false,
          });

      if (profileError) {
        await admin
          .from("organizations")
          .delete()
          .eq("id", organizationId);

        throw new Error(profileError.message);
      }

      // ------------------------------------------------------
      // First registered user becomes Master Admin of the
      // organisation they just created.
      // ------------------------------------------------------

      const { error: membershipError } =
        await admin
          .from("organization_members")
          .insert({
            organization_id: organizationId,
            user_id: userId,
            role: "Master Admin",
            status: "Active",
          });

      if (membershipError) {
        await admin
          .from("profiles")
          .delete()
          .eq("id", userId);

        await admin
          .from("organizations")
          .delete()
          .eq("id", organizationId);

        throw new Error(membershipError.message);
      }

      return NextResponse.json(
        {
          ok: true,
          message:
            "Organisation account created successfully. You can now sign in.",
        },
        { status: 201 },
      );
    } catch (error) {
      // Remove the Auth user if tenant provisioning failed.
      await admin.auth.admin.deleteUser(userId);

      console.error(
        "Structura registration failed:",
        error,
      );

      return NextResponse.json(
        {
          error:
            "Unable to complete organisation registration",
        },
        { status: 500 },
      );
    }
  }


  // ==========================================================
  // LOGIN
  // ==========================================================

  if (body.action === "login") {
    const email =
      typeof body.email === "string"
        ? body.email.trim().toLowerCase()
        : "";

    const password =
      typeof body.password === "string"
        ? body.password
        : "";

    if (!email || !password) {
      return NextResponse.json(
        { error: "Email and password required" },
        { status: 400 },
      );
    }
    /*
     * IMPORTANT:
     * Create the actual response FIRST.
     *
     * Supabase writes the auth cookies directly onto this
     * response. Returning this same response avoids losing
     * Set-Cookie headers.
     */
    const response = NextResponse.json({
      ok: true,
    });

    const supabase = createRequestClient(
      request,
      response,
    );

    const {
      data: authData,
      error: authError,
    } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (authError || !authData.user) {
      return NextResponse.json(
        {
          error:
            authError?.message ||
            "Invalid email or password",
        },
        { status: 401 },
      );
    }

    const user = authData.user;

    const {
      data: profile,
      error: profileError,
    } = await supabase
      .from("profiles")
      .select(
        "name, status, must_change_password, account_type",
      )
      .eq("id", user.id)
      .single();

    if (profileError) {
  console.error("LOGIN PROFILE ERROR:", {
    message: profileError.message,
    code: profileError.code,
    details: profileError.details,
    hint: profileError.hint,
    authenticatedUserId: user.id,
  });

  return NextResponse.json(
    {
      error: "Unable to load account profile",
      
    },
    { status: 500 },
  );
}

if (!profile) {
  console.error("LOGIN PROFILE NOT FOUND:", {
    authenticatedUserId: user.id,
  });

  return NextResponse.json(
    { error: "Account profile not found" },
    { status: 403 },
  );
}

if (profile.status !== "Active") {
  console.error("LOGIN PROFILE INACTIVE:", {
    authenticatedUserId: user.id,
    status: profile.status,
  });

  return NextResponse.json(
    { error: "Account is not active" },
    { status: 403 },
  );
}

    const {
      data: membership,
      error: membershipError,
    } = await supabase
      .from("organization_members")
      .select(
        "organization_id, role, status",
      )
      .eq("user_id", user.id)
      .eq("status", "Active")
      .limit(1)
      .single();

    if (
      membershipError ||
      !membership ||
      membership.status !== "Active"
    ) {
      await supabase.auth.signOut();

      return NextResponse.json(
        {
          error:
            "No active organisation membership found",
        },
        { status: 403 },
      );
    }

    await supabase
      .from("structura_access_log")
      .insert({
        organization_id:
          membership.organization_id,
        user_id: user.id,
        user_email: user.email ?? email,
        action: "Login",
        detail: "",
      });

    /*
     * Modify the same response object that already contains
     * the Supabase Set-Cookie headers.
     */
    const payload = {
      id: user.id,
      name: profile.name,
      email: user.email ?? email,
      role: membership.role,
      accountType:
        profile.account_type === "admin" ? "admin" : "client",
      mustChange:
        profile.must_change_password,
    };

    response.headers.set(
      "content-type",
      "application/json",
    );

    /*
     * NextResponse's body cannot be reassigned after creation,
     * so create the final response and copy ALL cookies.
     */
    const finalResponse = NextResponse.json({
      ok: true,
      user: payload,
    });

    response.cookies.getAll().forEach((cookie) => {
      finalResponse.cookies.set(cookie);
    });

    return finalResponse;
  }

  // ==========================================================
  // LOGOUT
  // ==========================================================

  if (body.action === "logout") {
    const session = await getSession(request);

    if (session) {
      await logAccess(
        request,
        "Logout",
      );
    }

    const response = NextResponse.json({
      ok: true,
    });

    const supabase = createRequestClient(
      request,
      response,
    );

    await supabase.auth.signOut();

    return response;
  }

  // ==========================================================
  // CHANGE PASSWORD
  // ==========================================================

  if (body.action === "change-password") {
    const session = await getSession(request);

    if (!session) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 },
      );
    }

    const password =
      typeof body.password === "string"
        ? body.password
        : "";

    if (password.length < 10) {
      return NextResponse.json(
        {
          error:
            "Password must contain at least 10 characters",
        },
        { status: 400 },
      );
    }

    const response = NextResponse.json({
      ok: true,
    });

    const supabase = createRequestClient(
      request,
      response,
    );

    const { error: passwordError } =
      await supabase.auth.updateUser({
        password,
      });

    if (passwordError) {
      return NextResponse.json(
        { error: passwordError.message },
        { status: 400 },
      );
    }

    const { error: profileError } =
      await supabase
        .from("profiles")
        .update({
          must_change_password: false,
          updated_at:
            new Date().toISOString(),
        })
        .eq("id", session.id);

    if (profileError) {
      return NextResponse.json(
        { error: profileError.message },
        { status: 500 },
      );
    }

    await logAccess(
      request,
      "Password changed",
    );

    return response;
  }

  // ==========================================================
  // MASTER ADMIN ACTIONS
  // ==========================================================

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

  const admin = createSupabaseAdminClient();

  // ==========================================================
  // CREATE USER
  // ==========================================================

  if (body.action === "create-user") {
    const name =
      typeof body.name === "string"
        ? body.name.trim()
        : "";

    const email =
      typeof body.email === "string"
        ? body.email.trim().toLowerCase()
        : "";

    const role = body.role;

    if (!name || !email || !validRole(role)) {
      return NextResponse.json(
        {
          error:
            "Name, email and valid role required",
        },
        { status: 400 },
      );
    }

    const tempPassword = randomPassword();

    const {
      data: created,
      error: createError,
    } = await admin.auth.admin.createUser({
      email,
      password: tempPassword,
      email_confirm: true,
    });

    if (createError || !created.user) {
      return NextResponse.json(
        {
          error:
            createError?.message ||
            "Unable to create user",
        },
        { status: 400 },
      );
    }

    const userId = created.user.id;

    const { error: profileError } =
      await admin
        .from("profiles")
        .insert({
          id: userId,
          name,
          status: "Active",
          must_change_password: true,
        });

    if (profileError) {
      await admin.auth.admin.deleteUser(userId);

      return NextResponse.json(
        { error: profileError.message },
        { status: 500 },
      );
    }

    const { error: membershipError } =
      await admin
        .from("organization_members")
        .insert({
          organization_id:
            session.organization_id,
          user_id: userId,
          role,
          status: "Active",
        });

    if (membershipError) {
      await admin
        .from("profiles")
        .delete()
        .eq("id", userId);

      await admin.auth.admin.deleteUser(userId);

      return NextResponse.json(
        { error: membershipError.message },
        { status: 500 },
      );
    }

    await logAccess(
      request,
      "User created",
      `${email} · ${role}`,
    );

    return NextResponse.json({
      ok: true,
      id: userId,
      tempPassword,
    });
  }

  // ==========================================================
  // UPDATE USER
  // ==========================================================

  if (body.action === "update-user") {
    const id =
      typeof body.id === "string"
        ? body.id
        : "";

    const name =
      typeof body.name === "string"
        ? body.name.trim()
        : "";

    const email =
      typeof body.email === "string"
        ? body.email.trim().toLowerCase()
        : "";

    const role = body.role;

    const status =
      typeof body.status === "string"
        ? body.status
        : "";

    if (
      !id ||
      !name ||
      !email ||
      !validRole(role) ||
      ![
        "Active",
        "Suspended",
        "Inactive",
      ].includes(status)
    ) {
      return NextResponse.json(
        { error: "Invalid user details" },
        { status: 400 },
      );
    }

    /*
     * Explicit tenant check is mandatory because the admin
     * client bypasses RLS.
     */
    const {
      data: targetMembership,
      error: targetError,
    } = await admin
      .from("organization_members")
      .select("organization_id")
      .eq(
        "organization_id",
        session.organization_id,
      )
      .eq("user_id", id)
      .maybeSingle();

    if (targetError) {
      return NextResponse.json(
        { error: targetError.message },
        { status: 500 },
      );
    }

    if (!targetMembership) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404 },
      );
    }

    const { error: authUpdateError } =
      await admin.auth.admin.updateUserById(
        id,
        {
          email,
        },
      );

    if (authUpdateError) {
      return NextResponse.json(
        { error: authUpdateError.message },
        { status: 400 },
      );
    }

    const { error: profileError } =
      await admin
        .from("profiles")
        .update({
          name,
          status,
          updated_at:
            new Date().toISOString(),
        })
        .eq("id", id);

    if (profileError) {
      return NextResponse.json(
        { error: profileError.message },
        { status: 500 },
      );
    }

    const { error: membershipError } =
      await admin
        .from("organization_members")
        .update({
          role,
          status,
          updated_at:
            new Date().toISOString(),
        })
        .eq(
          "organization_id",
          session.organization_id,
        )
        .eq("user_id", id);

    if (membershipError) {
      return NextResponse.json(
        { error: membershipError.message },
        { status: 500 },
      );
    }

    await logAccess(
      request,
      "User updated",
      `${email} · ${role} · ${status}`,
    );

    return NextResponse.json({
      ok: true,
    });
  }

  // ==========================================================
  // RESET PASSWORD
  // ==========================================================

  if (body.action === "reset-password") {
    const id =
      typeof body.id === "string"
        ? body.id
        : "";

    if (!id) {
      return NextResponse.json(
        { error: "User ID required" },
        { status: 400 },
      );
    }

    /*
     * Explicit tenant check before using the admin client.
     */
    const {
      data: targetMembership,
      error: targetError,
    } = await admin
      .from("organization_members")
      .select("organization_id")
      .eq(
        "organization_id",
        session.organization_id,
      )
      .eq("user_id", id)
      .maybeSingle();

    if (targetError) {
      return NextResponse.json(
        { error: targetError.message },
        { status: 500 },
      );
    }

    if (!targetMembership) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404 },
      );
    }

    const tempPassword = randomPassword();

    const { error: passwordError } =
      await admin.auth.admin.updateUserById(
        id,
        {
          password: tempPassword,
        },
      );

    if (passwordError) {
      return NextResponse.json(
        { error: passwordError.message },
        { status: 400 },
      );
    }

    const { error: profileError } =
      await admin
        .from("profiles")
        .update({
          must_change_password: true,
          updated_at:
            new Date().toISOString(),
        })
        .eq("id", id);

    if (profileError) {
      return NextResponse.json(
        { error: profileError.message },
        { status: 500 },
      );
    }

    await logAccess(
      request,
      "Password reset",
      id,
    );

    return NextResponse.json({
      ok: true,
      tempPassword,
    });
  }

  return NextResponse.json(
    { error: "Unknown action" },
    { status: 400 },
  );
}