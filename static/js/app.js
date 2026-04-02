"use strict";
/**
 * Fractal Explorer – Main Application
 *
 * State management, UI controls, canvas interaction, worker communication,
 * and REST API calls for persistence.
 */

// ---------------------------------------------------------------------------
// STATE
// The internal zoom factors zoomX/zoomY relate to the display zoom D as:
//   zoomX = 4.0 / (width  * D_x)   (same convention as original Java app)
//   dx    = zoomX * cos(rotation)
// Complex coordinate of pixel (px, py):
//   cr = (px - origX)*dx + (py - origY)*dy
//   ci = (px - origX)*dy - (py - origY)*dx
// ---------------------------------------------------------------------------

const state = {
  formula:    "Mandelbrot",
  isJulia:    false,

  // Pixel anchor point (origX, origY correspond to complex origin)
  origX: 256, origY: 256,
  // Internal zoom factors
  zoomX: 4.0 / 512, zoomY: 4.0 / 512,
  rotation: 0,    // radians

  pertX: 0, pertY: 0,
  juliaX: -0.7, juliaY: 0.27,
  iterations: 120,
  bailout: 4.0,

  inColor:  "none",
  outColor: "iter",

  width: 512, height: 512,
  renderMode: "squared",
  lockRatio: true,

  palette: [],  // 256 × [r,g,b]

  // Backup for restoring view when leaving Julia mode
  backup: null,
};

// Derived dx/dy
function getDx() { return state.zoomX * Math.cos(state.rotation); }
function getDy() { return state.zoomY * Math.sin(state.rotation); }

// Complex coordinate of screen center
function getOriginX() {
  const dx = getDx(), dy = getDy();
  return (state.width / 2 - state.origX) * dx + (state.height / 2 - state.origY) * dy;
}
function getOriginY() {
  const dx = getDx(), dy = getDy();
  return (state.width / 2 - state.origX) * dy - (state.height / 2 - state.origY) * dx;
}

// Display zoom (D = 1 → default view spanning ±2)
function getDisplayZoomX() { return 4.0 / (state.width  * state.zoomX); }
function getDisplayZoomY() { return 4.0 / (state.height * state.zoomY); }

// Set internal zoom from display zoom
function setDisplayZoom(dx, dy) {
  state.zoomX = 4.0 / (state.width  * dx);
  state.zoomY = 4.0 / (state.height * dy);
}

// Set complex center coordinate, updating pixel anchor
function setOriginXY(cx, cy) {
  const dx = getDx(), dy = getDy();
  const denom = dx * dx + dy * dy;
  if (denom === 0) return;
  state.origX = Math.round(state.width  / 2 - (cx * dx + cy * dy) / denom);
  state.origY = Math.round(state.height / 2 - (cx * dy - cy * dx) / denom);
}

// Default view for current size
function resetView(resetColors) {
  state.rotation = 0;
  const z = state.lockRatio
    ? 4.0 / Math.min(state.width, state.height)
    : null;
  state.zoomX = z !== null ? z : 4.0 / state.width;
  state.zoomY = z !== null ? z : 4.0 / state.height;
  state.origX = Math.round(state.width  / 2);
  state.origY = Math.round(state.height / 2);
  state.pertX = 0; state.pertY = 0;
  state.juliaX = 0; state.juliaY = 0;
  state.iterations = 120;
  state.bailout = 4.0;
  if (resetColors) {
    state.inColor  = "none";
    state.outColor = "iter";
    state.palette  = buildGreyscale();
  }
}

// ---------------------------------------------------------------------------
// PALETTE PRESETS
// ---------------------------------------------------------------------------

function sineGradient(Ar, Br, pr, Ag, Bg, pg, Ab, Bb, pb) {
  const p = [];
  for (let f = 0; f < 256; f++) {
    const r = Math.round(Ar + Br * Math.sin(2 * Math.PI * (f + pr) / 256));
    const g = Math.round(Ag + Bg * Math.sin(2 * Math.PI * (f + pg) / 256));
    const b = Math.round(Ab + Bb * Math.sin(2 * Math.PI * (f + pb) / 256));
    p.push([
      Math.max(0, Math.min(255, r)),
      Math.max(0, Math.min(255, g)),
      Math.max(0, Math.min(255, b)),
    ]);
  }
  return p;
}

