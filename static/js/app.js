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

// Complex coordinate of canvas pixel (px, py)
function pixelToComplex(px, py) {
  const dx = getDx(), dy = getDy();
  return [
    (px - state.origX) * dx + (py - state.origY) * dy,
    (px - state.origX) * dy - (py - state.origY) * dx,
  ];
}

// Move the pixel anchor so that canvas pixel (px, py) maps to (cr, ci).
// The anchor is kept fractional so repeated zooming around a point
// (mouse wheel, pinch) does not drift.
function anchorComplexAt(px, py, cr, ci) {
  const dx = getDx(), dy = getDy();
  const denom = dx * dx + dy * dy;
  if (denom === 0) return;
  state.origX = px - (cr * dx + ci * dy) / denom;
  state.origY = py - (cr * dy - ci * dx) / denom;
}

// Set complex center coordinate, updating pixel anchor
function setOriginXY(cx, cy) {
  anchorComplexAt(state.width / 2, state.height / 2, cx, cy);
}

// Default geometry (center 0, span ±2, no rotation) for current size
function setDefaultGeometry() {
  state.rotation = 0;
  const z = state.lockRatio
    ? 4.0 / Math.min(state.width, state.height)
    : null;
  state.zoomX = z !== null ? z : 4.0 / state.width;
  state.zoomY = z !== null ? z : 4.0 / state.height;
  state.origX = Math.round(state.width  / 2);
  state.origY = Math.round(state.height / 2);
}

// Default view for current size
function resetView(resetColors) {
  setDefaultGeometry();
  state.pertX = 0; state.pertY = 0;
  // Julia seed is deliberately kept: resetting it to 0 turns most Julia
  // sets into a plain disk (z² + 0), and the seed is usually picked by hand.
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
  updateCanvasLayout();
  syncSizeSelect();
}

// ---------------------------------------------------------------------------
// DISPLAY MODES
// How the rendered image is shown inside the canvas area:
//   actual   1:1 pixels, scrollbars if larger than the area
//   contain  scaled to fit, keeps aspect ratio
//   cover    scaled to fill, keeps aspect ratio, edges cropped
//   stretch  scaled to fill exactly, aspect ratio not kept
//   window   render resolution follows the area size (sharp, full detail)
// ---------------------------------------------------------------------------

const wrapperEl = document.getElementById("canvas-wrapper");
const stackEl   = document.querySelector(".canvas-stack");
const DISPLAY_KEY = "fractal-explorer:display";
let displayMode = "cover";
try { displayMode = localStorage.getItem(DISPLAY_KEY) || "cover"; } catch (_) {}
let fixedSize = null;   // last preset size, restored when leaving "window"

function updateCanvasLayout() {
  wrapperEl.classList.toggle("scaled", displayMode !== "actual");
  if (displayMode === "actual") {
    stackEl.style.width = stackEl.style.height = "";
    return;
  }
  const aw = wrapperEl.clientWidth, ah = wrapperEl.clientHeight;
  let sx = aw / state.width, sy = ah / state.height;
  if (displayMode === "contain") sx = sy = Math.min(sx, sy);
  if (displayMode === "cover")   sx = sy = Math.max(sx, sy);
  stackEl.style.width  = state.width  * sx + "px";
  stackEl.style.height = state.height * sy + "px";
}

// In "window" mode keep the render resolution equal to the area size
// (in device pixels, capped at 2× to keep render times sane)
function syncWindowResolution() {
  if (displayMode !== "window") return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(16, Math.round(wrapperEl.clientWidth  * dpr));
  const h = Math.max(16, Math.round(wrapperEl.clientHeight * dpr));
  if (w === state.width && h === state.height) return;
  changeResolution(w, h);
  scheduleRender(150);
}

function setDisplayMode(mode) {
  if (mode === displayMode) return;
  if (mode === "window") {
    fixedSize = [state.width, state.height];
  } else if (displayMode === "window") {
    const [w, h] = fixedSize || [512, 512];
    changeResolution(w, h);
    scheduleRender();
  }
  displayMode = mode;
  try { localStorage.setItem(DISPLAY_KEY, mode); } catch (_) {}
  document.getElementById("sel-size").disabled = mode === "window";
  updateCanvasLayout();
  syncWindowResolution();
}

new ResizeObserver(() => {
  updateCanvasLayout();
  syncWindowResolution();
}).observe(wrapperEl);

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else wrapperEl.requestFullscreen?.();
}

