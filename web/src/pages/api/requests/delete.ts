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

// Lets a user delete their OWN pet request (and its votes).
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

  const row: any = await db.prepare("SELECT user_id FROM pet_requests WHERE id=?").bind(id).first();
  if (!row) return json({ error: "not found" }, 404);
  if (row.user_id !== user.id) return json({ error: "forbidden" }, 403);

  await db.prepare("DELETE FROM request_votes WHERE request_id=?").bind(id).run();
  await db.prepare("DELETE FROM pet_requests WHERE id=? AND user_id=?").bind(id, user.id).run();
  return json({ ok: true });
};
