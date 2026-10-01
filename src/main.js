// FilmRoll Manager – frontend logic
// Talks to the Rust backend (src-tauri/src/) via `invoke`.

const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;
const { open, ask, save } = window.__TAURI__.dialog;
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
  rotateCw:  svg(16, 1.6, `<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>`),
  rotateCcw: svg(16, 1.6, `<polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>`),
  close:     svg(14, 1.8, `<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>`),
  chevronL:  svg(22, 1.8, `<polyline points="15 18 9 12 15 6"/>`),
  chevronR:  svg(22, 1.8, `<polyline points="9 18 15 12 9 6"/>`),
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

const FILE_MANAGER_LABEL = navigator.userAgent.includes("Mac") ? "Open in Finder"
  : navigator.userAgent.includes("Windows") ? "Open in Explorer" : "Open Folder";

// ── Tabs and tools ────────────────────────────────────────────────────────────
const TABS = [
  { id: "manager", label: "Manager", icon: IC.folder },
  { id: "films",   label: "Films",   icon: IC.film },
  { id: "gear",    label: "Gear",    icon: IC.camera },
];

// `ready: false` tools are shown but cannot be used yet
const TOOLS = [
  { id: "reverse", section: "actions", title: "Reverse Order",     desc: "Flip the frame order",      icon: IC.reverse, ready: true },
  { id: "meta",    section: "actions", title: "Bulk Edit Meta Data", desc: "Camera, lens, film, date", icon: IC.meta,    ready: true },
  { id: "rename",  section: "actions", title: "Bulk Rename",       desc: "Build new file names",      icon: IC.rename,  ready: true },
  { id: "sheet",   section: "tools",   title: "Create Contact Sheet", desc: "Printable A4 overview (PDF)", icon: IC.sheet, ready: true },
];
// Sidebar sections, in this order: "Actions" change your files, "Tools" make something new from them
const SECTIONS = [["actions", "Actions"], ["tools", "Tools"]];

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
  rename: { date: "", film: "" },
  sheet: { title: "", subtitle: "", scannedAt: "", orientation: "portrait", columns: "auto", showNames: false },   // values behind the Date and Film Name tags
  template: [],                      // [{ kind, value? }]
  store: { favorites: [], cameras: [], lenses: [], customFilms: [] },          // the user's own data, saved by Rust in library.json
  storeError: null,
  preview: null,         // file name shown in the quick look (Space bar), or null
  edits: {},             // unsaved changes typed into the list: file name → { camera?, lens?, film?, date? }
  selected: new Set(),   // file names chosen in the list; empty = tools work on all files
  anchor: null,          // last clicked file name (for shift-click ranges)
  filmForm: { editing: null, brand: "", name: "", iso: "", type: "Color negative" },   // the Add / Edit Film dialog
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
      S.edits = {};
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
  if (!(await confirmDiscard())) return;
  const selected = await open({ directory: true, multiple: false, title: "Choose the folder with your scans" });
  if (selected) loadFolder(selected);
}

// Re-reads the folder after a tool changed the files (no loading screen)
async function refreshFolder({ keepThumbnails = false } = {}) {
  S.files = await invoke("read_folder", { folder: S.folder });
  const names = new Set(S.files.map((f) => f.name));
  S.selected = new Set([...S.selected].filter((n) => names.has(n)));
  if (!keepThumbnails) resetThumbnails();
  render();
}

// Success messages float at the bottom, can be dismissed, and disappear on their own
let snackTimer = null;
function hideSnackbar() {
  clearTimeout(snackTimer);
  $("snackbar").innerHTML = "";
}
function startSnackTimer() {
  clearTimeout(snackTimer);
  snackTimer = setTimeout(hideSnackbar, 5000);
}
function showNotice(text) {
  $("snackbar").innerHTML = `
    <div class="snackbar" role="status">
      <span>${esc(text)}</span>
      <button class="snackbar-x" data-action="close-snackbar" aria-label="Dismiss">${IC.close}</button>
    </div>`;
  startSnackTimer();
}

// ── Editing values in the list ────────────────────────────────────────────────
const hasEdits = () => Object.keys(S.edits).length > 0;

function onCellInput(input) {
  const name = input.dataset.file, field = input.dataset.edit;
  const file = S.files.find((f) => f.name === name);
  if (!file) return;
  if (input.value === file[field]) {
    if (S.edits[name]) {
      delete S.edits[name][field];
      if (!Object.keys(S.edits[name]).length) delete S.edits[name];
    }
  } else {
    (S.edits[name] ||= {})[field] = input.value;
  }
  input.classList.toggle("changed", input.value !== file[field]);
  updateEditBar();
}

// Shows how many files have unsaved changes; the big tools wait until they are saved or discarded
function updateEditBar() {
  const n = Object.keys(S.edits).length;
  const bar = $("editbar");
  if (bar) {
    bar.hidden = n === 0;
    $("edit-count").textContent = `${n} file${n === 1 ? "" : "s"} changed`;
    $("save-edits").disabled = S.busy;
  }
  document.querySelectorAll(".tool[data-tool]").forEach((b) => {
    const tool = TOOLS.find((t) => t.id === b.dataset.tool);
    b.disabled = !(tool?.ready && S.folder) || n > 0;
  });
  const note = $("sidebar-note");
  if (note) note.hidden = n === 0;
  const folderTools = $("folder-tools");
  if (folderTools) folderTools.hidden = n > 0;   // Rotate, Open in Finder and Change Folder wait for Save or Discard
}

