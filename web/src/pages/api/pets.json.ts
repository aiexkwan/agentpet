import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";

export const prerender = false;

// Full pet list (slug + name) for the gallery, proxied so the origin stays hidden.
export const GET: APIRoute = async () => {
  const base = (env as any).PETS_ORIGIN || import.meta.env.PETS_ORIGIN || "";
  if (!base) return new Response(JSON.stringify({ pets: [] }), { status: 500 });
  try {
    const m: any = await (await fetch(`${base}/manifest.json`)).json();
    const pets = (m.pets ?? []).map((p: any) => ({ slug: p.slug, name: p.displayName ?? p.slug }));
    return new Response(JSON.stringify({ pets }), { headers: { "content-type": "application/json", "cache-control": "public, max-age=300" } });
  } catch {
    return new Response(JSON.stringify({ pets: [] }), { status: 502 });
  }
};