worker.onmessage = function (e) {
  const msg = e.data;
  if (msg.id !== renderId) return;
  // Resolution changed since this render started (e.g. window resize)
  if (msg.buffer.length !== state.width * state.height * 4) return;
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
// The canvas may be displayed scaled (see DISPLAY MODES), so all pointer
// positions go through canvasPoint() to get canvas-pixel coordinates.
// ---------------------------------------------------------------------------

let controlMode = "pan"; // "pan" | "zoom" | "center" | "julia"
let dragStart   = null;
let dragCurrent = null;
let selRect     = null;   // { x1,y1,x2,y2 } in canvas px

function canvasPoint(e) {
  const r = canvas.getBoundingClientRect();
  return {
    x: (e.clientX - r.left) * canvas.width  / r.width,
    y: (e.clientY - r.top)  * canvas.height / r.height,
  };
}

canvas.addEventListener("mousedown", (e) => {
  if (e.button === 1) e.preventDefault();   // no auto-scroll on middle-drag
  if (controlMode !== "zoom" || e.button !== 0) return;
  dragStart = canvasPoint(e);
  dragCurrent = { ...dragStart };
  selRect = null;
});

canvas.addEventListener("mousemove", (e) => {
  const p = canvasPoint(e);
  if (controlMode === "zoom" && dragStart) {
    dragCurrent = p;
    drawSelection();
  }
  // The preview only makes sense over the parameter (Mandelbrot) plane:
  // in Julia mode the pixel coordinates are z-values, not seeds.
  if (controlMode === "julia" && !state.isJulia && !gesture) {
    const [jre, jim] = pixelToComplex(p.x, p.y);
    updateJuliaPreviewPosition(e);
    startJuliaPreview(jre, jim);
  }
});

canvas.addEventListener("mouseup", (e) => {
  if (controlMode !== "zoom" || !dragStart || e.button !== 0) return;
  const p = canvasPoint(e);
  const x1 = Math.min(dragStart.x, p.x);
  const y1 = Math.min(dragStart.y, p.y);
  const x2 = Math.max(dragStart.x, p.x);
  const y2 = Math.max(dragStart.y, p.y);
  selRect = { x1, y1, x2, y2 };
  dragStart = null;
  drawSelection();
});

canvas.addEventListener("click", (e) => {
  const p = canvasPoint(e);
  if (controlMode === "center") {
    centerAt(p.x, p.y);
    clearSelection();
    scheduleRender();
    return;
  }
  if (controlMode === "julia") {
    if (state.isJulia) return;
    // Pick the seed under the cursor and open its Julia set
    [state.juliaX, state.juliaY] = pixelToComplex(p.x, p.y);
    hideJuliaOverlay();
    enterJuliaMode();
    scheduleRender();
    return;
  }
  if (controlMode === "zoom" && selRect) {
    const { x1, y1, x2, y2 } = selRect;
    const rw = x2 - x1, rh = y2 - y1;
    if (rw < 5 || rh < 5) { clearSelection(); return; }
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    const xx = rw / state.width;
    const yy = rh / state.height;
    const inside = p.x >= x1 && p.x <= x2 && p.y >= y1 && p.y <= y2;
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
  hideJuliaOverlay();
});

// ---------------------------------------------------------------------------
// DIRECT PAN & ZOOM
//   wheel                        zoom around the cursor (any tool)
//   drag with the Pan tool       pan (mouse, pen or one finger)
//   right/middle drag            pan (any tool)
//   two-finger pinch (Pan tool)  zoom + pan
// While a gesture runs, the last rendered image is moved/scaled on the
// canvas as a cheap preview; the real render starts when the gesture settles.
// ---------------------------------------------------------------------------

let gesture = null;   // { snap, origX, origY, zoomX, zoomY } at gesture start
let gestureRenderTimer = null;

function beginGesture() {
  clearTimeout(gestureRenderTimer);
  if (gesture) return;
  const snap = document.createElement("canvas");
  snap.width = canvas.width; snap.height = canvas.height;
  snap.getContext("2d").drawImage(canvas, 0, 0);
  gesture = {
    snap,
    origX: state.origX, origY: state.origY,
    zoomX: state.zoomX, zoomY: state.zoomY,
  };
  renderId++;   // ignore progress from a render still in flight
  clearSelection();
  hideJuliaOverlay();
}

// Redraw the snapshot transformed to match the current view
function drawGesturePreview() {
  if (!gesture) return;
  const kx = gesture.zoomX / state.zoomX;
  const ky = gesture.zoomY / state.zoomY;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "#111114";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(kx, 0, 0, ky, state.origX - kx * gesture.origX, state.origY - ky * gesture.origY);
  ctx.drawImage(gesture.snap, 0, 0);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  updateParamDisplay();
}

// Render once the gesture has been quiet for `delay` ms
function endGesture(delay = 0) {
  clearTimeout(gestureRenderTimer);
  gestureRenderTimer = setTimeout(() => {
    gesture = null;
    scheduleRender();
  }, delay);
}

// Zoom by factor f (>1 = zoom out) keeping canvas pixel (px, py) fixed
function zoomAt(px, py, f) {
  const MIN = 1e-15;
  if (state.zoomX * f < MIN || state.zoomY * f < MIN) return;
  const [cr, ci] = pixelToComplex(px, py);
  state.zoomX *= f;
  state.zoomY *= f;
  anchorComplexAt(px, py, cr, ci);
}

canvas.addEventListener("wheel", (e) => {
  e.preventDefault();
  const p = canvasPoint(e);
  // Normalise line/page deltas to pixels; ~10% per mouse-wheel notch
  const delta = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1);
  beginGesture();
  zoomAt(p.x, p.y, Math.exp(delta * 0.001));
  drawGesturePreview();
  endGesture(250);
}, { passive: false });

const pointers = new Map();   // pointerId -> last canvas point
let pinchDist = 0;

function pinchInfo() {
  const [a, b] = [...pointers.values()];
  return { mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, dist: Math.hypot(a.x - b.x, a.y - b.y) };
}

canvas.addEventListener("pointerdown", (e) => {
  const panButton = e.button === 1 || e.button === 2 ||
                    (e.button === 0 && controlMode === "pan");
  if (!panButton) return;
  e.preventDefault();
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, canvasPoint(e));
  if (pointers.size === 2) pinchDist = pinchInfo().dist;
  beginGesture();
  canvas.classList.add("panning");
});

