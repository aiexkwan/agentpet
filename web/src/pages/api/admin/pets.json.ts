import type { APIRoute } from "astro";
import { adminUser } from "../../../lib/admin";
import { loadManifest, applyOverrides } from "../../../lib/pets";
import { getDB, ensureSchema, getOverrides } from "../../../lib/db";

export const prerender = false;

// Admin-only: the full pet list INCLUDING hidden ones, with effective kind + hidden
// flag, so the admin can edit categories and restore hidden pets.
export const GET: APIRoute = async ({ cookies }) => {
  const user = await adminUser(cookies);
  if (!user) return new Response(JSON.stringify({ error: "forbidden" }), { status: 403 });

  const manifest = await loadManifest();
  let ovr = {};
  const db = getDB();
  if (db) { await ensureSchema(db); ovr = await getOverrides(db); }
  const pets = applyOverrides(manifest, ovr, true).map((p) => ({
    slug: p.slug, name: p.name, kind: p.kind, source: p.source, submittedBy: p.submittedBy, hidden: p.hidden,
  }));
  return new Response(JSON.stringify({ pets }), { headers: { "content-type": "application/json", "cache-control": "no-store" } });
};