function buildGreyscale() {
  const p = [];
  for (let f = 0; f < 256; f++) {
    const g = Math.round(128 + 127 * Math.sin(2 * Math.PI * (f + 226) / 256));
    p.push([g, g, g]);
  }
  return p;
}

const PALETTE_PRESETS = {
  Greyscale: buildGreyscale,
  Red:       () => sineGradient(180,75,0,  30,30,0,   20,20,0),
  Fire:      () => sineGradient(200,55,0,  100,100,64, 10,10,0),
  Blue:      () => sineGradient(20,20,0,   80,80,64,  200,55,0),
  Green:     () => sineGradient(20,20,0,   180,75,0,   30,30,0),
  Sunset:    () => sineGradient(200,55,0,  80,80,128, 160,65,48),
  Ocean:     () => sineGradient(10,10,0,   130,70,64, 200,55,0),
};

function randomPalette() {
  const rand = (min, max) => min + Math.floor(Math.random() * (max - min + 1));
  const Br = 64 + rand(0,63), Ar = Br + rand(0, 255 - 2*Br), pr = rand(0,255);
  const Bg = 64 + rand(0,63), Ag = Bg + rand(0, 255 - 2*Bg), pg = rand(0,255);
  const Bb = 64 + rand(0,63), Ab = Bb + rand(0, 255 - 2*Bb), pb = rand(0,255);
  return sineGradient(Ar,Br,pr, Ag,Bg,pg, Ab,Bb,pb);
}

// ---------------------------------------------------------------------------
// WEB WORKER
// ---------------------------------------------------------------------------

const worker = new Worker("js/worker.js");
let renderId = 0;

function buildRenderConfig() {
  return {
    width:      state.width,
    height:     state.height,
    origX:      state.origX,
    origY:      state.origY,
    dx:         getDx(),
    dy:         getDy(),
    pertX:      state.pertX,
    pertY:      state.pertY,
    juliaX:     state.juliaX,
    juliaY:     state.juliaY,
    isJulia:    state.isJulia,
    formula:    state.formula,
    iterations: state.iterations,
    bailout:    state.bailout,
    inColor:    state.inColor,
    outColor:   state.outColor,
    palette:    state.palette,
    renderMode: state.renderMode,
  };
}

function startRender() {
  renderId++;
  worker.postMessage({ type: "render", id: renderId, config: buildRenderConfig() });
}

// Julia preview worker (separate instance for the overlay)
const juliaWorker = new Worker("js/worker.js");
let juliaRenderId = 0;

function startJuliaPreview(juliaRe, juliaIm) {
  juliaRenderId++;
  const sz = 150;
  const z = 4.0 / sz;
  juliaWorker.postMessage({
    type: "render",
    id: juliaRenderId,
    config: {
      width: sz, height: sz,
      origX: sz / 2, origY: sz / 2,
      dx: z, dy: 0,
      pertX: 0, pertY: 0,
      juliaX: juliaRe, juliaY: juliaIm,
      isJulia: true,
      formula:    state.formula,
      iterations: Math.min(state.iterations, 80),
      bailout:    state.bailout,
      inColor:    "none",
      outColor:   "iter",
      palette:    buildGreyscale(),
      renderMode: "linear",
    },
  });
}

// ---------------------------------------------------------------------------
// CANVAS & DRAWING
// ---------------------------------------------------------------------------

const canvas      = document.getElementById("fractal-canvas");
const ctx         = canvas.getContext("2d");
const juliaCanvas = document.getElementById("julia-preview-canvas");
const juliaCtx    = juliaCanvas.getContext("2d");

function applyCanvasSize() {
  canvas.width  = state.width;
  canvas.height = state.height;
}

worker.onmessage = function (e) {
  const msg = e.data;
  if (msg.id !== renderId) return;
  if (msg.type === "progress" || msg.type === "done") {
    const imgData = new ImageData(msg.buffer, state.width, state.height);
    ctx.putImageData(imgData, 0, 0);
  }
  if (msg.type === "done") {
    setStatus("Ready");
  } else {
    setStatus(`Rendering… row ${msg.upToRow + 1}/${state.height}`);
  }
};

