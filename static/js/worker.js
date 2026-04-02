"use strict";
/**
 * Fractal Explorer – Web Worker
 *
 * Handles all fractal computation off the main thread.
 * The main thread sends  { type:'render', id, config }  messages.
 * The worker replies with { type:'progress', id, buffer, upToRow }
 * and finally           { type:'done',     id, buffer }.
 * A new render message with a higher id cancels the previous one.
 */

// ---------------------------------------------------------------------------
// Global render-ID used for cancellation
// ---------------------------------------------------------------------------
let currentId = 0;

// ---------------------------------------------------------------------------
// FORMULAS
// Each function mirrors the Java Formula.compute(r0,i0,r1,i1).
// In Mandelbrot mode: r0,i0 = c (pixel coords), r1,i1 = perturbation
// In Julia mode:      r0,i0 = julia seed,        r1,i1 = pixel coords
// Returns { f, rz1, iz1 } where f = iteration count at escape/max.
// ---------------------------------------------------------------------------

function mandelbrot(r0, i0, r1, i1, iter, bail) {
  let rz1 = r1, iz1 = i1, p1, p2, f;
  for (f = 0; f < iter; f++) {
    p1 = rz1 * rz1; p2 = iz1 * iz1;
    iz1 = 2 * rz1 * iz1 + i0;
    rz1 = p1 - p2 + r0;
    if (p1 + p2 > bail) break;
  }
  return { f, rz1, iz1 };
}

function mandelbrot2(r0, i0, r1, i1, iter, bail) {
  // z^3 + c
  let rz1 = r1, iz1 = i1, p1, p2, f;
  for (f = 0; f < iter; f++) {
    p1 = rz1 * rz1; p2 = iz1 * iz1;
    const nr = rz1 * (p1 - 3 * p2) + r0;
    iz1 = iz1 * (3 * p1 - p2) + i0;
    rz1 = nr;
    if (p1 + p2 > bail) break;
  }
  return { f, rz1, iz1 };
}

function mandelbrot3(r0, i0, r1, i1, iter, bail) {
  // z^4 + c
  let rz1 = r1, iz1 = i1, p1, p2, f;
  for (f = 0; f < iter; f++) {
    p1 = rz1 * rz1; p2 = iz1 * iz1;
    const nr = p1 * p1 + p2 * p2 - 6 * p1 * p2 + r0;
    iz1 = 4 * iz1 * rz1 * (p1 - p2) + i0;
    rz1 = nr;
    if (p1 + p2 > bail) break;
  }
  return { f, rz1, iz1 };
}

function mandelbrot4(r0, i0, r1, i1, iter, bail) {
  // z^5 + c
  let rz1 = r1, iz1 = i1, p1, p2, f;
  for (f = 0; f < iter; f++) {
    p1 = rz1 * rz1; p2 = iz1 * iz1;
    const pp1 = p1 * p1, pp2 = p2 * p2, pp3 = 10 * p1 * p2;
    const nr = pp1 * rz1 + 5 * pp2 * rz1 - pp3 * rz1 + r0;
    iz1 = pp2 * iz1 + 5 * pp1 * iz1 - pp3 * iz1 + i0;
    rz1 = nr;
    if (p1 + p2 > bail) break;
  }
  return { f, rz1, iz1 };
}

function barnsley(r0, i0, r1, i1, iter, bail) {
  let rz1 = r1, iz1 = i1, p1, p2, f;
  for (f = 0; f < iter; f++) {
    const rr = (rz1 >= 0) ? rz1 - 1 : rz1 + 1;
    p1 = rz1 * rz1; p2 = iz1 * iz1;
    const nr = rr * r0 - iz1 * i0;
    iz1 = rr * i0 + iz1 * r0;
    rz1 = nr;
    if (p1 + p2 > bail) break;
  }
  return { f, rz1, iz1 };
}

function barnsley2(r0, i0, r1, i1, iter, bail) {
  let rz1 = r1, iz1 = i1, p1, p2, f;
  for (f = 0; f < iter; f++) {
    const rr = (rz1 * i0 + r0 * iz1 >= 0) ? rz1 - 1 : rz1 + 1;
    p1 = rz1 * rz1; p2 = iz1 * iz1;
    const nr = rr * r0 - iz1 * i0;
    iz1 = rr * i0 + iz1 * r0;
    rz1 = nr;
    if (p1 + p2 > bail) break;
  }
  return { f, rz1, iz1 };
}

