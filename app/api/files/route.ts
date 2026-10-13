import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { getSession } from "../../auth-server";

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

function safeFilename(filename: string) {
  return filename.replace(/[^a-zA-Z0-9._-]/g, "_");
}

/**
 * Upload document
 *
 * Existing Structura behaviour:
 * Master Admin only.
 */
export async function POST(request: NextRequest) {
  const session = await getSession(request);

  if (!session || session.role !== "Master Admin") {
    return NextResponse.json(
      { error: "Full access required" },
      { status: 403 },
    );
  }

  const form = await request.formData();
  const file = form.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "File required" },
      { status: 400 },
    );
  }

  const supabase = createRequestSupabaseClient(request);

  const id = crypto.randomUUID();

  const filename = safeFilename(file.name);

  const key =
    `${session.organization_id}/${id}/${filename}`;

  const { error: uploadError } = await supabase.storage
    .from("structura-documents")
    .upload(key, file, {
      contentType:
        file.type || "application/octet-stream",
      upsert: false,
    });

  if (uploadError) {
    return NextResponse.json(
      { error: uploadError.message },
      { status: 500 },
    );
  }

  const { error: metadataError } = await supabase
    .from("stored_documents")
    .insert({
      id,
      organization_id: session.organization_id,
      uploaded_by: session.id,
      object_key: key,
      filename: file.name,
      content_type:
        file.type || "application/octet-stream",
      size: file.size,
    });

  if (metadataError) {
    // Avoid leaving an orphaned Storage object if metadata fails.
    await supabase.storage
      .from("structura-documents")
      .remove([key]);

    return NextResponse.json(
      { error: metadataError.message },
      { status: 500 },
    );
  }

  return NextResponse.json({
    id,
    key,
    filename: file.name,
    size: file.size,
  });
}

/**
 * Download document
 *
 * Existing Structura behaviour:
 * Any authenticated member of the organization may download.
 */
export async function GET(request: NextRequest) {
  const session = await getSession(request);

  if (!session) {
    return NextResponse.json(
      { error: "Access denied" },
      { status: 403 },
    );
  }

  const id = request.nextUrl.searchParams.get("id");

  if (!id) {
    return NextResponse.json(
      { error: "ID required" },
      { status: 400 },
    );
  }

  const supabase = createRequestSupabaseClient(request);

  const { data: row, error: metadataError } =
    await supabase
      .from("stored_documents")
      .select(
        "object_key, filename, content_type, organization_id",
      )
      .eq("id", id)
      .eq(
        "organization_id",
        session.organization_id,
      )
      .maybeSingle();

  if (metadataError) {
    return NextResponse.json(
      { error: metadataError.message },
      { status: 500 },
    );
  }

  if (!row) {
    return NextResponse.json(
      { error: "Not found" },
      { status: 404 },
    );
  }

  const { data: object, error: downloadError } =
    await supabase.storage
      .from("structura-documents")
      .download(row.object_key);

  if (downloadError || !object) {
    return NextResponse.json(
      { error: "File missing" },
      { status: 404 },
    );
  }

  return new Response(object, {
    headers: {
      "content-type":
        row.content_type ||
        "application/octet-stream",

      "content-disposition":
        `attachment; filename="${row.filename.replace(/"/g, "")}"`,
    },
  });
}