juliaWorker.onmessage = function (e) {
  const msg = e.data;
  if (msg.id !== juliaRenderId) return;
  if (msg.type === "progress" || msg.type === "done") {
    const imgData = new ImageData(msg.buffer, 150, 150);
    juliaCtx.putImageData(imgData, 0, 0);
  }
};

// ---------------------------------------------------------------------------
// MOUSE INTERACTION
// ---------------------------------------------------------------------------

let controlMode = "zoom"; // "zoom" | "center" | "julia"
let dragStart   = null;
let dragCurrent = null;
let selRect     = null;   // { x,y,w,h } in canvas px

canvas.addEventListener("mousedown", (e) => {
  if (controlMode !== "zoom") return;
  dragStart = { x: e.offsetX, y: e.offsetY };
  dragCurrent = { ...dragStart };
  selRect = null;
});

canvas.addEventListener("mousemove", (e) => {
  if (controlMode === "zoom" && dragStart) {
    dragCurrent = { x: e.offsetX, y: e.offsetY };
    drawSelection();
  }
  if (controlMode === "julia") {
    const px = e.offsetX, py = e.offsetY;
    const dx = getDx(), dy = getDy();
    const jre = (px - state.origX) * dx + (py - state.origY) * dy;
    const jim = (px - state.origX) * dy - (py - state.origY) * dx;
    updateJuliaPreviewPosition(e.offsetX, e.offsetY);
    startJuliaPreview(jre, jim);
  }
});

canvas.addEventListener("mouseup", (e) => {
  if (controlMode !== "zoom" || !dragStart) return;
  const x1 = Math.min(dragStart.x, e.offsetX);
  const y1 = Math.min(dragStart.y, e.offsetY);
  const x2 = Math.max(dragStart.x, e.offsetX);
  const y2 = Math.max(dragStart.y, e.offsetY);
  selRect = { x1, y1, x2, y2 };
  dragStart = null;
  drawSelection();
});

canvas.addEventListener("click", (e) => {
  if (controlMode === "center") {
    centerAt(e.offsetX, e.offsetY);
    clearSelection();
    scheduleRender();
    return;
  }
  if (controlMode === "julia") {
    const dx = getDx(), dy = getDy();
    state.juliaX = (e.offsetX - state.origX) * dx + (e.offsetY - state.origY) * dy;
    state.juliaY = (e.offsetX - state.origX) * dy - (e.offsetY - state.origY) * dx;
    updateParamDisplay();
    return;
  }
  if (controlMode === "zoom" && selRect) {
    const { x1, y1, x2, y2 } = selRect;
    const rw = x2 - x1, rh = y2 - y1;
    if (rw < 5 || rh < 5) { clearSelection(); return; }
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    const xx = rw / state.width;
    const yy = rh / state.height;
    const inside = e.offsetX >= x1 && e.offsetX <= x2 && e.offsetY >= y1 && e.offsetY <= y2;
    if (inside) {
      centerAt(mx, my);
      applyZoom(xx, yy);
    } else {
      applyZoom(1 / xx, 1 / yy);
      center2(mx, my);
    }
    clearSelection();
    scheduleRender();
  }
});

canvas.addEventListener("mouseleave", () => {
  dragStart = null;
  clearSelection();
});

// Draw XOR selection rectangle on an overlay canvas
const overlayCanvas = document.getElementById("overlay-canvas");
const overlayCtx    = overlayCanvas.getContext("2d");

function drawSelection() {
  overlayCanvas.width  = state.width;
  overlayCanvas.height = state.height;
  overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  if (!dragStart && !selRect) return;
  let x1, y1, x2, y2;
  if (dragStart && dragCurrent) {
    x1 = Math.min(dragStart.x, dragCurrent.x);
    y1 = Math.min(dragStart.y, dragCurrent.y);
    x2 = Math.max(dragStart.x, dragCurrent.x);
    y2 = Math.max(dragStart.y, dragCurrent.y);
  } else if (selRect) {
    ({ x1, y1, x2, y2 } = selRect);
  } else return;
  overlayCtx.strokeStyle = "rgba(255,255,255,0.85)";
  overlayCtx.lineWidth = 1;
  overlayCtx.setLineDash([4, 3]);
  overlayCtx.strokeRect(x1 + 0.5, y1 + 0.5, x2 - x1, y2 - y1);
}

