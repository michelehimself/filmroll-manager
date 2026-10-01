// FilmRoll Manager – frontend logic
// Talks to the Rust backend (src-tauri/src/) via `invoke`.

const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;
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
  plus:      svg(15, 1.8, `<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>`),
  pencil:    svg(15, 1.6, `<path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>`),
  trash:     svg(15, 1.6, `<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>`),
  search:    svg(15, 1.6, `<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>`),
  star:      svg(16, 1.6, `<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>`),
  calendar:  svg(15, 1.6, `<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>`),
  clock:     svg(15, 1.6, `<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>`),
  aperture:  svg(15, 1.6, `<circle cx="12" cy="12" r="10"/><line x1="14.31" y1="8" x2="20.05" y2="17.94"/><line x1="9.69" y1="8" x2="21.17" y2="8"/><line x1="7.38" y1="12" x2="13.12" y2="2.06"/><line x1="9.69" y1="16" x2="3.95" y2="6.06"/><line x1="14.31" y1="16" x2="2.83" y2="16"/><line x1="16.62" y1="12" x2="10.88" y2="21.94"/>`),
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
  { id: "reverse", title: "Reverse Order",     desc: "Flip the frame order",      icon: IC.reverse, ready: true },
  { id: "meta",    title: "Bulk Edit Meta Data", desc: "Camera, lens, film, date", icon: IC.meta,    ready: true },
  { id: "rename",  title: "Bulk Rename",       desc: "Build new file names",      icon: IC.rename,  ready: true },
  { id: "sheet",   title: "Create Contact Sheet", desc: "Overview of the roll",   icon: IC.sheet,   ready: false, soon: true },
];

// ── Template tags (Bulk Rename) ───────────────────────────────────────────────
const TAGS = {
  date:   { label: "Date",      color: "blue" },
  num:    { label: "#",         color: "green" },
  imgnum: { label: "IMG-#",     color: "green" },
  film:   { label: "Film Name", color: "orange" },
};

// ── State ─────────────────────────────────────────────────────────────────────
function todayString() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

let S = {
  tab: "manager",
  folder: null,   // absolute path
  files: [],      // [{ name, path, camera, lens, film, date }] in natural order
  loading: false,
  error: null,
  modal: null,    // null | "reverse" | "meta" | "rename"
  busy: false,    // a tool is writing to the files
  meta: { camera: "", lens: "", film: "", date: todayString(), time: "12:00" },
  rename: { date: "", film: "" },   // values behind the Date and Film Name tags
  template: [],                      // [{ kind, value? }]
  store: { favorites: [], cameras: [], lenses: [] },          // the user's own data, saved by Rust in library.json
  storeError: null,
  selected: new Set(),   // file names chosen in the list; empty = tools work on all files
  anchor: null,          // last clicked file name (for shift-click ranges)
  filmQuery: "",
  filmFavoritesOnly: false,
};

// ── Helpers ───────────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const folderName = (p) => (p ? p.split(/[\\/]/).filter(Boolean).pop() : "");

const stem = (name) => (name.includes(".") ? name.slice(0, name.lastIndexOf(".")) : name);
const ext  = (name) => (name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : "");

