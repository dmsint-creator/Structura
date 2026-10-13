import { NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

export type StructuraRole =
  | "Master Admin"
  | "Admin Assistant"
  | "Viewer";

export type StructuraSession = {
  id: string;
  name: string;
  email: string;
  role: StructuraRole;
  status: string;
  must_change: boolean;
  organization_id: string;
};

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
        // Session cookie writes are handled by the auth route.
      },
    },
  });
}

export async function getSession(
  request: NextRequest,
): Promise<StructuraSession | null> {
  const supabase = createRequestSupabaseClient(request);

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) return null;

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("name, status, must_change_password")
    .eq("id", user.id)
    .single();

  if (profileError || !profile || profile.status !== "Active") {
    return null;
  }

  const { data: membership, error: membershipError } = await supabase
    .from("organization_members")
    .select("organization_id, role, status")
    .eq("user_id", user.id)
    .eq("status", "Active")
    .limit(1)
    .single();

  if (membershipError || !membership) {
    return null;
  }

  return {
    id: user.id,
    name: profile.name,
    email: user.email ?? "",
    role: membership.role as StructuraRole,
    status: profile.status,
    must_change: profile.must_change_password,
    organization_id: membership.organization_id,
  };
}

export async function logAccess(
  request: NextRequest,
  action: string,
  detail = "",
) {
  const session = await getSession(request);

  if (!session) return;

  const supabase = createRequestSupabaseClient(request);

  const { error } = await supabase
    .from("structura_access_log")
    .insert({
      organization_id: session.organization_id,
      user_id: session.id,
      user_email: session.email,
      action,
      detail,
    });

  if (error) {
    console.error("Failed to write Structura access log:", error.message);
  }
}

export function randomPassword(length = 14) {
  const alphabet =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";

  const bytes = crypto.getRandomValues(new Uint8Array(length));

  return Array.from(
    bytes,
    (byte) => alphabet[byte % alphabet.length],
  ).join("");
}