function clearSelection() {
  selRect = null; dragStart = null; dragCurrent = null;
  overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
}

// ---------------------------------------------------------------------------
// VIEW MANIPULATION
// ---------------------------------------------------------------------------

function centerAt(px, py) {
  state.origX = state.origX + Math.round(state.width  / 2 - px);
  state.origY = state.origY + Math.round(state.height / 2 - py);
}
function center2(px, py) {
  state.origX = state.origX - Math.round(state.width  / 2 - px);
  state.origY = state.origY - Math.round(state.height / 2 - py);
}

function applyZoom(fx, fy) {
  const MIN = 1e-10;
  const cx = getOriginX(), cy = getOriginY();
  const newZX = state.zoomX * fx;
  const newZY = state.zoomY * fy;
  state.zoomX = newZX < MIN ? state.zoomX : newZX;
  state.zoomY = newZY < MIN ? state.zoomY : newZY;
  setOriginXY(cx, cy);
}

function zoomIn()  { applyZoom(1/1.3, 1/1.3); }
function zoomOut() { applyZoom(1.3,   1.3); }

// ---------------------------------------------------------------------------
// JULIA MODE TOGGLE
// ---------------------------------------------------------------------------

function enterJuliaMode() {
  if (state.isJulia) return;
  state.backup = {
    origX: state.origX, origY: state.origY,
    zoomX: state.zoomX, zoomY: state.zoomY,
    rotation: state.rotation,
  };
  state.isJulia = true;
  state.rotation = 0;
  const z = state.lockRatio
    ? 4.0 / Math.min(state.width, state.height)
    : null;
  state.zoomX = z !== null ? z : 4.0 / state.width;
  state.zoomY = z !== null ? z : 4.0 / state.height;
  state.origX = Math.round(state.width  / 2);
  state.origY = Math.round(state.height / 2);
}

function enterMandelbrotMode() {
  if (!state.isJulia) return;
  state.isJulia = false;
  if (state.backup) {
    state.origX    = state.backup.origX;
    state.origY    = state.backup.origY;
    state.zoomX    = state.backup.zoomX;
    state.zoomY    = state.backup.zoomY;
    state.rotation = state.backup.rotation;
    state.backup   = null;
  }
}

// ---------------------------------------------------------------------------
// JULIA PREVIEW OVERLAY POSITIONING
// ---------------------------------------------------------------------------

const juliaOverlay = document.getElementById("julia-overlay");

function updateJuliaPreviewPosition(px, py) {
  const rect = canvas.getBoundingClientRect();
  const containerRect = document.getElementById("canvas-wrapper").getBoundingClientRect();
  // Position overlay near cursor but within viewport
  let left = rect.left - containerRect.left + px + 12;
  let top  = rect.top  - containerRect.top  + py + 12;
  if (left + 160 > containerRect.width)  left = px - 165;
  if (top  + 160 > containerRect.height) top  = py - 165;
  juliaOverlay.style.left = left + "px";
  juliaOverlay.style.top  = top  + "px";
  juliaOverlay.style.display = "block";
}

function hideJuliaOverlay() {
  juliaOverlay.style.display = "none";
}

// ---------------------------------------------------------------------------
// PALETTE DISPLAY
// ---------------------------------------------------------------------------

const paletteCanvas = document.getElementById("palette-canvas");
const palCtx        = paletteCanvas.getContext("2d");

function drawPaletteBar() {
  paletteCanvas.width  = 256;
  paletteCanvas.height = 20;
  const img = palCtx.createImageData(256, 1);
  for (let i = 0; i < 256; i++) {
    const [r, g, b] = state.palette[i] || [0, 0, 0];
    img.data[i * 4]     = r;
    img.data[i * 4 + 1] = g;
    img.data[i * 4 + 2] = b;
    img.data[i * 4 + 3] = 255;
  }
  for (let row = 0; row < 20; row++) palCtx.putImageData(img, 0, row);
}

