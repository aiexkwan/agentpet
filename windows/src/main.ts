import { listen, emit } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Pet } from "./pet";
import { SessionStore, aggregateMood, basename, type AgentEventPayload } from "./state";
import { BubbleRenderer } from "./bubble";
import { loadCatalog, savedSlug, saveSlug } from "./catalog";
import { t, setLang, type Lang } from "./i18n";
import { bubbleLines, PET_CHAT } from "./activity";
import { sendNotification, isPermissionGranted, requestPermission } from "@tauri-apps/plugin-notification";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

// Auto-update on launch (no-op offline / when no signed release is published).
(async () => {
  try {
    const update = await check();
    if (update) {
      await update.downloadAndInstall();
      await relaunch();
    }
  } catch {}
})();

const canvas = document.getElementById("pet") as HTMLCanvasElement;
const bubbleEl = document.getElementById("bubble") as HTMLDivElement;
const pet = new Pet(canvas);
const store = new SessionStore();
const bubble = new BubbleRenderer(bubbleEl);

// --- bubble appearance (theme / opacity / fonts) ------------------------------
const FONT_FAMILIES: Record<string, string> = {
  system: '"Segoe UI", system-ui, sans-serif',
  rounded: '"Segoe UI Rounded", "Nunito", "Segoe UI", sans-serif',
  mono: 'Consolas, "Courier New", monospace',
};

function applyBubble() {
  let theme = localStorage.getItem("ap_theme") || "dark";
  if (theme === "system") theme = matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  const op = (parseInt(localStorage.getItem("ap_opacity") || "92", 10) || 92) / 100;
  const r = document.documentElement.style;
  if (theme === "light") {
    r.setProperty("--bubble-bg", `rgba(255,255,255,${op})`);
    r.setProperty("--bubble-fg", "#1a1d2e");
    r.setProperty("--bubble-border", "rgba(0,0,0,0.08)");
  } else {
    r.setProperty("--bubble-bg", `rgba(22,24,38,${op})`);
    r.setProperty("--bubble-fg", "#ffffff");
    r.setProperty("--bubble-border", "rgba(255,255,255,0.10)");
  }
  r.setProperty("--bubble-font-size", `${parseInt(localStorage.getItem("ap_font_size") || "12", 10) || 12}px`);
  r.setProperty("--bubble-font-family", FONT_FAMILIES[localStorage.getItem("ap_font_family") || "system"] ?? FONT_FAMILIES.system);
}
applyBubble();

// Pet size + idle bob FX. Sized via layout (not transform) so the bubble
// always sits above the sprite instead of being painted over by it.
function applyPet() {
  const size = (parseInt(localStorage.getItem("ap_pet_size") || "100", 10) || 100) / 100;
  canvas.style.width = `${Math.round(160 * size)}px`;
  canvas.style.height = `${Math.round(180 * size)}px`;
  canvas.classList.toggle("bob", localStorage.getItem("ap_fx") === "1");
}
applyPet();

// Simple synthesized chimes (no audio assets needed). Per-event enable, like
// the macOS SoundSettings (done = high glass-ish, waiting = lower submarine).
let audioCtx: AudioContext | null = null;
function chime(event: "done" | "waiting") {
  const key = event === "done" ? "ap_sound_done" : "ap_sound_waiting";
  const legacy = localStorage.getItem("ap_sound"); // pre-split toggle
  const enabled = localStorage.getItem(key) ?? (legacy === "0" ? "0" : "1");
  if (enabled === "0") return;
  // Custom uploaded sound wins (mac SoundSettings custom file).
  const data = localStorage.getItem(`ap_sound_${event}_data`);
  if (data) {
    try { void new Audio(data).play(); return; } catch {}
  }
  try {
    audioCtx = audioCtx || new AudioContext();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = "sine";
    o.frequency.value = event === "done" ? 880 : 560;
    g.gain.value = 0.05;
    o.connect(g);
    g.connect(audioCtx.destination);
    o.start();
    o.stop(audioCtx.currentTime + 0.13);
  } catch {}
}

