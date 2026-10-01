// FilmRoll Manager – frontend logic
// Talks to the Rust backend (src-tauri/src/processor.rs) via `invoke`.

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
const IC = {
  folder:   svg(40, 1.3, `<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>`),
  folderSm: svg(30, 1.5, `<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>`),
  camera:   svg(14, 1.8, `<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>`),
  aperture: svg(14, 1.8, `<circle cx="12" cy="12" r="10"/><line x1="14.31" y1="8" x2="20.05" y2="17.94"/><line x1="9.69" y1="8" x2="21.17" y2="8"/><line x1="7.38" y1="12" x2="13.12" y2="2.06"/><line x1="9.69" y1="16" x2="3.95" y2="6.06"/><line x1="14.31" y1="16" x2="2.83" y2="16"/><line x1="16.62" y1="12" x2="10.88" y2="21.94"/>`),
  film:     svg(14, 1.8, `<rect x="2" y="2" width="20" height="20" rx="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="7" x2="7" y2="7"/><line x1="17" y1="7" x2="22" y2="7"/><line x1="17" y1="17" x2="22" y2="17"/><line x1="2" y1="17" x2="7" y2="17"/>`),
  calendar: svg(14, 1.8, `<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>`),
  clock:    svg(14, 1.8, `<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>`),
  checkSq:  svg(36, 1.4, `<polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>`),
  rotateCcw:svg(36, 1.4, `<polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.35"/>`),
  done:     svg(48, 1.4, `<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>`),
};

// ── Template tags ─────────────────────────────────────────────────────────────
const TAGS = {
  date:   { label: "Date",      color: "blue" },
  num:    { label: "#",         color: "green" },
  imgnum: { label: "IMG-#",     color: "green" },
  film:   { label: "Film Name", color: "orange" },
};

// ── State ─────────────────────────────────────────────────────────────────────
const today = (() => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
})();

const initialState = () => ({
  step: 1,               // 1–4, 5 = done
  folder: null,          // absolute path
  files: [],             // filenames in processing order
  order: null,           // "skip" | "reverse"
  camera: "", lens: "", film: "", date: today, time: "12:00",
  template: [],          // [{kind, value?}]
  busy: false,
  error: null,
});
let S = initialState();

// ── Helpers ───────────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const folderName = (p) => (p ? p.split(/[\\/]/).filter(Boolean).pop() : "");
const ext = (name) => name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : "";

