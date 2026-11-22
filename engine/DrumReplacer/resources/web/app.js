'use strict';

/* =========================================================
   TRIGGER UNIVERSE — UI prototype
   - Inspector edits the selected slot; audition via a filled Trigger Slot or a FILE SEARCH row.
   - Drag the sample to one of the 8 TRIGGER faders.
   - Click a fader -> slot popover with AUTO PHASE.
   - FILE SEARCH = Finder-like tree of user folders.
   Synthetic data only. No proprietary assets.
   ========================================================= */

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const fmtMs = v => v < 10 ? v.toFixed(1) + ' ms' : Math.round(v) + ' ms';
const fmtHz = v => v >= 1000 ? (v / 1000).toFixed(v >= 10000 ? 1 : 2) + ' kHz' : Math.round(v) + ' Hz';
const fmtDb = v => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(1) + ' dB';
const panLabel = v => v === 0 ? 'C' : (v < 0 ? 'L ' + Math.abs(v) : 'R ' + v);
const normLog = (v, a, b) => (Math.log(v) - Math.log(a)) / (Math.log(b) - Math.log(a));
const denormLog = (t, a, b) => a * Math.pow(b / a, t);

// ---------- inline numeric editing (double click a value) ----------
let numericEditor = null;

function parseNumericText(raw, unit) {
  let t = String(raw).trim().toLowerCase()
    .replace(/[\u2212\u2013]/g, '-')
    .replace(',', '.')
    .replace(/\s+/g, '');
  if (!t) return NaN;
  let mul = 1;
  if (unit === 'Hz') {
    if (/(khz|k)$/.test(t)) { mul = 1000; t = t.replace(/(khz|k)$/, ''); }
    else t = t.replace(/hz$/, '');
  } else if (unit === 'ms') {
    if (/ms$/.test(t)) t = t.replace(/ms$/, '');
    else if (/s$/.test(t)) { mul = 1000; t = t.replace(/s$/, ''); }
  } else if (unit === 'dB') t = t.replace(/db$/, '');
  else if (unit === '%') t = t.replace(/%$/, '');
  else if (unit === 'st') t = t.replace(/st$/, '');
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(t)) return NaN;
  return parseFloat(t) * mul;
}

function snapNumeric(v, step, min, max) {
  let x = clamp(v, min, max);
  if (step) {
    const decimals = Math.max(0, Math.ceil(-Math.log10(step) - 1e-9));
    x = +(Math.round(x / step) * step).toFixed(decimals);
    x = clamp(x, min, max);
  }
  return x;
}

function openNumericEditor(anchor, opts) {
  if (numericEditor) numericEditor.commitOrCancel();
  const read = key => typeof opts[key] === 'function' ? opts[key]() : opts[key];
  const min = read('min'), max = read('max');
  if (!Number.isFinite(min) || !Number.isFinite(max)) return;
  const current = Number(opts.get());
  let value = Number.isFinite(current) ? clamp(current, min, max) : min;

  const originalText = anchor.textContent;
  const originalEditable = anchor.getAttribute('contenteditable');
  const originalSpellcheck = anchor.getAttribute('spellcheck');
  const originalInputmode = anchor.getAttribute('inputmode');

  anchor.contentEditable = 'true';
  anchor.spellcheck = false;
  anchor.setAttribute('inputmode', 'decimal');
  anchor.classList.add('num-editing');

  const selectAll = () => {
    try {
      const range = document.createRange();
      range.selectNodeContents(anchor);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    } catch (e) {}
  };
  anchor.focus();
  selectAll();

  let alive = true;
  const cleanup = () => {
    if (!alive) return;
    alive = false;
    anchor.removeEventListener('blur', onBlur);
    anchor.removeEventListener('keydown', onKeydown);
    anchor.removeEventListener('paste', onPaste);
    anchor.classList.remove('num-editing', 'invalid');
    if (originalEditable == null) anchor.removeAttribute('contenteditable');
    else anchor.setAttribute('contenteditable', originalEditable);
    if (originalSpellcheck == null) anchor.removeAttribute('spellcheck');
    else anchor.setAttribute('spellcheck', originalSpellcheck);
    if (originalInputmode == null) anchor.removeAttribute('inputmode');
    else anchor.setAttribute('inputmode', originalInputmode);
    anchor.textContent = originalText;
    numericEditor = null;
  };
  const apply = n => {
    if (!alive) return;
    cleanup();
    opts.set(snapNumeric(n, opts.step, min, max));
  };
  const parse = () => parseNumericText(anchor.textContent, opts.unit);
  const commit = () => {
    const n = parse();
    if (!Number.isFinite(n)) {
      anchor.classList.add('invalid');
      anchor.focus();
      selectAll();
      return;
    }
    apply(n);
  };
  const cancel = () => { if (alive) cleanup(); };
  const commitOrCancel = () => {
    const n = parse();
    if (Number.isFinite(n)) apply(n); else cancel();
  };
  const onBlur = () => {
    const n = parse();
    if (Number.isFinite(n)) apply(n); else cancel();
  };
  const onKeydown = e => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    else if (e.key === 'Tab') { e.preventDefault(); commit(); }
  };
  const onPaste = e => {
    e.preventDefault();
    const text = ((e.clipboardData || window.clipboardData) || {}).getData ? (e.clipboardData || window.clipboardData).getData('text') : '';
    const sel = window.getSelection();
    if (!sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    range.deleteContents();
    range.insertNode(document.createTextNode(text));
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
  };
  anchor.addEventListener('blur', onBlur);
  anchor.addEventListener('keydown', onKeydown);
  anchor.addEventListener('paste', onPaste);
  numericEditor = { cancel, commitOrCancel };
  selectAll();
}

function bindNumericEdit(el, opts) {
  if (!el) return;
  el.classList.add('num-editable');
  if (!el.title && !el.dataset.tip) el.title = 'Double-click to edit · Alt+click resets';
  const read = key => typeof opts[key] === 'function' ? opts[key]() : opts[key];
  const reset = () => {
    const def = read('default');
    if (!Number.isFinite(def)) return false;
    if (numericEditor) numericEditor.commitOrCancel();
    el.classList.remove('num-editing', 'invalid');
    if (el.getAttribute('contenteditable') === 'true') el.removeAttribute('contenteditable');
    if (document.activeElement === el) el.blur();
    const min = read('min'), max = read('max');
    opts.set(snapNumeric(def, opts.step, min, max));
    if (opts.onReset) opts.onReset();
    el.classList.add('num-reset');
    clearTimeout(el._numResetTimer);
    el._numResetTimer = setTimeout(() => el.classList.remove('num-reset'), 180);
    return true;
  };
  el._numReset = reset;
  el.addEventListener('mousedown', e => {
    if (!e.altKey) return;
    e.preventDefault(); e.stopPropagation();
    reset();
  });
  el.addEventListener('click', e => {
    e.stopPropagation();
    if (e.altKey) { e.preventDefault(); reset(); }
  });
  el.addEventListener('dblclick', e => {
    if (e.altKey) { e.preventDefault(); e.stopPropagation(); reset(); return; }
    if (el.classList.contains('num-editing')) {
      if (numericEditor) return;
      // Recover from a stale editing class left by a failed cleanup.
      el.classList.remove('num-editing', 'invalid');
      el.removeAttribute('contenteditable');
    }
    e.preventDefault();
    e.stopPropagation();
    if (opts.enabled && !opts.enabled()) {
      if (opts.disabledMsg) toast(opts.disabledMsg);
      return;
    }
    openNumericEditor(el, opts);
  });
}

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(0x54A1F00D);
let audioReady = false;
let audioCtx = null;
let masterGain = null;
let masterAnalyser = null;
let inputGain = null;
let gateGain = null;

// ---------- multi-selection (desktop style) ----------
// Scopes: 'env' (envelope points: 'attack' | 'decay' | 'release' | 'x<id>'),
// 'knobs' (detector knob keys), 'faders' and 'slots' (slot indexes; the
// fader strips and the Trigger Slots below are separate selections) and
// faders share it). Drag a box on empty space = marquee; Cmd/Ctrl/Shift+click
// = add/remove; Cmd/Ctrl+A = all in the active scope; moving one selected
// item moves all of them.
const multiSel = { env: new Set(), knobs: new Set(), faders: new Set(), slots: new Set(), scope: null };
const SEL_SCOPES = ['env', 'knobs', 'faders', 'slots'];
function clearAllSel() {
  SEL_SCOPES.forEach(k => { multiSel[k] = new Set(); selAnchor[k] = null; });
  applyKnobSelClasses(); applySlotSelClasses();
}
let marqueeSwallowClick = false;
let envSelSlot = -1; // the point selection belongs to one slot's envelope
// Every selectable item on the TRIGGER page, tagged with its scope. A marquee
// selects across all scopes at once; each group then moves on its own.
function allSelItems() {
  const out = [];
  document.querySelectorAll('#detectorPanel .knob[data-key]').forEach(el =>
    out.push({ scope: 'knobs', el: el.querySelector('.knob-dial') || el, id: el.dataset.key }));
  document.querySelectorAll('#faderBank .slot-fader[data-slot]').forEach(el =>
    out.push({ scope: 'faders', el, id: +el.dataset.slot }));
  document.querySelectorAll('#slots .slot[data-slot]').forEach(el =>
    out.push({ scope: 'slots', el, id: +el.dataset.slot }));
  document.querySelectorAll('#wave .we-handle[data-sid]').forEach(g =>
    out.push({ scope: 'env', el: g.querySelector('.we-dot') || g, id: g.dataset.sid }));
  return out;
}
function startMarquee(e, opts = {}) {
  const additive = e.shiftKey || e.metaKey || e.ctrlKey;
  const scopes = SEL_SCOPES;
  const base = {};
  scopes.forEach(k => { base[k] = additive ? new Set(multiSel[k]) : new Set(); });
  const x0 = e.clientX, y0 = e.clientY;
  let box = null, moved = false;
  // Faders and Trigger Slots never share a selection: the first of the two
  // the box touches wins for the whole drag.
  let fsLock = opts.scope === 'faders' || opts.scope === 'slots' ? opts.scope : null;
  if (opts.scope) multiSel.scope = opts.scope;
  const move = ev => {
    if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) return;
    moved = true;
    if (!box) { box = document.createElement('div'); box.className = 'marquee'; document.body.appendChild(box); }
    const l = Math.min(x0, ev.clientX), t = Math.min(y0, ev.clientY);
    const r = Math.max(x0, ev.clientX), b = Math.max(y0, ev.clientY);
    Object.assign(box.style, { left: l + 'px', top: t + 'px', width: (r - l) + 'px', height: (b - t) + 'px' });
    const next = {}; scopes.forEach(k => { next[k] = new Set(base[k]); });
    for (const it of allSelItems()) {
      const rc = it.el.getBoundingClientRect();
      if (rc.width === 0 && rc.height === 0) continue; // hidden (other view)
      if (rc.right >= l && rc.left <= r && rc.bottom >= t && rc.top <= b) next[it.scope].add(it.id);
    }
    if (!fsLock) {
      const fNew = [...next.faders].some(id => !base.faders.has(id));
      const sNew = [...next.slots].some(id => !base.slots.has(id));
      if (fNew && !sNew) fsLock = 'faders'; else if (sNew && !fNew) fsLock = 'slots';
      else if (fNew && sNew) fsLock = ev.clientY < y0 ? 'faders' : 'slots';
    }
    if (fsLock === 'faders') next.slots = new Set();
    if (fsLock === 'slots') next.faders = new Set();
    const envChanged = next.env.size !== multiSel.env.size || [...next.env].some(id => !multiSel.env.has(id));
    scopes.forEach(k => { multiSel[k] = next[k]; });
    // the active scope (Cmd+A, Delete) is the last one that got something
    const hit = scopes.filter(k => next[k].size);
    if (hit.length) multiSel.scope = hit.includes(opts.scope) ? opts.scope : hit[hit.length - 1];
    applyKnobSelClasses(); applySlotSelClasses();
    if (envChanged) renderSampleEditor();
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    if (box) box.remove();
    if (moved) marqueeSwallowClick = true;
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}
// Marquee from any empty spot of the TRIGGER page (the dark space between
// and around the panels too), like dragging on the Finder desktop.
document.addEventListener('pointerdown', e => {
  if (state.viewMode !== 'trigger' || e.button !== 0 || e.altKey) return;
  const t = e.target;
  if (!t.closest || !t.closest('#triggerView, .slot-dock, .universe')) return;
  // areas with their own marquee start, and anything interactive
  if (t.closest('#wave, #detectorPanel, #faderBank, #slots')) return;
  if (t.closest('button, input, select, textarea, a, canvas, svg, .knob, .slot, .num-editable, label, .chrome, .side-bracket, .settings-menu, .visual-panel, .top-master, #sampleMeta')) return;
  e.preventDefault();
  startMarquee(e, {});
});
// The click that ends a marquee must not also select/audition what is under it.
// Finder rule: a click anywhere deselects everything, EXCEPT a click on
// something already selected (that is how you move the group) or a click
// with Cmd/Ctrl/Shift (building the selection). Runs in the capture phase,
// before the item handlers, and reads the event path (the editor redraws its
// SVG during the click, so e.target can already be detached).
document.addEventListener('pointerdown', e => {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
  // BOUNCE reads the slot selection, so clicking it must not clear it.
  if (e.composedPath().some(el => el.id === 'bounceBtn')) return;
  if (SEL_SCOPES.every(k => !multiSel[k].size)) {
    // nothing multi-selected: a click outside the item areas forgets the anchors
    if (!e.composedPath().some(el => el.id === 'slots' || el.id === 'faderBank' || el.id === 'wave' || el.id === 'detectorPanel'))
      SEL_SCOPES.forEach(k => { selAnchor[k] = null; });
    return;
  }
  const onSelected = e.composedPath().some(el => el.classList &&
    (el.classList.contains('msel') || (el.classList.contains('we-handle') && el.classList.contains('sel'))));
  if (onSelected) return;
  clearAllSel();
  if (state.viewMode === 'trigger') renderSampleEditor();
}, true);
window.addEventListener('click', e => {
  if (!marqueeSwallowClick) return;
  marqueeSwallowClick = false;
  e.stopPropagation(); e.preventDefault();
}, true);
function toggleSel(scope, id) {
  const set = multiSel[scope];
  if (set.has(id)) set.delete(id); else set.add(id);
  multiSel.scope = scope;
}
// Finder rules (icon view): Shift+click or Cmd/Ctrl+click adds/removes one
// item, so you can pick them one by one. Returns true when a modifier was
// used, so the caller skips its normal action (drag, audition).
const selAnchor = { env: null, knobs: null, faders: null, slots: null };
function finderClick(scope, id, e) {
  multiSel.scope = scope;
  const other = scope === 'faders' ? 'slots' : scope === 'slots' ? 'faders' : null;
  if (other && multiSel[other].size) { multiSel[other] = new Set(); selAnchor[other] = null; applySlotSelClasses(); }
  if (e.metaKey || e.ctrlKey || e.shiftKey) {
    // the item clicked just before (plain click) joins the selection too
    const prev = selAnchor[scope];
    if (!multiSel[scope].size && prev != null && prev !== id) multiSel[scope].add(prev);
    toggleSel(scope, id); selAnchor[scope] = id; return true;
  }
  selAnchor[scope] = id;
  return false;
}
const slotOrder = () => state.slots.map((_, i) => i);
const knobOrder = () => DET.map(c => c.key);
const envOrder = () => { const sl = currentSlot(); return sl && slotSample(sl) ? slotEnvPoints(sl).filter(q => q.k !== 'origin').map(q => q.sid) : []; };
function applySlotSelClasses() {
  document.querySelectorAll('#slots .slot[data-slot]').forEach(el =>
    el.classList.toggle('msel', multiSel.slots.has(+el.dataset.slot)));
  document.querySelectorAll('#faderBank .slot-fader[data-slot]').forEach(el =>
    el.classList.toggle('msel', multiSel.faders.has(+el.dataset.slot)));
}
function applyKnobSelClasses() {
  document.querySelectorAll('#detectorPanel .knob[data-key]').forEach(el =>
    el.classList.toggle('msel', multiSel.knobs.has(el.dataset.key)));
}
// Real-time INPUT DETECTOR (detector-worklet.js): gate -> filters -> detect run
// on the audio thread while the input plays. null = precomputed fallback.
let rtNode = null;
const RT_LOOKAHEAD = 0.1; // s · dry input delay that lets hits land on their onset
let liveGate = null, livePeak = null, liveKnownBlock = -1, rtLate = 0;
let dryGain = null;
let wetGain = null;
let slotNodes = [];
let meterRAF = null;
let inputSource = null;
let inputStartCtxTime = 0;
let inputPlaying = false;
let inputTimers = [];
let activeSlotSources = [];
let liveHitTimer = null;
let liveLastHitTime = 0;
let liveTriggerCount = 0;
let realInputBuffer = null;
let realInputPeaks = null;
let realHits = [];
let realInputDuration = 0;
let realGateEnv = null;
let realGateBlock = 0;
let realInputPeakEnv = null;
let realInputPeakBlock = 0;
let realInputBlockPeaks = null;
let realInputBlockPeaksKey = null;
let realInputMax = 1;
let liveLastVelocity = 0;
let inputMeterHold = 0;

// ---------- categories ----------
const CATEGORIES = [
  { id: 'Kick',   short: 'KICK',  color: '#FF3B5C' },
  { id: 'Snare',  short: 'SNARE', color: '#2D8CFF' },
  { id: 'Clap',   short: 'CLAP',  color: '#A855FF' },
  { id: 'HHC',    short: 'CL HH', color: '#FFC400' },
  { id: 'HHO',    short: 'OP HH', color: '#FF8A00' },
  { id: 'Cymbal', short: 'CYMBAL',color: '#FFE94D' },
  { id: 'Tom',    short: 'TOM',   color: '#00E0C6' },
  { id: 'Perc',   short: 'PERC',  color: '#43E97B' },
  { id: 'FX',     short: 'FX',    color: '#FF3DAE' },
];
const CAT = Object.fromEntries(CATEGORIES.map(c => [c.id, c]));

// ---------- category palettes ----------
// "cvd" is Paul Tol's "light" scheme: designed to stay distinguishable for the common
// colour-vision deficiencies (deuteranopia, protanopia, tritanopia) and readable on dark.
const PALETTES = {
  standard: Object.fromEntries(CATEGORIES.map(c => [c.id, c.color])),
  cvd: { Kick: '#EE8866', Snare: '#77AADD', Clap: '#FFAABB', HHC: '#EEDD88', HHO: '#BBCC33',
         Cymbal: '#AAAA00', Tom: '#44BB99', Perc: '#99DDFF', FX: '#DDDDDD' },
};
function loadVisualPrefs() {
  const d = { palette: 'standard', shapes: false, scale: 100, reduceMotion: false, reduceTransparency: false };
  let prefs, stored = null;
  try {
    stored = localStorage.getItem('tu-visual');
    prefs = Object.assign(d, JSON.parse(stored || '{}'));
  } catch (e) { prefs = d; }
  // Inside the AU there is no browser zoom and the host window is often
  // smaller than the design: start at 90% so the slot dock stays visible.
  if (!stored && window.__TU_NATIVE__) prefs.scale = 90;
  // >100% zoom makes the fixed trigger page taller than the viewport and the
  // fader bank overlaps the slot dock. The trigger page is a 100vh layout, so
  // only 90/100 are safe at every viewport.
  prefs.scale = prefs.scale === 90 ? 90 : 100;
  return prefs;
}
const visualPrefs = loadVisualPrefs();
function setCategoryPalette(name) {
  const p = PALETTES[name] || PALETTES.standard;
  CATEGORIES.forEach(c => { c.color = p[c.id]; });
}
setCategoryPalette(visualPrefs.palette);

// Category shapes: a second cue besides colour (Settings → VISUAL → SHAPES).
const CAT_SHAPE = { Kick: 'circle', Snare: 'square', Clap: 'triangle', HHC: 'diamond', HHO: 'triangleDown',
                    Cymbal: 'hexagon', Tom: 'pentagon', Perc: 'cross', FX: 'star' };
function shapePath(ctx, shape, x, y, r) {
  ctx.beginPath();
  const poly = (n, rot = -Math.PI / 2, rr = r) => {
    for (let i = 0; i < n; i++) {
      const a = rot + i * 2 * Math.PI / n;
      i ? ctx.lineTo(x + rr * Math.cos(a), y + rr * Math.sin(a)) : ctx.moveTo(x + rr * Math.cos(a), y + rr * Math.sin(a));
    }
    ctx.closePath();
  };
  switch (shape) {
    case 'square': { const s = r * .88; ctx.rect(x - s, y - s, 2 * s, 2 * s); break; }
    case 'triangle': poly(3, -Math.PI / 2, r * 1.18); break;
    case 'triangleDown': poly(3, Math.PI / 2, r * 1.18); break;
    case 'diamond': poly(4, -Math.PI / 2, r * 1.15); break;
    case 'hexagon': poly(6, 0, r * 1.05); break;
    case 'pentagon': poly(5, -Math.PI / 2, r * 1.08); break;
    case 'cross': { const w = r * .42, l = r * 1.1;
      ctx.rect(x - l, y - w, 2 * l, 2 * w); ctx.rect(x - w, y - l, 2 * w, 2 * l); break; }
    case 'star': {
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * .55 : r * 1.25;
        i ? ctx.lineTo(x + rr * Math.cos(a), y + rr * Math.sin(a)) : ctx.moveTo(x + rr * Math.cos(a), y + rr * Math.sin(a));
      }
      ctx.closePath(); break;
    }
    default: ctx.arc(x, y, r, 0, 6.2832);
  }
}
// CSS clip-path versions for small DOM dots (legend swatches, similarity dots, file rows, slots)
const SHAPE_CLIP = {
  circle: 'circle(50%)', square: 'inset(6%)', triangle: 'polygon(50% 0,100% 100%,0 100%)',
  triangleDown: 'polygon(0 0,100% 0,50% 100%)', diamond: 'polygon(50% 0,100% 50%,50% 100%,0 50%)',
  hexagon: 'polygon(25% 3%,75% 3%,100% 50%,75% 97%,25% 97%,0 50%)',
  pentagon: 'polygon(50% 0,100% 38%,81% 100%,19% 100%,0 38%)',
  cross: 'polygon(32% 0,68% 0,68% 32%,100% 32%,100% 68%,68% 68%,68% 100%,32% 100%,32% 68%,0 68%,0 32%,32% 32%)',
  star: 'polygon(50% 0,61% 35%,98% 35%,68% 57%,79% 91%,50% 70%,21% 91%,32% 57%,2% 35%,39% 35%)',
};
const isReducedMotion = () => !!visualPrefs.reduceMotion;

const WORDS = {
  Kick:   ['Sub Anchor', 'Deep Orbit', 'Low Gravity', 'Concrete', 'Event Horizon', 'Pulse', 'Tectonic', 'Nebula', 'Basalt', 'Gravity Well'],
  Snare:  ['Wire Frame', 'Bright Halo', 'Ghost Signal', 'Rim Echo', 'Static Bloom', 'Cracked Light', 'Solar Flare', 'Tin Ghost', 'Paper Sky'],
  Clap:   ['Hand Cluster', 'Wide Signal', 'Paper Snap', 'Twin Palms', 'Crowd Echo', 'Flash Cluster', 'Room Hands'],
  HHC:    ['Needle', 'Closed Orbit', 'Quartz Tick', 'Micro Spark', 'Tight Beam', 'Pin Point'],
  HHO:    ['Open Orbit', 'Air Gate', 'Long Spark', 'Glass Wash', 'Open Field'],
  Cymbal: ['Crash Field', 'Ride Wave', 'Metal Sky', 'Slow Shimmer', 'Bronze Halo', 'Thin Alloy'],
  Tom:    ['Round Body', 'Deep Skin', 'Cave Tone', 'Low Bounce', 'Wood Ring'],
  Perc:   ['Shaker Dust', 'Wood Block', 'Bell Fragment', 'Conga Step', 'Clave Light', 'Frame Drum', 'Cowbell'],
  FX:     ['Reverse Swell', 'Dust Cloud', 'Radio Ghost', 'Tape Lift', 'Noise Bloom', 'Impact Wave', 'Grain Fall'],
};

const DUR = { min: 20, max: 8000 };
const BRI = { min: 30, max: 16000 };
const RANGES = {
  Kick:   { dur: [55, 720],   bright: [32, 340],     drum: [.86, 1] },
  Snare:  { dur: [85, 620],   bright: [700, 5400],   drum: [.80, 1] },
  Clap:   { dur: [65, 480],   bright: [950, 6800],   drum: [.78, 1] },
  HHC:    { dur: [22, 230],   bright: [3400, 13200], drum: [.84, 1] },
  HHO:    { dur: [110, 950],  bright: [2400, 11500], drum: [.66, 1] },
  Cymbal: { dur: [650, 6200], bright: [2400, 13500], drum: [.42, .96] },
  Tom:    { dur: [170, 1700], bright: [65, 650],     drum: [.70, 1] },
  Perc:   { dur: [45, 1200],  bright: [220, 8200],   drum: [.48, 1] },
  FX:     { dur: [110, 5200], bright: [130, 11200],  drum: [.28, .96] },
};
const COUNTS = { Kick: 283, Snare: 198, Perc: 145, HHC: 99, FX: 66, Clap: 64, HHO: 61, Tom: 44, Cymbal: 40 };

function samplePath(cat, bright, drum, root) {
  let sub;
  switch (cat) {
    case 'Kick': sub = bright < 200 ? 'Kicks/Acoustic' : 'Kicks/Electronic'; break;
    case 'Snare': sub = drum > .93 ? 'Snares/Acoustic' : 'Snares/Rim'; break;
    case 'Perc': sub = drum > .82 ? 'Percussion/Shakers' : 'Percussion/Blocks'; break;
    case 'HHC': sub = 'Hats/Closed'; break;
    case 'HHO': sub = 'Hats/Open'; break;
    case 'Clap': sub = 'Claps'; break;
    case 'Cymbal': sub = 'Cymbals'; break;
    case 'Tom': sub = 'Toms'; break;
    case 'FX': sub = 'FX'; break;
    default: sub = cat;
  }
  return `SAMPLES FOLDER/${sub}`;
}

function makeSample(uid, cat, i, root) {
  const r = RANGES[cat.id];
  const wordPool = WORDS[cat.id];
  const dur = denormLog(rand(), r.dur[0], r.dur[1]);
  const bright = denormLog(rand(), r.bright[0], r.bright[1]);
  const drum = lerp(r.drum[0], r.drum[1], rand());
  const x = clamp(normLog(dur, DUR.min, DUR.max) + (rand() - .5) * .026, .002, .998);
  const y = clamp(normLog(bright, BRI.min, BRI.max) + (rand() - .5) * .026, .002, .998);
  const folder = root === 'Splice' ? 'Splice' : root === 'User Samples' ? 'User Samples' : 'Core Library';
  return {
    id: uid,
    name: `${wordPool[i % wordPool.length]} ${String(i + 1).padStart(2, '0')}`,
    category: cat.id, dur, bright, drum, x, y, folder,
    z: rand(),
    path: samplePath(cat.id, bright, drum, root),
    addedDays: Math.floor(rand() * 420),
    favorite: rand() < .07,
  };
}

function buildSamples() {
  const out = [];
  let uid = 1;
  for (const cat of CATEGORIES) {
    const n = COUNTS[cat.id] || 40;
    for (let i = 0; i < n; i++) {
      const fr = rand();
      const root = fr < .70 ? 'Samples' : fr < .90 ? 'Splice' : 'User Samples';
      out.push(makeSample(uid++, cat, i, root));
    }
  }
  return out;
}

const samples = buildSamples();

const FAV_KEY = 'tu:favorites:v1';
function loadFavoriteIds() {
  try {
    const raw = JSON.parse(localStorage.getItem(FAV_KEY) || '[]');
    return Array.isArray(raw) ? raw.filter(id => Number.isFinite(id)) : [];
  } catch (e) { return []; }
}
function saveFavorites() {
  try { localStorage.setItem(FAV_KEY, JSON.stringify([...state.favorites])); } catch (e) {}
}

// ---------- state ----------
const state = {
  samples,
  slots: [],
  selectedSlot: 0,
  hover: null,
  selectedSample: null,
  favorites: new Set(loadFavoriteIds()),
  sim: { baseId: null, list: [], index: 0 },
  simVisible: false,
  travel: null,
  scanning: false,
  pointer: null,
  scrubTrail: { pts: [], alpha: 1 },
  viewMode: 'universe',
  libraryRoots: [],
  prevView: 'universe',
  fileFolder: 'ALL',
  expanded: new Set(['ALL', 'SAMPLES FOLDER', 'SAMPLES FOLDER/Kicks', 'SAMPLES FOLDER/Snares', 'SAMPLES FOLDER/Hats', 'SAMPLES FOLDER/Percussion']),
  filters: { search: '' },
  view: { zoom: 1, panX: 0, panY: 0 },
  drag: null,
  dragAlt: false,
  pan: null,
  popoverSlot: null,
  // AUTO PHASE is global: one switch, one reference and one mode for all 8
  // slots. ref = 'INPUT' or a slot index 0..7 (that slot is left untouched and
  // the others align to it). mode = 'offset' | 'polarity' | 'both'.
  ap: { on: true, ref: 'INPUT', mode: 'polarity' },
  detector: { attack: .5, hold: 30, release: 150, sens: 51, retrig: 30, detail: 14, low: 20, high: 20000, supp: 0, input: 0, mix: 0, gate: false, gateThreshold: -24, gateAuto: 'learn' },
};

function pickByCategory(cat, offset = 0) {
  const pool = samples.filter(s => s.category === cat);
  return pool[offset % pool.length];
}
function buildSlots() {
  state.slots = Array.from({ length: 8 }, (_, i) => ({
    id: i, label: `SLOT ${String(i + 1).padStart(2, '0')}`,
    sampleId: null,
    level: 0, pan: 0, tune: 0,
    mute: false, solo: false,
    polarity: false, shift: 0, offset: 0, // manual: Ø, 90° shift, offset trim (ms)
    ap: null,                             // AUTO PHASE result: { lag, invert, corr } | { isRef }
    adsr: { a: 0, d: 120, end: 800, s: .5, p: 1, e: 0 },
    start: 0, end: 1, fadeIn: 0, fadeOut: 0,
    reverse: false,
    tone: 0, cut: 100, velSens: 100, gain: 0,
    playback: 'one-shot', loop: false,
  }));
}
buildSlots();

// Real snare supplied by the user: first hit becomes the slot sample;
// the full file is used as the trigger INPUT sequence.
const realSample = {
  id: 9001,
  name: 'SNARE.cm',
  category: 'Snare',
  dur: 510,
  bright: 2500,
  drum: .95,
  x: clamp(normLog(510, DUR.min, DUR.max), .002, .998),
  y: clamp(normLog(2500, BRI.min, BRI.max), .002, .998),
  folder: 'User Samples',
  path: 'SAMPLES FOLDER',
  addedDays: 0,
  favorite: false,
  isReal: true,
  audioBuffer: null,
};
samples.push(realSample);
const slotSample = slot => state.samples.find(s => s.id === slot.sampleId) || null;

// ---------- browser selection + slot editor ----------
function selectSample(smp, closeTrigger = true, opts = {}) {
  if (!smp) return;
  state.selectedSample = smp;
  setNameBar(smp);
  if (!opts.keepSim) resetSimilarity(smp);
  else updateSimilarityUI();
  drawUniverse();
  renderFileList();
}

function openSlotEditor(i) {
  hideSimilarity();
  selectSlot(i);
  setInspectorTab('env');
  updateInspector();
}

function setInspectorTab(tab) {
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  $$('.panel').forEach(p => p.classList.toggle('active', p.dataset.panel === tab));
}

// ---------- search / universe ----------
function passes(s) {
  const q = state.filters.search;
  if (!q) return true;
  return `${s.name} ${s.category} ${s.folder} ${s.path}`.toLowerCase().includes(q.toLowerCase());
}
const visible = () => state.samples.filter(passes);

const canvas = $('#universe');
const wrap = $('.canvas-wrap');
const nameBar = $('#nameBar');
const nameBarText = $('#nameBarText');
const dragFxCanvas = $('#dragFx');
const dragFxCtx = dragFxCanvas.getContext('2d');
let dragFxW = window.innerWidth, dragFxH = window.innerHeight, dragFxDpr = 1;

function resizeDragFx() {
  dragFxDpr = Math.min(2, window.devicePixelRatio || 1);
  dragFxW = window.innerWidth;
  dragFxH = window.innerHeight;
  dragFxCanvas.width = Math.round(dragFxW * dragFxDpr);
  dragFxCanvas.height = Math.round(dragFxH * dragFxDpr);
  dragFxCanvas.style.width = dragFxW + 'px';
  dragFxCanvas.style.height = dragFxH + 'px';
  dragFxCtx.setTransform(dragFxDpr, 0, 0, dragFxDpr, 0, 0);
}
window.addEventListener('resize', resizeDragFx);
resizeDragFx();
let plot = { x: 0, y: 0, w: 1, h: 1 };
let canvasW = 1, canvasH = 1;

function resizeCanvas() {
  const r = wrap.getBoundingClientRect();
  if (r.width < 10 || r.height < 10) return;
  canvasW = Math.max(50, r.width);
  canvasH = Math.max(50, r.height);
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(canvasW * dpr);
  canvas.height = Math.round(canvasH * dpr);
  canvas.style.width = canvasW + 'px';
  canvas.style.height = canvasH + 'px';
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const bleed = 36;
  plot = { x: -bleed, y: -bleed, w: canvasW + bleed * 2, h: canvasH + bleed * 2 };
  drawUniverse();
}

function toPx(s) {
  const cx = plot.x + plot.w / 2, cy = plot.y + plot.h / 2;
  const depth = s.z ?? .5;
  const scale = .84 + depth * .32;
  return {
    x: cx + (s.x - .5) * plot.w * state.view.zoom * scale + state.view.panX,
    y: cy - (s.y - .5) * plot.h * state.view.zoom * scale + state.view.panY,
  };
}

const starRand = mulberry32(0xC0FFEE);
const STARS = Array.from({ length: 220 }, () => ({
  x: starRand(), y: starRand(), z: starRand(), s: .3 + starRand() * 1.4,
}));

let trailFadeRAF = null;

function startScrubTrail(smp) {
  if (!smp) return;
  cancelAnimationFrame(trailFadeRAF);
  state.scrubTrail = { pts: [smp], alpha: 1, cut: 0 };
}

function appendScrubTrail(smp) {
  if (!smp) return;
  const tr = state.scrubTrail;
  const last = tr.pts[tr.pts.length - 1];
  if (last && last.id === smp.id) return;
  tr.pts.push(smp);
  if (tr.pts.length > 80) tr.pts.shift();
  tr.alpha = 1; tr.cut = 0;
}

function stopScrub() {
  const was = state.scanning;
  state.scanning = false;
  stopHoverPreview();
  if (was) fadeScrubTrail();
}

// The trail erases from its oldest point toward the newest one: tr.cut sweeps 0 → 1 along it.
function fadeScrubTrail() {
  cancelAnimationFrame(trailFadeRAF);
  const tr = state.scrubTrail;
  if (tr.pts.length < 2 || isReducedMotion()) { tr.pts = []; tr.alpha = 1; tr.cut = 0; drawUniverse(); return; }
  const t0 = performance.now(), dur = 2400;
  const step = now => {
    const k = clamp((now - t0) / dur, 0, 1);
    tr.cut = k * k * (3 - 2 * k);           // ease in-out
    drawUniverse();
    if (k < 1) trailFadeRAF = requestAnimationFrame(step);
    else { tr.pts = []; tr.alpha = 1; tr.cut = 0; drawUniverse(); }
  };
  trailFadeRAF = requestAnimationFrame(step);
}