// ---------------------------------------------------------------------------
// RESIZE CANVAS
// ---------------------------------------------------------------------------

const SIZE_PRESETS = [
  [200, 200], [256, 256], [320, 240], [400, 300],
  [400, 400], [512, 512], [640, 480], [800, 600],
];

function changeResolution(newW, newH) {
  // Preserve the view center when resizing
  const cx = getOriginX(), cy = getOriginY();
  const sx = state.width  / newW;
  const sy = state.height / newH;
  const scale = state.lockRatio ? Math.max(sx, sy) : 1;

  state.zoomX *= (state.lockRatio ? scale : sx);
  state.zoomY *= (state.lockRatio ? scale : sy);
  state.width  = newW;
  state.height = newH;

  // Restore complex center for new size
  setOriginXY(cx, cy);

  applyCanvasSize();
  overlayCanvas.width  = newW;
  overlayCanvas.height = newH;
  updateParamDisplay();
}

// ---------------------------------------------------------------------------
// STATUS BAR
// ---------------------------------------------------------------------------

function setStatus(msg) {
  document.getElementById("status-bar").textContent = msg;
}

// ---------------------------------------------------------------------------
// PARAMETER DISPLAY & UI SYNC
// ---------------------------------------------------------------------------

function updateParamDisplay() {
  setValue("inp-iterations", state.iterations);
  setValue("inp-bailout",    fmt(state.bailout));
  setValue("inp-rotation",   fmt(state.rotation * 180 / Math.PI, 2));
  setValue("inp-zoom-x",     fmt(getDisplayZoomX()));
  setValue("inp-zoom-y",     fmt(getDisplayZoomY()));
  setValue("inp-origin-x",   fmt(getOriginX(), 8));
  setValue("inp-origin-y",   fmt(getOriginY(), 8));
  setValue("inp-julia-re",   fmt(state.juliaX, 6));
  setValue("inp-julia-im",   fmt(state.juliaY, 6));
  setValue("inp-pert-re",    fmt(state.pertX));
  setValue("inp-pert-im",    fmt(state.pertY));

  document.getElementById("lbl-formula").textContent  = state.formula;
  document.getElementById("lbl-mode").textContent     = state.isJulia ? "Julia" : "Mandelbrot";
  document.getElementById("lbl-incolor").textContent  = state.inColor;
  document.getElementById("lbl-outcolor").textContent = state.outColor;
  document.getElementById("lbl-size").textContent     = `${state.width}×${state.height}`;
  document.getElementById("lbl-control").textContent  = controlMode;
  document.getElementById("lbl-render").textContent   = state.renderMode;

  // Highlight active formula button
  document.querySelectorAll(".formula-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.formula === state.formula);
  });
  // Mode toggles
  document.getElementById("btn-mandelbrot").classList.toggle("active", !state.isJulia);
  document.getElementById("btn-julia-mode").classList.toggle("active",  state.isJulia);
  // Control toggles
  document.querySelectorAll(".ctrl-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.ctrl === controlMode);
  });
  // Coloring selectors
  document.getElementById("sel-incolor").value  = state.inColor;
  document.getElementById("sel-outcolor").value = state.outColor;
  // Render mode
  document.getElementById("sel-rendermode").value = state.renderMode;
  // Lock ratio
  document.getElementById("chk-lockratio").checked = state.lockRatio;
}

function setValue(id, v) {
  const el = document.getElementById(id);
  if (el && document.activeElement !== el) el.value = v;
}
function fmt(v, decimals = 6) {
  return parseFloat(v.toFixed(decimals)).toString();
}

// ---------------------------------------------------------------------------
// RENDER DEBOUNCING
// ---------------------------------------------------------------------------

let renderTimer = null;

function scheduleRender(delay = 0) {
  updateParamDisplay();
  drawPaletteBar();
  clearTimeout(renderTimer);
  renderTimer = setTimeout(() => {
    setStatus("Rendering…");
    startRender();
  }, delay);
}

// ---------------------------------------------------------------------------
// INPUT FIELD EVENT HANDLERS
// (Apply value on Enter or blur; validate range)
// ---------------------------------------------------------------------------