// Must match `sanitize` / `film_slug` in processor.rs
const sanitize = (t) => t.replace(/[\/\\:*?"<>|\u0000-\u001f]/g, "-");
const filmSlug = (f) => { const s = f.trim().split(/\s+/).filter(Boolean).join("-"); return s ? sanitize(s) : "Film"; };

function nameFor(index, template = S.template) {
  const num = String(index + 1).padStart(2, "0");
  return template.map((p) => {
    switch (p.kind) {
      case "date":   return S.date;
      case "num":    return num;
      case "imgnum": return `IMG-${num}`;
      case "film":   return filmSlug(S.film);
      default:       return sanitize(p.value || "");
    }
  }).join("").trim();
}

async function loadFolder(path) {
  try {
    S.files  = await invoke("list_images", { folder: path });
    S.folder = path;
    S.error  = S.files.length ? null : "This folder contains no JPG, PNG or TIFF images.";
  } catch (e) {
    S.error = String(e);
  }
  render();
}

// ── Rendering ─────────────────────────────────────────────────────────────────
function render() {
  renderSteps();
  renderNav();
  const c = $("content");
  const error = S.error ? `<div class="error-banner" role="alert">${esc(S.error)}</div>` : "";
  if (S.step === 1) c.innerHTML = viewFolder() + error;
  if (S.step === 2) c.innerHTML = viewOrder() + error;
  if (S.step === 3) c.innerHTML = viewMetadata() + error;
  if (S.step === 4) { c.innerHTML = viewRename() + error; mountEditor(); }
  if (S.step === 5) c.innerHTML = viewDone();
  $("bottom").hidden = S.step === 5;
}

function renderSteps() {
  [1, 2, 3, 4].forEach((i) => {
    const state = i < S.step ? " done" : i === S.step ? " active" : "";
    $(`sn${i}`).className = "step-num" + state;
    $(`sn${i}`).textContent = i < S.step ? "✓" : i;
    $(`st${i}`).className = "step-text" + state;
    if ($(`sl${i}`)) $(`sl${i}`).className = "step-line" + (i < S.step ? " done" : "");
  });
}

function renderNav() {
  if (S.step === 5) return;
  const back = $("btn-back"), next = $("btn-next");
  back.hidden = S.step === 1 || S.busy;
  next.hidden = S.busy;
  $("step-counter").textContent = `Step ${S.step} of 4`;

  next.className = "btn btn-primary";
  next.disabled = false;
  if (S.step === 1) {
    next.textContent = "Continue →";
    next.disabled = !S.folder || S.files.length === 0;
  } else if (S.step === 2) {
    next.textContent = S.order === "reverse" ? "Reverse & Continue →" : "Continue →";
    next.disabled = !S.order;
  } else if (S.step === 3) {
    next.textContent = "Embed & Continue →";
  } else if (S.step === 4) {
    next.className = "btn btn-success";
    next.textContent = S.template.length ? "✓ Rename & Finish" : "✓ Finish";
  }
}

// ── Step 1 – Select folder ────────────────────────────────────────────────────
function viewFolder() {
  const header = `
    <p class="step-heading">Select Folder</p>
    <p class="step-sub">Choose the folder containing your lab scans.</p>`;
  if (S.folder) {
    return header + `
      <div class="folder-card">
        <span class="icon">${IC.folderSm}</span>
        <div class="folder-info">
          <div class="folder-name" title="${esc(S.folder)}">${esc(folderName(S.folder))}</div>
          <div class="folder-count">${S.files.length} image${S.files.length === 1 ? "" : "s"} found</div>
        </div>
        <button class="link-btn" data-action="pick-folder">Change…</button>
      </div>`;
  }
  return header + `
    <div class="dropzone" id="dropzone" data-action="pick-folder">
      <div class="dz-icon">${IC.folder}</div>
      <div class="dz-title">Drop folder here</div>
      <div class="dz-sub">or click to browse</div>
    </div>`;
}

async function pickFolder() {
  const selected = await open({ directory: true, multiple: false, title: "Choose the folder with your scans" });
  if (selected) loadFolder(selected);
}

// Native drag & drop from Finder / Explorer
getCurrentWebview().onDragDropEvent((event) => {
  if (S.step !== 1 || S.busy) return;
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

// ── Step 2 – Frame order ──────────────────────────────────────────────────────
function viewOrder() {
  const sel = (v) => (S.order === v ? " selected" : "");
  return `
    <p class="step-heading">Fix Frame Order</p>
    <p class="step-sub">Were your frames scanned in the correct order by the lab?</p>
    <div class="order-grid">
      <button class="order-card${sel("skip")}" data-order="skip">
        <div class="order-icon">${IC.checkSq}</div>
        <div class="order-title">Looks correct</div>
        <div class="order-desc">The frames are already in the right order. Skip this step.</div>
      </button>
      <button class="order-card${sel("reverse")}" data-order="reverse">
        <div class="order-icon">${IC.rotateCcw}</div>
        <div class="order-title">Reverse Order</div>
        <div class="order-desc">The frames are flipped. Rename files so frame 1 comes first.</div>
      </button>
    </div>`;
}

// ── Step 3 – Metadata ─────────────────────────────────────────────────────────
function viewMetadata() {
  const field = (id, label, icon, type, placeholder, value) => `
    <div class="field-wrap">
      <label class="field-label" for="f-${id}">${label}</label>
      <div class="field-row">
        <span class="field-icon">${icon}</span>
        <input id="f-${id}" data-field="${id}" type="${type}" placeholder="${placeholder}" value="${esc(value)}" autocomplete="off" spellcheck="false">
      </div>
    </div>`;
  return `
    <p class="step-heading">Add Metadata</p>
    <p class="step-sub">This information will be embedded into your image files. Every field is optional.</p>
    <div class="fields">
      ${field("camera", "Camera", IC.camera, "text", "e.g. Canon AE-1, Contax T2", S.camera)}
      ${field("lens", "Lens", IC.aperture, "text", "e.g. 50mm f/1.4, 35mm f/2.8", S.lens)}
      ${field("film", "Film", IC.film, "text", "e.g. Kodak Gold 200, Ilford HP5", S.film)}
      <div>
        ${field("date", "Shoot Date", IC.calendar, "date", "", S.date)}
        <div class="hint-box"><strong>Why does this matter?</strong> Apps like Apple Photos or Google Photos sort images by the date embedded in the file. Without a date, your scans appear at a random spot in your library timeline.</div>
      </div>
      <div>
        ${field("time", "Start Time", IC.clock, "time", "", S.time)}
        <div class="hint-box">Each file is automatically offset by <strong>3 seconds</strong> from the previous one, so the exact frame order is preserved in your photo library.</div>
      </div>
    </div>`;
}

// ── Step 4 – Rename ───────────────────────────────────────────────────────────
function viewRename() {
  const buttons = Object.entries(TAGS).map(([kind, t]) =>
    `<button class="tag ${t.color}" data-insert="${kind}" id="ins-${kind}">${t.label}</button>`).join("");
  return `
    <p class="step-heading">Rename Files</p>
    <p class="step-sub">Click a tag to insert it at the cursor. You can type text between tags, too.</p>
    <div style="margin-top:20px">
      <label class="field-label">Filename Template</label>
      <div class="tpl-editor" id="tpl-editor" contenteditable="true" spellcheck="false" style="margin-top:4px"></div>
      <div class="insert-row">
        <span class="insert-label">Insert:</span>
        ${buttons}
        <span class="insert-label" style="margin-left:6px">Separator:</span>
        <button class="sep-btn" data-sep="_">_</button>
        <button class="sep-btn" data-sep="-">-</button>
      </div>
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
  // Rebuild what the user had before (e.g. after going back and forth)
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
      const value = n.textContent.replace(/\u00A0/g, " ");
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
  renderNav();
}

function renderPreview() {
  const box = $("preview");
  if (!box) return;
  if (!S.template.length) {
    box.innerHTML = `<div class="preview-empty">Add tags above to see how your files will be named.</div>`;
    return;
  }
  const rows = S.files.slice(0, 6).map((f, i) => {
    const next = `${nameFor(i)}.${ext(f)}`;
    return `<div class="preview-row"><span class="prev-old" title="${esc(f)}">${esc(f)}</span><span class="prev-arr">→</span><span class="prev-new" title="${esc(next)}">${esc(next)}</span></div>`;
  }).join("");
  const more = S.files.length > 6 ? `<div class="preview-more">and ${S.files.length - 6} more</div>` : "";
  box.innerHTML = rows + more;
}

// ── Done ──────────────────────────────────────────────────────────────────────
function viewDone() {
  const example = S.files[0] || "—";
  const row = (k, v) => `<div class="summary-row"><span>${k}</span><span title="${esc(v)}">${esc(v)}</span></div>`;
  return `
    <div class="success">
      <div class="success-icon">${IC.done}</div>
      <h2>All done!</h2>
      <p>Your film roll is ready to import into Apple Photos, Lightroom, or any app of your choice.</p>
      <div class="summary">
        ${row("Folder", folderName(S.folder))}
        ${row("Images", String(S.files.length))}
        ${row("Frame order", S.order === "reverse" ? "Reversed" : "Kept as-is")}
        ${row("Camera", S.camera || "—")}
        ${row("Lens", S.lens || "—")}
        ${row("Film", S.film || "—")}
        ${row("Shoot date", `${S.date} ${S.time}`)}
        ${row("First file", example)}
      </div>
      <button class="btn btn-primary" style="margin-top:22px" data-action="restart">Process Another Roll</button>
    </div>`;
}

// ── Running backend operations with a progress bar ────────────────────────────
async function runWithProgress(message, task) {
  S.busy = true; S.error = null;
  renderNav();
  $("content").innerHTML = `
    <div class="loading-view">
      <div class="progress-track"><div class="progress-fill" id="progress-fill"></div></div>
      <p class="loading-msg">${message}</p>
      <p class="loading-sub" id="progress-text">0 %</p>
    </div>`;
  const unlisten = await listen("progress", (e) => {
    const pct = Math.round(e.payload * 100);
    $("progress-fill").style.width = `${pct}%`;
    $("progress-text").textContent = `${pct} %`;
  });
  try {
    await task();
    await new Promise((r) => setTimeout(r, 300)); // let the bar visibly reach 100 %
    S.files = await invoke("list_images", { folder: S.folder });
    return true;
  } catch (e) {
    S.error = String(e);
    return false;
  } finally {
    unlisten();
    S.busy = false;
  }
}

async function next() {
  if (S.busy) return;
  let ok = true;

  if (S.step === 2 && S.order === "reverse") {
    ok = await runWithProgress("Reversing frame order…", () =>
      invoke("reverse_order", { folder: S.folder }));
  } else if (S.step === 3) {
    ok = await runWithProgress("Embedding metadata…", () =>
      invoke("write_metadata", {
        folder: S.folder,
        meta: { camera: S.camera, lens: S.lens, film: S.film, date: S.date, time: S.time },
      }));
  } else if (S.step === 4 && S.template.length) {
    ok = await runWithProgress("Renaming files…", () =>
      invoke("rename_files", { folder: S.folder, parts: S.template, date: S.date, film: S.film }));
  }

  if (ok) { S.step += 1; S.error = null; }
  render();
}

function back() {
  if (S.busy) return;
  S.step = Math.max(1, S.step - 1);
  S.error = null;
  render();
}

// ── Event wiring (one delegated listener for everything) ──────────────────────
$("btn-next").addEventListener("click", next);
$("btn-back").addEventListener("click", back);

document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-action],[data-order],[data-insert],[data-sep],[data-remove]");
  if (!t) return;
  if (t.dataset.action === "pick-folder") pickFolder();
  if (t.dataset.action === "restart") { S = initialState(); render(); }
  if (t.dataset.order) {
    S.order = t.dataset.order;
    document.querySelectorAll(".order-card").forEach((c) => c.classList.toggle("selected", c === t));
    renderNav();
  }
  if (t.dataset.insert) insertAtCursor(makeChip(t.dataset.insert));
  if (t.dataset.sep) { $("tpl-editor").focus(); document.execCommand("insertText", false, t.dataset.sep); syncTemplate(); }
  if (t.hasAttribute("data-remove")) { t.closest(".tag").remove(); syncTemplate(); }
});

document.addEventListener("input", (e) => {
  const key = e.target.dataset?.field;
  if (key) S[key] = e.target.value;
});

render();