canvas.addEventListener("pointermove", (e) => {
  if (!pointers.has(e.pointerId)) return;
  const prev = pointers.get(e.pointerId);
  const p = canvasPoint(e);
  if (pointers.size === 1) {
    state.origX += p.x - prev.x;
    state.origY += p.y - prev.y;
    pointers.set(e.pointerId, p);
  } else if (pointers.size === 2) {
    const before = pinchInfo();
    pointers.set(e.pointerId, p);
    const after = pinchInfo();
    state.origX += after.mx - before.mx;
    state.origY += after.my - before.my;
    if (after.dist > 0 && pinchDist > 0) zoomAt(after.mx, after.my, pinchDist / after.dist);
    pinchDist = after.dist;
  }
  drawGesturePreview();
});

function releasePointer(e) {
  if (!pointers.delete(e.pointerId)) return;
  if (pointers.size === 2) pinchDist = pinchInfo().dist;
  if (pointers.size === 0) {
    canvas.classList.remove("panning");
    endGesture(0);
  }
}
canvas.addEventListener("pointerup", releasePointer);
canvas.addEventListener("pointercancel", releasePointer);

// Right-drag pans, so suppress the context menu on the canvas
canvas.addEventListener("contextmenu", (e) => e.preventDefault());

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
  setDefaultGeometry();
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
  } else {
    // e.g. a Julia config was loaded – there is no Mandelbrot view to return to
    setDefaultGeometry();
  }
}

// ---------------------------------------------------------------------------
// JULIA PREVIEW OVERLAY POSITIONING
// ---------------------------------------------------------------------------

const juliaOverlay = document.getElementById("julia-overlay");

