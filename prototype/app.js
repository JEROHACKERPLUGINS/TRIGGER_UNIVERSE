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
  let prefs;
  try { prefs = Object.assign(d, JSON.parse(localStorage.getItem('tu-visual') || '{}')); }
  catch (e) { prefs = d; }
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
  prevView: 'universe',
  fileFolder: 'ALL',
  expanded: new Set(['ALL', 'SAMPLES FOLDER', 'SAMPLES FOLDER/Kicks', 'SAMPLES FOLDER/Snares', 'SAMPLES FOLDER/Hats', 'SAMPLES FOLDER/Percussion']),
  filters: { search: '' },
  view: { zoom: 1, panX: 0, panY: 0 },
  drag: null,
  dragAlt: false,
  pan: null,
  popoverSlot: null,
  autoRef: 'INPUT',
  autoTiming: false,
  detector: { attack: .5, hold: 4, release: 450, sens: 51, retrig: 16, detail: 14, low: 20, high: 20000, supp: 0, input: 0, mix: 100, gate: true, gateThreshold: -24 },
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
    polarity: false, shift: 0, offset: 0,
    autoPhase: false, corr: 0, suggestedLag: 0,
    adsr: { a: 0, d: 120, end: 800, s: .5, p: 1, e: 0 },
    start: 0, end: 1, fadeIn: 0, fadeOut: 0,
    reverse: false,
    tone: 0, cut: 50, velSens: 100, gain: 0,
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
  if (open) $('#visualPanel').classList.remove('show');
  $('#settingsMenu').classList.toggle('show', open);
  $('#settingsBtn').classList.toggle('active', open);
}

function dismissWindows() {
  stopScrub();
  hideSimilarity();
  setSettingsOpen(false);
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

window.addEventListener('mouseup', e => {
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
});

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
  const off = s.offset ? `${s.offset > 0 ? '+' : ''}${s.offset.toFixed(1)}ms` : '';
  const shift = s.shift || (s.polarity ? 180 : 0);
  if (!shift && !s.polarity) return off || '—';
  const label = `${shift}°`;
  return off ? `${label} ${off}` : label;
}