function drawPointerAura(ctx) {
  const p = state.pointer;
  if (!p || state.pan || state.drag) return;
  const r = PICK_RADIUS;
  const a = state.scanning ? .035 : .015;
  const g = ctx.createRadialGradient(p.x, p.y, r * .55, p.x, p.y, r);
  g.addColorStop(0, 'rgba(45,226,197,0)');
  g.addColorStop(1, `rgba(45,226,197,${a})`);
  ctx.save();
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 6.2832); ctx.fill();
  ctx.strokeStyle = `rgba(45,226,197,${state.scanning ? .12 : .05})`;
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 7]);
  ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 6.2832); ctx.stroke();
  ctx.restore();
}

function drawScrubTrail(ctx) {
  const tr = state.scrubTrail;
  if (!tr || tr.pts.length < 2 || tr.alpha <= 0) return;
  const pts = tr.pts.map(toPx);
  const a = tr.alpha, n = pts.length;
  // visibility along the trail while it erases (t = 0 oldest … 1 newest), soft edge of width W
  const W = .25, c = (tr.cut || 0) * (1 + W);
  const vis = t => clamp((t - c + W) / W, 0, 1);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (let i = 1; i < n; i++) {
    const t = i / (n - 1);
    const color = CAT[tr.pts[i].category].color;
    const v = vis(t) * a;
    if (v <= 0) continue;
    ctx.globalAlpha = (.06 + .14 * t) * v;
    ctx.strokeStyle = color;
    ctx.lineWidth = 8 - 3 * t;
    ctx.beginPath(); ctx.moveTo(pts[i - 1].x, pts[i - 1].y); ctx.lineTo(pts[i].x, pts[i].y); ctx.stroke();
    ctx.globalAlpha = (.28 + .60 * t) * v;
    ctx.lineWidth = 1.7;
    ctx.beginPath(); ctx.moveTo(pts[i - 1].x, pts[i - 1].y); ctx.lineTo(pts[i].x, pts[i].y); ctx.stroke();
  }
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const color = CAT[tr.pts[i].category].color;
    const v = vis(t) * a;
    if (v <= 0) continue;
    ctx.globalAlpha = (.15 + .45 * t) * v;
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(pts[i].x, pts[i].y, 1.8 + t * 1.2, 0, 6.2832); ctx.fill();
  }
  if (state.scanning) {
    const head = pts[n - 1];
    const color = CAT[tr.pts[n - 1].category].color;
    ctx.globalAlpha = .45 * a;
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(head.x, head.y, 8, 0, 6.2832); ctx.fill();
    ctx.globalAlpha = .95;
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(head.x, head.y, 2.4, 0, 6.2832); ctx.fill();
  }
  ctx.restore();
}

let universeRAF = null;
function requestUniverseDraw() {
  if (universeRAF) return;
  universeRAF = requestAnimationFrame(() => {
    universeRAF = null;
    drawUniverse();
  });
}

