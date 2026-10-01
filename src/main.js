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

// Re-reads the folder after a tool changed the files (no loading screen)
async function refreshFolder() {
  S.files = await invoke("read_folder", { folder: S.folder });
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
  if (S.tab === "films")   view.innerHTML = viewPlaceholder(IC.filmBig, "Films", "Your film database with favorites will live here.");
  if (S.tab === "gear")    view.innerHTML = viewPlaceholder(IC.cameraBig, "Gear", "Your cameras and lenses will live here.");
  if (S.tab === "manager") {
    const list = document.querySelector(".filelist");
    if (list) list.scrollTop = scroll;
    observeThumbnails();
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
      <div id="notice"></div>
      <div class="filelist">
        <div class="row head"><div></div><div>File</div><div>Camera</div><div>Lens</div><div>Film</div><div>Date</div></div>
        ${rows}
      </div>
    </section>`;
}

// ── Tool dialogs ──────────────────────────────────────────────────────────────
function openTool(id) {
  if (S.busy) return;
  S.error = null;
  if (id === "rename") {
    const first = S.files[0] || {};
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
  const n = S.files.length;
  const width = Math.max(2, String(n).length);
  const pad = (i) => String(i).padStart(width, "0");
  const rows = S.files.map((f, i) => {
    const donor = S.files[n - 1 - i];
    const next = `${stem(donor.name)}.${ext(f.name)}`;
    return `<div class="rev-row"><span class="rev-num">${pad(i + 1)} → ${pad(n - i)}</span><span class="rev-old" title="${esc(f.name)}">${esc(f.name)}</span><span class="rev-arr">→</span><span class="rev-new" title="${esc(next)}">${esc(next)}</span></div>`;
  }).join("");
  return `<div class="rev-list">${rows}</div>`;
}

// Bulk Edit Meta Data
function bodyMeta() {
  const field = (id, label, icon, type, placeholder) => `
    <div class="field-wrap">
      <label class="field-label" for="f-${id}">${label}</label>
      <div class="field-row">
        <span class="field-icon">${icon}</span>
        <input id="f-${id}" data-model="meta.${id}" type="${type}" placeholder="${placeholder}" value="${esc(S.meta[id])}" autocomplete="off" spellcheck="false">
      </div>
    </div>`;
  return `
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
        <input id="f-r-${id}" data-model="rename.${id}" type="${type}" placeholder="${placeholder}" value="${esc(S.rename[id])}" autocomplete="off" spellcheck="false">
      </div>
    </div>`;
  return `
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
  const rows = S.files.slice(0, 6).map((f, i) => {
    const next = `${nameFor(i)}.${ext(f.name)}`;
    return `<div class="preview-row"><span class="prev-old" title="${esc(f.name)}">${esc(f.name)}</span><span class="prev-arr">→</span><span class="prev-new" title="${esc(next)}">${esc(next)}</span></div>`;
  }).join("");
  const more = S.files.length > 6 ? `<div class="preview-more">and ${S.files.length - 6} more</div>` : "";
  box.innerHTML = rows + more;
}

// Runs the chosen tool with a progress bar, then refreshes the list
async function confirmModal() {
  if (S.busy || !S.modal) return;
  const tool = S.modal;
  const count = S.files.length;
  const jobs = {
    reverse: [() => invoke("reverse_order", { folder: S.folder }), "Frame order reversed."],
    meta:    [() => invoke("write_metadata", { folder: S.folder, meta: { ...S.meta } }), `Metadata written to ${count} file${count === 1 ? "" : "s"}.`],
    rename:  [() => invoke("rename_files", { folder: S.folder, parts: S.template, date: S.rename.date, film: S.rename.film }), `${count} file${count === 1 ? "" : "s"} renamed.`],
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
  const t = e.target.closest("[data-action],[data-tab],[data-tool],[data-insert],[data-sep],[data-remove]");
  if (!t || t.disabled) return;
  if (t.dataset.tab && t.dataset.tab !== S.tab) { S.tab = t.dataset.tab; render(); }
  if (t.dataset.tool) openTool(t.dataset.tool);
  if (t.dataset.action === "pick-folder") pickFolder();
  if (t.dataset.action === "close-modal") closeModal();
  if (t.dataset.action === "confirm-modal") confirmModal();
  if (t.dataset.insert) insertAtCursor(makeChip(t.dataset.insert));
  if (t.dataset.sep) { $("tpl-editor").focus(); document.execCommand("insertText", false, t.dataset.sep); syncTemplate(); }
  if (t.hasAttribute("data-remove")) { t.closest(".tag").remove(); syncTemplate(); }
});

// Text fields write straight into the state (data-model="group.key")
document.addEventListener("input", (e) => {
  const model = e.target.dataset?.model;
  if (!model) return;
  const [group, key] = model.split(".");
  S[group][key] = e.target.value;
  if (S.modal === "rename") renderPreview();
});

document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });

render();