// --- pick + load a pet sprite -------------------------------------------------
(async () => {
  const custom = localStorage.getItem("ap_pet_custom");
  if (custom) { pet.load(custom); return; } // user's own spritesheet
  // Keep retrying , the app may have launched before the network was up.
  for (;;) {
    const pets = await loadCatalog();
    if (pets.length) {
      const slug = savedSlug();
      const chosen = pets.find((p) => p.slug === slug) ?? pets[Math.floor(pets.length / 2)];
      saveSlug(chosen.slug);
      pet.load(chosen.spritesheetUrl);
      return;
    }
    await new Promise((r) => setTimeout(r, 15000));
  }
})();

// --- mood + render loop --------------------------------------------------------
// Port of PetController: aggregate mood, 3s celebrate burst on entering done,
// a persistent idle line (re-picked on mood transitions, not blinking), and
// the structured multi-agent bubble while agents are active.
let lastResolved = "idle";
let celebrateUntil = 0;
let wasCelebrating = false;
let prevSimpleMood = "";
let moodLine = ""; // the single-bubble line for idle/done/celebrate

function pickMoodLine(mood: string) {
  // Custom/system pools; working/waiting fall back to the PetChat lines so the
  // simple-bubble mode (multi-agent off) always has something to say.
  let pool = bubbleLines(null, mood);
  if (!pool.length) pool = PET_CHAT[mood] ?? [];
  moodLine = pool.length ? pool[Math.floor(Math.random() * pool.length)] : "";
}

function render() {
  const sessions = store.active();
  const resolved = aggregateMood(sessions);

  if (resolved === "done" && lastResolved !== "done") {
    celebrateUntil = Date.now() + 3000; // celebrate burst, like macOS
    pickMoodLine("celebrate");
  }
  if (resolved !== lastResolved && Date.now() >= celebrateUntil) {
    if (resolved === "idle") pickMoodLine("idle");
    else if (resolved === "done") pickMoodLine("done");
  }
  lastResolved = resolved;

  const celebrating = Date.now() < celebrateUntil;
  if (wasCelebrating && !celebrating) {
    // The 3s burst ended , settle into the actual mood's line (mac
    // settleAfterCelebrate re-picks on the celebrate→done transition).
    pickMoodLine(resolved === "idle" ? "idle" : "done");
  }
  wasCelebrating = celebrating;
  const mood = celebrating ? "celebrate" : resolved;
  pet.setState(mood);

  const multi = localStorage.getItem("ap_multi") !== "0";
  if ((mood === "working" || mood === "waiting") && !multi) {
    // Simple-bubble mode (mac: multi-agent off) , one plain chat line.
    if (resolved !== prevSimpleMood) { pickMoodLine(mood); prevSimpleMood = resolved; }
    if (!moodLine) pickMoodLine(mood);
    bubble.renderLine(moodLine);
  } else if (mood === "working" || mood === "waiting") {
    bubble.render(sessions.filter((s) => s.state !== "idle" && s.state !== "registered"));
  } else if (mood === "celebrate") {
    bubble.renderLine(moodLine || t("Done"));
  } else if (mood === "done") {
    if (!moodLine) pickMoodLine("done");
    bubble.renderLine(moodLine);
  } else {
    // idle: a persistent quiet line (mac shows it continuously, no blinking)
    if (localStorage.getItem("ap_idle") !== "0") {
      if (!moodLine) pickMoodLine("idle");
      bubble.renderLine(moodLine);
    } else {
      bubble.hide();
    }
  }

  snugBubble();
  reportTrayStatus(sessions);
}
setInterval(render, 500);
// Carousel advance / fold clicks request a prompt repaint.
setInterval(() => { if (bubble.dirty) { bubble.dirty = false; render(); } }, 120);
// Live elapsed clocks tick every second.
setInterval(() => bubble.tickClocks(), 1000);

