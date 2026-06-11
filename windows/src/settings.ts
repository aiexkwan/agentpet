import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { getVersion } from "@tauri-apps/api/app";
import { exit } from "@tauri-apps/plugin-process";
import { enable, disable, isEnabled } from "@tauri-apps/plugin-autostart";
import { loadCatalog, savedSlug, saveSlug, type Pet } from "./catalog";
import { t, getLang, setLang, type Lang } from "./i18n";
import { SessionStore, basename, type AgentEventPayload, type Session } from "./state";
import { agentIconUrl } from "./icons";
import { LAYOUT_PRESETS, readBubbleConfig, elapsedString, type TokenItem, type BubbleToken } from "./bubble";
import { initDemo } from "./demo";

// ------------------------------------------------------------- segmented ----
// macOS-style segmented controls: <span class="seg" data-key data-default>.
function initSegs() {
  document.querySelectorAll<HTMLElement>(".seg[data-key]").forEach((seg) => {
    const key = seg.dataset.key!;
    const current = localStorage.getItem(key) || seg.dataset.default || "";
    const btns = seg.querySelectorAll<HTMLButtonElement>("button");
    btns.forEach((b) => {
      b.classList.toggle("sel", b.dataset.v === current);
      b.onclick = () => {
        localStorage.setItem(key, b.dataset.v!);
        btns.forEach((x) => x.classList.toggle("sel", x === b));
        emit("bubble-changed", null);
        document.dispatchEvent(new CustomEvent("seg-changed", { detail: key }));
      };
    });
  });
}

// ------------------------------------------------------------------ tabs ----
function initTabs() {
  const tabs = document.querySelectorAll<HTMLButtonElement>(".tabbar .tab");
  tabs.forEach((b) => {
    b.onclick = () => {
      tabs.forEach((x) => x.classList.toggle("sel", x === b));
      document.querySelectorAll<HTMLElement>(".page").forEach((p) => {
        p.classList.toggle("sel", p.dataset.page === b.dataset.tab);
      });
    };
  });
}

// ---------------------------------------------------------------- agents ----
interface AgentInfo {
  kind: string;
  display_name: string;
  installed: boolean;
  note: string | null;
}

const agentsRoot = document.getElementById("agents")!;
let agentsCache: AgentInfo[] = [];

async function loadAgents() {
  agentsCache = await invoke<AgentInfo[]>("list_agents");
  renderAgents();
}

function renderAgents() {
  agentsRoot.innerHTML = "";
  for (const a of agentsCache) {
    const row = document.createElement("div");
    row.className = "agent-row";

    const meta = document.createElement("div");
    meta.className = "meta";
    // Codex needs a one-time trust after install (mac shows it in orange).
    const status = a.kind === "codex" && a.installed
      ? `<div class="note warn">${esc(t("Installed , needs a one-time trust (tap ?)"))}</div>`
      : a.note
      ? `<div class="note">${esc(t(a.note))}</div>`
      : a.installed
      ? `<div class="ok">${esc(t("Hook installed"))}</div>`
      : "";
    meta.innerHTML = `<div class="name">${esc(a.display_name)}</div>${status}`;
    row.appendChild(meta);

    if (a.kind === "codex") {
      const help = document.createElement("button");
      help.className = "help-btn";
      help.textContent = "?";
      help.title = t("How to connect Codex");
      help.onclick = () => { (document.getElementById("codex-help") as HTMLElement).hidden = false; };
      row.appendChild(help);
    }

    const btn = document.createElement("button");
    btn.textContent = a.installed ? t("Remove") : t("Install");
    if (a.installed) btn.classList.add("remove");
    btn.onclick = async () => {
      btn.disabled = true;
      try { await invoke("toggle_install", { kind: a.kind }); } catch (e) { alert(String(e)); }
      await loadAgents();
    };
    row.appendChild(btn);
    agentsRoot.appendChild(row);
  }
}

// ------------------------------------------------------------- sessions ----
// Live agent list (the macOS menu bar popover's Agents section): dot, project,
// activity, live elapsed, hover ✕ to dismiss, Clear all.
const sessionStore = new SessionStore();