function updateJuliaPreviewPosition(e) {
  const wrapper = document.getElementById("canvas-wrapper");
  const containerRect = wrapper.getBoundingClientRect();
  // Position overlay near cursor but within the visible wrapper area
  const viewX = e.clientX - containerRect.left;
  const viewY = e.clientY - containerRect.top;
  let left = viewX + 12;
  let top  = viewY + 12;
  if (left + 160 > containerRect.width)  left = viewX - 165;
  if (top  + 160 > containerRect.height) top  = viewY - 165;
  left += wrapper.scrollLeft;
  top  += wrapper.scrollTop;
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

const SIZE_PRESETS = {
  "Square": [[200, 200], [256, 256], [400, 400], [512, 512], [768, 768], [1024, 1024], [2048, 2048]],
  "4:3":    [[320, 240], [400, 300], [640, 480], [800, 600], [1024, 768], [1600, 1200]],
  "16:9":   [[1280, 720], [1920, 1080], [2560, 1440], [3840, 2160]],
};
const MAX_SIZE = 8192;
const sizeSel = document.getElementById("sel-size");
const customSizeRow = document.getElementById("custom-size-row");

// Rebuild the size dropdown so it always shows the current resolution –
// a size that is not a preset (custom, loaded config, Fill window) gets its
// own entry at the top.
function syncSizeSelect() {
  const current = `${state.width}x${state.height}`;
  const isPreset = Object.values(SIZE_PRESETS).flat().some(([w, h]) => `${w}x${h}` === current);
  const opt = (value, text) => {
    const o = document.createElement("option");
    o.value = value; o.textContent = text;
    return o;
  };
  sizeSel.innerHTML = "";
  if (!isPreset) sizeSel.appendChild(opt(current, `${state.width}×${state.height}`));
  for (const [group, sizes] of Object.entries(SIZE_PRESETS)) {
    const og = document.createElement("optgroup");
    og.label = group;
    sizes.forEach(([w, h]) => og.appendChild(opt(`${w}x${h}`, `${w}×${h}`)));
    sizeSel.appendChild(og);
  }
  sizeSel.appendChild(opt("custom", "Custom…"));
  sizeSel.value = current;
}

function showCustomSize() {
  document.getElementById("inp-size-w").value = state.width;
  document.getElementById("inp-size-h").value = state.height;
  customSizeRow.hidden = false;
  document.getElementById("inp-size-w").focus();
}

function applyCustomSize() {
  const w = parseInt(document.getElementById("inp-size-w").value);
  const h = parseInt(document.getElementById("inp-size-h").value);
  if (!(w >= 16 && h >= 16 && w <= MAX_SIZE && h <= MAX_SIZE)) {
    alert(`Width and height must be between 16 and ${MAX_SIZE} px.`);
    return;
  }
  customSizeRow.hidden = true;
  changeResolution(w, h);
  scheduleRender();
}

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
sizeSel.addEventListener("change", (e) => {
  if (e.target.value === "custom") {
    syncSizeSelect();   // keep showing the current size until applied
    showCustomSize();
    return;
  }
  customSizeRow.hidden = true;
  const [w, h] = e.target.value.split("x").map(Number);
  changeResolution(w, h);
  scheduleRender();
});
document.getElementById("btn-size-apply").addEventListener("click", applyCustomSize);
["inp-size-w", "inp-size-h"].forEach(id =>
  document.getElementById(id).addEventListener("keydown", (e) => {
    if (e.key === "Enter") applyCustomSize();
    if (e.key === "Escape") customSizeRow.hidden = true;
  }));

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

// Display mode & full screen
document.getElementById("sel-display").addEventListener("change", (e) => setDisplayMode(e.target.value));
document.getElementById("btn-fullscreen").addEventListener("click", toggleFullscreen);
document.addEventListener("fullscreenchange", () => {
  document.getElementById("btn-fullscreen").classList.toggle("active", !!document.fullscreenElement);
});

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

// ---------------------------------------------------------------------------
// STORAGE
// Two interchangeable backends with the same interface:
//   - "server": the Flask REST API (app.py)
//   - "local":  browser localStorage, used when there is no backend
//               (e.g. when hosted as static files on GitHub Pages)
// The backend is detected once at startup.
// ---------------------------------------------------------------------------

function serverStore(kind) {
  const base = `api/${kind}`;   // relative, so it also works under a sub-path
  return {
    async list() {
      const res = await fetch(base);
      if (!res.ok) throw new Error(res.statusText);
      return res.json();
    },
    async get(name) {
      const res = await fetch(`${base}/${encodeURIComponent(name)}`);
      if (!res.ok) throw new Error(res.statusText);
      return res.json();
    },
    async save(name, data) {
      const res = await fetch(`${base}/${encodeURIComponent(name)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(res.statusText);
    },
    async remove(name) {
      const res = await fetch(`${base}/${encodeURIComponent(name)}`, { method: "DELETE" });
      if (!res.ok) throw new Error(res.statusText);
    },
  };
}

function localStore(kind) {
  const key = `fractal-explorer:${kind}`;
  const readAll = () => {
    try { return JSON.parse(localStorage.getItem(key)) || {}; }
    catch (_) { return {}; }
  };
  const writeAll = (all) => localStorage.setItem(key, JSON.stringify(all));
  return {
    async list()   { return Object.keys(readAll()).sort(); },
    async get(name) {
      const all = readAll();
      if (!(name in all)) throw new Error("Not found");
      return all[name];
    },
    async save(name, data) { const all = readAll(); all[name] = data; writeAll(all); },
    async remove(name)     { const all = readAll(); delete all[name]; writeAll(all); },
  };
}

const storage = { mode: "local", fractals: localStore("fractals"), palettes: localStore("palettes") };

async function detectStorage() {
  try {
    const res = await fetch("api/fractals", { cache: "no-store" });
    const type = res.headers.get("content-type") || "";
    if (res.ok && type.includes("application/json")) {
      storage.mode = "server";
      storage.fractals = serverStore("fractals");
      storage.palettes = serverStore("palettes");
    }
  } catch (_) { /* no backend – stay local */ }
  document.getElementById("lbl-storage").textContent =
    storage.mode === "server" ? "server" : "browser";
}

async function loadFractalList() {
  try {
    const names = await storage.fractals.list();
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
    await storage.fractals.save(name, buildConfig());
    setStatus(`Saved "${name}"`);
    await loadFractalList();
  } catch (err) {
    alert("Save failed: " + err.message);
  }
});

document.getElementById("btn-load-fractal").addEventListener("click", async () => {
  const name = document.getElementById("sel-load-fractal").value;
  if (!name) return;
  try {
    applyConfig(await storage.fractals.get(name));
    scheduleRender();
    setStatus(`Loaded "${name}"`);
  } catch (err) {
    alert("Load failed: " + err.message);
  }
});

document.getElementById("btn-delete-fractal").addEventListener("click", async () => {
  const name = document.getElementById("sel-load-fractal").value;
  if (!name || !confirm(`Delete "${name}"?`)) return;
  try {
    await storage.fractals.remove(name);
    await loadFractalList();
    setStatus(`Deleted "${name}"`);
  } catch (err) {
    alert("Delete failed: " + err.message);
  }
});

function downloadBlob(blob, filename) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// Export PNG via canvas
document.getElementById("btn-export-png").addEventListener("click", () => {
  canvas.toBlob(blob => downloadBlob(blob, `fractal-${Date.now()}.png`));
});

// Export / import the current config as a JSON file – works without a
// backend and moves fractals between browsers or into the server's fractals/
document.getElementById("btn-export-json").addEventListener("click", () => {
  const name = document.getElementById("inp-save-name").value.trim() || `fractal-${Date.now()}`;
  const json = JSON.stringify(buildConfig(), null, 2);
  downloadBlob(new Blob([json], { type: "application/json" }), `${name}.json`);
});

const importInput = document.getElementById("inp-import-json");
document.getElementById("btn-import-json").addEventListener("click", () => importInput.click());
importInput.addEventListener("change", async () => {
  const file = importInput.files[0];
  importInput.value = "";
  if (!file) return;
  try {
    applyConfig(JSON.parse(await file.text()));
    document.getElementById("inp-save-name").value = file.name.replace(/\.json$/i, "");
    scheduleRender();
    setStatus(`Imported "${file.name}"`);
  } catch (err) {
    alert("Import failed: " + err.message);
  }
});

// Save/load custom palette
async function loadPaletteList() {
  try {
    const names = await storage.palettes.list();
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
    await storage.palettes.save(name, { palette: state.palette });
    setStatus(`Palette saved "${name}"`);
    await loadPaletteList();
  } catch (err) { alert("Error: " + err.message); }
});

document.getElementById("btn-load-palette").addEventListener("click", async () => {
  const name = document.getElementById("sel-load-palette").value;
  if (!name) return;
  try {
    const data = await storage.palettes.get(name);
    state.palette = data.palette || buildGreyscale();
    scheduleRender();
    setStatus(`Palette loaded "${name}"`);
  } catch (err) { alert("Error: " + err.message); }
});

// ---------------------------------------------------------------------------
// KEYBOARD SHORTCUTS
// ---------------------------------------------------------------------------

document.addEventListener("keydown", (e) => {
  if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
  switch (e.key) {
    case "p": case "P": setCtrlMode("pan");    break;
    case "f": case "F": toggleFullscreen();    break;
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

  document.getElementById("sel-display").value = displayMode;
  sizeSel.disabled = displayMode === "window";
  syncWindowResolution();

  updateParamDisplay();
  detectStorage().then(() => { loadFractalList(); loadPaletteList(); });
  scheduleRender();
  setStatus("Ready");
}

init();
