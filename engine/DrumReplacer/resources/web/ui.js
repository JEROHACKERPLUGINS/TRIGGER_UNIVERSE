// DrumReplacer UI. Talks to the plugin through script.js (SPVFUI/BPCFUI/EPCFUI/SAMFUI out,
// SPVFD/SAMFD in). Values from the plugin are normalized 0..1.

// --- Param indices: mirror EParams / ESlotParam in DrumReplacer.h ---------------------------
const P = {
  sensitivity: 0, retrigger: 1, detail: 2, mode: 3, lowCut: 4, highCut: 5, suppression: 6,
  inputGain: 7, outputGain: 8, mix: 9,
  gateOn: 10, gateAttack: 11, gateSustain: 12, gateRelease: 13,
  midiInOn: 14, midiInNote: 15, midiInCh: 16, midiOutOn: 17, midiOutNote: 18, midiOutCh: 19,
  slotBase: 28,
};
const S = { vol: 0, pan: 1, tune: 2, attack: 3, release: 4, sustain: 5, velo: 6, dyn: 7, phase: 10, solo: 11, mute: 12 };
const NUM_SLOT_PARAMS = 13;
let numSlots = 8;
const slotParam = (s, p) => P.slotBase + s * NUM_SLOT_PARAMS + p;

const MSG_LOAD_SAMPLE = 4, MSG_CLEAR_SLOT = 5;