function initSessions() {
  const list = document.getElementById("sessions-list")!;
  const empty = document.getElementById("sessions-empty")!;
  const clearRow = document.getElementById("sessions-clear-row")!;
  (document.getElementById("sessions-clear") as HTMLButtonElement).onclick = () => {
    sessionStore.clear();
    emit("sessions-clear", null);
    paint();
  };

  function paint() {
    const sessions = sessionStore.active().filter((s) => s.state !== "idle" && s.state !== "registered");
    empty.style.display = sessions.length ? "none" : "";
    clearRow.style.display = sessions.length ? "" : "none";
    list.innerHTML = "";
    for (const s of sessions) {
      const row = document.createElement("div");
      row.className = "sess-row";
      row.dataset.state = s.state;
      const icon = agentIconUrl(s.agent);
      row.innerHTML =
        `<span class="sess-dot"></span>` +
        (icon ? `<img class="sess-icon" src="${icon}" alt="">` : "") +
        `<span class="sess-meta"><span class="sess-name">${esc(s.project ? basename(s.project) : s.session)}</span>` +
        `<span class="sess-sub">${esc(s.title || s.live || t(s.state.charAt(0).toUpperCase() + s.state.slice(1)))}</span></span>` +
        `<span class="sess-time" data-since="${s.stateSince}">${elapsedString(s.stateSince)}</span>`;
      const x = document.createElement("button");
      x.className = "sess-x";
      x.textContent = "✕";
      x.title = t("Dismiss");
      x.onclick = () => {
        const key = `${s.agent}:${s.session}`;
        sessionStore.removeKey(key);
        emit("session-dismiss", key);
        paint();
      };
      row.appendChild(x);
      list.appendChild(row);
    }
  }

  listen<AgentEventPayload>("agent-event", (e) => { sessionStore.update(e.payload); paint(); });
  listen<string>("agent-end", (e) => { sessionStore.remove(e.payload); paint(); });
  // Catch up on sessions that started before this window opened.
  listen<Session>("session-snapshot", (e) => { sessionStore.seed(e.payload); paint(); });
  emit("sessions-request", null);
  setInterval(() => {
    paint();
    list.querySelectorAll<HTMLElement>(".sess-time[data-since]").forEach((el) => {
      el.textContent = elapsedString(Number(el.dataset.since));
    });
  }, 2000);
  paint();
}

// ------------------------------------------------------------------ pet ----
const current = document.getElementById("pet-current") as HTMLDivElement;
const search = document.getElementById("pet-search") as HTMLInputElement;
const random = document.getElementById("pet-random") as HTMLButtonElement;
const results = document.getElementById("pet-results") as HTMLDivElement;

let catalog: Pet[] = [];
let currentPet: Pet | undefined;

async function pick(p: Pet) {
  saveSlug(p.slug);
  localStorage.removeItem("ap_pet_custom"); // back to a catalog pet
  await emit("set-pet", { slug: p.slug, url: p.spritesheetUrl });
  currentPet = p;
  showCurrent();
  results.querySelectorAll(".pet-item.sel").forEach((el) => el.classList.remove("sel"));
  results.querySelector(`.pet-item[data-slug="${CSS.escape(p.slug)}"]`)?.classList.add("sel");
}

function showCurrent() {
  if (!catalog.length) { current.textContent = t("Couldn't load pets , check your internet connection."); return; }
  current.textContent = localStorage.getItem("ap_pet_custom")
    ? (localStorage.getItem("ap_pet_custom_name") || t("(your image)"))
    : currentPet ? currentPet.name : t("(default)");
  const hero = document.getElementById("hero-thumb") as HTMLCanvasElement;
  const url = localStorage.getItem("ap_pet_custom") || currentPet?.spritesheetUrl;
  if (url) drawThumb(hero, url);
  loadHeroDescription();
}

// The pet's own description (from its pet.json on the CDN), like the macOS
// hero card; falls back to the generic caption.
async function loadHeroDescription() {
  const el = document.getElementById("hero-desc");
  if (!el) return;
  const jsonUrl = !localStorage.getItem("ap_pet_custom") && currentPet?.petJsonUrl;
  if (!jsonUrl) { el.textContent = t("Pick the companion that floats on your desktop."); return; }
  try {
    const j: any = await (await fetch(jsonUrl)).json();
    const desc = (j.description || j.about || "").toString().trim();
    el.textContent = desc || t("Pick the companion that floats on your desktop.");
  } catch {
    el.textContent = t("Pick the companion that floats on your desktop.");
  }
}

// Pet pager , 8 pets per page (4 × 2) with ‹ › nav, like the macOS PetPager.
// Dots when few pages (e.g. a narrowed search), a counter otherwise.
const PER_PAGE = 8;
let view: Pet[] = [];
let page = 0;