function barnsley3(r0, i0, r1, i1, iter, bail) {
  let rz1 = r1, iz1 = i1, p1, p2, f;
  for (f = 0; f < iter; f++) {
    p1 = rz1 * rz1; p2 = iz1 * iz1;
    const savedR = rz1;
    let nr = p1 - p2 - 1;
    let ni = 2 * rz1 * iz1;
    if (savedR < 0) { nr += savedR * r0; ni += savedR * i0; }
    rz1 = nr; iz1 = ni;
    if (p1 + p2 > bail) break;
  }
  return { f, rz1, iz1 };
}

function triangle(r0, i0, r1, i1, iter, bail) {
  // Real/imag axes swapped variant
  let rz1 = r1, iz1 = i1, p1, p2, f;
  for (f = 0; f < iter; f++) {
    p1 = rz1 * rz1; p2 = iz1 * iz1;
    const nr = 2 * rz1 * iz1 + i0;
    iz1 = p1 - p2 + r0;
    rz1 = nr;
    if (p1 + p2 > bail) break;
  }
  return { f, rz1, iz1 };
}

function spider(r0, i0, r1, i1, iter, bail) {
  let rz0 = r0, iz0 = i0, rz1 = r1, iz1 = i1, p1, p2, f;
  for (f = 0; f < iter; f++) {
    p1 = rz1 * rz1; p2 = iz1 * iz1;
    const niz1 = 2 * rz1 * iz1 + iz0;
    rz1 = p1 - p2 + rz0;
    iz1 = niz1;
    rz0 = rz0 / 2 + rz1;
    iz0 = iz0 / 2 + iz1;
    if (p1 + p2 > bail) break;
  }
  return { f, rz1, iz1 };
}

function phoenix(r0, i0, r1, i1, iter, bail) {
  let rz1 = r1, iz1 = i1, t = 0, u = 0, p1, f;
  for (f = 0; f < iter; f++) {
    const rr = rz1, ss = iz1;
    const np1 = rz1 * rz1 - iz1 * iz1 + r0 + i0 * t;
    const np2 = 2 * rz1 * iz1 + i0 * u;
    rz1 = np1; iz1 = np2;
    t = rr; u = ss;
    p1 = rz1 * rz1 + iz1 * iz1;
    if (p1 > bail) break;
  }
  return { f, rz1, iz1 };
}

function magnet(r0, i0, r1, i1, iter, bail) {
  let rz1 = r1, iz1 = i1, p1, p2, f;
  for (f = 0; f < iter; f++) {
    const n1 = rz1 * rz1 - iz1 * iz1 + r0 - 1;
    const n2 = 2 * rz1 * iz1 + i0;
    const d1 = 2 * rz1 + r0 - 2;
    const d2 = 2 * iz1 + i0;
    const t = d1 * d1 + d2 * d2;
    if (t === 0) break;
    const u = (n1 * d1 + n2 * d2) / t;
    const v = (n2 * d1 - n1 * d2) / t;
    rz1 = u * u - v * v;
    iz1 = 2 * u * v;
    p1 = rz1 * rz1 + iz1 * iz1;
    p2 = (rz1 - 1) * (rz1 - 1) + iz1 * iz1;
    if (p1 > bail || p2 < 0.0005) break;
  }
  return { f, rz1, iz1 };
}

function newton(r0, i0, r1, i1, iter, bail) {
  // Newton swaps the role of r0/i0 and r1/i1 (see original Java)
  let rz0 = r1, iz0 = i1, rz1 = r0, iz1 = i0, f;
  for (f = 0; f < iter; f++) {
    const t = rz1, u = iz1;
    const p1 = rz1 * rz1 - iz1 * iz1;
    const p2 = 2 * rz1 * iz1;
    const rr = (2 * (p1 * rz1 - p2 * iz1) + rz0) / 3;
    const ss = (2 * (p2 * rz1 + p1 * iz1) + iz0) / 3;
    const v = p1 * p1 + p2 * p2;
    if (v === 0) break;
    rz1 = (p1 * rr + p2 * ss) / v;
    iz1 = (p1 * ss - p2 * rr) / v;
    if ((rz1 - t) * (rz1 - t) + (iz1 - u) * (iz1 - u) < 0.00001) break;
  }
  return { f, rz1, iz1 };
}

