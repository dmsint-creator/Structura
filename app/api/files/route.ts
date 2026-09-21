import { env } from "cloudflare:workers";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "../../auth-server";
export async function POST(request: NextRequest) {
  if ((await getSession(request))?.role !== "Master Admin")
    return NextResponse.json(
      { error: "Full access required" },
      { status: 403 },
    );
  const form = await request.formData(),
    file = form.get("file");
  if (!(file instanceof File))
    return NextResponse.json({ error: "File required" }, { status: 400 });
  const id = crypto.randomUUID(),
    key = `structura-group/${id}/${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  await (env as any).BUCKET.put(key, file.stream(), {
    httpMetadata: { contentType: file.type || "application/octet-stream" },
  });
  await (env as any).DB.prepare(
    "INSERT INTO stored_documents (id, user_id, object_key, filename, content_type, size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(
      id,
      "structura-group",
      key,
      file.name,
      file.type || "application/octet-stream",
      String(file.size),
      new Date().toISOString(),
    )
    .run();
  return NextResponse.json({ id, key, filename: file.name, size: file.size });
}
export async function GET(request: NextRequest) {
  if (!(await getSession(request)))
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "ID required" }, { status: 400 });
  const row = await (env as any).DB.prepare(
    "SELECT object_key, filename, content_type FROM stored_documents WHERE id = ?",
  )
    .bind(id)
    .first();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const object = await (env as any).BUCKET.get(row.object_key);
  if (!object)
    return NextResponse.json({ error: "File missing" }, { status: 404 });
  return new Response(object.body, {
    headers: {
      "content-type": row.content_type,
      "content-disposition": `attachment; filename="${row.filename}"`,
    },
  });
}
