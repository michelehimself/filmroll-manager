// FilmRoll Manager – frontend logic
// Talks to the Rust backend (src-tauri/src/) via `invoke`.

const { invoke } = window.__TAURI__.core;
const { open }   = window.__TAURI__.dialog;
const { getCurrentWebview } = window.__TAURI__.webview;

// ── Platform: leave room for the macOS traffic lights ─────────────────────────
if (navigator.userAgent.includes("Mac")) {
  document.querySelector(".titlebar").style.paddingLeft = "80px";
}

// ── Icons (SF-Symbols-like line icons) ────────────────────────────────────────
const svg = (size, sw, body) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
const FOLDER = `<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>`;
const CAMERA = `<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>`;
const FILM   = `<rect x="2" y="2" width="20" height="20" rx="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="7" x2="7" y2="7"/><line x1="17" y1="7" x2="22" y2="7"/><line x1="17" y1="17" x2="22" y2="17"/><line x1="2" y1="17" x2="7" y2="17"/>`;
const IC = {
  folderBig: svg(40, 1.3, FOLDER),
  folder:    svg(16, 1.6, FOLDER),
  camera:    svg(15, 1.6, CAMERA),
  cameraBig: svg(40, 1.3, CAMERA),
  film:      svg(15, 1.6, FILM),
  filmBig:   svg(40, 1.3, FILM),
  image:     svg(18, 1.5, `<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>`),
  reverse:   svg(22, 1.6, `<polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>`),
  meta:      svg(22, 1.6, `<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>`),
  rename:    svg(22, 1.6, `<polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/>`),
  sheet:     svg(22, 1.6, `<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>`),
};

// ── Tabs and tools ────────────────────────────────────────────────────────────
const TABS = [
  { id: "manager", label: "Manager", icon: IC.folder },
  { id: "films",   label: "Films",   icon: IC.film },
  { id: "gear",    label: "Gear",    icon: IC.camera },
];

// `ready: false` tools are shown but cannot be used yet
const TOOLS = [
  { id: "reverse", title: "Reverse Order",     desc: "Flip the frame order",      icon: IC.reverse, ready: false },
  { id: "meta",    title: "Bulk Edit Meta Data", desc: "Camera, lens, film, date", icon: IC.meta,    ready: false },
  { id: "rename",  title: "Bulk Rename",       desc: "Build new file names",      icon: IC.rename,  ready: false },
  { id: "sheet",   title: "Create Contact Sheet", desc: "Overview of the roll",   icon: IC.sheet,   ready: false, soon: true },
];

// ── State ─────────────────────────────────────────────────────────────────────
let S = {
  tab: "manager",
  folder: null,   // absolute path
  files: [],      // [{ name, path, camera, lens, film, date }] in natural order
  loading: false,
  error: null,
};

// ── Helpers ───────────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const folderName = (p) => (p ? p.split(/[\\/]/).filter(Boolean).pop() : "");

async function loadFolder(path) {
  S.loading = true; S.error = null;
  render();
  try {
    const files = await invoke("read_folder", { folder: path });
    if (files.length) {
      S.files = files;
      S.folder = path;
    } else {
      S.error = "This folder contains no JPG, PNG or TIFF images.";
    }
  } catch (e) {
    S.error = String(e);
  }
  S.loading = false;
  resetThumbnails();
  render();
}

async function pickFolder() {
  const selected = await open({ directory: true, multiple: false, title: "Choose the folder with your scans" });
  if (selected) loadFolder(selected);
}

// ── Thumbnails: loaded lazily, three at a time ────────────────────────────────
const thumbUrls = new Map();   // path → object URL
let thumbQueue = [];
let thumbActive = 0;
let thumbObserver = null;

function resetThumbnails() {
  thumbUrls.forEach((url) => URL.revokeObjectURL(url));
  thumbUrls.clear();
  thumbQueue = [];
}

function showThumb(img, url) {
  img.src = url;
  img.classList.add("loaded");
}

function pumpThumbnails() {
  while (thumbActive < 3 && thumbQueue.length) {
    const img = thumbQueue.shift();
    if (!img.isConnected) continue;
    thumbActive++;
    invoke("get_thumbnail", { path: img.dataset.path })
      .then((bytes) => {
        const url = URL.createObjectURL(new Blob([bytes], { type: "image/jpeg" }));
        thumbUrls.set(img.dataset.path, url);
        if (img.isConnected) showThumb(img, url);
      })
      .catch(() => img.parentElement?.classList.add("failed"))
      .finally(() => { thumbActive--; pumpThumbnails(); });
  }
}

function observeThumbnails() {
  thumbObserver?.disconnect();
  const list = document.querySelector(".filelist");
  if (!list) return;
  thumbObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      const img = entry.target;
      thumbObserver.unobserve(img);
      const cached = thumbUrls.get(img.dataset.path);
      if (cached) showThumb(img, cached); else { thumbQueue.push(img); pumpThumbnails(); }
    });
  }, { root: list, rootMargin: "300px" });
  list.querySelectorAll(".thumb img").forEach((img) => thumbObserver.observe(img));
}