const FORMULAS = {
  Mandelbrot:  mandelbrot,
  Mandelbrot2: mandelbrot2,
  Mandelbrot3: mandelbrot3,
  Mandelbrot4: mandelbrot4,
  Barnsley:    barnsley,
  Barnsley2:   barnsley2,
  Barnsley3:   barnsley3,
  Triangle:    triangle,
  Spider:      spider,
  Phoenix:     phoenix,
  Magnet:      magnet,
  Newton:      newton,
};

// ---------------------------------------------------------------------------
// COLORING ALGORITHMS
// Returns a raw integer that will be masked to 0-255 by the caller.
// ---------------------------------------------------------------------------

function colNone(it, rz1, iz1, iter)      { return 0; }
function colIter(it, rz1, iz1, iter)      { return it; }
function colReal(it, rz1, iz1, iter)      { return it + Math.trunc(rz1); }
function colImag(it, rz1, iz1, iter)      { return it + Math.trunc(iz1); }
function colReIm(it, rz1, iz1, iter)      { return iz1 === 0 ? it : it + Math.trunc(32 * rz1 / iz1); }
function colBdec(it, rz1, iz1, iter)      { return iz1 < 0 ? it : iter - it; }
function colCdec(it, rz1, iz1, iter) {
  let p = Math.atan2(rz1, iz1);
  if (p < 0) p += 2 * Math.PI;
  return Math.trunc(64 * p / Math.PI);
}
function colZmag(it, rz1, iz1, iter)      { return Math.trunc(64 * Math.sqrt(rz1 * rz1 + iz1 * iz1)); }
function colPotential(it, rz1, iz1, iter) {
  const mag2 = rz1 * rz1 + iz1 * iz1;
  if (mag2 < 1 || it === 0) return 0;
  return Math.trunc(Math.sqrt(Math.log(mag2) / it) * 128);
}
function colReIm2(it, rz1, iz1, iter)     { return iz1 === 0 ? 100 : Math.trunc(100 + 32 * rz1 / iz1); }
function colSquares(it, rz1, iz1, iter) {
  if (((Math.trunc(rz1 * 40) % 2) ^ (Math.trunc(iz1 * 40) % 2)) !== 0)
    return Math.trunc(Math.atan2(rz1, iz1) / (Math.PI * 2 + 0.75) * 200);
  else
    return Math.trunc(Math.atan2(iz1, rz1) / (Math.PI * 2 + 0.75) * 200);
}

const IN_COLORS = {
  "none":          colNone,
  "zmag":          colZmag,
  "real/imag":     colReIm2,
  "squares":       colSquares,
  "color decomp.": colCdec,
};
const OUT_COLORS = {
  "iter":           colIter,
  "iter+real":      colReal,
  "iter+imag":      colImag,
  "iter+real/imag": colReIm,
  "binary decomp.": colBdec,
  "color decomp.":  colCdec,
  "potential":      colPotential,
};

// ---------------------------------------------------------------------------
// RENDERER
// ---------------------------------------------------------------------------

/**
 * Builds a flat Uint32 palette (ABGR packed, matching ImageData byte order)
 * from an array of 256 [r,g,b] triplets.
 * The Java app indexes as (2*pp)&0xff, i.e. every other entry.
 */
function buildPaletteRGBA(entries) {
  const pal = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    const [r, g, b] = entries[i % entries.length];
    // ImageData is RGBA in memory; Uint32 little-endian → 0xAABBGGRR
    pal[i] = (0xFF000000 | (b << 16) | (g << 8) | r) >>> 0;
  }
  return pal;
}

/**
 * Core per-pixel computation.
 * Returns RGBA packed value (matches Uint32 ImageData layout).
 */
function computePixel(ix, iy, cfg, formulaFn, inColorFn, outColorFn, pal) {
  const dx = cfg.dx, dy = cfg.dy;
  const ox = cfg.origX, oy = cfg.origY;

  const sr = (ix - ox) * dx + (iy - oy) * dy;
  const si = (ix - ox) * dy - (iy - oy) * dx;

  let r0, i0, r1, i1;
  if (cfg.isJulia) {
    r0 = cfg.juliaX; i0 = cfg.juliaY;
    r1 = sr;         i1 = si;
  } else {
    r0 = sr; i0 = si;
    r1 = cfg.pertX; i1 = cfg.pertY;
  }

  const { f, rz1, iz1 } = formulaFn(r0, i0, r1, i1, cfg.iterations, cfg.bailout);

  let colorIdx;
  if (f < cfg.iterations) {
    colorIdx = outColorFn(f, rz1, iz1, cfg.iterations);
  } else {
    colorIdx = inColorFn(f, rz1, iz1, cfg.iterations);
  }
  return pal[(2 * colorIdx) & 0xFF];
}