const pgPrev = document.getElementById("pg-prev") as HTMLButtonElement;
const pgNext = document.getElementById("pg-next") as HTMLButtonElement;
const pgInd = document.getElementById("pg-ind") as HTMLElement;

function setView(list: Pet[]) {
  view = list;
  page = 0;
  renderPage();
}

function renderPage() {
  const totalPages = Math.max(1, Math.ceil(view.length / PER_PAGE));
  if (page >= totalPages) page = totalPages - 1;
  results.innerHTML = "";
  for (const p of view.slice(page * PER_PAGE, page * PER_PAGE + PER_PAGE)) {
    const item = document.createElement("button");
    item.className = "pet-item";
    item.dataset.slug = p.slug;
    if (p.slug === savedSlug()) item.classList.add("sel");
    const cv = document.createElement("canvas");
    cv.width = 48; cv.height = 48; cv.className = "pet-thumb";
    drawThumb(cv, p.spritesheetUrl);
    const label = document.createElement("span");
    label.textContent = p.name;
    item.appendChild(cv);
    item.appendChild(label);
    item.onclick = () => pick(p);
    results.appendChild(item);
  }
  pgPrev.disabled = page === 0;
  pgNext.disabled = page >= totalPages - 1;
  pgInd.innerHTML = "";
  if (totalPages <= 8) {
    for (let i = 0; i < totalPages; i++) {
      const d = document.createElement("span");
      d.className = "pg-dot" + (i === page ? " sel" : "");
      d.onclick = () => { page = i; renderPage(); };
      pgInd.appendChild(d);
    }
  } else {
    pgInd.textContent = `${page + 1} / ${totalPages}`;
  }
}
pgPrev.onclick = () => { if (page > 0) { page--; renderPage(); } };
pgNext.onclick = () => { page++; renderPage(); };

// Draws frame 0 (first column of the Idle row) of an 8x9 spritesheet as a preview.
function drawThumb(cv: HTMLCanvasElement, url: string) {
  const ctx = cv.getContext("2d");
  if (!ctx) return;
  ctx.imageSmoothingEnabled = false;
  const img = new Image();
  img.onload = () => {
    const fw = img.naturalWidth / 8, fh = img.naturalHeight / 9;
    if (!fw || !fh) return;
    const s = Math.min(cv.width / fw, cv.height / fh);
    const dw = fw * s, dh = fh * s;
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.drawImage(img, 0, 0, fw, fh, (cv.width - dw) / 2, (cv.height - dh) / 2, dw, dh);
  };
  img.src = url;
}

async function initPet() {
  // Keep retrying , the app may have launched before the network was up.
  for (;;) {
    catalog = await loadCatalog();
    if (catalog.length) break;
    showCurrent(); // "couldn't load" hint while we wait
    await new Promise((r) => setTimeout(r, 15000));
  }
  currentPet = catalog.find((p) => p.slug === savedSlug());
  showCurrent();
  setView(catalog);
  search.addEventListener("input", () => {
    const q = search.value.trim().toLowerCase();
    setView(q ? catalog.filter((p) => p.name.toLowerCase().includes(q)) : catalog);
  });
  random.addEventListener("click", () => {
    if (catalog.length) pick(catalog[Math.floor(Math.random() * catalog.length)]);
  });
}

// ---------------------------------------------------------------- bubble ----
const MSG_STATES: [string, string][] = [
  ["working", "Working"], ["waiting", "Needs you"], ["done", "Done"],
  ["celebrate", "Celebrate"], ["idle", "Idle"],
];
const MSG_AGENTS: [string, string][] = [
  ["all", "All agents"], ["claude", "Claude Code"], ["codex", "Codex"], ["gemini", "Gemini CLI"],
  ["cursor", "Cursor"], ["opencode", "opencode"], ["windsurf", "Windsurf"],
  ["antigravity", "Antigravity"], ["kiro", "Kiro CLI"], ["copilot", "GitHub Copilot"],
];

