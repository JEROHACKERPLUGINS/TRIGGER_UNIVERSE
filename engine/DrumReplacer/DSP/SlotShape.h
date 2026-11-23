#pragma once

// TRIGGER UNIVERSE · what each Trigger Slot does to its sample, baked into the
// buffer the voices play (same as the prototype's BOUNCE, renderSlotOffline in
// prototype/app.js, so the app sounds like the prototype):
//
//   TRIGGER SLOT   the sample (START / END, REVERSE)
//   SAMPLE ENVELOPE  every point of the envelope (A / D / R + extra points), FADE IN / OUT
//   TONE           CUT (12 dB/oct low-pass 200 Hz–20 kHz) + TONE (±12 dB high shelf @ 4 kHz),
//                  zero phase; TUNE; GAIN
//   PHASE          polarity (Ø, incl. AUTO PHASE) and OFFSET (−5 … +50 ms)
//
// Per hit (real time, in the plugin): velocity / sensitivity, fader level, pan,
// mute / solo and the ONE SHOT / GATE mode. 90° shift has no DSP (as in the prototype).
//
// OFFSET needs to play up to 5 ms EARLY: the plugin delays the dry signal by an
// extra kLookMs and every shaped sample starts with kLookMs + OFFSET of silence.

#include "SlotEngine.h"
#include <algorithm>
#include <cmath>
#include <complex>
#include <string>
#include <utility>
#include <vector>

namespace tu
{

constexpr double kLookMs = 5.;  // dry delay added for negative OFFSET

struct SlotShape
{
  bool valid = false;
  std::string path;           // sample the shape was made for (informative)
  double start = 0., end = 1.;
  bool reverse = false;
  double tune = 0.;           // semitones
  double cut = 100., tone = 0.;
  double gainDb = 0.;
  double fadeInMs = 0., fadeOutMs = 0.;
  std::vector<std::pair<double, double>> env; // (ms, level 0..1), starts at (0,0), last = release end
  bool polarity = false;      // effective (manual Ø xor AUTO PHASE)
  double offsetMs = 0.;       // effective (manual + AUTO PHASE), −5 … +50
  int mode = 0;               // 0 = ONE SHOT, 1 = GATE
  double durMs = 0.;          // the UI's duration of the sample (START / END are fractions of it); 0 = the file's