/**
 * Asynchronous linear renderer.
 * Sends progress every BATCH_ROWS rows so the main thread can update the canvas
 * and so a new render request can preempt this one.
 */
const BATCH_ROWS = 8;

async function renderLinear(id, cfg, buf32) {
  const w = cfg.width, h = cfg.height;
  const formulaFn  = FORMULAS[cfg.formula]  || mandelbrot;
  const inColorFn  = IN_COLORS[cfg.inColor]  || colNone;
  const outColorFn = OUT_COLORS[cfg.outColor] || colIter;
  const pal = buildPaletteRGBA(cfg.palette);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      buf32[y * w + x] = computePixel(x, y, cfg, formulaFn, inColorFn, outColorFn, pal);
    }
    if ((y & (BATCH_ROWS - 1)) === (BATCH_ROWS - 1) || y === h - 1) {
      // Yield to message queue – allows a new render message to arrive
      await new Promise(r => setTimeout(r, 0));
      if (currentId !== id) return; // preempted

      const snapshot = new Uint8ClampedArray(buf32.buffer.slice(0));
      postMessage({ type: "progress", id, buffer: snapshot, upToRow: y });
    }
  }
}

/**
 * Progressive squared renderer.
 * First pass renders 16×16 blocks, subsequent passes halve the block size.
 */
async function renderSquared(id, cfg, buf32) {
  const w = cfg.width, h = cfg.height;
  const formulaFn  = FORMULAS[cfg.formula]  || mandelbrot;
  const inColorFn  = IN_COLORS[cfg.inColor]  || colNone;
  const outColorFn = OUT_COLORS[cfg.outColor] || colIter;
  const pal = buildPaletteRGBA(cfg.palette);

  function fillBlock(x, y, size, color) {
    const x2 = Math.min(x + size, w);
    const y2 = Math.min(y + size, h);
    for (let py = y; py < y2; py++)
      for (let px = x; px < x2; px++)
        buf32[py * w + px] = color;
  }

  let sz = 16;
  // First pass: compute every sz×sz block
  for (let y = 0; y < h; y += sz) {
    for (let x = 0; x < w; x += sz) {
      const color = computePixel(x, y, cfg, formulaFn, inColorFn, outColorFn, pal);
      fillBlock(x, y, sz, color);
    }
    // Send row-of-blocks progress
    if (((y / sz) & 3) === 3 || y + sz >= h) {
      await new Promise(r => setTimeout(r, 0));
      if (currentId !== id) return;
      const snapshot = new Uint8ClampedArray(buf32.buffer.slice(0));
      postMessage({ type: "progress", id, buffer: snapshot, upToRow: Math.min(y + sz - 1, h - 1) });
    }
  }

  // Refinement passes
  const mask = sz - 1;
  for (let k = sz >> 1; k > 0; k >>= 1) {
    for (let y = 0; y < h; y += k) {
      for (let x = 0; x < w; x += k) {
        if ((x & mask) !== 0 || (y & mask) !== 0) {
          const color = computePixel(x, y, cfg, formulaFn, inColorFn, outColorFn, pal);
          fillBlock(x, y, k, color);
        }
      }
      if (((y / k) & 7) === 7 || y + k >= h) {
        await new Promise(r => setTimeout(r, 0));
        if (currentId !== id) return;
        const snapshot = new Uint8ClampedArray(buf32.buffer.slice(0));
        postMessage({ type: "progress", id, buffer: snapshot, upToRow: Math.min(y + k - 1, h - 1) });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// MESSAGE HANDLER
// ---------------------------------------------------------------------------

onmessage = async function (e) {
  const msg = e.data;

  if (msg.type === "render") {
    currentId = msg.id;
    const cfg = msg.config;
    const buf32 = new Uint32Array(cfg.width * cfg.height);

    const renderFn = (cfg.renderMode === "squared") ? renderSquared : renderLinear;
    await renderFn(msg.id, cfg, buf32);

    if (currentId === msg.id) {
      // Final full-resolution result
      const final = new Uint8ClampedArray(buf32.buffer);
      postMessage({ type: "done", id: msg.id, buffer: final });
    }
  }
};
