import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { verifySession, SESSION_COOKIE } from "../../../lib/auth";
import { getDB, ensureSchema } from "../../../lib/db";

export const prerender = false;

const v = (n: string): string => {
  try { const e = (env as any)?.[n]; if (e) return String(e); } catch {}
  return (import.meta as any).env?.[n] ?? "";
};
const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

// Lets a user delete their OWN submission. Approved (live) pets are unpublished:
// hidden from the gallery + their published files removed. Pending/rejected just
// drop the pending upload. Either way the submission row is removed.
export const POST: APIRoute = async ({ cookies, request }) => {
  const token = cookies.get(SESSION_COOKIE)?.value || "";
  const user = token ? await verifySession(token, v("SESSION_SECRET")) : null;
  if (!user) return json({ error: "auth" }, 401);

  let id = "";
  try { const b: any = await request.json(); id = String(b?.id || ""); } catch {}
  if (!id) return json({ error: "bad request" }, 400);

  const db = getDB();
  if (!db) return json({ error: "no-db" }, 503);
  await ensureSchema(db);

  const sub: any = await db.prepare("SELECT id, slug, status, sheet_ext, user_id FROM submissions WHERE id=?").bind(id).first();
  if (!sub) return json({ error: "not found" }, 404);
  if (sub.user_id !== user.id) return json({ error: "forbidden" }, 403);

  const bucket = (env as any).PETS;
  if (sub.status === "approved") {
    // Hide from the gallery and remove the published files.
    await db.prepare("INSERT INTO pet_overrides (slug, hidden, updated_at) VALUES (?,1,?) ON CONFLICT(slug) DO UPDATE SET hidden=1, updated_at=excluded.updated_at")
      .bind(sub.slug, Date.now()).run();
    if (bucket) {
      try { await bucket.delete(`pets/${sub.slug}/spritesheet.${sub.sheet_ext}`); } catch {}
      try { await bucket.delete(`pets/${sub.slug}/pet.json`); } catch {}
    }
  } else if (bucket) {
    try { await bucket.delete(`submissions/${sub.id}.${sub.sheet_ext}`); } catch {}
  }

  await db.prepare("DELETE FROM submissions WHERE id=? AND user_id=?").bind(id, user.id).run();
  return json({ ok: true });
};