function renderSlots() {
  const host = $('#slots');
  if (!host) return;
  host.innerHTML = state.slots.map((s, i) => {
    const smp = slotSample(s);
    const color = smp ? CAT[smp.category].color : '';
    const sel = i === state.selectedSlot ? ' selected' : '';
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

function renderFaders() {
  const host = $('#faderBank');
  if (!host) return;
  slotMeterVals.fill(-1);
  const anySolo = state.slots.some(s => s.solo);
  host.innerHTML = state.slots.map((s, i) => {
    const smp = slotSample(s);
    const color = smp ? CAT[smp.category].color : '';
    const sel = i === state.selectedSlot ? ' selected' : '';
    const dim = (anySolo && !s.solo) || s.mute ? ' dim' : '';
    const empty = smp ? '' : ' empty';
    const ph = phaseBadge(s);
    return `
      <div class="slot-fader${sel}${dim}${empty}" data-slot="${i}">
        <div class="sf-head">
          <span class="sf-num">${String(i + 1).padStart(2, '0')}</span>
          ${smp ? `<span class="sf-dot" style="background:${color};color:${color}"></span>` : ''}
          <span class="sf-name">${smp ? smp.name : 'EMPTY'}</span>
        </div>
        <div class="sf-body">
          <div class="sf-meter"><i id="meter-${i}" style="height:0%"></i></div>
          <div class="sf-track"><input class="sf-range" id="fader-${i}" data-slot="${i}" type="range" min="-60" max="6" step="0.1" value="${s.level}" aria-label="Slot ${i + 1} level"></div>
        </div>
        <div class="sf-foot"><span class="sf-level" id="slotLevel-${i}">${fmtDb(s.level)}</span>${ph === '—' ? '' : `<span class="sf-phase">${ph}</span>`}</div>
        <div class="sf-btns">
          <button data-act="m" data-slot="${i}" class="${s.mute ? 'on' : ''}" title="Mute">M</button>
          <button data-act="s" data-slot="${i}" class="${s.solo ? 'on solo' : ''}" title="Solo">S</button>
          <button data-act="o" data-slot="${i}" class="${s.polarity ? 'on phase' : ''}" title="Polarity">Ø</button>
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
  s.autoPhase = false; s.corr = 0; s.suggestedLag = 0;
  delete s._forwardEnv;
  s.polarity = false; s.shift = 0; s.offset = 0;
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
  if (e.detail > 1) return; // do not audition twice on the way to a double-click
  const i = +slot.dataset.slot;
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
  const r = $(`#fader-${i}`); if (r) r.value = s.level;
  const lv = $(`#slotLevel-${i}`); if (lv) lv.textContent = fmtDb(s.level);
  syncSlotAudio(i);
}
$('#faderBank').addEventListener('input', e => {
  const r = e.target.closest('.sf-range');
  if (!r) return;
  setFaderLevel(+r.dataset.slot, +r.value);
});
$('#faderBank').addEventListener('pointerdown', e => {
  const r = e.target.closest('.sf-range');
  if (!r || !e.altKey) return;
  e.preventDefault(); e.stopPropagation();
  setFaderLevel(+r.dataset.slot, 0);
});

$('#faderBank').addEventListener('click', e => {
  const range = e.target.closest('.sf-range');
  if (range && e.altKey) {
    e.preventDefault(); e.stopPropagation();
    setFaderLevel(+range.dataset.slot, 0);
    return;
  }
  const btn = e.target.closest('button[data-act]');
  if (btn) {
    e.stopPropagation();
    const i = +btn.dataset.slot, s = state.slots[i];
    if (btn.dataset.act === 'm') s.mute = !s.mute;
    if (btn.dataset.act === 's') s.solo = !s.solo;
    if (btn.dataset.act === 'o') {
      s.polarity = !s.polarity;
      s.shift = s.polarity ? 180 : 0;
    }
    selectSlot(i);
    renderSlots();
    syncAllSlotAudio();
    updateInspector();
    return;
  }
  if (e.target.closest('.num-editable')) return;
  const strip = e.target.closest('.slot-fader[data-slot]');
  if (!strip) return;
  selectSlot(+strip.dataset.slot);
});

function assignSample(i, smp) {
  const s = state.slots[i];
  s.sampleId = smp.id;
  s.label = `SLOT ${String(i + 1).padStart(2, '0')}`;
  s.mute = false; s.solo = false;
  s.tune = 0;
  s.adsr = { a: 0, d: 120, end: 0, s: .5, p: 1, e: 0 };
  s.start = 0; s.end = 1; s.fadeIn = 0; s.fadeOut = 0;
  s.reverse = false;
  s.tone = 0; s.cut = 50; s.velSens = 100; s.gain = 0;
  s.playback = 'one-shot'; s.loop = false;
  delete s._forwardEnv;
  s.polarity = false; s.shift = 0; s.offset = 0;
  s.autoPhase = false; s.corr = 0; s.suggestedLag = 0;
  fitAdsrToSample(s);
  selectSlot(i);
  applyAutoPhase(i, state.autoRef, true);
  if (state.selectedSlot === i && $('.inspector').classList.contains('show')) updateInspector();
  toast(`${smp.name} → TRIGGER SLOT ${String(i + 1).padStart(2, '0')} · auto phase ready`);
}

// ---------- AUTO PHASE ----------
function applyAutoPhase(i, ref, silent) {
  const s = state.slots[i];
  const smp = slotSample(s);
  if (!smp) { if (!silent) toast('Slot is empty'); return; }
  const seed = smp.id * (ref === 'SLOT 1' ? 13 : 17);
  const corr = 0.62 + ((seed * 7) % 34) / 100;
  let lag = ((seed * 29) % 70) / 10 - 1.5;
  if (ref === 'SLOT 1' && i !== 0) lag += 0.7;
  const invert = (seed % 4 === 0);
  s.polarity = invert;
  s.shift = invert ? 180 : 0;
  s.suggestedLag = +lag.toFixed(1);
  s.offset = state.autoTiming ? +lag.toFixed(1) : 0;
  s.autoPhase = true;
  s.corr = +corr.toFixed(2);
  s.autoRef = ref;
  renderSlots();
  syncAllSlotAudio();
  if (state.selectedSlot === i && $('.inspector').classList.contains('show')) updateInspector();
  if (!silent) {
    const timing = state.autoTiming ? `${lag >= 0 ? '+' : ''}${lag.toFixed(1)} ms · ` : '';
    toast(`AUTO PHASE ${invert ? '180° ' : ''}${timing}corr ${corr.toFixed(2)}`);
  }
}

$('#autoPhaseAll').onclick = () => {
  state.slots.forEach((s, i) => {
    if (!slotSample(s)) return;
    const smp = slotSample(s);
    const seed = smp.id * 17;
    s.polarity = (seed % 4 === 0);
    s.shift = s.polarity ? 180 : 0;
    s.suggestedLag = +((((seed * 29) % 70) / 10 - 1.5).toFixed(1));
    s.offset = state.autoTiming ? s.suggestedLag : 0;
    s.autoPhase = true;
    s.corr = +(0.62 + ((seed * 7) % 34) / 100).toFixed(2);
    s.autoRef = 'INPUT';
  });
  renderSlots();
  syncAllSlotAudio();
  if ($('.inspector').classList.contains('show')) updateInspector();
  setSettingsOpen(false);
  const loaded = state.slots.filter(s => slotSample(s)).length;
  toast(`AUTO PHASE applied to ${loaded} layer${loaded === 1 ? '' : 's'} · ${state.autoTiming ? 'polarity + timing' : 'polarity only'} · ref INPUT`);
};

// ---------- slot popover ----------
function closeSlotPopover() {
  const p = $('#slotPopover');
  if (p) p.classList.remove('show');
  state.popoverSlot = null;
}

function openSlotPopover(i, anchor, keepPosition) {
  if (!$('#slotPopover')) return;
  if (!keepPosition && state.popoverSlot === i && $('#slotPopover').classList.contains('show')) {
    closeSlotPopover(); return;
  }
  const s = state.slots[i];
  const smp = slotSample(s);
  const pop = $('#slotPopover');
  pop.innerHTML = `
    <div class="sp-head">
      <span class="sp-badge">TRIGGER ${String(i + 1).padStart(2, '0')}</span>
      <span class="sp-name">${s.label}</span>
      <button class="sp-close" id="spClose">×</button>
    </div>
    <div class="sp-sample">${smp ? smp.name + ' · ' + smp.path : 'empty slot'}</div>
    <div class="sp-grid">
      <label class="sp-row">LEVEL<input type="range" id="spLevel" min="-60" max="6" step="0.1" value="${s.level}"><b id="spLevelVal">${fmtDb(s.level)}</b></label>
      <label class="sp-row">PAN<input type="range" id="spPan" min="-100" max="100" step="1" value="${s.pan}"><b id="spPanVal">${panLabel(s.pan)}</b></label>
      <label class="sp-row">TUNE<input type="range" id="spTune" min="-24" max="24" step="0.01" value="${s.tune}"><b id="spTuneVal">${s.tune.toFixed(2)} st</b></label>
    </div>
    <div class="sp-btns">
      <button id="spM" class="${s.mute ? 'on' : ''}">MUTE</button>
      <button id="spS" class="${s.solo ? 'on solo' : ''}">SOLO</button>
      <button id="spO" class="${s.polarity ? 'on phase' : ''}">Ø POL</button>
    </div>
    <div class="sp-phase">
      <div class="sp-phase-head">
        <span>AUTO PHASE</span>
        <span>REF <select id="spRef">
          <option${state.autoRef === 'INPUT' ? ' selected' : ''}>INPUT</option>
          <option${state.autoRef === 'SLOT 1' ? ' selected' : ''}>SLOT 1</option>
        </select></span>
      </div>
      <div class="sp-auto-row">
        <button class="sp-auto" id="spAuto">RE-ANALYZE &amp; ALIGN</button>
        <button class="sp-timing ${state.autoTiming ? 'on' : ''}" id="spTiming" title="Apply the measured timing offset">TIMING</button>
      </div>
      <div class="sp-result" id="spResult">${s.autoPhase
        ? `corr <b>${s.corr.toFixed(2)}</b> · ${s.polarity ? 'Ø inverted' : 'polarity OK'} · ${s.offset !== 0
            ? `offset <b>${s.offset >= 0 ? '+' : ''}${s.offset.toFixed(1)} ms</b>`
            : `suggested <b>${(s.suggestedLag || 0) >= 0 ? '+' : ''}${(s.suggestedLag || 0).toFixed(1)} ms</b>`}`
        : 'Analyze polarity + timing against the reference.'}</div>
      <label class="sp-row" style="margin-top:6px">OFFSET<input type="range" id="spOffset" min="-5" max="50" step="0.1" value="${s.offset}"><b id="spOffsetVal">${s.offset.toFixed(1)} ms</b></label>
      <div class="sp-phase-row">
        <span class="lbl">SHIFT</span>
        <div class="seg" id="spShift">
          <button data-shift="0" class="${s.shift === 0 ? 'active' : ''}">0°</button>
          <button data-shift="90" class="${s.shift === 90 ? 'active' : ''}">90°</button>
          <button data-shift="180" class="${s.shift === 180 ? 'active' : ''}">180°</button>
          <button data-shift="260" class="${s.shift === 260 ? 'active' : ''}">260°</button>
        </div>
      </div>
    </div>`;
  pop.classList.add('show');

  if (!keepPosition || !pop.dataset.pos) {
    const w = 300, h = pop.offsetHeight || 260;
    pop.style.left = Math.round((innerWidth - w) / 2) + 'px';
    pop.style.top = Math.round(Math.max(16, (innerHeight - h) / 2 - 24)) + 'px';
    pop.dataset.pos = '1';
  }
  state.popoverSlot = i;

  $('#spClose').onclick = closeSlotPopover;
  $('#spLevel').oninput = e => {
    s.level = +e.target.value;
    $('#spLevelVal').textContent = fmtDb(s.level);
    const lv = $(`#slotLevel-${i}`); if (lv) lv.textContent = fmtDb(s.level);
    const mt = $(`#meter-${i}`); if (mt) mt.style.height = meterW(s.level) + '%';
  };
  $('#spPan').oninput = e => {
    s.pan = +e.target.value;
    $('#spPanVal').textContent = panLabel(s.pan);
    const pt = $(`#slotPt-${i}`); if (pt) pt.textContent = `${panLabel(s.pan)} · ${s.tune.toFixed(2)}`;
  };
  $('#spTune').oninput = e => {
    s.tune = +e.target.value;
    $('#spTuneVal').textContent = `${s.tune.toFixed(2)} st`;
    const pt = $(`#slotPt-${i}`); if (pt) pt.textContent = `${panLabel(s.pan)} · ${s.tune.toFixed(2)}`;
  };
  $('#spM').onclick = () => { s.mute = !s.mute; renderSlots(); openSlotPopover(i, $(`.slot[data-slot="${i}"]`), true); };
  $('#spS').onclick = () => { s.solo = !s.solo; renderSlots(); openSlotPopover(i, $(`.slot[data-slot="${i}"]`), true); };
  $('#spO').onclick = () => {
    if (s.shift === 180) { s.shift = 0; s.polarity = false; }
    else { s.shift = 180; s.polarity = true; }
    renderSlots();
    openSlotPopover(i, $(`.slot[data-slot="${i}"]`), true);
  };
  $('#spRef').onchange = e => { state.autoRef = e.target.value; };
  $('#spTiming').onclick = () => {
    state.autoTiming = !state.autoTiming;
    if (!state.autoTiming) {
      s.offset = 0;
    }
    renderSlots();
    openSlotPopover(i, $(`.slot[data-slot="${i}"]`), true);
    toast(state.autoTiming
      ? 'Timing ON · re-analyze to apply the suggested offset'
      : 'Timing OFF · offset reset to 0');
  };
  $('#spAuto').onclick = () => {
    const btn = $('#spAuto');
    btn.classList.add('running');
    btn.textContent = 'ANALYZING…';
    setTimeout(() => {
      applyAutoPhase(i, $('#spRef') ? $('#spRef').value : 'INPUT');
    }, 550);
  };
  $('#spOffset').oninput = e => {
    s.offset = +e.target.value;
    s.autoPhase = true;
    $('#spOffsetVal').textContent = `${s.offset.toFixed(1)} ms`;
    renderSlots();
  };
  $('#spShift').onclick = e => {
    const b = e.target.closest('button[data-shift]');
    if (!b) return;
    s.shift = +b.dataset.shift;
    s.polarity = (s.shift === 180);
    renderSlots();
    openSlotPopover(i, $(`.slot[data-slot="${i}"]`), true);
  };

  bindNumericEdit($('#spLevelVal'), {
    get: () => s.level,
    set: v => {
      s.level = v;
      const r = $('#spLevel'); if (r) r.value = v;
      const lab = $('#spLevelVal'); if (lab) lab.textContent = fmtDb(v);
      const lv = $(`#slotLevel-${i}`); if (lv) lv.textContent = fmtDb(v);
      const mt = $(`#meter-${i}`); if (mt) mt.style.height = meterW(v) + '%';
      syncSlotAudio(i);
    },
    min: -60, max: 6, step: .1, unit: 'dB', decimals: 1, default: 0,
  });
  bindNumericEdit($('#spPanVal'), {
    get: () => s.pan,
    set: v => {
      s.pan = v;
      const r = $('#spPan'); if (r) r.value = v;
      const lab = $('#spPanVal'); if (lab) lab.textContent = panLabel(v);
      const pt = $(`#slotPt-${i}`); if (pt) pt.textContent = `${panLabel(v)} · ${s.tune.toFixed(2)}`;
      syncSlotAudio(i);
    },
    min: -100, max: 100, step: 1, decimals: 0, default: 0,
  });
  bindNumericEdit($('#spTuneVal'), {
    get: () => s.tune,
    set: v => {
      s.tune = v;
      const r = $('#spTune'); if (r) r.value = v;
      const lab = $('#spTuneVal'); if (lab) lab.textContent = `${v.toFixed(2)} st`;
      const pt = $(`#slotPt-${i}`); if (pt) pt.textContent = `${panLabel(s.pan)} · ${v.toFixed(2)}`;
      syncSlotAudio(i);
    },
    min: -24, max: 24, step: .01, unit: 'st', decimals: 2, default: 0,
  });
  bindNumericEdit($('#spOffsetVal'), {
    get: () => s.offset,
    set: v => {
      s.offset = v;
      s.autoPhase = true;
      const r = $('#spOffset'); if (r) r.value = v;
      const lab = $('#spOffsetVal'); if (lab) lab.textContent = `${v.toFixed(1)} ms`;
      renderSlots();
    },
    min: -5, max: 50, step: .1, unit: 'ms', decimals: 1, default: 0,
  });
}

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
    <span class="tree-label">${node.name}</span>
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
  $('#folderTree').innerHTML = fav + renderTreeNode(tree, 0);
}
$('#folderTree').addEventListener('click', e => {
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
  toast('Choose the LOCATION SAMPLES FOLDER (demo) · tree mirrors its subfolders');
};

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
      <span class="fn"><i class="fdot cat-mark" style="background:${color};color:${color};--shape:${SHAPE_CLIP[CAT_SHAPE[s.category]]}"></i><span>${s.name}</span></span>
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
  trigger:  [['1–8', 'Select slot'], ['Space', 'Play input'], ['Double-click', 'Edit value'], ['Esc', 'Back']],
  files:    [['Space', 'Audition'], ['1–8', 'To a slot'], ['Esc', 'Home']],
  scrub:    [['Drag', 'Scrub'], ['⌥+Drag', 'To a slot']],
  similar:  [['← →', 'Similar'], ['Space', 'Audition'], ['1–8', 'To a slot'], ['Esc', 'Close']],
  hover:    [['Click', 'Audition'], ['⌥+Drag', 'To a slot']],
  universe: [['Scroll', 'Zoom'], ['/', 'Search'], ['F', 'Files'], ['T', 'Trigger']],
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
    const i = +k - 1;
    if (inTrigger) selectSlot(i);
    else if (state.selectedSample) assignSample(i, state.selectedSample);
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

  $('#slotRef').value = state.autoRef;
  $('#slotTiming').classList.toggle('on', state.autoTiming);
  $('#slotOffset').value = slot.offset;
  $('#slotOffsetVal').textContent = `${slot.offset.toFixed(1)} ms`;
  $$('#slotShift button').forEach(b => b.classList.toggle('active', +b.dataset.shift === slot.shift));
  $('#slotResult').innerHTML = slot.autoPhase
    ? `corr <b>${slot.corr.toFixed(2)}</b> · ${slot.polarity ? '180° inverted' : 'polarity OK'} · ${slot.offset !== 0
        ? `offset <b>${slot.offset >= 0 ? '+' : ''}${slot.offset.toFixed(1)} ms</b>`
        : `suggested <b>${(slot.suggestedLag || 0) >= 0 ? '+' : ''}${(slot.suggestedLag || 0).toFixed(1)} ms</b>`}`
    : 'Select a sample in this slot.';

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

function waveGeom() {
  const W = 600, H = 170, padX = 14, top = 20, bottom = 150;
  return { W, H, padX, top, bottom, mid: (top + bottom) / 2, amp: (bottom - top) / 2 };
}

function renderSampleEditor() {
  const svg = $('#wave');
  if (!svg) return;
  const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
  const slot = currentSlot();
  const smp = slot ? slotSample(slot) : null;
  if (!slot || !smp) {
    svg.innerHTML = '';
    ['startVal', 'endVal', 'fadeInVal', 'fadeOutVal', 'aVal', 'dVal', 'rVal'].forEach(id => set(id, '—'));
    return;
  }
  const { W, H, padX, top, bottom, mid, amp } = waveGeom();
  const waveAmp = amp * .82;
  let arr = sampleWave(smp);
  if (slot.reverse) arr = arr.slice().reverse();
  const color = CAT[smp.category].color;
  const startX = padX + slot.start * (W - 2 * padX);
  const endX = padX + slot.end * (W - 2 * padX);
  const span = Math.max(1, endX - startX);
  const denom = Math.max(1, arr.length - 1);
  const topPts = [], botPts = [];
  for (let i = 0; i < arr.length; i++) {
    const x = padX + (i / denom) * (W - 2 * padX);
    const v = arr[i] * waveAmp;
    topPts.push([x, mid - v]);
    botPts.push([x, mid + v]);
  }
  const d = `M ${topPts.map(p => p.join(' ')).join(' L ')} L ${botPts.reverse().map(p => p.join(' ')).join(' L ')} Z`;

  const total = envTotalMs();
  const a = clamp(slot.adsr.a, 0, total);
  const dd = clamp(slot.adsr.d, 0, Math.max(0, total - a));
  const endMs = clamp(slot.adsr.end, a + dd, total);
  const sLvl = clamp(slot.adsr.s, 0, 1);
  const pLvl = clamp(slot.adsr.p, sLvl, 1);
  const eLvl = clamp(slot.adsr.e, 0, sLvl);
  const fadeIn = clamp(slot.fadeIn, 0, total);
  const fadeOut = clamp(slot.fadeOut, 0, total);
  const envX = t => startX + (clamp(t, 0, total) / total) * span;
  const envY = v => bottom - clamp(v, 0, 1) * (bottom - top);
  const baseAt = t => {
    if (t <= 0) return a > 0 ? 0 : pLvl;
    if (a > 0 && t < a) return pLvl * (t / a);
    if (t < a + dd) return pLvl + (sLvl - pLvl) * ((t - a) / Math.max(1, dd));
    if (t <= endMs) return sLvl + (eLvl - sLvl) * ((t - a - dd) / Math.max(1, endMs - a - dd));
    return 0;
  };
  const fadeAt = t => {
    let g = 1;
    if (fadeIn > 0) g *= clamp(t / fadeIn, 0, 1);
    if (fadeOut > 0) g *= clamp((total - t) / fadeOut, 0, 1);
    return g;
  };
  const gainAt = t => clamp(baseAt(t) * fadeAt(t), 0, 1);
  const times = new Set();
  const N = 160;
  for (let i = 0; i <= N; i++) times.add(total * i / N);
  [0, a, a + dd, endMs, Math.min(total, endMs + .5), fadeIn, total - fadeOut].forEach(t => {
    if (t >= 0 && t <= total) times.add(t);
  });
  const pts = [...times].sort((x, y) => x - y).map(t => [envX(t), envY(gainAt(t))]);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  const area = `${line} L ${endX.toFixed(1)} ${bottom} L ${startX.toFixed(1)} ${bottom} Z`;
  const basePts = [
    [envX(0), envY(0)],
    [envX(a), envY(pLvl)],
    [envX(a + dd), envY(sLvl)],
    [envX(endMs), envY(eLvl)]
  ];
  const baseLine = basePts.map((p, i) => `${i ? 'L' : 'M'} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  const fInX = envX(fadeIn), fOutX = envX(total - fadeOut);
  const fadeY = top + 13;
  const trimY = Math.max(4, top - 12);

  svg.innerHTML = `
    <defs>
      <linearGradient id="wg" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${color}" stop-opacity=".46"/>
        <stop offset="1" stop-color="${color}" stop-opacity=".07"/>
      </linearGradient>
      <linearGradient id="eg" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#2DE2C5" stop-opacity=".32"/>
        <stop offset="1" stop-color="#2DE2C5" stop-opacity=".035"/>
      </linearGradient>
      <clipPath id="trim"><rect x="${startX}" y="0" width="${Math.max(0, span)}" height="${H}"/></clipPath>
    </defs>
    <line x1="${padX}" y1="${mid}" x2="${W - padX}" y2="${mid}" stroke="rgba(255,255,255,.06)"/>
    <line x1="${startX}" y1="${bottom}" x2="${endX}" y2="${bottom}" stroke="rgba(255,255,255,.08)"/>
    <path d="${d}" fill="rgba(255,255,255,.045)"/>
    <path d="${d}" fill="url(#wg)" clip-path="url(#trim)"/>
    <rect x="${padX}" y="0" width="${Math.max(0, startX - padX)}" height="${H}" fill="rgba(4,6,10,.64)"/>
    <rect x="${endX}" y="0" width="${Math.max(0, W - padX - endX)}" height="${H}" fill="rgba(4,6,10,.64)"/>
    <path d="${area}" fill="url(#eg)"/>
    <path d="${line}" fill="none" stroke="#2DE2C5" stroke-width="2.2" stroke-linejoin="round"/>
    <path d="${baseLine}" fill="none" stroke="rgba(45,226,197,.38)" stroke-width="1" stroke-dasharray="3 3"/>
    ${fadeIn > 0 ? `<line x1="${fInX}" y1="${top}" x2="${fInX}" y2="${bottom}" stroke="${color}" stroke-opacity=".35" stroke-dasharray="3 3"/>` : ''}
    ${fadeOut > 0 ? `<line x1="${fOutX}" y1="${top}" x2="${fOutX}" y2="${bottom}" stroke="${color}" stroke-opacity=".35" stroke-dasharray="3 3"/>` : ''}
    <line x1="${startX}" y1="${trimY}" x2="${startX}" y2="${bottom + 2}" stroke="${color}" stroke-width="1.4"/>
    <line x1="${endX}" y1="${trimY}" x2="${endX}" y2="${bottom + 2}" stroke="${color}" stroke-width="1.4"/>
    <circle data-handle="start" cx="${startX}" cy="${trimY}" r="5" fill="#fff" stroke="${color}" stroke-width="2" style="cursor:ew-resize"/>
    <circle data-handle="end" cx="${endX}" cy="${trimY}" r="5" fill="#fff" stroke="${color}" stroke-width="2" style="cursor:ew-resize"/>
    <circle data-handle="fadeIn" cx="${fInX}" cy="${fadeY}" r="3.8" fill="${color}" stroke="#0B0E14" stroke-width="1.4" style="cursor:ew-resize"/>
    <circle data-handle="fadeOut" cx="${fOutX}" cy="${fadeY}" r="3.8" fill="${color}" stroke="#0B0E14" stroke-width="1.4" style="cursor:ew-resize"/>
    <circle data-h="attack" cx="${envX(a)}" cy="${envY(pLvl)}" r="4.3" fill="#fff" stroke="#2DE2C5" stroke-width="2" style="cursor:move"/>
    <circle data-h="decay" cx="${envX(a + dd)}" cy="${envY(sLvl)}" r="4.3" fill="#fff" stroke="#2DE2C5" stroke-width="2" style="cursor:move"/>
    <circle data-h="release" cx="${envX(endMs)}" cy="${envY(eLvl)}" r="4.3" fill="#fff" stroke="#2DE2C5" stroke-width="2" style="cursor:move"/>
  `;

  set('startVal', fmtMs(slot.start * smp.dur));
  set('endVal', fmtMs(slot.end * smp.dur));
  set('fadeInVal', fmtMs(slot.fadeIn));
  set('fadeOutVal', fmtMs(slot.fadeOut));
  set('aVal', fmtMs(slot.adsr.a));
  set('dVal', fmtMs(slot.adsr.d));
  set('rVal', fmtMs(Math.max(0, endMs - a - dd)));
}

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
  const peak = clamp(slot.adsr.p ?? 1, level, 1);
  const releaseLevel = clamp(slot.adsr.e ?? 0, 0, level);
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
    slot.start = clamp(v / smp.dur, 0, slot.end - .02);
    renderWaveform();
  },
  min: 0, max: () => currentSlot().end * waveDur(), default: 0,
}, waveEditOpts));

bindNumericEdit($('#endVal'), Object.assign({
  get: () => currentSlot().end * waveDur(),
  set: v => {
    const smp = currentSlotSample(); if (!smp) return;
    const slot = currentSlot();
    slot.end = clamp(v / smp.dur, slot.start + .02, 1);
    renderWaveform();
  },
  min: () => currentSlot().start * waveDur(), max: () => waveDur(), default: () => waveDur(),
}, waveEditOpts));

bindNumericEdit($('#fadeInVal'), Object.assign({
  get: () => currentSlot().fadeIn,
  set: v => {
    const smp = currentSlotSample(); if (!smp) return;
    const slot = currentSlot();
    slot.fadeIn = clamp(v, 0, (slot.end - slot.start) * smp.dur);
    renderWaveform();
  },
  min: 0, max: () => { const slot = currentSlot(); return (slot.end - slot.start) * waveDur(); }, default: 0,
}, waveEditOpts));

bindNumericEdit($('#fadeOutVal'), Object.assign({
  get: () => currentSlot().fadeOut,
  set: v => {
    const smp = currentSlotSample(); if (!smp) return;
    const slot = currentSlot();
    slot.fadeOut = clamp(v, 0, (slot.end - slot.start) * smp.dur);
    renderWaveform();
  },
  min: 0, max: () => { const slot = currentSlot(); return (slot.end - slot.start) * waveDur(); }, default: 0,
}, waveEditOpts));

$('#wave').addEventListener('pointerdown', e => {
  const trimH = e.target.closest('[data-handle]');
  const envH = e.target.closest('[data-h]');
  const smp = currentSlotSample();
  if (!trimH && !envH) {
    if (smp) beginDrag(smp, e, { keepTrigger: true, openTrigger: true });
    return;
  }
  e.preventDefault();
  const svg = $('#wave');
  const rect = svg.getBoundingClientRect();
  const slot = currentSlot();
  if (!slot || !smp) return;
  const { W, padX } = waveGeom();
  const total = envTotalMs();
  const startX = padX + slot.start * (W - 2 * padX);
  const endX = padX + slot.end * (W - 2 * padX);
  const span = Math.max(1, endX - startX);
  const startY = e.clientY;
  const startP = slot.adsr.p, startS = slot.adsr.s, startE = slot.adsr.e;
  const move = ev => {
    const px = clamp((ev.clientX - rect.left) / rect.width, 0, 1) * W;
    if (trimH) {
      const full = clamp((px - padX) / (W - 2 * padX), 0, 1);
      const trim = clamp((px - startX) / span, 0, 1);
      const key = trimH.dataset.handle;
      if (key === 'start') slot.start = clamp(full, 0, slot.end - .02);
      if (key === 'end') slot.end = clamp(full, slot.start + .02, 1);
      if (key === 'fadeIn') slot.fadeIn = clamp(trim * total, 0, total);
      if (key === 'fadeOut') slot.fadeOut = clamp((1 - trim) * total, 0, total);
    } else {
      const t = clamp((px - startX) / span, 0, 1) * total;
      const { a, d, end } = slot.adsr;
      const level = (startY - ev.clientY) / Math.max(1, rect.height);
      if (envH.dataset.h === 'attack') {
        slot.adsr.a = clamp(t, 0, Math.max(0, end - d));
        slot.adsr.p = clamp(startP + level, slot.adsr.s, 1);
      }
      if (envH.dataset.h === 'decay') {
        slot.adsr.d = clamp(t - a, 0, Math.max(0, end - a));
        slot.adsr.s = clamp(startS + level, slot.adsr.e, slot.adsr.p);
      }
      if (envH.dataset.h === 'release') {
        slot.adsr.end = clamp(t, a + d, total);
        slot.adsr.e = clamp(startE + level, 0, slot.adsr.s);
      }
    }
    renderSampleEditor();
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
});

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

// ---------- SLOT tab ----------
$('#slotRef').onchange = e => { state.autoRef = e.target.value; };
$('#slotTiming').onclick = () => {
  state.autoTiming = !state.autoTiming;
  if (!state.autoTiming) currentSlot().offset = 0;
  renderSlots(); updateInspector();
  toast(state.autoTiming ? 'Timing ON · re-analyze to apply the offset' : 'Timing OFF · offset reset to 0');
};
$('#slotAuto').onclick = () => {
  const btn = $('#slotAuto');
  const target = state.selectedSlot;
  const ref = state.autoRef;
  btn.classList.add('running');
  btn.textContent = 'ANALYZING…';
  setTimeout(() => {
    applyAutoPhase(target, ref);
    btn.classList.remove('running');
    btn.textContent = 'RE-ANALYZE';
  }, 550);
};
function setSlotOffset(v) {
  const s = currentSlot();
  s.offset = clamp(v, -5, 50);
  s.autoPhase = true;
  $('#slotOffset').value = s.offset;
  $('#slotOffsetVal').textContent = `${s.offset.toFixed(1)} ms`;
  renderSlots();
  $('#slotResult').innerHTML = `corr <b>${s.corr.toFixed(2)}</b> · ${s.polarity ? '180° inverted' : 'polarity OK'} · offset <b>${s.offset >= 0 ? '+' : ''}${s.offset.toFixed(1)} ms</b>`;
}
$('#slotOffset').addEventListener('input', e => setSlotOffset(+e.target.value));
bindNumericEdit($('#slotOffsetVal'), {
  get: () => currentSlot().offset,
  set: setSlotOffset,
  min: -5, max: 50, step: .1, unit: 'ms', decimals: 1, default: 0,
});
$('#slotShift').addEventListener('click', e => {
  const b = e.target.closest('button[data-shift]');
  if (!b) return;
  const s = currentSlot();
  s.shift = +b.dataset.shift;
  s.polarity = (s.shift === 180);
  renderSlots(); syncAllSlotAudio(); updateInspector();
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
bindToneNumeric('#cut', 'cut', v => v + '%', { min: 0, max: 100, step: 1, unit: '%', decimals: 0, default: 50 });
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
      fadeIn: slot.fadeIn,
      fadeOut: slot.fadeOut,
    };
    const total = envTotalMs();
    slot.adsr = { a: 0, d: 0, end: total, s: 1, p: 1, e: 1 };
    slot.fadeIn = 0; slot.fadeOut = 0;
  } else if (slot._forwardEnv) {
    slot.adsr = { ...slot._forwardEnv.adsr };
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
  { key: 'hold',      label: 'HOLD',      min: 0,   max: 500, val: 4,     unit: 'ms', fmt: v => fmtMs(v), step: 1,  decimals: 0, group: 'gate',
    tip: 'GATE HOLD · time the gate stays open after attack' },
  { key: 'release',   label: 'RELEASE',   min: 0,   max: 2000, val: 450,   unit: 'ms', fmt: v => fmtMs(v), step: 1,  decimals: 0, group: 'gate',
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
  { key: 'retrig',    label: 'RETRIGGER', min: 0,   max: 1000, val: 16,    unit: 'ms', fmt: v => Math.round(v) + ' ms', group: 'detect',
    tip: 'RETRIGGER · blind window after each hit (audio only, no graphic)' },
  { key: 'sens',      label: 'SENSITIVITY',min: 0,  max: 100, val: 51,    unit: '%',  fmt: v => Math.round(v) + '%', group: 'detect',
    tip: 'SENSITIVITY · dynamic range of the triggered samples. Low = fixed level, high = wide dynamics' }
];

function makeKnob(cfg) {
  const el = document.createElement('div');
  el.className = 'knob';
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
  let sy = 0, sn = 0;
  dial.addEventListener('pointerdown', e => {
    if (e.altKey) return;
    e.preventDefault(); sy = e.clientY; sn = toNorm(v);
    dial.setPointerCapture(e.pointerId);
  });
  el.addEventListener('click', e => {
    if (!e.altKey) return;
    e.preventDefault(); e.stopPropagation();
    if (val._numReset) val._numReset();
  });
  dial.addEventListener('pointermove', e => {
    if (!dial.hasPointerCapture(e.pointerId)) return;
    const n = clamp(sn + (sy - e.clientY) / 110, 0, 1);
    v = fromNorm(n); render();
  });
  return el;
}
(function renderDetectorKnobs() {
  const target = { gate: '#detKnobsGate', input: '#detKnobsInput', filter: '#detKnobsFilter', detect: '#detKnobsDetect' };
  DET.forEach(c => { const host = $(target[c.group]); if (host) host.appendChild(makeKnob(c)); });
})();

function updateGateButton() {
  const btn = $('#gateBtn');
  if (!btn) return;
  btn.classList.toggle('on', state.detector.gate);
  btn.textContent = state.detector.gate ? 'ON' : 'OFF';
}
$('#gateBtn').onclick = () => {
  state.detector.gate = !state.detector.gate;
  updateGateButton();
  detectInputHits();
  if (inputPlaying) rescheduleGate();
  if (state.detector.gate && state.detector.mix >= 99) toast('GATE applies to the original input — lower MIX to hear it');
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
  };
  set(state.detector.mix);
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
  const atk = Math.max(0, state.detector.attack / 1000);
  const hold = Math.max(0, state.detector.hold / 1000);
  const rel = Math.max(0, state.detector.release / 1000);
  const dt = block / sr;
  let gain = 0, holdLeft = 0;
  for (let b = 0; b < n; b++) {
    // Open one block early: the 1 ms curve then starts at 1 before the
    // transient, so ATTACK 0 never clips the first samples of the hit.
    const open = peaks[b] >= thr || (b + 1 < n && peaks[b + 1] >= thr);
    if (open) holdLeft = hold;
    const target = (open || holdLeft > 0) ? 1 : 0;
    if (!open && holdLeft > 0) holdLeft = Math.max(0, holdLeft - dt);
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
function setGateThreshold(v) {
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
  setGateThreshold(state.detector.gateThreshold);
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
    setGateThreshold(-24);
  });
  bindNumericEdit($('#gateThreshVal'), {
    get: () => state.detector.gateThreshold,
    set: v => setGateThreshold(v),
    min: -48, max: 0, step: .5, unit: 'dB', decimals: 1, default: -24,
  });
})();
function gateValueAt(t) {
  if (!state.detector.gate || !realGateEnv || !realInputDuration) return 1;
  const idx = clamp(Math.floor(t / realInputDuration * realGateEnv.length), 0, realGateEnv.length - 1);
  return realGateEnv[idx];
}
function scheduleGate(startTime) {
  if (!gateGain || !audioCtx) return;
  gateGain.gain.cancelScheduledValues(audioCtx.currentTime);
  gateGain.gain.setValueAtTime(1, audioCtx.currentTime);
  if (!state.detector.gate || !realGateEnv || !realInputBuffer) return;
  const blockDur = realGateBlock / realInputBuffer.sampleRate;
  const duration = realGateEnv.length * blockDur;
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
  const startIdx = clamp(Math.floor((now - inputStartCtxTime) / blockDur), 0, realGateEnv.length - 1);
  const curve = realGateEnv.subarray(startIdx);
  const target = realGateEnv[startIdx];
  // Glide to the envelope value at the current playhead, then follow the new
  // curve. This avoids the click/double-hit impression when GATE is toggled.
  gateGain.gain.setValueAtTime(current, now);
  gateGain.gain.linearRampToValueAtTime(target, now + GATE_GLIDE);
  const curveStart = now + GATE_GLIDE;
  try {
    gateGain.gain.setValueCurveAtTime(curve, curveStart, curve.length * blockDur);
    return;
  } catch (e) {}
  gateGain.gain.setValueAtTime(target, curveStart);
  for (let b = startIdx + 1; b < realGateEnv.length; b++) {
    const t = inputStartCtxTime + b * blockDur;
    if (t > curveStart) gateGain.gain.linearRampToValueAtTime(realGateEnv[b], t);
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
  const loop = now => { drawInput(now); inputRAF = requestAnimationFrame(loop); };
  inputRAF = requestAnimationFrame(loop);
}
function stopInputLoop() {
  if (inputRAF) cancelAnimationFrame(inputRAF);
  inputRAF = null;
}

// ---------- top actions ----------
$('#flipAll').onclick = () => {
  state.slots.forEach(s => {
    s.polarity = !s.polarity;
    s.shift = s.polarity ? 180 : 0;
  });
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
  };
  set(0);
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
  if (open) { setSettingsOpen(false); renderVisualPanel(); }
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
  setSettingsOpen(false);
  toast('Library folders: add/remove roots (demo)');
};
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
  slotNodes = state.slots.map(() => {
    const cut = audioCtx.createBiquadFilter();
    cut.type = 'lowpass'; cut.frequency.value = 20000; cut.Q.value = 0.7;
    const tone = audioCtx.createBiquadFilter();
    tone.type = 'highshelf'; tone.frequency.value = 4000; tone.gain.value = 0;
    const level = audioCtx.createGain();
    const pan = audioCtx.createStereoPanner();
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 1024;
    cut.connect(tone).connect(level).connect(pan).connect(analyser).connect(wetGain);
    return {
      cut, tone, level, pan, analyser,
      fbuf: new Float32Array(analyser.fftSize),
      buf: new Uint8Array(analyser.fftSize),
    };
  });
  syncAllSlotAudio();
  startMeters();
  return audioCtx;
}

function syncSlotAudio(i) {
  if (!audioCtx || !slotNodes[i]) return;
  const s = state.slots[i];
  const anySolo = state.slots.some(x => x.solo);
  const active = !s.mute && (!anySolo || s.solo);
  const amp = active ? dbToAmp(s.level) : 0;
  slotNodes[i].level.gain.value = s.polarity ? -amp : amp;
  slotNodes[i].pan.pan.value = clamp(s.pan / 100, -1, 1);
  slotNodes[i].tone.gain.value = (s.tone / 100) * 12;
  slotNodes[i].cut.frequency.value = clamp(200 * Math.pow(100, s.cut / 100), 200, 20000);
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

function scheduleSlot(ctx, i, when, velocity = 1, gateStartSec = null) {
  const s = state.slots[i];
  const smp = slotSample(s);
  if (!smp) return null;
  const anySolo = state.slots.some(x => x.solo);
  if (s.mute || (anySolo && !s.solo)) return null;
  const buf = s.reverse ? getReversedBuffer(smp) : getBuffer(smp);
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
  if (node) playGate.connect(node.cut); else playGate.connect(masterGain);
  // Negative offset means "play earlier": live triggers are scheduled with
  // lookahead, so the shift can be applied as long as we do not start in the
  // past. Manual auditions clamp to the next audio block.
  const wantedT0 = ctx.currentTime + 0.02 + (when || 0) + s.offset / 1000;
  const t0 = Math.max(ctx.currentTime + 0.002, wantedT0);
  const total = len / rate;
  let a = Math.max(0.001, s.adsr.a / 1000);
  let d = Math.max(0.001, s.adsr.d / 1000);
  if (a + d > total) {
    const k = total / (a + d);
    a *= k; d *= k;
  }
  const envEndSec = clamp((s.adsr.end || (a + d) * 1000) / 1000, a + d, total);
  // Loop mode repeats the trimmed sample for up to two seconds. The envelope
  // must stay open across the loop; using envEndSec would silence it after the
  // first pass.
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
  const peak = base * clamp(s.adsr.p ?? 1, 0, 1);
  const level = base * clamp(s.adsr.s ?? .5, 0, 1);
  const releaseLevel = base * clamp(s.adsr.e ?? 0, 0, 1);
  const g = env.gain;
  g.setValueAtTime(0, t0);
  g.linearRampToValueAtTime(peak, t0 + a);
  g.linearRampToValueAtTime(level, t0 + a + d);
  g.linearRampToValueAtTime(releaseLevel, t0 + envStopSec);
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

function playSlot(i, when = 0, velocity = 1, gateStartSec = null) {
  const ctx = ensureAudio();
  if (!ctx) return null;
  syncSlotAudio(i);
  return scheduleSlot(ctx, i, when, velocity, gateStartSec);
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
          const h = Math.round(active ? clamp(held * 100, 3, 100) : 3);
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

const INPUT_FILE = 'samples/SN_TOP_1COMMIT_17-140.wav';
const SAMPLE_FILE = 'samples/SNARE.cm.wav';

async function loadRealAudio() {
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
    const [full, snareFull] = await Promise.all([
      ctx.decodeAudioData(await inputResp.arrayBuffer()),
      ctx.decodeAudioData(await sampleResp.arrayBuffer()),
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
    realSample.dur = slice.duration * 1000;
    realSample.x = clamp(normLog(realSample.dur, DUR.min, DUR.max), .002, .998);
    realSample.y = clamp(normLog(2500, BRI.min, BRI.max), .002, .998);
    detectInputHits();
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
    if (!capturing && armed && fast > thr && fast > slow * k) {
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
        supTh = peak * supp;
        hold = win + retrig;
      }
    }
    if (!armed) {
      if (hold > 0) hold--;
      if (hold <= 0 && fast < rearmLevel) armed = true;
    }
  }
  realHits = hits;
  const el = $('#triggerCount'); if (el) el.textContent = String(hits.length);
  return hits;
}

const DET_WINDOW = 2.0; // seconds visible in the detector waveform (~6 transients)
function drawRealInput(now) {
  if (!realInputPeaks) return;
  const ctx = inputCanvas.getContext('2d');
  ctx.clearRect(0, 0, inW, inH);
  const mid = inH / 2, amp = Math.max(10, mid - 6);
  const volAmp = dbToAmp(state.detector.input);
  const gateOn = state.detector.gate && !!realGateEnv;
  const detailThr = detailThreshold();
  const winDur = Math.min(DET_WINDOW, realInputDuration || DET_WINDOW);
  const playT = inputPlaying && audioCtx
    ? clamp(audioCtx.currentTime - inputStartCtxTime, 0, realInputDuration)
    : 0;
  // While playing, the 2 s window follows the playhead; at rest it shows the
  // first 2 s of the input when stopped.
  const winStart = inputPlaying
    ? clamp(playT - winDur * .5, 0, Math.max(0, realInputDuration - winDur))
    : 0;
  const tAt = x => winStart + (x / inW) * winDur;
  const xAt = t => ((t - winStart) / winDur) * inW;
  const waveAmp = amp / DETAIL_MAX;
  const rawPeakAt = x => {
    const t = tAt(x);
    const idx = clamp(Math.floor(t / realInputDuration * realInputPeaks.length), 0, realInputPeaks.length - 1);
    return Math.min(1, realInputPeaks[idx] * volAmp);
  };
  const gateAtX = x => state.detector.gate ? gateValueAt(tAt(x)) : 1;
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
  ctx.fillText(winDur.toFixed(1) + ' s', inW - 3, inH - 4);
  ctx.textAlign = 'left';
  const imb = $('#inputMeterBar');
  const gled = $('#gateLed');
  if (inputPlaying && audioCtx) {
    const sx = clamp(xAt(playT), 0, inW);
    ctx.strokeStyle = 'rgba(45,226,197,.85)';
    ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, inH); ctx.stroke();
    const gateV = gateValueAt(playT);
    if (gled) gled.classList.toggle('on', gateOn && gateV > .5);
    const gr = $('#grMeterBar');
    if (gr) gr.style.height = gainReductionPct(gateV) + '%';
    const led = $('#hitLed');
    const near = realHits.some(h => Math.abs(h.time - playT) < 0.006);
    if (led) led.classList.toggle('on', near);
    let peak = 0;
    if (realInputPeakEnv) {
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
  inputPlaying = false;
  stopLiveTriggers();
  inputTimers.forEach(t => clearTimeout(t)); inputTimers = [];
  if (inputSource) { try { inputSource.stop(); } catch (e) {} inputSource = null; }
  activeSlotSources.slice().forEach(s => { try { s.stop(); } catch (e) {} });
  activeSlotSources = [];
  if (gateGain && audioCtx) {
    gateGain.gain.cancelScheduledValues(audioCtx.currentTime);
    gateGain.gain.setValueAtTime(1, audioCtx.currentTime);
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
  if (inputPlaying) { stopInput(); return; }
  if (!realInputBuffer) { toast('Real input still loading…'); return; }
  const ctx = ensureAudio();
  if (!ctx) { toast('Audio not available'); return; }
  stopInput();
  if (detectPending) { clearTimeout(detectPending); detectPending = 0; }
  detectInputHits();
  const src = ctx.createBufferSource();
  src.buffer = realInputBuffer;
  src.connect(inputGain);
  const start = ctx.currentTime + 0.06;
  inputSource = src;
  inputStartCtxTime = start;
  inputPlaying = true;
  src.start(start);
  scheduleGate(start);
  src.onended = () => { if (inputPlaying) stopInput(); };
  const btn = $('#inputPlay'); if (btn) btn.textContent = '■ STOP';
  startLiveTriggers();
  inputTimers.push(setTimeout(() => { if (inputPlaying) stopInput(); }, (realInputDuration + 0.5) * 1000));
}

$('#inputPlay').onclick = playInput;
$('#inputWave').addEventListener('click', playInput);
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
  get nodes() { return { gateGain, inputGain, dryGain, wetGain }; },
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
function init() {
  renderSlots();
  state.slots.forEach((_, i) => applyAutoPhase(i, 'INPUT', true));
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
