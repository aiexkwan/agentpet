import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { verifySession, SESSION_COOKIE } from "../../lib/auth";
import { getDB, ensureSchema } from "../../lib/db";
import { petsBase } from "../../lib/pets";

export const prerender = false;

const v = (n: string): string => {
  try { const e = (env as any)?.[n]; if (e) return String(e); } catch {}
  return (import.meta as any).env?.[n] ?? "";
};

// The signed-in user's own submissions + their review status, for the
// "Your submissions" panel on /submit.
export const GET: APIRoute = async ({ cookies }) => {
  const token = cookies.get(SESSION_COOKIE)?.value || "";
  const user = token ? await verifySession(token, v("SESSION_SECRET")) : null;
  if (!user) return new Response(JSON.stringify({ submissions: [] }), { status: 200, headers: { "content-type": "application/json" } });

  const db = getDB();
  if (!db) return new Response(JSON.stringify({ submissions: [] }), { status: 200, headers: { "content-type": "application/json" } });
  await ensureSchema(db);
  const base = petsBase();

  const rows: any = await db
    .prepare("SELECT id, slug, name, kind, status, created_at, reviewed_at, sheet_ext FROM submissions WHERE user_id=? ORDER BY created_at DESC LIMIT 50")
    .bind(user.id)
    .all();

  const submissions = (rows?.results ?? []).map((s: any) => ({
    id: s.id, slug: s.slug, name: s.name, kind: s.kind, status: s.status,
    created_at: s.created_at, reviewed_at: s.reviewed_at,
    previewUrl: `${base}/submissions/${s.id}.${s.sheet_ext}`,
  }));

  return new Response(JSON.stringify({ submissions }), {
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
};
