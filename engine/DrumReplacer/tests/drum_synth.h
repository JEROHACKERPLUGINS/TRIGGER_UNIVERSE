#pragma once
// Synthetic one-shots for testing the recognition engine: several variations of
// each drum type (pitch, decay, noise colour, level, click), deterministic.
#include "DSP/SampleAnalysis.h"
#include <cmath>
#include <vector>

struct Rng
{
  unsigned s;
  explicit Rng(unsigned seed) : s(seed * 2654435761u + 1u) {}
  double u() { s = s * 1664525u + 1013904223u; return ((s >> 8) & 0xFFFFFF) / 16777216.; } // 0..1
  double n() { return u() * 2. - 1.; }
  double r(double a, double b) { return a + (b - a) * u(); }
};

// one-pole filters on a noise stream
struct OnePole { double z = 0; double lp(double x, double a) { return z += a * (x - z); } };

inline std::vector<float> SynthDrum(int cls, unsigned seed, double sr = 48000.)
{
  using namespace tu;
  Rng g(seed + 977u * (unsigned) cls);
  double lenS = 1.0;
  if (cls == kClsCymbal) lenS = g.r(2.5, 4.5);
  if (cls == kClsFX) lenS = g.r(8., 14.);
  const int n = (int) (lenS * sr);
  std::vector<float> y(n, 0.f);
  const double lead = g.r(0., 0.004); // a little silence before some hits
  const int s0 = (int) (lead * sr);
  OnePole a, b, c, d;
  double ph = 0, ph2 = 0, ph3 = 0;
  const double level = g.r(0.3, 0.95);
  for (int i = s0; i < n; i++)
  {
    const double t = (i - s0) / sr;
    const double w = g.n();
    double v = 0;
    switch (cls)
    {
      case kClsKick: {
        const double f0 = g.r(0, 0) + 0; (void) f0;
        const double fEnd = 45. + (seed % 5) * 6., fStart = 140. + (seed % 7) * 20.;
        const double f = fEnd + (fStart - fEnd) * std::exp(-t / 0.035);
        ph += 2 * M_PI * f / sr;
        const double dec = 0.18 + (seed % 4) * 0.08;
        v = std::sin(ph) * std::exp(-t / dec) + 0.25 * w * std::exp(-t / 0.003);
        break;
      }
      case kClsSnare: {
        const double f = 180. + (seed % 6) * 15.;
        ph += 2 * M_PI * f / sr;
        const double tone = std::sin(ph) * std::exp(-t / 0.06);
        const double hp = w - a.lp(w, 0.08);                 // remove lows from the noise
        const double nz = b.lp(hp, 0.6 + (seed % 3) * 0.1);  // and some highs
        // acoustic snares are body-heavy (wires 10-20 dB under the shell); electronic ones brighter
        const double wires = seed % 2 ? 0.12 + (seed % 3) * 0.05 : 0.5 + (seed % 3) * 0.2;
        v = 1.0 * tone + wires * nz * std::exp(-t / (0.12 + (seed % 4) * 0.04));
        break;
      }
      case kClsClap: {
        const double gap = 0.009 + (seed % 3) * 0.003;
        double e = 0;
        for (int k = 0; k < 3; k++) { const double tk = t - k * gap; if (tk >= 0) e += (tk < gap ? std::exp(-tk / 0.0025) : 0); }
        e += 0.7 * (t > 3 * gap ? std::exp(-(t - 3 * gap) / (0.09 + (seed % 3) * 0.04)) : 0);
        const double bp = b.lp(w - a.lp(w, 0.18), 0.45);    // ~1-3 kHz band
        v = bp * e * 1.6;
        break;
      }
      case kClsHHC: case kClsHHO: case kClsCymbal: {
        const double hp1 = w - a.lp(w, 0.55);
        const double hp = hp1 - c.lp(hp1, 0.4);              // mostly > 6 kHz
        ph += 2 * M_PI * (3200. + (seed % 5) * 300.) / sr; ph2 += 2 * M_PI * 5170. / sr; ph3 += 2 * M_PI * 7330. / sr;
        const double metal = (std::sin(ph) > 0 ? 1 : -1) * 0.15 + (std::sin(ph2) > 0 ? 1 : -1) * 0.15 + (std::sin(ph3) > 0 ? 1 : -1) * 0.1;
        const double dec = cls == kClsHHC ? 0.025 + (seed % 4) * 0.012 : cls == kClsHHO ? 0.18 + (seed % 4) * 0.08 : 0.9 + (seed % 4) * 0.35;
        const double mm = metal - d.lp(metal, 0.5);
        v = (hp * 1.2 + mm * 0.8) * std::exp(-t / dec);
        break;
      }
      case kClsTom: {
        const double f0 = 85. + (seed % 6) * 25.;
        const double f = f0 * (1. + 0.25 * std::exp(-t / 0.05));
        ph += 2 * M_PI * f / sr; ph2 += 2 * M_PI * f * 1.58 / sr;
        const double dec = 0.35 + (seed % 4) * 0.12;
        v = (std::sin(ph) + 0.25 * std::sin(ph2)) * std::exp(-t / dec) + 0.15 * (w - a.lp(w, .1)) * std::exp(-t / 0.01);
        break;
      }
      case kClsPerc: {
        const double f1 = 520. + (seed % 5) * 180., f2 = f1 * (1.48 + (seed % 3) * 0.07);
        ph += 2 * M_PI * f1 / sr; ph2 += 2 * M_PI * f2 / sr;
        const double sq = (std::sin(ph) > 0 ? 1 : -1) * 0.5 + (std::sin(ph2) > 0 ? 1 : -1) * 0.4;
        const double sm = b.lp(sq, 0.25);
        v = sm * std::exp(-t / (0.06 + (seed % 4) * 0.04));
        break;
      }
      case kClsFX: {
        const double f = 200. * std::pow(40., t / lenS);
        const double nz = b.lp(w, std::min(0.9, f / sr * 6.));
        const double env = std::min(1., t / (lenS * 0.6)) * (t > lenS * 0.9 ? (lenS - t) / (lenS * 0.1) : 1.);
        v = nz * env;
        break;
      }
    }
    y[i] = (float) (v * level);
  }
  return y;
}

// Continuous variation, like a real library: tune (resample 0.75..1.33 = about -5..+5
// semitones, changes pitch and length together) and a random tilt (darker / brighter).
inline std::vector<float> Vary(const std::vector<float>& y, unsigned seed)
{
  Rng g(seed * 2246822519u + 3u);
  const double r = std::pow(2., g.r(-5., 5.) / 12.);
  const double tilt = g.r(-1., 1.);
  const int n = (int) (y.size() / r);
  std::vector<float> o((size_t) std::max(2, n));
  double lp = 0.;
  for (int i = 0; i < (int) o.size(); i++)
  {
    const double p = i * r; const int i0 = (int) p; const double fr = p - i0;
    const double v = i0 + 1 < (int) y.size() ? y[(size_t) i0] * (1 - fr) + y[(size_t) i0 + 1] * fr : 0.;
    lp += 0.25 * (v - lp);
    o[(size_t) i] = (float) (tilt > 0 ? v + tilt * (v - lp) : v + tilt * 0.6 * (v - lp)); // tilt: + brighter, - darker
  }
  return o;
}