async function saveEdits() {
  if (!hasEdits() || S.busy) return;
  const edits = Object.entries(S.edits).map(([name, fields]) => ({ name, ...fields }));
  S.busy = true; S.error = null;
  updateEditBar(); updateQuickTools();
  try {
    await invoke("write_edits", { folder: S.folder, edits });
    S.edits = {};
    S.busy = false;
    await refreshFolder({ keepThumbnails: true });
    showNotice(`Changes saved to ${edits.length} file${edits.length === 1 ? "" : "s"}.`);
  } catch (e) {
    S.busy = false;
    S.error = String(e);
    render();   // the typed values stay in the list
  }
}

function discardEdits() {
  S.edits = {};
  render();
}

// Before leaving the current folder: ask if unsaved changes may be thrown away
async function confirmDiscard() {
  if (!hasEdits()) return true;
  try {
    return await ask("You have unsaved changes in the file list. Discard them?",
      { title: "Unsaved changes", kind: "warning", okLabel: "Discard", cancelLabel: "Cancel" });
  } catch {
    return false;
  }
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
  updateQuickTools();
  schedulePreload();
}

// Quick tools need a selection – they never act on the whole roll by accident
function updateQuickTools() {
  document.querySelectorAll("[data-rotate]").forEach((b) => { b.disabled = !S.selected.size || S.busy; });
}

async function rotateSelected(clockwise) {
  if (!S.selected.size || S.busy) return;
  const chosen = scopeFiles();
  S.busy = true; S.error = null;
  updateQuickTools();
  try {
    await invoke("rotate_images", { folder: S.folder, files: chosen.map((f) => f.name), clockwise });
    // Only the turned pictures need new previews
    chosen.forEach((f) => { const url = thumbUrls.get(f.path); if (url) { URL.revokeObjectURL(url); thumbUrls.delete(f.path); } });
    clearPreviews(chosen.map((f) => f.path));
    S.busy = false;
    await refreshFolder({ keepThumbnails: true });
    showNotice(`${chosen.length} file${chosen.length === 1 ? "" : "s"} rotated ${clockwise ? "clockwise" : "counterclockwise"}.`);
  } catch (e) {
    S.busy = false;
    S.error = String(e);
    render();
  }
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

// ── Quick look: Space bar shows the selected picture large, like in the Finder ──
const previewBitmaps = new Map();    // path → decoded picture (the last few), ready to be drawn
const previewLoading = new Map();    // path → promise while it loads
const PREVIEW_CACHE = 6;

function clearPreviews(paths) {
  const list = paths || [...previewBitmaps.keys()];
  list.forEach((path) => {
    previewBitmaps.get(path)?.close();
    previewBitmaps.delete(path);
    previewLoading.delete(path);
  });
}

// Rust sends raw pixels (width, height, then RGBA), so nothing has to be unpacked on the way
function loadPreview(path) {
  if (previewBitmaps.has(path)) return Promise.resolve(previewBitmaps.get(path));
  if (previewLoading.has(path)) return previewLoading.get(path);
  const promise = invoke("get_preview", { path })
    .then(async (bytes) => {
      const buffer = bytes instanceof ArrayBuffer ? bytes : new Uint8Array(bytes).buffer;
      const header = new DataView(buffer);
      const width = header.getUint32(0, true), height = header.getUint32(4, true);
      const pixels = new Uint8ClampedArray(buffer, 8, width * height * 4);
      const bitmap = await createImageBitmap(new ImageData(pixels, width, height));
      previewBitmaps.set(path, bitmap);
      while (previewBitmaps.size > PREVIEW_CACHE) {
        const [oldPath, oldBitmap] = previewBitmaps.entries().next().value;
        oldBitmap.close();
        previewBitmaps.delete(oldPath);
      }
      return bitmap;
    })
    .finally(() => previewLoading.delete(path));
  previewLoading.set(path, promise);
  return promise;
}

// As soon as one file is selected, its large picture is prepared in the background,
// so it is usually ready by the time Space is pressed
let preloadTimer = null;
function schedulePreload() {
  clearTimeout(preloadTimer);
  if (S.selected.size !== 1 || S.tab !== "manager") return;
  preloadTimer = setTimeout(() => {
    const file = S.files.find((f) => S.selected.has(f.name));
    if (file) loadPreview(file.path).catch(() => {});
  }, 200);
}

function drawPreview(canvas, bitmap) {
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext("2d").drawImage(bitmap, 0, 0);
}

function renderQuickLook() {
  const host = $("quicklook");
  const file = S.preview && S.files.find((f) => f.name === S.preview);
  if (!file) { S.preview = null; host.innerHTML = ""; return; }
  const index = S.files.indexOf(file);
  const meta = [file.camera, file.lens, file.film, file.date].filter(Boolean).join("  ·  ");
  const ready = previewBitmaps.get(file.path);
  const placeholder = thumbUrls.get(file.path);
  host.innerHTML = `
    <div class="ql-backdrop" data-action="close-preview">
      <div class="ql" role="dialog" aria-modal="true" aria-label="Preview of ${esc(file.name)}">
        <button class="ql-close" data-action="close-preview" aria-label="Close preview">${IC.close}</button>
        <div class="ql-caption">
          <div class="ql-name">${esc(file.name)}<span class="ql-count">${index + 1} of ${S.files.length}</span></div>
          ${meta ? `<div class="ql-meta">${esc(meta)}</div>` : ""}
        </div>
        <button class="ql-nav prev" data-action="preview-prev" aria-label="Previous picture"${index === 0 ? " disabled" : ""}>${IC.chevronL}</button>
        <div class="ql-stage">
          ${ready ? "" : `<img class="ql-img loading" alt="${esc(file.name)}"${placeholder ? ` src="${placeholder}"` : ""}>`}
          <canvas class="ql-img" aria-label="${esc(file.name)}"${ready ? "" : " hidden"}></canvas>
        </div>
        <button class="ql-nav next" data-action="preview-next" aria-label="Next picture"${index === S.files.length - 1 ? " disabled" : ""}>${IC.chevronR}</button>
        <div class="ql-actions">
          <span class="ql-action-label">Rotate left</span>
          <button class="ql-key" data-action="preview-rotate-left" aria-label="Rotate left (L)" title="Rotate left (L)">L</button>
          <button class="ql-key" data-action="preview-rotate-right" aria-label="Rotate right (R)" title="Rotate right (R)">R</button>
          <span class="ql-action-label">Rotate right</span>
        </div>
      </div>
    </div>`;
  const canvas = host.querySelector("canvas");
  const stage = host.querySelector(".ql-stage");
  const show = (bitmap) => {
    if (S.preview !== file.name) return;   // the user has moved on
    drawPreview(canvas, bitmap);
    canvas.hidden = false;
    stage.querySelector("img")?.remove();
    // The neighbours are loaded in the background, so the arrow keys feel instant
    [S.files[index + 1], S.files[index - 1]].filter(Boolean).forEach((n) => loadPreview(n.path).catch(() => {}));
  };
  if (ready) { show(ready); return; }
  loadPreview(file.path).then(show).catch(() => {
    if (S.preview !== file.name) return;
    stage.querySelector("img")?.classList.remove("loading");
    stage.insertAdjacentHTML("beforeend", `<div class="ql-error">This picture could not be shown.</div>`);
  });
}

// ── Rotating from the quick look (R and L) ────────────────────────────────────
// The picture turns on screen at once; the turn is written into the file in the background (in order)
let turnChain = Promise.resolve();     // turns of the picture on screen
let writeChain = Promise.resolve();    // turns written into the files

async function turnBitmap(bitmap, clockwise) {
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.height;
  canvas.height = bitmap.width;
  const ctx = canvas.getContext("2d");
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((clockwise ? 1 : -1) * Math.PI / 2);
  ctx.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);
  return createImageBitmap(canvas);
}