function initBubble() {
  const changed = () => { emit("bubble-changed", null); };
  const opacity = document.getElementById("opacity") as HTMLInputElement;
  const fontFamily = document.getElementById("font-family") as HTMLSelectElement;
  const msgAgent = document.getElementById("msg-agent") as HTMLSelectElement;
  const editors = document.getElementById("msg-editors")!;

  opacity.value = localStorage.getItem("ap_opacity") || "92";
  fontFamily.value = localStorage.getItem("ap_font_family") || "system";

  opacity.oninput = () => { localStorage.setItem("ap_opacity", opacity.value); changed(); };
  fontFamily.onchange = () => { localStorage.setItem("ap_font_family", fontFamily.value); changed(); };

  // Multi-agent bubble master toggle (mac BubbleSettings.multiAgentBubbleEnabled).
  const multi = document.getElementById("multi") as HTMLInputElement;
  multi.checked = localStorage.getItem("ap_multi") !== "0";
  multi.onchange = () => { localStorage.setItem("ap_multi", multi.checked ? "1" : "0"); changed(); };

  msgAgent.innerHTML = "";
  for (const [k, name] of MSG_AGENTS) {
    const o = document.createElement("option");
    o.value = k;
    o.textContent = k === "all" ? t("All agents") : name; // brand names stay
    msgAgent.appendChild(o);
  }

  const build = (agent: string) => {
    editors.innerHTML = "";
    for (const [st, label] of MSG_STATES) {
      const wrap = document.createElement("div");
      wrap.className = "msg-editor";
      const lbl = document.createElement("div");
      lbl.className = "msg-label";
      lbl.dataset.label = label;
      lbl.textContent = t(label) + (st === "working" ? ` ${t("(blank = live activity)")}` : "");
      const ta = document.createElement("textarea");
      const key = `ap_msg_${agent}_${st}`;
      ta.value = localStorage.getItem(key) || "";
      ta.addEventListener("input", () => { localStorage.setItem(key, ta.value); changed(); });
      wrap.appendChild(lbl);
      wrap.appendChild(ta);
      editors.appendChild(wrap);
    }
  };
  msgAgent.onchange = () => build(msgAgent.value);
  build("all");

  // System/custom source + reset, like the macOS BubbleMessages.
  const src = document.getElementById("msg-src") as HTMLSelectElement;
  const customWrap = document.getElementById("msg-custom-wrap") as HTMLElement;
  const syncSrc = () => { customWrap.style.display = src.value === "custom" ? "" : "none"; };
  src.value = localStorage.getItem("ap_msg_src") || "system";
  syncSrc();
  src.onchange = () => { localStorage.setItem("ap_msg_src", src.value); syncSrc(); changed(); };
  (document.getElementById("msg-reset") as HTMLButtonElement).onclick = () => {
    for (const [st] of MSG_STATES) localStorage.removeItem(`ap_msg_${msgAgent.value}_${st}`);
    build(msgAgent.value);
    changed();
  };

  const phrases = document.getElementById("phrases") as HTMLSelectElement;
  const savedTheme = localStorage.getItem("ap_theme_phrases") || "chef";
  phrases.value = savedTheme === "off" ? "chef" : savedTheme; // pre-port "off" → chef
  phrases.onchange = () => { localStorage.setItem("ap_theme_phrases", phrases.value); changed(); };

  const idle = document.getElementById("idle") as HTMLInputElement;
  idle.checked = localStorage.getItem("ap_idle") !== "0";
  idle.onchange = () => { localStorage.setItem("ap_idle", idle.checked ? "1" : "0"); changed(); };
}