// --- Formatting ------------------------------------------------------------------------------
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const sign = v => (v > 0.05 ? '+' : '');
const FMT = {
  pct: v => `${Math.round(v)}%`,
  ms: v => (v < 10 ? `${v.toFixed(1)} ms` : `${Math.round(v)} ms`),
  hz: v => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${Math.round(v)} Hz`),
  db: v => (v <= -69.9 ? '-inf' : `${sign(v)}${v.toFixed(1)} dB`),
  st: v => `${sign(v)}${v.toFixed(1)} st`,
  pan: v => (Math.abs(v) < 0.5 ? 'C' : `${v < 0 ? 'L' : 'R'}${Math.round(Math.abs(v))}`),
  note: v => { const n = Math.round(v); return `${NOTE_NAMES[n % 12]}${Math.floor(n / 12) - 2}`; }, // 60 = C3 (Ableton)
  int: v => String(Math.round(v)),
};

// --- Param model ------------------------------------------------------------------------------
// Ranges here are only a fallback for previewing in a browser; the plugin's "params" message
// (sent when the page loads) is the source of truth.
const params = {};   // idx -> { min, max, def, shape: 'lin'|'exp'|'int'|'bool', norm }
const controls = {}; // idx -> [update(norm)]

function defineParam(idx, min, max, def, shape) {
  params[idx] = params[idx] || { min, max, def, shape, norm: 0 };
  params[idx].norm = toNorm(params[idx], params[idx].def);
}

function toValue(p, n) {
  if (p.shape === 'exp') return p.min * Math.pow(p.max / p.min, n);
  const v = p.min + n * (p.max - p.min);
  return p.shape === 'int' || p.shape === 'bool' ? Math.round(v) : v;
}

function toNorm(p, v) {
  if (p.shape === 'exp') return Math.log(v / p.min) / Math.log(p.max / p.min);
  return p.max === p.min ? 0 : (v - p.min) / (p.max - p.min);
}

function setFromHost(idx, norm) {
  const p = params[idx];
  if (!p) return;
  p.norm = norm;
  (controls[idx] || []).forEach(update => update(norm));
}

function sendParam(idx, norm, gesture = 'single') {
  norm = Math.min(1, Math.max(0, norm));
  params[idx].norm = norm;
  (controls[idx] || []).forEach(update => update(norm));
  if (gesture === 'begin' || gesture === 'single') BPCFUI(idx);
  SPVFUI(idx, norm);
  if (gesture === 'end' || gesture === 'single') EPCFUI(idx);
}

// --- Controls ---------------------------------------------------------------------------------
const SVG_NS = 'http://www.w3.org/2000/svg';
const ARC_START = -135, ARC_END = 135;

function polar(cx, cy, r, deg) {
  const a = (deg - 90) * Math.PI / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}
function arcPath(cx, cy, r, a0, a1) {
  if (Math.abs(a1 - a0) < 0.01) return '';
  const [x0, y0] = polar(cx, cy, r, a0), [x1, y1] = polar(cx, cy, r, a1);
  return `M${x0},${y0} A${r},${r} 0 ${Math.abs(a1 - a0) > 180 ? 1 : 0} ${a1 > a0 ? 1 : 0} ${x1},${y1}`;
}

// opts: { label, fmt, color, size, bipolar, small }
function knob(parent, idx, opts) {
  const size = opts.size || 34, c = size / 2, r = size / 2 - 3;
  const el = document.createElement('div');
  el.className = 'knob' + (opts.small ? ' small' : '');
  el.style.setProperty('--c', `var(--${opts.color})`);
  el.innerHTML = `<div class="label">${opts.label}</div>
    <svg width="${size}" height="${size}">
      <path class="track" fill="none" stroke-width="3" stroke-linecap="round" d="${arcPath(c, c, r, ARC_START, ARC_END)}"/>
      <path class="arc" fill="none" stroke-width="3" stroke-linecap="round"/>
      <circle class="dot" r="2"/>
    </svg>
    <div class="value"></div>`;
  parent.appendChild(el);

  const arc = el.querySelector('.arc'), dot = el.querySelector('.dot'), value = el.querySelector('.value');
  const update = norm => {
    const p = params[idx];
    const ang = ARC_START + norm * (ARC_END - ARC_START);
    const from = opts.bipolar ? 0 : ARC_START;
    arc.setAttribute('d', arcPath(c, c, r, Math.min(from, ang), Math.max(from, ang)));
    const [dx, dy] = polar(c, c, r - 5, ang);
    dot.setAttribute('cx', dx);
    dot.setAttribute('cy', dy);
    value.textContent = FMT[opts.fmt](toValue(p, norm));
  };
  (controls[idx] = controls[idx] || []).push(update);
  update(params[idx].norm);

  let startY = 0, startNorm = 0;
  el.addEventListener('pointerdown', e => {
    el.setPointerCapture(e.pointerId);
    startY = e.clientY;
    startNorm = params[idx].norm;
    BPCFUI(idx);
  });
  el.addEventListener('pointermove', e => {
    if (!el.hasPointerCapture(e.pointerId)) return;
    const speed = e.shiftKey ? 0.0015 : 0.006; // shift = fine
    const norm = Math.min(1, Math.max(0, startNorm + (startY - e.clientY) * speed));
    params[idx].norm = norm;
    controls[idx].forEach(u => u(norm));
    SPVFUI(idx, norm);
  });
  const end = e => {
    if (!el.hasPointerCapture(e.pointerId)) return;
    el.releasePointerCapture(e.pointerId);
    EPCFUI(idx);
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('dblclick', () => sendParam(idx, toNorm(params[idx], params[idx].def)));
  return el;
}

// Bool param as a button.
function toggle(parent, idx, label, color) {
  const el = document.createElement('button');
  el.className = 'toggle';
  el.textContent = label;
  if (color) el.style.setProperty('--c', `var(--${color})`);
  parent.appendChild(el);
  const update = norm => el.classList.toggle('on', norm >= 0.5);
  (controls[idx] = controls[idx] || []).push(update);
  update(params[idx].norm);
  el.addEventListener('click', () => sendParam(idx, params[idx].norm >= 0.5 ? 0 : 1));
  return el;
}

// --- Layout -------------------------------------------------------------------------------------
const $ = id => document.getElementById(id);

function buildPanels() {
  const d = $('detector-knobs');
  knob(d, P.sensitivity, { label: 'SENS', fmt: 'pct', color: 'blue' });
  knob(d, P.retrigger, { label: 'RETRIG', fmt: 'ms', color: 'blue' });
  knob(d, P.detail, { label: 'DETAIL', fmt: 'pct', color: 'blue' });
  knob(d, P.mode, { label: 'MODE', fmt: 'int', color: 'blue' });
  knob(d, P.lowCut, { label: 'LO CUT', fmt: 'hz', color: 'blue' });
  knob(d, P.highCut, { label: 'HI CUT', fmt: 'hz', color: 'blue' });
  knob(d, P.suppression, { label: 'SUPPR', fmt: 'pct', color: 'red' });

  toggle($('gate-toggle'), P.gateOn, 'ON', 'red');
  const g = $('gate-knobs');
  knob(g, P.gateAttack, { label: 'ATK', fmt: 'ms', color: 'red' });
  knob(g, P.gateSustain, { label: 'SUS', fmt: 'pct', color: 'red' });
  knob(g, P.gateRelease, { label: 'REL', fmt: 'ms', color: 'red' });

  const gn = $('gain-knobs');
  knob(gn, P.inputGain, { label: 'INPUT', fmt: 'db', color: 'violet', bipolar: true });
  knob(gn, P.outputGain, { label: 'OUTPUT', fmt: 'db', color: 'violet', bipolar: true });
  knob(gn, P.mix, { label: 'MIX', fmt: 'pct', color: 'violet' });

  toggle($('midi-in-toggle'), P.midiInOn, 'IN', 'green');
  knob($('midi-in-knobs'), P.midiInNote, { label: 'NOTE', fmt: 'note', color: 'green', size: 28, small: true });
  knob($('midi-in-knobs'), P.midiInCh, { label: 'CH', fmt: 'int', color: 'green', size: 28, small: true });
  toggle($('midi-out-toggle'), P.midiOutOn, 'OUT', 'green');
  knob($('midi-out-knobs'), P.midiOutNote, { label: 'NOTE', fmt: 'note', color: 'green', size: 28, small: true });
  knob($('midi-out-knobs'), P.midiOutCh, { label: 'CH', fmt: 'int', color: 'green', size: 28, small: true });
}

function buildSlots() {
  const root = $('slots');
  root.innerHTML = '';
  for (let s = 0; s < numSlots; s++) {
    const strip = document.createElement('div');
    strip.className = 'slot';
    strip.id = `slot-${s}`;
    strip.innerHTML = `
      <div class="slot-head"><span class="slot-num">${s + 1}</span><span class="slot-name">empty</span></div>
      <div class="slot-buttons"><button class="toggle load">LOAD</button><button class="toggle clear" title="Clear slot">✕</button></div>
      <div class="slot-knobs"></div>
      <div class="slot-switches"></div>`;
    root.appendChild(strip);

    strip.querySelector('.load').addEventListener('click', () => SAMFUI(MSG_LOAD_SAMPLE, s));
    strip.querySelector('.clear').addEventListener('click', () => SAMFUI(MSG_CLEAR_SLOT, s));

    const k = strip.querySelector('.slot-knobs');
    const o = { size: 28, small: true };
    knob(k, slotParam(s, S.vol), { ...o, label: 'VOL', fmt: 'db', color: 'violet' });
    knob(k, slotParam(s, S.pan), { ...o, label: 'PAN', fmt: 'pan', color: 'violet', bipolar: true });
    knob(k, slotParam(s, S.tune), { ...o, label: 'TUNE', fmt: 'st', color: 'blue', bipolar: true });
    knob(k, slotParam(s, S.attack), { ...o, label: 'ATK', fmt: 'ms', color: 'orange' });
    knob(k, slotParam(s, S.sustain), { ...o, label: 'SUS', fmt: 'pct', color: 'orange' });
    knob(k, slotParam(s, S.release), { ...o, label: 'REL', fmt: 'ms', color: 'orange' });
    knob(k, slotParam(s, S.velo), { ...o, label: 'VELO', fmt: 'pct', color: 'blue' });
    knob(k, slotParam(s, S.dyn), { ...o, label: 'DYN', fmt: 'pct', color: 'orange' });

    const sw = strip.querySelector('.slot-switches');
    toggle(sw, slotParam(s, S.phase), 'Ø', 'blue').title = 'Phase invert';
    toggle(sw, slotParam(s, S.solo), 'S', 'orange').title = 'Solo';
    toggle(sw, slotParam(s, S.mute), 'M', 'red').title = 'Mute';
  }
}

function setSlot(s, name, ok) {
  const strip = $(`slot-${s}`);
  if (!strip) return;
  strip.classList.toggle('loaded', !!name && ok);
  strip.classList.toggle('error', !!name && !ok);
  const label = strip.querySelector('.slot-name');
  label.textContent = !name ? 'empty' : ok ? name.replace(/\.wav$/i, '') : `${name} (missing)`;
  label.title = name || '';
}

function setPro(isPro) {
  $('pro-badge').hidden = !isPro;
  const gate = $('gate-panel');
  gate.classList.toggle('disabled', !isPro);
  gate.title = isPro ? '' : 'Transient Gate module is available in Pro version only.';
}

let ledTimer = null;
function flashHit(vel) {
  const led = $('hit-led');
  led.classList.add('on');
  clearTimeout(ledTimer);
  ledTimer = setTimeout(() => led.classList.remove('on'), 80);
  document.querySelectorAll('.slot.loaded').forEach(strip => {
    strip.style.setProperty('--vel', vel);
    strip.classList.add('flash');
    clearTimeout(strip._t);
    strip._t = setTimeout(() => strip.classList.remove('flash'), 90);
  });
}

// --- Messages from the plugin (called by script.js) -------------------------------------------
function OnParamChange(idx, norm) { setFromHost(idx, norm); }
function OnControlChange() {}

function OnMessage(msgTag, dataSize, data) {
  if (msgTag !== -1 || dataSize <= 0) return;
  const bytes = Uint8Array.from(atob(data), ch => ch.charCodeAt(0));
  const json = JSON.parse(new TextDecoder().decode(bytes));

  switch (json.id) {
    case 'params': // ranges and defaults for every param
      json.params.forEach(p => {
        const shape = p.type === 'bool' ? 'bool' : (p.type === 'int' || p.type === 'enum') ? 'int'
                    : p.display_type === 1 ? 'exp' : 'lin';
        const prev = params[p.id];
        params[p.id] = { min: p.min, max: p.max, def: p.default, shape, norm: prev ? prev.norm : 0 };
      });
      break;
    case 'init':
      setPro(json.pro);
      if (json.numSlots !== numSlots) { numSlots = json.numSlots; buildSlots(); }
      break;
    case 'slot':
      setSlot(json.slot, json.name, json.ok);
      break;
    case 'hit':
      flashHit(json.vel);
      break;
  }
}

// --- Boot ---------------------------------------------------------------------------------------
function defineFallbackParams() {
  const g = (i, a, b, d, s = 'lin') => defineParam(i, a, b, d, s);
  g(P.sensitivity, 0, 100, 45); g(P.retrigger, 0, 1000, 50); g(P.detail, 0, 100, 50);
  g(P.mode, 0, 3, 0, 'int'); g(P.lowCut, 20, 20000, 30, 'exp'); g(P.highCut, 20, 20000, 15000, 'exp');
  g(P.suppression, 0, 100, 50);
  g(P.inputGain, -24, 24, 0); g(P.outputGain, -24, 24, 0); g(P.mix, 0, 100, 100);
  g(P.gateOn, 0, 1, 0, 'bool'); g(P.gateAttack, 0, 500, 1); g(P.gateSustain, 0, 100, 0); g(P.gateRelease, 0, 500, 100);
  g(P.midiInOn, 0, 1, 1, 'bool'); g(P.midiInNote, 0, 127, 36, 'int'); g(P.midiInCh, 1, 16, 10, 'int');
  g(P.midiOutOn, 0, 1, 0, 'bool'); g(P.midiOutNote, 0, 127, 36, 'int'); g(P.midiOutCh, 1, 16, 10, 'int');
  for (let s = 0; s < 16; s++) {
    g(slotParam(s, S.vol), -70, 6, 0); g(slotParam(s, S.pan), -100, 100, 0); g(slotParam(s, S.tune), -24, 24, 0);
    g(slotParam(s, S.attack), 0, 2000, 0); g(slotParam(s, S.release), 0, 5000, 500); g(slotParam(s, S.sustain), 0, 100, 100);
    g(slotParam(s, S.velo), 0, 100, 50); g(slotParam(s, S.dyn), 0, 100, 100);
    g(slotParam(s, S.phase), 0, 1, 0, 'bool'); g(slotParam(s, S.solo), 0, 1, 0, 'bool'); g(slotParam(s, S.mute), 0, 1, 0, 'bool');
  }
}

// Outside the plugin (browser preview) there is no IPlugSendMsg: log instead.
if (typeof window.IPlugSendMsg !== 'function')
  window.IPlugSendMsg = msg => console.log('to plugin', msg);

defineFallbackParams();
buildPanels();
buildSlots();
