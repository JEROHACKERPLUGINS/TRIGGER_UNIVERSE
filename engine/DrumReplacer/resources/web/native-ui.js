/* =========================================================
   TRIGGER UNIVERSE — native (AU) mode shim
   In the plugin's WKWebView, iPlug2 injects IPlugSendMsg and
   window.webkit.messageHandlers.callback exists. In a normal
   browser this file is inert.
   ========================================================= */
(function () {
  const viaWebKit = !!(window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.callback);
  const viaQuery = /(?:^|[?&])native=1(?:&|$)/.test(location.search);
  const native = viaWebKit || viaQuery;

  window.__TU_NATIVE__ = native;

  if (typeof window.IPlugSendMsg !== 'function') {
    window.IPlugSendMsg = function () { /* browser preview: no host */ };
  }

  if (!native) return;

  document.documentElement.classList.add('tu-native');

  // The AU processes audio in C++. Never build a second Web Audio graph that
  // would play outside the host (or fight the native engine).
  try { window.AudioContext = undefined; } catch (e) {}
  try { window.webkitAudioContext = undefined; } catch (e) {}
  try { window.OfflineAudioContext = undefined; } catch (e) {}
  try { window.webkitOfflineAudioContext = undefined; } catch (e) {}
  try { window.AudioWorkletNode = undefined; } catch (e) {}
})();

// ---------- UI -> native (iPlug2 bridge) ----------
function tuPost(message) {
  const handler = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.callback;
  if (handler) { handler.postMessage(message); return; }
  if (typeof window.IPlugSendMsg === 'function') window.IPlugSendMsg(message);
}

function BPCFUI(paramIdx) {
  if (paramIdx < 0) return;
  tuPost({ msg: 'BPCFUI', paramIdx: parseInt(paramIdx) });
}

function EPCFUI(paramIdx) {
  if (paramIdx < 0) return;
  tuPost({ msg: 'EPCFUI', paramIdx: parseInt(paramIdx) });
}

function SPVFUI(paramIdx, value) {
  if (paramIdx < 0) return;
  tuPost({ msg: 'SPVFUI', paramIdx: parseInt(paramIdx), value: value });
}

function SAMFUI(msgTag, ctrlTag = -1, data = 0) {
  tuPost({ msg: 'SAMFUI', msgTag: msgTag, ctrlTag: ctrlTag, data: data });
}

function SMMFUI(statusByte, dataByte1, dataByte2) {
  tuPost({ msg: 'SMMFUI', statusByte: statusByte, dataByte1: dataByte1, dataByte2: dataByte2 });
}

// ---------- native -> UI ----------
// iPlug2 calls these globals directly. Keep them safe and forward to hooks the
// UI can install later (window.__TU_onParam / __TU_onMessage).
const tuParamValues = new Map();

function SPVFD(paramIdx, val) {
  tuParamValues.set(paramIdx, val);
  window.dispatchEvent(new CustomEvent('tu-native-param', { detail: { idx: paramIdx, norm: val } }));
}

window.__TU_getNativeParam = function (idx) {
  return tuParamValues.get(idx);
};

function SCVFD(ctrlTag, val) {
  if (window.__TU_onControl) window.__TU_onControl(ctrlTag, val);
}

function OnMessage(msgTag, dataSize, data) {
  if (msgTag !== -1 || dataSize <= 0) return;
  try {
    const bytes = Uint8Array.from(atob(data), ch => ch.charCodeAt(0));
    const json = JSON.parse(new TextDecoder().decode(bytes));
    if (window.__TU_onMessage) window.__TU_onMessage(json);
    window.dispatchEvent(new CustomEvent('tu-native-message', { detail: json }));
  } catch (e) {
    console.warn('[TU native] bad message', e);
  }
}

function SAMFD(msgTag, dataSize, data) { OnMessage(msgTag, dataSize, data); }
function SMMFD(statusByte, dataByte1, dataByte2) { /* MIDI in: wire later */ }
function SSMFD(offset, size, msg) { /* sysex: wire later */ }