// -------------------------------------------------- bubble display + layout ----
function initBubbleDisplay() {
  const changed = () => { emit("bubble-changed", null); };
  const bind = (id: string, key: string, dflt: string) => {
    const el = document.getElementById(id) as HTMLSelectElement;
    el.value = localStorage.getItem(key) || dflt;
    el.onchange = () => { localStorage.setItem(key, el.value); changed(); paintPreview(); };
  };
  bind("bub-filter", "ap_bub_filter", "all");
  // Segmented controls (mode/grouping/sep/dot) save via initSegs; repaint the
  // preview row when one changes.
  document.addEventListener("seg-changed", () => paintPreview());

  const max = document.getElementById("bub-max") as HTMLInputElement;
  max.value = localStorage.getItem("ap_bub_max") || "5";
  max.oninput = () => { localStorage.setItem("ap_bub_max", max.value); changed(); };

  // Visible agents (hiddenKinds).
  const visRoot = document.getElementById("bub-visible")!;
  const hidden = new Set<string>(JSON.parse(localStorage.getItem("ap_bub_hidden") || "[]"));
  for (const [kind, name] of MSG_AGENTS.slice(1)) {
    const row = document.createElement("label");
    row.className = "row";
    const span = document.createElement("span");
    span.textContent = name;
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = !hidden.has(kind);
    box.onchange = () => {
      if (box.checked) hidden.delete(kind); else hidden.add(kind);
      localStorage.setItem("ap_bub_hidden", JSON.stringify([...hidden]));
      changed();
    };
    row.appendChild(span);
    row.appendChild(box);
    visRoot.appendChild(row);
  }

  // Row content: token toggles in order + presets + live preview.
  const tokensRoot = document.getElementById("bub-tokens")!;
  const readTokens = (): TokenItem[] => readBubbleConfig().tokens;
  const saveTokens = (tokens: TokenItem[]) => {
    localStorage.setItem("ap_bub_tokens", JSON.stringify(tokens));
    changed();
    paintTokens();
    paintPreview();
  };
  const TOKEN_NAMES: Record<BubbleToken, string> = {
    dot: "State dot", icon: "Agent icon", title: "Chat title", project: "Project folder",
    separator: "Separator", message: "Activity message", stateLabel: "State label", elapsed: "Elapsed time",
  };
  function paintTokens() {
    tokensRoot.innerHTML = "";
    for (const item of readTokens()) {
      const chip = document.createElement("button");
      chip.className = "tok-chip" + (item.isVisible ? " on" : "");
      chip.textContent = t(TOKEN_NAMES[item.token]);
      chip.onclick = () => {
        const tokens = readTokens().map((x) =>
          x.token === item.token ? { ...x, isVisible: !x.isVisible } : x);
        saveTokens(tokens);
      };
      tokensRoot.appendChild(chip);
    }
  }
  document.querySelectorAll<HTMLButtonElement>(".preset-btns button").forEach((b) => {
    b.onclick = () => saveTokens(LAYOUT_PRESETS[b.dataset.preset!]);
  });

  // Mock preview row (mac BubbleRowPreview).
  const preview = document.getElementById("bub-preview")!;
  function paintPreview() {
    const cfg = readBubbleConfig();
    preview.innerHTML = "";
    const row = document.createElement("div");
    row.className = "pv-row";
    for (const item of cfg.tokens) {
      if (!item.isVisible) continue;
      switch (item.token) {
        case "dot": { const d = document.createElement("span"); d.className = "pv-dot"; row.appendChild(d); break; }
        case "icon": {
          const img = document.createElement("img");
          img.className = "aicon"; img.src = agentIconUrl("claude") || ""; row.appendChild(img); break;
        }
        case "title": { const s = document.createElement("span"); s.className = "pv-strong"; s.textContent = "Fix login bug"; row.appendChild(s); break; }
        case "project": { const s = document.createElement("span"); s.className = "pv-strong"; s.textContent = "agentpet"; row.appendChild(s); break; }
        case "separator": { const s = document.createElement("span"); s.className = "pv-dim"; s.textContent = cfg.separator; row.appendChild(s); break; }
        case "message": { const s = document.createElement("span"); s.textContent = "Editing SettingsModel.swift"; row.appendChild(s); break; }
        case "stateLabel": { const s = document.createElement("span"); s.className = "pv-dim"; s.textContent = t("Working"); row.appendChild(s); break; }
        case "elapsed": { const s = document.createElement("span"); s.className = "pv-dim"; s.textContent = "3m"; row.appendChild(s); break; }
      }
    }
    if (!row.childElementCount) { row.textContent = t("(empty)"); row.classList.add("pv-dim"); }
    preview.appendChild(row);
  }

  paintTokens();
  paintPreview();
}

// ----------------------------------------------- pet size / fx / import ----
function initPetControls() {
  const changed = () => { emit("bubble-changed", null); };
  const size = document.getElementById("pet-size") as HTMLInputElement;
  size.value = localStorage.getItem("ap_pet_size") || "100";
  size.oninput = () => { localStorage.setItem("ap_pet_size", size.value); changed(); };
  document.querySelectorAll<HTMLButtonElement>(".size-presets button").forEach((b) => {
    b.onclick = () => {
      size.value = b.dataset.size!;
      localStorage.setItem("ap_pet_size", size.value);
      size.dispatchEvent(new Event("input"));
      changed();
    };
  });

  const fx = document.getElementById("fx") as HTMLInputElement;
  fx.checked = localStorage.getItem("ap_fx") === "1"; // mac default: pet stands still
  fx.onchange = () => { localStorage.setItem("ap_fx", fx.checked ? "1" : "0"); changed(); };

  // Import a local spritesheet (stored as a data URL , no extra plugins).
  const btn = document.getElementById("import-pet") as HTMLButtonElement;
  const file = document.createElement("input");
  file.type = "file";
  file.accept = "image/png,image/webp,image/*";
  file.style.display = "none";
  document.body.appendChild(file);
  btn.onclick = () => file.click();
  file.onchange = () => {
    const f = file.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result);
      localStorage.setItem("ap_pet_custom", url);
      localStorage.setItem("ap_pet_custom_name", f.name.replace(/\.[^.]+$/, ""));
      emit("set-pet", { slug: "local", url });
      current.textContent = localStorage.getItem("ap_pet_custom_name") || t("(your image)");
      drawThumb(document.getElementById("hero-thumb") as HTMLCanvasElement, url);
    };
    reader.readAsDataURL(f);
  };
}

