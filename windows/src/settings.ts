import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { enable, disable, isEnabled } from "@tauri-apps/plugin-autostart";
import { loadCatalog, savedSlug, saveSlug, type Pet } from "./catalog";
import { t, getLang, setLang, type Lang } from "./i18n";

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
    const status = a.note
      ? `<div class="note">${esc(t(a.note))}</div>`
      : a.installed
      ? `<div class="ok">${esc(t("Hook installed"))}</div>`
      : "";
    meta.innerHTML = `<div class="name">${esc(a.display_name)}</div>${status}`;

    const btn = document.createElement("button");
    btn.textContent = a.installed ? t("Remove") : t("Install");
    if (a.installed) btn.classList.add("remove");
    btn.onclick = async () => {
      btn.disabled = true;
      try { await invoke("toggle_install", { kind: a.kind }); } catch (e) { alert(String(e)); }
      await loadAgents();
    };

    row.appendChild(meta);
    row.appendChild(btn);
    agentsRoot.appendChild(row);
  }
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
  await emit("set-pet", { slug: p.slug, url: p.spritesheetUrl });
  currentPet = p;
  showCurrent();
  results.innerHTML = "";
  search.value = "";
}

function showCurrent() {
  if (!catalog.length) { current.textContent = t("Couldn't load pets , check your internet connection."); return; }
  current.textContent = `${t("Showing:")} ${currentPet ? currentPet.name : t("(default)")}`;
}

function renderResults(list: Pet[]) {
  results.innerHTML = "";
  for (const p of list.slice(0, 24)) {
    const item = document.createElement("button");
    item.className = "pet-item";
    item.textContent = p.name;
    item.onclick = () => pick(p);
    results.appendChild(item);
  }
}

async function initPet() {
  catalog = await loadCatalog();
  currentPet = catalog.find((p) => p.slug === savedSlug());
  showCurrent();
  search.addEventListener("input", () => {
    const q = search.value.trim().toLowerCase();
    if (!q) { results.innerHTML = ""; return; }
    renderResults(catalog.filter((p) => p.name.toLowerCase().includes(q)));
  });
  random.addEventListener("click", () => {
    if (catalog.length) pick(catalog[Math.floor(Math.random() * catalog.length)]);
  });
}

// ---------------------------------------------------------------- bubble ----
const MSG_STATES: [string, string][] = [
  ["working", "Working"], ["waiting", "Needs you"], ["done", "Done"], ["idle", "Idle"],
];

function initBubble() {
  const theme = document.getElementById("theme") as HTMLSelectElement;
  const opacity = document.getElementById("opacity") as HTMLInputElement;
  theme.value = localStorage.getItem("ap_theme") || "dark";
  opacity.value = localStorage.getItem("ap_opacity") || "92";
  const changed = () => { emit("bubble-changed", null); };
  theme.addEventListener("change", () => { localStorage.setItem("ap_theme", theme.value); changed(); });
  opacity.addEventListener("input", () => { localStorage.setItem("ap_opacity", opacity.value); changed(); });

  const editors = document.getElementById("msg-editors")!;
  editors.innerHTML = "";
  for (const [st, label] of MSG_STATES) {
    const wrap = document.createElement("div");
    wrap.className = "msg-editor";
    const lbl = document.createElement("div");
    lbl.className = "msg-label";
    lbl.dataset.label = label; // re-translated by applyStatic
    lbl.textContent = t(label);
    const ta = document.createElement("textarea");
    ta.value = localStorage.getItem("ap_msg_" + st) || "";
    ta.addEventListener("input", () => { localStorage.setItem("ap_msg_" + st, ta.value); changed(); });
    wrap.appendChild(lbl);
    wrap.appendChild(ta);
    editors.appendChild(wrap);
  }
}

// --------------------------------------------------------- notifications ----
function initNotify() {
  const box = document.getElementById("notify") as HTMLInputElement;
  box.checked = localStorage.getItem("ap_notify") !== "0";
  box.addEventListener("change", () => localStorage.setItem("ap_notify", box.checked ? "1" : "0"));
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
  set("t-pet", "Your pet");
  set("t-pet-sub", "Pick the companion that floats on your desktop.");
  set("t-bubble", "Bubble");
  set("t-theme", "Theme");
  set("t-opacity", "Opacity");
  set("t-msg-help", "Custom messages (one per line, leave empty for default)");
  set("o-dark", "Dark");
  set("o-light", "Light");
  document.querySelectorAll<HTMLElement>(".msg-label").forEach((el) => {
    if (el.dataset.label) el.textContent = t(el.dataset.label);
  });
  set("t-agents", "Agent integrations");
  set("t-agents-sub", "Install a hook so AgentPet can see when an agent works, finishes, or needs you.");
  set("t-notif", "Notifications");
  set("t-notify", "Notify when an agent finishes or needs you");
  set("t-startup", "Startup");
  set("t-autostart", "Start AgentPet when Windows starts");
  search.placeholder = t("Search pets by name...");
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

initLang();
loadAgents();
initPet();
initBubble();
initNotify();
initAutostart();
