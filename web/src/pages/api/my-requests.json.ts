import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { verifySession, SESSION_COOKIE } from "../../lib/auth";
import { getDB, ensureSchema } from "../../lib/db";

export const prerender = false;

const v = (n: string): string => {
  try { const e = (env as any)?.[n]; if (e) return String(e); } catch {}
  return (import.meta as any).env?.[n] ?? "";
};

// The signed-in user's own pet requests, for the "Your requests" panel on /submit.
export const GET: APIRoute = async ({ cookies }) => {
  const token = cookies.get(SESSION_COOKIE)?.value || "";
  const user = token ? await verifySession(token, v("SESSION_SECRET")) : null;
  if (!user) return new Response(JSON.stringify({ requests: [] }), { status: 200, headers: { "content-type": "application/json" } });

  const db = getDB();
  if (!db) return new Response(JSON.stringify({ requests: [] }), { status: 200, headers: { "content-type": "application/json" } });
  await ensureSchema(db);

  const rows: any = await db
    .prepare(`SELECT r.id, r.title, r.status, r.created_at,
                (SELECT COUNT(*) FROM request_votes v WHERE v.request_id = r.id) AS votes
              FROM pet_requests r WHERE r.user_id=? ORDER BY r.created_at DESC LIMIT 50`)
    .bind(user.id).all();

  return new Response(JSON.stringify({ requests: rows?.results ?? [] }), {
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
};