// ------------------------------------------------------------ animations ----
// Bind a spritesheet row to each mood (the macOS PetBindings + AnimationPicker).
const SHEET_ROWS = ["Idle", "Run right", "Run left", "Waving", "Jumping", "Failed", "Waiting", "Running", "Review"];
const MOOD_DEFAULT_ROW: Record<string, number> = { idle: 0, working: 7, waiting: 6, done: 3, celebrate: 4 };

function initAnimations() {
  const root = document.getElementById("anim-rows")!;
  const changed = () => emit("bubble-changed", null);
  for (const [mood, label] of [["idle", "Idle"], ["working", "Working"], ["waiting", "Needs you"], ["done", "Done"], ["celebrate", "Celebrate"]] as const) {
    const row = document.createElement("div");
    row.className = "row";
    const name = document.createElement("span");
    name.textContent = t(label);
    const sel = document.createElement("select");
    SHEET_ROWS.forEach((rn, i) => {
      const o = document.createElement("option");
      o.value = String(i);
      o.textContent = t(rn);
      sel.appendChild(o);
    });
    sel.value = localStorage.getItem(`ap_bind_${mood}`) ?? String(MOOD_DEFAULT_ROW[mood]);
    sel.onchange = () => { localStorage.setItem(`ap_bind_${mood}`, sel.value); changed(); };
    row.appendChild(name);
    row.appendChild(sel);
    root.appendChild(row);
  }
}

// ----------------------------------------------------------------- sounds ----
let settingsAudioCtx: AudioContext | null = null;
function playSound(ev: "done" | "waiting") {
  const data = localStorage.getItem(`ap_sound_${ev}_data`);
  if (data) {
    try { void new Audio(data).play(); return; } catch {}
  }
  try {
    settingsAudioCtx = settingsAudioCtx || new AudioContext();
    const o = settingsAudioCtx.createOscillator();
    const g = settingsAudioCtx.createGain();
    o.type = "sine";
    o.frequency.value = ev === "done" ? 880 : 560;
    g.gain.value = 0.05;
    o.connect(g);
    g.connect(settingsAudioCtx.destination);
    o.start();
    o.stop(settingsAudioCtx.currentTime + 0.13);
  } catch {}
}

function initSounds() {
  const filePick = document.createElement("input");
  filePick.type = "file";
  filePick.accept = "audio/*";
  filePick.style.display = "none";
  document.body.appendChild(filePick);

  const syncNames = () => {
    for (const ev of ["done", "waiting"] as const) {
      const name = localStorage.getItem(`ap_sound_${ev}_name`);
      (document.getElementById(`sound-${ev}-name`) as HTMLElement).textContent = name || t("Default");
      (document.getElementById(`t-df-${ev}`) as HTMLElement).style.display = name ? "" : "none";
    }
  };
  syncNames();

  document.querySelectorAll<HTMLButtonElement>(".sound-btns .mini").forEach((b) => {
    const ev = b.dataset.ev as "done" | "waiting";
    b.onclick = () => {
      switch (b.dataset.act) {
        case "play": playSound(ev); break;
        case "reset":
          localStorage.removeItem(`ap_sound_${ev}_data`);
          localStorage.removeItem(`ap_sound_${ev}_name`);
          syncNames();
          break;
        case "upload":
          filePick.onchange = () => {
            const f = filePick.files?.[0];
            if (!f) return;
            if (f.size > 2_000_000) { alert(t("Sound file too large (max 2 MB)")); return; }
            const reader = new FileReader();
            reader.onload = () => {
              localStorage.setItem(`ap_sound_${ev}_data`, String(reader.result));
              localStorage.setItem(`ap_sound_${ev}_name`, f.name);
              syncNames();
              playSound(ev); // preview, like macOS
            };
            reader.readAsDataURL(f);
            filePick.value = "";
          };
          filePick.click();
          break;
      }
    };
  });
}