function bindNumInput(id, apply) {
  const el = document.getElementById(id);
  el.addEventListener("change", () => apply(el.value));
  el.addEventListener("keydown", (e) => { if (e.key === "Enter") apply(el.value); });
}

bindNumInput("inp-iterations", v => {
  const n = parseInt(v);
  if (n > 0) { state.iterations = n; scheduleRender(); }
});
bindNumInput("inp-bailout", v => {
  const n = parseFloat(v);
  if (n > 0) { state.bailout = n; scheduleRender(); }
});
bindNumInput("inp-rotation", v => {
  const n = parseFloat(v);
  if (!isNaN(n)) {
    const cx = getOriginX(), cy = getOriginY();
    state.rotation = n * Math.PI / 180;
    setOriginXY(cx, cy);
    scheduleRender();
  }
});
bindNumInput("inp-zoom-x", v => {
  const n = parseFloat(v);
  if (n > 0) {
    const cx = getOriginX(), cy = getOriginY();
    state.zoomX = 4.0 / (state.width * n);
    if (state.lockRatio) state.zoomY = 4.0 / (state.height * n);
    setOriginXY(cx, cy);
    scheduleRender();
  }
});
bindNumInput("inp-zoom-y", v => {
  const n = parseFloat(v);
  if (n > 0) {
    const cx = getOriginX(), cy = getOriginY();
    state.zoomY = 4.0 / (state.height * n);
    setOriginXY(cx, cy);
    scheduleRender();
  }
});
bindNumInput("inp-origin-x", v => {
  const n = parseFloat(v);
  if (!isNaN(n)) { setOriginXY(n, getOriginY()); scheduleRender(); }
});
bindNumInput("inp-origin-y", v => {
  const n = parseFloat(v);
  if (!isNaN(n)) { setOriginXY(getOriginX(), n); scheduleRender(); }
});
bindNumInput("inp-julia-re", v => {
  const n = parseFloat(v);
  if (!isNaN(n)) { state.juliaX = n; scheduleRender(); }
});
bindNumInput("inp-julia-im", v => {
  const n = parseFloat(v);
  if (!isNaN(n)) { state.juliaY = n; scheduleRender(); }
});
bindNumInput("inp-pert-re", v => {
  const n = parseFloat(v);
  if (!isNaN(n)) { state.pertX = n; scheduleRender(); }
});
bindNumInput("inp-pert-im", v => {
  const n = parseFloat(v);
  if (!isNaN(n)) { state.pertY = n; scheduleRender(); }
});

// ---------------------------------------------------------------------------
// TOOLBAR / BUTTON WIRING
// ---------------------------------------------------------------------------

// Formula buttons
document.querySelectorAll(".formula-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    state.formula = btn.dataset.formula;
    resetView(true);
    state.isJulia = false;
    if (state.backup) state.backup = null;
    scheduleRender();
  });
});

// Mode toggle
document.getElementById("btn-mandelbrot").addEventListener("click", () => {
  enterMandelbrotMode(); scheduleRender();
});
document.getElementById("btn-julia-mode").addEventListener("click", () => {
  enterJuliaMode(); scheduleRender();
});

// Control mode buttons
document.querySelectorAll(".ctrl-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    controlMode = btn.dataset.ctrl;
    clearSelection();
    if (controlMode !== "julia") hideJuliaOverlay();
    updateParamDisplay();
  });
});

// Zoom in / out buttons
document.getElementById("btn-zoom-in").addEventListener("click",  () => { zoomIn();  scheduleRender(); });
document.getElementById("btn-zoom-out").addEventListener("click", () => { zoomOut(); scheduleRender(); });

// Default view
document.getElementById("btn-default").addEventListener("click", () => {
  resetView(false); scheduleRender();
});

// Coloring selectors
document.getElementById("sel-incolor").addEventListener("change", (e) => {
  state.inColor = e.target.value; scheduleRender();
});
document.getElementById("sel-outcolor").addEventListener("change", (e) => {
  state.outColor = e.target.value; scheduleRender();
});

// Render mode
document.getElementById("sel-rendermode").addEventListener("change", (e) => {
  state.renderMode = e.target.value; updateParamDisplay();
});

