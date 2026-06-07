import { env } from "cloudflare:workers";

// D1 access. Binding `DB` comes from wrangler.jsonc (local in dev via platformProxy,
// real database in prod). Returns null if the binding isn't available.
export function getDB(): any {
  try {
    return (env as any)?.DB ?? null;
  } catch {
    return null;
  }
}

let ready = false;

// Idempotent schema bootstrap, avoids a separate migration step in dev. Cheap and
// safe to call before each query (cached per isolate after the first run).
// `pet_stats` keeps a running like count per pet so the public counts query reads
// one small row per liked pet instead of scanning the whole pet_likes table.
export async function ensureSchema(db: any): Promise<void> {
  if (ready || !db) return;
  await db.batch([
    db.prepare(
      "CREATE TABLE IF NOT EXISTS pet_likes (slug TEXT NOT NULL, user_id INTEGER NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (slug, user_id))"
    ),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_pet_likes_user ON pet_likes (user_id)"),
    db.prepare("CREATE TABLE IF NOT EXISTS pet_stats (slug TEXT PRIMARY KEY, likes INTEGER NOT NULL DEFAULT 0)"),
    db.prepare("CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, login TEXT, avatar TEXT, updated_at INTEGER NOT NULL DEFAULT 0)"),
    db.prepare("CREATE TABLE IF NOT EXISTS pet_overrides (slug TEXT PRIMARY KEY, kind TEXT, hidden INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL DEFAULT 0)"),
    db.prepare("CREATE TABLE IF NOT EXISTS pet_installs (slug TEXT PRIMARY KEY, count INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL DEFAULT 0)"),
  ]);
  ready = true;
}

// Bump a pet's install counter (the desktop app pings this on a successful install).
// Returns the new total.
export async function incrementInstall(db: any, slug: string): Promise<number> {
  if (!db) return 0;
  await db
    .prepare("INSERT INTO pet_installs (slug, count, updated_at) VALUES (?, 1, ?) ON CONFLICT(slug) DO UPDATE SET count=count+1, updated_at=excluded.updated_at")
    .bind(slug, Date.now())
    .run();
  const r: any = await db.prepare("SELECT count FROM pet_installs WHERE slug=?").bind(slug).first();
  return r?.count ?? 0;
}

// All admin overrides as a map (small table: only edited/hidden pets have rows).
export async function getOverrides(db: any): Promise<Record<string, { kind?: string; hidden?: boolean }>> {
  if (!db) return {};
  const r: any = await db.prepare("SELECT slug, kind, hidden FROM pet_overrides").all();
  const map: Record<string, { kind?: string; hidden?: boolean }> = {};
  for (const row of r?.results ?? []) map[row.slug] = { kind: row.kind || undefined, hidden: !!row.hidden };
  return map;
}

// Upsert an override, merging with the existing row so a partial patch (kind OR
// hidden) leaves the other field untouched.
export async function patchOverride(db: any, slug: string, patch: { kind?: string; hidden?: boolean }): Promise<{ kind: string | null; hidden: boolean }> {
  const cur: any = await db.prepare("SELECT kind, hidden FROM pet_overrides WHERE slug=?").bind(slug).first();
  const kind = patch.kind !== undefined ? (patch.kind || null) : (cur?.kind ?? null);
  const hidden = patch.hidden !== undefined ? (patch.hidden ? 1 : 0) : (cur?.hidden ?? 0);
  await db
    .prepare("INSERT INTO pet_overrides (slug, kind, hidden, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(slug) DO UPDATE SET kind=excluded.kind, hidden=excluded.hidden, updated_at=excluded.updated_at")
    .bind(slug, kind, hidden, Date.now())
    .run();
  return { kind, hidden: !!hidden };
}

// Upsert the signed-in user's public profile so leaderboards can show login + avatar.
export async function upsertUser(db: any, u: { id: number; login: string; avatar: string }): Promise<void> {
  if (!db) return;
  await db
    .prepare(
      "INSERT INTO users (id, login, avatar, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET login=excluded.login, avatar=excluded.avatar, updated_at=excluded.updated_at"
    )
    .bind(u.id, u.login, u.avatar, Date.now())
    .run();
}