// ---------- parameter map (mirror EParams / ESlotParam in DrumReplacer.h) ----------
// Values are sent normalized 0..1, exactly like iPlug2 expects from SPVFUI.
const TU_SLOT_BASE = 28;
const TU_SLOT_PARAMS = 13;
const TU_SLOT = { vol: 0, pan: 1, tune: 2, attack: 3, release: 4, sustain: 5, velo: 6, phase: 10, solo: 11, mute: 12 };

const TU_PARAMS = {
  sensitivity: { idx: 0, min: 0, max: 100 },
  retrigger:   { idx: 1, min: 0, max: 1000 },
  detail:      { idx: 2, min: 0, max: 100 },
  lowCut:      { idx: 4, min: 20, max: 20000, log: true },
  highCut:     { idx: 5, min: 20, max: 20000, log: true },
  suppression: { idx: 6, min: 0, max: 100 },
  inputGain:   { idx: 7, min: -24, max: 24 },
  outputGain:  { idx: 8, min: -24, max: 24 },
  mix:         { idx: 9, min: 0, max: 100 },
  gateOn:      { idx: 10, min: 0, max: 1 },
  gateAttack:  { idx: 11, min: 0, max: 500 },
  gateRelease: { idx: 13, min: 0, max: 500 },
};

const tuClamp = (v, a, b) => Math.min(b, Math.max(a, v));

function tuNorm(p, value) {
  const v = tuClamp(value, p.min, p.max);
  if (p.log) return Math.log(v / p.min) / Math.log(p.max / p.min);
  return p.max === p.min ? 0 : (v - p.min) / (p.max - p.min);
}

function tuSendParam(name, value) {
  if (!window.__TU_NATIVE__ || window.__TU_applyingNative) return;
  const p = TU_PARAMS[name];
  if (!p) return;
  SPVFUI(p.idx, tuNorm(p, value));
}

function tuSendSlotParam(slot, param, value, min, max) {
  if (!window.__TU_NATIVE__ || window.__TU_applyingNative) return;
  const v = tuClamp(value, min, max);
  SPVFUI(TU_SLOT_BASE + slot * TU_SLOT_PARAMS + param, (v - min) / (max - min));
}

// Detector knob key -> native param. 'hold' still has no native parameter.
const TU_DETECTOR_MAP = {
  sens: 'sensitivity', retrig: 'retrigger', detail: 'detail',
  low: 'lowCut', high: 'highCut', supp: 'suppression', input: 'inputGain',
  attack: 'gateAttack', release: 'gateRelease',
};

window.__TU_sendDetector = function (key, value) {
  if (key === 'gate') { tuSendParam('gateOn', value ? 1 : 0); return; }
  const name = TU_DETECTOR_MAP[key];
  if (name) tuSendParam(name, value);
};

window.__TU_sendMaster = function (name, value) {
  tuSendParam(name, value);
};

window.__TU_sendSlot = function (i, s) {
  tuSendSlotParam(i, TU_SLOT.vol, s.level, -70, 6);
  tuSendSlotParam(i, TU_SLOT.pan, s.pan, -100, 100);
  tuSendSlotParam(i, TU_SLOT.tune, s.tune, -24, 24);
  tuSendSlotParam(i, TU_SLOT.velo, s.velSens ?? 100, 0, 100);
  tuSendSlotParam(i, TU_SLOT.phase, s.polarity ? 1 : 0, 0, 1);
  tuSendSlotParam(i, TU_SLOT.solo, s.solo ? 1 : 0, 0, 1);
  tuSendSlotParam(i, TU_SLOT.mute, s.mute ? 1 : 0, 0, 1);
};

// ---------- native file loading ----------
function tuB64Utf8(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

window.__TU_nativeLoadSample = function (slot, path) {
  if (!path) return;
  SAMFUI(7, slot, tuB64Utf8(path));
};

window.__TU_nativePreview = function (path) {
  if (!path) return;
  SAMFUI(11, -1, tuB64Utf8(path));
};

window.__TU_nativePreviewStop = function () {
  SAMFUI(12, -1, 0);
};

window.__TU_chooseFolder = function () {
  SAMFUI(6, 0, 0);
};