// Lock aspect ratio
document.getElementById("chk-lockratio").addEventListener("change", (e) => {
  state.lockRatio = e.target.checked;
});

// Image size presets
document.getElementById("sel-size").addEventListener("change", (e) => {
  const [w, h] = e.target.value.split("x").map(Number);
  changeResolution(w, h);
  scheduleRender();
});

// Palette preset buttons
document.querySelectorAll(".palette-preset").forEach(btn => {
  btn.addEventListener("click", () => {
    const name = btn.dataset.preset;
    if (name === "random") {
      state.palette = randomPalette();
    } else if (PALETTE_PRESETS[name]) {
      state.palette = PALETTE_PRESETS[name]();
    }
    scheduleRender();
  });
});

// Re-render button
document.getElementById("btn-rerender").addEventListener("click", () => startRender());

// ---------------------------------------------------------------------------
// SAVE / LOAD / EXPORT
// ---------------------------------------------------------------------------

// Build the JSON config object (what gets saved to disk)
function buildConfig() {
  return {
    formula:     state.formula,
    mode:        state.isJulia ? "julia" : "mandelbrot",
    origin:      [getOriginX(), getOriginY()],
    zoom:        [getDisplayZoomX(), getDisplayZoomY()],
    rotation:    state.rotation * 180 / Math.PI,
    perturbation:[state.pertX, state.pertY],
    julia_seed:  [state.juliaX, state.juliaY],
    iterations:  state.iterations,
    bailout:     state.bailout,
    in_coloring: state.inColor,
    out_coloring:state.outColor,
    width:       state.width,
    height:      state.height,
    palette:     state.palette,
  };
}

// Load state from saved config object
function applyConfig(cfg) {
  state.formula    = cfg.formula     || "Mandelbrot";
  state.isJulia    = cfg.mode === "julia";
  state.width      = cfg.width       || 512;
  state.height     = cfg.height      || 512;
  state.iterations = cfg.iterations  || 120;
  state.bailout    = cfg.bailout     || 4.0;
  state.inColor    = cfg.in_coloring  || "none";
  state.outColor   = cfg.out_coloring || "iter";
  state.pertX      = (cfg.perturbation || [0,0])[0];
  state.pertY      = (cfg.perturbation || [0,0])[1];
  state.juliaX     = (cfg.julia_seed   || [0,0])[0];
  state.juliaY     = (cfg.julia_seed   || [0,0])[1];
  state.rotation   = (cfg.rotation || 0) * Math.PI / 180;

  const [zx, zy] = cfg.zoom || [1, 1];
  state.zoomX = 4.0 / (state.width  * zx);
  state.zoomY = 4.0 / (state.height * zy);

  const [ox, oy] = cfg.origin || [0, 0];
  setOriginXY(ox, oy);

  state.palette = cfg.palette || buildGreyscale();
  if (!Array.isArray(state.palette) || state.palette.length === 0)
    state.palette = buildGreyscale();

  applyCanvasSize();
  overlayCanvas.width  = state.width;
  overlayCanvas.height = state.height;
  updateParamDisplay();
}

async function loadFractalList() {
  try {
    const res = await fetch("/api/fractals");
    const names = await res.json();
    const sel = document.getElementById("sel-load-fractal");
    sel.innerHTML = '<option value="">— select —</option>';
    names.forEach(n => {
      const opt = document.createElement("option");
      opt.value = n; opt.textContent = n;
      sel.appendChild(opt);
    });
  } catch (_) {}
}

