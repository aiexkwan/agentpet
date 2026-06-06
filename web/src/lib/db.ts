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
  ]);
  ready = true;
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
