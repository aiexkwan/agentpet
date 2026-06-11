// Pulls the public pet catalog (same CDN the macOS app + web use). Open, no auth.

const MANIFEST = "https://pets.thenightwatcher.online/manifest.json";

export interface Pet {
  slug: string;
  name: string;
  spritesheetUrl: string;
  petJsonUrl?: string;
  kind: string;
}

export async function loadCatalog(): Promise<Pet[]> {
  try {
    const r = await fetch(MANIFEST);
    const j: any = await r.json();
    return (j.pets ?? []).map((p: any) => ({
      slug: p.slug,
      name: p.displayName ?? p.slug,
      spritesheetUrl: p.spritesheetUrl,
      petJsonUrl: p.petJsonUrl,
      kind: p.kind ?? "creature",
    }));
  } catch {
    return [];
  }
}

const KEY = "agentpet.petSlug";

export function savedSlug(): string | null {
  try { return localStorage.getItem(KEY); } catch { return null; }
}
export function saveSlug(slug: string) {
  try { localStorage.setItem(KEY, slug); } catch {}
}