// Must match `sanitize` / `film_slug` in processor.rs
const sanitize = (t) => t.replace(/[\/\\:*?"<>|\u0000-\u001f]/g, "-");
const filmSlug = (f) => { const x = f.trim().split(/\s+/).filter(Boolean).join("-"); return x ? sanitize(x) : "Film"; };

function nameFor(index) {
  const num = String(index + 1).padStart(2, "0");
  return S.template.map((p) => {
    switch (p.kind) {
      case "date":   return S.rename.date;
      case "num":    return num;
      case "imgnum": return `IMG-${num}`;
      case "film":   return filmSlug(S.rename.film);
      default:       return sanitize(p.value || "");
    }
  }).join("").trim();
}

// The files a tool works on: the selection, or everything if nothing is selected
const scopeFiles = () => (S.selected.size ? S.files.filter((f) => S.selected.has(f.name)) : S.files);
const scopeNames = () => (S.selected.size ? scopeFiles().map((f) => f.name) : null);
const scopeText = () => {
  const n = scopeFiles().length;
  return S.selected.size ? `Applies to the ${n} selected file${n === 1 ? "" : "s"}.` : `Applies to all ${n} files in the folder.`;
};

async function loadFolder(path) {
  S.loading = true; S.error = null;
  render();
  try {
    const files = await invoke("read_folder", { folder: path });
    if (files.length) {
      S.files = files;
      S.folder = path;
      S.selected = new Set();
      S.anchor = null;
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

// Re-reads the folder after a tool changed the files (no loading screen)
async function refreshFolder() {
  S.files = await invoke("read_folder", { folder: S.folder });
  const names = new Set(S.files.map((f) => f.name));
  S.selected = new Set([...S.selected].filter((n) => names.has(n)));
  resetThumbnails();
  render();
}

let noticeTimer = null;
function showNotice(text) {
  const box = $("notice");
  if (!box) return;
  box.innerHTML = `<div class="success-banner" role="status">${esc(text)}</div>`;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { const b = $("notice"); if (b) b.innerHTML = ""; }, 5000);
}

// ── Selecting files in the list ───────────────────────────────────────────────
const selectionText = () => {
  const n = S.files.length;
  return S.selected.size ? `${S.selected.size} of ${n} selected` : `${n} image${n === 1 ? "" : "s"}`;
};

// Updates highlight, checkboxes and counters without rebuilding the list
function updateSelectionUI() {
  document.querySelectorAll(".row.file").forEach((row) => {
    const on = S.selected.has(row.dataset.row);
    row.classList.toggle("selected", on);
    const box = row.querySelector("[data-check]");
    if (box) box.checked = on;
  });
  const all = $("check-all");
  if (all) {
    all.checked = S.files.length > 0 && S.selected.size === S.files.length;
    all.indeterminate = S.selected.size > 0 && S.selected.size < S.files.length;
  }
  const count = $("sel-count");
  if (count) count.textContent = selectionText();
}

function selectRow(name, event) {
  const names = S.files.map((f) => f.name);
  if (event.shiftKey && S.anchor && names.includes(S.anchor)) {
    const [a, b] = [names.indexOf(S.anchor), names.indexOf(name)].sort((x, y) => x - y);
    S.selected = new Set(names.slice(a, b + 1));
  } else if (event.metaKey || event.ctrlKey) {
    S.selected = new Set(S.selected);
    S.selected.has(name) ? S.selected.delete(name) : S.selected.add(name);
    S.anchor = name;
  } else {
    S.selected = new Set([name]);
    S.anchor = name;
  }
  updateSelectionUI();
}

function toggleCheck(name, on) {
  S.selected = new Set(S.selected);
  on ? S.selected.add(name) : S.selected.delete(name);
  S.anchor = name;
  updateSelectionUI();
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
  const scroll = document.querySelector(".filelist")?.scrollTop ?? 0;
  if (S.tab === "manager") view.innerHTML = viewManager();
  if (S.tab === "films")   { view.innerHTML = viewFilms(); renderFilmList(); }
  if (S.tab === "gear")    { view.innerHTML = viewGear(); renderGearLists(); }
  if (S.tab === "manager") {
    const list = document.querySelector(".filelist");
    if (list) list.scrollTop = scroll;
    observeThumbnails();
    updateSelectionUI();
  }
  renderModal();
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
    <div class="row file${S.selected.has(f.name) ? " selected" : ""}" data-row="${esc(f.name)}">
      <div class="check"><input type="checkbox" data-check="${esc(f.name)}" ${S.selected.has(f.name) ? "checked" : ""} aria-label="Select ${esc(f.name)}"></div>
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
        <div class="toolbar-folder">${IC.folder}<span class="name" title="${esc(S.folder)}">${esc(folderName(S.folder))}</span><span class="count" id="sel-count">${selectionText()}</span></div>
        <div class="toolbar-spacer"></div>
        <button class="btn btn-ghost" data-action="pick-folder">Change Folder…</button>
      </div>
      ${error}
      <div id="notice"></div>
      <div class="filelist">
        <div class="row head"><div class="check"><input type="checkbox" id="check-all" data-check-all aria-label="Select all files"></div><div></div><div>File</div><div>Camera</div><div>Lens</div><div>Film</div><div>Date</div></div>
        ${rows}
      </div>
    </section>`;
}

// ── Films tab ─────────────────────────────────────────────────────────────────
const filmFullName = (f) => `${f.brand} ${f.name}`;
const isFavorite = (name) => S.store.favorites.includes(name);

async function saveStore() {
  try {
    await invoke("save_store", { data: S.store });
    S.storeError = null;
  } catch (e) {
    S.storeError = `Your favorites could not be saved: ${e}`;
  }
  const box = $("store-error");
  if (box) box.innerHTML = S.storeError ? `<div class="error-banner" role="alert">${esc(S.storeError)}</div>` : "";
}

async function loadStore() {
  try {
    const data = await invoke("load_store");
    const list = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);
    S.store = { ...data, favorites: list(data.favorites), cameras: list(data.cameras), lenses: list(data.lenses) };
  } catch (e) {
    S.storeError = `Your saved favorites could not be loaded: ${e}`;
  }
  if (S.tab === "films" || S.tab === "gear") render();
}

function viewFilms() {
  return `
    <div class="page">
      <div class="page-head">
        <div>
          <p class="step-heading">Films</p>
          <p class="step-sub">Star your favorite films. They show up as suggestions in the Film field of Bulk Edit Meta Data.</p>
        </div>
        <div class="page-tools">
          <div class="search">
            <span class="field-icon">${IC.search}</span>
            <input id="film-search" type="text" placeholder="Search films" value="${esc(S.filmQuery)}" autocomplete="off" spellcheck="false" aria-label="Search films">
          </div>
          <button class="btn btn-ghost${S.filmFavoritesOnly ? " on" : ""}" data-action="toggle-fav-filter" aria-pressed="${S.filmFavoritesOnly}">Favorites only</button>
        </div>
      </div>
      <div id="store-error">${S.storeError ? `<div class="error-banner" role="alert">${esc(S.storeError)}</div>` : ""}</div>
      <div class="page-scroll" id="film-list"></div>
    </div>`;
}

function renderFilmList() {
  const box = $("film-list");
  if (!box) return;
  const words = S.filmQuery.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = FILMS.filter((f) => {
    const full = filmFullName(f);
    if (S.filmFavoritesOnly && !isFavorite(full)) return false;
    const hay = `${full} ${f.iso} ${f.type}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
  if (!shown.length) {
    box.innerHTML = `<div class="empty-view"><div class="empty-title">${S.filmFavoritesOnly && !S.filmQuery ? "No favorites yet" : "No films found"}</div><div class="empty-sub">${S.filmFavoritesOnly && !S.filmQuery ? "Click the star next to a film to add it here." : "Try a different search."}</div></div>`;
    return;
  }
  let html = "", brand = null;
  shown.forEach((f) => {
    if (f.brand !== brand) { brand = f.brand; html += `<div class="film-brand">${esc(brand)}</div>`; }
    const full = filmFullName(f), on = isFavorite(full);
    html += `
      <div class="film-row">
        <button class="star${on ? " on" : ""}" data-star="${esc(full)}" aria-pressed="${on}" aria-label="${on ? "Remove from favorites" : "Add to favorites"}: ${esc(full)}">${IC.star}</button>
        <div class="film-name">${esc(f.name)}</div>
        <div class="film-iso">ISO ${esc(f.iso)}</div>
        <div class="film-type">${esc(f.type)}</div>
      </div>`;
  });
  html += `<p class="film-note">Missing a film? You can type any film name in the Film field – it does not have to be on this list.</p>`;
  box.innerHTML = html;
}

function toggleFavorite(name) {
  const favs = S.store.favorites;
  S.store.favorites = favs.includes(name) ? favs.filter((f) => f !== name) : [...favs, name];
  renderFilmList();
  saveStore();
}

// ── Gear tab ──────────────────────────────────────────────────────────────────
const GEAR = {
  cameras: { title: "Cameras", icon: IC.camera, placeholder: "e.g. Canon AE-1, Contax T2", empty: "No cameras yet.", hint: "" },
  lenses:  { title: "Lenses",  icon: IC.aperture, placeholder: "e.g. Canon FD 50mm f/1.4", empty: "No lenses yet.",
             hint: "Include the focal length and the widest aperture in the name, like <strong>50mm f/1.4</strong>. They are written into the image files, too." },
};
let gearEdit = null;   // { kind, name } while a row is being renamed

const sortedGear = (kind) => [...S.store[kind]].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
const cleanName = (t) => t.trim().replace(/\s+/g, " ");
const hasGear = (kind, name, except = null) =>
  S.store[kind].some((n) => n !== except && n.toLowerCase() === name.toLowerCase());

function viewGear() {
  const col = (kind) => {
    const g = GEAR[kind];
    return `
      <section class="gear-col">
        <p class="gear-title">${g.title}</p>
        <div class="gear-add">
          <div class="field-row">
            <span class="field-icon">${g.icon}</span>
            <input id="gear-input-${kind}" data-gear-input="${kind}" type="text" placeholder="${g.placeholder}" autocomplete="off" spellcheck="false" aria-label="Add to ${g.title.toLowerCase()}">
          </div>
          <button class="btn btn-primary" data-action="gear-add" data-kind="${kind}">Add</button>
        </div>
        ${g.hint ? `<div class="hint-box">${g.hint}</div>` : ""}
        <div class="gear-list" id="gear-${kind}"></div>
      </section>`;
  };
  return `
    <div class="page">
      <div class="page-head">
        <div>
          <p class="step-heading">Gear</p>
          <p class="step-sub">Enter your cameras and lenses once. They show up as suggestions in the Camera and Lens fields of Bulk Edit Meta Data.</p>
        </div>
      </div>
      <div id="store-error">${S.storeError ? `<div class="error-banner" role="alert">${esc(S.storeError)}</div>` : ""}</div>
      <div class="page-scroll"><div class="gear-grid">${col("cameras")}${col("lenses")}</div></div>
    </div>`;
}

function renderGearLists() {
  ["cameras", "lenses"].forEach((kind) => {
    const box = $(`gear-${kind}`);
    if (!box) return;
    const names = sortedGear(kind);
    if (!names.length) { box.innerHTML = `<div class="gear-empty">${GEAR[kind].empty}</div>`; return; }
    box.innerHTML = names.map((name) => {
      if (gearEdit && gearEdit.kind === kind && gearEdit.name === name) {
        return `<div class="gear-row editing"><input class="gear-edit" data-gear-rename="${kind}" data-old="${esc(name)}" value="${esc(name)}" autocomplete="off" spellcheck="false" aria-label="Rename ${esc(name)}"></div>`;
      }
      return `
        <div class="gear-row">
          <span class="gear-name" title="${esc(name)}">${esc(name)}</span>
          <button class="icon-btn" data-gear-edit="${kind}" data-name="${esc(name)}" aria-label="Rename ${esc(name)}">${IC.pencil}</button>
          <button class="icon-btn" data-gear-remove="${kind}" data-name="${esc(name)}" aria-label="Remove ${esc(name)}">${IC.trash}</button>
        </div>`;
    }).join("");
    const editing = box.querySelector(".gear-edit");
    if (editing) { editing.focus(); editing.select(); }
  });
}

function addGear(kind) {
  const input = $(`gear-input-${kind}`);
  const name = cleanName(input.value);
  if (!name) return;
  if (!hasGear(kind, name)) {
    S.store[kind] = [...S.store[kind], name];
    renderGearLists();
    saveStore();
  }
  input.value = "";
  input.focus();
}

function removeGear(kind, name) {
  S.store[kind] = S.store[kind].filter((n) => n !== name);
  renderGearLists();
  saveStore();
}

function finishRename(input, save) {
  const kind = input.dataset.gearRename, old = input.dataset.old;
  const name = cleanName(input.value);
  gearEdit = null;
  if (save && name && name !== old && !hasGear(kind, name, old)) {
    S.store[kind] = S.store[kind].map((n) => (n === old ? name : n));
    saveStore();
  }
  renderGearLists();
}

// ── Suggestions under text fields (Film now, Camera and Lens later) ───────────
let suggest = null;   // { input, items, active }

function suggestionsFor(kind, text) {
  const q = text.trim().toLowerCase();
  const list = kind === "film" ? S.store.favorites : kind === "camera" ? sortedGear("cameras") : kind === "lens" ? sortedGear("lenses") : [];
  return list.filter((f) => f.toLowerCase().includes(q) && f.toLowerCase() !== q);
}

function closeSuggest() {
  document.querySelectorAll(".suggest").forEach((el) => el.remove());
  suggest = null;
}

function openSuggest(input) {
  const kind = input.dataset.suggest;
  const items = suggestionsFor(kind, input.value);
  closeSuggest();
  const wrap = input.closest(".field-wrap");
  if (!wrap) return;
  const emptyText = { film: "No favorites yet. Star films in the Films tab.", camera: "No cameras yet. Add them in the Gear tab.", lens: "No lenses yet. Add them in the Gear tab." }[kind];
  const source = { film: S.store.favorites, camera: S.store.cameras, lens: S.store.lenses }[kind] || [];
  const noFavorites = !source.length && !input.value.trim();
  if (!items.length && !noFavorites) return;

  const box = document.createElement("div");
  box.className = "suggest";
  box.setAttribute("role", "listbox");
  box.innerHTML = noFavorites
    ? `<div class="suggest-empty">${emptyText}</div>`
    : items.map((it, i) => `<div class="suggest-item${i === 0 ? " active" : ""}" role="option" data-pick="${esc(it)}">${esc(it)}</div>`).join("");
  wrap.appendChild(box);
  suggest = { input, items, active: items.length ? 0 : -1 };
}

function moveSuggest(step) {
  if (!suggest?.items.length) return;
  suggest.active = (suggest.active + step + suggest.items.length) % suggest.items.length;
  document.querySelectorAll(".suggest-item").forEach((el, i) => el.classList.toggle("active", i === suggest.active));
}

function pickSuggestion(value) {
  const input = suggest.input;
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  closeSuggest();
}

// ── Tool dialogs ──────────────────────────────────────────────────────────────
function openTool(id) {
  if (S.busy) return;
  S.error = null;
  if (id === "rename") {
    const first = scopeFiles()[0] || {};
    S.rename.date = (first.date || "").slice(0, 10) || S.meta.date;
    S.rename.film = first.film || S.meta.film;
  }
  S.modal = id;
  renderModal();
}

function closeModal() {
  if (S.busy) return;
  S.modal = null;
  S.error = null;
  renderModal();
}

function renderModal() {
  closeSuggest();
  const box = $("modal");
  if (!S.modal) { box.innerHTML = ""; return; }
  const m = {
    reverse: { title: "Reverse Order", sub: "Every file swaps its name with the file on the opposite end of the roll. Frame 1 becomes the last frame, and so on.", body: bodyReverse(), ok: "Confirm", wait: "Reversing frame order…" },
    meta:    { title: "Bulk Edit Meta Data", sub: "This information is embedded into all image files in the folder. Every field is optional.", body: bodyMeta(), ok: "Embed Metadata", wait: "Embedding metadata…" },
    rename:  { title: "Bulk Rename", sub: "Click a tag to insert it at the cursor. You can type text between tags, too.", body: bodyRename(), ok: "Rename Files", wait: "Renaming files…" },
  }[S.modal];

  const inner = S.busy ? `
    <div class="modal-body modal-busy">
      <div class="progress-track"><div class="progress-fill" id="progress-fill"></div></div>
      <p class="loading-msg">${m.wait}</p>
      <p class="loading-sub" id="progress-text">0 %</p>
    </div>` : `
    <div class="modal-head"><p class="modal-title">${m.title}</p><p class="modal-sub">${m.sub}</p></div>
    <div class="modal-body">${m.body}</div>
    ${S.error ? `<div class="error-banner" role="alert">${esc(S.error)}</div>` : ""}
    <div class="modal-foot">
      <button class="btn btn-ghost" data-action="close-modal">Cancel</button>
      <button class="btn ${S.modal === "rename" ? "btn-success" : "btn-primary"}" id="modal-ok" data-action="confirm-modal">${m.ok}</button>
    </div>`;
  box.innerHTML = `<div class="modal-backdrop"><div class="modal" role="dialog" aria-modal="true" aria-label="${m.title}">${inner}</div></div>`;
  if (!S.busy && S.modal === "rename") mountEditor();
}

// Reverse Order – simple preview: frame numbers and file names
function bodyReverse() {
  const files = scopeFiles();
  const n = files.length;
  const width = Math.max(2, String(n).length);
  const pad = (i) => String(i).padStart(width, "0");
  const rows = files.map((f, i) => {
    const donor = files[n - 1 - i];
    const next = `${stem(donor.name)}.${ext(f.name)}`;
    return `<div class="rev-row"><span class="rev-num">${pad(i + 1)} → ${pad(n - i)}</span><span class="rev-old" title="${esc(f.name)}">${esc(f.name)}</span><span class="rev-arr">→</span><span class="rev-new" title="${esc(next)}">${esc(next)}</span></div>`;
  }).join("");
  return `<div class="scope">${scopeText()}</div><div class="rev-list">${rows}</div>`;
}

// Bulk Edit Meta Data
function bodyMeta() {
  const field = (id, label, icon, type, placeholder) => `
    <div class="field-wrap">
      <label class="field-label" for="f-${id}">${label}</label>
      <div class="field-row">
        <span class="field-icon">${icon}</span>
        <input id="f-${id}" data-model="meta.${id}" ${["film", "camera", "lens"].includes(id) ? `data-suggest="${id}"` : ""} type="${type}" placeholder="${placeholder}" value="${esc(S.meta[id])}" autocomplete="off" spellcheck="false">
      </div>
    </div>`;
  return `
    <div class="scope">${scopeText()}</div>
    <div class="fields">
      ${field("camera", "Camera", IC.camera, "text", "e.g. Canon AE-1, Contax T2")}
      ${field("lens", "Lens", IC.aperture, "text", "e.g. 50mm f/1.4, 35mm f/2.8")}
      ${field("film", "Film", IC.film, "text", "e.g. Kodak Gold 200, Ilford HP5")}
      <div>
        ${field("date", "Shoot Date", IC.calendar, "date", "")}
        <div class="hint-box"><strong>Why does this matter?</strong> Apps like Apple Photos or Google Photos sort images by the date embedded in the file. Without a date, your scans appear at a random spot in your library timeline.</div>
      </div>
      <div>
        ${field("time", "Start Time", IC.clock, "time", "")}
        <div class="hint-box">Each file is automatically offset by <strong>3 seconds</strong> from the previous one, so the exact frame order is preserved in your photo library.</div>
      </div>
    </div>`;
}

// Bulk Rename
function bodyRename() {
  const buttons = Object.entries(TAGS).map(([kind, t]) =>
    `<button class="tag ${t.color}" data-insert="${kind}" id="ins-${kind}">${t.label}</button>`).join("");
  const field = (id, label, icon, type, placeholder) => `
    <div class="field-wrap">
      <label class="field-label" for="f-r-${id}">${label}</label>
      <div class="field-row">
        <span class="field-icon">${icon}</span>
        <input id="f-r-${id}" data-model="rename.${id}" ${id === "film" ? 'data-suggest="film"' : ""} type="${type}" placeholder="${placeholder}" value="${esc(S.rename[id])}" autocomplete="off" spellcheck="false">
      </div>
    </div>`;
  return `
    <div class="scope">${scopeText()}</div>
    <label class="field-label">Filename Template</label>
    <div class="tpl-editor" id="tpl-editor" contenteditable="true" spellcheck="false" style="margin-top:4px"></div>
    <div class="insert-row">
      <span class="insert-label">Insert:</span>
      ${buttons}
      <span class="insert-label" style="margin-left:6px">Separator:</span>
      <button class="sep-btn" data-sep="_">_</button>
      <button class="sep-btn" data-sep="-">-</button>
    </div>
    <div class="fields fields-pair">
      ${field("date", "Date (for the Date tag)", IC.calendar, "date", "")}
      ${field("film", "Film (for the Film Name tag)", IC.film, "text", "e.g. Kodak Gold 200")}
    </div>
    <div class="preview-wrap">
      <div class="preview-head">Preview</div>
      <div id="preview"></div>
    </div>`;
}

function makeChip(kind) {
  const chip = document.createElement("span");
  chip.className = `tag ${TAGS[kind].color}`;
  chip.contentEditable = "false";
  chip.dataset.kind = kind;
  chip.innerHTML = `${TAGS[kind].label}<button class="tag-x" data-remove aria-label="Remove">✕</button>`;
  return chip;
}

function mountEditor() {
  const ed = $("tpl-editor");
  // Rebuild what the user had before (e.g. after closing and reopening the dialog)
  S.template.forEach((p) => ed.appendChild(p.kind === "text" ? document.createTextNode(p.value) : makeChip(p.kind)));

  ed.addEventListener("input", syncTemplate);
  ed.addEventListener("keydown", (e) => { if (e.key === "Enter") e.preventDefault(); });
  ed.addEventListener("paste", (e) => {
    e.preventDefault();
    const text = (e.clipboardData?.getData("text/plain") || "").replace(/[\r\n]+/g, "");
    document.execCommand("insertText", false, text);
  });
  syncTemplate();
}

function insertAtCursor(node) {
  const ed = $("tpl-editor");
  ed.focus();
  const sel = window.getSelection();
  if (sel.rangeCount && ed.contains(sel.getRangeAt(0).commonAncestorContainer)) {
    const range = sel.getRangeAt(0);
    range.deleteContents();
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  } else {
    ed.appendChild(node);
  }
  syncTemplate();
}

// Reads the editor DOM back into S.template
function syncTemplate() {
  const ed = $("tpl-editor");
  if (!ed) return;
  const parts = [];
  ed.childNodes.forEach((n) => {
    if (n.nodeType === Node.TEXT_NODE) {
      const value = n.textContent.replace(/ /g, " ");
      if (!value) return;
      const last = parts[parts.length - 1];
      if (last?.kind === "text") last.value += value; else parts.push({ kind: "text", value });
    } else if (n.dataset?.kind) {
      parts.push({ kind: n.dataset.kind });
    } else if (n.nodeName === "BR") {
      n.remove();
    }
  });
  S.template = parts.some((p) => p.kind !== "text" || p.value.trim()) ? parts : [];

  // Hide tags that are already used
  const used = new Set(S.template.map((p) => p.kind));
  Object.keys(TAGS).forEach((k) => { const b = $(`ins-${k}`); if (b) b.hidden = used.has(k); });

  renderPreview();
  const ok = $("modal-ok");
  if (ok) ok.disabled = !S.template.length;
}

function renderPreview() {
  const box = $("preview");
  if (!box) return;
  if (!S.template.length) {
    box.innerHTML = `<div class="preview-empty">Add tags above to see how your files will be named.</div>`;
    return;
  }
  const files = scopeFiles();
  const rows = files.slice(0, 6).map((f, i) => {
    const next = `${nameFor(i)}.${ext(f.name)}`;
    return `<div class="preview-row"><span class="prev-old" title="${esc(f.name)}">${esc(f.name)}</span><span class="prev-arr">→</span><span class="prev-new" title="${esc(next)}">${esc(next)}</span></div>`;
  }).join("");
  const more = files.length > 6 ? `<div class="preview-more">and ${files.length - 6} more</div>` : "";
  box.innerHTML = rows + more;
}

// Runs the chosen tool with a progress bar, then refreshes the list
async function confirmModal() {
  if (S.busy || !S.modal) return;
  const tool = S.modal;
  const count = scopeFiles().length;
  const files = scopeNames();
  const jobs = {
    reverse: [() => invoke("reverse_order", { folder: S.folder, files }), "Frame order reversed."],
    meta:    [() => invoke("write_metadata", { folder: S.folder, meta: { ...S.meta }, files }), `Metadata written to ${count} file${count === 1 ? "" : "s"}.`],
    rename:  [() => invoke("rename_files", { folder: S.folder, parts: S.template, date: S.rename.date, film: S.rename.film, files }), `${count} file${count === 1 ? "" : "s"} renamed.`],
  };
  const [task, doneText] = jobs[tool];

  S.busy = true; S.error = null;
  renderModal();
  const unlisten = await listen("progress", (e) => {
    const pct = Math.round(e.payload * 100);
    const fill = $("progress-fill");
    if (fill) fill.style.width = `${pct}%`;
    const text = $("progress-text");
    if (text) text.textContent = `${pct} %`;
  });
  let ok = false;
  try {
    await task();
    await new Promise((r) => setTimeout(r, 300)); // let the bar visibly reach 100 %
    ok = true;
  } catch (e) {
    S.error = String(e);
  } finally {
    unlisten();
    S.busy = false;
  }

  if (ok) {
    S.modal = null;
    if (tool === "rename") { S.selected = new Set(); S.anchor = null; }   // names changed
    try { await refreshFolder(); } catch (e) { S.error = String(e); render(); }
    showNotice(doneText);
  } else {
    renderModal();
  }
}

// ── Native drag & drop from Finder / Explorer ─────────────────────────────────
getCurrentWebview().onDragDropEvent((event) => {
  if (S.tab !== "manager" || S.loading || S.modal) return;
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
  // File list: click a row to select, Cmd/Ctrl-click to add, Shift-click for a range
  const row = e.target.closest(".row.file");
  if (row && !e.target.closest("input, button")) { selectRow(row.dataset.row, e); return; }
  const t = e.target.closest("[data-action],[data-tab],[data-tool],[data-star],[data-gear-edit],[data-gear-remove],[data-insert],[data-sep],[data-remove]");
  if (!t || t.disabled) return;
  if (t.dataset.tab && t.dataset.tab !== S.tab) { S.tab = t.dataset.tab; render(); }
  if (t.dataset.tool) openTool(t.dataset.tool);
  if (t.dataset.star) toggleFavorite(t.dataset.star);
  if (t.dataset.action === "gear-add") addGear(t.dataset.kind);
  if (t.dataset.gearEdit) { gearEdit = { kind: t.dataset.gearEdit, name: t.dataset.name }; renderGearLists(); }
  if (t.dataset.gearRemove) removeGear(t.dataset.gearRemove, t.dataset.name);
  if (t.dataset.action === "toggle-fav-filter") { S.filmFavoritesOnly = !S.filmFavoritesOnly; render(); }
  if (t.dataset.action === "pick-folder") pickFolder();
  if (t.dataset.action === "close-modal") closeModal();
  if (t.dataset.action === "confirm-modal") confirmModal();
  if (t.dataset.insert) insertAtCursor(makeChip(t.dataset.insert));
  if (t.dataset.sep) { $("tpl-editor").focus(); document.execCommand("insertText", false, t.dataset.sep); syncTemplate(); }
  if (t.hasAttribute("data-remove")) { t.closest(".tag").remove(); syncTemplate(); }
});

document.addEventListener("change", (e) => {
  if (e.target.dataset?.check) toggleCheck(e.target.dataset.check, e.target.checked);
  if (e.target.hasAttribute?.("data-check-all")) {
    S.selected = e.target.checked ? new Set(S.files.map((f) => f.name)) : new Set();
    updateSelectionUI();
  }
});

// Text fields write straight into the state (data-model="group.key")
document.addEventListener("input", (e) => {
  if (e.target.id === "film-search") { S.filmQuery = e.target.value; renderFilmList(); return; }
  const model = e.target.dataset?.model;
  if (!model) return;
  const [group, key] = model.split(".");
  S[group][key] = e.target.value;
  if (S.modal === "rename") renderPreview();
  if (e.target.dataset.suggest) openSuggest(e.target);
});

// Suggestion dropdown: show on focus, pick with the mouse (mousedown keeps the focus) or the keyboard
document.addEventListener("focusin", (e) => { if (e.target.dataset?.suggest) openSuggest(e.target); });
document.addEventListener("focusout", (e) => {
  if (e.target.dataset?.suggest) closeSuggest();
  if (e.target.dataset?.gearRename && gearEdit) finishRename(e.target, false);   // clicking away cancels
});
document.addEventListener("mousedown", (e) => {
  const item = e.target.closest("[data-pick]");
  if (item && suggest) { e.preventDefault(); pickSuggestion(item.dataset.pick); }
});

document.addEventListener("keydown", (e) => {
  const rename = e.target.dataset?.gearRename, adding = e.target.dataset?.gearInput;
  if (rename && e.key === "Enter")  { e.preventDefault(); finishRename(e.target, true);  return; }
  if (rename && e.key === "Escape") { e.preventDefault(); finishRename(e.target, false); return; }
  if (adding && e.key === "Enter")  { e.preventDefault(); addGear(adding); return; }
  if (suggest) {
    if (e.key === "ArrowDown") { e.preventDefault(); moveSuggest(1); return; }
    if (e.key === "ArrowUp")   { e.preventDefault(); moveSuggest(-1); return; }
    if (e.key === "Enter" && suggest.active >= 0) { e.preventDefault(); pickSuggestion(suggest.items[suggest.active]); return; }
    if (e.key === "Escape")    { e.preventDefault(); closeSuggest(); return; }
  }
  if (e.key === "Escape") closeModal();
});

render();
loadStore();
