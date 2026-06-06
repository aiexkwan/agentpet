import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { verifySession, SESSION_COOKIE } from "../../lib/auth";
import { getDB, ensureSchema, upsertUser } from "../../lib/db";

export const prerender = false;

const v = (n: string): string => {
  try { const e = (env as any)?.[n]; if (e) return String(e); } catch {}
  return (import.meta as any).env?.[n] ?? "";
};
const SLUG = /^[a-z0-9][a-z0-9._-]{0,80}$/i;
const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

// Toggle the signed-in user's like for a pet, return the fresh count + liked state.
export const POST: APIRoute = async ({ request, cookies }) => {
  const token = cookies.get(SESSION_COOKIE)?.value || "";
  const user = token ? await verifySession(token, v("SESSION_SECRET")) : null;
  if (!user) return json({ error: "auth" }, 401);

  let slug = "";
  try {
    const body: any = await request.json();
    slug = String(body?.slug || "");
  } catch {}
  if (!SLUG.test(slug)) return json({ error: "bad-slug" }, 400);

  const db = getDB();
  if (!db) return json({ error: "no-db" }, 503);
  await ensureSchema(db);
  await upsertUser(db, { id: user.id, login: user.login, avatar: user.avatar });

  const existing = await db.prepare("SELECT 1 FROM pet_likes WHERE slug=? AND user_id=?").bind(slug, user.id).first();
  let liked: boolean;
  if (existing) {
    await db.prepare("DELETE FROM pet_likes WHERE slug=? AND user_id=?").bind(slug, user.id).run();
    liked = false;
  } else {
    await db.prepare("INSERT INTO pet_likes (slug, user_id, created_at) VALUES (?, ?, ?)").bind(slug, user.id, Date.now()).run();
    liked = true;
  }
  const row: any = await db.prepare("SELECT COUNT(*) AS c FROM pet_likes WHERE slug=?").bind(slug).first();
  const count = row?.c ?? 0;
  // Keep the running total in pet_stats so the public counts query stays cheap.
  await db
    .prepare("INSERT INTO pet_stats (slug, likes) VALUES (?, ?) ON CONFLICT(slug) DO UPDATE SET likes = excluded.likes")
    .bind(slug, count)
    .run();
  return json({ likes: count, liked });
};