// --------------------------------------------------------- notifications ----
function initNotify() {
  const box = document.getElementById("notify") as HTMLInputElement;
  box.checked = localStorage.getItem("ap_notify") !== "0";
  box.addEventListener("change", () => localStorage.setItem("ap_notify", box.checked ? "1" : "0"));
  // Per-event sound toggles (mac SoundSettings); legacy ap_sound seeds both.
  const legacyOff = localStorage.getItem("ap_sound") === "0";
  for (const ev of ["done", "waiting"] as const) {
    const el = document.getElementById(`sound-${ev}`) as HTMLInputElement;
    const key = `ap_sound_${ev}`;
    el.checked = (localStorage.getItem(key) ?? (legacyOff ? "0" : "1")) !== "0";
    el.addEventListener("change", () => localStorage.setItem(key, el.checked ? "1" : "0"));
  }
  (document.getElementById("codex-help-close") as HTMLButtonElement).onclick = () => {
    (document.getElementById("codex-help") as HTMLElement).hidden = true;
  };
}

// --------------------------------------------------------------- startup ----
async function initAutostart() {
  const box = document.getElementById("autostart") as HTMLInputElement;
  try { box.checked = await isEnabled(); } catch {}
  box.addEventListener("change", async () => {
    try { box.checked ? await enable() : await disable(); } catch (e) { alert(String(e)); }
  });
}

// ----------------------------------------------------------------- i18n ----
function applyStatic() {
  document.documentElement.lang = getLang();
  const set = (id: string, key: string) => { const el = document.getElementById(id); if (el) el.textContent = t(key); };
  // tabs
  set("tab-general", "General");
  set("tab-pet", "Pet");
  set("tab-bubble", "Bubble");
  set("tab-about", "About");
  // general
  set("t-lang", "Language");
  set("t-lang2", "Language");
  set("t-startup", "Startup");
  set("t-autostart", "Launch at login");
  set("t-autostart-sub", "AgentPet starts automatically when you sign in.");
  set("t-notif", "Notifications");
  set("t-notify", "Notifications");
  set("t-notify-sub", "Alerts when an agent finishes or needs input");
  set("t-sessions", "Agents");
  set("t-no-agents", "Nothing running right now.");
  set("sessions-clear", "Clear all");
  set("t-sounds", "Sounds");
  set("t-sound-done", "When an agent finishes");
  set("t-sound-waiting", "When an agent needs input");
  set("t-up-done", "Upload…");
  set("t-up-waiting", "Upload…");
  set("t-df-done", "Default");
  set("t-df-waiting", "Default");
  set("t-agents", "Agent integrations");
  set("t-app", "App");
  set("t-version", "Version");
  set("quit-btn", "Quit AgentPet");
  // pet
  set("t-pet-sub", "Pick the companion that floats on your desktop.");
  set("t-choose", "Choose pet");
  set("import-pet", "Use my own spritesheet…");
  set("t-size", "Size on screen");
  set("t-anims", "Animations");
  set("t-petsize", "Pet size");
  set("t-fx", "Idle bobbing animation");
  // bubble
  set("t-appearance", "Appearance");
  set("t-theme", "Theme");
  set("t-opacity", "Opacity");
  set("t-fontsize", "Text size");
  set("t-font", "Font");
  set("o-dark", "Dark");
  set("o-light", "Light");
  set("o-theme-system", "System");
  set("o-system", "System");
  set("o-rounded", "Rounded");
  set("o-mono", "Monospace");
  set("t-idle", "Show idle message");
  set("t-idle-sub", "The pet's chatter while no agent is running.");
  set("t-display", "Display");
  set("t-rows", "Rows");
  set("o-bm-list", "All rows");
  set("o-bm-carousel", "Carousel");
  set("o-bm-compact", "Compact");
  set("t-grouping", "Sessions");
  set("o-bg-kind", "Grouped by agent");
  set("o-bg-all", "All sessions");
  set("t-maxrows", "Max rows");
  set("t-filter", "Include states");
  set("o-bf-all", "All states");
  set("o-bf-done", "Done and above");
  set("o-bf-ww", "Working & Waiting");
  set("o-bf-w", "Working only");
  set("t-visible", "Visible agents");
  set("t-rowcontent", "Row content");
  set("t-presets", "Presets");
  set("t-pr-original", "Original");
  set("t-pr-standard", "Standard");
  set("t-pr-detailed", "Detailed");
  set("t-style", "Style");
  set("t-separator", "Separator");
  set("o-sep-space", "space");
  set("t-dotstyle", "State dot");
  set("o-dot-plain", "Plain dot");
  set("o-dot-claude", "Claude style");
  set("t-activity", "Activity messages");
  set("t-phrases", "Vocabulary");
  set("t-messages", "Bubble messages");
  set("t-msg-src", "Messages");
  set("o-ms-system", "System");
  set("o-ms-custom", "Custom");
  set("msg-reset", "Reset to defaults");
  set("t-msg-help", "Custom messages (one per line, leave empty for default)");
  set("t-msg-agent", "For agent");
  // codex help
  set("t-cdx-title", "How to connect Codex");
  set("t-cdx-1", "Install the hook here (it also enables hooks in Codex's config.toml).");
  set("t-cdx-2", "Open Codex CLI and run /hooks.");
  set("t-cdx-3", "Press t to Trust the AgentPet hook.");
  set("t-cdx-4", "Quit and reopen Codex (both the CLI and the desktop app).");
  const allOpt = document.querySelector<HTMLOptionElement>('#msg-agent option[value="all"]');
  if (allOpt) allOpt.textContent = t("All agents");
  document.querySelectorAll<HTMLElement>(".msg-label").forEach((el) => {
    if (el.dataset.label) el.textContent = t(el.dataset.label);
  });
  // about
  set("t-tagline", "A desktop pet that watches your AI coding agents.");
  set("t-star", "Star on GitHub");
  set("t-discord", "Join the Discord");
  set("t-coffee", "Buy me a coffee");
  set("t-author", "Author");
  set("t-version2", "Version");
  // bottom bar + demo panel
  set("t-lp", "Live preview");
  set("t-preview-sub", "Fire webhooks for many agents with your current settings");
  set("t-dp-title", "Live preview");
  set("t-dp-quick", "Quick scenarios");
  set("t-dp-active", "Active webhooks");
  set("t-dp-add", "Add webhook");
  set("t-dp-hint", "Add agents here, then change each webhook's state or delete it in the list on the left.");
  set("dp-spawn", "Spawn 3 working");
  set("dp-finish", "Finish all");
  set("dp-clear", "Clear all");
  set("dp-empty", "No webhooks yet. Add one from the right →");
  set("t-bubmode", "Bubble mode");
  set("t-multi", "Multi-agent bubble");
  set("t-multi-sub", "Structured rows with icons, state dots, and activity messages.");
  set("t-thanks", "If AgentPet helps your workflow, a star means a lot. Thank you!");
  set("t-fontsize", "Font size");
  search.placeholder = t("Search pets by name...");
}