// The small picture in the list is made again from the turned file
function refreshRowThumbnail(path) {
  const url = thumbUrls.get(path);
  if (url) { URL.revokeObjectURL(url); thumbUrls.delete(path); }
  const img = [...document.querySelectorAll(".thumb img")].find((i) => i.dataset.path === path);
  if (!img) return;
  img.classList.remove("loaded");
  thumbQueue.push(img);
  pumpThumbnails();
}

function rotatePreview(clockwise) {
  const file = S.preview && S.files.find((f) => f.name === S.preview);
  if (!file) return;
  const { path, name } = file;

  turnChain = turnChain.then(async () => {
    file.aspect = 1 / (file.aspect || 1.5);   // a quarter turn swaps width and height
    const bitmap = previewBitmaps.get(path);
    if (!bitmap) return;                       // not loaded yet: it is loaded again after the file was written
    const turned = await turnBitmap(bitmap, clockwise);
    bitmap.close();
    previewBitmaps.set(path, turned);
    const canvas = S.preview === name ? document.querySelector(".ql canvas") : null;
    if (canvas) drawPreview(canvas, turned);
  }).catch(() => {});

  writeChain = writeChain
    .then(() => invoke("rotate_images", { folder: S.folder, files: [name], clockwise }))
    .then(() => {
      refreshRowThumbnail(path);
      if (!previewBitmaps.has(path)) { clearPreviews([path]); if (S.preview === name) renderQuickLook(); }
    })
    .catch(async (e) => {
      // The file could not be changed: show what is really in it
      clearPreviews([path]);
      await refreshFolder({ keepThumbnails: true }).catch(() => {});
      if (S.preview === name) {
        renderQuickLook();
        $("quicklook").querySelector(".ql-stage")?.insertAdjacentHTML("beforeend", `<div class="ql-error">${esc(`Could not turn this picture: ${e}`)}</div>`);
      }
    });
}

function scrollRowIntoView(name) {
  [...document.querySelectorAll(".row.file")].find((r) => r.dataset.row === name)?.scrollIntoView({ block: "nearest" });
}

// Selects exactly one file (used by the arrow keys)
function selectOnly(name) {
  S.selected = new Set([name]);
  S.anchor = name;
  updateSelectionUI();
  scrollRowIntoView(name);
}

function openPreview() {
  if (!S.folder || S.loading || S.modal || S.tab !== "manager" || !S.files.length) return;
  if (!S.selected.size) selectOnly(S.files[0].name);   // nothing selected yet: start with the first picture
  const first = S.files.find((f) => S.selected.has(f.name));
  S.preview = S.selected.has(S.anchor) ? S.anchor : first.name;
  renderQuickLook();
}

function closePreview() {
  S.preview = null;
  renderQuickLook();
}

function stepPreview(delta) {
  const index = S.files.findIndex((f) => f.name === S.preview) + delta;
  if (index < 0 || index >= S.files.length) return;
  S.preview = S.files[index].name;
  selectOnly(S.preview);
  renderQuickLook();
}

// Arrow keys in the list move the selection up and down
function moveSelection(delta) {
  if (!S.files.length) return;
  const names = S.files.map((f) => f.name);
  const from = S.selected.has(S.anchor) ? names.indexOf(S.anchor) : -1;
  const next = from < 0 ? (delta > 0 ? 0 : names.length - 1) : Math.min(names.length - 1, Math.max(0, from + delta));
  selectOnly(names[next]);
}

// A field where typing happens (Space must stay a normal space there)
const isTyping = (el) =>
  !!el && (el.isContentEditable || ["TEXTAREA", "SELECT", "BUTTON"].includes(el.tagName) ||
    (el.tagName === "INPUT" && !["checkbox", "radio"].includes(el.type)));

// ── Thumbnails: loaded lazily, three at a time ────────────────────────────────
const thumbUrls = new Map();   // path → object URL
let thumbQueue = [];
let thumbActive = 0;
let thumbObserver = null;