function drawUniverse() {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const { x: px, y: py, w: pw, h: ph } = plot;
  ctx.clearRect(0, 0, canvasW, canvasH);

  const g = ctx.createRadialGradient(px + pw * .55, py + ph * .45, 10, px + pw * .55, py + ph * .45, Math.max(pw, ph) * .75);
  g.addColorStop(0, 'rgba(124,92,255,.05)');
  g.addColorStop(.55, 'rgba(45,226,197,.016)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(px, py, pw, ph);

  ctx.save();
  ctx.beginPath(); ctx.rect(px, py, pw, ph); ctx.clip();

  // abstract starfield
  for (const st of STARS) {
    const sx = px + st.x * pw, sy = py + st.y * ph;
    ctx.globalAlpha = .05 + st.z * .20;
    ctx.fillStyle = st.z > .82 ? 'rgba(45,226,197,.9)' : 'rgba(200,210,230,.9)';
    ctx.fillRect(sx, sy, st.s, st.s);
  }
  ctx.globalAlpha = 1;

  let vis = 0;
  ctx.globalCompositeOperation = 'lighter';
  for (const s of state.samples) {
    if (s.analyzed === false) continue;
    const on = passes(s);
    if (on) vis++;
    const p = toPx(s);
    if (p.x < px - 8 || p.x > px + pw + 8 || p.y < py - 8 || p.y > py + ph + 8) continue;
    const depth = s.z ?? .5;
    const color = CAT[s.category].color;
    // 3D halo
    const glowK = visualPrefs.palette === 'cvd' ? .62 : 1;   // pale CVD colours bloom to white otherwise
    const shape = visualPrefs.shapes ? CAT_SHAPE[s.category] : 'circle';
    ctx.globalAlpha = (on ? (.045 + depth * .10) : .008) * glowK;
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(p.x, p.y, 3.4 + depth * 5.4, 0, 6.2832); ctx.fill();
    // vivid core
    ctx.globalAlpha = (on ? (.40 + depth * .60) : .04) * (glowK < 1 ? .85 : 1);
    if (shape === 'circle') { ctx.beginPath(); ctx.arc(p.x, p.y, .9 + depth * 2.5, 0, 6.2832); }
    else shapePath(ctx, shape, p.x, p.y, 1.6 + depth * 2.6);
    ctx.fill();
    // specular highlight for depth
    if (on && depth > .55 && shape === 'circle') {
      ctx.globalAlpha = .55 * depth * glowK;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(p.x - .8, p.y - .8, .55 + depth * .55, 0, 6.2832); ctx.fill();
      ctx.fillStyle = color;
    }
  }
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;

  drawPointerAura(ctx);
  drawScrubTrail(ctx);

  for (const s of [state.hover, state.selectedSample]) {
    if (!s) continue;
    const p = toPx(s);
    const depth = s.z ?? .5;
    const rr = (s === state.hover ? 6.5 : 8.5) + depth * 3;
    ctx.strokeStyle = CAT[s.category].color;
    ctx.globalAlpha = .9;
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(p.x, p.y, rr, 0, 6.2832); ctx.stroke();
    if (s === state.hover) {
      ctx.globalAlpha = .22;
      ctx.beginPath(); ctx.arc(p.x, p.y, rr + 6, 0, 6.2832); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  if (state.travel) {
    const { from, to, progress } = state.travel;
    const a = toPx(from), b = toPx(to);
    const ex = lerp(a.x, b.x, progress), ey = lerp(a.y, b.y, progress);
    const color = CAT[to.category].color;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.setLineDash([3, 6]);
    ctx.strokeStyle = 'rgba(255,255,255,.24)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    ctx.setLineDash([]);
    const grad = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
    grad.addColorStop(0, 'rgba(45,226,197,0)');
    grad.addColorStop(1, color);
    ctx.strokeStyle = grad;
    ctx.lineWidth = 2.2;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(ex, ey); ctx.stroke();
    for (let i = 1; i <= 4; i++) {
      const t = Math.max(0, progress - i * .05);
      const tx = lerp(a.x, b.x, t), ty = lerp(a.y, b.y, t);
      ctx.globalAlpha = Math.max(.08, .48 - i * .1);
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(tx, ty, Math.max(1, 3.6 - i * .6), 0, 6.2832); ctx.fill();
    }
    ctx.fillStyle = color;
    ctx.globalAlpha = .45;
    ctx.beginPath(); ctx.arc(ex, ey, 8, 0, 6.2832); ctx.fill();
    ctx.globalAlpha = .95;
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(ex, ey, 2.4, 0, 6.2832); ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

const PICK_RADIUS = 20;

function pickSample(mx, my) {
  let best = null, bestD = PICK_RADIUS;
  for (const s of state.samples) {
    const p = toPx(s);
    let d = Math.hypot(p.x - mx, p.y - my);
    if (!passes(s)) d += 1000;
    if (d < bestD) { bestD = d; best = s; }
  }
  return best;
}


function setNameBar(smp, fallback = true) {
  if (!nameBar || !nameBarText) return;
  const s = smp || (fallback ? state.selectedSample : null);
  nameBarText.textContent = s ? s.name : '';
  nameBar.classList.toggle('show', !!s);
}

function setSlotNameBar(i) {
  const smp = slotSample(state.slots[i]);
  if (smp) setNameBar(smp, false);
  else {
    nameBarText.textContent = `TRIGGER SLOT ${String(i + 1).padStart(2, '0')} · EMPTY`;
    nameBar.classList.add('show');
  }
}

// ---------- similarity ----------
function sampleDistance(a, b) {
  const cat = a.category === b.category ? 0 : 2.4;
  const dur = Math.abs(Math.log(a.dur) - Math.log(b.dur)) * 1.15;
  const bright = Math.abs(Math.log(a.bright) - Math.log(b.bright)) * .75;
  const drum = Math.abs(a.drum - b.drum) * 1.8;
  return cat + dur + bright + drum;
}

function similarSamples(smp, limit = 32) {
  const ranked = state.samples
    .filter(s => s.id !== smp.id)
    .map(s => ({ s, d: sampleDistance(smp, s) }))
    .sort((a, b) => a.d - b.d)
    .map(x => x.s);
  // Keep the closest timbres, but enforce a minimum visual spread so the
  // arrows move through the cloud instead of landing on near-duplicates.
  const picked = [];
  const anchors = [smp];
  const minD = .05;
  for (const s of ranked) {
    if (anchors.every(a => Math.hypot(a.x - s.x, a.y - s.y) >= minD)) {
      picked.push(s);
      anchors.push(s);
      if (picked.length >= limit) break;
    }
  }
  if (picked.length < limit) {
    for (const s of ranked) {
      if (!picked.includes(s)) picked.push(s);
      if (picked.length >= limit) break;
    }
  }
  return picked.slice(0, limit);
}

function resetSimilarity(smp) {
  if (!smp) {
    state.sim = { baseId: null, list: [], index: 0 };
    updateSimilarityUI();
    return;
  }
  const near = similarSamples(smp, 32);
  state.sim = { baseId: smp.id, list: [smp.id, ...near.map(s => s.id)], index: 0 };
  updateSimilarityUI();
}

function updateSimilarityUI() {
  const sel = state.selectedSample;
  const dots = $('#simDots');
  const count = $('#count');
  const prev = $('#simPrev'), next = $('#simNext');
  const target = $('#simTarget');
  const fav = $('#simFav');
  if (!sel || !state.sim.list.length) {
    dots.innerHTML = '';
    count.textContent = sel ? sel.name : 'Select a sample';
    if (prev) prev.disabled = true;
    if (next) next.disabled = true;
    if (target) { target.style.background = 'var(--muted-2)'; target.style.color = 'var(--muted-2)'; }
    if (fav) fav.classList.remove('on');
    return;
  }
  const curId = state.sim.list[state.sim.index];
  const cur = state.samples.find(s => s.id === curId) || sel;
  dots.innerHTML = state.sim.list.map((id, i) => {
    const s = state.samples.find(x => x.id === id);
    if (!s) return '';
    const color = CAT[s.category].color;
    return `<i class="cat-mark ${i === state.sim.index ? 'active' : ''}" data-id="${id}" data-index="${i}" style="background:${color};color:${color};--shape:${SHAPE_CLIP[CAT_SHAPE[s.category]]}" title="${s.name}"></i>`;
  }).join('');
  count.textContent = `${state.sim.index + 1} / ${state.sim.list.length} · ${cur.name}`;
  if (prev) prev.disabled = state.sim.list.length < 2;
  if (next) next.disabled = state.sim.list.length < 2;
  const c = CAT[cur.category];
  if (target) { target.style.background = c.color; target.style.color = c.color; }
  if (fav) {
    const on = state.favorites.has(cur.id);
    fav.classList.toggle('on', on);
    fav.title = on ? 'Remove favorite' : 'Add favorite';
  }
}

const SIM_HIDE_MS = 3500;
let simHideTimer = null;

function restartSimTimer() {
  clearTimeout(simHideTimer);
  if (!state.simVisible) return;
  simHideTimer = setTimeout(() => hideSimilarity(), SIM_HIDE_MS);
}

function showSimilarity() {
  state.simVisible = true;
  $('#similarBar').classList.add('show');
  restartSimTimer();
}

function hideSimilarity() {
  clearTimeout(simHideTimer);
  if (!state.simVisible && !$('#similarBar').classList.contains('show')) return;
  state.simVisible = false;
  $('#similarBar').classList.remove('show');
}

function toggleFavorite(id) {
  const smp = state.samples.find(s => s.id === id);
  if (!smp) return;
  if (state.favorites.has(id)) state.favorites.delete(id);
  else state.favorites.add(id);
  saveFavorites();
  updateSimilarityUI();
  renderFolderTree();
  if (state.viewMode === 'files') renderFileList();
  toast(state.favorites.has(id) ? `♥ ${smp.name}` : `Removed ${smp.name}`);
}

function navigateSimilar(dir) {
  if (!state.simVisible) return;
  const list = state.sim.list;
  if (list.length < 2) return;
  const from = state.selectedSample;
  const idx = (state.sim.index + dir + list.length) % list.length;
  const smp = state.samples.find(s => s.id === list[idx]);
  if (!smp) return;
  state.sim.index = idx;
  selectSample(smp, true, { keepSim: true });
  travelTo(smp, from);
  restartSimTimer();
}

// ---------- universe focus / travel ----------
let viewAnimRAF = null;

function softPanFor(s) {
  const p = toPx(s);
  const mx = Math.min(170, canvasW * .20);
  const myTop = Math.min(150, canvasH * .21);
  // Keep the focused sample above the persistent slot dock at the bottom.
  const myBottom = Math.min(230, canvasH * .30);
  const tx = clamp(p.x, mx, canvasW - mx);
  const ty = clamp(p.y, myTop, canvasH - myBottom);
  return { x: state.view.panX + (tx - p.x), y: state.view.panY + (ty - p.y) };
}

function animateViewTo(to, from = null, duration = 420) {
  cancelAnimationFrame(viewAnimRAF);
  if (isReducedMotion()) {
    const p = softPanFor(to);
    state.view.panX = p.x; state.view.panY = p.y; state.travel = null;
    drawUniverse(); return;
  }
  const startPan = { x: state.view.panX, y: state.view.panY };
  const targetPan = softPanFor(to);
  const dist = Math.hypot(targetPan.x - startPan.x, targetPan.y - startPan.y);
  if (dist < .5 && !from) { drawUniverse(); return; }
  const dur = from ? 480 : Math.min(duration, 240 + dist * .5);
  const t0 = performance.now();
  state.travel = from ? { from, to, progress: 0 } : null;
  const step = now => {
    const k = clamp((now - t0) / dur, 0, 1);
    const e = 1 - Math.pow(1 - k, 3);
    state.view.panX = lerp(startPan.x, targetPan.x, e);
    state.view.panY = lerp(startPan.y, targetPan.y, e);
    if (state.travel) state.travel.progress = e;
    drawUniverse();
    if (k < 1) viewAnimRAF = requestAnimationFrame(step);
    else { state.travel = null; drawUniverse(); }
  };
  viewAnimRAF = requestAnimationFrame(step);
}

function travelTo(to, from) {
  if (!to) return;
  if (!from || from.id === to.id) { focusSample(to, true); return; }
  animateViewTo(to, from, 480);
}

function focusSample(smp, animate = true) {
  if (!smp) {
    cancelAnimationFrame(viewAnimRAF);
    state.travel = null;
    drawUniverse();
    return;
  }
  const target = softPanFor(smp);
  if (Math.hypot(target.x - state.view.panX, target.y - state.view.panY) < .5) {
    drawUniverse();
    return;
  }
  if (animate) animateViewTo(smp, null, 360);
  else {
    const p = softPanFor(smp);
    state.view.panX = p.x;
    state.view.panY = p.y;
    drawUniverse();
  }
}

// ---------- drag & drop: planet carry ----------
let dragStarted = false;
let dragStart = null;
let dragCursor = { x: 0, y: 0 };
let dragPos = { x: 0, y: 0 };
let dragOrigin = { x: 0, y: 0 };
let dragPlanetScale = 1;
let dragTargetSlot = null;
let dragDrop = null;
let dragTrailPts = [];
let dragSparks = [];
let dragRings = [];
let dragRAF = null;
let dragLast = 0;
let dragRgb = '124,92,255';
let dragDepth = .5;
let dragLabelText = '';
let dragLabelT0 = 0;

const DRAG_TRAIL_MS = 480;
const DRAG_FLY_MS = 190;

function hexRgbTriplet(hex) {
  const v = parseInt(String(hex).replace('#', ''), 16);
  return `${(v >> 16) & 255},${(v >> 8) & 255},${v & 255}`;
}

function setPlanetColor(hex) {
  dragRgb = hexRgbTriplet(hex);
}

function spawnDragRing(x, y, rgb = dragRgb, strength = 1) {
  if (isReducedMotion()) return;
  dragRings.push({ x, y, t: performance.now(), rgb, strength });
}

function spawnDragBurst(x, y, rgb = dragRgb) {
  if (isReducedMotion()) return;
  const now = performance.now();
  for (let i = 0; i < 12; i++) {
    const a = (Math.PI * 2 * i) / 18 + Math.random() * .5;
    const sp = 40 + Math.random() * 130;
    dragSparks.push({
      x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
      t: now, life: 420 + Math.random() * 260, rgb,
      size: 1.2 + Math.random() * 1.8,
    });
  }
  spawnDragRing(x, y, rgb, 1.5);
}

function magnetSlotAt(x, y) {
  let best = null, bestD = Infinity;
  $$('.slot[data-slot]').forEach(el => {
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const d = Math.hypot(cx - x, cy - y);
    const reach = Math.max(54, Math.max(r.width, r.height) * .92);
    if (d < reach && d < bestD) { bestD = d; best = el; }
  });
  return best;
}

function setMagnetSlot(slot) {
  dragTargetSlot = slot;
  $$('.slot[data-slot]').forEach(x => x.classList.toggle('drop-target', x === slot));
}

function updateSlotMagnification() {
  if (!state.drag || !dragStarted) return;
  $$('.slot[data-slot]').forEach(el => {
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const dx = dragCursor.x - cx;
    const prox = Math.exp(-(dx * dx) / (2 * 92 * 92));
    const scale = 1.05 + .07 * prox;
    el.style.transform = `scale(${scale.toFixed(3)})`;
  });
}

function startPlanetDrag(smp) {
  setPlanetColor(CAT[smp.category].color);
  dragDepth = smp.z ?? .5;
  dragLabelText = smp.name.toUpperCase();
  dragLabelT0 = performance.now();
  $('#slotDock').classList.add('invite');
  document.body.classList.add('dragging-planet');
  dragPos = { x: dragOrigin.x, y: dragOrigin.y };
  dragCursor = { ...dragPos };
  dragPlanetScale = .48;
  dragTrailPts = [];
  dragSparks = [];
  dragRings = [];
  ensureDragLoop();
}

function endPlanetDrag() {
  document.body.classList.remove('dragging-planet');
  $('#slotDock').classList.remove('invite');
  $$('.slot[data-slot]').forEach(el => { el.style.transform = ''; });
  setMagnetSlot(null);
  dragDrop = null;
  dragLabelText = '';
}

function completePlanetDrop(drop = dragDrop) {
  if (!drop || drop.done) return;
  drop.done = true;
  const { smp, slotIndex, toX, toY, rgb } = drop;
  const isCurrent = dragDrop === drop;
  if (isCurrent) {
    dragDrop = null;
    endPlanetDrag();
  }
  spawnDragBurst(toX, toY, rgb);
  assignSample(slotIndex, smp);
  const slotEl = document.querySelector(`.slot[data-slot="${slotIndex}"]`);
  if (slotEl) {
    slotEl.classList.add('slot-impact');
    setTimeout(() => slotEl.classList.remove('slot-impact'), 640);
  }
  const faderEl = document.querySelector(`.slot-fader[data-slot="${slotIndex}"]`);
  if (faderEl) {
    faderEl.classList.add('fader-impact');
    setTimeout(() => faderEl.classList.remove('fader-impact'), 640);
  }
  ensureDragLoop();
}

function updateDragFx(now, dt) {
  updateSlotMagnification();
  if (state.drag && dragStarted) {
    const k = Math.min(1, .46 * dt);
    dragPos.x += (dragCursor.x - dragPos.x) * k;
    dragPos.y += (dragCursor.y - dragPos.y) * k;
    dragPlanetScale += (1 - dragPlanetScale) * Math.min(1, .3 * dt);
    const last = dragTrailPts.length ? dragTrailPts[dragTrailPts.length - 1] : null;
    if (!last || now - last.t > 18 || Math.hypot(dragPos.x - last.x, dragPos.y - last.y) > 7) {
      if (!isReducedMotion()) dragTrailPts.push({ x: dragPos.x, y: dragPos.y, t: now, rgb: dragRgb });
      if (Math.random() < .55) {
        dragSparks.push({
          x: dragPos.x + (Math.random() - .5) * 18,
          y: dragPos.y + (Math.random() - .5) * 18,
          vx: (Math.random() - .5) * 45,
          vy: (Math.random() - .5) * 45,
          t: now, life: 300 + Math.random() * 260, rgb: dragRgb,
          size: .8 + Math.random() * 1.4,
        });
      }
    }
  } else if (dragDrop) {
    const k = clamp((now - dragDrop.t0) / dragDrop.dur, 0, 1);
    const e = 1 - Math.pow(1 - k, 3);
    dragPos.x = lerp(dragDrop.fromX, dragDrop.toX, e);
    dragPos.y = lerp(dragDrop.fromY, dragDrop.toY, e);
    dragPlanetScale = lerp(dragDrop.fromScale, .16, e);
    if (k >= 1) completePlanetDrop();
  } else {
    dragPlanetScale += (.4 - dragPlanetScale) * Math.min(1, .2 * dt);
  }
  const trailCut = now - DRAG_TRAIL_MS;
  if (dragTrailPts.length && dragTrailPts[0].t < trailCut) {
    dragTrailPts = dragTrailPts.filter(p => p.t >= trailCut);
  }
  dragSparks = dragSparks.filter(s => {
    if (now - s.t > s.life) return false;
    const k = (now - s.t) / s.life;
    s.x += s.vx * .016 * (1 - k);
    s.y += s.vy * .016 * (1 - k);
    s.vx *= .96; s.vy *= .96;
    return true;
  });
  dragRings = dragRings.filter(r => now - r.t < 620);
}

function drawDragFx(now) {
  const ctx = dragFxCtx;
  const active = (state.drag && dragStarted) || dragDrop;
  ctx.clearRect(0, 0, dragFxW, dragFxH);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';

  const trailN = dragTrailPts.length;
  if (trailN >= 2) {
    for (let i = 1; i < trailN; i++) {
      const t = i / (trailN - 1);
      const a = dragTrailPts[i], b = dragTrailPts[i - 1];
      ctx.globalAlpha = .06 + .14 * t;
      ctx.strokeStyle = `rgb(${a.rgb})`;
      ctx.lineWidth = 8 - 3 * t;
      ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(a.x, a.y); ctx.stroke();
      ctx.globalAlpha = .28 + .60 * t;
      ctx.lineWidth = 1.7;
      ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(a.x, a.y); ctx.stroke();
    }
    for (let i = 0; i < trailN; i++) {
      const t = i / (trailN - 1);
      const p = dragTrailPts[i];
      ctx.globalAlpha = .15 + .45 * t;
      ctx.fillStyle = `rgb(${p.rgb})`;
      ctx.beginPath(); ctx.arc(p.x, p.y, 1.8 + t * 1.2, 0, 6.2832); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  ctx.globalAlpha = 1;
  for (const s of dragSparks) {
    const age = clamp((now - s.t) / s.life, 0, 1);
    ctx.fillStyle = `rgba(${s.rgb},${(1 - age) * .8})`;
    ctx.beginPath(); ctx.arc(s.x, s.y, s.size * (1 - age * .5), 0, 6.2832); ctx.fill();
  }
  for (const r of dragRings) {
    const age = clamp((now - r.t) / 620, 0, 1);
    const rad = 8 + age * 78 * r.strength;
    ctx.strokeStyle = `rgba(${r.rgb},${(1 - age) * .55})`;
    ctx.lineWidth = 1.6 * (1 - age * .6);
    ctx.beginPath(); ctx.arc(r.x, r.y, rad, 0, 6.2832); ctx.stroke();
  }
  if (active) {
    const rgb = dragDrop ? dragDrop.rgb : dragRgb;
    const sc = dragPlanetScale || 1;
    const haloR = (3.4 + dragDepth * 5.4) * sc;
    const coreR = (.9 + dragDepth * 2.5) * sc;
    ctx.globalAlpha = .10 + dragDepth * .16;
    ctx.fillStyle = `rgb(${rgb})`;
    ctx.beginPath(); ctx.arc(dragPos.x, dragPos.y, haloR, 0, 6.2832); ctx.fill();
    ctx.globalAlpha = .55 + dragDepth * .45;
    ctx.beginPath(); ctx.arc(dragPos.x, dragPos.y, coreR, 0, 6.2832); ctx.fill();
    if (dragDepth > .55) {
      ctx.globalAlpha = .55 * dragDepth;
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(dragPos.x - .6, dragPos.y - .6, .5 + dragDepth * .5 * sc, 0, 6.2832); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  if (state.drag && dragStarted && dragLabelText) {
    const fade = clamp((now - dragLabelT0) / 170, 0, 1);
    ctx.font = '600 9px -apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", Inter, sans-serif';
    try { ctx.letterSpacing = '1.3px'; } catch (e) {}
    let label = dragLabelText;
    while (label.length > 1 && ctx.measureText(label).width > 190) label = label.slice(0, -1);
    if (label !== dragLabelText) label = label.trimEnd() + '…';
    const below = dragPos.y + 20 < dragFxH - 10;
    const ly = below ? dragPos.y + 19 : dragPos.y - 19;
    ctx.textAlign = 'center';
    ctx.textBaseline = below ? 'top' : 'bottom';
    ctx.globalAlpha = (dragTargetSlot ? .72 : .48) * fade;
    ctx.fillStyle = '#E9EEF7';
    ctx.shadowColor = 'rgba(0,0,0,.95)';
    ctx.shadowBlur = 6;
    ctx.fillText(label, dragPos.x, ly);
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

function ensureDragLoop() {
  if (dragRAF) return;
  dragLast = performance.now();
  const step = now => {
    dragRAF = null;
    const dt = Math.min(2.5, Math.max(.2, (now - dragLast) / 16.6667));
    dragLast = now;
    updateDragFx(now, dt);
    drawDragFx(now);
    if ((state.drag && dragStarted) || dragDrop || dragTrailPts.length || dragSparks.length || dragRings.length) {
      dragRAF = requestAnimationFrame(step);
    }
  };
  dragRAF = requestAnimationFrame(step);
}

function beginDrag(smp, e, opts) {
  if (!smp) return;
  stopScrub();
  selectSample(smp, false);
  state.dragAlt = !!(opts && opts.altDrag);
  if (opts && opts.fromUniverse) showSimilarity();
  else hideSimilarity();
  state.drag = smp;
  dragStarted = false;
  dragStart = { x: e.clientX, y: e.clientY };
  dragOrigin = { x: e.clientX, y: e.clientY };
  dragCursor = { x: e.clientX, y: e.clientY };
  dragPos = { x: e.clientX, y: e.clientY };
  dragPlanetScale = .48;
  dragTrailPts = [];
  dragSparks = [];
  dragRings = [];
  dragDrop = null;
  setMagnetSlot(null);
  e.preventDefault();
}

function setTriggerOpen(open) {
  if (open) openTriggerPage();
  else closeTriggerPage();
}

function setSettingsOpen(open) {
  if (open) {
    $('#visualPanel').classList.remove('show');
    $('#libraryPanel').classList.remove('show');
  }
  $('#settingsMenu').classList.toggle('show', open);
  $('#settingsBtn').classList.toggle('active', open);
}

function dismissWindows() {
  stopScrub();
  hideSimilarity();
  setSettingsOpen(false);
  setLibraryOpen(false);
  if ($('#slotPopover')) closeSlotPopover();
}

$('#triggerTab').onclick = () => {
  if (state.viewMode === 'trigger') closeTriggerPage();
  else openTriggerPage();
};

window.addEventListener('mousemove', e => {
  if (!state.drag) return;
  dragCursor = { x: e.clientX, y: e.clientY };
  const dx = e.clientX - dragStart.x, dy = e.clientY - dragStart.y;
  if (!dragStarted && Math.hypot(dx, dy) > 6) {
    dragStarted = true;
    startPlanetDrag(state.drag);
  }
  if (dragStarted) {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const exact = el && el.closest ? el.closest('.slot[data-slot]') : null;
    setMagnetSlot(exact || magnetSlotAt(e.clientX, e.clientY));
  }
});

// Drag end runs on mouseup AND pointerup: a pointerdown that called
// preventDefault (sample editor, handles) suppresses the compatibility
// mouseup, which used to leave the sample stuck to the cursor. The second
// call finds nothing left to end.
function onDragRelease(e) {
  if (state.scanning) stopScrub();
  if (state.drag) {
    const smp = state.drag;
    if (dragStarted) {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const exact = el && el.closest ? el.closest('.slot[data-slot]') : null;
      const slot = exact || dragTargetSlot;
      if (slot) {
        const r = slot.getBoundingClientRect();
        dragDrop = {
          smp, slotIndex: +slot.dataset.slot, rgb: dragRgb,
          fromX: dragPos.x, fromY: dragPos.y, fromScale: dragPlanetScale,
          toX: r.left + r.width / 2, toY: r.top + r.height / 2,
          t0: performance.now(), dur: DRAG_FLY_MS,
        };
        const drop = dragDrop;
        setTimeout(() => completePlanetDrop(drop), DRAG_FLY_MS);
        ensureDragLoop();
      } else {
        spawnDragBurst(dragPos.x, dragPos.y, dragRgb);
        endPlanetDrag();
        if (state.dragAlt) toast(`Finder export (demo) · ${smp.name}`);
      }
    } else {
      endPlanetDrag();
    }
    state.drag = null;
    state.dragAlt = false;
    dragStarted = false;
    setMagnetSlot(null);
    ensureDragLoop();
  }
  if (state.pan) {
    state.pan = null;
    canvas.style.cursor = 'crosshair';
  }
}
window.addEventListener('mouseup', onDragRelease);
window.addEventListener('pointerup', onDragRelease);

window.__dragPlanet = {
  get active() { return !!state.drag; },
  get started() { return dragStarted; },
  get target() { return dragTargetSlot ? +dragTargetSlot.dataset.slot : null; },
  get visible() { return (!!state.drag && dragStarted) || !!dragDrop; },
  get pos() { return { x: Math.round(dragPos.x), y: Math.round(dragPos.y) }; },
  get drop() { return !!dragDrop; },
  magnetAt(x, y) { const el = magnetSlotAt(x, y); return el ? +el.dataset.slot : null; },
};

canvas.addEventListener('contextmenu', e => e.preventDefault());

canvas.addEventListener('mousemove', e => {
  const r = canvas.getBoundingClientRect();
  const mx = e.clientX - r.left, my = e.clientY - r.top;
  if (state.pan) {
    state.pointer = null;
    state.view.panX = state.pan.px + (e.clientX - state.pan.x);
    state.view.panY = state.pan.py + (e.clientY - state.pan.y);
    requestUniverseDraw(); return;
  }
  if (state.drag) { state.pointer = null; return; }
  state.pointer = { x: mx, y: my };

  const s = pickSample(mx, my);
  state.hover = s;
  setNameBar(s);
  if (state.scanning) {
    scheduleHoverPreview(s);
    appendScrubTrail(s);
  }
  requestUniverseDraw();
});

canvas.addEventListener('mouseleave', () => {
  if (state.scanning) stopHoverPreview();
  state.pointer = null;
  state.hover = null;
  setNameBar(null); drawUniverse();
});

canvas.addEventListener('mousedown', e => {
  dismissWindows();
  if (e.button === 2) {
    stopScrub();
    state.pan = { x: e.clientX, y: e.clientY, px: state.view.panX, py: state.view.panY };
    canvas.style.cursor = 'grabbing';
    e.preventDefault();
    return;
  }
  if (e.button !== 0) return;
  if (e.ctrlKey) {
    stopScrub();
    state.pan = { x: e.clientX, y: e.clientY, px: state.view.panX, py: state.view.panY };
    canvas.style.cursor = 'grabbing';
    e.preventDefault();
    return;
  }
  const r = canvas.getBoundingClientRect();
  state.pointer = { x: e.clientX - r.left, y: e.clientY - r.top };
  const s = pickSample(e.clientX - r.left, e.clientY - r.top);
  if (s) {
    if (e.altKey) beginDrag(s, e, { altDrag: true });
    else {
      selectSample(s, true);
      showSimilarity();
      startScrubTrail(s);
      state.scanning = true;
      playHoverPreview(s);
    }
  }
});
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  stopScrub();
  hideSimilarity();
  const r = canvas.getBoundingClientRect();
  const mx = e.clientX - r.left, my = e.clientY - r.top;
  const f = e.deltaY < 0 ? 1.12 : 1 / 1.12;
  const oldZoom = state.view.zoom;
  const newZoom = clamp(oldZoom * f, .7, 6);
  if (newZoom === oldZoom) return;
  const cx = plot.x + plot.w / 2, cy = plot.y + plot.h / 2;
  const wx = (mx - cx - state.view.panX) / (plot.w * oldZoom) + .5;
  const wy = (cy + state.view.panY - my) / (plot.h * oldZoom) + .5;
  state.view.zoom = newZoom;
  state.view.panX = mx - cx - (wx - .5) * plot.w * newZoom;
  state.view.panY = my - cy + (wy - .5) * plot.h * newZoom;
  requestUniverseDraw();
}, { passive: false });

$('#zoomIn').onclick = () => { hideSimilarity(); state.view.zoom = clamp(state.view.zoom * 1.22, .7, 6); drawUniverse(); };
$('#zoomOut').onclick = () => { hideSimilarity(); state.view.zoom = clamp(state.view.zoom / 1.22, .7, 6); drawUniverse(); };
$('#resetView').onclick = () => { hideSimilarity(); state.view = { zoom: 1, panX: 0, panY: 0 }; drawUniverse(); };

$('#editorGrip').addEventListener('mousedown', e => {
  const smp = currentSlotSample();
  if (smp) beginDrag(smp, e, { keepTrigger: true, openTrigger: true });
});

// ---------- channels / TRIGGER ----------
function meterW(level) { return clamp((level + 60) / 66 * 100, 3, 100); }

function phaseBadge(s) {
  if (s.ap && s.ap.isRef && state.ap.on) return 'REF';
  const o = effOffset(s);
  const off = o ? `${o > 0 ? '+' : ''}${o.toFixed(1)}ms` : '';
  const parts = [];
  if (effPolarity(s)) parts.push('Ø');
  if (s.shift === 90) parts.push('90°');
  if (off) parts.push(off);
  return parts.length ? parts.join(' ') : '—';
}

function renderSlots() {
  const host = $('#slots');
  if (!host) return;
  host.innerHTML = state.slots.map((s, i) => {
    const smp = slotSample(s);
    const color = smp ? CAT[smp.category].color : '';
    const sel = (i === state.selectedSlot ? ' selected' : '') + (multiSel.slots.has(i) ? ' msel' : '');
    const stateCls = smp ? ' filled' : ' empty';
    return `
      <div class="slot${stateCls}${sel}" data-slot="${i}" data-kbd="${i + 1}"${smp ? ` style="--slot-color:${color}"` : ''} title="${smp ? `${smp.name} · click to audition · double-click to edit` : 'Drop a sample here · click to open TRIGGER'}">
        <div class="slot-head">
          <span class="slot-num">${String(i + 1).padStart(2, '0')}</span>
          ${smp ? `<span class="slot-dot cat-mark" style="background:${color};color:${color};--shape:${SHAPE_CLIP[CAT_SHAPE[smp.category]]}"></span>` : ''}
          ${smp ? `<button class="slot-clear" data-clear="${i}" title="Clear slot">×</button>` : ''}
        </div>
        ${smp
          ? `<div class="slot-name">${smp.name}</div><div class="slot-meta">${CAT[smp.category].short} · ${fmtMs(smp.dur)}</div>`
          : `<div class="slot-plus">+</div><div class="slot-meta">DROP</div>`}
      </div>`;
  }).join('');
  renderFaders();
}

let slotMeterVals = new Array(8).fill(-1);

// ---------- fader taper (console style) ----------
// Position 0..1 <-> dB. 0 dB sits at 75% of the travel (unity detent), the top
// 25% is +6 dB of boost and the bottom 10% fades to -60 dB. The slot meters use
// the same map, so the meter and the scale beside it read the same dB.
const FADER_TAPER = [[0, -60], [.1, -48], [.25, -30], [.4, -18], [.55, -10], [.75, 0], [1, 6]];
const FADER_TICKS = [6, 0, -6, -12, -24, -48];
function faderPosToDb(p) {
  p = clamp(p, 0, 1);
  for (let k = 1; k < FADER_TAPER.length; k++) {
    const [p1, d1] = FADER_TAPER[k], [p0, d0] = FADER_TAPER[k - 1];
    if (p <= p1) return d0 + (d1 - d0) * (p - p0) / (p1 - p0);
  }
  return 6;
}
function faderDbToPos(db) {
  db = clamp(db, -60, 6);
  for (let k = 1; k < FADER_TAPER.length; k++) {
    const [p1, d1] = FADER_TAPER[k], [p0, d0] = FADER_TAPER[k - 1];
    if (db <= d1) return p0 + (p1 - p0) * (db - d0) / (d1 - d0);
  }
  return 1;
}

function renderFaders() {
  const host = $('#faderBank');
  if (!host) return;
  requestAnimationFrame(checkApStale);
  slotMeterVals.fill(-1);
  const anySolo = state.slots.some(s => s.solo);
  host.innerHTML = state.slots.map((s, i) => {
    const smp = slotSample(s);
    const color = smp ? CAT[smp.category].color : '';
    const sel = (i === state.selectedSlot ? ' selected' : '') + (multiSel.faders.has(i) ? ' msel' : '');
    const dim = (anySolo && !s.solo) || s.mute ? ' dim' : '';
    const empty = smp ? '' : ' empty';
    const ph = phaseBadge(s);
    return `
      <div class="slot-fader${sel}${dim}${empty}${smp && (effPolarity(s) || s.shift === 90) ? ' phase-mod' : ''}" data-slot="${i}">
        <div class="sf-head">
          <span class="sf-num">${String(i + 1).padStart(2, '0')}</span>
          ${smp ? `<span class="sf-dot" style="background:${color};color:${color}"></span>` : ''}
          <span class="sf-name">${smp ? smp.name : 'EMPTY'}</span>
        </div>
        <div class="sf-body">
          <div class="sf-scale">${FADER_TICKS.map(db => `<span class="${db === 0 ? 'unity' : ''}" style="--p:${faderDbToPos(db).toFixed(4)}">${db > 0 ? '+' + db : db}</span>`).join('')}</div>
          <div class="sf-meter"><i id="meter-${i}" style="height:0%"></i></div>
          <div class="sf-fader" id="fader-${i}" data-slot="${i}" tabindex="0" role="slider"
            aria-label="Slot ${i + 1} level" aria-valuemin="-60" aria-valuemax="6" aria-valuenow="${s.level}"
            style="--pos:${faderDbToPos(s.level).toFixed(4)}">
            <div class="sf-rail"><i class="sf-fill"></i></div>
            <div class="sf-unity" style="--p:${faderDbToPos(0).toFixed(4)}"></div>
            <div class="sf-cap"></div>
          </div>
        </div>
        <div class="sf-foot"><span class="sf-level" id="slotLevel-${i}">${fmtDb(s.level)}</span>${ph === '—' ? '' : `<span class="sf-phase">${ph}</span>`}</div>
        <div class="sf-btns">
          <button data-act="m" data-slot="${i}" class="${s.mute ? 'on' : ''}" title="Mute">M</button>
          <button data-act="s" data-slot="${i}" class="${s.solo ? 'on solo' : ''}" title="Solo">S</button>
          <button data-act="o" data-slot="${i}" class="${effPolarity(s) ? 'on phase' : ''}" title="Polarity (180°)${apAutoInv(s) ? ' · inverted by AUTO PHASE' : ''}">Ø</button>
        </div>
      </div>`;
  }).join('');
  $$('.sf-level', host).forEach(el => {
    const i = +el.id.replace('slotLevel-', '');
    bindNumericEdit(el, {
      get: () => state.slots[i].level,
      set: v => setFaderLevel(i, v),
      min: -60, max: 6, step: .1, unit: 'dB', decimals: 1, default: 0,
    });
  });
}

function selectSlot(i) {
  state.selectedSlot = i;
  // Update selection in place instead of rebuilding the slot/fader DOM on
  // every click. Rebuilding here used to replace the node between the two
  // clicks of a double-click.
  $$('#slots .slot').forEach(el => el.classList.toggle('selected', +el.dataset.slot === i));
  $$('#faderBank .slot-fader').forEach(el => el.classList.toggle('selected', +el.dataset.slot === i));
  updateInspector();
  if (state.viewMode === 'trigger') setSlotNameBar(i);
}

function clearSlot(i) {
  const s = state.slots[i];
  s.sampleId = null;
  s.label = `SLOT ${String(i + 1).padStart(2, '0')}`;
  s.mute = false; s.solo = false;
  s.ap = null;
  delete s._forwardEnv;
  s.polarity = false; s.shift = 0; s.offset = 0;
  if (state.ap.ref === i) { state.ap.ref = 'INPUT'; toast('AUTO PHASE reference slot cleared · back to INPUT'); }
  analyzeAllPhase();
  syncSlotAudio(i);
  renderSlots();
  if (state.selectedSlot === i) {
    updateInspector();
    if (state.viewMode === 'trigger') setSlotNameBar(i);
  }
  toast(`TRIGGER SLOT ${String(i + 1).padStart(2, '0')} cleared`);
}

$('#slots').addEventListener('click', e => {
  const clear = e.target.closest('[data-clear]');
  if (clear) {
    e.preventDefault();
    e.stopPropagation();
    clearSlot(+clear.dataset.clear);
    return;
  }
  const slot = e.target.closest('.slot[data-slot]');
  if (!slot) return;
  if (finderClick('slots', +slot.dataset.slot, e, slotOrder)) { applySlotSelClasses(); return; }
  if (e.detail > 1) return; // do not audition twice on the way to a double-click
  const i = +slot.dataset.slot;
  if (multiSel.slots.size) { multiSel.slots = new Set(); applySlotSelClasses(); }
  multiSel.scope = 'slots';
  selectSlot(i);
  const smp = slotSample(state.slots[i]);
  if (!smp) {
    if (state.viewMode !== 'trigger') openTriggerPage();
    return;
  }
  // A filled Trigger Slot auditions its sample on click.
  ensureAudio();
  playSlot(i, .01);
  const el = document.querySelector(`#slots .slot[data-slot="${i}"]`);
  if (el) {
    el.classList.remove('slot-audition');
    void el.offsetWidth;
    el.classList.add('slot-audition');
    setTimeout(() => el.classList.remove('slot-audition'), 380);
  }
  if (state.viewMode !== 'trigger') setNameBar(smp, false);
});

// Double-click opens the selected slot in the TRIGGER editor.
// Marquee from the empty space around the Trigger Slots.
$('#slots').addEventListener('pointerdown', e => {
  if (e.button !== 0 || e.target.closest('.slot[data-slot]')) return;
  startMarquee(e, { scope: 'slots' });
});
$('#slots').addEventListener('dblclick', e => {
  if (e.target.closest('[data-clear]')) return;
  const slot = e.target.closest('.slot[data-slot]');
  if (!slot) return;
  selectSlot(+slot.dataset.slot);
  openTriggerPage();
});

function setFaderLevel(i, v) {
  const s = state.slots[i];
  s.level = clamp(v, -60, 6);
  const r = $(`#fader-${i}`);
  if (r) { r.style.setProperty('--pos', faderDbToPos(s.level).toFixed(4)); r.setAttribute('aria-valuenow', s.level.toFixed(1)); }
  const lv = $(`#slotLevel-${i}`); if (lv) lv.textContent = fmtDb(s.level);
  syncSlotAudio(i);
}
// Custom vertical faders: drag the cap (relative, no jump) or click the rail
// (jump), Shift = fine, Alt+click = 0 dB, arrows = 0.5 dB (Shift 0.1 dB).
// A small detent snaps to 0 dB.
const FADER_CAP = 12; // px, keep in sync with --cap-h in style.css
function faderSnap(db) { return Math.abs(db) < 0.35 ? 0 : Math.round(db * 10) / 10; }
$('#faderBank').addEventListener('pointerdown', e => {
  const f = e.target.closest('.sf-fader');
  if (!f) {
    // empty part of a strip or the gaps between strips: marquee (a plain
    // click still selects the strip through the click handler)
    if (e.button !== 0 || e.target.closest('button, .num-editable')) return;
    startMarquee(e, { scope: 'faders', onChange: applySlotSelClasses, keepOnClick: true });
    return;
  }
  const i = +f.dataset.slot;
  e.preventDefault(); e.stopPropagation();
  multiSel.scope = 'faders';
  if (finderClick('faders', i, e, slotOrder)) { applySlotSelClasses(); return; }
  const grp = multiSel.faders.has(i) && multiSel.faders.size > 1
    ? [...multiSel.faders].map(k => ({ k, p0: faderDbToPos(state.slots[k].level) })) : null;
  if (!grp && multiSel.faders.size) { multiSel.faders = new Set(); applySlotSelClasses(); }
  if (e.altKey) { (grp || [{ k: i }]).forEach(g => setFaderLevel(g.k, 0)); return; }
  f.focus({ preventScroll: true });
  const rect = f.getBoundingClientRect();
  const travel = Math.max(1, rect.height - FADER_CAP);
  const posAt = y => 1 - (y - rect.top - FADER_CAP / 2) / travel;
  let pos = faderDbToPos(state.slots[i].level);
  if (!e.target.closest('.sf-cap')) { pos = clamp(posAt(e.clientY), 0, 1); setFaderLevel(i, faderSnap(faderPosToDb(pos))); }
  let lastY = e.clientY;
  f.setPointerCapture(e.pointerId);
  f.classList.add('dragging');
  const pos0 = pos;
  const move = ev => {
    const k = ev.shiftKey ? 0.2 : 1;
    pos = clamp(pos - (ev.clientY - lastY) / travel * k, 0, 1);
    lastY = ev.clientY;
    if (grp) { const dp = pos - pos0; grp.forEach(g => setFaderLevel(g.k, faderSnap(faderPosToDb(clamp(g.p0 + dp, 0, 1))))); return; }
    setFaderLevel(i, faderSnap(faderPosToDb(pos)));
  };
  const up = () => {
    f.classList.remove('dragging');
    if (grp && Math.abs(pos - pos0) < 1e-4) { multiSel.faders = new Set(); applySlotSelClasses(); }
    f.removeEventListener('pointermove', move);
    f.removeEventListener('pointerup', up);
    f.removeEventListener('pointercancel', up);
    selectSlot(i);
  };
  f.addEventListener('pointermove', move);
  f.addEventListener('pointerup', up);
  f.addEventListener('pointercancel', up);
});
$('#faderBank').addEventListener('keydown', e => {
  const f = e.target.closest('.sf-fader');
  if (!f || !['ArrowUp', 'ArrowDown'].includes(e.key)) return;
  e.preventDefault(); e.stopPropagation();
  const i = +f.dataset.slot;
  const step = (e.shiftKey ? 0.1 : 0.5) * (e.key === 'ArrowUp' ? 1 : -1);
  const ks = multiSel.faders.has(i) && multiSel.faders.size > 1 ? [...multiSel.faders] : [i];
  ks.forEach(k => setFaderLevel(k, Math.round((state.slots[k].level + step) * 10) / 10));
});

$('#faderBank').addEventListener('click', e => {
  if (e.target.closest('.sf-fader')) { e.stopPropagation(); return; }
  const btn = e.target.closest('button[data-act]');
  if (btn) {
    e.stopPropagation();
    const i = +btn.dataset.slot, s = state.slots[i];
    // M/S/Ø on a selected strip apply the same new state to every selected one.
    const ks = multiSel.faders.has(i) && multiSel.faders.size > 1 ? [...multiSel.faders] : [i];
    const mute = !s.mute, solo = !s.solo, pol = !effPolarity(s);
    ks.forEach(k => {
      const t = state.slots[k];
      if (btn.dataset.act === 'm') t.mute = mute;
      if (btn.dataset.act === 's') t.solo = solo;
      if (btn.dataset.act === 'o') t.polarity = pol !== apAutoInv(t);
    });
    selectSlot(i);
    renderSlots();
    syncAllSlotAudio();
    updateInspector();
    return;
  }
  if (e.target.closest('.num-editable')) return;
  const strip = e.target.closest('.slot-fader[data-slot]');
  if (!strip) return;
  if (finderClick('faders', +strip.dataset.slot, e, slotOrder)) { applySlotSelClasses(); return; }
  if (multiSel.faders.size) { multiSel.faders = new Set(); applySlotSelClasses(); }
  selectSlot(+strip.dataset.slot);
});

function assignSample(i, smp) {
  const s = state.slots[i];
  s.sampleId = smp.id;
  s.label = `SLOT ${String(i + 1).padStart(2, '0')}`;
  s.mute = false; s.solo = false;
  s.tune = 0;
  s.adsr = { a: 0, d: 120, end: 0, s: .5, p: 1, e: 0 };
  s.envPts = [];
  s.start = 0; s.end = 1; s.fadeIn = 0; s.fadeOut = 0;
  s.reverse = false;
  s.tone = 0; s.cut = 100; s.velSens = 100; s.gain = 0;
  s.playback = 'one-shot'; s.loop = false;
  delete s._forwardEnv;
  s.polarity = false; s.shift = 0; s.offset = 0;
  s.ap = null;
  fitAdsrToSample(s);
  selectSlot(i);
  analyzeAllPhase();
  if (state.selectedSlot === i && $('.inspector').classList.contains('show')) updateInspector();
  toast(`${smp.name} → TRIGGER SLOT ${String(i + 1).padStart(2, '0')} · auto phase ready`);
  if (window.__TU_NATIVE__ && smp.nativePath && window.__TU_nativeLoadSample)
    window.__TU_nativeLoadSample(i, smp.nativePath);
}

// ---------- AUTO PHASE ----------
// The analysis is still simulated (deterministic per sample and reference);
// the UX and the way results are applied are the real ones. The result is kept
// apart from the manual settings, so switching AUTO PHASE off (or changing the
// mode) never loses anything:
//   effective polarity = manual Ø  XOR  (auto inversion, if mode has Ø)
//   effective offset   = manual trim  +  (auto lag, if mode has OFFSET)
const apUsesOffset = () => state.ap.on && state.ap.mode !== 'polarity';
const apUsesPolarity = () => state.ap.on && state.ap.mode !== 'offset';
const apAutoLag = s => (apUsesOffset() && s.ap && !s.ap.isRef ? s.ap.lag : 0);
const apAutoInv = s => !!(apUsesPolarity() && s.ap && !s.ap.isRef && s.ap.invert);
const effOffset = s => clamp((s.offset || 0) + apAutoLag(s), -5, 50);
const effPolarity = s => !!s.polarity !== apAutoInv(s);
function apRefLabel(ref = state.ap.ref) {
  return ref === 'INPUT' ? 'INPUT' : `SLOT ${String(ref + 1).padStart(2, '0')}`;
}
// ---------- AUTO PHASE analysis (real audio) ----------
// Goal: every layer sums well with the reference AND with the other layers.
// The criterion is the energy of the real sum (REF + all layers) in 3 bands:
//   LOW 40–250 Hz      → decides each layer's polarity (most low wins)
//   LOW-MID 250–1.5 k  → body: no offset may open a hole here (≤ 1 dB loss)
//   HIGH > 1.5 kHz     → fine offset: the attack lines up
// Steps: (1) anchor every layer to the REF (lags −5…+10 ms); (2) refine each
// layer against REF + the other aligned layers (±1.5 ms around its anchor)
// until nothing changes; (3) report how much LOW / body the sum gained vs
// doing nothing, and flag pairs that still cancel each other.
// REF = INPUT uses the average of the loudest input hits, aligned on the
// detector's onset (where the slots fire). Averaging is exact here: the summed
// energy over K hits equals the energy against their average. Layers are
// rendered as they sound (START, envelope, tune, EQ, gain, fader level) at
// velocity 1, without polarity, offset or pan.
const AP_BANDS = [[40, 250], [250, 1500], [1500, 24000]];
const AP_LOW_TOL_DB = 0.5, AP_MID_TOL_DB = 1.0;
let apRunId = 0;
state.apBusy = false;
state.apReport = null;

function apBandSplit(x, sr) {
  // zero-phase band split (raised-cosine edges), same filter for every signal
  let n = 1; while (n < x.length * 2) n <<= 1;
  const out = AP_BANDS.map(() => new Float32Array(x.length));
  const reBase = new Float64Array(n), imBase = new Float64Array(n);
  reBase.set(x);
  fftInPlace(reBase, imBase, false);
  AP_BANDS.forEach(([lo, hi], b) => {
    const re = reBase.slice(), im = imBase.slice();
    const edge = f => {
      const w = 0.2; // ±20% transition
      const up = f <= lo * (1 - w) ? 0 : f >= lo * (1 + w) ? 1 : .5 - .5 * Math.cos(Math.PI * (f - lo * (1 - w)) / (2 * lo * w));
      const dn = f <= hi * (1 - w) ? 1 : f >= hi * (1 + w) ? 0 : .5 + .5 * Math.cos(Math.PI * (f - hi * (1 - w)) / (2 * hi * w));
      return up * dn;
    };
    for (let k = 0; k < n; k++) { const g = edge((k <= n / 2 ? k : n - k) * sr / n); re[k] *= g; im[k] *= g; }
    fftInPlace(re, im, true);
    for (let t = 0; t < x.length; t++) out[b][t] = re[t];
  });
  return out;
}

async function apLayerSignal(i) {
  const buf = await renderSlotOffline(i, { analysis: true });
  if (!buf) return null;
  const n = buf.length, out = new Float32Array(n);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let t = 0; t < n; t++) out[t] += d[t] / buf.numberOfChannels;
  }
  return out;
}

async function computePhaseAlignment() {
  const ctx = ensureAudio();
  if (!ctx) return null;
  const sr = ctx.sampleRate;
  const ms = v => Math.round(v * sr / 1000);
  const PRE = ms(5), POST = ms(120), NEG = ms(5), POS = ms(10), REF_D = ms(1.5);
  const O = PRE + POS + 8, T = O + POST + NEG + 8;
  const W0 = O - PRE, W1 = O + POST;
  const ref = state.ap.ref;
  const loaded = state.slots.map((x, i) => (slotSample(x) ? i : -1)).filter(i => i >= 0);
  // --- reference signal (placed with its onset at index O)
  const R = new Float32Array(T);
  if (ref === 'INPUT') {
    if (!realInputBuffer) return { error: 'INPUT still loading' };
    const hits = (realHits && realHits.length ? realHits : detectInputHits()).slice();
    if (!hits.length) return { error: 'no input hits (check DETAIL)' };
    hits.sort((p, q) => q.peak - p.peak);
    const use = hits.slice(0, clamp(Math.ceil(hits.length / 4), 1, 16));
    const raw = realInputBuffer.getChannelData(0);
    const vol = dbToAmp(state.detector.input || 0);
    use.forEach(h => {
      const at = Math.round(h.time * sr) - O;
      for (let t = 0; t < T; t++) { const j = at + t; if (j >= 0 && j < raw.length) R[t] += raw[j] * vol / use.length; }
    });
  } else {
    const sig = await apLayerSignal(ref);
    if (!sig) return { error: `${apRefLabel(ref)} is empty` };
    for (let t = 0; O + t < T && t < sig.length; t++) R[O + t] = sig[t];
  }
  // --- layers (unshifted, onset at O)
  const layers = [];
  for (const i of loaded) {
    if (i === ref) continue;
    const sig = await apLayerSignal(i);
    if (!sig) continue;
    const L = new Float32Array(T);
    for (let t = 0; O + t < T && t < sig.length; t++) L[O + t] = sig[t];
    layers.push({ i, L, B: apBandSplit(L, sr), d: 0, p: 1 });
  }
  const RB = apBandSplit(R, sr);
  if (!layers.length) return { layers: [], report: null };
  const allowLag = state.ap.mode !== 'polarity';
  const allowPol = state.ap.mode !== 'offset';
  const dot = (a, b, d) => { let s = 0; for (let t = W0; t < W1; t++) s += a[t] * b[t - d]; return s; };
  const nrg = (b, d) => { let s = 0; for (let t = W0; t < W1; t++) { const v = b[t - d]; s += v * v; } return s; };
  // band arrays of REF + every layer except `skip`, with their current d/p
  const sumBands = skip => RB.map((rb, b) => {
    const out = Float32Array.from(rb);
    layers.forEach(l => { if (l === skip) return; const lb = l.B[b]; for (let t = W0; t < W1; t++) out[t] += l.p * lb[t - l.d]; });
    return out;
  });
  const bandE = arr => { let s = 0; for (let t = W0; t < W1; t++) s += arr[t] * arr[t]; return s; };
  // Phase first, offset second:
  //  0) WHERE: locate the hit in time with the attack contour (smoothed
  //     |LOW-MID + HIGH|), which ignores polarity. Without this a plain delay
  //     reads as a phase problem (2 ms late ≈ 144° at 200 Hz).
  //  1) PHASE: measure the LOW-band phase difference against the target at
  //     that position. From 90° up the waves fight, so the layer is inverted (Ø).
  //  2) OFFSET: with that polarity fixed, move it to where it has to go: keep
  //     LOW within 0.5 dB and body within 1 dB of their best, then line up the
  //     attack (most HIGH). The offset can no longer "fix" the phase by
  //     jumping half a cycle.
  function phaseAt(l, Sb, d) {
    const c = dot(Sb[0], l.B[0], d), e = Math.sqrt(Math.max(1e-12, bandE(Sb[0]) * nrg(l.B[0], d)));
    return Math.acos(clamp(c / e, -1, 1)) * 180 / Math.PI; // 0° = in phase, 180° = opposite
  }
  const ATT_SMOOTH = Math.exp(-1 / (0.0005 * sr)); // 0.5 ms contour
  function attackEnv(B) {
    const n = B[0].length, e = new Float32Array(n);
    let v = 0;
    for (let t = 0; t < n; t++) { v = Math.max(Math.abs(B[1][t] + B[2][t]), v * ATT_SMOOTH); e[t] = v; }
    v = 0;
    for (let t = n - 1; t >= 0; t--) { v = Math.max(e[t], v * ATT_SMOOTH); e[t] = v; }
    return e;
  }
  function locate(lEnv, tEnv, lo, hi) {
    let best = lo, bestV = -Infinity;
    for (let d = lo; d <= hi; d++) {
      const v = dot(tEnv, lEnv, d) / Math.sqrt(Math.max(1e-12, nrg(lEnv, d)));
      if (v > bestV) { bestV = v; best = d; }
    }
    return best;
  }
  function choose(l, Sb, lo, hi, d0) {
    const base = Sb.map(bandE);
    const lags = [];
    if (allowLag) for (let d = lo; d <= hi; d++) lags.push(d); else lags.push(0);
    const rows = lags.map(d => {
      const c = Sb.map((sb, b) => dot(sb, l.B[b], d));
      const n = l.B.map(lb => nrg(lb, d));
      return { d, c, n };
    });
    const tot = (r, p, b) => base[b] + r.n[b] + 2 * p * r.c[b];
    // 1) phase at the current position decides the polarity
    const phase = phaseAt(l, Sb, d0);
    const bestP = allowPol && phase >= 90 ? -1 : 1;
    let bestLow = -Infinity;
    rows.forEach(r => { const v = tot(r, bestP, 0); if (v > bestLow) bestLow = v; });
    // 2) offsets that keep LOW within 0.5 dB, then body within 1 dB
    let cand = rows.filter(r => tot(r, bestP, 0) >= bestLow * Math.pow(10, -AP_LOW_TOL_DB / 10));
    const bestMid = Math.max(...cand.map(r => tot(r, bestP, 1)));
    cand = cand.filter(r => tot(r, bestP, 1) >= bestMid * Math.pow(10, -AP_MID_TOL_DB / 10));
    // 3) among them, the one that lines up the attack (most HIGH)
    let pick = cand[0];
    cand.forEach(r => { if (tot(r, bestP, 2) > tot(pick, bestP, 2)) pick = r; });
    const cAll = pick.c.reduce((a, v) => a + v, 0), nAll = pick.n.reduce((a, v) => a + v, 0), bAll = base.reduce((a, v) => a + v, 0);
    return { d: pick.d, p: bestP, phase, corr: bestP * cAll / Math.sqrt(Math.max(1e-12, nAll * bAll)) };
  }
  // baseline: nothing applied
  const base0 = sumBands(null).map(bandE);
  // (1) anchor each layer to the REF alone
  const refOnly = RB;
  const refEnv = attackEnv(RB);
  layers.forEach(l => {
    // 0) where the hit is (polarity-free), 1) phase there, 2) fine offset ±1.5 ms
    const at = allowLag ? locate(attackEnv(l.B), refEnv, -NEG, POS) : 0;
    const lo = allowLag ? clamp(at - REF_D, -NEG, POS) : 0, hi = allowLag ? clamp(at + REF_D, -NEG, POS) : 0;
    const r = choose(l, refOnly, lo, hi, at);
    Object.assign(l, { d: r.d, p: r.p, anchor: r.d, corr: r.corr, phase0: r.phase });
  });
  // (2) refine against REF + the other aligned layers
  for (let pass = 0; pass < 4; pass++) {
    let changed = false;
    layers.forEach(l => {
      const lo = clamp(l.anchor - REF_D, -NEG, POS), hi = clamp(l.anchor + REF_D, -NEG, POS);
      const r = choose(l, sumBands(l), lo, hi, l.d);
      if (r.d !== l.d || r.p !== l.p) changed = true;
      Object.assign(l, { d: r.d, p: r.p, corr: r.corr });
    });
    if (!changed) break;
  }
  const fin = sumBands(null).map(bandE);
  const gain = b => 10 * Math.log10(Math.max(1e-12, fin[b]) / Math.max(1e-12, base0[b]));
  // (3) pairs that still cancel (LOW + body)
  const conflicts = [];
  for (let a = 0; a < layers.length; a++) for (let b = a + 1; b < layers.length; b++) {
    const A = layers[a], Bl = layers[b];
    let xy = 0, xx = 0, yy = 0;
    for (let t = W0; t < W1; t++) {
      const x = A.p * (A.B[0][t - A.d] + A.B[1][t - A.d]);
      const y = Bl.p * (Bl.B[0][t - Bl.d] + Bl.B[1][t - Bl.d]);
      xy += x * y; xx += x * x; yy += y * y;
    }
    const c = xy / Math.sqrt(Math.max(1e-12, xx * yy));
    if (c < -0.15) conflicts.push([A.i, Bl.i, +c.toFixed(2)]);
  }
  return {
    // atLimit: wanted to play even earlier than −5 ms (the lookahead limit),
    // usually air before the hit in the sample → trim START (⇥ TRANSIENT)
    layers: layers.map(l => ({ i: l.i, lag: +(l.d * 1000 / sr).toFixed(1), invert: l.p < 0, corr: +Math.abs(l.corr).toFixed(2), phase: Math.round(l.phase0), atLimit: allowLag && l.d <= -NEG + ms(0.5) })),
    report: { low: +gain(0).toFixed(1), body: +gain(1).toFixed(1), conflicts, limits: layers.filter(l => allowLag && l.d <= -NEG + ms(0.5)).map(l => l.i) },
  };
}

async function analyzeAllPhase() {
  const run = ++apRunId;
  const ref = state.ap.ref;
  state.slots.forEach((x, i) => { if (!slotSample(x)) x.ap = null; else if (ref === i) x.ap = { isRef: true }; });
  state.apBusy = true;
  updateAutoPhasePanel();
  let res = null;
  try { res = await computePhaseAlignment(); } catch (e) { console.error('[auto phase]', e); res = { error: String(e.message || e) }; }
  if (run !== apRunId) return; // a newer analysis started
  state.apBusy = false;
  if (res && !res.error) {
    state.slots.forEach((x, i) => { if (slotSample(x) && i !== ref) x.ap = null; });
    res.layers.forEach(r => { state.slots[r.i].ap = { lag: r.lag, invert: r.invert, corr: r.corr, phase: r.phase, atLimit: r.atLimit }; });
    state.apReport = res.report;
    state.apFp = apFingerprint();
  } else {
    state.apReport = res ? { error: res.error } : null;
  }
  renderSlots();
  syncAllSlotAudio();
  updateAutoPhasePanel();
  return res;
}
// ---------- AUTO PHASE: stale readings ----------
// The analysis keeps a fingerprint of everything it depends on. When any of it
// changes afterwards (START, reverse, tune, TONE/CUT, GAIN, envelope, fader
// level, the sample, the input VOLUME), RE-ANALYZE ALL, the sum report and the
// phase readings of the affected channels turn red until you re-analyze.
// Pan, mute/solo and your manual Ø / offsets do not count (not analyzed).
const apSlotFp = x => JSON.stringify([x.sampleId, x.start, x.end, x.reverse, x.tune, x.tone, x.cut, x.gain, x.level, x.adsr, x.envPts]);
function apFingerprint() {
  return { g: JSON.stringify([state.ap.ref, state.ap.mode, state.detector.input]), slots: state.slots.map(apSlotFp) };
}
state.apFp = null;
let apStaleSlots = new Set();
function checkApStale() {
  const fp = state.apFp;
  const stale = new Set();
  if (fp && state.ap.on && !state.apBusy) {
    const cur = apFingerprint();
    const loaded = state.slots.map((x, i) => (slotSample(x) ? i : -1)).filter(i => i >= 0);
    const refStale = typeof state.ap.ref === 'number' && cur.slots[state.ap.ref] !== fp.slots[state.ap.ref];
    if (cur.g !== fp.g || refStale) loaded.forEach(i => stale.add(i));
    else loaded.forEach(i => { if (cur.slots[i] !== fp.slots[i]) stale.add(i); });
  }
  apStaleSlots = stale;
  const any = stale.size > 0;
  const btn = $('#slotAuto');
  if (btn) {
    btn.classList.toggle('stale', any);
    btn.title = any ? 'Parameters that affect the phase changed since the last analysis · re-analyze' : 'Re-analyze every loaded slot against the reference';
  }
  const rep = $('#apReport'); if (rep) rep.classList.toggle('stale', any);
  const res = $('#slotResult'); if (res) res.classList.toggle('stale', stale.has(state.selectedSlot));
  $$('#faderBank .slot-fader').forEach(el => el.classList.toggle('ap-stale', stale.has(+el.dataset.slot)));
}
setInterval(checkApStale, 250);

function apSummary() {
  const n = state.slots.filter(x => x.ap && !x.ap.isRef).length;
  const what = { offset: 'offsets', polarity: 'Ø inversion', both: 'offsets + Ø' }[state.ap.mode];
  return `${n} layer${n === 1 ? '' : 's'} · ${what} · ref ${apRefLabel()}`;
}

$('#autoPhaseAll').onclick = () => {
  if (!state.ap.on) { state.ap.on = true; }
  analyzeAllPhase();
  setSettingsOpen(false);
  toast(`AUTO PHASE · ${apSummary()}`);
};

// ---------- slot popover ----------
function closeSlotPopover() {
  const p = $('#slotPopover');
  if (p) p.classList.remove('show');
  state.popoverSlot = null;
}

// The old per-slot popover was replaced by the AUTO PHASE panel and the
// fader strips; kept as a no-op for callers.
function openSlotPopover() {}

document.addEventListener('mousedown', e => {
  const pop = $('#slotPopover');
  if (!pop || !pop.classList.contains('show')) return;
  if (pop.contains(e.target)) return;
  if (e.target.closest('.slot[data-slot]')) return;
  closeSlotPopover();
});

// ---------- FINDER-LIKE FILE TREE ----------
function buildTree() {
  const root = { name: 'ALL SAMPLES', path: 'ALL', children: new Map(), count: 0 };
  for (const s of state.samples) {
    const parts = s.path.split('/');
    let node = root;
    let acc = '';
    root.count++;
    for (const part of parts) {
      acc = acc ? acc + '/' + part : part;
      if (!node.children.has(part)) node.children.set(part, { name: part, path: acc, children: new Map(), count: 0 });
      node = node.children.get(part);
      node.count++;
    }
  }
  return root;
}

function renderTreeNode(node, depth) {
  const hasChildren = node.children.size > 0;
  const expanded = state.expanded.has(node.path);
  const active = state.fileFolder === node.path ? ' active' : '';
  const pad = 8 + depth * 12;
  let html = `<div class="tree-node${active}" data-path="${node.path}" style="padding-left:${pad}px">
    <span class="tree-toggle">${hasChildren ? (expanded ? '▾' : '▸') : ''}</span>
    <span class="tree-icon"></span>
    <span class="tree-label">${esc(node.name)}</span>
    <span class="tree-count">${node.count}</span>
  </div>`;
  if (hasChildren && expanded) {
    const kids = [...node.children.values()].sort((a, b) => a.name.localeCompare(b.name));
    for (const k of kids) html += renderTreeNode(k, depth + 1);
  }
  return html;
}

function renderFolderTree() {
  const tree = buildTree();
  const favCount = state.samples.filter(s => state.favorites.has(s.id)).length;
  const favActive = state.fileFolder === 'FAV' ? ' active' : '';
  const fav = `<div class="tree-node fav-node${favActive}" data-path="FAV" style="padding-left:8px">
    <span class="tree-toggle"></span>
    <span class="tree-icon heart">♥</span>
    <span class="tree-label">FAVORITES</span>
    <span class="tree-count">${favCount}</span>
  </div>`;
  const locations = (state.libraryRoots || []).map((r, i) => `
    <div class="tree-node loc-node${state.fileFolder === r.name ? ' active' : ''}" data-loc="${i}" title="${esc(r.path)}" style="padding-left:8px">
      <span class="tree-toggle"></span>
      <span class="tree-icon"></span>
      <span class="tree-label">${esc(r.name)}</span>
      <button class="loc-remove" data-loc="${i}" title="Remove location">×</button>
    </div>`).join('');
  $('#folderTree').innerHTML = locations + fav + renderTreeNode(tree, 0);
}
$('#folderTree').addEventListener('click', e => {
  const rm = e.target.closest('.loc-remove');
  if (rm) {
    e.preventDefault();
    e.stopPropagation();
    if (window.__TU_NATIVE__ && typeof SAMFUI === 'function') SAMFUI(8, +rm.dataset.loc, 0);
    return;
  }
  const loc = e.target.closest('.loc-node');
  if (loc) {
    const r = state.libraryRoots[+loc.dataset.loc];
    if (r) { state.fileFolder = r.name; renderFolderTree(); renderFileList(); }
    return;
  }
  const node = e.target.closest('.tree-node');
  if (!node) return;
  const path = node.dataset.path;
  state.fileFolder = path;
  if (state.expanded.has(path)) state.expanded.delete(path);
  else state.expanded.add(path);
  renderFolderTree();
  renderFileList();
});

$('#addFolder').onclick = () => {
  if (window.__TU_NATIVE__ && window.__TU_chooseFolder) {
    window.__TU_chooseFolder();
    return;
  }
  toast('Choose the LOCATION SAMPLES FOLDER (demo) · tree mirrors its subfolders');
};

$('#refreshLibrary').onclick = () => {
  if (window.__TU_NATIVE__ && typeof SAMFUI === 'function') SAMFUI(9, 0, 0);
  else toast('Rescan only available inside the plugin');
};

function nativeCategory(name) {
  const n = name.toLowerCase();
  if (/kick|bombo|bd/.test(n)) return 'Kick';
  if (/snare|redobl|sd/.test(n)) return 'Snare';
  if (/clap/.test(n)) return 'Clap';
  if (/hh|hat|charles/.test(n)) return 'HHC';
  if (/cymbal|crash|ride/.test(n)) return 'Cymbal';
  if (/tom/.test(n)) return 'Tom';
  return 'Perc';
}

function applyNativeLibrary(msg) {
  if (!msg || !Array.isArray(msg.files)) return;
  const roots = Array.isArray(msg.roots) ? msg.roots : [];
  const used = new Set();
  const labels = roots.map((r, i) => {
    let base = r.name || `LOCATION ${i + 1}`;
    let label = base, n = 2;
    while (used.has(label)) label = `${base} ${n++}`;
    used.add(label);
    return label;
  });

  const real = msg.files.map((f, idx) => {
    const rootLabel = labels[f.root] || 'SAMPLES';
    const rel = f.rel || f.name;
    const parts = rel.split('/');
    parts.pop();
    const sub = parts.join('/');
    const category = nativeCategory(f.name);
    const dur = clamp(f.dur > 0 ? f.dur : (f.size || 0) / 192000 * 1000, 20, 8000);
    const centroid = f.centroid > 0 ? f.centroid : 0;
    const analyzed = !!f.analyzed && (f.v || 0) >= 2;
    return {
      id: 20000 + idx,
      nativeIndex: idx,
      name: f.name.replace(/\.[^.]+$/, ''),
      category,
      dur,
      bright: centroid || 1200,
      centroid,
      rolloff: f.rolloff || 0,
      flatness: f.flatness || 0,
      attack: f.attack || 0,
      decay: f.decay || 0,
      crest: f.crest || 0,
      zcr: f.zcr || 0,
      rms: f.rms || 0,
      peak: f.peak || 0,
      featureVersion: f.v || 0,
      analyzed,
      drum: .5,
      x: analyzed ? clamp(normLog(dur, DUR.min, DUR.max), .002, .998) : .5,
      y: analyzed ? clamp(normLog(Math.max(30, centroid || 30), BRI.min, BRI.max), .002, .998) : .5,
      z: clamp((f.rms || 0) * 3, .15, .95),
      folder: sub || rootLabel,
      path: sub ? `${rootLabel}/${sub}` : rootLabel,
      root: rootLabel,
      addedDays: 0,
      favorite: false,
      isReal: true,
      nativePath: f.path,
    };
  });

  samples.length = 0;
  samples.push(...real);
  state.samples = samples;
  state.libraryRoots = roots.map((r, i) => ({ path: r.path, name: labels[i] }));
  state.favorites = new Set();
  state.selectedSample = real[0] || null;
  state.fileFolder = 'ALL';
  state.expanded = new Set(['ALL', ...labels]);
  if (real[0]) selectSample(real[0]);
  renderFolderTree();
  renderFileList();
  recomputeUniverseLayout();
  updateInspector();
  if ($('#libraryPanel') && $('#libraryPanel').classList.contains('show')) renderLibraryPanel();
  if (real.length) toast(`${real.length} WAVs · ${roots.length} location${roots.length === 1 ? '' : 's'}`);
  else if (roots.length) toast('No hay WAVs en las locations · RESCAN');
  else toast('Sin locations · FILE SEARCH → CHANGE');
}

window.addEventListener('tu-native-message', e => {
  const d = e.detail;
  if (!d) return;
  if (d.id === 'library') applyNativeLibrary(d);
  else if (d.id === 'slot' && d.ok === false) toast(`No se pudo cargar ${d.name || 'el sample'}`);
  else if (d.id === 'analysisStart') { showAnalysis(d.total, d.done); recomputeUniverseLayout(); }
  else if (d.id === 'analyzed') {
    applyAnalyzedFeature(d);
    updateAnalysis(d);
    if (++analysisLayoutCounter >= 24) { analysisLayoutCounter = 0; recomputeUniverseLayout(); }
  }
  else if (d.id === 'analysisDone') {
    analysisLayoutCounter = 0;
    recomputeUniverseLayout();
    finishAnalysis(d);
  }
});

// ---------- library audio analysis (length + frequency response) ----------
let analysisTotal = 0;
let analysisHideTimer = 0;
let analysisLayoutCounter = 0;

function showAnalysis(total, done) {
  analysisTotal = total || 0;
  const panel = $('#analysisPanel');
  if (!panel) return;
  panel.classList.add('show');
  clearTimeout(analysisHideTimer);
  $('#analysisCount').textContent = `${done || 0} / ${analysisTotal}`;
  $('#analysisBar').style.width = analysisTotal ? `${(done || 0) / analysisTotal * 100}%` : '0%';
  $('#analysisFile').textContent = 'Analizando largo y respuesta frecuencial…';
}

function updateAnalysis(d) {
  const total = d.total || analysisTotal || 0;
  const done = d.done || 0;
  analysisTotal = total;
  $('#analysisCount').textContent = `${done} / ${total}`;
  $('#analysisBar').style.width = total ? `${Math.min(100, done / total * 100)}%` : '0%';
  if (d.name) $('#analysisFile').textContent = d.name;
}

function finishAnalysis(d) {
  updateAnalysis({ done: d.total || analysisTotal, total: d.total || analysisTotal });
  $('#analysisFile').textContent = 'Análisis completo';
  clearTimeout(analysisHideTimer);
  analysisHideTimer = setTimeout(() => $('#analysisPanel').classList.remove('show'), 1400);
  toast(`Análisis completo · ${d.total || 0} samples`);
}

function applyAnalyzedFeature(d) {
  const s = state.samples.find(x => x.nativeIndex === d.index);
  if (!s) return;
  s.analyzed = !!d.analyzed;
  s.featureVersion = d.v || 0;
  if (d.dur > 0) s.dur = d.dur;
  if (d.centroid > 0) { s.centroid = d.centroid; s.bright = d.centroid; }
  if (d.rolloff > 0) s.rolloff = d.rolloff;
  if (d.flatness >= 0) s.flatness = d.flatness;
  if (d.attack >= 0) s.attack = d.attack;
  if (d.decay >= 0) s.decay = d.decay;
  if (d.crest >= 0) s.crest = d.crest;
  if (d.zcr >= 0) s.zcr = d.zcr;
  if (d.rms >= 0) s.rms = d.rms;
  if (d.peak >= 0) s.peak = d.peak;
  s.z = clamp((s.rms || 0) * 3, .15, .95);
}

// ---------- XO-like layout: features -> PCA 2D ----------
function featureVector(s) {
  return [
    Math.log(Math.max(20, s.dur || 20)),
    Math.log(Math.max(20, s.centroid || 20)),
    Math.log(Math.max(20, s.rolloff || 20)),
    Math.log(Math.max(1e-6, s.flatness || 1e-6)),
    Math.log(1 + Math.max(0, s.attack || 0)),
    Math.log(1 + Math.max(0, s.decay || 0)),
    Math.log(1 + Math.max(1, s.crest || 1)),
    Math.log(1 + Math.max(0, s.zcr || 0)),
  ];
}

function pcaAxis(C, dims) {
  let v = Array.from({ length: dims }, (_, i) => 1 + (i % 3) * 0.15);
  const n0 = Math.hypot(...v) || 1;
  v = v.map(x => x / n0);
  for (let it = 0; it < 90; ++it) {
    const w = Array(dims).fill(0);
    for (let i = 0; i < dims; ++i)
      for (let j = 0; j < dims; ++j)
        w[i] += C[i][j] * v[j];
    const norm = Math.hypot(...w) || 1;
    v = w.map(x => x / norm);
  }
  return v;
}

function pcaPercentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = clamp(p, 0, 1) * (sorted.length - 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function recomputeUniverseLayout() {
  const pts = state.samples.filter(s => s.analyzed && s.featureVersion >= 2);
  if (!pts.length) { drawUniverse(); return; }

  if (pts.length < 8) {
    for (const s of pts) {
      s.x = clamp(normLog(Math.max(20, s.dur), DUR.min, DUR.max), .02, .98);
      s.y = clamp(normLog(Math.max(30, s.centroid || 30), BRI.min, BRI.max), .02, .98);
    }
    drawUniverse();
    return;
  }

  const dims = 8;
  const raw = pts.map(featureVector);
  const mean = Array(dims).fill(0);
  const std = Array(dims).fill(0);
  for (const row of raw) for (let i = 0; i < dims; ++i) mean[i] += row[i];
  for (let i = 0; i < dims; ++i) mean[i] /= raw.length;
  for (const row of raw) for (let i = 0; i < dims; ++i) std[i] += (row[i] - mean[i]) ** 2;
  for (let i = 0; i < dims; ++i) std[i] = Math.sqrt(std[i] / Math.max(1, raw.length)) || 1;

  const z = raw.map(row => row.map((v, i) => (v - mean[i]) / std[i]));
  const C = Array.from({ length: dims }, () => Array(dims).fill(0));
  for (const row of z)
    for (let i = 0; i < dims; ++i)
      for (let j = 0; j < dims; ++j)
        C[i][j] += row[i] * row[j];
  for (let i = 0; i < dims; ++i)
    for (let j = 0; j < dims; ++j)
      C[i][j] /= Math.max(1, z.length);

  const v1 = pcaAxis(C, dims);
  const Cv1 = C.map(row => row.reduce((a, x, j) => a + x * v1[j], 0));
  const l1 = Cv1.reduce((a, x, i) => a + x * v1[i], 0);
  const C2 = C.map((row, i) => row.map((x, j) => x - l1 * v1[i] * v1[j]));
  const v2 = pcaAxis(C2, dims);

  const pc1 = z.map(row => row.reduce((a, x, i) => a + x * v1[i], 0));
  const pc2 = z.map(row => row.reduce((a, x, i) => a + x * v2[i], 0));
  const sx = [...pc1].sort((a, b) => a - b);
  const sy = [...pc2].sort((a, b) => a - b);
  let x0 = pcaPercentile(sx, .02), x1 = pcaPercentile(sx, .98);
  let y0 = pcaPercentile(sy, .02), y1 = pcaPercentile(sy, .98);
  if (Math.abs(x1 - x0) < 1e-9) { x0 = Math.min(...pc1); x1 = Math.max(...pc1); }
  if (Math.abs(y1 - y0) < 1e-9) { y0 = Math.min(...pc2); y1 = Math.max(...pc2); }

  pts.forEach((s, i) => {
    s.x = clamp((pc1[i] - x0) / ((x1 - x0) || 1), .02, .98);
    s.y = clamp((pc2[i] - y0) / ((y1 - y0) || 1), .02, .98);
  });
  drawUniverse();
}

function fileList() {
  const favMode = state.fileFolder === 'FAV';
  let list = state.samples.filter(s => {
    if (favMode) {
      if (!state.favorites.has(s.id)) return false;
    } else if (state.fileFolder !== 'ALL') {
      if (!(s.path === state.fileFolder || s.path.startsWith(state.fileFolder + '/'))) return false;
    }
    if (state.filters.search) {
      const q = state.filters.search.toLowerCase();
      if (!(`${s.name} ${s.category} ${s.folder} ${s.path}`.toLowerCase().includes(q))) return false;
    }
    return true;
  });
  list.sort((a, b) => (b.isReal ? 1 : 0) - (a.isReal ? 1 : 0) || a.name.localeCompare(b.name));
  return list;
}

function syncFilePreview() {
  const sel = state.selectedSample;
  const inList = sel && fileList().some(s => s.id === sel.id);
  const name = $('#filePreviewName');
  const dot = $('#filePreviewDot');
  if (!inList) {
    if (name) name.textContent = 'Select a file';
    if (dot) { dot.style.background = 'var(--muted-2)'; dot.style.color = 'var(--muted-2)'; }
    return;
  }
  const cat = CAT[sel.category];
  if (name) name.textContent = `${sel.name} · ${cat.short} · ${fmtMs(sel.dur)}`;
  if (dot) { dot.style.background = cat.color; dot.style.color = cat.color; }
}

function renderFileList() {
  const list = fileList();
  const max = 1200;
  const shown = list.slice(0, max);
  $('#fileList').innerHTML = shown.map(s => {
    const sel = state.selectedSample && state.selectedSample.id === s.id ? ' selected' : '';
    const color = CAT[s.category].color;
    const fav = state.favorites.has(s.id);
    return `<div class="file-row${sel}" data-id="${s.id}">
      <span class="fn"><i class="fdot cat-mark" style="background:${color};color:${color};--shape:${SHAPE_CLIP[CAT_SHAPE[s.category]]}"></i><span>${esc(s.name)}</span></span>
      <span class="num">${fmtMs(s.dur)}</span>
      <button class="fav-btn${fav ? ' on' : ''}" data-id="${s.id}" title="${fav ? 'Remove favorite' : 'Add favorite'}">♥</button>
    </div>`;
  }).join('') + (list.length > max ? `<div class="file-row"><span class="fn">showing ${max} of ${list.length}…</span></div>` : '');
  if (!list.length) {
    const msg = state.fileFolder === 'FAV'
      ? 'No favorites yet. Tap ♥ on a sample.'
      : 'No samples match this search.';
    $('#fileList').innerHTML = `<div class="file-row"><span class="fn">${msg}</span></div>`;
  }
  const path = state.fileFolder === 'FAV' ? 'FAVORITES'
    : state.fileFolder === 'ALL' ? 'ALL SAMPLES'
    : state.fileFolder.split('/').join('  ›  ');
  $('#filePath').textContent = path;
  $('#fileCount').textContent = `${list.length} file${list.length === 1 ? '' : 's'}`;
  syncFilePreview();
}

$('#fileList').addEventListener('mousedown', e => {
  if (e.target.closest('.fav-btn')) return;
  const row = e.target.closest('.file-row[data-id]');
  if (!row) return;
  const smp = state.samples.find(s => s.id === +row.dataset.id);
  if (!smp) return;
  if (e.altKey) beginDrag(smp, e, { altDrag: true });
  else {
    selectSample(smp, true);
    // Every click on a row auditions the sample right away.
    playHoverPreview(smp);
  }
});
$('#fileList').addEventListener('mouseover', e => {
  const row = e.target.closest('.file-row[data-id]');
  if (!row) return;
  const smp = state.samples.find(s => s.id === +row.dataset.id);
  if (smp) setNameBar(smp);
});
$('#fileList').addEventListener('mouseleave', () => setNameBar(null));
$('#fileList').addEventListener('click', e => {
  const btn = e.target.closest('.fav-btn[data-id]');
  if (!btn) return;
  e.preventDefault();
  e.stopPropagation();
  toggleFavorite(+btn.dataset.id);
});
$('#fileList').addEventListener('dblclick', e => {
  const row = e.target.closest('.file-row[data-id]');
  if (!row) return;
  const smp = state.samples.find(s => s.id === +row.dataset.id);
  if (smp) assignSample(state.selectedSlot, smp);
});

$('#simPrev').onclick = () => navigateSimilar(-1);
$('#simNext').onclick = () => navigateSimilar(1);
window.addEventListener('keydown', e => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const tag = e.target && e.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if (state.viewMode !== 'universe' || !state.simVisible) return;
  if (e.key === 'ArrowLeft') { e.preventDefault(); navigateSimilar(-1); }
  if (e.key === 'ArrowRight') { e.preventDefault(); navigateSimilar(1); }
});
$('#simFav').onclick = () => {
  if (state.selectedSample) toggleFavorite(state.selectedSample.id);
  restartSimTimer();
};
$('#simDots').addEventListener('click', e => {
  const dot = e.target.closest('i[data-index]');
  if (!dot) return;
  const idx = +dot.dataset.index;
  const id = state.sim.list[idx];
  const smp = state.samples.find(s => s.id === id);
  if (!smp) return;
  const from = state.selectedSample;
  state.sim.index = idx;
  selectSample(smp, true, { keepSim: true });
  travelTo(smp, from);
  restartSimTimer();
});
$('#fileView').addEventListener('mousedown', e => {
  // Rows play their own audition; don't let the view-level dismiss stop it.
  if (e.target.closest('input, select, button, .file-row')) return;
  dismissWindows();
});

// single view toggle
function openTriggerPage() {
  if (state.viewMode !== 'trigger') state.prevView = state.viewMode;
  setView('trigger');
}

function closeTriggerPage() {
  setView(state.prevView && state.prevView !== 'trigger' ? state.prevView : 'universe');
}

function setView(mode) {
  stopHoverPreview();
  if (mode !== 'trigger') clearAllSel();
  setSettingsOpen(false);
  if ($('#visualPanel').classList.contains('show')) setVisualOpen(false);
  if (mode === 'trigger' && state.viewMode !== 'trigger') state.prevView = state.viewMode;
  state.viewMode = mode;
  const isUni = mode === 'universe';
  const isFiles = mode === 'files';
  const isTrigger = mode === 'trigger';
  $('#universeView').classList.toggle('active', isUni);
  $('#fileView').classList.toggle('active', isFiles);
  $('#triggerView').classList.toggle('active', isTrigger);
  $('#universePanel').classList.toggle('files-mode', isFiles);
  $('#universePanel').classList.toggle('trigger-mode', isTrigger);
  $('#triggerTab').classList.toggle('active', isTrigger);
  $('#triggerTab').title = isTrigger ? 'Back to browser' : 'Open TRIGGER page';
  const vt = $('#viewToggle');
  vt.title = isFiles ? 'Back to HOME' : 'File search';
  vt.setAttribute('aria-label', vt.title);
  if (isTrigger) {
    hideSimilarity();
    stopScrub();
    setSettingsOpen(false);
    selectSlot(state.selectedSlot);
    setInspectorTab('env');
    requestAnimationFrame(() => {
      resizeInput();
      requestAnimationFrame(() => {
        resizeInput();
        startInputLoop();
      });
    });
  } else {
    // Leaving TRIGGER stops the input and its live triggers; otherwise audio
    // would keep playing with no transport visible.
    if (inputPlaying) stopInput();
    stopInputLoop();
    setNameBar(state.selectedSample);
    if (isUni) {
      requestAnimationFrame(() => {
        resizeCanvas();
        if (state.selectedSample) focusSample(state.selectedSample, true);
      });
    } else if (isFiles) {
      dismissWindows();
      renderFolderTree(); renderFileList();
    }
  }
}
$('#triggerBack').onclick = closeTriggerPage;

function goHome() {
  if ($('#visualPanel').classList.contains('show')) setVisualOpen(false);
  stopScrub();
  hideSimilarity();
  setSettingsOpen(false);
  closeSlotPopover();
  if (state.drag) {
    state.drag = null;
    state.dragAlt = false;
    dragStarted = false;
    endPlanetDrag();
    ensureDragLoop();
  }
  if (state.viewMode !== 'universe') setView('universe');
  else requestUniverseDraw();
}

// ---------- contextual shortcut hints ----------
// A tiny strip at the right end of the name-bar row that shows only the shortcuts that
// apply to what the user is doing right now. Each hint: [keys or gesture, label].
const KH = {
  edit:     [['Enter', 'Confirm'], ['Esc', 'Cancel']],
  drag:     [['Drop on a slot', ''], ['Esc', 'Cancel']],
  settings: [['Esc', 'Close']],
  trigger:  [['1–8', 'Play slot'], ['⌥+1–8', 'To a slot'], ['Space', 'Play input'], ['Esc', 'Back']],
  files:    [['Space', 'Audition'], ['⌥+1–8', 'To a slot'], ['Esc', 'Home']],
  scrub:    [['Drag', 'Scrub'], ['⌥+Drag', 'To a slot']],
  similar:  [['← →', 'Similar'], ['Space', 'Audition'], ['⌥+1–8', 'To a slot'], ['Esc', 'Close']],
  hover:    [['Click', 'Audition'], ['⌥+Drag', 'To a slot']],
  universe: [['Scroll', 'Zoom'], ['1–8', 'Play slot'], ['/', 'Search'], ['Tab', 'Trigger']],
};
function keyHintContext() {
  if (numericEditor) return 'edit';
  if (state.drag && dragStarted) return 'drag';
  if ($('#visualPanel').classList.contains('show')) return 'settings';
  if ($('#settingsMenu').classList.contains('show')) return 'settings';
  if (state.viewMode === 'trigger') return 'trigger';
  if (state.viewMode === 'files') return 'files';
  if (state.scanning) return 'scrub';
  if (state.simVisible) return 'similar';
  if (state.hover) return 'hover';
  return 'universe';
}
const GESTURES = ['Click', 'Double-click', 'Drag', 'Scroll', 'Right-drag', 'Drop on a slot'];
function keyHintHTML(keys) {
  return keys.split('+').map(part => {
    if (GESTURES.includes(part)) return `<span class="gesture">${part}</span>`;
    return part.split(' ').filter(Boolean).map(k => `<kbd>${k}</kbd>`).join('');
  }).join('<span class="plus">+</span>');
}
(function keyHints() {
  const el = $('#keyHints');
  if (!el) return;
  let shown = null;
  const render = ctx => {
    el.innerHTML = KH[ctx].map(([keys, label]) =>
      `<span class="kh">${keyHintHTML(keys)}${label ? `<span class="lbl">${label}</span>` : ''}</span>`).join('');
    el.classList.add('show');
  };
  setInterval(() => {
    const ctx = keyHintContext();
    if (ctx === shown) return;
    shown = ctx;
    el.classList.remove('show');
    setTimeout(() => { if (shown === ctx) render(ctx); }, 120);
  }, 150);
})();

// ---------- single-key shortcuts ----------
// Ignored while typing (inputs, selects, in-place numeric editing) and with ⌘/Ctrl/Alt held.
//   Space  audition the selected sample (TRIGGER: play the input)
//   1–8    send the selected sample to that slot (TRIGGER: select that slot)
//   T      TRIGGER page on/off     F  FILE SEARCH on/off
//   ,      Settings                /  focus the search field
function isTypingTarget(t) {
  return !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
}
window.addEventListener('keydown', e => {
  if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
  if (numericEditor || isTypingTarget(e.target)) return;
  const k = e.key;
  const inTrigger = state.viewMode === 'trigger';
  if (k === ' ') {
    // Let a focused button/link receive its normal Space activation instead of
    // also starting/stopping the trigger input.
    if (/^(BUTTON|A)$/.test(e.target && e.target.tagName)) return;
    e.preventDefault();
    if (inTrigger) playInput();
    else if (state.selectedSample) playHoverPreview(state.selectedSample);
  } else if (/^[1-8]$/.test(k)) {
    // 1–8 plays that Trigger Slot (Alt+1–8 sends a sample to it, below).
    auditionSlot(+k - 1);
  } else if (k === 't' || k === 'T') {
    setTriggerOpen(!inTrigger);
  } else if (k === 'f' || k === 'F') {
    setView(state.viewMode === 'files' ? 'universe' : 'files');
  } else if (k === ',') {
    setSettingsOpen(!$('#settingsMenu').classList.contains('show'));
  } else if (k === '/') {
    e.preventDefault();
    if (inTrigger) closeTriggerPage();
    $('#search').focus();
  }
});

function auditionSlot(i) {
  const el = document.querySelector(`#slots .slot[data-slot="${i}"]`);
  if (el) {
    el.classList.remove('slot-audition'); void el.offsetWidth; el.classList.add('slot-audition');
    setTimeout(() => el.classList.remove('slot-audition'), 380);
  }
  if (!slotSample(state.slots[i])) return;
  ensureAudio();
  playSlot(i, .01);
}
// Alt+1–8: send the sample you have (selected in HOME / FILE SEARCH, or the
// one in the editor on the TRIGGER page) to that slot. e.code, because Alt
// turns the digit into another character on macOS.
window.addEventListener('keydown', e => {
  if (!e.altKey || e.metaKey || e.ctrlKey || e.repeat) return;
  const m = /^(?:Digit|Numpad)([1-8])$/.exec(e.code || '');
  if (!m || numericEditor || isTypingTarget(e.target)) return;
  e.preventDefault();
  const i = +m[1] - 1;
  const smp = state.viewMode === 'trigger' ? (currentSlotSample() || state.selectedSample) : state.selectedSample;
  if (!smp) { toast('Select a sample first'); return; }
  assignSample(i, smp);
  const el = document.querySelector(`#slots .slot[data-slot="${i}"]`);
  if (el) { el.classList.add('slot-impact'); setTimeout(() => el.classList.remove('slot-impact'), 640); }
});

// TAB toggles TRIGGER <-> UNIVERSE (HOME). Text fields and inline numeric
// editors keep their normal Tab.
window.addEventListener('keydown', e => {
  if (e.key !== 'Tab' || e.metaKey || e.ctrlKey || e.altKey) return;
  const t = e.target;
  if (t && (t.closest('input, textarea, select, [contenteditable="true"]') || t.classList.contains('num-editing'))) return;
  e.preventDefault();
  if (state.viewMode === 'trigger') setView('universe');
  else openTriggerPage();
}, true);

// ESC always lands on HOME, from TRIGGER, FILE SEARCH or any open overlay.
window.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  const tag = e.target && e.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') e.target.blur();
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  goHome();
});
$('#viewToggle').onclick = () => setView(state.viewMode === 'universe' ? 'files' : 'universe');

$('#search').addEventListener('focus', hideSimilarity);
$('#search').addEventListener('input', e => $('.search-box').classList.toggle('has-value', !!e.target.value));
$('#search').addEventListener('input', e => {
  hideSimilarity();
  state.filters.search = e.target.value.trim();
  drawUniverse();
  if (state.viewMode === 'files') renderFileList();
});

// ---------- sample editor ----------
function sampleWave(s) {
  if (s.isReal && s.audioBuffer) {
    const data = s.audioBuffer.getChannelData(0);
    const n = 600;
    const step = Math.max(1, Math.floor(data.length / n));
    const arr = [];
    let peak = 1e-6;
    for (let i = 0; i < n; i++) {
      let p = 0;
      const end = Math.min(data.length, (i + 1) * step);
      for (let j = i * step; j < end; j++) p = Math.max(p, Math.abs(data[j]));
      arr.push(p);
      peak = Math.max(peak, p);
    }
    return arr.map(v => clamp(v / peak, .03, 1));
  }
  const n = 132;
  const r = mulberry32(s.id * 2654435761 % 2147483647 + 7);
  const arr = [];
  let v = 0;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const env = Math.exp(-t / (0.10 + 0.5 * (1 - s.drum))) * (0.65 + 0.35 * Math.sin(t * Math.PI));
    const noise = (r() - .5) * .55 + (r() - .5) * .35;
    v = v * .55 + noise * .45;
    arr.push(clamp(env * (.55 + Math.abs(v) * 1.1), .03, 1));
  }
  return arr;
}

function currentSlot() { return state.slots[state.selectedSlot]; }
function currentSlotSample() { return slotSample(currentSlot()); }

function updateInspector() {
  const slot = currentSlot();
  const smp = slotSample(slot);
  $('#selSlotBadge').textContent = `SLOT ${String(state.selectedSlot + 1).padStart(2, '0')}`;
  $('#selSampleTitle').textContent = smp ? smp.name : 'empty slot';
  if ($('#apSlotBadge')) $('#apSlotBadge').textContent = `SLOT ${String(state.selectedSlot + 1).padStart(2, '0')}`;
  if ($('#apSampleName')) $('#apSampleName').textContent = smp ? smp.name : 'empty slot';
  $('#selSampleMeta').textContent = smp
    ? `${CAT[smp.category].short} · ${fmtMs(smp.dur)}`
    : 'drag a sample from the browser';

  updateAutoPhasePanel();

  $('#sampleMeta').textContent = smp
    ? `${CAT[smp.category].short} · ${fmtMs(smp.dur)} · ${fmtHz(smp.bright)} · ${smp.path}`
    : 'Drop a sample from HOME.';

  $('#tone').value = slot.tone;
  $('#toneVal').textContent = (slot.tone > 0 ? '+' : '') + slot.tone;
  $('#cut').value = slot.cut;
  $('#cutVal').textContent = slot.cut + '%';
  $('#velSens').value = slot.velSens;
  $('#velSensVal').textContent = slot.velSens + '%';
  $('#gain').value = slot.gain;
  $('#gainVal').textContent = fmtDb(slot.gain);
  $('#reverseBtn').classList.toggle('on', !!slot.reverse);

  renderSampleEditor();
}

// SAMPLE + ENVELOPE editor geometry, in real CSS pixels of the SVG (the
// viewBox follows the element size, so circles stay round and lines crisp at
// any window size). x0..x1 shows the visible part of the sample (wheel zoom);
// the envelope runs from START to the end of the sample.
function waveGeom() {
  const svg = $('#wave');
  const W = Math.max(160, Math.round(svg && svg.clientWidth || 600));
  const H = Math.max(90, Math.round(svg && svg.clientHeight || 170));
  const x0 = 12, x1 = W - 12, top = 14, bottom = H - 20;
  return { W, H, x0, x1, top, bottom, mid: (top + bottom) / 2, amp: (bottom - top) / 2 };
}
function niceStepMs(pxPerMs, minPx) {
  for (const st of [.1, .2, .5, 1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000]) if (st * pxPerMs >= minPx) return st;
  return 10000;
}
// Move START keeping A/D/R times; a release that sat on the end of the sample
// stays on the end.
function setSlotStart(slot, startFrac) {
  const atEnd = slot.adsr.end >= envTotalMs() - 1;
  slot.start = clamp(startFrac, 0, .98);
  fitAdsrToSample(slot);
  if (atEnd) slot.adsr.end = Math.round(envTotalMs());
  clampEnvPts(slot);
}

// ---- envelope points ----
// A/D/R stay the named points (slot.adsr). slot.envPts holds the extra points
// added with a double click: [{t, v}] with t in ms from START (always before
// R) and v the level 0..1. The shape is the sorted list (0,0) -> ... -> R.
let envPtSeq = 1; // stable ids for extra points (selection survives sorting)
function clampEnvPts(slot) {
  if (!Array.isArray(slot.envPts)) slot.envPts = [];
  const end = slot.adsr.end;
  slot.envPts = slot.envPts
    .map(q => ({ t: clamp(q.t, 0, Math.max(0, end - .5)), v: clamp(q.v, 0, 1), id: q.id || envPtSeq++ }))
    .sort((a, b) => a.t - b.t);
}
function slotEnvPoints(slot, total = envTotalMs()) {
  const a = clamp(slot.adsr.a, 0, total);
  const d = clamp(slot.adsr.d, 0, Math.max(0, total - a));
  const end = clamp(slot.adsr.end, a + d, total);
  // every level is free (LFO Tool style): no A >= D >= R constraint
  const s = clamp(slot.adsr.s, 0, 1);
  const p = clamp(slot.adsr.p, 0, 1);
  const e = clamp(slot.adsr.e, 0, 1);
  const pts = [
    { t: a, v: p, k: 'attack' },
    { t: a + d, v: s, k: 'decay' },
    ...(slot.envPts || []).map((q, i) => ({ t: clamp(q.t, 0, end), v: clamp(q.v, 0, 1), k: 'x', i, id: q.id, sid: 'x' + q.id })),
  ].sort((x, y) => x.t - y.t || (x.k === 'x') - (y.k === 'x'));
  pts.forEach(q => { if (!q.sid) q.sid = q.k; });
  return [{ t: 0, v: 0, k: 'origin', sid: 'origin' }, ...pts, { t: end, v: e, k: 'release', sid: 'release' }];
}
function envGainAt(pts, t) {
  if (t < 0 || t > pts[pts.length - 1].t) return 0;
  for (let i = 1; i < pts.length; i++) {
    const q0 = pts[i - 1], q1 = pts[i];
    if (t <= q1.t) return q1.t - q0.t < 1e-6 ? q1.v : q0.v + (q1.v - q0.v) * (t - q0.t) / (q1.t - q0.t);
  }
  return pts[pts.length - 1].v;
}

// ---- zoom (wheel) ----
let waveView = { key: '', vs: 0, ve: 0 };
function waveViewFor(slot, smp) {
  const key = `${state.selectedSlot}|${smp.id}|${slot.reverse ? 'r' : 'f'}`;
  if (waveView.key !== key || !(waveView.ve > waveView.vs)) waveView = { key, vs: 0, ve: smp.dur };
  waveView.vs = clamp(waveView.vs, 0, smp.dur); waveView.ve = clamp(waveView.ve, waveView.vs + .5, smp.dur);
  return waveView;
}
// Peaks of the real playback buffer for each pixel column of the view.
function sampleColumnPeaks(smp, reverse, vs, ve, cols) {
  const buf = reverse ? getReversedBuffer(smp) : getBuffer(smp);
  const out = new Float32Array(cols);
  if (!buf) {
    let arr = sampleWave(smp); if (reverse) arr = arr.slice().reverse();
    for (let c = 0; c < cols; c++) {
      const f = (vs + (c + .5) / cols * (ve - vs)) / smp.dur * (arr.length - 1);
      const i = Math.floor(f), fr = f - i;
      out[c] = (arr[i] || 0) * (1 - fr) + (arr[i + 1] || 0) * fr;
    }
    return out;
  }
  const data = buf.getChannelData(0);
  if (!buf._tuPeak) { let m = 1e-6; for (let i = 0; i < data.length; i++) m = Math.max(m, Math.abs(data[i])); buf._tuPeak = m; }
  const msToIdx = ms => ms / 1000 * buf.sampleRate;
  for (let c = 0; c < cols; c++) {
    const i0 = Math.floor(msToIdx(vs + c / cols * (ve - vs)));
    const i1 = Math.max(i0 + 1, Math.ceil(msToIdx(vs + (c + 1) / cols * (ve - vs))));
    let m = 0;
    for (let i = Math.max(0, i0); i < Math.min(data.length, i1); i++) { const a = Math.abs(data[i]); if (a > m) m = a; }
    out[c] = m / buf._tuPeak;
  }
  return out;
}

function renderSampleEditor() {
  const svg = $('#wave');
  if (!svg) return;
  const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
  const slot = currentSlot();
  const smp = slot ? slotSample(slot) : null;
  const g = waveGeom();
  svg.setAttribute('viewBox', `0 0 ${g.W} ${g.H}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  if (!slot || !smp) {
    svg.innerHTML = `<text x="${g.W / 2}" y="${g.H / 2}" text-anchor="middle" class="we-empty">Drop a sample on this slot</text>`;
    ['startVal', 'aVal', 'dVal', 'rVal'].forEach(id => set(id, '—'));
    return;
  }
  if (envSelSlot !== state.selectedSlot) { envSelSlot = state.selectedSlot; multiSel.env = new Set(); }
  // END and the fades are gone from the editor: the envelope is the shape.
  if (slot.end !== 1 || slot.fadeIn || slot.fadeOut) { slot.end = 1; slot.fadeIn = 0; slot.fadeOut = 0; }
  clampEnvPts(slot);
  const { W, H, x0, x1, top, bottom, mid, amp } = g;
  const span = x1 - x0;
  const dur = smp.dur;
  const view = waveViewFor(slot, smp);
  const { vs, ve } = view;
  const msToX = ms => x0 + (ms - vs) / (ve - vs) * span;
  const color = CAT[smp.category].color;
  const startMs = slot.start * dur;
  const startX = msToX(startMs);
  const total = envTotalMs();
  const pts = slotEnvPoints(slot, total);
  const endMs = pts[pts.length - 1].t;
  const envX = t => msToX(startMs + t);
  const envY = v => bottom - clamp(v, 0, 1) * (bottom - top);
  const f1 = v => v.toFixed(1);

  // time grid + axis labels (absolute ms in the sample)
  const pxPerMs = span / (ve - vs);
  const stepMs = niceStepMs(pxPerMs, 64);
  const dec = stepMs < 1 ? 1 : 0;
  let grid = '', labels = '';
  for (let t = Math.ceil(vs / stepMs - 1e-9) * stepMs; t <= ve + 1e-6; t += stepMs) {
    const x = msToX(t);
    grid += `<line x1="${f1(x)}" y1="${top}" x2="${f1(x)}" y2="${bottom}" class="we-grid"/>`;
    if (x > x0 + 18 && x < x1 - 24 || Math.abs(t - vs) < 1e-6)
      labels += `<text x="${f1(x)}" y="${H - 6}" class="we-axis" text-anchor="${Math.abs(t - vs) < 1e-6 ? 'start' : 'middle'}">${t >= 1000 ? (t / 1000).toFixed(stepMs < 1000 ? 2 : 1) + ' s' : t.toFixed(dec) + (Math.abs(t - vs) < 1e-6 ? ' ms' : '')}</text>`;
  }
  [0.5, 1].forEach(v => { grid += `<line x1="${x0}" y1="${f1(envY(v))}" x2="${x1}" y2="${f1(envY(v))}" class="we-grid${v === 1 ? ' we-grid-top' : ''}"/>`; });

  // waveform: ghost of the original + the enveloped one (what you hear)
  const cols = Math.max(2, Math.round(span));
  const pk = sampleColumnPeaks(smp, !!slot.reverse, vs, ve, cols);
  const wAmp = amp * .9;
  let ghostTop = '', ghostBot = '', shapedTop = '', shapedBot = '';
  for (let c = 0; c < cols; c++) {
    const x = x0 + (c + .5) / cols * span;
    const v = pk[c] * wAmp;
    ghostTop += `${c ? 'L' : 'M'}${f1(x)} ${f1(mid - v)}`;
    ghostBot = `L${f1(x)} ${f1(mid + v)}` + ghostBot;
    const tMs = vs + (c + .5) / cols * (ve - vs) - startMs;
    const gv = v * envGainAt(pts, tMs);
    shapedTop += `${c ? 'L' : 'M'}${f1(x)} ${f1(mid - gv)}`;
    shapedBot = `L${f1(x)} ${f1(mid + gv)}` + shapedBot;
  }
  // envelope polyline: every point, then silence after R (unchanged behaviour)
  const linePts = pts.map(q => [envX(q.t), envY(q.v)]);
  if (endMs < total) linePts.push([envX(endMs + 1e-6), envY(0)], [envX(total), envY(0)]);
  const envLine = linePts.map((q, i) => `${i ? 'L' : 'M'}${f1(q[0])} ${f1(q[1])}`).join(' ');
  const envArea = `${envLine} L${f1(envX(total))} ${bottom} L${f1(startX)} ${bottom} Z`;
  const handle = (q, label) => {
    const x = envX(q.t), y = envY(q.v);
    const attr = q.k === 'x' ? `data-x="${q.i}"` : `data-h="${q.k}"`;
    const lx = clamp(x, x0 + 8, x1 - 8), ly = y < top + 16 ? y + 17 : y - 9;
    if (x < x0 - 6 || x > x1 + 6) label = ''; // out of the zoomed view
    return `<g class="we-handle${q.k === 'x' ? ' we-extra' : ''}${multiSel.env.has(q.sid) ? ' sel' : ''}" ${attr} data-sid="${q.sid}">
      <circle cx="${f1(x)}" cy="${f1(y)}" r="${q.k === 'x' ? 10 : 12}" class="we-hit"/>
      <circle cx="${f1(x)}" cy="${f1(y)}" r="${q.k === 'x' ? 3.6 : 4.5}" class="we-dot"/>
      ${label ? `<text x="${f1(lx)}" y="${f1(ly)}" text-anchor="middle" class="we-hlabel">${label}</text>` : ''}</g>`;
  };
  const zoom = dur / (ve - vs);

  svg.innerHTML = `
    <defs>
      <linearGradient id="weWave" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${color}" stop-opacity=".75"/>
        <stop offset=".5" stop-color="${color}" stop-opacity=".45"/>
        <stop offset="1" stop-color="${color}" stop-opacity=".75"/>
      </linearGradient>
      <linearGradient id="weEnv" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#2DE2C5" stop-opacity=".16"/>
        <stop offset="1" stop-color="#2DE2C5" stop-opacity=".01"/>
      </linearGradient>
      <clipPath id="wePlot"><rect x="${x0 - 6}" y="0" width="${span + 12}" height="${H}"/></clipPath>
    </defs>
    <rect x="${x0}" y="${top}" width="${span}" height="${bottom - top}" class="we-bg"/>
    ${grid}
    <line x1="${x0}" y1="${f1(mid)}" x2="${x1}" y2="${f1(mid)}" class="we-zero"/>
    <path d="${ghostTop}${ghostBot}Z" class="we-ghost"/>
    <g clip-path="url(#wePlot)">
      <path d="${envArea}" fill="url(#weEnv)"/>
      <path d="${shapedTop}${shapedBot}Z" fill="url(#weWave)"/>
      <rect x="${x0}" y="${top}" width="${f1(clamp(startX - x0, 0, span))}" height="${bottom - top}" class="we-off"/>
    </g>
    <line x1="${x0}" y1="${bottom}" x2="${x1}" y2="${bottom}" class="we-base"/>
    <g clip-path="url(#wePlot)">
      <path d="${envLine}" class="we-env"/>
      <g class="we-start" data-handle="start" style="--c:${color}">
        <rect x="${f1(startX - 7)}" y="${top - 4}" width="14" height="${bottom - top + 4}" class="we-hit"/>
        <line x1="${f1(startX)}" y1="${top}" x2="${f1(startX)}" y2="${bottom}" class="we-start-line"/>
        <path d="M${f1(startX)} ${bottom} v-13 h8 a2 2 0 0 1 2 2 v9 a2 2 0 0 1 -2 2 Z" class="we-start-flag"/>
      </g>
      ${pts.filter(q => q.k === 'x').map(q => handle(q, '')).join('')}
      ${handle(pts.find(q => q.k === 'attack'), 'A')}
      ${handle(pts.find(q => q.k === 'decay'), 'D')}
      ${handle(pts[pts.length - 1], 'R')}
    </g>
    ${labels}
    ${zoom > 1.01 ? `<text x="${x1 - 2}" y="${top + 10}" text-anchor="end" class="we-zoom">×${zoom < 10 ? zoom.toFixed(1) : Math.round(zoom)}</text>` : ''}
  `;

  set('startVal', fmtMs(startMs));
  set('aVal', fmtMs(slot.adsr.a));
  set('dVal', fmtMs(slot.adsr.d));
  set('rVal', fmtMs(Math.max(0, slot.adsr.end - slot.adsr.a - slot.adsr.d)));
}
// Redraw at the new pixel size when the panel or window resizes.
(() => {
  const wrap = document.querySelector('.unified-wave-wrap');
  if (!wrap || typeof ResizeObserver === 'undefined') return;
  let raf = 0;
  new ResizeObserver(() => {
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; renderSampleEditor(); });
  }).observe(wrap);
})();

function renderWaveform() { renderSampleEditor(); }
function renderADSR() { renderSampleEditor(); }

function envTotalMs() {
  const slot = currentSlot();
  const smp = slotSample(slot);
  return Math.max(40, smp ? (slot.end - slot.start) * smp.dur : 800);
}

function fitAdsrToSample(slot) {
  const smp = slotSample(slot);
  const total = Math.max(40, smp ? (slot.end - slot.start) * smp.dur : 800);
  let a = Math.max(0, slot.adsr.a || 0);
  let d = Math.max(0, slot.adsr.d || 0);
  let end = Number.isFinite(slot.adsr.end) && slot.adsr.end > 0 ? slot.adsr.end : total;
  end = clamp(end, 0, total);
  if (a + d > end) {
    const k = end / Math.max(1, a + d);
    a = Math.round(a * k); d = Math.round(d * k);
    let over = a + d - end;
    while (over > 0) {
      if (d > 0) { d--; over--; }
      else if (a > 0) { a--; over--; }
      else break;
    }
  }
  const level = clamp(slot.adsr.s ?? .5, 0, 1);
  const peak = clamp(slot.adsr.p ?? 1, 0, 1);
  const releaseLevel = clamp(slot.adsr.e ?? 0, 0, 1);
  slot.adsr.a = Math.round(a);
  slot.adsr.d = Math.round(d);
  slot.adsr.end = Math.round(end);
  slot.adsr.s = level; slot.adsr.p = peak; slot.adsr.e = releaseLevel;
}

const waveDur = () => { const smp = currentSlotSample(); return smp ? smp.dur : 0; };
const waveEditEnabled = () => !!currentSlotSample();
const waveEditDisabled = 'Drop a sample in this slot first';
const waveEditOpts = { step: .1, unit: 'ms', decimals: 1, enabled: waveEditEnabled, disabledMsg: waveEditDisabled };

bindNumericEdit($('#startVal'), Object.assign({
  get: () => currentSlot().start * waveDur(),
  set: v => {
    const smp = currentSlotSample(); if (!smp) return;
    const slot = currentSlot();
    setSlotStart(slot, v / smp.dur);
    renderWaveform();
  },
  min: 0, max: () => .98 * waveDur(), default: 0,
}, waveEditOpts));

// START -> transient: first sample above -20 dB of the peak, then back to
// where the signal was still below -40 dB (max 5 ms) and to the zero
// crossing just before it (max 1 ms), so the attack is kept and nothing clicks.
function transientStartMs(smp, reverse) {
  const buf = reverse ? getReversedBuffer(smp) : getBuffer(smp);
  if (!buf) return null;
  const d = buf.getChannelData(0), sr = buf.sampleRate;
  let peak = 0;
  for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > peak) peak = a; }
  if (peak <= 0) return 0;
  let on = 0;
  while (on < d.length && Math.abs(d[on]) < peak * 0.1) on++;
  let i = on;
  const lim = Math.max(0, on - Math.round(0.005 * sr));
  while (i > lim && Math.abs(d[i - 1]) > peak * 0.01) i--;
  const lim2 = Math.max(0, i - Math.round(0.001 * sr));
  while (i > lim2 && d[i] !== 0 && Math.sign(d[i - 1]) === Math.sign(d[i])) i--;
  return i / sr * 1000;
}
$('#snapStartBtn').addEventListener('click', e => {
  e.stopPropagation();
  const slot = currentSlot(), smp = slotSample(slot);
  if (!slot || !smp) { toast('Drop a sample in this slot first'); return; }
  if (slot.reverse) ensureAudio();
  const ms = transientStartMs(smp, !!slot.reverse);
  if (ms == null) { toast('Sample audio not ready yet'); return; }
  setSlotStart(slot, ms / smp.dur);
  renderSampleEditor();
  toast(`START → ${fmtMs(slot.start * smp.dur)} · transient`);
});

// Drag the sample to a slot from its name above the waveform, like a file.
$('#sampleMeta').addEventListener('pointerdown', e => {
  const smp = currentSlotSample();
  if (!smp || e.button !== 0) return;
  beginDrag(smp, { clientX: e.clientX, clientY: e.clientY, preventDefault() {} }, { keepTrigger: true, openTrigger: true });
});

// pixel -> sample ms / envelope level, for the current view
function waveCoords(e) {
  const svg = $('#wave');
  const rect = svg.getBoundingClientRect();
  const g = waveGeom();
  const slot = currentSlot(), smp = slotSample(slot);
  const view = waveViewFor(slot, smp);
  const px = (e.clientX - rect.left) / (rect.width / g.W);
  const py = (e.clientY - rect.top) / (rect.height / g.H);
  const ms = view.vs + (px - g.x0) / (g.x1 - g.x0) * (view.ve - view.vs);
  return { g, rect, view, px, py, ms, t: ms - slot.start * smp.dur,
    level: clamp((g.bottom - py) / Math.max(1, g.bottom - g.top), 0, 1) };
}

let lastExtraDown = { i: -1, time: 0 };
$('#wave').addEventListener('pointerdown', e => {
  const trimH = e.target.closest('[data-handle]');
  const envH = e.target.closest('[data-h]');
  const extraH = e.target.closest('[data-x]');
  const smp = currentSlotSample();
  if (!trimH && !envH && !extraH) {
    if (!smp || e.button !== 0) return;
    // Alt+drag: take the sample to a slot (like HOME). Started without
    // preventDefault on this pointerdown: that would suppress the
    // mousemove/mouseup the drag listens to.
    if (e.altKey) { beginDrag(smp, { clientX: e.clientX, clientY: e.clientY, preventDefault() {} }, { keepTrigger: true, openTrigger: true }); return; }
    // Plain drag on empty space: select points with a box.
    startMarquee(e, { scope: 'env', onChange: renderSampleEditor,
      items: () => [...document.querySelectorAll('#wave .we-handle[data-sid]')].map(g => ({ el: g.querySelector('.we-dot'), id: g.dataset.sid })) });
    return;
  }
  e.preventDefault();
  const slot = currentSlot();
  if (!slot || !smp) return;
  const c0 = waveCoords(e);
  const sy = c0.rect.height / c0.g.H;
  const startY = e.clientY;
  const startP = slot.adsr.p, startS = slot.adsr.s, startE = slot.adsr.e;
  const xi = extraH ? +extraH.dataset.x : -1;
  const sid = (envH || extraH) ? (envH || extraH).dataset.sid : null;
  multiSel.scope = 'env';
  if (sid && (e.metaKey || e.ctrlKey || e.shiftKey)) { finderClick('env', sid, e, envOrder); renderSampleEditor(); return; }
  if (sid && !multiSel.env.has(sid)) selAnchor.env = sid;
  if (sid && multiSel.env.has(sid) && multiSel.env.size > 1) { groupDragEnv(e, slot, sid); return; }
  if (sid) multiSel.env = new Set([sid]);
  // Double click on an extra point removes it (detected here: the redraw
  // between the two clicks replaces the element, so 'dblclick' never fires).
  if (xi >= 0) {
    const now = performance.now();
    if (lastExtraDown.i === xi && now - lastExtraDown.time < 400) {
      lastExtraDown = { i: -1, time: 0 };
      slot.envPts.splice(xi, 1);
      renderSampleEditor();
      return;
    }
    lastExtraDown = { i: xi, time: now };
  }
  const startV = xi >= 0 ? slot.envPts[xi].v : 0;
  let moved = false;
  // Every point moves only between its neighbours, so the order never flips.
  const key = envH ? envH.dataset.h : 'x';
  const neighbours = () => {
    const pts = slotEnvPoints(slot);
    const idx = pts.findIndex(q => key === 'x' ? (q.k === 'x' && q.i === xi) : q.k === key);
    return [idx > 0 ? pts[idx - 1].t : 0, idx < pts.length - 1 ? pts[idx + 1].t : envTotalMs()];
  };
  const move = ev => {
    moved = true;
    const c = waveCoords(ev);
    if (trimH) { setSlotStart(slot, c.ms / smp.dur); renderSampleEditor(); return; }
    const total = envTotalMs();
    const t = clamp(c.t, 0, total);
    const level = (startY - ev.clientY) / sy / Math.max(1, c.g.bottom - c.g.top);
    const [lo, hi] = neighbours();
    const { a, d, end } = slot.adsr;
    if (key === 'attack') {
      slot.adsr.a = Math.round(clamp(t, lo, Math.min(hi, Math.max(0, end - d))));
      slot.adsr.p = clamp(startP + level, 0, 1);
    } else if (key === 'decay') {
      slot.adsr.d = Math.round(clamp(t, lo, Math.min(hi, end)) - a);
      slot.adsr.s = clamp(startS + level, 0, 1);
    } else if (key === 'release') {
      slot.adsr.end = Math.round(clamp(t, Math.max(lo, a + d), total));
      slot.adsr.e = clamp(startE + level, 0, 1);
    } else {
      slot.envPts[xi].t = clamp(t, lo, Math.max(lo, hi - .5));
      slot.envPts[xi].v = clamp(startV + level, 0, 1);
    }
    renderSampleEditor();
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    if (!moved) return;
    clampEnvPts(slot);
    renderSampleEditor();
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
});

// Move every selected envelope point by the same time/level offset. The time
// offset is limited so no selected point passes an unselected neighbour.
function groupDragEnv(e, slot, sid) {
  const c0 = waveCoords(e);
  let gMoved = false;
  const total = envTotalMs();
  const pts0 = slotEnvPoints(slot, total);
  const sel = q => multiSel.env.has(q.sid);
  let dLo = -Infinity, dHi = Infinity;
  pts0.forEach((q, idx) => {
    if (!sel(q)) return;
    let j = idx - 1; while (j > 0 && sel(pts0[j])) j--;
    let k = idx + 1; while (k < pts0.length && sel(pts0[k])) k++;
    const lo = j >= 0 ? pts0[j].t : 0, hi = k < pts0.length ? pts0[k].t : total;
    dLo = Math.max(dLo, lo - q.t); dHi = Math.min(dHi, hi - q.t);
  });
  const sy = c0.rect.height / c0.g.H, y0 = e.clientY;
  const move = ev => {
    gMoved = true;
    const c = waveCoords(ev);
    const dt = clamp(c.t - c0.t, dLo, dHi);
    const dv = (y0 - ev.clientY) / sy / Math.max(1, c.g.bottom - c.g.top);
    let tA = pts0.find(q => q.k === 'attack').t, tD = pts0.find(q => q.k === 'decay').t, tR = pts0[pts0.length - 1].t;
    pts0.forEach(q => {
      if (!sel(q)) return;
      const t = q.t + dt, v = clamp(q.v + dv, 0, 1);
      if (q.k === 'attack') { tA = t; slot.adsr.p = v; }
      else if (q.k === 'decay') { tD = t; slot.adsr.s = v; }
      else if (q.k === 'release') { tR = t; slot.adsr.e = v; }
      else { const x = slot.envPts.find(p => p.id === q.id); if (x) { x.t = t; x.v = v; } }
    });
    slot.adsr.a = tA; slot.adsr.d = Math.max(0, tD - tA); slot.adsr.end = Math.max(tA + slot.adsr.d, tR);
    renderSampleEditor();
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    if (!gMoved) { multiSel.env = new Set([sid]); selAnchor.env = sid; }
    clampEnvPts(slot); renderSampleEditor();
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

// Delete / Backspace removes the selected extra points; Cmd/Ctrl+A selects
// everything in the active scope (envelope points, knobs or slots).
window.addEventListener('keydown', e => {
  if (state.viewMode !== 'trigger') return;
  const t = e.target;
  if (t && (t.closest('input, textarea, select, [contenteditable="true"]') || t.classList.contains('num-editing'))) return;
  if ((e.metaKey || e.ctrlKey) && (e.key === 'a' || e.key === 'A') && multiSel.scope) {
    e.preventDefault();
    if (multiSel.scope === 'env') {
      const slot = currentSlot();
      if (slot && slotSample(slot)) { multiSel.env = new Set(slotEnvPoints(slot).filter(q => q.k !== 'origin').map(q => q.sid)); renderSampleEditor(); }
    } else if (multiSel.scope === 'knobs') {
      multiSel.knobs = new Set(Object.keys(knobReg)); applyKnobSelClasses();
    } else if (multiSel.scope === 'slots' || multiSel.scope === 'faders') {
      multiSel[multiSel.scope] = new Set(state.slots.map((_, i) => i)); applySlotSelClasses();
    }
    return;
  }
  if ((e.key === 'Delete' || e.key === 'Backspace') && multiSel.scope === 'env' && multiSel.env.size) {
    const slot = currentSlot();
    if (!slot || !slot.envPts) return;
    e.preventDefault();
    const before = slot.envPts.length;
    slot.envPts = slot.envPts.filter(q => !multiSel.env.has('x' + q.id));
    multiSel.env = new Set([...multiSel.env].filter(id => !id.startsWith('x')));
    if (before !== slot.envPts.length) renderSampleEditor();
    else toast('A / D / R are fixed points');
  }
});
// Double click: add an envelope point (before R), or remove an extra point.
$('#wave').addEventListener('dblclick', e => {
  const slot = currentSlot(), smp = slotSample(slot);
  if (!slot || !smp) return;
  e.preventDefault(); e.stopPropagation();
  const extraH = e.target.closest('[data-x]');
  if (extraH) {
    slot.envPts.splice(+extraH.dataset.x, 1);
    renderSampleEditor();
    return;
  }
  if (e.target.closest('[data-h],[data-handle]')) return;
  const c = waveCoords(e);
  if (c.t <= 0) { toast('Envelope points go after START'); return; }
  const total = envTotalMs();
  if (c.t >= total) return;
  clampEnvPts(slot);
  if (c.t > slot.adsr.end + .5) {
    // Past R: the old R becomes a regular point and the new one is the end.
    const oldEnd = slot.adsr.end;
    slot.envPts.push({ t: oldEnd, v: clamp(slot.adsr.e, 0, 1) });
    slot.adsr.end = Math.min(total, c.t);
    slot.adsr.e = c.level;
    // keep the old R a hair before the new end so the order never flips
    slot.envPts[slot.envPts.length - 1].t = Math.min(oldEnd, slot.adsr.end - .5);
  } else {
    slot.envPts.push({ t: c.t, v: c.level });
  }
  clampEnvPts(slot);
  renderSampleEditor();
});

// Wheel: zoom around the cursor. Shift+wheel or a horizontal swipe: pan.
document.querySelector('.unified-wave-wrap').addEventListener('wheel', e => {
  const slot = currentSlot(), smp = slotSample(slot);
  if (!slot || !smp) return;
  e.preventDefault();
  const c = waveCoords(e);
  const v = c.view, range = v.ve - v.vs, dur = smp.dur;
  const panPx = e.shiftKey ? (e.deltaY || e.deltaX) : (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : 0);
  if (panPx) {
    const dms = panPx / (c.g.x1 - c.g.x0) * range;
    v.vs = clamp(v.vs + dms, 0, dur - range); v.ve = v.vs + range;
  } else {
    const nr = clamp(range * Math.exp(e.deltaY * .0025), Math.min(2, dur), dur);
    const frac = clamp((c.px - c.g.x0) / (c.g.x1 - c.g.x0), 0, 1);
    const anchor = v.vs + frac * range;
    v.vs = clamp(anchor - frac * nr, 0, dur - nr); v.ve = v.vs + nr;
  }
  renderSampleEditor();
}, { passive: false });

const envMax = key => {
  const slot = currentSlot();
  if (!slot) return 0;
  const total = envTotalMs();
  if (key === 'a') return Math.max(0, slot.adsr.end - (slot.adsr.d || 0));
  if (key === 'd') return Math.max(0, slot.adsr.end - (slot.adsr.a || 0));
  return Math.max(0, total - (slot.adsr.a || 0) - (slot.adsr.d || 0));
};
bindNumericEdit($('#aVal'), {
  get: () => currentSlot().adsr.a,
  set: v => { currentSlot().adsr.a = clamp(v, 0, envMax('a')); renderADSR(); },
  min: 0, max: () => envMax('a'), step: 1, unit: 'ms', decimals: 0, default: 0,
});
bindNumericEdit($('#dVal'), {
  get: () => currentSlot().adsr.d,
  set: v => { currentSlot().adsr.d = clamp(v, 0, envMax('d')); renderADSR(); },
  min: 0, max: () => envMax('d'), step: 1, unit: 'ms', decimals: 0, default: 120,
});
bindNumericEdit($('#rVal'), {
  get: () => {
    const a = currentSlot().adsr;
    return Math.max(0, a.end - a.a - a.d);
  },
  set: v => {
    const slot = currentSlot();
    const total = envTotalMs();
    const start = slot.adsr.a + slot.adsr.d;
    slot.adsr.end = clamp(start + clamp(v, 0, envMax('r')), start, total);
    renderADSR();
  },
  min: 0, max: () => envMax('r'), step: 1, unit: 'ms', decimals: 0, default: () => envMax('r'),
});

// ---------- AUTO PHASE panel ----------
// Global: ON/OFF (the title), REF (INPUT or any of the 8 slots, for every
// layer) and MODE (offsets, Ø inversion or both). Per selected slot: the
// offset is typed (no knob/fader) and PHASE picks 0° or 90°. 180°/260° were
// removed: polarity is the Ø button on the channel and the typed offset covers
// the rest of the fine adjustment.
function phaseChoice(s) { return s.shift === 90 ? 90 : 0; }
function fmtOffset(v) { return `${v > 0 ? '+' : ''}${v.toFixed(1)}`; }
function updateAutoPhasePanel() {
  const panel = $('#autoPhaseBar');
  if (!panel) return;
  const ap = state.ap;
  panel.classList.toggle('off', !ap.on);
  const pw = $('#apPower');
  pw.classList.toggle('on', ap.on);
  pw.setAttribute('aria-pressed', ap.on ? 'true' : 'false');
  // REF options: INPUT + the 8 slots (empty ones disabled)
  const sel = $('#apRef');
  const opts = ['<option value="INPUT">INPUT</option>'].concat(state.slots.map((x, i) => {
    const smp = slotSample(x);
    return `<option value="${i}"${smp ? '' : ' disabled'}>${String(i + 1).padStart(2, '0')} · ${smp ? smp.name : 'empty'}</option>`;
  }));
  const html = opts.join('');
  if (sel._html !== html) { sel.innerHTML = html; sel._html = html; }
  sel.value = String(ap.ref);
  $$('#apMode button').forEach(b => b.classList.toggle('active', b.dataset.mode === ap.mode));
  const slot = currentSlot();
  const smp = slotSample(slot);
  $('#apSlotBadge').textContent = `SLOT ${String(state.selectedSlot + 1).padStart(2, '0')}`;
  $('#apSampleName').textContent = smp ? smp.name : 'empty slot';
  const inp = $('#apOffset');
  if (document.activeElement !== inp) inp.value = fmtOffset(effOffset(slot));
  inp.disabled = !smp;
  inp.classList.toggle('auto', !!apAutoLag(slot));
  const choice = phaseChoice(slot);
  $$('#slotShift button').forEach(b => b.classList.toggle('active', +b.dataset.shift === choice));
  let res;
  if (!smp) res = 'Drop a sample in this slot.';
  else if (slot.ap && slot.ap.isRef) res = 'Reference layer · not moved';
  else if (!slot.ap) res = ap.ref === 'INPUT' ? 'Not analyzed' : `${apRefLabel()} is empty`;
  else {
    const auto = [];
    if (apAutoInv(slot)) auto.push('Ø');
    if (apAutoLag(slot)) auto.push(`${fmtOffset(slot.ap.lag)} ms`);
    const ph = Number.isFinite(slot.ap.phase) && apUsesPolarity() ? `Δφ <b>${slot.ap.phase}°</b>${slot.ap.phase >= 90 ? ' → Ø' : ''} · ` : '';
    res = `${ph}corr <b>${slot.ap.corr.toFixed(2)}</b> · ${!ap.on ? 'AUTO off' : auto.length ? `auto <b>${auto.join(' ')}</b>` : 'already aligned'}`;
    if (slot.ap.atLimit && apUsesOffset()) res += ` · <span class="warn" title="The sample has air before the hit: it would need more than −5 ms. Use ⇥ TRANSIENT on START.">−5 ms limit · ⇥ TRANSIENT</span>`;
  }
  $('#slotResult').innerHTML = res;
  requestAnimationFrame(checkApStale);
  const rep = $('#apReport');
  if (rep) {
    const r = state.apReport;
    let html = '';
    if (state.apBusy) html = 'analyzing…';
    else if (r && r.error) html = `<span class="warn">${r.error}</span>`;
    else if (r && ap.on) {
      const f = v => `${v >= 0 ? '+' : ''}${v.toFixed(1)}`;
      html = `SUM LOW <b>${f(r.low)} dB</b> · BODY <b>${f(r.body)} dB</b>`;
      if (r.limits && r.limits.length && ap.mode !== 'polarity') html += `<br><span class="warn">⚠ ${r.limits.map(i => String(i + 1).padStart(2, '0')).join(' ')} at −5 ms · ⇥ TRANSIENT</span>`;
      if (r.conflicts.length) html += `<br><span class="warn">⚠ ${r.conflicts.map(([a, b]) => `${String(a + 1).padStart(2, '0')}↔${String(b + 1).padStart(2, '0')}`).join(' ')} cancel</span>`;
    }
    rep.innerHTML = html;
    rep.title = r && r.conflicts && r.conflicts.length ? 'These layers still cancel each other in LOW/body: try Ø or 90° on one of them' : 'Energy of the whole sum (REF + all layers) vs doing nothing';
  }
}
$('#apPower').onclick = () => {
  state.ap.on = !state.ap.on;
  if (state.ap.on) analyzeAllPhase();
  else { renderSlots(); syncAllSlotAudio(); updateAutoPhasePanel(); }
  toast(state.ap.on ? `AUTO PHASE ON · ${apSummary()}` : 'AUTO PHASE OFF · manual Ø / offsets only');
};
$('#apRef').onchange = e => {
  const v = e.target.value;
  state.ap.ref = v === 'INPUT' ? 'INPUT' : +v;
  analyzeAllPhase();
  toast(`AUTO PHASE reference → ${apRefLabel()}`);
};
$('#apMode').addEventListener('click', e => {
  const b = e.target.closest('button[data-mode]');
  if (!b) return;
  state.ap.mode = b.dataset.mode;
  analyzeAllPhase(); // the joint result depends on what may change
});
$('#bounceBtn').onclick = () => bounceModifiedSamples();

$('#slotAuto').onclick = () => {
  const btn = $('#slotAuto');
  btn.classList.add('running');
  btn.textContent = 'ANALYZING…';
  if (!state.ap.on) state.ap.on = true;
  analyzeAllPhase().then(res => {
    btn.classList.remove('running');
    btn.textContent = 'RE-ANALYZE ALL';
    if (res && !res.error) toast(`AUTO PHASE · ${apSummary()}`);
  });
};
// Typed offset: the field shows the slot's total offset (auto + manual trim);
// typing a value keeps the auto part and stores the difference as the trim.
function commitApOffset() {
  const inp = $('#apOffset');
  const s = currentSlot();
  if (!slotSample(s)) return;
  const v = parseFloat(String(inp.value).replace(',', '.').replace(/ms$/i, '').trim());
  if (!Number.isFinite(v)) { inp.classList.add('invalid'); setTimeout(() => inp.classList.remove('invalid'), 600); inp.value = fmtOffset(effOffset(s)); return; }
  const total = Math.round(clamp(v, -5, 50) * 10) / 10;
  s.offset = Math.round((total - apAutoLag(s)) * 10) / 10;
  inp.value = fmtOffset(effOffset(s));
  renderSlots(); updateAutoPhasePanel();
}
(function bindApOffset() {
  const inp = $('#apOffset');
  inp.addEventListener('keydown', e => {
    e.stopPropagation(); // typing digits must not fire the 1–8 slot keys
    if (e.key === 'Enter') { e.preventDefault(); commitApOffset(); inp.blur(); }
    else if (e.key === 'Escape') { e.preventDefault(); inp.value = fmtOffset(effOffset(currentSlot())); inp.blur(); }
  });
  inp.addEventListener('change', commitApOffset);
  inp.addEventListener('focus', () => inp.select());
  inp.addEventListener('pointerdown', e => {
    if (!e.altKey) return; // Alt+click: manual trim back to 0
    e.preventDefault();
    currentSlot().offset = 0;
    inp.blur(); renderSlots(); updateAutoPhasePanel();
  });
})();
$('#slotShift').addEventListener('click', e => {
  const b = e.target.closest('button[data-shift]');
  if (!b) return;
  const s = currentSlot();
  // 0° / 90° only; polarity (Ø) is untouched here
  s.shift = +b.dataset.shift === 90 ? 90 : 0;
  renderSlots(); syncAllSlotAudio(); updateAutoPhasePanel();
});

// ---------- tone / playback ----------
function bindSlotTone(id, key, fmt) {
  $(id).addEventListener('input', e => {
    const slot = currentSlot();
    slot[key] = +e.target.value;
    $(id + 'Val').textContent = fmt(slot[key]);
    syncAllSlotAudio();
  });
}
bindSlotTone('#tone', 'tone', v => (v > 0 ? '+' : '') + v);
bindSlotTone('#cut', 'cut', v => v + '%');
bindSlotTone('#velSens', 'velSens', v => v + '%');
bindSlotTone('#gain', 'gain', v => fmtDb(v));

function bindToneNumeric(id, key, fmt, opts) {
  bindNumericEdit($(id + 'Val'), Object.assign({
    get: () => currentSlot()[key],
    set: v => {
      currentSlot()[key] = v;
      const r = $(id); if (r) r.value = v;
      $(id + 'Val').textContent = fmt(v);
      syncAllSlotAudio();
    },
  }, opts));
}
bindToneNumeric('#tone', 'tone', v => (v > 0 ? '+' : '') + v, { min: -100, max: 100, step: 1, decimals: 0, default: 0 });
bindToneNumeric('#cut', 'cut', v => v + '%', { min: 0, max: 100, step: 1, unit: '%', decimals: 0, default: 100 });
bindToneNumeric('#velSens', 'velSens', v => v + '%', { min: 0, max: 100, step: 1, unit: '%', decimals: 0, default: 100 });
bindToneNumeric('#gain', 'gain', v => fmtDb(v), { min: -24, max: 24, step: .1, unit: 'dB', decimals: 1, default: 0 });


// ---------- inspector tabs ----------
$$('.tab').forEach(t => t.addEventListener('click', () => {
  setInspectorTab(t.dataset.tab);
  if (t.dataset.tab === 'sample') renderWaveform();
  if (t.dataset.tab === 'env') renderADSR();
}));

// ---------- sample actions ----------
$('#reverseBtn').onclick = () => {
  const slot = currentSlot();
  slot.reverse = !slot.reverse;
  if (slot.reverse) {
    // The original A/D/R decays before the reversed transient (which lives at
    // the end of the buffer), so a reversed one-shot would be almost silent.
    // Open the whole reversed buffer at full level; keep the forward envelope
    // so toggling back does not change the sound.
    slot._forwardEnv = {
      adsr: { ...slot.adsr },
      envPts: (slot.envPts || []).map(q => ({ ...q })),
      fadeIn: slot.fadeIn,
      fadeOut: slot.fadeOut,
    };
    const total = envTotalMs();
    slot.adsr = { a: 0, d: 0, end: total, s: 1, p: 1, e: 1 };
    slot.envPts = [];
    slot.fadeIn = 0; slot.fadeOut = 0;
  } else if (slot._forwardEnv) {
    slot.adsr = { ...slot._forwardEnv.adsr };
    slot.envPts = slot._forwardEnv.envPts || [];
    slot.fadeIn = slot._forwardEnv.fadeIn;
    slot.fadeOut = slot._forwardEnv.fadeOut;
    delete slot._forwardEnv;
  }
  $('#reverseBtn').classList.toggle('on', slot.reverse);
  renderWaveform();
  renderADSR();
  toast(slot.reverse ? 'Sample reversed · full envelope' : 'Sample forward');
};

function animateMaster() {
  const m = $('#masterMeter');
  if (!m) return;
  const t0 = performance.now();
  const step = now => {
    const t = (now - t0) / 900;
    if (t >= 1) { m.style.width = '0%'; return; }
    m.style.width = clamp(18 + 78 * Math.abs(Math.sin(t * Math.PI * 3)) * (1 - t * .4), 0, 100) + '%';
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}


// ---------- detector ----------
const DET = [
  { key: 'attack',    label: 'ATTACK',    min: 0,   max: 200, val: .5,    unit: 'ms', fmt: v => fmtMs(v), step: .1, decimals: 1, group: 'gate',
    tip: 'GATE ATTACK · time for the gate to open on each detected hit' },
  { key: 'hold',      label: 'HOLD',      min: 0,   max: 500, val: 30,     unit: 'ms', fmt: v => fmtMs(v), step: 1,  decimals: 0, group: 'gate',
    tip: 'GATE HOLD · time the gate stays open after attack' },
  { key: 'release',   label: 'RELEASE',   min: 5,   max: 2000, val: 150,   unit: 'ms', fmt: v => fmtMs(v), step: 1,  decimals: 0, group: 'gate',
    tip: 'GATE RELEASE · time for the gate to close after hold' },
  { key: 'input',     label: 'VOLUME',    min: -24, max: 24,  val: 0,     unit: 'dB', fmt: v => fmtDb(v), step: .1, decimals: 1, group: 'input',
    tip: 'INPUT VOLUME · level that feeds the meter, the detector and the sample velocity' },
  { key: 'supp',      label: 'SUPPRESS',  min: 0,   max: 100, val: 0,     unit: '%',  fmt: v => Math.round(v) + '%', group: 'input',
    tip: 'SUPPRESS · leakage suppression' },
  { key: 'low',       label: 'LOWCUT',    min: 20,  max: 20000, val: 20,  log: true, unit: 'Hz', fmt: v => fmtHz(v), group: 'filter',
    tip: 'LOWCUT · detection filter only; does not alter the dry audio' },
  { key: 'high',      label: 'HIGHCUT',   min: 20,  max: 20000, val: 20000, log: true, unit: 'Hz', fmt: v => fmtHz(v), group: 'filter',
    tip: 'HIGHCUT · detection filter only; does not alter the dry audio' },
  { key: 'detail',    label: 'DETAIL',    min: 0,   max: 100, val: 14,    unit: '%',  fmt: v => Math.round(v) + '%', group: 'detect',
    tip: 'DETAIL · detection threshold. Higher = ignores bleed; lower = catches ghost notes; 100% sits above every transient' },
  { key: 'retrig',    label: 'RETRIGGER', min: 0,   max: 1000, val: 30,    unit: 'ms', fmt: v => Math.round(v) + ' ms', group: 'detect',
    tip: 'RETRIGGER · blind time after each hit. After it, anything still above DETAIL fires again: 0 ms = flams' },
  { key: 'sens',      label: 'SENSITIVITY',min: 0,  max: 100, val: 51,    unit: '%',  fmt: v => Math.round(v) + '%', group: 'detect',
    tip: 'SENSITIVITY · dynamic range of the triggered samples. Low = fixed level, high = wide dynamics' }
];

const knobReg = {};
function makeKnob(cfg) {
  const el = document.createElement('div');
  el.className = 'knob';
  el.dataset.key = cfg.key;
  el.innerHTML = `<div class="knob-dial"><div class="knob-ind"></div></div><div class="knob-label">${cfg.label}</div><div class="knob-val"></div>`;
  if (cfg.tip) el.title = cfg.tip;
  const dial = $('.knob-dial', el), ind = $('.knob-ind', el), val = $('.knob-val', el);
  const toNorm = v => cfg.log
    ? (Math.log(v) - Math.log(cfg.min)) / (Math.log(cfg.max) - Math.log(cfg.min))
    : (v - cfg.min) / (cfg.max - cfg.min);
  const fromNorm = n => cfg.log
    ? Math.exp(lerp(Math.log(cfg.min), Math.log(cfg.max), n))
    : lerp(cfg.min, cfg.max, n);
  let v = cfg.val;
  const render = () => {
    ind.style.transform = `translateX(-50%) rotate(${-135 + 270 * toNorm(v)}deg)`;
    val.textContent = cfg.fmt(v);
    state.detector[cfg.key] = v;
    if (window.__TU_NATIVE__ && window.__TU_sendDetector) window.__TU_sendDetector(cfg.key, v);
    if (cfg.key === 'input' && inputGain) inputGain.gain.value = dbToAmp(v);
    if (audioReady && ['sens', 'retrig', 'detail', 'supp', 'low', 'high', 'input', 'attack', 'hold', 'release'].includes(cfg.key)) {
      scheduleDetect();
    }
  };
  render();
  bindNumericEdit(val, {
    get: () => v,
    set: nv => { v = nv; render(); },
    min: cfg.min, max: cfg.max,
    step: cfg.step != null ? cfg.step : (cfg.unit === 'dB' ? .1 : 1),
    unit: cfg.unit,
    decimals: cfg.decimals != null ? cfg.decimals : (cfg.unit === 'dB' ? 1 : 0),
    default: cfg.val,
  });
  let sy = 0, sn = 0, group = null, knobMoved = false;
  knobReg[cfg.key] = { getNorm: () => toNorm(v), setNorm: n => { v = fromNorm(clamp(n, 0, 1)); render(); } };
  dial.addEventListener('pointerdown', e => {
    if (e.altKey) return;
    e.preventDefault();
    multiSel.scope = 'knobs';
    if (finderClick('knobs', cfg.key, e, knobOrder)) { applyKnobSelClasses(); return; }
    if (!multiSel.knobs.has(cfg.key)) { multiSel.knobs = new Set(); applyKnobSelClasses(); }
    // Selected knobs turn together: the same normalized move on each.
    group = multiSel.knobs.size > 1
      ? [...multiSel.knobs].map(k => ({ k, n0: knobReg[k].getNorm() }))
      : null;
    sy = e.clientY; sn = toNorm(v); knobMoved = false;
    dial.setPointerCapture(e.pointerId);
  });
  dial.addEventListener('pointerup', () => {
    if (group && !knobMoved) { multiSel.knobs = new Set(); applyKnobSelClasses(); }
    group = null;
  });
  el.addEventListener('click', e => {
    if (!e.altKey) return;
    e.preventDefault(); e.stopPropagation();
    if (val._numReset) val._numReset();
  });
  dial.addEventListener('pointermove', e => {
    if (!dial.hasPointerCapture(e.pointerId)) return;
    const dn = (sy - e.clientY) / 110;
    if (Math.abs(sy - e.clientY) > 1) knobMoved = true;
    if (group) { group.forEach(g => knobReg[g.k].setNorm(g.n0 + dn)); return; }
    v = fromNorm(clamp(sn + dn, 0, 1)); render();
  });
  return el;
}
(function renderDetectorKnobs() {
  const target = { gate: '#detKnobsGate', input: '#detKnobsInput', filter: '#detKnobsFilter', detect: '#detKnobsDetect' };
  DET.forEach(c => { const host = $(target[c.group]); if (host) host.appendChild(makeKnob(c)); });
})();
// Marquee over the detector: drag on any empty spot of the panel.
$('#detectorPanel').addEventListener('pointerdown', e => {
  if (e.button !== 0 || e.altKey) return;
  if (e.target.closest('.knob, button, canvas, .det-wave, input, select, .dm-track-wrap, .num-editable')) return;
  e.preventDefault();
  startMarquee(e, { scope: 'knobs',
    items: () => [...document.querySelectorAll('#detectorPanel .knob[data-key]')].map(el => ({ el: el.querySelector('.knob-dial') || el, id: el.dataset.key })),
    onChange: applyKnobSelClasses });
});

function updateGateButton() {
  const btn = $('#gateBtn');
  if (!btn) return;
  btn.classList.toggle('on', state.detector.gate);
  btn.textContent = state.detector.gate ? 'ON' : 'OFF';
}
$('#gateBtn').onclick = () => setGate(!state.detector.gate);
function setGate(on, silent) {
  state.detector.gate = !!on;
  updateGateButton();
  if (rtNode && inputPlaying) postDetectorParams();
  else { detectInputHits(); if (inputPlaying) rescheduleGate(); }
  if (!silent && state.detector.gate && state.detector.mix >= 99) toast('GATE applies to the original input — lower MIX to hear it');
  if (window.__TU_NATIVE__ && window.__TU_sendMaster) window.__TU_sendMaster('gateOn', state.detector.gate ? 1 : 0);
}
window.__TU_setGate = on => {
  window.__TU_applyingNative = true;
  setGate(on, true);
  window.__TU_applyingNative = false;
};
updateGateButton();
function applyMix() {
  const m = clamp(state.detector.mix, 0, 100) / 100;
  if (wetGain) wetGain.gain.value = m;
  if (dryGain) dryGain.gain.value = 1 - m;
}
(function initMixKnob() {
  const knob = $('#mixKnob');
  if (!knob) return;
  const ind = $('.knob-ind', knob);
  const val = $('#mixVal');
  const set = v => {
    state.detector.mix = clamp(v, 0, 100);
    const n = state.detector.mix / 100;
    ind.style.transform = `translateX(-50%) rotate(${-135 + 270 * n}deg)`;
    val.textContent = Math.round(state.detector.mix) + '%';
    applyMix();
    if (window.__TU_NATIVE__ && window.__TU_sendMaster) window.__TU_sendMaster('mix', state.detector.mix);
  };
  set(state.detector.mix);
  window.__TU_setMix = v => {
    window.__TU_applyingNative = true;
    set(v);
    window.__TU_applyingNative = false;
  };
  let sy = 0, sn = 0;
  knob.addEventListener('pointerdown', e => {
    if (e.altKey) return;
    e.preventDefault(); sy = e.clientY; sn = state.detector.mix / 100;
    knob.setPointerCapture(e.pointerId);
  });
  knob.addEventListener('click', e => {
    if (!e.altKey) return;
    e.preventDefault(); e.stopPropagation();
    if (val._numReset) val._numReset();
  });
  knob.addEventListener('pointermove', e => {
    if (!knob.hasPointerCapture(e.pointerId)) return;
    set(clamp(sn + (sy - e.clientY) / 110, 0, 1) * 100);
  });
  bindNumericEdit(val, {
    get: () => state.detector.mix,
    set: v => set(v),
    min: 0, max: 100, step: 1, unit: '%', decimals: 0, default: 100,
  });
})();

// ---------- detector signal flow: gate → input trim → filters → detect ----------
// The gate is PRE-input-volume. It reads the raw source, creates a gain envelope,
// and that envelope is applied to the dry path and to the detection signal.
function biquadCoeffs(type, f0, sr, q = 0.70710678) {
  const w0 = 2 * Math.PI * clamp(f0, 10, sr * 0.49) / sr;
  const cos = Math.cos(w0), sin = Math.sin(w0);
  const alpha = sin / (2 * q);
  let b0, b1, b2;
  if (type === 'hp') { b0 = (1 + cos) / 2; b1 = -(1 + cos); b2 = (1 + cos) / 2; }
  else { b0 = (1 - cos) / 2; b1 = 1 - cos; b2 = (1 - cos) / 2; }
  const a0 = 1 + alpha, a1 = -2 * cos, a2 = 1 - alpha;
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}
function applyBiquad(data, c) {
  const out = new Float32Array(data.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < data.length; i++) {
    const x = data[i];
    const y = c.b0 * x + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y; out[i] = y;
  }
  return out;
}
let detectPending = 0;
function scheduleDetect() {
  // Live: the detector reads the new values on the next audio sample.
  if (rtNode && inputPlaying) { postDetectorParams(); return; }
  if (detectPending) return;
  detectPending = setTimeout(() => {
    detectPending = 0;
    detectInputHits();
    if (inputPlaying) rescheduleGate();
  }, 40);
}
function filterDetection(data, sr) {
  const low = state.detector.low, high = state.detector.high;
  if (low <= 20 && high >= 20000) return data;
  let out = data;
  if (low > 20) out = applyBiquad(out, biquadCoeffs('hp', low, sr));
  if (high < 20000) out = applyBiquad(out, biquadCoeffs('lp', high, sr));
  return out;
}
const DETAIL_MAX = 1.5;
function detailThreshold() {
  return (clamp(state.detector.detail, 0, 100) / 100) * DETAIL_MAX;
}
const METER_INSET = 4; // keep the 0 dB and -48 dB labels inside the track
function meterPct(db) {
  return METER_INSET + clamp((clamp(db, -48, 0) + 48) / 48, 0, 1) * (100 - METER_INSET * 2);
}
function detailFrac() {
  return clamp(state.detector.detail, 0, 100) / 100;
}
function gainReductionPct(gateV) {
  if (!state.detector.gate) return 0;
  const db = -20 * Math.log10(Math.max(gateV, .001));
  return clamp(db / 24 * 100, 0, 100);
}
// 1 ms block peaks feed the gate, the input meter and the threshold. They
// only depend on the input volume, so Detail/attack/hold/release changes reuse
// this cache instead of rescanning the whole file (important on the 2 min
// real input).
function computeInputBlockPeaks() {
  if (!realInputBuffer) {
    realInputBlockPeaks = null; realInputBlockPeaksKey = null;
    realInputPeakEnv = null; realInputPeakBlock = 0;
    realGateBlock = 0;
    return null;
  }
  const key = String(state.detector.input);
  if (realInputBlockPeaks && realInputBlockPeaksKey === key) return realInputBlockPeaks;
  const raw = realInputBuffer.getChannelData(0);
  const sr = realInputBuffer.sampleRate;
  const volAmp = dbToAmp(state.detector.input);
  const block = Math.max(1, Math.round(sr * 0.001));
  const n = Math.ceil(raw.length / block);
  const peaks = new Float32Array(n);
  for (let b = 0; b < n; b++) {
    let peak = 0;
    const start = b * block, finish = Math.min(raw.length, start + block);
    for (let i = start; i < finish; i++) {
      const a = Math.abs(raw[i]) / realInputMax * volAmp;
      if (a > peak) peak = a;
    }
    peaks[b] = peak;
  }
  realInputBlockPeaks = peaks;
  realInputBlockPeaksKey = key;
  realInputPeakBlock = block;
  return peaks;
}

// The gate is a standard threshold gate on the original input, like C1 Gate:
// the arrow on the input meter sets the threshold and attack/hold/release shape
// the gain reduction. Detection stays independent (Detail/Sensitivity/Retrigger).
function computeGateEnvFromInput() {
  if (!state.detector.gate || !realInputBuffer) { realGateEnv = null; realGateBlock = 0; return null; }
  const peaks = computeInputBlockPeaks();
  if (!peaks) { realGateEnv = null; realGateBlock = 0; return null; }
  const sr = realInputBuffer.sampleRate;
  const thr = dbToAmp(state.detector.gateThreshold);
  const block = realInputPeakBlock;
  const n = peaks.length;
  const env = new Float32Array(n);
  // Peak detector with an 8 ms release (Slate CLEAN-style). Raw 1 ms peak
  // blocks chatter on the body of a drum when RELEASE is short; this keeps the
  // detector open through the hit without adding latency.
  const det = new Float32Array(n);
  const detDecay = Math.exp(-(block / sr) / 0.008);
  let detLevel = 0;
  for (let b = 0; b < n; b++) {
    detLevel = Math.max(peaks[b], detLevel * detDecay);
    det[b] = detLevel;
  }
  const atk = Math.max(0, state.detector.attack / 1000);
  const hold = Math.max(0, state.detector.hold / 1000);
  // Slate clamps its release to a 5 ms minimum; a 0 ms release would step the
  // gain to zero and read as a click/flam.
  const rel = Math.max(0.005, state.detector.release / 1000);
  const dt = block / sr;
  // 4 dB of hysteresis: once open, the detector must fall this far below the
  // threshold before the gate can start closing. Removes flutter around it.
  const closeThr = thr * dbToAmp(-4);
  let gain = 0, holdLeft = 0, openLatch = false;
  for (let b = 0; b < n; b++) {
    // Open one block early so ATTACK 0 never clips the first samples.
    const next = b + 1 < n ? det[b + 1] : 0;
    const open = det[b] >= (openLatch ? closeThr : thr) || next >= thr;
    if (open) { openLatch = true; holdLeft = hold; }
    else openLatch = false;
    const target = (openLatch || holdLeft > 0) ? 1 : 0;
    if (!openLatch && holdLeft > 0) holdLeft = Math.max(0, holdLeft - dt);
    if (target > 0 && atk <= 0) gain = 1;
    else if (target <= 0 && rel <= 0) gain = 0;
    else {
      const tau = target > gain ? atk : rel;
      if (tau <= 0) gain = target;
      else gain += (target - gain) * (1 - Math.exp(-dt / tau));
    }
    env[b] = gain;
  }
  realGateEnv = env;
  realGateBlock = block;
  return env;
}
function computeInputPeakEnv() {
  const peaks = computeInputBlockPeaks();
  if (!peaks) { realInputPeakEnv = null; realInputPeakBlock = 0; return null; }
  // Shared with the gate cache; the meter clamps each value to 0 dBFS.
  realInputPeakEnv = peaks;
  return peaks;
}
function setGateThreshold(v, auto = false) {
  // Any threshold set by hand ends AUTO learning for good.
  if (!auto && state.detector.gateAuto === 'learn') setGateAuto('manual');
  state.detector.gateThreshold = clamp(v, -48, 0);
  const btn = $('#gateThresh');
  if (btn) btn.style.bottom = meterPct(state.detector.gateThreshold).toFixed(2) + '%';
  const lab = $('#gateThreshVal');
  if (lab) lab.textContent = fmtDb(state.detector.gateThreshold);
  scheduleDetect();
}

(function initGateThreshold() {
  const btn = $('#gateThresh');
  if (!btn) return;
  setGateThreshold(state.detector.gateThreshold, true);
  setGateAuto(state.detector.gateAuto || 'learn');
  btn.addEventListener('pointerdown', e => {
    if (e.altKey) return;
    e.preventDefault(); e.stopPropagation();
    const wrap = btn.parentElement;
    const rect = wrap.getBoundingClientRect();
    const move = ev => {
      const pct = clamp((rect.bottom - ev.clientY) / Math.max(1, rect.height), 0, 1);
      setGateThreshold(-48 + pct * 48);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });
  btn.addEventListener('click', e => {
    if (!e.altKey) return;
    e.preventDefault(); e.stopPropagation();
    setGateThreshold(-24, true);
    rearmGateAuto();
  });
  bindNumericEdit($('#gateThreshVal'), {
    get: () => state.detector.gateThreshold,
    set: v => setGateThreshold(v),
    onReset: rearmGateAuto,
    min: -48, max: 0, step: .5, unit: 'dB', decimals: 1, default: -24,
  });
})();

// ---------- GATE AUTO THRESHOLD ----------
// 'learn' (default): the first time the INPUT plays, the threshold glides to
// the gap between the bleed and the real hits while the audio is heard (it
// only uses what has already played, like the plugin would). When that first
// first ideal point is found it keeps refining for GATE_AUTO_SETTLE_S seconds
// of play and then locks ('locked'), even if the INPUT keeps playing (or
// earlier, if you stop). After that it never moves unless you move it by hand
// ('manual'). Alt+click on the arrow or the
// value resets to −24 dB and re-arms the learning.
// How: 10 ms peak windows of the input (post-VOLUME, pre-gate, the meter's
// scale) → local maxima at least 6 dB over the median floor → Otsu split of
// their levels in dB into "bleed" and "hits" → threshold halfway between the
// loudest bleed (p95) and the quietest hits (p5). If they overlap, the hits
// win: 3 dB under the quietest hit.
const GATE_AUTO_MIN_HITS = 8;
const GATE_AUTO_SETTLE_S = 5; // seconds of play after the first ideal point
let gateAutoTimer = 0, gateAutoReady = false, gateAutoHeard = 0, gateAutoReadyAt = 0;
function gateAutoIdeal(upToSec) {
  const peaks = computeInputBlockPeaks();
  if (!peaks || !(upToSec > 0)) return null;
  const n = Math.min(peaks.length, Math.floor(upToSec * 1000));
  const W = 10, m = Math.floor(n / W);
  if (m < 100) return null;
  const db = x => 20 * Math.log10(Math.max(x, 1e-6));
  const w = new Float32Array(m);
  for (let i = 0; i < m; i++) { let p = 0; for (let j = i * W; j < i * W + W; j++) p = Math.max(p, peaks[j]); w[i] = p; }
  const floor = db(Float32Array.from(w).sort()[Math.floor(.5 * (m - 1))]);
  const lm = [];
  for (let i = 6; i < m - 6; i++) {
    let top = true;
    for (let k = -6; k <= 6; k++) if (w[i + k] > w[i]) { top = false; break; }
    if (top) { const d = db(w[i]); if (d > floor + 6) { lm.push(d); i += 6; } }
  }
  if (lm.length < 4) return null;
  lm.sort((a, b) => a - b);
  const N = lm.length, tot = lm.reduce((a, b) => a + b, 0);
  let best = -1, split = 1, s0 = 0;
  for (let i = 1; i < N; i++) {
    s0 += lm[i - 1];
    const w0 = i / N, m0 = s0 / i, m1 = (tot - s0) / (N - i);
    const v = w0 * (1 - w0) * (m0 - m1) ** 2;
    if (v > best) { best = v; split = i; }
  }
  const lo = lm.slice(0, split), hi = lm.slice(split);
  if (hi.length < GATE_AUTO_MIN_HITS) return null;
  const loTop = lo[Math.floor(.95 * (lo.length - 1))], hiBot = hi[Math.floor(.05 * (hi.length - 1))];
  const thr = hiBot > loTop ? (loTop + hiBot) / 2 : hiBot - 3;
  return Math.round(clamp(Math.max(thr, floor + 6), -48, 0) * 2) / 2;
}
function setGateAuto(st) {
  state.detector.gateAuto = st;
  const tag = $('#gateAutoTag');
  if (tag) {
    tag.classList.toggle('on', st === 'learn');
    tag.title = st === 'learn'
      ? 'AUTO THRESHOLD: the first time you play the INPUT the threshold moves to the gap between bleed and hits, then locks'
      : '';
  }
  const btn = $('#gateThresh');
  if (btn) btn.classList.toggle('auto', st === 'learn');
}
function rearmGateAuto() {
  stopGateAutoTimer();
  setGateAuto('learn');
  if (inputPlaying) startGateAuto();
  toast('GATE AUTO THRESHOLD re-armed · it learns on the next listen');
}
function stopGateAutoTimer() { if (gateAutoTimer) clearInterval(gateAutoTimer); gateAutoTimer = 0; }
function startGateAuto() {
  stopGateAutoTimer();
  if (state.detector.gateAuto !== 'learn') return;
  gateAutoReady = false; gateAutoHeard = 0; gateAutoReadyAt = 0;
  gateAutoTimer = setInterval(() => {
    if (!inputPlaying || !audioCtx || state.detector.gateAuto !== 'learn') return;
    const heard = clamp(audioCtx.currentTime - inputStartCtxTime - (rtNode ? RT_LOOKAHEAD : 0), 0, realInputDuration);
    gateAutoHeard = heard;
    const ideal = gateAutoIdeal(heard);
    if (ideal == null) return;
    if (!gateAutoReady) { gateAutoReady = true; gateAutoReadyAt = heard; }
    const cur = state.detector.gateThreshold;
    // glide instead of jumping, so the arrow is seen moving into place
    setGateThreshold(Math.abs(ideal - cur) < .5 ? ideal : cur + (ideal - cur) * .35, true);
    if (heard - gateAutoReadyAt >= GATE_AUTO_SETTLE_S) finishGateAuto();
  }, 250);
}
// Called when the INPUT stops: the first full listen locks the threshold.
function finishGateAuto() {
  if (!gateAutoTimer) return;
  stopGateAutoTimer();
  if (state.detector.gateAuto !== 'learn' || !gateAutoReady) return;
  const ideal = gateAutoIdeal(gateAutoHeard);
  if (ideal != null) setGateThreshold(ideal, true);
  setGateAuto('locked');
  toast(`GATE AUTO THRESHOLD · ${fmtDb(state.detector.gateThreshold)} · locked`);
}
function gateValueAt(t) {
  if (!state.detector.gate || !realGateEnv || !realInputDuration) return 1;
  const idx = clamp(Math.floor(t / realInputDuration * realGateEnv.length), 0, realGateEnv.length - 1);
  return realGateEnv[idx];
}
// ---------- real-time detector (AudioWorklet) ----------
// The whole INPUT DETECTOR runs live on the audio thread, sample by sample, on
// the audio that is playing: every control change applies to the next sample
// and nothing is precomputed over the file. Hits come back as messages and the
// slots are scheduled on the onset of the (lookahead-delayed) dry input.
function initDetectorWorklet(ctx) {
  if (!ctx.audioWorklet || typeof AudioWorkletNode === 'undefined') return;
  ctx.audioWorklet.addModule('detector-worklet.js?v=208').then(() => {
    if (ctx !== audioCtx) return;
    const node = new AudioWorkletNode(ctx, 'tu-detector', {
      numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2],
      processorOptions: { lookahead: RT_LOOKAHEAD },
    });
    node.port.onmessage = e => onDetectorMessage(e.data);
    if (inputPlaying) stopInput();
    try { inputGain.disconnect(gateGain); } catch (e) {}
    inputGain.connect(node).connect(gateGain);
    rtNode = node;
    postDetectorParams();
  }).catch(e => console.warn('real-time detector unavailable, using precomputed fallback:', e));
}
function postDetectorParams() {
  if (!rtNode) return;
  const d = state.detector;
  rtNode.port.postMessage({ type: 'params', p: {
    gate: !!d.gate, gateThreshold: d.gateThreshold, attack: d.attack, hold: d.hold, release: d.release,
    detail: d.detail, supp: d.supp, retrig: d.retrig, low: d.low, high: d.high,
    norm: 1 / (realInputMax || 1),
  } });
}
function liveGateAt(t) {
  if (!liveGate) return 1;
  const b = Math.floor(t * 1000);
  return b >= 0 && b <= liveKnownBlock ? liveGate[b] : 1;
}
function onDetectorMessage(m) {
  if (!m || !inputPlaying || !audioCtx) return;
  if (m.type === 'blocks') {
    if (!liveGate || m.from < 0) return;
    const n = Math.min(m.gate.length, liveGate.length - m.from);
    if (n <= 0) return;
    liveGate.set(m.gate.subarray(0, n), m.from);
    livePeak.set(m.peak.subarray(0, n), m.from);
    liveKnownBlock = Math.max(liveKnownBlock, m.from + n - 1);
    return;
  }
  if (m.type !== 'hit') return;
  realHits.push({ time: m.time, peak: m.peak, peakTime: m.peakTime, velocity: m.velocity });
  const el = $('#triggerCount'); if (el) el.textContent = String(realHits.length);
  const now = audioCtx.currentTime;
  // A hit that arrives after its onset was already heard is not dumped late.
  if (m.out < now - 0.03) { rtLate++; return; }
  const when = Math.max(0, m.out - now - 0.02);
  const velocity = clamp(m.velocity, 0, 2);
  liveLastVelocity = velocity;
  liveLastHitTime = m.time;
  liveTriggerCount++;
  inputTimers.push(setTimeout(() => {
    const hv = $('#hitVel');
    if (hv && inputPlaying) hv.textContent = Math.round(velocity * 100) + '%';
  }, Math.max(0, (m.out - now) * 1000)));
  state.slots.forEach((_, i) => playSlot(i, when, velocity, m.time, m.out));
}
function scheduleGate(startTime) {
  if (!gateGain || !audioCtx) return;
  gateGain.gain.cancelScheduledValues(audioCtx.currentTime);
  gateGain.gain.setValueAtTime(1, audioCtx.currentTime);
  if (!state.detector.gate || !realGateEnv || !realInputBuffer) return;
  const blockDur = realGateBlock / realInputBuffer.sampleRate;
  // setValueCurveAtTime spreads N points over N-1 intervals: (N-1)*blockDur
  // keeps env[b] exactly at startTime + b*blockDur for the whole track.
  const duration = Math.max(1, realGateEnv.length - 1) * blockDur;
  try {
    gateGain.gain.setValueCurveAtTime(realGateEnv, startTime, duration);
    return;
  } catch (e) {}
  gateGain.gain.setValueAtTime(realGateEnv[0], startTime);
  for (let b = 1; b < realGateEnv.length; b++) {
    gateGain.gain.linearRampToValueAtTime(realGateEnv[b], startTime + b * blockDur);
  }
}
const GATE_GLIDE = 0.008; // 8 ms de-click when the gate is toggled while the dry input plays
function rescheduleGate() {
  if (!gateGain || !audioCtx) return;
  const now = audioCtx.currentTime;
  const current = Number.isFinite(gateGain.gain.value) ? gateGain.gain.value : 1;
  // cancelAndHold preserves the instantaneous value of a running value curve;
  // cancelScheduledValues alone can leave the curve running under the new one.
  if (gateGain.gain.cancelAndHoldAtTime) gateGain.gain.cancelAndHoldAtTime(now);
  else {
    gateGain.gain.cancelScheduledValues(now);
    gateGain.gain.setValueAtTime(current, now);
  }
  if (!state.detector.gate || !realGateEnv || !realInputBuffer) {
    gateGain.gain.setValueAtTime(current, now);
    gateGain.gain.linearRampToValueAtTime(1, now + GATE_GLIDE);
    return;
  }
  const blockDur = realGateBlock / realInputBuffer.sampleRate;
  // Re-enter the envelope ON the input timeline: the first new curve point is
  // the first block boundary after the glide, placed at that block's real time
  // (inputStart + idx*blockDur). Previously the curve for 'now' started 8 ms
  // later, so after any knob move the gate ran 8 ms behind the audio and cut
  // the attack of every hit.
  const startIdx = clamp(Math.ceil((now + GATE_GLIDE - inputStartCtxTime) / blockDur), 0, realGateEnv.length - 1);
  const curveStart = inputStartCtxTime + startIdx * blockDur;
  const curve = realGateEnv.subarray(startIdx);
  gateGain.gain.setValueAtTime(current, now);
  gateGain.gain.linearRampToValueAtTime(realGateEnv[startIdx], curveStart);
  if (curve.length < 2) return;
  try {
    gateGain.gain.setValueCurveAtTime(curve, curveStart, (curve.length - 1) * blockDur);
    return;
  } catch (e) {}
  for (let b = startIdx + 1; b < realGateEnv.length; b++) {
    gateGain.gain.linearRampToValueAtTime(realGateEnv[b], inputStartCtxTime + b * blockDur);
  }
}

// ---------- input waveform (animated) ----------
const inputCanvas = $('#inputWave');
let inW = 1, inH = 1, scan = 0, lastT = 0, hits = 0, lastScan = 0, flashT = 0;
const transientAt = [.10, .27, .44, .62, .80, .93];
const transientAmp = [1, .72, .9, .62, .84, .58];

function resizeInput() {
  const host = inputCanvas.parentElement;
  inW = Math.max(10, host.clientWidth); inH = Math.max(10, host.clientHeight);
  const dpr = window.devicePixelRatio || 1;
  inputCanvas.width = Math.round(inW * dpr);
  inputCanvas.height = Math.round(inH * dpr);
  inputCanvas.style.width = inW + 'px'; inputCanvas.style.height = inH + 'px';
  inputCanvas.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
}

function drawInput(now) {
  if (realInputBuffer) { drawRealInput(now); return; }
  // Native mode: the C++ engine owns the input. Do not animate a synthetic
  // waveform; draw a flat line until the engine sends real data.
  if (window.__TU_NATIVE__) {
    const ctx = inputCanvas.getContext('2d');
    ctx.clearRect(0, 0, inW, inH);
    const y = inH / 2;
    ctx.strokeStyle = 'rgba(126,138,160,.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(inW, y);
    ctx.stroke();
    ctx.fillStyle = 'rgba(126,138,160,.75)';
    ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('INPUT DEL HOST', inW / 2, y - 8);
    return;
  }
  const dt = lastT ? Math.min(.05, (now - lastT) / 1000) : 0;
  lastT = now;
  scan = (scan + dt / 2.6) % 1;

  const ctx = inputCanvas.getContext('2d');
  ctx.clearRect(0, 0, inW, inH);
  const mid = inH / 2, amp = Math.max(10, mid - 6);
  const waveAmp = amp / DETAIL_MAX;
  const volAmp = dbToAmp(state.detector.input);
  const detailThr = detailThreshold();
  const gateOn = state.detector.gate;
  const atk = state.detector.attack / 1000;
  const hold = state.detector.hold / 1000;
  const rel = state.detector.release / 1000;

  const envAt = t => {
    let v = .05;
    for (let k = 0; k < transientAt.length; k++) {
      const d = t - transientAt[k];
      if (d >= 0) v = Math.max(v, transientAmp[k] * Math.exp(-d / .035));
    }
    return v;
  };
  const synthGateAt = t => {
    if (!gateOn) return 1;
    let g = 0;
    for (let k = 0; k < transientAt.length; k++) {
      const d = t - transientAt[k];
      if (d < 0) continue;
      let v = 0;
      if (d < atk) v = atk > 0 ? d / atk : 1;
      else if (d < atk + hold) v = 1;
      else if (d < atk + hold + rel) v = rel > 0 ? 1 - (d - atk - hold) / rel : 0;
      else continue;
      if (v > g) g = v;
    }
    return g;
  };
  const rawPeak = t => Math.min(1, envAt(t) * volAmp);
  const postPeak = t => rawPeak(t) * (gateOn ? synthGateAt(t) : 1);
  const trace = peakFn => {
    ctx.beginPath();
    for (let x = 0; x <= inW; x++) {
      const t = x / inW;
      const y = mid - peakFn(t) * waveAmp;
      x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    for (let x = inW; x >= 0; x--) {
      const t = x / inW;
      ctx.lineTo(x, mid + peakFn(t) * waveAmp * .65);
    }
    ctx.closePath();
  };
  trace(postPeak);
  ctx.fillStyle = 'rgba(118,190,255,.40)';
  ctx.fill();
  trace(postPeak);
  ctx.strokeStyle = 'rgba(255,255,255,.22)';
  ctx.lineWidth = 1;
  ctx.stroke();
  trace(rawPeak);
  ctx.fillStyle = 'rgba(255,105,105,.075)';
  ctx.fill();
  trace(rawPeak);
  ctx.strokeStyle = 'rgba(255,125,125,.28)';
  ctx.lineWidth = .8;
  ctx.stroke();

  const dy = mid - detailFrac() * amp;
  ctx.setLineDash([3, 3]);
  ctx.strokeStyle = 'rgba(45,226,197,.52)';
  ctx.beginPath(); ctx.moveTo(0, dy); ctx.lineTo(inW, dy); ctx.stroke();
  ctx.setLineDash([]);
  ctx.font = '600 7px ui-monospace, Menlo, monospace';
  if (inW > 150) {
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(45,226,197,.72)';
    ctx.fillText('DETAIL', inW - 3, Math.max(9, Math.min(inH - 4, dy - 3)));
  }

  for (let k = 0; k < transientAt.length; k++) {
    const x = transientAt[k] * inW;
    const peak = Math.max(.04, postPeak(transientAt[k]));
    const top = mid - peak * waveAmp;
    const bottom = mid + peak * waveAmp * .65;
    ctx.strokeStyle = 'rgba(255,150,90,.4)';
    ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom); ctx.stroke();
    ctx.fillStyle = 'rgba(255,150,90,.8)';
    ctx.beginPath();
    ctx.moveTo(x, top - 4); ctx.lineTo(x - 3, top + 2); ctx.lineTo(x + 3, top + 2);
    ctx.closePath(); ctx.fill();
  }
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(255,255,255,.32)';
  ctx.fillText('2.6 s', inW - 3, inH - 4);
  ctx.textAlign = 'left';

  const sx = scan * inW;
  ctx.strokeStyle = 'rgba(45,226,197,.75)';
  ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, inH); ctx.stroke();

  for (let k = 0; k < transientAt.length; k++) {
    const ti = transientAt[k];
    if (lastScan < ti && scan >= ti) {
      hits++;
      flashT = now;
      $('#triggerCount').textContent = String(hits);
    }
  }
  lastScan = scan;

  const led = $('#hitLed');
  if (led) led.classList.toggle('on', now - flashT < 130);
  const gateV = synthGateAt(scan);
  const gled = $('#gateLed');
  if (gled) gled.classList.toggle('on', gateOn && gateV > .5);
  const gr = $('#grMeterBar');
  if (gr) gr.style.height = (gateOn ? gainReductionPct(gateV) : 0) + '%';
  inputMeterHold = Math.max(Math.min(1, envAt(scan) * volAmp), inputMeterHold * METER_HOLD);
  const lvl = Math.round(20 * Math.log10(Math.max(inputMeterHold, .001)));
  const dbTxt = (lvl >= 0 ? '+' : '') + Math.max(-48, lvl);
  const il = $('#inputLevel');
  if (il) il.textContent = dbTxt + ' dB';
  const ip = $('#inputPeakDb');
  if (ip) ip.textContent = dbTxt;
  const imb = $('#inputMeterBar');
  if (imb) imb.style.height = meterPct(lvl) + '%';
}
let inputRAF = null;
function startInputLoop() {
  if (inputRAF) return;
  if (window.__TU_NATIVE__) { drawInput(performance.now()); return; }
  const loop = now => { drawInput(now); inputRAF = requestAnimationFrame(loop); };
  inputRAF = requestAnimationFrame(loop);
}
function stopInputLoop() {
  if (inputRAF) cancelAnimationFrame(inputRAF);
  inputRAF = null;
}

// ---------- top actions ----------
$('#flipAll').onclick = () => {
  state.slots.forEach(s => { s.polarity = !s.polarity; });
  renderSlots();
  syncAllSlotAudio();
  if ($('.inspector').classList.contains('show')) updateInspector();
  setSettingsOpen(false);
  toast('Polarity flipped on all 8 slots (180°)');
};

// ---------- master output knob ----------
let masterOut = 0;
(function initMasterKnob() {
  const knob = $('#masterOutKnob');
  const ind = $('.knob-ind', knob);
  const val = $('#masterOutVal');
  const set = v => {
    masterOut = clamp(v, -24, 6);
    const n = (masterOut + 24) / 30;
    ind.style.transform = `translateX(-50%) rotate(${-135 + 270 * n}deg)`;
    val.textContent = fmtDb(masterOut);
    if (masterGain) masterGain.gain.value = dbToAmp(masterOut);
    if (window.__TU_NATIVE__ && window.__TU_sendMaster) window.__TU_sendMaster('outputGain', masterOut);
  };
  set(0);
  window.__TU_setMasterOut = v => {
    window.__TU_applyingNative = true;
    set(v);
    window.__TU_applyingNative = false;
  };
  let sy = 0, sv = 0;
  knob.addEventListener('pointerdown', e => {
    if (e.altKey) return;
    e.preventDefault(); sy = e.clientY; sv = masterOut;
    knob.setPointerCapture(e.pointerId);
  });
  knob.addEventListener('click', e => {
    if (!e.altKey) return;
    e.preventDefault(); e.stopPropagation();
    if (val._numReset) val._numReset();
  });
  knob.addEventListener('pointermove', e => {
    if (!knob.hasPointerCapture(e.pointerId)) return;
    set(sv + (sy - e.clientY) / 3);
  });
  bindNumericEdit(val, {
    get: () => masterOut,
    set: v => set(v),
    min: -24, max: 6, step: .1, unit: 'dB', decimals: 1, default: 0,
  });
})();

$('#settingsBtn').onclick = () => {
  hideSimilarity();
  if ($('#visualPanel').classList.contains('show')) {
    setVisualOpen(false);
    setSettingsOpen(true);
    return;
  }
  setSettingsOpen(!$('#settingsMenu').classList.contains('show'));
};
// ---------- VISUAL panel (Settings → VISUAL…) ----------
// apply prefs that live on the document (classes, zoom); safe to call before first render
function applyDocumentPrefs() {
  const root = document.documentElement;
  root.classList.toggle('reduce-motion', !!visualPrefs.reduceMotion);
  root.classList.toggle('reduce-transparency', !!visualPrefs.reduceTransparency);
  root.classList.toggle('cat-shapes', !!visualPrefs.shapes);
  root.style.zoom = visualPrefs.scale === 100 ? '' : String(visualPrefs.scale / 100);
}
applyDocumentPrefs();
function renderVisualPanel() {
  $$('#paletteSeg button').forEach(b => b.classList.toggle('active', b.dataset.palette === visualPrefs.palette));
  $$('#scaleSeg button').forEach(b => b.classList.toggle('active', +b.dataset.scale === visualPrefs.scale));
  $$('.vp-toggle[data-pref]').forEach(b => {
    const on = !!visualPrefs[b.dataset.pref];
    b.classList.toggle('on', on); b.setAttribute('aria-checked', on);
  });
  $('#paletteSwatches').innerHTML = CATEGORIES.map(c =>
    `<span class="vp-swatch"><i class="cat-mark" style="background:${c.color};color:${c.color};--shape:${SHAPE_CLIP[CAT_SHAPE[c.id]]}"></i>${c.short}</span>`).join('');
}
function applyVisualPrefs() {
  try { localStorage.setItem('tu-visual', JSON.stringify(visualPrefs)); } catch (e) {}
  setCategoryPalette(visualPrefs.palette);
  applyDocumentPrefs();
  renderVisualPanel();
  // repaint everything that shows category colours, then re-measure for the new scale
  renderSlots(); renderFaders();
  updateSimilarityUI();
  if (state.viewMode === 'files') renderFileList();
  window.dispatchEvent(new Event('resize'));
  requestAnimationFrame(() => { resizeCanvas(); drawUniverse(); if (state.viewMode === 'trigger') resizeInput(); });
}
function setVisualOpen(open) {
  if (open) {
    setSettingsOpen(false);
    $('#libraryPanel').classList.remove('show');
    renderVisualPanel();
  }
  $('#visualPanel').classList.toggle('show', open);
}
// Clicking anywhere outside the VISUAL dialog closes it before the underlying
// control acts, so it can never sit on top of the trigger page.
document.addEventListener('pointerdown', e => {
  const vp = $('#visualPanel');
  if (!vp || !vp.classList.contains('show')) return;
  if (vp.contains(e.target) || e.target.closest('#settingsBtn') || e.target.closest('#menuVisual')) return;
  setVisualOpen(false);
}, true);

document.addEventListener('pointerdown', e => {
  const menu = $('#settingsMenu');
  if (!menu || !menu.classList.contains('show')) return;
  if (menu.contains(e.target) || e.target.closest('#settingsBtn')) return;
  setSettingsOpen(false);
}, true);
$('#menuVisual').onclick = () => setVisualOpen(true);
$('#visualClose').onclick = () => setVisualOpen(false);
$('#scaleSeg').addEventListener('click', e => {
  const b = e.target.closest('button[data-scale]');
  if (!b || +b.dataset.scale === visualPrefs.scale) return;
  visualPrefs.scale = +b.dataset.scale;
  applyVisualPrefs();
});
$('#visualPanel').addEventListener('click', e => {
  const t = e.target.closest('.vp-toggle[data-pref]');
  if (!t) return;
  visualPrefs[t.dataset.pref] = !visualPrefs[t.dataset.pref];
  applyVisualPrefs();
});
$('#paletteSeg').addEventListener('click', e => {
  const b = e.target.closest('button[data-palette]');
  if (!b || b.dataset.palette === visualPrefs.palette) return;
  visualPrefs.palette = b.dataset.palette;
  applyVisualPrefs();
});
$('#menuFolders').onclick = () => {
  setLibraryOpen(true);
};

function renderLibraryPanel() {
  const list = $('#libraryList');
  if (!list) return;
  const roots = state.libraryRoots || [];
  if (!roots.length) {
    list.innerHTML = `<div class="lp-empty">No hay locations todavía.<br>Usá <b>ADD NEW LOCATION</b> para sumar una carpeta del Finder.</div>`;
    return;
  }
  const counts = {};
  for (const s of state.samples) counts[s.root || ''] = (counts[s.root || ''] || 0) + 1;
  list.innerHTML = roots.map((r, i) => `
    <div class="lp-row">
      <div class="lp-main"><b>${esc(r.name)}</b><small>${esc(r.path)}</small></div>
      <span class="lp-count">${counts[r.name] || 0} WAV</span>
      <button data-lib-remove="${i}" title="Remove location">REMOVE</button>
    </div>`).join('');
}

function setLibraryOpen(open) {
  if (open) {
    setSettingsOpen(false);
    setVisualOpen(false);
    renderLibraryPanel();
  }
  const panel = $('#libraryPanel');
  if (!panel) return;
  panel.classList.toggle('show', open);
  $('#settingsBtn').classList.toggle('active', open);
}

$('#libraryClose').onclick = () => setLibraryOpen(false);
$('#libraryAdd').onclick = () => {
  if (window.__TU_NATIVE__ && window.__TU_chooseFolder) window.__TU_chooseFolder();
  else toast('ADD NEW LOCATION only available inside the plugin');
};
$('#libraryRescan').onclick = () => {
  if (window.__TU_NATIVE__ && typeof SAMFUI === 'function') SAMFUI(9, 0, 0);
  else toast('RESCAN only available inside the plugin');
};
$('#libraryList').addEventListener('click', e => {
  const b = e.target.closest('[data-lib-remove]');
  if (!b) return;
  if (window.__TU_NATIVE__ && typeof SAMFUI === 'function') SAMFUI(8, +b.dataset.libRemove, 0);
});
document.addEventListener('pointerdown', e => {
  const panel = $('#libraryPanel');
  if (!panel || !panel.classList.contains('show')) return;
  if (panel.contains(e.target) || e.target.closest('#settingsBtn') || e.target.closest('#menuFolders')) return;
  setLibraryOpen(false);
}, true);
$('#menuAudio').onclick = () => {
  setSettingsOpen(false);
  toast('Audio / MIDI settings (demo)');
};
document.addEventListener('mousedown', e => {
  const menu = $('#settingsMenu');
  if (!menu.classList.contains('show')) return;
  if (menu.contains(e.target) || e.target.closest('#settingsBtn')) return;
  setSettingsOpen(false);
});

// ---------- toast ----------
let toastTimer = null;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1700);
}

// ---------- Web Audio: real snare + slot playback ----------
const dbToAmp = db => Math.pow(10, db / 20);

function ensureAudio() {
  // Inside the AU the audio lives in C++; the WebView must not create a
  // second graph that would play outside the host.
  if (window.__TU_NATIVE__) return null;
  if (audioCtx) {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  audioCtx = new Ctx();
  masterGain = audioCtx.createGain();
  masterGain.gain.value = dbToAmp(masterOut);
  masterAnalyser = audioCtx.createAnalyser();
  masterAnalyser.fftSize = 2048;
  masterGain.connect(masterAnalyser).connect(audioCtx.destination);
  gateGain = audioCtx.createGain();
  gateGain.gain.value = 1;
  inputGain = audioCtx.createGain();
  inputGain.gain.value = dbToAmp(state.detector.input || 0);
  dryGain = audioCtx.createGain();
  wetGain = audioCtx.createGain();
  dryGain.gain.value = 1 - clamp(state.detector.mix, 0, 100) / 100;
  wetGain.gain.value = clamp(state.detector.mix, 0, 100) / 100;
  dryGain.connect(masterGain);
  wetGain.connect(masterGain);
  inputGain.connect(gateGain);
  gateGain.connect(dryGain);
  initDetectorWorklet(audioCtx);
  slotNodes = state.slots.map(() => {
    // CUT / TONE are baked into the sample with zero phase (slotPlayBuffer),
    // so the live chain has no IIR filters that would shift the phase.
    const inp = audioCtx.createGain();
    const level = audioCtx.createGain();
    const pan = audioCtx.createStereoPanner();
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 1024;
    inp.connect(level).connect(pan).connect(analyser).connect(wetGain);
    return {
      inp, level, pan, analyser,
      fbuf: new Float32Array(analyser.fftSize),
      buf: new Uint8Array(analyser.fftSize),
    };
  });
  syncAllSlotAudio();
  startMeters();
  return audioCtx;
}

function syncSlotAudio(i) {
  if (window.__TU_NATIVE__) {
    if (window.__TU_sendSlot) window.__TU_sendSlot(i, state.slots[i]);
    return;
  }
  if (!audioCtx || !slotNodes[i]) return;
  const s = state.slots[i];
  const anySolo = state.slots.some(x => x.solo);
  const active = !s.mute && (!anySolo || s.solo);
  const amp = active ? dbToAmp(s.level) : 0;
  slotNodes[i].level.gain.value = effPolarity(s) ? -amp : amp;
  slotNodes[i].pan.pan.value = clamp(s.pan / 100, -1, 1);
}
function syncAllSlotAudio() { state.slots.forEach((_, i) => syncSlotAudio(i)); }

function makeProceduralBuffer(smp) {
  const ctx = ensureAudio();
  if (!ctx) return null;
  const sr = 48000;
  const dur = clamp((smp.dur || 400) / 1000, 0.05, 4);
  const buf = ctx.createBuffer(1, Math.ceil(dur * sr), sr);
  const d = buf.getChannelData(0);
  const r = mulberry32(smp.id * 2654435761 % 2147483647 + 11);
  const cat = smp.category;
  let phase = 0;
  for (let i = 0; i < d.length; i++) {
    const t = i / sr;
    let v = 0;
    if (cat === 'Kick') {
      const f = 45 + 100 * Math.exp(-t / 0.03);
      phase += 2 * Math.PI * f / sr;
      v = Math.sin(phase) * Math.exp(-t / 0.13);
      if (t < 0.012) v += (r() - .5) * 1.2 * Math.exp(-t / 0.004);
    } else if (cat === 'Snare' || cat === 'Clap') {
      const env = Math.exp(-t / (cat === 'Clap' ? 0.045 : 0.07));
      v = (r() - .5) * 1.5 * env;
      if (cat === 'Snare') v += 0.45 * Math.sin(2 * Math.PI * 185 * t) * Math.exp(-t / 0.09);
      if (cat === 'Clap') v *= (0.55 + 0.45 * Math.sin(2 * Math.PI * 25 * t));
    } else if (cat === 'HHC' || cat === 'HHO' || cat === 'Cymbal') {
      const env = Math.exp(-t / (cat === 'HHC' ? 0.025 : cat === 'HHO' ? 0.16 : 0.35));
      v = (r() - .5) * env * (cat === 'HHC' ? 0.9 : 1.2);
    } else if (cat === 'Tom') {
      phase += 2 * Math.PI * (85 + 30 * Math.exp(-t / 0.06)) / sr;
      v = Math.sin(phase) * Math.exp(-t / 0.22);
    } else if (cat === 'Perc') {
      v = ((r() - .5) * 0.8 + 0.4 * Math.sin(2 * Math.PI * (400 + 600 * r()) * t)) * Math.exp(-t / 0.08);
    } else {
      v = (r() - .5) * Math.exp(-t / 0.2) * (0.5 + 0.5 * Math.sin(2 * Math.PI * 3 * t));
    }
    d[i] = clamp(v, -1, 1) * 0.9;
  }
  return buf;
}

function getBuffer(smp) {
  if (!smp) return null;
  if (smp.audioBuffer) return smp.audioBuffer;
  if (smp.isReal) return null;
  smp.audioBuffer = makeProceduralBuffer(smp);
  return smp.audioBuffer;
}

let hoverPreview = { src: null, gain: null, id: null };

function stopHoverPreview() {
  const { src, gain } = hoverPreview;
  hoverPreview = { src: null, gain: null, id: null };
  if (!src) return;
  try {
    if (gain && audioCtx) {
      const now = audioCtx.currentTime;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(gain.gain.value, now);
      gain.gain.linearRampToValueAtTime(0, now + .018);
      src.stop(now + .022);
    } else {
      src.stop();
    }
  } catch (e) {}
}

function playHoverPreview(smp) {
  if (!smp) { stopHoverPreview(); return; }
  const ctx = ensureAudio();
  if (!ctx || !masterGain) return;
  const buf = getBuffer(smp);
  if (!buf) return;
  stopHoverPreview();
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const g = ctx.createGain();
  const level = dbToAmp(-8);
  const now = ctx.currentTime + .01;
  const dur = Math.min(.8, Math.max(.06, buf.duration));
  const offset = smp.isReal ? Math.min(.1, buf.duration * .1) : 0;
  g.gain.setValueAtTime(0, now);
  g.gain.linearRampToValueAtTime(level, now + .006);
  g.gain.setValueAtTime(level, now + dur);
  g.gain.linearRampToValueAtTime(0, now + dur + .07);
  src.connect(g).connect(masterGain);
  src.start(now, offset);
  src.stop(now + dur + .08);
  hoverPreview = { src, gain: g, id: smp.id };
  src.onended = () => {
    if (hoverPreview.src === src) hoverPreview = { src: null, gain: null, id: null };
    try { src.disconnect(); } catch (e) {}
    try { g.disconnect(); } catch (e) {}
  };
}

function scheduleHoverPreview(smp) {
  if (!smp) { stopHoverPreview(); return; }
  if (hoverPreview.id === smp.id) return;
  playHoverPreview(smp);
}

function getReversedBuffer(smp) {
  if (smp._rev) return smp._rev;
  const src = getBuffer(smp);
  if (!src || !audioCtx) return null;
  const out = audioCtx.createBuffer(src.numberOfChannels, src.length, src.sampleRate);
  for (let ch = 0; ch < src.numberOfChannels; ch++) {
    const a = src.getChannelData(ch), b = out.getChannelData(ch);
    for (let i = 0; i < a.length; i++) b[i] = a[a.length - 1 - i];
  }
  smp._rev = out;
  return out;
}

// ---------- zero-phase slot EQ (CUT + TONE) ----------
// A slot plays a fixed sample, so its EQ does not have to run in real time.
// CUT (12 dB/oct low-pass, 200 Hz–20 kHz) and TONE (±12 dB high shelf at
// 4 kHz) are applied to the sample itself, off the audio path: FFT → multiply
// by the filters' magnitude only (same curve as the old biquads) → IFFT.
// Zero phase means every frequency keeps its timing, so layers stay in phase
// with each other and with the input whatever the EQ. No latency; the price is
// a small symmetric pre-ring, inaudible with slopes this gentle. Rebuilt only
// when the sample / reverse / CUT / TONE change (a few ms), then cached.
const EQ_PAD = 4096; // zeros on each side: room for the filter ring, no wrap
const eqIsFlat = s => (s.cut ?? 100) >= 100 && !s.tone;
const eqCutHz = cut => clamp(200 * Math.pow(100, cut / 100), 200, 20000);
const eqMagCtx = {};
function eqMagnitude(sr, n, cut, tone) {
  const c = eqMagCtx[sr] || (eqMagCtx[sr] = new OfflineAudioContext(1, 1, sr));
  const bins = n / 2 + 1;
  const f = new Float32Array(bins);
  for (let k = 0; k < bins; k++) f[k] = Math.min(k * sr / n, sr / 2 - 1);
  const mag = new Float32Array(bins).fill(1);
  const m = new Float32Array(bins), ph = new Float32Array(bins);
  const apply = node => {
    node.getFrequencyResponse(f, m, ph);
    for (let k = 0; k < bins; k++) mag[k] *= isFinite(m[k]) ? m[k] : 0;
  };
  if (cut < 100) {
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass'; lp.Q.value = 0.7; lp.frequency.value = eqCutHz(cut);
    apply(lp);
  }
  if (tone) {
    const hs = c.createBiquadFilter();
    hs.type = 'highshelf'; hs.frequency.value = 4000; hs.gain.value = tone / 100 * 12;
    apply(hs);
  }
  return mag;
}
function fftInPlace(re, im, inverse) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (inverse ? 2 : -2) * Math.PI / len;
    const wr = Math.cos(ang), wi = Math.sin(ang), half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < half; k++) {
        const a = i + k, b = a + half;
        const xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr; im[b] = im[a] - xi;
        re[a] += xr; im[a] += xi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}
function zeroPhaseEq(buf, cut, tone) {
  const sr = buf.sampleRate, len = buf.length, nCh = buf.numberOfChannels;
  let n = 1; while (n < len + 2 * EQ_PAD) n <<= 1;
  const mag = eqMagnitude(sr, n, cut, tone);
  const out = new AudioBuffer({ numberOfChannels: nCh, length: len, sampleRate: sr });
  // Two channels per FFT (L in re, R in im): the gain is real and symmetric,
  // so the channels come back apart.
  for (let c = 0; c < nCh; c += 2) {
    const re = new Float64Array(n), im = new Float64Array(n);
    re.set(buf.getChannelData(c), EQ_PAD);
    if (c + 1 < nCh) im.set(buf.getChannelData(c + 1), EQ_PAD);
    fftInPlace(re, im, false);
    for (let k = 0; k < n; k++) { const g = mag[k <= n / 2 ? k : n - k]; re[k] *= g; im[k] *= g; }
    fftInPlace(re, im, true);
    out.copyToChannel(Float32Array.from(re.subarray(EQ_PAD, EQ_PAD + len)), c);
    if (c + 1 < nCh) out.copyToChannel(Float32Array.from(im.subarray(EQ_PAD, EQ_PAD + len)), c + 1);
  }
  return out;
}
function reversedCopy(src) {
  const out = new AudioBuffer({ numberOfChannels: src.numberOfChannels, length: src.length, sampleRate: src.sampleRate });
  for (let ch = 0; ch < src.numberOfChannels; ch++) {
    const a = src.getChannelData(ch), b = out.getChannelData(ch);
    for (let i = 0; i < a.length; i++) b[i] = a[a.length - 1 - i];
  }
  return out;
}
// Buffer a slot plays: raw (or reversed) sample with CUT / TONE baked in.
// native = the file's own sample rate (bounce); otherwise the context's rate.
function slotPlayBuffer(s, smp, native = false) {
  let raw;
  if (native && smp.nativeBuffer) {
    raw = s.reverse ? (smp._revNative || (smp._revNative = reversedCopy(smp.nativeBuffer))) : smp.nativeBuffer;
  } else {
    raw = s.reverse ? getReversedBuffer(smp) : getBuffer(smp);
  }
  if (!raw || eqIsFlat(s)) return raw;
  const key = `${smp.id}|${s.reverse ? 1 : 0}|${s.cut}|${s.tone}|${raw.sampleRate}|${raw.length}`;
  const slotKey = native ? '_eqNative' : '_eqLive';
  const hit = s[slotKey];
  if (hit && hit.key === key) return hit.buf;
  const buf = zeroPhaseEq(raw, s.cut ?? 100, s.tone || 0);
  // non-enumerable: the cache must not end up in saved state / JSON
  Object.defineProperty(s, slotKey, { value: { key, buf }, writable: true, configurable: true, enumerable: false });
  return buf;
}

function scheduleSlot(ctx, i, when, velocity = 1, gateStartSec = null, atTime = null) {
  const s = state.slots[i];
  const smp = slotSample(s);
  if (!smp) return null;
  const anySolo = state.slots.some(x => x.solo);
  if (s.mute || (anySolo && !s.solo)) return null;
  const buf = slotPlayBuffer(s, smp);
  if (!buf) return null;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const rate = Math.pow(2, s.tune / 12);
  src.playbackRate.value = rate;
  src.loop = !!s.loop;
  const durSec = smp.dur / 1000;
  const startSec = (s.reverse ? (1 - s.end) : s.start) * durSec;
  const endSec = (s.reverse ? (1 - s.start) : s.end) * durSec;
  const len = Math.max(0.005, endSec - startSec);
  if (s.loop) { src.loopStart = startSec; src.loopEnd = endSec; }
  const env = ctx.createGain();
  const fade = ctx.createGain();
  const playGate = ctx.createGain();
  src.connect(env).connect(fade).connect(playGate);
  const node = slotNodes[i];
  if (node) playGate.connect(node.inp); else playGate.connect(masterGain);
  // Negative offset means "play earlier": live triggers are scheduled with
  // lookahead, so the shift can be applied as long as we do not start in the
  // past. Manual auditions clamp to the next audio block.
  // atTime: absolute onset from the real-time detector (sample-accurate; a
  // relative 'when' would drift by the audio blocks rendered in between).
  const wantedT0 = (atTime != null ? atTime : ctx.currentTime + 0.02 + (when || 0)) + effOffset(s) / 1000;
  const t0 = Math.max(ctx.currentTime + 0.002, wantedT0);
  const total = len / rate;
  // Envelope from every point (A/D/R + extra points), in seconds from t0.
  // If the sample got shorter than the envelope (tuning up), scale it to fit.
  const envPtsMs = slotEnvPoints(s, Math.max(1, (smp ? (1 - s.start) * smp.dur : 800)));
  const envLenSec = Math.max(0.002, envPtsMs[envPtsMs.length - 1].t / 1000);
  const envK = envLenSec > total ? total / envLenSec : 1;
  const envEndSec = Math.max(0.002, envLenSec * envK);
  const envStopSec = s.loop ? Math.max(envEndSec, 2) : envEndSec;
  const stopSec = s.loop ? 2 : envEndSec;
  // Sensitivity controls the dynamic range (like Trigger 2): 0% squeezes
  // soft and hard hits together, 100% spreads them apart. The slot VELOCITY
  // blends that response with a fixed level.
  const dynExp = 0.35 + clamp(state.detector.sens, 0, 100) / 100 * 1.65;
  const dynamics = Math.pow(clamp(velocity, 0, 2), dynExp);
  const velAmount = clamp((s.velSens ?? 100) / 100, 0, 1);
  const velGain = clamp(1 - velAmount + velAmount * dynamics, 0, 2.2);
  const base = clamp(dbToAmp(s.gain), 0, 4) * velGain;
  const g = env.gain;
  g.setValueAtTime(0, t0);
  let lastT = 0;
  for (let k = 1; k < envPtsMs.length; k++) {
    // a 1 ms minimum on the first segment keeps ATTACK 0 click-free
    const tk = Math.max(k === 1 ? 0.001 : lastT, envPtsMs[k].t / 1000 * envK);
    g.linearRampToValueAtTime(base * envPtsMs[k].v, t0 + tk);
    lastT = tk;
  }
  if (envStopSec > lastT) g.linearRampToValueAtTime(base * envPtsMs[envPtsMs.length - 1].v, t0 + envStopSec);
  g.linearRampToValueAtTime(0, t0 + envStopSec + 0.004);
  // PLAYBACK GATE follows the input gate envelope for live triggers; a manual
  // audition (no gateStartSec) still plays the full sample.
  if (s.playback === 'gate' && gateStartSec != null && realGateEnv && realInputBuffer) {
    const blockDur = realGateBlock / realInputBuffer.sampleRate;
    const startIdx = clamp(Math.floor(gateStartSec / blockDur), 0, realGateEnv.length - 1);
    const gateDurTarget = s.loop ? stopSec : total;
    const curveLen = Math.max(2, Math.min(realGateEnv.length - startIdx, Math.ceil(gateDurTarget / blockDur) + 1));
    const curve = realGateEnv.slice(startIdx, startIdx + curveLen);
    const curveDur = curve.length * blockDur;
    try {
      playGate.gain.setValueCurveAtTime(curve, t0, curveDur);
      if (curveDur < gateDurTarget) playGate.gain.setValueAtTime(0, t0 + curveDur);
    } catch (e) {
      playGate.gain.setValueAtTime(1, t0);
    }
  } else {
    playGate.gain.setValueAtTime(1, t0);
  }
  const f = fade.gain;
  const fi = Math.min(s.fadeIn / 1000, total * .9);
  const fo = Math.min(s.fadeOut / 1000, total * .9);
  const fadeStop = s.loop ? stopSec : total;
  f.setValueAtTime(fi > 0 ? 0 : 1, t0);
  if (fi > 0) f.linearRampToValueAtTime(1, t0 + fi);
  if (fo > 0) {
    f.setValueAtTime(1, Math.max(t0 + fi, t0 + fadeStop - fo));
    f.linearRampToValueAtTime(0, t0 + fadeStop);
  }
  const playLen = s.loop ? 2 : len;
  src.start(t0, startSec, playLen);
  src.stop(t0 + stopSec + 0.006);
  src.onended = () => {
    try { src.disconnect(); env.disconnect(); fade.disconnect(); playGate.disconnect(); } catch (e) {}
    const idx = activeSlotSources.indexOf(src); if (idx >= 0) activeSlotSources.splice(idx, 1);
  };
  activeSlotSources.push(src);
  return src;
}

function playSlot(i, when = 0, velocity = 1, gateStartSec = null, atTime = null) {
  const ctx = ensureAudio();
  if (!ctx) return null;
  syncSlotAudio(i);
  return scheduleSlot(ctx, i, when, velocity, gateStartSec, atTime);
}

// ---------- BOUNCE MODIFIED SAMPLES ----------
// Renders each loaded slot offline exactly as it sounds in the mix, at
// velocity 1, at the sample's native rate: START, envelope with every point,
// reverse, tune, TONE/CUT (zero phase), GAIN,
// polarity, fader level, pan (always stereo) and the Auto Phase OFFSET
// (positive = silence before the hit, negative = trims the head). Writes
// 24-bit WAVs to a folder the user picks. Mute/solo are ignored and 90°
// have no DSP in the prototype yet. The original files are never touched.
async function renderSlotOffline(i, opts = {}) {
  const an = !!opts.analysis; // AUTO PHASE: as it sounds, minus polarity / offset / pan
  const s = state.slots[i];
  const smp = slotSample(s);
  if (!smp) return null;
  // Native sample rate (48 kHz stays 48 kHz) with CUT / TONE baked in at zero phase.
  const buf = slotPlayBuffer(s, smp, !an);
  if (!buf) return null;
  const sr = buf.sampleRate;
  const rate = Math.pow(2, s.tune / 12);
  const durSec = smp.dur / 1000;
  const startSec = (s.reverse ? (1 - s.end) : s.start) * durSec;
  const endSec = (s.reverse ? (1 - s.start) : s.end) * durSec;
  const len = Math.max(0.005, endSec - startSec);
  const total = len / rate;
  const envPtsMs = slotEnvPoints(s, Math.max(1, (1 - s.start) * smp.dur));
  const envLenSec = Math.max(0.002, envPtsMs[envPtsMs.length - 1].t / 1000);
  const envK = envLenSec > total ? total / envLenSec : 1;
  const envEndSec = Math.max(0.002, envLenSec * envK);
  const offSec = an ? 0 : effOffset(s) / 1000;
  const pre = Math.max(0, offSec);            // positive offset: leading silence
  const trim = Math.max(0, -offSec);          // negative offset: cut the head
  const outSec = pre + envEndSec + 0.004;
  // analysis renders at the live context rate (the input's rate); the
  // procedural samples are 48 kHz buffers and get resampled here
  const outSr = an && audioCtx ? audioCtx.sampleRate : sr;
  const ctx = new OfflineAudioContext(2, Math.max(1, Math.ceil(outSec * outSr)), outSr);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = rate;
  const env = ctx.createGain();
  const fade = ctx.createGain();
  const pol = ctx.createGain();
  pol.gain.value = (!an && effPolarity(s) ? -1 : 1) * dbToAmp(s.level);
  const pan = ctx.createStereoPanner();
  pan.pan.value = an ? 0 : clamp(s.pan / 100, -1, 1);
  src.connect(env).connect(fade).connect(pol).connect(pan).connect(ctx.destination);
  const base = clamp(dbToAmp(s.gain), 0, 4);
  const g = env.gain;
  g.setValueAtTime(0, pre);
  let lastT = 0;
  for (let k = 1; k < envPtsMs.length; k++) {
    const tk = Math.max(k === 1 ? 0.001 : lastT, envPtsMs[k].t / 1000 * envK);
    g.linearRampToValueAtTime(base * envPtsMs[k].v, pre + tk);
    lastT = tk;
  }
  g.linearRampToValueAtTime(0, pre + envEndSec + 0.004);
  const f = fade.gain;
  const fi = Math.min((s.fadeIn || 0) / 1000, total * .9);
  const fo = Math.min((s.fadeOut || 0) / 1000, total * .9);
  f.setValueAtTime(fi > 0 ? 0 : 1, pre);
  if (fi > 0) f.linearRampToValueAtTime(1, pre + fi);
  if (fo > 0) { f.setValueAtTime(1, pre + Math.max(fi, total - fo)); f.linearRampToValueAtTime(0, pre + total); }
  src.start(pre, startSec, len);
  const out = await ctx.startRendering();
  const cut0 = Math.min(out.length - 1, Math.round(trim * sr));
  if (!cut0) return out;
  const trimmed = new AudioBuffer({ numberOfChannels: out.numberOfChannels, length: out.length - cut0, sampleRate: sr });
  for (let c = 0; c < out.numberOfChannels; c++) trimmed.copyToChannel(out.getChannelData(c).subarray(cut0), c);
  return trimmed;
}

function encodeWav24(audioBuf) {
  const nCh = audioBuf.numberOfChannels, n = audioBuf.length, sr = audioBuf.sampleRate;
  const bytes = 3, blockAlign = nCh * bytes, dataLen = n * blockAlign;
  const out = new ArrayBuffer(44 + dataLen);
  const v = new DataView(out);
  const str = (o, t) => { for (let k = 0; k < t.length; k++) v.setUint8(o + k, t.charCodeAt(k)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + dataLen, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, nCh, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * blockAlign, true); v.setUint16(32, blockAlign, true);
  v.setUint16(34, 24, true); str(36, 'data'); v.setUint32(40, dataLen, true);
  const chans = Array.from({ length: nCh }, (_, c) => audioBuf.getChannelData(c));
  let o = 44, peak = 0;
  for (let k = 0; k < n; k++) {
    for (let c = 0; c < nCh; c++) {
      const x = chans[c][k];
      peak = Math.max(peak, Math.abs(x));
      const q = Math.round(clamp(x, -1, 1) * 8388607);
      v.setUint8(o, q & 255); v.setUint8(o + 1, (q >> 8) & 255); v.setUint8(o + 2, (q >> 16) & 255);
      o += 3;
    }
  }
  return { blob: new Blob([out], { type: 'audio/wav' }), peak };
}

const bounceFileBase = (i, smp) =>
  `${String(i + 1).padStart(2, '0')} ${String(smp.name || 'sample').replace(/[\\/:*?"<>|]+/g, '_').trim()} (bounce)`;

async function uniqueFileHandle(dir, base) {
  for (let n = 1; n < 1000; n++) {
    const name = n === 1 ? `${base}.wav` : `${base} ${n}.wav`;
    try { await dir.getFileHandle(name); } catch (e) { return dir.getFileHandle(name, { create: true }); }
  }
  return dir.getFileHandle(`${base} ${Date.now()}.wav`, { create: true });
}

let bounceBusy = false;
async function bounceModifiedSamples() {
  if (bounceBusy) return;
  // Selected Trigger Slots (Shift/Cmd+click or marquee) narrow the bounce;
  // otherwise every loaded slot is bounced.
  const loaded = state.slots.map((s, i) => slotSample(s) ? i : -1).filter(i => i >= 0);
  const picked = loaded.filter(i => multiSel.slots.has(i));
  const targets = picked.length ? picked : loaded;
  if (!targets.length) { toast('BOUNCE · load a sample in a Trigger Slot first'); return; }
  if (!ensureAudio()) { toast('Audio not available'); return; }
  let dir = null;
  if (window.showDirectoryPicker) {
    try { dir = await window.showDirectoryPicker({ id: 'tu-bounce', mode: 'readwrite', startIn: 'music' }); }
    catch (e) { if (e && e.name === 'AbortError') { toast('Bounce cancelled'); return; } dir = null; }
  }
  bounceBusy = true;
  const btn = $('#bounceBtn');
  btn.classList.add('busy');
  let done = 0, clipped = 0;
  try {
    for (const i of targets) {
      const smp = slotSample(state.slots[i]);
      btn.querySelector('.bounce-sub').textContent = `${done + 1} / ${targets.length}`;
      const rendered = await renderSlotOffline(i);
      if (!rendered) continue;
      const { blob, peak } = encodeWav24(rendered);
      if (peak > 1) clipped++;
      const base = bounceFileBase(i, smp);
      if (dir) {
        const fh = await uniqueFileHandle(dir, base);
        const w = await fh.createWritable();
        await w.write(blob); await w.close();
      } else {
        // No folder picker in this browser: fall back to downloads.
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = `${base}.wav`;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      }
      done++;
    }
    const where = dir ? ` → ${dir.name}` : ' → Downloads';
    toast(`BOUNCED ${done} sample${done === 1 ? '' : 's'}${where}${clipped ? ` · ${clipped} clipped (lower GAIN)` : ''}`);
  } catch (e) {
    console.error('[bounce]', e);
    toast(`Bounce failed · ${e && e.message ? e.message : e}`);
  } finally {
    bounceBusy = false;
    btn.classList.remove('busy');
    btn.querySelector('.bounce-sub').textContent = 'MODIFIED SAMPLES';
  }
}

// Real peak from the analyser. Float data keeps the meter honest; the
// byte fallback is only for old browsers. A short hold makes 1 ms transients
// visible between 25 fps meter frames.
function analyserPeak(analyser, fbuf, buf) {
  if (analyser.getFloatTimeDomainData && fbuf) {
    analyser.getFloatTimeDomainData(fbuf);
    let peak = 0;
    for (let i = 0; i < fbuf.length; i++) {
      const x = Math.abs(fbuf[i]);
      if (x > peak) peak = x;
    }
    return peak;
  }
  analyser.getByteTimeDomainData(buf);
  let peak = 0;
  for (let i = 0; i < buf.length; i++) {
    const x = Math.abs((buf[i] - 128) / 128);
    if (x > peak) peak = x;
  }
  return peak;
}
const METER_HOLD = 0.9; // per 40 ms frame (~24 dB/s fall)
function startMeters() {
  if (meterRAF) return;
  const mb = new Float32Array(masterAnalyser.fftSize);
  const mb8 = new Uint8Array(masterAnalyser.fftSize);
  const holds = new Float32Array(8);
  let outHold = 0;
  let lastMeter = 0, lastVu = -1, lastMaster = -1;
  const loop = now => {
    if (audioCtx && now - lastMeter > 40) {
      lastMeter = now;
      if (state.viewMode === 'trigger') {
        const anySolo = state.slots.some(s => s.solo);
        state.slots.forEach((s, i) => {
          const node = slotNodes[i];
          if (!node) return;
          const peak = analyserPeak(node.analyser, node.fbuf, node.buf);
          const active = !s.mute && (!anySolo || s.solo);
          const held = active ? Math.max(peak, holds[i] * METER_HOLD) : 0;
          holds[i] = held;
          const h = active && held > 0.001 ? Math.round(faderDbToPos(20 * Math.log10(held)) * 1000) / 10 : 0;
          if (h === slotMeterVals[i]) return;
          slotMeterVals[i] = h;
          const mt = $(`#meter-${i}`); if (mt) mt.style.height = h + '%';
        });
      }
      const peak = analyserPeak(masterAnalyser, mb, mb8);
      outHold = Math.max(peak, outHold * METER_HOLD);
      const vu = Math.round(clamp(outHold * 100, 0, 100));
      if (vu !== lastVu) {
        lastVu = vu;
        const ov = $('#outVuBar'); if (ov) ov.style.height = vu + '%';
      }
      if (vu !== lastMaster) {
        lastMaster = vu;
        const mm = $('#masterMeter'); if (mm) mm.style.width = vu + '%';
      }
    }
    meterRAF = requestAnimationFrame(loop);
  };
  meterRAF = requestAnimationFrame(loop);
}

// WAV sample rate from the 'fmt ' chunk, then decode at that rate.
function wavSampleRate(bytes) {
  const v = new DataView(bytes);
  for (let o = 12; o + 8 <= v.byteLength; ) {
    const id = String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
    const size = v.getUint32(o + 4, true);
    if (id === 'fmt ') return v.getUint32(o + 12, true);
    o += 8 + size + (size & 1);
  }
  return 0;
}
async function decodeNative(bytes) {
  try {
    const sr = wavSampleRate(bytes);
    if (!sr) return null;
    return await new OfflineAudioContext(1, 1, sr).decodeAudioData(bytes);
  } catch (e) { console.warn('[native decode]', e); return null; }
}

const INPUT_FILE = 'samples/SN_TOP_1COMMIT_17-140.wav';
const SAMPLE_FILE = 'samples/SNARE.cm.wav';

async function loadRealAudio() {
  // Native mode: the C++ engine owns the input and the slots.
  if (window.__TU_NATIVE__) return;
  try {
    // The trigger input is the real 0:17–2:20 excerpt (mono, normalized to
    // −0.5 dBFS). SNARE.cm stays as the demo one-shot.
    const [inputResp, sampleResp] = await Promise.all([
      fetch(INPUT_FILE),
      fetch(SAMPLE_FILE),
    ]);
    if (!inputResp.ok) throw new Error('HTTP ' + inputResp.status + ' · ' + INPUT_FILE);
    if (!sampleResp.ok) throw new Error('HTTP ' + sampleResp.status + ' · ' + SAMPLE_FILE);
    const ctx = ensureAudio();
    if (!ctx) return;
    const sampleBytes = await sampleResp.arrayBuffer();
    const sampleBytesNative = sampleBytes.slice(0); // decodeAudioData detaches its input
    const [full, snareFull] = await Promise.all([
      ctx.decodeAudioData(await inputResp.arrayBuffer()),
      ctx.decodeAudioData(sampleBytes),
    ]);
    realInputBuffer = full;
    realInputDuration = full.duration;
    realInputBlockPeaks = null;
    realInputBlockPeaksKey = null;
    const waveLabel = $('#inputWaveLabel');
    if (waveLabel) {
      waveLabel.textContent = 'SN TOP 1';
      waveLabel.title = 'SN TOP 1COMMIT.18_01 · 0:17–2:20 · real input';
    }
    // 5 ms peak buckets. Use fractional bucket boundaries (data.length / n)
    // instead of a truncated integer step: a fixed step accumulates a
    // time-axis drift over the 2 min track, so the hit markers stop lining up
    // with the transients later in the file.
    const n = Math.max(1200, Math.ceil(full.duration * 200));
    const data = full.getChannelData(0);
    realInputPeaks = new Float32Array(n);
    let maxPeak = 1e-6;
    for (let i = 0; i < n; i++) {
      const start = Math.floor(i * data.length / n);
      const end = Math.max(start + 1, Math.floor((i + 1) * data.length / n));
      let p = 0;
      for (let j = start; j < Math.min(data.length, end); j++) p = Math.max(p, Math.abs(data[j]));
      realInputPeaks[i] = p;
      maxPeak = Math.max(maxPeak, p);
    }
    for (let i = 0; i < n; i++) realInputPeaks[i] /= maxPeak;
    realInputMax = maxPeak || 1;
    // SNARE.cm's first hit stays as the demo one-shot.
    const sr = snareFull.sampleRate;
    const start = Math.floor(0.14 * sr);
    const end = Math.floor(0.65 * sr);
    const slice = ctx.createBuffer(snareFull.numberOfChannels, end - start, sr);
    for (let ch = 0; ch < snareFull.numberOfChannels; ch++) {
      slice.getChannelData(ch).set(snareFull.getChannelData(ch).subarray(start, end));
    }
    realSample.audioBuffer = slice;
    // Same slice at the file's own rate (48 kHz), so BOUNCE does not resample.
    decodeNative(sampleBytesNative).then(nat => {
      if (!nat) return;
      const nsr = nat.sampleRate, a = Math.floor(0.14 * nsr), b = Math.floor(0.65 * nsr);
      const ns = new AudioBuffer({ numberOfChannels: nat.numberOfChannels, length: b - a, sampleRate: nsr });
      for (let ch = 0; ch < nat.numberOfChannels; ch++) ns.copyToChannel(nat.getChannelData(ch).subarray(a, b), ch);
      realSample.nativeBuffer = ns;
    });
    realSample.dur = slice.duration * 1000;
    realSample.x = clamp(normLog(realSample.dur, DUR.min, DUR.max), .002, .998);
    realSample.y = clamp(normLog(2500, BRI.min, BRI.max), .002, .998);
    detectInputHits();
    if (state.ap.ref === 'INPUT') analyzeAllPhase();
    const cur = currentSlotSample();
    if (cur && cur.isReal && $('.inspector').classList.contains('show')) updateInspector();
    drawUniverse();
  } catch (e) {
    console.warn('real input load failed:', e);
  }
}

function detectInputHits() {
  if (!realInputBuffer) return realHits;
  const raw = realInputBuffer.getChannelData(0);
  const sr = realInputBuffer.sampleRate;
  computeGateEnvFromInput();
  computeInputPeakEnv();
  const data = filterDetection(raw, sr);
  const volAmp = dbToAmp(state.detector.input);
  const normGain = volAmp / (realInputMax || 1);
  const detailThr = detailThreshold();
  // With Detail at 0 the threshold is 0; without a floor the rearm test
  // (fast < thr*0.5) never becomes true and only the first hit fires.
  const rearmLevel = Math.max(0.01, detailThr * 0.5);
  const supp = state.detector.supp / 100;
  const retrig = Math.round(state.detector.retrig * 0.001 * sr);
  const k = 2.5;
  const fastRel = Math.exp(-1 / (0.005 * sr));
  const slowCoef = 1 - Math.exp(-1 / (0.05 * sr));
  const win = Math.round(0.005 * sr);
  let fast = 0, slow = 0, supTh = 0, hold = 0, capturing = false, peak = 0, cap = 0, armed = true;
  let capStart = 0, peakAt = 0, velPeak = 0;
  // Same as detector-worklet.js: RETRIGGER is purely the blind time; after it
  // the envelope above the threshold fires again (0 ms = flams). A fresh hit
  // after a dip below half the threshold also needs fast > slow*k.
  let dipped = true;
  const hits = [];
  const gateOn = state.detector.gate && realGateEnv;
  for (let i = 0; i < data.length; i++) {
    let x = Math.abs(data[i]) * normGain;
    if (gateOn) x *= realGateEnv[Math.min(realGateEnv.length - 1, Math.floor(i / realGateBlock))];
    // Detection is normalized to 0 dBFS: boosting INPUT above 0 dB cannot
    // push the signal past Detail 100. The pre-clamp level is kept as the
    // hit velocity so the samples can still get louder.
    const velLevel = Math.min(2, x);
    x = Math.min(1, x);
    fast = Math.max(x, fast * fastRel);
    slow += (x - slow) * slowCoef;
    supTh *= Math.exp(-1 / (0.05 * sr));
    const thr = Math.max(detailThr, supTh);
    // Start once per transient: without !capturing the peak resets every
    // sample while the transient is above the threshold, so the captured
    // velocity collapses to the level at the end of the attack.
    if (!capturing && armed && fast > thr && (!dipped || fast > slow * k)) {
      capturing = true; peak = 0; velPeak = 0; cap = 0; capStart = i; peakAt = i;
    }
    if (capturing) {
      if (fast > peak) { peak = fast; peakAt = i; }
      if (velLevel > velPeak) velPeak = velLevel;
      cap++;
      if (cap >= win) {
        hits.push({ time: Math.max(0, capStart / sr), peak, peakTime: peakAt / sr, velocity: velPeak });
        capturing = false;
        armed = false;
        dipped = false;
        supTh = peak * supp;
        hold = win + retrig;
      }
    }
    if (!armed) {
      if (hold > 0) hold--;
      if (hold <= 0) armed = true;
    }
    if (armed && fast < rearmLevel) dipped = true;
  }
  realHits = hits;
  const el = $('#triggerCount'); if (el) el.textContent = String(hits.length);
  return hits;
}

const DET_WINDOW = 2.0; // default seconds visible in the detector waveform (~6 transients)
// Wheel zoom on the detector waveform: detWin = visible seconds; at rest
// detViewStart scrolls through the track (Shift+wheel / horizontal swipe).
let detWin = DET_WINDOW, detViewStart = 0;
let inputMsPeaks = null; // |x| / max per 1 ms of the track, built once
function inputColumnPeaks(winStart, winDur, cols) {
  const raw = realInputBuffer.getChannelData(0), sr = realInputBuffer.sampleRate;
  const norm = 1 / (realInputMax || 1);
  if (!inputMsPeaks) {
    const n = Math.ceil(raw.length / sr * 1000);
    inputMsPeaks = new Float32Array(n);
    for (let b = 0; b < n; b++) {
      let m = 0;
      const i1 = Math.min(raw.length, Math.round((b + 1) * sr / 1000));
      for (let i = Math.round(b * sr / 1000); i < i1; i++) { const a = Math.abs(raw[i]); if (a > m) m = a; }
      inputMsPeaks[b] = m * norm;
    }
  }
  const out = new Float32Array(cols);
  const colMs = winDur * 1000 / cols;
  for (let x = 0; x < cols; x++) {
    const t0 = winStart + x * winDur / cols, t1 = t0 + winDur / cols;
    let m = 0;
    if (colMs >= 2) {
      for (let b = Math.floor(t0 * 1000); b < Math.min(inputMsPeaks.length, Math.ceil(t1 * 1000)); b++) if (inputMsPeaks[b] > m) m = inputMsPeaks[b];
    } else {
      // zoomed in: read the samples themselves
      const i1 = Math.min(raw.length, Math.ceil(t1 * sr));
      for (let i = Math.max(0, Math.floor(t0 * sr)); i < Math.max(i1, Math.floor(t0 * sr) + 1); i++) { const a = Math.abs(raw[i] || 0); if (a > m) m = a; }
      m *= norm;
    }
    out[x] = m;
  }
  return out;
}
function drawRealInput(now) {
  if (!realInputPeaks) return;
  const ctx = inputCanvas.getContext('2d');
  ctx.clearRect(0, 0, inW, inH);
  const mid = inH / 2, amp = Math.max(10, mid - 6);
  const volAmp = dbToAmp(state.detector.input);
  // Live mode: everything left of the playhead comes from the real-time
  // detector (gate gain, input peak, hits); the playhead is what you hear.
  const rtLive = !!(rtNode && inputPlaying && liveGate);
  const gateOn = rtLive ? state.detector.gate : state.detector.gate && !!realGateEnv;
  const detailThr = detailThreshold();
  const winDur = Math.min(detWin, realInputDuration || detWin);
  const playT = inputPlaying && audioCtx
    ? clamp(audioCtx.currentTime - inputStartCtxTime - (rtLive ? RT_LOOKAHEAD : 0), 0, realInputDuration)
    : 0;
  // While playing, the 2 s window follows the playhead; at rest it shows the
  // first 2 s of the input when stopped.
  const winStart = !inputPlaying ? (detViewStart = clamp(detViewStart, 0, Math.max(0, realInputDuration - winDur)))
    : rtLive ? clamp(playT - winDur, 0, Math.max(0, realInputDuration - winDur))
    : clamp(playT - winDur * .5, 0, Math.max(0, realInputDuration - winDur));
  const tAt = x => winStart + (x / inW) * winDur;
  const xAt = t => ((t - winStart) / winDur) * inW;
  const waveAmp = amp / DETAIL_MAX;
  const colPk = inputColumnPeaks(winStart, winDur, Math.max(1, Math.ceil(inW)));
  const rawPeakAt = x => Math.min(1, colPk[Math.min(colPk.length - 1, x | 0)] * volAmp);
  const gateAtX = x => {
    const t = tAt(x);
    if (rtLive) return t <= playT && Math.floor(t * 1000) <= liveKnownBlock ? liveGateAt(t) : 0;
    return state.detector.gate ? gateValueAt(t) : 1;
  };
  const peakAt = x => rawPeakAt(x) * gateAtX(x);
  const traceWave = peakFn => {
    ctx.beginPath();
    for (let x = 0; x < inW; x++) {
      const y = mid - peakFn(x) * waveAmp;
      x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    for (let x = inW - 1; x >= 0; x--) {
      ctx.lineTo(x, mid + peakFn(x) * waveAmp * .65);
    }
    ctx.closePath();
  };
  // Blue: post-gate detector signal. Soft red ghost on top: pre-gate input.
  traceWave(peakAt);
  ctx.fillStyle = 'rgba(118,190,255,.40)';
  ctx.fill();
  traceWave(peakAt);
  ctx.strokeStyle = 'rgba(170,210,255,.28)';
  ctx.lineWidth = 1;
  ctx.stroke();
  traceWave(rawPeakAt);
  ctx.fillStyle = 'rgba(255,105,105,.075)';
  ctx.fill();
  traceWave(rawPeakAt);
  ctx.strokeStyle = 'rgba(255,125,125,.28)';
  ctx.lineWidth = .8;
  ctx.stroke();
  // zero line
  ctx.strokeStyle = 'rgba(255,255,255,.18)';
  ctx.beginPath(); ctx.moveTo(0, mid); ctx.lineTo(inW, mid); ctx.stroke();
  // Detail threshold line: fixed display level, independent of Input Volume.
  const dy = mid - detailFrac() * amp;
  ctx.setLineDash([3, 3]);
  ctx.strokeStyle = 'rgba(45,226,197,.52)';
  ctx.beginPath(); ctx.moveTo(0, dy); ctx.lineTo(inW, dy); ctx.stroke();
  ctx.setLineDash([]);
  ctx.font = '600 7px ui-monospace, Menlo, monospace';
  if (inW > 150) {
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(45,226,197,.72)';
    ctx.fillText('DETAIL', inW - 3, Math.max(9, Math.min(inH - 4, dy - 3)));
  }
  // Detected hits: orange line reaches the transient peak, not the top of the pane.
  for (const h of realHits) {
    const ht = h.peakTime ?? h.time;
    if (ht < winStart || ht > winStart + winDur) continue;
    if (rtLive && ht > playT) continue;
    const x = xAt(ht);
    // The marker height is the hit velocity, not the level of the bucket at
    // peakTime. That keeps the orange line honest even if the transient peak
    // sits between two waveform buckets.
    const peak = Math.max(.04, Math.min(1, h.peak));
    const top = mid - peak * waveAmp;
    const bottom = mid + peak * waveAmp * .65;
    ctx.strokeStyle = 'rgba(255,150,90,.55)';
    ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom); ctx.stroke();
    ctx.fillStyle = 'rgba(255,150,90,.85)';
    ctx.beginPath();
    ctx.moveTo(x, top - 4); ctx.lineTo(x - 3, top + 2); ctx.lineTo(x + 3, top + 2);
    ctx.closePath(); ctx.fill();
  }
  // Time scale, bottom right.
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(255,255,255,.32)';
  ctx.fillText(winDur < 1 ? Math.round(winDur * 1000) + ' ms' : winDur.toFixed(1) + ' s', inW - 3, inH - 4);
  ctx.textAlign = 'left';
  const imb = $('#inputMeterBar');
  const gled = $('#gateLed');
  if (inputPlaying && audioCtx) {
    const sx = clamp(xAt(playT), 0, inW);
    ctx.strokeStyle = 'rgba(45,226,197,.85)';
    ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, inH); ctx.stroke();
    const gateV = rtLive ? liveGateAt(playT) : gateValueAt(playT);
    if (gled) gled.classList.toggle('on', gateOn && gateV > .5);
    const gr = $('#grMeterBar');
    if (gr) gr.style.height = gainReductionPct(gateV) + '%';
    const led = $('#hitLed');
    const near = realHits.some(h => Math.abs(h.time - playT) < 0.006);
    if (led) led.classList.toggle('on', near);
    let peak = 0;
    if (rtLive && livePeak) {
      const end = Math.min(Math.floor(playT * 1000), liveKnownBlock);
      for (let b = Math.max(0, end - 60); b <= end; b++) peak = Math.max(peak, Math.min(1, livePeak[b]));
    } else if (realInputPeakEnv) {
      const end = clamp(Math.floor(playT / realInputDuration * realInputPeakEnv.length), 0, realInputPeakEnv.length - 1);
      const start = Math.max(0, end - Math.max(1, Math.round(0.06 * realInputBuffer.sampleRate / realInputPeakBlock)));
      for (let b = start; b <= end; b++) peak = Math.max(peak, Math.min(1, realInputPeakEnv[b]));
    } else {
      const idx = clamp(Math.floor(playT / realInputDuration * realInputPeaks.length), 0, realInputPeaks.length - 1);
      peak = Math.min(1, realInputPeaks[idx] * volAmp);
    }
    inputMeterHold = Math.max(peak, inputMeterHold * METER_HOLD);
    const db = 20 * Math.log10(Math.max(inputMeterHold, .001));
    const dbTxt = (db >= 0 ? '+' : '') + db.toFixed(0);
    const il = $('#inputLevel');
    if (il) il.textContent = dbTxt + ' dB';
    const ip = $('#inputPeakDb');
    if (ip) ip.textContent = dbTxt;
    if (imb) imb.style.height = meterPct(db) + '%';
  } else {
    inputMeterHold = 0;
    if (imb) imb.style.height = '2%';
    if (gled) gled.classList.remove('on');
    const gr = $('#grMeterBar'); if (gr) gr.style.height = '0%';
    const il = $('#inputLevel');
    if (il) il.textContent = '−48 dB';
    const ip = $('#inputPeakDb');
    if (ip) ip.textContent = '—';
  }
}

function stopInput() {
  finishGateAuto();
  inputPlaying = false;
  stopLiveTriggers();
  inputTimers.forEach(t => clearTimeout(t)); inputTimers = [];
  if (inputSource) { try { inputSource.stop(); } catch (e) {} inputSource = null; }
  activeSlotSources.slice().forEach(s => { try { s.stop(); } catch (e) {} });
  activeSlotSources = [];
  if (gateGain && audioCtx) {
    const t = audioCtx.currentTime;
    gateGain.gain.cancelScheduledValues(t);
    if (rtNode) {
      // Mute the lookahead tail still inside the detector after STOP.
      gateGain.gain.setValueAtTime(gateGain.gain.value, t);
      gateGain.gain.linearRampToValueAtTime(0, t + 0.005);
    } else gateGain.gain.setValueAtTime(1, t);
  }
  if (rtNode) {
    rtNode.port.postMessage({ type: 'stop' });
    liveGate = null; livePeak = null; liveKnownBlock = -1;
    if (audioReady) scheduleDetect(); // stopped view: static preview of the first 2 s
  }
  const btn = $('#inputPlay'); if (btn) btn.textContent = '▶ INPUT';
  const hv = $('#hitVel'); if (hv) hv.textContent = '—';
  const led = $('#hitLed'); if (led) led.classList.remove('on');
  const gled = $('#gateLed'); if (gled) gled.classList.remove('on');
  const gr = $('#grMeterBar'); if (gr) gr.style.height = '0%';
}

const LIVE_LOOKAHEAD = 0.08; // schedule hits up to 80 ms ahead
function startLiveTriggers() {
  stopLiveTriggers();
  liveLastHitTime = 0;
  liveTriggerCount = 0;
  liveLastVelocity = 0;
  liveHitTimer = setInterval(() => {
    if (!inputPlaying || !audioCtx) return;
    const playT = audioCtx.currentTime - inputStartCtxTime;
    if (playT < 0) return;
    const end = Math.min(realInputDuration, playT + LIVE_LOOKAHEAD);
    if (end <= liveLastHitTime) return;
    const due = realHits.filter(h => h.time > liveLastHitTime && h.time <= end);
    liveLastHitTime = end;
    for (const h of due) {
      const abs = inputStartCtxTime + h.time;
      // If the tab was throttled and the hit is already in the past, do not
      // dump a burst of samples; only schedule hits that are still ahead.
      if (abs < audioCtx.currentTime - 0.03) continue;
      const when = Math.max(0, abs - audioCtx.currentTime - 0.02);
      const velocity = clamp(h.velocity ?? h.peak, 0, 2);
      liveLastVelocity = velocity;
      const hv = $('#hitVel');
      if (hv) hv.textContent = Math.round(velocity * 100) + '%';
      state.slots.forEach((_, i) => playSlot(i, when, velocity, h.time));
      liveTriggerCount++;
    }
  }, 20);
}
function stopLiveTriggers() {
  if (liveHitTimer) clearInterval(liveHitTimer);
  liveHitTimer = null;
  liveLastVelocity = 0;
}
function playInput() {
  if (window.__TU_NATIVE__) { toast('En el AU el INPUT viene del host'); return; }
  if (inputPlaying) { stopInput(); return; }
  if (!realInputBuffer) { toast('Real input still loading…'); return; }
  const ctx = ensureAudio();
  if (!ctx) { toast('Audio not available'); return; }
  stopInput();
  if (detectPending) { clearTimeout(detectPending); detectPending = 0; }
  const rt = !!rtNode;
  if (!rt) detectInputHits();
  const src = ctx.createBufferSource();
  src.buffer = realInputBuffer;
  src.connect(inputGain);
  const start = ctx.currentTime + 0.06;
  inputSource = src;
  inputStartCtxTime = start;
  inputPlaying = true;
  if (rt) {
    const nb = Math.ceil(realInputDuration * 1000) + 2;
    liveGate = new Float32Array(nb).fill(1);
    livePeak = new Float32Array(nb);
    liveKnownBlock = -1; rtLate = 0;
    realHits = []; liveTriggerCount = 0; liveLastHitTime = 0; liveLastVelocity = 0;
    const el = $('#triggerCount'); if (el) el.textContent = '0';
    postDetectorParams();
    rtNode.port.postMessage({ type: 'start', start, duration: realInputDuration });
    gateGain.gain.cancelScheduledValues(ctx.currentTime);
    gateGain.gain.setValueAtTime(1, ctx.currentTime);
  }
  src.start(start);
  if (!rt) scheduleGate(start);
  const tail = rt ? RT_LOOKAHEAD : 0;
  src.onended = () => {
    if (!inputPlaying || inputSource !== src) return;
    inputTimers.push(setTimeout(() => { if (inputPlaying && inputSource === src) stopInput(); }, tail * 1000 + 50));
  };
  const btn = $('#inputPlay'); if (btn) btn.textContent = '■ STOP';
  startGateAuto();
  if (!rt) startLiveTriggers();
  inputTimers.push(setTimeout(() => { if (inputPlaying && inputSource === src) stopInput(); }, (realInputDuration + tail + 0.5) * 1000));
}

$('#inputPlay').onclick = playInput;
$('#inputWave').addEventListener('click', playInput);
// Wheel: zoom the detector waveform around the cursor (20 ms – 20 s).
// Shift+wheel or a horizontal swipe scrolls through the track while stopped.
$('#inputWave').addEventListener('wheel', e => {
  if (!realInputBuffer) return;
  e.preventDefault();
  const dur = realInputDuration;
  const win = Math.min(detWin, dur);
  const panPx = e.shiftKey ? (e.deltaY || e.deltaX) : (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : 0);
  if (panPx) {
    if (!inputPlaying) detViewStart = clamp(detViewStart + panPx / Math.max(1, inW) * win, 0, Math.max(0, dur - win));
  } else {
    const nw = clamp(win * Math.exp(e.deltaY * .0025), 0.02, Math.min(20, dur));
    if (!inputPlaying) {
      const r = inputCanvas.getBoundingClientRect();
      const frac = clamp((e.clientX - r.left) / Math.max(1, r.width), 0, 1);
      const anchor = detViewStart + frac * win;
      detViewStart = clamp(anchor - frac * nw, 0, Math.max(0, dur - nw));
    }
    detWin = nw;
  }
  if (!inputPlaying) drawRealInput(performance.now());
}, { passive: false });
audioReady = true;

// ---------- debug handles for the prototype ----------
window.__TU = state;
window.__audio = {
  get hits() { return realHits; },
  get inputDuration() { return realInputDuration; },
  get inputBuffer() { return realInputBuffer; },
  get inputMax() { return realInputMax; },
  get inputPeaks() { return realInputPeaks; },
  get peakEnv() { return realInputPeakEnv; },
  get peakBlock() { return realInputPeakBlock; },
  get sample() { return realSample; },
  get context() { return audioCtx; },
  get gateEnv() { return realGateEnv; },
  get gateBlock() { return realGateBlock; },
  get inputStart() { return inputStartCtxTime; },
  setPlayhead(t) { if (audioCtx) inputStartCtxTime = audioCtx.currentTime - clamp(t, 0, realInputDuration); },
  get live() { return { lastHit: liveLastHitTime, triggers: liveTriggerCount, playing: inputPlaying, velocity: liveLastVelocity }; },
  get nodes() { return { gateGain, rtNode, inputGain, dryGain, wetGain }; },
  get rt() { return { on: !!rtNode, late: rtLate, knownBlock: liveKnownBlock, lookahead: RT_LOOKAHEAD }; },
  get meter() {
    if (!masterAnalyser) return { peak: 0, rms: 0 };
    const buf = new Float32Array(masterAnalyser.fftSize);
    masterAnalyser.getFloatTimeDomainData(buf);
    let peak = 0, sum = 0;
    for (let i = 0; i < buf.length; i++) { const a = Math.abs(buf[i]); if (a > peak) peak = a; sum += buf[i] * buf[i]; }
    return { peak, rms: Math.sqrt(sum / buf.length) };
  },
  get gains() { return { dry: dryGain && dryGain.gain.value, wet: wetGain && wetGain.gain.value, gate: gateGain && gateGain.gain.value, input: inputGain && inputGain.gain.value }; },
  detect: detectInputHits,
  applyMix,
  playInput,
  stopInput,
  playSlot,
  get previewId() { return hoverPreview.id; },
};
window.__selectSample = selectSample;
window.__assignSample = assignSample;
window.__setTriggerOpen = setTriggerOpen;
window.__focus = focusSample;
window.__updateInspector = updateInspector;

// ---------- init ----------
function initNativeBridge() {
  if (!window.__TU_NATIVE__) return;
  // Native param index -> detector knob key.
  const KNOB_BY_IDX = { 0: 'sens', 1: 'retrig', 2: 'detail', 4: 'low', 5: 'high', 6: 'supp', 7: 'input', 11: 'attack', 13: 'release' };
  const apply = (idx, norm) => {
    const key = KNOB_BY_IDX[idx];
    if (key && knobReg[key]) {
      window.__TU_applyingNative = true;
      knobReg[key].setNorm(norm);
      window.__TU_applyingNative = false;
      return;
    }
    if (idx === 8 && window.__TU_setMasterOut) window.__TU_setMasterOut(-24 + norm * 48);
    else if (idx === 9 && window.__TU_setMix) window.__TU_setMix(norm * 100);
    else if (idx === 10 && window.__TU_setGate) window.__TU_setGate(norm >= .5);
  };
  window.addEventListener('tu-native-param', e => apply(e.detail.idx, e.detail.norm));
  // Push the current UI values once so the engine and the UI start in sync.
  if (window.__TU_sendDetector) {
    ['sens', 'retrig', 'detail', 'low', 'high', 'supp', 'input', 'attack', 'release']
      .forEach(k => window.__TU_sendDetector(k, state.detector[k]));
  }
  if (window.__TU_sendMaster) {
    window.__TU_sendMaster('outputGain', masterOut);
    window.__TU_sendMaster('mix', state.detector.mix);
    window.__TU_sendMaster('gateOn', state.detector.gate ? 1 : 0);
  }
  state.slots.forEach((s, i) => { if (window.__TU_sendSlot) window.__TU_sendSlot(i, s); });
  window.__TU_nativeBridgeReady = true;
  // Pull the persisted library once the WebView channel is ready.
  if (typeof SAMFUI === 'function') SAMFUI(10, 0, 0);
}

function init() {
  renderSlots();
  analyzeAllPhase();
  renderFolderTree();
  renderFileList();
  setInspectorTab('env');
  const first = samples.find(s => s.category === 'Kick') || samples[0];
  selectSample(first);
  updateInspector();
  requestAnimationFrame(() => {
    resizeCanvas();
    new ResizeObserver(resizeCanvas).observe(wrap);
    resizeInput();
    new ResizeObserver(resizeInput).observe(inputCanvas.parentElement);
    if (state.viewMode === 'trigger') startInputLoop();
  });
  loadRealAudio();
  if (window.__TU_NATIVE__) {
    // Wait for iPlug2's "params" message (the WebView channel is ready) before
    // pushing values; messages sent during page load are dropped.
    let started = false;
    const start = () => { if (!started) { started = true; initNativeBridge(); } };
    window.addEventListener('tu-native-message', e => {
      const id = e.detail && e.detail.id;
      if (id === 'params' || id === 'init') start();
    });
    setTimeout(start, 1500);
  }
}
// ---------- ui tooltip: replaces native title attributes with a styled tip ----------
(function uiTips() {
  const tip = $('#uiTip');
  let target = null, timer = 0;
  const textOf = el => {
    const t = el.getAttribute('title');
    if (t) { el.dataset.tip = t; el.removeAttribute('title'); }
    return el.dataset.tip || '';
  };
  const place = () => {
    if (!target) return;
    const r = target.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight, gap = 10;
    const below = r.bottom + gap + h < innerHeight;
    const cx = r.left + r.width / 2;
    const x = Math.min(Math.max(cx - w / 2, 8), innerWidth - w - 8);
    tip.dataset.side = below ? 'bottom' : 'top';
    tip.style.left = x + 'px';
    tip.style.top = (below ? r.bottom + gap : r.top - gap - h) + 'px';
    tip.style.setProperty('--arrow-x', Math.min(Math.max(cx - x, 12), w - 12) + 'px');
  };
  const show = el => {
    const text = textOf(el);
    if (!text) return hide();
    target = el;
    tip.textContent = text;
    if (el.dataset.kbd) {
      const k = document.createElement('span');
      k.className = 'tip-kbd';
      k.innerHTML = keyHintHTML(el.dataset.kbd);
      tip.append(k);
    }
    place();
    clearTimeout(timer); timer = setTimeout(() => tip.classList.add('show'), 250);
  };
  const hide = () => { target = null; clearTimeout(timer); tip.classList.remove('show'); };
  document.addEventListener('mouseover', e => {
    const el = e.target.closest('[title],[data-tip]');
    if (el !== target) el ? show(el) : hide();
  });
  document.addEventListener('focusin', e => {
    const el = e.target.closest('[title],[data-tip]');
    el ? show(el) : hide();
  });
  document.addEventListener('focusout', hide);
  document.addEventListener('mousedown', hide);
  // Text can change on click (e.g. File search <-> Back to HOME): refresh it.
  document.addEventListener('click', () => requestAnimationFrame(() => {
    const el = document.querySelector('[data-tip]:hover');
    if (el && el.getAttribute('title')) show(el);
  }));
  addEventListener('scroll', hide, true);
})();

// ---------- liquid glass: per-element displacement map that bends the backdrop near the edge ----------
(function liquidGlass() {
  // backdrop-filter:url() only works in Chromium; others keep the plain glass look.
  if (!navigator.userAgentData) return;
  const defs = $('#lgDefs'), NS = 'http://www.w3.org/2000/svg';
  const opts = { bandMax: 16, scalePill: 12, scalePanel: 18 };
  document.querySelectorAll('.liquid-glass').forEach((el, n) => {
    const id = 'lgRefract' + n;
    const filter = document.createElementNS(NS, 'filter');
    filter.setAttribute('id', id);
    ['x', 'y'].forEach(k => filter.setAttribute(k, '0'));
    ['width', 'height'].forEach(k => filter.setAttribute(k, '100%'));
    filter.setAttribute('color-interpolation-filters', 'sRGB');
    const img = document.createElementNS(NS, 'feImage');
    img.setAttribute('preserveAspectRatio', 'none'); img.setAttribute('result', 'map');
    const disp = document.createElementNS(NS, 'feDisplacementMap');
    disp.setAttribute('in', 'SourceGraphic'); disp.setAttribute('in2', 'map');
    disp.setAttribute('xChannelSelector', 'R'); disp.setAttribute('yChannelSelector', 'G');
    filter.append(img, disp); defs.append(filter);

    const build = () => {
      const w = Math.round(el.offsetWidth), h = Math.round(el.offsetHeight);
      if (!w || !h) return;
      const R = Math.min(parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0, w / 2, h / 2);
      const band = Math.min(opts.bandMax, R || opts.bandMax, h / 5 + 4);
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const ctx = c.getContext('2d'), data = ctx.createImageData(w, h), px = data.data;
      const hx = w / 2 - R, hy = h / 2 - R;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        // rounded-rect SDF: distance to edge (d) and outward normal (nx, ny)
        const ox = x + .5 - w / 2, oy = y + .5 - h / 2;
        const qx = Math.abs(ox) - hx, qy = Math.abs(oy) - hy;
        let d, nx, ny;
        if (qx > 0 && qy > 0) { const l = Math.hypot(qx, qy); d = R - l; nx = qx / l; ny = qy / l; }
        else if (qx > qy) { d = R - qx; nx = 1; ny = 0; } else { d = R - qy; nx = 0; ny = 1; }
        nx *= Math.sign(ox) || 1; ny *= Math.sign(oy) || 1;
        const t = d < band ? Math.pow(1 - Math.max(d, 0) / band, 2) : 0;
        const i = (y * w + x) * 4;
        px[i] = 128 - nx * t * 127; px[i + 1] = 128 - ny * t * 127; px[i + 2] = 128; px[i + 3] = 255;
      }
      ctx.putImageData(data, 0, 0);
      img.setAttribute('href', c.toDataURL());
      img.setAttribute('width', w); img.setAttribute('height', h);
      disp.setAttribute('scale', h < 80 ? opts.scalePill : opts.scalePanel);
      el.style.setProperty('--lg-filter', `url(#${id})`);
      el.classList.add('lg-refract');
    };
    build();
    new ResizeObserver(build).observe(el);
  });
})();

init();