// Pull the bubble down over the canvas's empty headroom so it sits right
// above the pet's head (the sprite rarely fills the whole canvas height).
function snugBubble() {
  const gap = Math.max(0, canvas.clientHeight * pet.headroom - 4);
  bubbleEl.style.transform = `translateY(${gap}px)`;
}

// Tray tooltip mirrors the macOS menu bar count (N working / N waiting).
let lastTray = "";
function reportTrayStatus(sessions: ReturnType<SessionStore["active"]>) {
  const working = sessions.filter((s) => s.state === "working").length;
  const waiting = sessions.filter((s) => s.state === "waiting").length;
  const sig = `${working}/${waiting}`;
  if (sig === lastTray) return;
  lastTray = sig;
  invoke("set_tray_status", { working, waiting }).catch(() => {});
}

// --- notifications ------------------------------------------------------------
let notifyReady = false;
(async () => {
  try { notifyReady = (await isPermissionGranted()) || (await requestPermission()) === "granted"; } catch {}
})();
const lastState = new Map<string, string>();
function maybeNotify(e: AgentEventPayload) {
  const key = `${e.agent}:${e.session}`;
  const prev = lastState.get(key);
  lastState.set(key, e.state);
  if (e.state === prev) return;
  if (e.state !== "done" && e.state !== "waiting") return;
  chime(e.state === "done" ? "done" : "waiting");
  if (!notifyReady || localStorage.getItem("ap_notify") === "0") return;
  const proj = (e.project ? basename(e.project) : "") || e.agent;
  // Same copy as the macOS notifications.
  const title = e.state === "done" ? `${proj} ${t("finished")}` : `${proj} ${t("needs input")}`;
  const body = e.state === "done"
    ? t("Agent completed its turn")
    : (e.message || t("Waiting for you"));
  try { sendNotification({ title, body }); } catch {}
}

// --- agent events from the Rust listener -------------------------------------
listen<AgentEventPayload>("agent-event", (e) => {
  maybeNotify(e.payload);
  store.update(e.payload);
  render();
});
listen<string>("agent-end", (e) => {
  for (const k of [...lastState.keys()]) if (k.endsWith(`:${e.payload}`)) lastState.delete(k);
  store.remove(e.payload);
  render();
});
// Settings window: dismiss one session / clear all (mac popover actions).
listen<string>("session-dismiss", (e) => { store.removeKey(e.payload); render(); });
listen("sessions-clear", () => { store.clear(); render(); });
// A freshly opened Settings window asks for the current sessions.
listen("sessions-request", () => {
  for (const s of store.snapshot()) emit("session-snapshot", s);
});
// Pet changed from the Settings window.
listen<{ slug: string; url: string }>("set-pet", (e) => {
  pet.load(e.payload.url);
  saveSlug(e.payload.slug);
});
// Language changed from Settings , re-render the bubble in the new language.
listen<Lang>("lang-changed", (e) => { setLang(e.payload); render(); });
// Bubble theme / opacity / messages changed from Settings.
listen("bubble-changed", () => { applyBubble(); applyPet(); moodLine = ""; render(); });

// --- interactions ------------------------------------------------------------
// Drag the pet to reposition it. Right-click opens Settings (mac: popover).
canvas.addEventListener("mousedown", async (e) => {
  if (e.button === 0) await getCurrentWindow().startDragging();
});
canvas.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  invoke("open_settings").catch(() => {});
});

// Report the pet's opaque rect (physical px) so the rest of the transparent
// window is click-through. ResizeObserver fires whenever the bubble grows/hides
// or the pet is rescaled, keeping the interactive region tight.
const petRoot = document.getElementById("pet-root") as HTMLElement;
function reportHitRect() {
  const r = petRoot.getBoundingClientRect();
  const d = window.devicePixelRatio || 1;
  invoke("set_hit_rect", { x: r.left * d, y: r.top * d, w: r.width * d, h: r.height * d }).catch(() => {});
}
new ResizeObserver(reportHitRect).observe(petRoot);
window.addEventListener("resize", reportHitRect);
reportHitRect();

render();
