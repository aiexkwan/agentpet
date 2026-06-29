import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { verifySession, SESSION_COOKIE } from "../../lib/auth";
import { getDB, ensureSchema } from "../../lib/db";

export const prerender = false;

const v = (n: string): string => {
  try { const e = (env as any)?.[n]; if (e) return String(e); } catch {}
  return (import.meta as any).env?.[n] ?? "";
};
const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

async function me(cookies: any) {
  const token = cookies.get(SESSION_COOKIE)?.value || "";
  return token ? await verifySession(token, v("SESSION_SECRET")) : null;
}

// GET: the signed-in user's recent notifications + unread count (nav bell).
export const GET: APIRoute = async ({ cookies }) => {
  const user = await me(cookies);
  if (!user) return json({ items: [], unread: 0 });
  const db = getDB();
  if (!db) return json({ items: [], unread: 0 });
  await ensureSchema(db);

  const rows: any = await db
    .prepare("SELECT id, type, title, body, link, read, created_at FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 30")
    .bind(user.id).all();
  const u: any = await db.prepare("SELECT COUNT(*) AS c FROM notifications WHERE user_id=? AND read=0").bind(user.id).first();
  return json({ items: rows?.results ?? [], unread: u?.c ?? 0 });
};

// POST: mark notifications read. Body { id } marks one; no body marks all.
export const POST: APIRoute = async ({ cookies, request }) => {
  const user = await me(cookies);
  if (!user) return json({ error: "auth" }, 401);
  const db = getDB();
  if (!db) return json({ error: "no-db" }, 503);
  await ensureSchema(db);

  let id = "";
  try { const b: any = await request.json(); id = String(b?.id || ""); } catch {}
  if (id) {
    await db.prepare("UPDATE notifications SET read=1 WHERE user_id=? AND id=?").bind(user.id, id).run();
  } else {
    await db.prepare("UPDATE notifications SET read=1 WHERE user_id=? AND read=0").bind(user.id).run();
  }
  return json({ ok: true });
};