function resetThumbnails() {
  thumbUrls.forEach((url) => URL.revokeObjectURL(url));
  thumbUrls.clear();
  thumbQueue = [];
  clearPreviews();
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

  $("snackbar").classList.toggle("with-sidebar", S.tab === "manager");
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
    updateEditBar();
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
  const tile = (t) => `
    <button class="tool" data-tool="${t.id}" ${t.ready && S.folder && !hasEdits() ? "" : "disabled"}>
      <span class="tool-icon">${t.icon}</span>
      <span class="tool-text"><div class="tool-title">${t.title}</div><div class="tool-desc">${t.desc}</div></span>
      ${t.soon ? `<span class="tool-badge">Soon</span>` : ""}
    </button>`;
  const sections = SECTIONS.map(([id, label]) =>
    `<div class="sidebar-section"><div class="sidebar-head">${label}</div>${TOOLS.filter((t) => t.section === id).map(tile).join("")}</div>`).join("");
  return `<aside class="sidebar">${sections}<p class="sidebar-note" id="sidebar-note"${hasEdits() ? "" : " hidden"}>Save or discard your changes in the list to use these tools.</p>${S.folder ? `<p class="sidebar-hint"><span class="keycap">Space</span> Press to enlarge the selected picture</p>` : ""}</aside>`;
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

// Every value in the list can be typed over; changes are kept until "Save Changes"
const cellValue = (f, field) => S.edits[f.name]?.[field] ?? f[field];
function editCell(f, field) {
  const changed = field in (S.edits[f.name] || {});
  return `<div class="cell editable"><input class="cell-input${changed ? " changed" : ""}" data-edit="${field}" data-file="${esc(f.name)}" value="${esc(cellValue(f, field))}"${field === "date" ? ' placeholder="YYYY-MM-DD HH:MM:SS"' : ""} autocomplete="off" spellcheck="false" aria-label="${field} of ${esc(f.name)}"></div>`;
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
      ${editCell(f, "camera")}${editCell(f, "lens")}${editCell(f, "film")}${editCell(f, "date")}
    </div>`).join("");
  return `
    <section class="explorer" id="dropzone">
      <div class="toolbar">
        <div class="toolbar-folder">${IC.folder}<span class="name" title="${esc(S.folder)}">${esc(folderName(S.folder))}</span><span class="count" id="sel-count">${selectionText()}</span></div>
        <div class="toolbar-spacer"></div>
        <div class="editbar" id="editbar" hidden>
          <span class="editbar-text" id="edit-count"></span>
          <button class="btn btn-ghost" data-action="discard-edits">Discard</button>
          <button class="btn btn-primary" id="save-edits" data-action="save-edits">Save Changes</button>
        </div>
        <div class="folder-tools" id="folder-tools">
          <div class="quick" role="group" aria-label="Quick tools">
            <span class="quick-label">Rotate</span>
            <button class="btn btn-ghost square" data-rotate="ccw" title="Rotate counterclockwise" aria-label="Rotate selected files counterclockwise" disabled>${IC.rotateCcw}</button>
            <button class="btn btn-ghost square" data-rotate="cw" title="Rotate clockwise" aria-label="Rotate selected files clockwise" disabled>${IC.rotateCw}</button>
          </div>
          <span class="tool-sep" aria-hidden="true"></span>
          <button class="btn btn-ghost" data-action="open-folder">${FILE_MANAGER_LABEL}</button>
          <button class="btn btn-ghost" data-action="pick-folder">Change Folder…</button>
        </div>
      </div>
      ${error}
      <div class="filelist">
        <div class="row head"><div class="check"><input type="checkbox" id="check-all" data-check-all aria-label="Select all files"></div><div></div><div>File</div><div>Camera</div><div>Lens</div><div>Film</div><div>Date</div></div>
        ${rows}
      </div>
    </section>`;
}

// ── Films tab ─────────────────────────────────────────────────────────────────
const FILM_TYPES = ["Color negative", "Color slide", "Black & white"];
const filmFullName = (f) => `${f.brand} ${f.name}`.trim();
// The built-in list plus the films the user added
const allFilms = () => [...FILMS, ...S.store.customFilms.map((f) => ({ ...f, custom: true }))];
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
    const films = (v) => (Array.isArray(v) ? v.filter((f) => f && typeof f.name === "string").map((f) => ({
      brand: String(f.brand || ""), name: f.name, iso: String(f.iso || ""), type: FILM_TYPES.includes(f.type) ? f.type : FILM_TYPES[0],
    })) : []);
    S.store = { ...data, favorites: list(data.favorites), cameras: list(data.cameras), lenses: list(data.lenses), customFilms: films(data.customFilms) };
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
          <button class="btn btn-primary" data-action="add-film">Add Film</button>
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
  const shown = allFilms().filter((f) => {
    const full = filmFullName(f);
    if (S.filmFavoritesOnly && !isFavorite(full)) return false;
    const hay = `${full} ${f.iso} ${f.type} ${f.custom ? "custom" : ""}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
  if (!shown.length) {
    box.innerHTML = `<div class="empty-view"><div class="empty-title">${S.filmFavoritesOnly && !S.filmQuery ? "No favorites yet" : "No films found"}</div><div class="empty-sub">${S.filmFavoritesOnly && !S.filmQuery ? "Click the star next to a film to add it here." : "Try a different search."}</div></div>`;
    return;
  }
  // Brands in the order of the built-in list, new brands of your own films come after them
  const brands = [];
  shown.forEach((f) => { const b = f.brand || "Other"; if (!brands.includes(b)) brands.push(b); });
  let html = "";
  brands.forEach((brand) => {
    html += `<div class="film-brand">${esc(brand)}</div>`;
    shown.filter((f) => (f.brand || "Other") === brand).forEach((f) => {
      const full = filmFullName(f), on = isFavorite(full);
      html += `
      <div class="film-row">
        <button class="star${on ? " on" : ""}" data-star="${esc(full)}" aria-pressed="${on}" aria-label="${on ? "Remove from favorites" : "Add to favorites"}: ${esc(full)}">${IC.star}</button>
        <div class="film-name">${esc(f.name)}${f.custom ? `<span class="film-badge">Custom</span>` : ""}</div>
        <div class="film-iso">${f.iso ? `ISO ${esc(f.iso)}` : ""}</div>
        <div class="film-type">${esc(f.type)}</div>
        <div class="film-actions">${f.custom ? `
          <button class="icon-btn" data-film-edit="${esc(full)}" aria-label="Edit ${esc(full)}">${IC.pencil}</button>
          <button class="icon-btn" data-film-remove="${esc(full)}" aria-label="Remove ${esc(full)}">${IC.trash}</button>` : ""}</div>
      </div>`;
    });
  });
  html += `<p class="film-note">Missing a film? Add your own with “Add Film”. You can also type any name in the Film field.</p>`;
  box.innerHTML = html;
}

// Add / edit a film of your own
function openFilmForm(editing = null) {
  const film = editing && S.store.customFilms.find((f) => filmFullName(f) === editing);
  S.filmForm = film
    ? { editing, brand: film.brand, name: film.name, iso: film.iso, type: film.type }
    : { editing: null, brand: "", name: "", iso: "", type: FILM_TYPES[0] };
  S.error = null;
  S.modal = "film";
  renderModal();
}

// The speed is added to the name if it is missing, because the number at the end of the name is what gets written into the image files
function finalFilmName(form) {
  const name = cleanName(form.name), iso = form.iso.trim();
  const hasSpeed = /^\d+$/.test(iso) && new RegExp(`(^|[^0-9])${iso}([^0-9]|$)`).test(name);
  const full = name && /^\d+$/.test(iso) && !hasSpeed ? `${name} ${iso}` : name;
  return full;
}

function updateFilmPreview() {
  const box = $("film-preview");
  if (!box) return;
  const name = finalFilmName(S.filmForm), brand = cleanName(S.filmForm.brand);
  box.innerHTML = name
    ? `It will appear as <strong>${esc(`${brand} ${name}`.trim())}</strong>. The speed at the end of the name is what gets written into the image files.`
    : "Enter a name to see how the film will appear.";
}

function bodyFilm() {
  const f = S.filmForm;
  const text = (id, label, placeholder, attrs = "") => `
    <div class="field-wrap">
      <label class="field-label" for="f-f-${id}">${label}</label>
      <div class="field-row"><input id="f-f-${id}" data-model="filmForm.${id}" type="text" ${attrs} placeholder="${placeholder}" value="${esc(f[id])}" autocomplete="off" spellcheck="false"></div>
    </div>`;
  return `
    <div class="fields">
      ${text("brand", "Brand", "e.g. Kodak, Ilford, or your lab’s own brand")}
      ${text("name", "Name", "e.g. Portra 400")}
      <div class="fields fields-pair">
        ${text("iso", "Speed (ISO)", "e.g. 400", 'inputmode="numeric"')}
        <div class="field-wrap">
          <label class="field-label" for="f-f-type">Type</label>
          <div class="field-row select"><select id="f-f-type" data-model="filmForm.type">
            ${FILM_TYPES.map((t) => `<option value="${t}"${f.type === t ? " selected" : ""}>${t}</option>`).join("")}
          </select></div>
        </div>
      </div>
      <div class="hint-box" id="film-preview"></div>
    </div>`;
}

function saveFilm() {
  const form = S.filmForm;
  const fail = (message) => { S.error = message; renderModal(); };
  if (!cleanName(form.name)) return fail("Please enter the name of the film.");
  const iso = form.iso.trim();
  if (iso && !(/^\d{1,5}$/.test(iso) && Number(iso) > 0)) return fail("The speed (ISO) must be a number, for example 400.");

  // A brand that exists already keeps its spelling, so "kodak" lands under "Kodak"
  const typed = cleanName(form.brand);
  const brand = allFilms().find((f) => f.brand && f.brand.toLowerCase() === typed.toLowerCase())?.brand || typed;
  const film = { brand, name: finalFilmName(form), iso, type: form.type };
  const full = filmFullName(film);
  if (allFilms().some((f) => filmFullName(f).toLowerCase() === full.toLowerCase() && filmFullName(f) !== form.editing)) {
    return fail("This film is already in the list.");
  }

  if (form.editing) {
    S.store.customFilms = S.store.customFilms.map((f) => (filmFullName(f) === form.editing ? film : f));
    S.store.favorites = S.store.favorites.map((n) => (n === form.editing ? full : n));   // a favorite stays a favorite
  } else {
    S.store.customFilms = [...S.store.customFilms, film];
  }
  saveStore();
  S.modal = null;
  S.error = null;
  renderModal();
  renderFilmList();
  showNotice(form.editing ? "Film saved." : "Film added.");
}

async function removeCustomFilm(full) {
  let sure = false;
  try {
    sure = await ask(`Remove “${full}” from your films?`, { title: "Remove film", kind: "warning", okLabel: "Remove", cancelLabel: "Cancel" });
  } catch {
    return;
  }
  if (!sure) return;
  S.store.customFilms = S.store.customFilms.filter((f) => filmFullName(f) !== full);
  S.store.favorites = S.store.favorites.filter((n) => n !== full);
  saveStore();
  renderFilmList();
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
      <div class="page-scroll fill"><div class="gear-grid">${col("cameras")}${col("lenses")}</div></div>
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

// Returns the suggestions plus how many of them come first as "favorites"
// (those are separated from the rest by a thin line).
function suggestionsFor(kind, text) {
  const q = text.trim().toLowerCase();
  const words = q.split(/\s+/).filter(Boolean);
  const matches = (name) => name.toLowerCase() !== q && words.every((w) => name.toLowerCase().includes(w));

  if (kind === "film") {
    const favorites = S.store.favorites.filter(matches);
    // An empty field shows only the favorites; typing searches the whole film list
    if (!words.length) return { items: favorites, favorites: favorites.length };
    const others = allFilms().map(filmFullName).filter((n) => !isFavorite(n) && matches(n));
    return { items: [...favorites, ...others], favorites: favorites.length };
  }
  const list = kind === "camera" ? sortedGear("cameras") : kind === "lens" ? sortedGear("lenses") : [];
  const items = list.filter(matches);
  return { items, favorites: items.length };
}

function closeSuggest() {
  document.querySelectorAll(".suggest").forEach((el) => el.remove());
  suggest = null;
}

function openSuggest(input) {
  const kind = input.dataset.suggest;
  const { items, favorites } = suggestionsFor(kind, input.value);
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
    : items.map((it, i) => `${i === favorites && i > 0 ? `<div class="suggest-sep" role="separator"></div>` : ""}<div class="suggest-item${i === 0 ? " active" : ""}" role="option" data-pick="${esc(it)}">${esc(it)}</div>`).join("");
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
  if (id === "sheet") prepareSheet();
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
    film:    { title: S.filmForm.editing ? "Edit Film" : "Add Film", sub: "Your own film. It shows up in the list and as a suggestion in the Film field.", body: bodyFilm, ok: S.filmForm.editing ? "Save" : "Add Film", wait: "" },
    reverse: { title: "Reverse Order", sub: "Every file swaps its name with the file on the opposite end of the roll. Frame 1 becomes the last frame, and so on.", body: bodyReverse, ok: "Confirm", wait: "Reversing frame order…" },
    meta:    { title: "Bulk Edit Meta Data", sub: "This information is embedded into all image files in the folder. Every field is optional.", body: bodyMeta, ok: "Embed Metadata", wait: "Embedding metadata…" },
    sheet:   { title: "Create Contact Sheet", sub: "All frames on one A4 page, ready to print and file away. It is saved as a PDF on your computer.", body: bodySheet, ok: "Save as PDF…", wait: "Creating the contact sheet…" },
    rename:  { title: "Bulk Rename", sub: "Click a tag to insert it at the cursor. You can type text between tags, too.", body: bodyRename, ok: "Rename Files", wait: "Renaming files…" },
  }[S.modal];

  const inner = S.busy ? `
    <div class="modal-body modal-busy">
      <div class="progress-track"><div class="progress-fill" id="progress-fill"></div></div>
      <p class="loading-msg">${m.wait}</p>
      <p class="loading-sub" id="progress-text">0 %</p>
    </div>` : `
    <div class="modal-head"><p class="modal-title">${m.title}</p><p class="modal-sub">${m.sub}</p></div>
    <div class="modal-body">${m.body()}</div>
    ${S.error ? `<div class="error-banner" role="alert">${esc(S.error)}</div>` : ""}
    <div class="modal-foot">
      <button class="btn btn-ghost" data-action="close-modal">Cancel</button>
      <button class="btn ${S.modal === "rename" ? "btn-success" : "btn-primary"}" id="modal-ok" data-action="confirm-modal">${m.ok}</button>
    </div>`;
  box.innerHTML = `<div class="modal-backdrop"><div class="modal${S.modal === "sheet" ? " wide" : ""}" role="dialog" aria-modal="true" aria-label="${m.title}">${inner}</div></div>`;
  if (!S.busy && S.modal === "rename") mountEditor();
  if (!S.busy && S.modal === "film") { updateFilmPreview(); $("f-f-name")?.focus(); }
  if (!S.busy && S.modal === "sheet") renderSheetPreview();
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

// Create Contact Sheet
// Title and info line start with what the files already say; both can be changed
function prepareSheet() {
  const files = scopeFiles();
  const distinct = (key) => [...new Set(files.map((f) => f[key]).filter(Boolean))];
  const days = [...new Set(distinct("date").map((d) => d.slice(0, 10)))].sort();
  const date = days.length > 1 ? `${days[0]} – ${days[days.length - 1]}` : (days[0] || "");
  S.sheet.title = folderName(S.folder);
  S.sheet.subtitle = [distinct("film").join(" / "), distinct("camera").join(" / "), distinct("lens").join(" / "), date]
    .filter(Boolean).join("  ·  ");
}

const sheetOptions = () => ({
  landscape: S.sheet.orientation === "landscape",
  columns: S.sheet.columns === "auto" ? null : Number(S.sheet.columns),
  showNames: S.sheet.showNames,
  title: S.sheet.title,
  subtitle: S.sheet.subtitle,
  scannedAt: S.sheet.scannedAt,
});

function bodySheet() {
  const text = (id, label, placeholder) => `
    <div class="field-wrap">
      <label class="field-label" for="f-s-${id}">${label}</label>
      <div class="field-row"><input id="f-s-${id}" data-model="sheet.${id}" type="text" placeholder="${placeholder}" value="${esc(S.sheet[id])}" autocomplete="off" spellcheck="false"></div>
    </div>`;
  const select = (id, label, options) => `
    <div class="field-wrap">
      <label class="field-label" for="f-s-${id}">${label}</label>
      <div class="field-row select"><select id="f-s-${id}" data-model="sheet.${id}">
        ${options.map(([value, name]) => `<option value="${value}"${S.sheet[id] === value ? " selected" : ""}>${name}</option>`).join("")}
      </select></div>
    </div>`;
  const columns = [["auto", "Automatic"], ...[4, 5, 6, 7, 8, 9, 10, 12].map((n) => [String(n), `${n} per row`])];
  return `
    <div class="scope">${scopeText()}</div>
    <div class="sheet-layout">
      <div class="sheet-controls fields">
        ${text("title", "Title", "e.g. Roll 12")}
        ${text("subtitle", "Info line", "Film, camera, lens, date")}
        ${text("scannedAt", "Scanned at", "e.g. lab or scanner")}
        ${select("orientation", "Page", [["portrait", "A4 portrait"], ["landscape", "A4 landscape"]])}
        ${select("columns", "Frames per row", columns)}
        <label class="check-line"><input type="checkbox" data-model="sheet.showNames"${S.sheet.showNames ? " checked" : ""}> Show file names</label>
        <div class="hint-box">Everything always fits on a single page. The frame number is printed below each picture.</div>
      </div>
      <div class="sheet-preview" id="sheet-preview" aria-label="Preview of the contact sheet"></div>
    </div>`;
}

// The preview is drawn from the same layout the PDF uses (calculated by Rust), so they always match
let sheetPreviewToken = 0;
let sheetPreviewTimer = null;
function scheduleSheetPreview() {
  clearTimeout(sheetPreviewTimer);
  sheetPreviewTimer = setTimeout(renderSheetPreview, 120);
}

async function renderSheetPreview() {
  const box = $("sheet-preview");
  if (!box || S.modal !== "sheet") return;
  const token = ++sheetPreviewToken;
  const files = scopeFiles();
  let layout;
  try {
    layout = await invoke("contact_sheet_layout", { aspects: files.map((f) => f.aspect || 1.5), options: sheetOptions() });
  } catch (e) {
    box.innerHTML = `<div class="error-banner" role="alert">${esc(String(e))}</div>`;
    return;
  }
  const holder = $("sheet-preview");
  if (token !== sheetPreviewToken || !holder) return;   // a newer preview is on its way

  const scale = Math.min(holder.clientWidth / layout.pageW, 500 / layout.pageH);
  const px = (mm) => `${(mm * scale).toFixed(2)}px`;
  const ptPx = (pts) => `${(pts * 0.3528 * scale).toFixed(2)}px`;   // 1 pt = 0.3528 mm
  const digits = Math.max(2, String(files.length).length);

  let html = `<div class="sheet-page" style="width:${px(layout.pageW)};height:${px(layout.pageH)}">`;
  if (layout.hasHeader) {
    const line = (text, baseline, size, cls) => baseline == null ? "" : `<div class="sheet-text ${cls}" style="left:${px(layout.margin)};top:${px(baseline - size * 0.3528 * 0.85)};width:${px(layout.pageW - 2 * layout.margin)};font-size:${ptPx(size)}">${esc(text)}</div>`;
    html += line(S.sheet.title.trim(), layout.titleBaseline, layout.titlePt, "title");
    html += line(S.sheet.subtitle.trim(), layout.subtitleBaseline, layout.subtitlePt, "subtitle");
    html += line(layout.scanText, layout.scanBaseline, layout.subtitlePt, "subtitle");
    html += `<div class="sheet-rule" style="left:${px(layout.margin)};top:${px(layout.ruleY)};width:${px(layout.pageW - 2 * layout.margin)}"></div>`;
  }
  layout.cells.forEach((cell, i) => {
    const number = String(i + 1).padStart(digits, "0");
    const label = S.sheet.showNames ? `${number}  ${files[i].name}` : number;
    html += `<div class="sheet-cell" style="left:${px(cell.x)};top:${px(cell.y)};width:${px(layout.boxW)};height:${px(layout.boxH)}"><img data-path="${esc(files[i].path)}" alt=""></div>`;
    html += `<div class="sheet-label" style="left:${px(cell.x)};top:${px(cell.y + layout.boxH)};width:${px(layout.boxW)};height:${px(layout.labelH)};line-height:${px(layout.labelH)};font-size:${ptPx(layout.labelPt)}">${esc(label)}</div>`;
  });
  holder.innerHTML = html + `</div>`;

  // Previews come from the thumbnails of the list (loaded three at a time)
  holder.querySelectorAll("img").forEach((img) => {
    const cached = thumbUrls.get(img.dataset.path);
    if (cached) showThumb(img, cached); else { thumbQueue.push(img); }
  });
  pumpThumbnails();
}

// Rename
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
  if (S.modal === "film") { saveFilm(); return; }
  const tool = S.modal;
  const count = scopeFiles().length;
  const files = scopeNames();

  // The contact sheet asks where to save first; closing that window cancels
  let sheetTarget = null;
  if (tool === "sheet") {
    const base = (S.sheet.title.trim() || folderName(S.folder)).replace(/[\/\\:*?"<>|]/g, "-");
    sheetTarget = await save({ title: "Save contact sheet", defaultPath: `${S.folder}/${base} contact sheet.pdf`, filters: [{ name: "PDF", extensions: ["pdf"] }] });
    if (!sheetTarget) return;
  }
  const jobs = {
    reverse: [() => invoke("reverse_order", { folder: S.folder, files }), "Frame order reversed."],
    meta:    [() => invoke("write_metadata", { folder: S.folder, meta: { ...S.meta }, files }), `Metadata written to ${count} file${count === 1 ? "" : "s"}.`],
    sheet:   [() => invoke("save_contact_sheet", { folder: S.folder, files, options: sheetOptions(), target: sheetTarget }), "Contact sheet saved."],
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

  if (ok && tool === "sheet") {   // no file changed, so there is nothing to reload
    S.modal = null;
    renderModal();
    showNotice(`Contact sheet saved: ${sheetTarget.split(/[\\/]/).pop()}`);
  } else if (ok) {
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
    if (path) confirmDiscard().then((ok) => { if (ok) loadFolder(path); });
  }
});

// ── Event wiring (one delegated listener for everything) ──────────────────────
document.addEventListener("click", (e) => {
  if (S.preview) {
    const hit = e.target.closest("[data-action]");
    const emptySpace = ["ql-backdrop", "ql", "ql-stage"].some((c) => e.target.classList.contains(c));   // the dark area around the picture
    if (hit?.dataset.action === "close-preview" && (hit.classList.contains("ql-close") || emptySpace)) closePreview();
    else if (hit?.dataset.action === "preview-prev") stepPreview(-1);
    else if (hit?.dataset.action === "preview-next") stepPreview(1);
    else if (hit?.dataset.action === "preview-rotate-left") rotatePreview(false);
    else if (hit?.dataset.action === "preview-rotate-right") rotatePreview(true);
    return;
  }
  // File list: click a row to select, Cmd/Ctrl-click to add, Shift-click for a range
  const row = e.target.closest(".row.file");
  if (row && !e.target.closest("input, button")) { selectRow(row.dataset.row, e); return; }
  const t = e.target.closest("[data-action],[data-film-edit],[data-film-remove],[data-rotate],[data-tab],[data-tool],[data-star],[data-gear-edit],[data-gear-remove],[data-insert],[data-sep],[data-remove]");
  if (!t || t.disabled) return;
  if (t.dataset.tab && t.dataset.tab !== S.tab) { S.tab = t.dataset.tab; render(); }
  if (t.dataset.tool) openTool(t.dataset.tool);
  if (t.dataset.rotate) rotateSelected(t.dataset.rotate === "cw");
  if (t.dataset.star) toggleFavorite(t.dataset.star);
  if (t.dataset.action === "gear-add") addGear(t.dataset.kind);
  if (t.dataset.gearEdit) { gearEdit = { kind: t.dataset.gearEdit, name: t.dataset.name }; renderGearLists(); }
  if (t.dataset.gearRemove) removeGear(t.dataset.gearRemove, t.dataset.name);
  if (t.dataset.action === "toggle-fav-filter") { S.filmFavoritesOnly = !S.filmFavoritesOnly; render(); }
  if (t.dataset.action === "pick-folder") pickFolder();
  if (t.dataset.action === "open-folder") invoke("open_folder", { folder: S.folder }).catch((err) => { S.error = String(err); render(); });
  if (t.dataset.action === "save-edits") saveEdits();
  if (t.dataset.action === "add-film") openFilmForm();
  if (t.dataset.filmEdit) openFilmForm(t.dataset.filmEdit);
  if (t.dataset.filmRemove) removeCustomFilm(t.dataset.filmRemove);

  if (t.dataset.action === "close-snackbar") hideSnackbar();
  if (t.dataset.action === "discard-edits") discardEdits();
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

// Keep the message while the mouse is on it
$("snackbar").addEventListener("mouseover", () => clearTimeout(snackTimer));
$("snackbar").addEventListener("mouseout", () => { if ($("snackbar").firstElementChild) startSnackTimer(); });

// Double click on a row also opens the quick look
document.addEventListener("dblclick", (e) => {
  const row = e.target.closest(".row.file");
  if (!row || e.target.closest("input, button") || S.modal || S.preview) return;
  selectOnly(row.dataset.row);
  openPreview();
});

// Text fields write straight into the state (data-model="group.key")
document.addEventListener("input", (e) => {
  if (e.target.dataset?.edit) { onCellInput(e.target); return; }
  if (e.target.id === "film-search") { S.filmQuery = e.target.value; renderFilmList(); return; }
  const model = e.target.dataset?.model;
  if (!model) return;
  const [group, key] = model.split(".");
  S[group][key] = e.target.type === "checkbox" ? e.target.checked : e.target.value;
  if (S.modal === "rename") renderPreview();
  if (S.modal === "film") updateFilmPreview();
  if (S.modal === "sheet") scheduleSheetPreview();
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
  // Quick look is open: Space or Esc closes it, the arrow keys browse
  if (S.preview) {
    if (e.key === " " || e.key === "Escape") { e.preventDefault(); closePreview(); }
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); stepPreview(-1); }
    else if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); stepPreview(1); }
    else if (!e.metaKey && !e.ctrlKey && !e.altKey && (e.key === "r" || e.key === "R")) { e.preventDefault(); if (!e.repeat) rotatePreview(true); }
    else if (!e.metaKey && !e.ctrlKey && !e.altKey && (e.key === "l" || e.key === "L")) { e.preventDefault(); if (!e.repeat) rotatePreview(false); }
    return;
  }
  if (e.key === "Enter" && S.modal === "film" && e.target.tagName === "INPUT") { e.preventDefault(); saveFilm(); return; }
  // Space does not scroll the page any more; in the file list it opens the quick look
  if (e.key === " " && !isTyping(e.target) && !S.modal) {
    e.preventDefault();
    if (!e.repeat) openPreview();
    return;
  }
  if ((e.key === "ArrowDown" || e.key === "ArrowUp") && !isTyping(e.target) && !S.modal && S.tab === "manager" && S.folder && !S.loading) {
    e.preventDefault();
    moveSelection(e.key === "ArrowDown" ? 1 : -1);
    return;
  }
  const cellField = e.target.dataset?.edit;
  if (cellField && ["Enter", "ArrowDown", "ArrowUp"].includes(e.key)) {
    e.preventDefault();   // moves to the same column in the next or previous row
    const cells = [...document.querySelectorAll(`[data-edit="${cellField}"]`)];
    const next = cells[cells.indexOf(e.target) + (e.key === "ArrowUp" ? -1 : 1)];
    if (next) { next.focus(); next.select(); }
    return;
  }
  if (cellField && e.key === "Escape") {   // put the original value back
    e.preventDefault();
    const file = S.files.find((f) => f.name === e.target.dataset.file);
    e.target.value = file ? file[cellField] : "";
    onCellInput(e.target);
    return;
  }
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
