// INPUT DETECTOR · real time, on the audio thread.
//
// Signal flow per sample (same as the engine): GATE -> INPUT (already applied
// by inputGain upstream) -> FILTER (detection only) -> DETECT.
// Every control change is applied to the very next sample: nothing is
// precomputed over the file.
//
// LOOKAHEAD: the dry input leaves this node delayed by `lookahead` seconds.
// A hit is confirmed ~5 ms after its onset; the delay leaves time to post it to
// the main thread and schedule the slot samples exactly on the onset of the
// delayed (heard) input. Negative slot OFFSET also lives inside this window.
//
// main -> worklet:
//   { type: 'params', p: {gate, gateThreshold, attack, hold, release,
//                         detail, supp, retrig, low, high, norm} }
//   { type: 'start', start, duration }   start = ctx time of buffer start
//   { type: 'stop' }
// worklet -> main:
//   { type: 'hit', time, peakTime, peak, velocity, out }
//        time/peakTime: track seconds; out: ctx time when the onset is heard
//   { type: 'blocks', from, gate: Float32Array, peak: Float32Array }
//        per 1 ms of track time: effective gate gain and pre-gate input peak
//        (normalized like the meter), starting at block index `from`.

const DETAIL_MAX = 1.5;
const GATE_LOOK = 0.001;   // gate opens 1 ms before the transient (ATTACK 0 keeps the attack)
const DET_WIN = 0.005;     // capture window after the onset
const XFADE = 0.008;       // GATE on/off glide
// RETRIGGER (like Trigger 2): purely the blind time after each hit. Once it
// has passed, the detector fires again as soon as the envelope is above the
// threshold (DETAIL / SUPPRESS), even if it never fell: RETRIGGER 0 on a
// sustained hit = audible flams / machine gun. A fresh hit after the signal
// dipped below half the threshold also needs the transient test (fast > slow*k).
const dbToAmp = db => Math.pow(10, db / 20);

function biquad(type, f0, sr, q = 0.70710678) {
  const w0 = 2 * Math.PI * Math.min(Math.max(f0, 10), sr * 0.49) / sr;
  const cos = Math.cos(w0), sin = Math.sin(w0), alpha = sin / (2 * q);
  let b0, b1, b2;
  if (type === 'hp') { b0 = (1 + cos) / 2; b1 = -(1 + cos); b2 = (1 + cos) / 2; }
  else { b0 = (1 - cos) / 2; b1 = 1 - cos; b2 = (1 - cos) / 2; }
  const a0 = 1 + alpha;
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: -2 * cos / a0, a2: (1 - alpha) / a0,
           x1: 0, x2: 0, y1: 0, y2: 0 };
}
function runBiquad(f, x) {
  const y = f.b0 * x + f.b1 * f.x1 + f.b2 * f.x2 - f.a1 * f.y1 - f.a2 * f.y2;
  f.x2 = f.x1; f.x1 = x; f.y2 = f.y1; f.y1 = y;
  return y;
}

class TUDetectorProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = (options && options.processorOptions) || {};
    this.L = Math.max(1, Math.round((o.lookahead || 0.1) * sampleRate));
    this.G = Math.max(1, Math.round(GATE_LOOK * sampleRate));
    this.win = Math.max(1, Math.round(DET_WIN * sampleRate));
    const size = this.L + this.G + 8;
    this.size = size;
    this.xRing = new Float32Array(size);   // dry input
    this.fRing = new Float32Array(size);   // filtered detection input
    this.cRing = new Float32Array(size);   // effective gate gain
    this.p = { gate: true, gateThreshold: -24, attack: .5, hold: 30, release: 150,
               detail: 14, supp: 0, retrig: 30, low: 20, high: 20000, norm: 1 };
    this.hp = null; this.lp = null;
    this.playing = false; this.start = 0; this.duration = 0;
    this.gateEn = 1;
    if (o.params) Object.assign(this.p, o.params);
    this.applyParams();
    this.reset();
    // Offline analysis / tests: start immediately on the given timeline.
    if (Number.isFinite(o.start)) {
      this.start = o.start; this.duration = o.duration || 1e9; this.playing = true;
      this.gateEn = this.p.gate ? 1 : 0;
    }
    this.port.onmessage = e => this.onMessage(e.data || {});
  }

  reset() {
    this.xRing.fill(0); this.fRing.fill(0); this.cRing.fill(1);
    // gate
    this.det = 0; this.gain = 0; this.holdLeft = 0; this.latch = false;
    // detector
    this.fast = 0; this.slow = 0; this.supTh = 0; this.holdCnt = 0;
    this.capturing = false; this.armed = true;
    this.peak = 0; this.velPeak = 0; this.cap = 0; this.capStart = 0; this.peakAt = 0;
    this.dipped = true;
    if (this.hp) { this.hp.x1 = this.hp.x2 = this.hp.y1 = this.hp.y2 = 0; }
    if (this.lp) { this.lp.x1 = this.lp.x2 = this.lp.y1 = this.lp.y2 = 0; }
    // per-ms block report
    this.blkIdx = -1; this.blkFrom = 0; this.blkGate = []; this.blkPeak = []; this.blkMax = 0; this.blkC = 1;
  }

  onMessage(m) {
    if (m.type === 'params') {
      Object.assign(this.p, m.p || {});
      this.applyParams();
    } else if (m.type === 'start') {
      this.reset();
      this.start = m.start; this.duration = m.duration; this.playing = true;
      this.gateEn = this.p.gate ? 1 : 0;
    } else if (m.type === 'stop') {
      this.flushBlocks();
      this.playing = false;
    }
  }

  applyParams() {
    const p = this.p, sr = sampleRate;
    this.thr = dbToAmp(p.gateThreshold);
    this.closeThr = this.thr * dbToAmp(-4);          // 4 dB hysteresis
    this.detDecay = Math.exp(-1 / (0.008 * sr));      // 8 ms peak detector (CLEAN-style)
    const atk = Math.max(0, p.attack / 1000);
    this.atkCoef = atk > 0 ? 1 - Math.exp(-1 / (atk * sr)) : 1;
    this.relCoef = 1 - Math.exp(-1 / (Math.max(0.005, p.release / 1000) * sr));
    this.holdSamples = Math.max(0, Math.round(p.hold / 1000 * sr));
    this.detailThr = Math.min(Math.max(p.detail, 0), 100) / 100 * DETAIL_MAX;
    this.rearm = Math.max(0.01, this.detailThr * 0.5);
    this.suppK = p.supp / 100;
    this.retrigSamples = Math.round(p.retrig * 0.001 * sr);
    this.fastRel = Math.exp(-1 / (0.005 * sr));
    this.slowCoef = 1 - Math.exp(-1 / (0.05 * sr));
    this.supDecay = Math.exp(-1 / (0.05 * sr));
    this.gateStep = 1 / (XFADE * sr);
    // Filters keep their state when the cutoff moves (no reset click).
    const keep = (old, f) => { if (old) { f.x1 = old.x1; f.x2 = old.x2; f.y1 = old.y1; f.y2 = old.y2; } return f; };
    this.hp = p.low > 20 ? keep(this.hp, biquad('hp', p.low, sr)) : null;
    this.lp = p.high < 20000 ? keep(this.lp, biquad('lp', p.high, sr)) : null;
  }

  flushBlocks() {
    if (!this.blkGate.length) return;
    this.port.postMessage({ type: 'blocks', from: this.blkFrom,
      gate: Float32Array.from(this.blkGate), peak: Float32Array.from(this.blkPeak) });
    this.blkGate = []; this.blkPeak = [];
  }

  process(inputs, outputs) {
    const input = inputs[0], output = outputs[0];
    const n = output[0].length;
    const inp = input && input.length ? input[0] : null;
    const out0 = output[0];
    const sr = sampleRate, size = this.size, L = this.L, G = this.G, p = this.p;
    const gateTarget = p.gate ? 1 : 0;
    for (let i = 0; i < n; i++) {
      const frame = currentFrame + i;
      const x = inp ? inp[i] : 0;
      const w = frame % size;
      const lvl = Math.abs(x) * p.norm;

      // ---- GATE (causal, on the undelayed input) ----
      this.det = Math.max(lvl, this.det * this.detDecay);
      const open = this.det >= (this.latch ? this.closeThr : this.thr);
      if (open) { this.latch = true; this.holdLeft = this.holdSamples; }
      else this.latch = false;
      const target = (this.latch || this.holdLeft > 0) ? 1 : 0;
      if (!this.latch && this.holdLeft > 0) this.holdLeft--;
      if (target > this.gain) this.gain += (1 - this.gain) * this.atkCoef;
      else this.gain += (0 - this.gain) * this.relCoef;
      if (this.gateEn < gateTarget) this.gateEn = Math.min(gateTarget, this.gateEn + this.gateStep);
      else if (this.gateEn > gateTarget) this.gateEn = Math.max(gateTarget, this.gateEn - this.gateStep);
      const c = 1 - this.gateEn * (1 - this.gain);

      // Gain computed now applies G samples back: the gate "sees" 1 ms ahead.
      this.cRing[(frame - G + size) % size] = c;
      let f = x;
      if (this.hp) f = runBiquad(this.hp, f);
      if (this.lp) f = runBiquad(this.lp, f);
      this.xRing[w] = x;
      this.fRing[w] = f;

      // ---- DETECT on m = frame - G (post-gate, filtered, normalized) ----
      const m = frame - G;
      const mi = (m + size) % size;
      let d = Math.abs(this.fRing[mi]) * p.norm * c;
      const velLevel = Math.min(2, d);
      d = Math.min(1, d);
      this.fast = Math.max(d, this.fast * this.fastRel);
      this.slow += (d - this.slow) * this.slowCoef;
      this.supTh *= this.supDecay;
      const thr = Math.max(this.detailThr, this.supTh);
      if (!this.capturing && this.armed && this.fast > thr
          && (!this.dipped || this.fast > this.slow * 2.5)) {
        this.capturing = true; this.peak = 0; this.velPeak = 0; this.cap = 0;
        this.capStart = m; this.peakAt = m;
      }
      if (this.capturing) {
        if (this.fast > this.peak) { this.peak = this.fast; this.peakAt = m; }
        if (velLevel > this.velPeak) this.velPeak = velLevel;
        if (++this.cap >= this.win) {
          const t = this.capStart / sr - this.start;
          if (this.playing && t >= 0 && t <= this.duration) {
            this.port.postMessage({ type: 'hit', time: t, peakTime: this.peakAt / sr - this.start,
              peak: this.peak, velocity: this.velPeak, out: (this.capStart + L) / sr });
          }
          this.capturing = false; this.armed = false; this.dipped = false;
          this.supTh = this.peak * this.suppK;
          this.holdCnt = this.win + this.retrigSamples;
        }
      }
      // RETRIGGER: blind time only.
      if (!this.armed) {
        if (this.holdCnt > 0) this.holdCnt--;
        if (this.holdCnt <= 0) this.armed = true;
      }
      if (this.armed && this.fast < this.rearm) this.dipped = true;

      // ---- per-ms report on the track timeline (input side) ----
      if (this.playing) {
        const tt = m / sr - this.start;
        if (tt >= 0 && tt <= this.duration) {
          const b = Math.floor(tt * 1000);
          if (b !== this.blkIdx) {
            if (this.blkIdx >= 0) {
              if (this.blkGate.length === 0) this.blkFrom = this.blkIdx;
              this.blkGate.push(this.blkC); this.blkPeak.push(this.blkMax);
            }
            this.blkIdx = b; this.blkMax = 0;
          }
          const pre = Math.abs(this.xRing[mi]) * p.norm;
          if (pre > this.blkMax) this.blkMax = pre;
          this.blkC = c;
        }
      }

      // ---- dry out: delayed by the lookahead, gated ----
      const r = (frame - L + size * 4) % size;
      out0[i] = this.xRing[r] * this.cRing[r];
    }
    for (let ch = 1; ch < output.length; ch++) output[ch].set(out0);
    if (this.blkGate.length >= 16) this.flushBlocks();
    return true;
  }
}

registerProcessor('tu-detector', TUDetectorProcessor);