// ------------------------------------------------- version / quit / links ----
function initMisc() {
  getVersion().then((v) => {
    const a = document.getElementById("app-version");
    const b = document.getElementById("app-version2");
    if (a) a.textContent = v;
    if (b) b.textContent = v;
  }).catch(() => {});
  (document.getElementById("quit-btn") as HTMLButtonElement).onclick = () => { exit(0); };
  document.querySelectorAll<HTMLElement>("[data-url]").forEach((el) => {
    el.addEventListener("click", () => invoke("open_url", { url: el.dataset.url }).catch(() => {}));
  });
}

function initLang() {
  const sel = document.getElementById("lang") as HTMLSelectElement;
  sel.value = getLang();
  applyStatic();
  // Tell the tray (Rust) + the pet window about the initial language too.
  invoke("set_lang", { code: getLang() }).catch(() => {});
  sel.addEventListener("change", async () => {
    setLang(sel.value as Lang);
    applyStatic();
    renderAgents();
    showCurrent();
    invoke("set_lang", { code: getLang() }).catch(() => {});
    await emit("lang-changed", getLang());
  });
}

function esc(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] || c));
}

// Paint the filled-left part of every slider (drives the --fill CSS variable)
// and the numeric value label next to it.
function initSliders() {
  document.querySelectorAll<HTMLInputElement>('input[type="range"]').forEach((r) => {
    const val = document.getElementById(`${r.id}-val`);
    const paint = () => {
      const min = Number(r.min) || 0;
      const max = Number(r.max) || 100;
      const pct = ((Number(r.value) - min) / (max - min)) * 100;
      r.style.setProperty("--fill", `${pct}%`);
      if (val) val.textContent = r.value + (r.id === "opacity" ? "%" : "");
    };
    r.addEventListener("input", paint);
    paint();
  });
}

initTabs();
initLang();
loadAgents();
initPet();
initPetControls();
initBubble();
initBubbleDisplay();
initAnimations();
initSounds();
initSessions();
initNotify();
initAutostart();
initSliders();
initSegs();
initMisc();
initDemo();