// ── Rendering ─────────────────────────────────────────────────────────────────
function render() {
  $("tabbar").innerHTML = TABS.map((t) =>
    `<button class="tab${t.id === S.tab ? " active" : ""}" role="tab" aria-selected="${t.id === S.tab}" data-tab="${t.id}">${t.icon}${t.label}</button>`
  ).join("");

  const view = $("view");
  if (S.tab === "manager") view.innerHTML = viewManager();
  if (S.tab === "films")   view.innerHTML = viewPlaceholder(IC.filmBig, "Films", "Your film database with favorites will live here.");
  if (S.tab === "gear")    view.innerHTML = viewPlaceholder(IC.cameraBig, "Gear", "Your cameras and lenses will live here.");
  if (S.tab === "manager") observeThumbnails();
}

function viewPlaceholder(icon, title, text) {
  return `<div class="empty-view"><div class="empty-icon">${icon}</div><div class="empty-title">${title}</div><div class="empty-sub">${text} Coming soon.</div></div>`;
}

function viewManager() {
  return `<div class="manager">${viewSidebar()}${S.folder ? viewExplorer() : viewDropArea()}</div>`;
}

function viewSidebar() {
  const tiles = TOOLS.map((t) => `
    <button class="tool" data-tool="${t.id}" ${t.ready && S.folder ? "" : "disabled"}>
      <span class="tool-icon">${t.icon}</span>
      <span class="tool-text"><div class="tool-title">${t.title}</div><div class="tool-desc">${t.desc}</div></span>
      ${t.soon ? `<span class="tool-badge">Soon</span>` : ""}
    </button>`).join("");
  return `<aside class="sidebar"><div class="sidebar-head">Tools</div>${tiles}</aside>`;
}

function viewDropArea() {
  const error = S.error ? `<div class="error-banner" role="alert">${esc(S.error)}</div>` : "";
  if (S.loading) {
    return `<div class="loading-view"><p class="loading-msg">Reading folder…</p><p class="loading-sub">Looking at the files and their metadata</p></div>`;
  }
  return `
    <div class="drop-area">
      <p class="step-heading">Select Folder</p>
      <p class="step-sub">Choose the folder containing your lab scans. Work on a copy, not on your originals.</p>
      <div class="dropzone" id="dropzone" data-action="pick-folder">
        <div class="dz-icon">${IC.folderBig}</div>
        <div class="dz-title">Drop folder here</div>
        <div class="dz-sub">or click to browse</div>
      </div>
      ${error}
    </div>`;
}

function viewExplorer() {
  if (S.loading) {
    return `<div class="loading-view"><p class="loading-msg">Reading folder…</p><p class="loading-sub">Looking at the files and their metadata</p></div>`;
  }
  const error = S.error ? `<div class="error-banner" role="alert">${esc(S.error)}</div>` : "";
  const n = S.files.length;
  const rows = S.files.map((f) => `
    <div class="row file">
      <div class="thumb">${IC.image}<img data-path="${esc(f.path)}" alt=""></div>
      <div class="cell name" title="${esc(f.name)}">${esc(f.name)}</div>
      <div class="cell" title="${esc(f.camera)}">${esc(f.camera)}</div>
      <div class="cell" title="${esc(f.lens)}">${esc(f.lens)}</div>
      <div class="cell" title="${esc(f.film)}">${esc(f.film)}</div>
      <div class="cell date">${esc(f.date)}</div>
    </div>`).join("");
  return `
    <section class="explorer" id="dropzone">
      <div class="toolbar">
        <div class="toolbar-folder">${IC.folder}<span class="name" title="${esc(S.folder)}">${esc(folderName(S.folder))}</span><span class="count">${n} image${n === 1 ? "" : "s"}</span></div>
        <div class="toolbar-spacer"></div>
        <button class="btn btn-ghost" data-action="pick-folder">Change Folder…</button>
      </div>
      ${error}
      <div class="filelist">
        <div class="row head"><div></div><div>File</div><div>Camera</div><div>Lens</div><div>Film</div><div>Date</div></div>
        ${rows}
      </div>
    </section>`;
}

// ── Native drag & drop from Finder / Explorer ─────────────────────────────────
getCurrentWebview().onDragDropEvent((event) => {
  if (S.tab !== "manager" || S.loading) return;
  const zone = $("dropzone");
  const { type } = event.payload;
  if (type === "enter" || type === "over") zone?.classList.add("dragging");
  if (type === "leave") zone?.classList.remove("dragging");
  if (type === "drop") {
    zone?.classList.remove("dragging");
    const path = event.payload.paths?.[0];
    if (path) loadFolder(path);
  }
});

// ── Event wiring (one delegated listener for everything) ──────────────────────
document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-action],[data-tab]");
  if (!t) return;
  if (t.dataset.tab && t.dataset.tab !== S.tab) { S.tab = t.dataset.tab; render(); }
  if (t.dataset.action === "pick-folder") pickFolder();
});

render();