document.getElementById("btn-save-fractal").addEventListener("click", async () => {
  const name = document.getElementById("inp-save-name").value.trim();
  if (!name) { alert("Please enter a name to save."); return; }
  try {
    const res = await fetch(`/api/fractals/${encodeURIComponent(name)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildConfig()),
    });
    if (res.ok) {
      setStatus(`Saved "${name}"`);
      await loadFractalList();
    } else {
      alert("Save failed: " + res.statusText);
    }
  } catch (err) {
    alert("Save error: " + err.message);
  }
});

document.getElementById("btn-load-fractal").addEventListener("click", async () => {
  const name = document.getElementById("sel-load-fractal").value;
  if (!name) return;
  try {
    const res = await fetch(`/api/fractals/${encodeURIComponent(name)}`);
    if (!res.ok) { alert("Load failed"); return; }
    const cfg = await res.json();
    applyConfig(cfg);
    scheduleRender();
    setStatus(`Loaded "${name}"`);
  } catch (err) {
    alert("Load error: " + err.message);
  }
});

document.getElementById("btn-delete-fractal").addEventListener("click", async () => {
  const name = document.getElementById("sel-load-fractal").value;
  if (!name || !confirm(`Delete "${name}"?`)) return;
  await fetch(`/api/fractals/${encodeURIComponent(name)}`, { method: "DELETE" });
  await loadFractalList();
  setStatus(`Deleted "${name}"`);
});

// Export PNG via canvas
document.getElementById("btn-export-png").addEventListener("click", () => {
  canvas.toBlob(blob => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `fractal-${Date.now()}.png`;
    a.click();
  });
});

// Save/load custom palette
async function loadPaletteList() {
  try {
    const res = await fetch("/api/palettes");
    const names = await res.json();
    const sel = document.getElementById("sel-load-palette");
    sel.innerHTML = '<option value="">— select —</option>';
    names.forEach(n => {
      const opt = document.createElement("option");
      opt.value = n; opt.textContent = n;
      sel.appendChild(opt);
    });
  } catch (_) {}
}

document.getElementById("btn-save-palette").addEventListener("click", async () => {
  const name = document.getElementById("inp-palette-name").value.trim();
  if (!name) { alert("Please enter a palette name."); return; }
  try {
    const res = await fetch(`/api/palettes/${encodeURIComponent(name)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ palette: state.palette }),
    });
    if (res.ok) { setStatus(`Palette saved "${name}"`); await loadPaletteList(); }
  } catch (err) { alert("Error: " + err.message); }
});

document.getElementById("btn-load-palette").addEventListener("click", async () => {
  const name = document.getElementById("sel-load-palette").value;
  if (!name) return;
  try {
    const res = await fetch(`/api/palettes/${encodeURIComponent(name)}`);
    const data = await res.json();
    state.palette = data.palette || buildGreyscale();
    scheduleRender();
    setStatus(`Palette loaded "${name}"`);
  } catch (err) { alert("Error: " + err.message); }
});

// ---------------------------------------------------------------------------
// KEYBOARD SHORTCUTS
// ---------------------------------------------------------------------------

document.addEventListener("keydown", (e) => {
  if (e.target.tagName === "INPUT") return;
  switch (e.key) {
    case "z": case "Z": setCtrlMode("zoom");   break;
    case "c": case "C": setCtrlMode("center"); break;
    case "j": case "J": setCtrlMode("julia");  break;
    case "+": case "=": zoomIn();  scheduleRender(); break;
    case "-":            zoomOut(); scheduleRender(); break;
    case "ArrowRight": panPixels( 20,  0); break;
    case "ArrowLeft":  panPixels(-20,  0); break;
    case "ArrowDown":  panPixels(  0, 20); break;
    case "ArrowUp":    panPixels(  0,-20); break;
  }
});

function setCtrlMode(mode) {
  controlMode = mode;
  clearSelection();
  if (mode !== "julia") hideJuliaOverlay();
  updateParamDisplay();
}

function panPixels(dx, dy) {
  state.origX += dx;
  state.origY += dy;
  scheduleRender();
}

// ---------------------------------------------------------------------------
// INITIALISATION
// ---------------------------------------------------------------------------

function init() {
  state.palette = buildGreyscale();
  resetView(false);
  applyCanvasSize();
  overlayCanvas.width  = state.width;
  overlayCanvas.height = state.height;

  // Populate size select
  const sizeSel = document.getElementById("sel-size");
  SIZE_PRESETS.forEach(([w, h]) => {
    const opt = document.createElement("option");
    opt.value = `${w}x${h}`;
    opt.textContent = `${w}×${h}`;
    if (w === state.width && h === state.height) opt.selected = true;
    sizeSel.appendChild(opt);
  });

  updateParamDisplay();
  loadFractalList();
  loadPaletteList();
  scheduleRender();
  setStatus("Ready");
}

init();