  bool SameAudio(const SlotShape& o) const
  {
    return valid == o.valid && start == o.start && end == o.end && reverse == o.reverse && tune == o.tune
        && cut == o.cut && tone == o.tone && gainDb == o.gainDb && fadeInMs == o.fadeInMs
        && fadeOutMs == o.fadeOutMs && durMs == o.durMs && env == o.env && polarity == o.polarity && offsetMs == o.offsetMs;
  }
};

// ---------------------------------------------------------------- zero-phase EQ
// Magnitudes of Web Audio's BiquadFilterNode (lowpass with Q in dB, highshelf
// with S = 1), exactly what the prototype multiplies the spectrum by.
inline double BiquadMag(double b0, double b1, double b2, double a0, double a1, double a2, double w)
{
  const std::complex<double> z1 = std::polar(1., -w), z2 = std::polar(1., -2. * w);
  return std::abs((b0 + b1 * z1 + b2 * z2) / (a0 + a1 * z1 + a2 * z2));
}

inline double EqCutHz(double cut) { return std::clamp(200. * std::pow(100., cut / 100.), 200., 20000.); }

inline double EqMagnitude(double f, double sr, double cut, double tone)
{
  double m = 1.;
  f = std::min(f, sr / 2. - 1.);
  const double w = 2. * M_PI * f / sr;
  if (cut < 100.)
  {
    const double w0 = 2. * M_PI * EqCutHz(cut) / sr, c = std::cos(w0);
    const double alpha = std::sin(w0) / (2. * std::pow(10., 0.7 / 20.)); // Q = 0.7 dB
    m *= BiquadMag((1. - c) / 2., 1. - c, (1. - c) / 2., 1. + alpha, -2. * c, 1. - alpha, w);
  }
  if (tone != 0.)
  {
    const double A = std::pow(10., (tone / 100. * 12.) / 40.);
    const double w0 = 2. * M_PI * 4000. / sr, c = std::cos(w0), s = std::sin(w0);
    const double alpha = s / 2. * std::sqrt(2.), sa = 2. * std::sqrt(A) * alpha;
    m *= BiquadMag(A * ((A + 1.) + (A - 1.) * c + sa), -2. * A * ((A - 1.) + (A + 1.) * c), A * ((A + 1.) + (A - 1.) * c - sa),
                   (A + 1.) - (A - 1.) * c + sa, 2. * ((A - 1.) - (A + 1.) * c), (A + 1.) - (A - 1.) * c - sa, w);
  }
  return std::isfinite(m) ? m : 0.;
}

inline void FftInPlace(std::vector<double>& re, std::vector<double>& im, bool inverse)
{
  const size_t n = re.size();
  for (size_t i = 1, j = 0; i < n; i++)
  {
    size_t bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { std::swap(re[i], re[j]); std::swap(im[i], im[j]); }
  }
  for (size_t len = 2; len <= n; len <<= 1)
  {
    const double ang = (inverse ? 2. : -2.) * M_PI / (double) len;
    const double wr = std::cos(ang), wi = std::sin(ang);
    const size_t half = len >> 1;
    for (size_t i = 0; i < n; i += len)
    {
      double cr = 1., ci = 0.;
      for (size_t k = 0; k < half; k++)
      {
        const size_t a = i + k, b = a + half;
        const double xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr; im[b] = im[a] - xi;
        re[a] += xr; im[a] += xi;
        const double t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
  if (inverse) for (size_t i = 0; i < n; i++) { re[i] /= (double) n; im[i] /= (double) n; }
}

// CUT / TONE at zero phase: FFT -> multiply by the filters' magnitude -> IFFT,
// 4096 zeros of padding on each side (room for the ring, no wrap).
inline void ZeroPhaseEq(std::vector<float>* ch, int nCh, double sr, double cut, double tone)
{
  if (nCh <= 0 || ch[0].empty() || (cut >= 100. && tone == 0.)) return;
  constexpr size_t kPad = 4096;
  const size_t len = ch[0].size();
  size_t n = 1;
  while (n < len + 2 * kPad) n <<= 1;
  std::vector<double> mag(n / 2 + 1);
  for (size_t k = 0; k <= n / 2; k++) mag[k] = EqMagnitude((double) k * sr / (double) n, sr, cut, tone);
  // two channels per FFT (L in re, R in im): the gain is real and symmetric
  std::vector<double> re(n), im(n);
  std::fill(re.begin(), re.end(), 0.); std::fill(im.begin(), im.end(), 0.);
  for (size_t i = 0; i < len; i++) re[kPad + i] = ch[0][i];
  if (nCh > 1) for (size_t i = 0; i < len && i < ch[1].size(); i++) im[kPad + i] = ch[1][i];
  FftInPlace(re, im, false);
  for (size_t k = 0; k < n; k++) { const double g = mag[k <= n / 2 ? k : n - k]; re[k] *= g; im[k] *= g; }
  FftInPlace(re, im, true);
  for (size_t i = 0; i < len; i++) ch[0][i] = (float) re[kPad + i];
  if (nCh > 1) for (size_t i = 0; i < len && i < ch[1].size(); i++) ch[1][i] = (float) im[kPad + i];
}

// ---------------------------------------------------------------- envelope
// Piecewise-linear gain from the envelope points, like the prototype's
// linearRampToValueAtTime chain: (0, 0) -> each point (a 1 ms minimum on the
// first segment keeps ATTACK 0 click-free) -> 0 over 4 ms after the last one.
struct EnvCurve
{
  std::vector<double> t, v; // seconds, gain (base included)
  double At(double x) const
  {
    if (x <= t.front()) return v.front();
    for (size_t k = 1; k < t.size(); k++)
      if (x <= t[k]) return t[k] - t[k - 1] < 1e-12 ? v[k] : v[k - 1] + (v[k] - v[k - 1]) * (x - t[k - 1]) / (t[k] - t[k - 1]);
    return 0.;
  }
};

inline EnvCurve MakeEnvCurve(const SlotShape& sh, double totalSec, double base, double& envEndSec)
{
  EnvCurve c;
  c.t.push_back(0.); c.v.push_back(0.);
  const auto& pts = sh.env;
  const double envLenSec = std::max(0.002, (pts.empty() ? 0.8 : pts.back().first) / 1000.);
  const double envK = envLenSec > totalSec ? totalSec / envLenSec : 1.;
  envEndSec = std::max(0.002, envLenSec * envK);
  double lastT = 0.;
  for (size_t k = 1; k < pts.size(); k++)
  {
    const double tk = std::max(k == 1 ? 0.001 : lastT, pts[k].first / 1000. * envK);
    c.t.push_back(tk); c.v.push_back(base * std::clamp(pts[k].second, 0., 1.));
    lastT = tk;
  }
  if (pts.size() < 2) { c.t.push_back(0.001); c.v.push_back(base); c.t.push_back(envEndSec); c.v.push_back(base); lastT = envEndSec; }
  if (envEndSec > lastT) { c.t.push_back(envEndSec); c.v.push_back(c.v.back()); }
  c.t.push_back(envEndSec + 0.004); c.v.push_back(0.);
  return c;
}

// ---------------------------------------------------------------- render
// src: the file as loaded. Returns the buffer the slot's voices play.
inline SampleData* RenderShapedSample(const SampleData& src, const SlotShape& shIn)
{
  SlotShape sh = shIn;
  if (!sh.valid) { sh = SlotShape(); sh.env = {{0., 0.}, {0.001, 1.}, {1e7, 1.}}; } // untouched: whole sample
  auto* out = new SampleData;
  const int nCh = std::min(src.numChannels, 2);
  const double sr = src.sampleRate > 0 ? src.sampleRate : 44100.;
  out->numChannels = std::max(1, nCh);
  out->sampleRate = sr;
  const size_t srcLen = nCh > 0 ? src.ch[0].size() : 0;
  if (srcLen < 2) { out->numFrames = 0; return out; }

  // REVERSE + CUT / TONE (zero phase) on the whole file, like slotPlayBuffer
  std::vector<float> raw[2];
  for (int c = 0; c < nCh; c++)
  {
    raw[c] = src.ch[c];
    if (sh.reverse) std::reverse(raw[c].begin(), raw[c].end());
  }
  ZeroPhaseEq(raw, nCh, sr, sh.cut, sh.tone);

  // START / END (in file time) and TUNE (playback rate)
  const double durSec = sh.durMs > 0. ? sh.durMs / 1000. : (double) srcLen / sr;
  const double s0 = std::clamp(std::min(sh.start, sh.end), 0., 1.), s1 = std::clamp(std::max(sh.start, sh.end), 0., 1.);
  const double startSec = (sh.reverse ? (1. - s1) : s0) * durSec;
  const double endSec = (sh.reverse ? (1. - s0) : s1) * durSec;
  const double lenSec = std::max(0.005, endSec - startSec);
  const double rate = std::pow(2., sh.tune / 12.);
  const double totalSec = lenSec / rate;

  const double base = std::clamp(std::pow(10., sh.gainDb / 20.), 0., 4.);
  double envEndSec = 0.;
  const EnvCurve env = MakeEnvCurve(sh, totalSec, base, envEndSec);
  const double outSec = std::min(totalSec, envEndSec + 0.006);

  const double fi = std::min(sh.fadeInMs / 1000., totalSec * .9), fo = std::min(sh.fadeOutMs / 1000., totalSec * .9);
  const double offset = std::clamp(sh.offsetMs, -kLookMs, 50.);
  const size_t pre = (size_t) std::lround((kLookMs + offset) / 1000. * sr);
  const size_t body = (size_t) std::max(1.0, std::floor(outSec * sr));
  const float pol = sh.polarity ? -1.f : 1.f;

  for (int c = 0; c < out->numChannels; c++)
  {
    const std::vector<float>& x = raw[std::min(c, nCh - 1)];
    std::vector<float>& y = out->ch[c];
    y.assign(pre + body, 0.f);
    for (size_t j = 0; j < body; j++)
    {
      const double t = (double) j / sr;                // output time from the sample's start
      const double pos = startSec * sr + t * sr * rate; // source position
      if (pos >= (double) (srcLen - 1) || t > totalSec) break;
      const size_t i0 = (size_t) pos;
      const double fr = pos - (double) i0;
      double v = x[i0] + (x[i0 + 1] - x[i0]) * fr;
      double fade = fi > 0. ? std::min(1., t / fi) : 1.;
      const double foStart = std::max(fi, totalSec - fo); // ramp 1 -> 0 from there to the end
      if (fo > 0. && t >= foStart) fade *= totalSec - foStart > 1e-12 ? std::max(0., (totalSec - t) / (totalSec - foStart)) : 0.;
      v *= env.At(t) * fade;
      y[pre + j] = (float) v * pol;
    }
  }
  out->numFrames = (int) out->ch[0].size();
  out->leadFrames = (int) std::min(pre, out->ch[0].size());
  return out;
}

} // namespace tu
