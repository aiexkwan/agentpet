import type { APIRoute } from "astro";
import { adminUser } from "../../../lib/admin";
import { getDB, ensureSchema } from "../../../lib/db";

export const prerender = false;

// Admin-only dashboard counters: how many people connected the app, how much
// they've raised, plus the submission queue and community totals.
export const GET: APIRoute = async ({ cookies }) => {
  const user = await adminUser(cookies);
  if (!user) return new Response(JSON.stringify({ error: "forbidden" }), { status: 403 });

  const db = getDB();
  if (!db) return new Response(JSON.stringify({}), { status: 200 });
  await ensureSchema(db);

  const one = async (sql: string): Promise<number> => {
    try { const r: any = await db.prepare(sql).first(); return Number(r?.n ?? 0); } catch { return 0; }
  };

  const [
    connectedUsers, devices, raisedPets, ownersWithPets, totalTokens, totalSessions,
    activeToday, totalLikes, requests, subPending, subApproved, subRejected,
  ] = await Promise.all([
    one("SELECT COUNT(DISTINCT user_id) n FROM care_devices"),
    one("SELECT COUNT(*) n FROM care_devices"),
    one("SELECT COUNT(*) n FROM care_pets"),
    one("SELECT COUNT(DISTINCT user_id) n FROM care_pets"),
    one("SELECT COALESCE(SUM(tokens),0) n FROM care_pets"),
    one("SELECT COALESCE(SUM(meals),0) n FROM care_pets"),
    one(`SELECT COUNT(DISTINCT user_id) n FROM care_pets WHERE updated_at > ${Date.now() - 86_400_000}`),
    one("SELECT COALESCE(SUM(likes),0) n FROM pet_stats"),
    one("SELECT COUNT(*) n FROM pet_requests"),
    one("SELECT COUNT(*) n FROM submissions WHERE status='pending'"),
    one("SELECT COUNT(*) n FROM submissions WHERE status='approved'"),
    one("SELECT COUNT(*) n FROM submissions WHERE status='rejected'"),
  ]);

  return new Response(JSON.stringify({
    connectedUsers, devices, raisedPets, ownersWithPets, totalTokens, totalSessions,
    activeToday, totalLikes, requests,
    submissions: { pending: subPending, approved: subApproved, rejected: subRejected },
  }), { headers: { "content-type": "application/json", "cache-control": "no-store" } });
};
