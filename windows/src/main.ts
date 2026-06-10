import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Pet } from "./pet";
import { SessionStore } from "./state";
import { loadCatalog, savedSlug, saveSlug } from "./catalog";
import { t, setLang, type Lang } from "./i18n";

const canvas = document.getElementById("pet") as HTMLCanvasElement;
const bubble = document.getElementById("bubble") as HTMLDivElement;
const pet = new Pet(canvas);
const store = new SessionStore();

const IDLE_LINES = [
  "Let's grill some bugs.",
  "Tiny commit, tiny dopamine.",
  "The build is quiet. Too quiet.",
  "Ship something small.",
];
const STATE_LABEL: Record<string, string> = {
  working: "Working", waiting: "Needs you", done: "Done", registered: "Ready", idle: "Idle",
};

// --- pick + load a pet sprite -------------------------------------------------
(async () => {
  const pets = await loadCatalog();
  if (!pets.length) return;
  const slug = savedSlug();
  const chosen = pets.find((p) => p.slug === slug) ?? pets[Math.floor(pets.length / 2)];
  saveSlug(chosen.slug);
  pet.load(chosen.spritesheetUrl);
})();

// --- render loop for state + bubble ------------------------------------------
function render() {
  const top = store.active()[0];
  const state = top?.state ?? "idle";
  pet.setState(state);

  if (top && state !== "idle") {
    const label = t(STATE_LABEL[state] ?? "");
    const msg = top.message || label;
    const proj = top.project ? top.project.split(/[\\/]/).pop() : "";
    bubble.innerHTML =
      `<span class="agent">${esc(top.agent)}</span>${proj ? " · " + esc(proj) : ""} ` +
      `${esc(msg)}<span class="state">${esc(label)}</span>`;
    bubble.hidden = false;
  } else {
    bubble.hidden = true;
  }
}
setInterval(render, 500);

function esc(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] || c));
}

// --- agent events from the Rust listener -------------------------------------
listen<any>("agent-event", (e) => { store.update(e.payload); render(); });
listen<string>("agent-end", (e) => { store.remove(e.payload); render(); });
// Pet changed from the Settings window.
listen<{ slug: string; url: string }>("set-pet", (e) => {
  pet.load(e.payload.url);
  saveSlug(e.payload.slug);
});
// Language changed from Settings , re-render the bubble in the new language.
listen<Lang>("lang-changed", (e) => { setLang(e.payload); render(); });

// --- interactions ------------------------------------------------------------
// Drag the pet to reposition it. Settings/Quit live in the tray menu (the
// overlay is frameless, and starting an OS drag here would swallow clicks).
canvas.addEventListener("mousedown", async (e) => {
  if (e.button === 0) await getCurrentWindow().startDragging();
});

// Occasional idle chatter.
setInterval(() => {
  if (store.topState() === "idle") {
    bubble.textContent = t(IDLE_LINES[Math.floor(Date.now() / 1000) % IDLE_LINES.length]);
    bubble.hidden = false;
    setTimeout(() => { if (store.topState() === "idle") bubble.hidden = true; }, 4000);
  }
}, 30000);
