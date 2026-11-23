#pragma once

// TRIGGER UNIVERSE · sample recognition engine (XO-style).
//
// For each one-shot it computes, from the audio only:
//  - a spectral fingerprint: 16 mel bands x 6 time segments after the onset
//    (0-10, 10-30, 30-70, 70-150, 150-300, 300-600 ms), log power relative to
//    the loudest cell, so it does not depend on the sample's level;
//  - descriptors: energy split in 6 bands, power centroid, flatness (noise vs
//    tone), low-band tonality, decay to -20/-40 dB, number of attacks in the
//    first 60 ms (claps), duration;
//  - a drum type (Kick, Snare, Clap, HHC, HHO, Cymbal, Tom, Perc, FX) with a
//    confidence, from rules on those descriptors.
// The map (SampleMap.h) places samples with t-SNE on fingerprint + duration +
// type, like XO's Space.
// No allocations on the audio thread: this runs on the library analysis thread.

#include <algorithm>
#include <cmath>
#include <complex>
#include <cstring>
#include <string>
#include <vector>

namespace tu
{

enum EDrumClass { kClsKick = 0, kClsSnare, kClsClap, kClsHHC, kClsHHO, kClsCymbal, kClsTom, kClsPerc, kClsFX, kNumClasses };

inline const char* DrumClassName(int c)
{
  static const char* names[kNumClasses] = {"Kick", "Snare", "Clap", "HHC", "HHO", "Cymbal", "Tom", "Perc", "FX"};
  return (c >= 0 && c < kNumClasses) ? names[c] : "Perc";
}

constexpr int kFpBands = 16;
constexpr int kFpSegs = 6;
constexpr int kFpSize = kFpBands * kFpSegs;
// Descriptors appended to the fingerprint for the map / classifier:
// log decay40, brightness, air, noise flatness, low-band tonality, attacks,
// loudness (max momentary LUFS / 20), druminess, late transient.
constexpr int kDescSize = 9; // + loudness (LUFS/20), druminess, late transient
constexpr int kFeatSize = kFpSize + kDescSize; // what the library stores per file ("fp")
constexpr int kAnalysisVersion = 5;

struct SampleFeatures
{
  bool ok = false;
  double durMs = 0;
  // descriptors (body = first 300 ms after the onset)
  double band[6] = {};          // energy fraction: <90, 90-250, 250-900, 900-3k, 3k-7k, >7k Hz
  double centroid = 0;          // Hz, power weighted
  double flatness = 0;          // 0 = tone .. 1 = white noise (geometric / arithmetic mean of power)
  double lowTonality = 0;       // peak / mean power in 30-400 Hz (high = pitched kick/tom)
  double decay20 = 0, decay40 = 0; // ms from the peak until the envelope is 20 / 40 dB down
  double attackMs = 0;          // onset -> peak
  int attacks = 1;              // separate attacks in the first 60 ms (measured above 1 kHz)
  double brightDb = 0;          // 10 log10( E(1-10 kHz) / E(40 Hz-1 kHz) ): snare/hat/clap > tom > kick
  double airDb = -60;           // 10 log10( E(> 6 kHz) / E(total) )
  double noiseFlat = 0;         // flatness of 2-12 kHz: wires / hats / claps are noisy, partials are not
  bool reHit = false;           // another hit after the first one decayed (loop / stem / multi-hit file)
  double lufs = -70;            // max momentary loudness (EBU R128 / ITU BS.1770, 400 ms), LUFS
  double druminess = 0;         // 0 = sustained / swell .. 1 = sharp hit that dies fast
  double lateTransient = 0;     // 0 = single attack .. 1 = a second attack as strong as the first
  double peak = 0, rms = 0;
  float fp[kFpSize] = {};       // 0 (loudest cell) .. -1 (60 dB down or less)
  float desc[kDescSize] = {};   // see kDescSize
  int cls = kClsPerc;
  double conf = 0;
};

// ---------------------------------------------------------------- FFT (radix 2)
inline void FFTInPlace(std::vector<std::complex<double>>& a)
{
  const size_t n = a.size();
  for (size_t i = 1, j = 0; i < n; i++)
  {
    size_t bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) std::swap(a[i], a[j]);
  }
  for (size_t len = 2; len <= n; len <<= 1)
  {
    const double ang = -2. * M_PI / (double) len;
    const std::complex<double> wl(std::cos(ang), std::sin(ang));
    for (size_t i = 0; i < n; i += len)
    {
      std::complex<double> w(1.);
      for (size_t k = 0; k < len / 2; k++)
      {
        const auto u = a[i + k], v = a[i + k + len / 2] * w;
        a[i + k] = u + v;
        a[i + k + len / 2] = u - v;
        w *= wl;
      }
    }
  }
}

inline double HzToMel(double f) { return 2595. * std::log10(1. + f / 700.); }
inline double MelToHz(double m) { return 700. * (std::pow(10., m / 2595.) - 1.); }

// ---------------------------------------------------------------- classifier
// Rules on perceptual descriptors. Each class gets a score; the best wins and
// the gap to the runner-up is the confidence (0..1). Reference values measured
// on recorded one-shots (tests/sample_analysis_test.cpp):
//   kick   sub .75-.82  bright -24..-23 dB  decay40   90-170 ms
//   snare  sub  0-.02   bright -23..-15 dB  decay40  110-230 ms  (electronic: brighter, noisier)
//   tom    sub .1-.8    bright -22..-17 dB  decay40  600-2200 ms (rings)
//   hats / cymbals: air > -8 dB, bright > +10 dB; length splits HHC / HHO / cymbal
//   clap: 3+ attacks in 60 ms above 1 kHz, little low end
inline void ClassifyDrum(SampleFeatures& f)
{
  const double sub = f.band[0], low = f.band[1];
  const double bottom = sub + low;
  double s[kNumClasses] = {};
  auto ramp = [](double x, double a, double b) { return std::clamp((x - a) / (b - a), 0., 1.); }; // 0 at a, 1 at b
  auto down = [&](double x, double a, double b) { return 1. - ramp(x, a, b); };                    // 1 at a, 0 at b

  const double longFile = std::max(f.reHit ? 1. : 0., ramp(f.durMs, 12000., 20000.));
  const double ring = ramp(f.decay40, 380., 650.);       // toms (and cymbals) ring; kick/snare don't
  const double metal = ramp(f.airDb, -14., -6.) * ramp(f.brightDb, 4., 14.);
  const double noisyTop = ramp(f.noiseFlat, .25, .5);
  const double claps = ramp(f.attacks, 2., 3.) * ramp(f.brightDb, -10., 0.);

  // Long files: stems, loops, risers, ambiences, or a slow swell.
  s[kClsFX] = longFile * 3.5 + ramp(f.attackMs, 60., 250.) * 3.;

  // short (acoustic) or very dark and long (808-style sine kicks); a floor tom is long but has stick/skin top end
  const double subHeavy = ramp(sub, .3, .6);
  const double kickShape = std::max(down(f.decay40, 450., 900.), down(f.brightDb, -30., -26.));
  s[kClsKick] = subHeavy * (1.2 + kickShape * 1.0) + down(f.brightDb, -20., -8.) * .6
              - metal * 2. - claps;

  s[kClsTom] = ramp(bottom + f.band[2], .7, .9) * .8 + ring * 1.2 + down(f.brightDb, -12., -4.) * .5
             - ramp(sub, .55, .85) * down(f.decay40, 800., 1500.) * .8 - subHeavy * down(f.brightDb, -30., -26.) * 1.2
             - metal * 2. - claps;

  s[kClsSnare] = ramp(f.brightDb, -26., -16.) * .8 + down(sub, .15, .35) * .7 + down(f.decay40, 450., 800.) * .5
               + noisyTop * .4 + ramp(f.brightDb, -8., 4.) * noisyTop * .4 - down(f.noiseFlat, .08, .2) * 1.2
               - metal * 1.5 - claps;

  s[kClsClap] = claps * 2.6 + noisyTop * .3 - ramp(bottom, .3, .6);

  const double hatLen = f.decay40;
  s[kClsHHC] = metal * 1.8 + down(hatLen, 250., 450.) * .6;
  s[kClsHHO] = metal * 1.8 + ramp(hatLen, 250., 450.) * down(hatLen, 1400., 2200.) * .6;
  s[kClsCymbal] = metal * 1.8 + ramp(hatLen, 1400., 2200.) * .6 + ramp(f.durMs, 1500., 3000.) * .2;

  // Perc: pitched mid/high hits (rims, cowbells, blocks, congas): tonal, not low, not metal.
  s[kClsPerc] = 1.4 * down(f.noiseFlat, .08, .2) * ramp(f.brightDb, -18., -6.) * down(bottom, .4, .7) + .35 - metal;

  int best = kClsPerc;
  for (int c = 0; c < kNumClasses; c++) if (s[c] > s[best]) best = c;
  double second = -1e9;
  for (int c = 0; c < kNumClasses; c++) if (c != best) second = std::max(second, s[c]);
  f.cls = best;
  f.conf = std::clamp(s[best] - second, 0., 1.);
}

// ---------------------------------------------------------------- loudness (ITU-R BS.1770 / EBU R128)
// K-weighting = high shelf (+4 dB, ~1.7 kHz) then high-pass (~38 Hz); coefficients
// for any sample rate from the standard's analogue prototypes. Returns the max
// momentary loudness (400 ms windows, 100 ms hop) in LUFS; a sample shorter
// than 400 ms is measured over its whole length.
struct KBiquad { double b0, b1, b2, a1, a2, z1 = 0, z2 = 0;
  double Run(double x) { const double y = b0 * x + z1; z1 = b1 * x - a1 * y + z2; z2 = b2 * x - a2 * y; return y; } };

inline void KWeighting(double sr, KBiquad& shelf, KBiquad& hp)
{
  {
    const double f0 = 1681.974450955533, G = 3.999843853973347, Q = 0.7071752369554196;
    const double K = std::tan(M_PI * f0 / sr), Vh = std::pow(10., G / 20.), Vb = std::pow(Vh, 0.4996667741545416);
    const double a0 = 1. + K / Q + K * K;
    shelf = {(Vh + Vb * K / Q + K * K) / a0, 2. * (K * K - Vh) / a0, (Vh - Vb * K / Q + K * K) / a0,
             2. * (K * K - 1.) / a0, (1. - K / Q + K * K) / a0};
  }
  {
    const double f0 = 38.13547087602444, Q = 0.5003270373238773;
    const double K = std::tan(M_PI * f0 / sr), a0 = 1. + K / Q + K * K;
    hp = {1., -2., 1., 2. * (K * K - 1.) / a0, (1. - K / Q + K * K) / a0};
  }
}

inline double MaxMomentaryLufs(const std::vector<std::vector<float>>& channels, double sr, size_t n)
{
  if (channels.empty() || n == 0) return -70.;
  const size_t nch = std::min<size_t>(channels.size(), 2);
  std::vector<double> ms(n, 0.); // K-weighted power summed over channels (weights 1 for L/R)
  for (size_t c = 0; c < nch; c++)
  {
    KBiquad a, b; KWeighting(sr, a, b);
    const auto& ch = channels[c];
    for (size_t i = 0; i < n && i < ch.size(); i++) { const double y = b.Run(a.Run(ch[i])); ms[i] += y * y; }
  }
  const size_t win = std::min(n, (size_t) std::lround(0.4 * sr)), hop = std::max<size_t>(1, (size_t) std::lround(0.1 * sr));
  double acc = 0.; for (size_t i = 0; i < win; i++) acc += ms[i];
  double best = acc / win;
  for (size_t s0 = hop; s0 + win <= n; s0 += hop)
  {
    acc = 0.; for (size_t i = s0; i < s0 + win; i++) acc += ms[i];
    best = std::max(best, acc / win);
  }
  return best > 1e-12 ? -0.691 + 10. * std::log10(best) : -70.;
}

// ---------------------------------------------------------------- druminess
// How percussive: a sharp attack (onset -> peak) and most of the energy early
// (first 250 ms of the first 2 s after the onset). env = 1 ms peak envelope.
inline double Druminess(const std::vector<float>& env, size_t on, size_t pk, double attackMs)
{
  const size_t nb = env.size();
  double early = 0., total = 0.;
  for (size_t b = on; b < std::min(nb, on + 2000); b++)
  {
    const double e = (double) env[b] * env[b];
    total += e;
    if (b < on + 250) early += e;
  }
  (void) pk;
  const double sharp = 1. - std::clamp((attackMs - 5.) / 75., 0., 1.);
  const double front = total > 0 ? early / total : 1.;
  return std::clamp(0.35 * sharp + 0.65 * front, 0., 1.); // sustain weighs more than the attack
}

// ---------------------------------------------------------------- late transient
// A second attack after the first one (flam, double hit, clap tail, a sample
// with two strikes). 5 ms RMS in dB; a "rise" = how far a frame is above the
// minimum of the previous 30 ms. Compares the strongest rise between 40 ms and
// 1.5 s after the onset, while the sound is still within 30 dB of its peak.
// 0 = none (< 1.5 dB, noise level), 1 = a jump of 10 dB or more (a full second hit).
inline double LateTransient(const std::vector<float>& x, double sr, size_t onS)
{
  const size_t fr = std::max<size_t>(1, (size_t) std::lround(0.005 * sr));
  const size_t n = x.size();
  if (onS >= n) return 0.;
  const size_t start = onS > fr * 6 ? onS - fr * 6 : 0;
  std::vector<double> e;
  for (size_t i = start; i + fr <= std::min(n, onS + (size_t) (1.6 * sr)); i += fr)
  {
    double a = 0; for (size_t k = i; k < i + fr; k++) a += (double) x[k] * x[k];
    e.push_back(10. * std::log10(a / fr + 1e-14));
  }
  if (e.size() < 10) return 0.;
  double peakDb = -300; for (double v : e) peakDb = std::max(peakDb, v);
  auto rise = [&](size_t t) {
    double m = e[t];
    for (size_t k = t >= 6 ? t - 6 : 0; k < t; k++) m = std::min(m, e[k]);
    return e[t] - m;
  };
  const size_t onF = (onS - start) / fr;
  double mainRise = 0;
  for (size_t t = onF >= 4 ? onF - 4 : 0; t < std::min(e.size(), onF + 5); t++) mainRise = std::max(mainRise, rise(t));
  double late = 0;
  for (size_t t = onF + 8; t < e.size(); t++)
    if (e[t] > peakDb - 30.) late = std::max(late, rise(t));
  // The main hit rises from silence (tens of dB), so it can't be the yardstick:
  // a later rise under 1.5 dB is noise-level, 10 dB is a full second hit.
  (void) mainRise;
  return std::clamp((late - 1.5) / 8.5, 0., 1.);
}

// ---------------------------------------------------------------- analysis
// channels: decoded audio (any length). fileDurMs: duration from the header
// when only the start of a long file was decoded (0 = use the decoded length).
inline SampleFeatures AnalyzeSample(const std::vector<std::vector<float>>& channels, double sr, double fileDurMs = 0)
{
  SampleFeatures f;
  if (channels.empty() || channels[0].empty() || sr <= 0) return f;
  const size_t frames = channels[0].size();
  f.durMs = fileDurMs > 0 ? fileDurMs : frames / sr * 1000.;

  // mono, first 5 s
  const size_t n = std::min(frames, (size_t) (sr * 5.));
  std::vector<float> x(n, 0.f);
  const int nch = (int) channels.size();
  for (int c = 0; c < nch; c++)
    for (size_t i = 0; i < n && i < channels[(size_t) c].size(); i++) x[i] += channels[(size_t) c][i] / (float) nch;

  // 1 ms peak envelope -> global peak -> onset (first point 30 dB below the peak, going back)
  const size_t blk = std::max<size_t>(1, (size_t) (sr * 0.001));
  const size_t nb = n / blk;
  if (nb < 2) return f;
  std::vector<float> env(nb, 0.f);
  double sum2 = 0;
  for (size_t b = 0; b < nb; b++)
    for (size_t i = 0; i < blk; i++)
    {
      const float v = std::fabs(x[b * blk + i]);
      env[b] = std::max(env[b], v);
      sum2 += (double) v * v;
    }
  size_t pk = 0;
  for (size_t b = 1; b < nb; b++) if (env[b] > env[pk]) pk = b;
  f.peak = env[pk];
  f.rms = std::sqrt(sum2 / (double) (nb * blk));
  if (f.peak < 1e-5) return f; // silence

  const double thr30 = f.peak * 0.0316;
  size_t on = pk;
  while (on > 0 && env[on - 1] > thr30) on--;
  f.attackMs = (double) (pk - on);

  // decay to -20 / -40 dB (smoothed: max over 5 ms so a single dip does not end it)
  auto decayTo = [&](double db) {
    const double t = f.peak * std::pow(10., db / 20.);
    for (size_t b = pk; b + 5 < nb; b++)
    {
      float m = 0.f;
      for (size_t k = 0; k < 5; k++) m = std::max(m, env[b + k]);
      if (m < t) return (double) (b - pk);
    }
    return (double) (nb - pk);
  };
  f.decay20 = decayTo(-20.);
  f.decay40 = decayTo(-40.);
  // Loop / stem: after falling 30 dB under the peak, the level comes back to -12 dB.
  {
    bool fell = false;
    for (size_t b = pk + 80; b < nb; b++) // claps re-attack within a few tens of ms: not a re-hit
    {
      if (!fell) { if (env[b] < f.peak * 0.0316) fell = true; }
      else if (env[b] > f.peak * 0.25) { f.reHit = true; break; }
    }
  }
  // A file cut before it decays (decoded only partly) keeps the header length as a floor.
  if (fileDurMs > 0 && f.decay40 >= (double) (nb - pk) - 1) f.decay40 = std::max(f.decay40, fileDurMs - pk);

  // spectra: N = 2048 frames, hop 256, Hann; power per frame
  const int N = 2048, H = 256;
  const size_t onS = on * blk;
  std::vector<double> win(N);
  for (int i = 0; i < N; i++) win[i] = 0.5 - 0.5 * std::cos(2. * M_PI * i / (N - 1));
  std::vector<std::complex<double>> buf(N);
  const int bins = N / 2;
  std::vector<double> body(bins, 0.);

  // mel band edges
  const double fMin = 40., fMax = std::min(16000., sr * 0.49);
  double edges[kFpBands + 2];
  for (int b = 0; b < kFpBands + 2; b++)
    edges[b] = MelToHz(HzToMel(fMin) + (HzToMel(fMax) - HzToMel(fMin)) * b / (kFpBands + 1));
  const double segEdgesMs[kFpSegs + 1] = {0, 10, 30, 70, 150, 300, 600};
  double cell[kFpSegs][kFpBands] = {};
  int cellCount[kFpSegs] = {};
  // each bin feeds at most two triangular filters: precompute (band, weight)
  std::vector<int> fb0(bins, -1), fb1(bins, -1);
  std::vector<double> fw0(bins, 0.), fw1(bins, 0.);
  for (int k = 1; k < bins; k++)
  {
    const double hz = k * sr / N;
    for (int b = 0; b < kFpBands; b++)
      if (hz >= edges[b] && hz < edges[b + 2])
      {
        const double w = hz < edges[b + 1] ? (hz - edges[b]) / (edges[b + 1] - edges[b])
                                            : (edges[b + 2] - hz) / (edges[b + 2] - edges[b + 1]);
        if (fb0[k] < 0) { fb0[k] = b; fw0[k] = w; } else { fb1[k] = b; fw1[k] = w; }
      }
  }

  // frames centred from the onset (-5 ms) up to 600 ms after it
  const long first = (long) onS - (long) (0.005 * sr) - N / 2;
  const long lastC = (long) onS + (long) (0.6 * sr);
  for (long c0 = first; c0 + N / 2 <= lastC; c0 += H)
  {
    for (int i = 0; i < N; i++)
    {
      const long k = c0 + i;
      buf[i] = (k >= 0 && k < (long) n) ? x[(size_t) k] * win[i] : 0.;
    }
    FFTInPlace(buf);
    const double centreMs = ((double) (c0 + N / 2) - (double) onS) / sr * 1000.;
    int seg = -1;
    for (int s = 0; s < kFpSegs; s++) if (centreMs >= segEdgesMs[s] && centreMs < segEdgesMs[s + 1]) seg = s;
    if (centreMs < 0) seg = 0;
    const bool inBody = centreMs < 300.;
    for (int k = 1; k < bins; k++)
    {
      const double p = std::norm(buf[k]);
      if (inBody) body[k] += p;
      if (seg >= 0)
      {
        if (fb0[k] >= 0) cell[seg][fb0[k]] += p * fw0[k];
        if (fb1[k] >= 0) cell[seg][fb1[k]] += p * fw1[k];
      }
    }
    if (seg >= 0) cellCount[seg]++;
  }

  // attacks in the first 60 ms, on the signal above ~1 kHz (low tones would
  // make every half cycle look like a new attack): 2 ms RMS frames, a new
  // attack = a rise of >= 6 dB after a dip, while still above -20 dB of the max.
  {
    std::vector<float> hp(n);
    double z1 = 0, z2 = 0;
    const double a = std::exp(-2. * M_PI * 1000. / sr);
    for (size_t i = 0; i < n; i++) { z1 = a * z1 + (1 - a) * x[i]; z2 = a * z2 + (1 - a) * z1; hp[i] = (float) (x[i] - z2); }
    const size_t fr = std::max<size_t>(1, (size_t) (0.002 * sr));
    const size_t i0 = onS > fr ? onS - fr : 0, i1 = std::min(n, onS + (size_t) (0.06 * sr));
    std::vector<double> e;
    for (size_t i = i0; i + fr <= i1; i += fr)
    {
      double acc = 0;
      for (size_t k = i; k < i + fr; k++) acc += (double) hp[k] * hp[k];
      e.push_back(std::sqrt(acc / fr));
    }
    double mx = 0;
    for (double v : e) mx = std::max(mx, v);
    int count = 0;
    double lo = 0;
    bool rising = true;
    double hi = 0;
    for (double v : e)
    {
      if (v < mx * 0.1) { if (!rising) lo = std::min(lo, v); continue; }
      if (rising) { if (v > hi) hi = v; else if (v < hi * 0.5) { count++; rising = false; lo = v; } }
      else { lo = std::min(lo, v); if (v > lo * 2.) { rising = true; hi = v; } }
    }
    if (rising && hi > 0) count++;
    f.attacks = std::max(1, count);
  }
  // (attacks are re-checked after the spectrum: with no real top end they mean nothing)

  // body descriptors
  {
    const double bandEdges[7] = {0, 90, 250, 900, 3000, 7000, 1e9};
    double tot = 0, cnum = 0, logSum = 0, lin = 0, lowMax = 0, lowSum = 0;
    int used = 0, lowN = 0;
    for (int k = 1; k < bins; k++)
    {
      const double hz = k * sr / N, p = body[k];
      tot += p; cnum += p * hz;
      for (int b = 0; b < 6; b++) if (hz >= bandEdges[b] && hz < bandEdges[b + 1]) f.band[b] += p;
      if (hz >= 30. && hz <= 16000.) { logSum += std::log(p + 1e-20); lin += p; used++; }
      if (hz >= 30. && hz <= 400.) { lowMax = std::max(lowMax, p); lowSum += p; lowN++; }
    }
    double eLo = 0, eHi = 0, eAir = 0, nLog = 0, nLin = 0; int nN = 0;
    for (int k = 1; k < bins; k++)
    {
      const double hz = k * sr / N, p = body[k];
      if (hz >= 40. && hz < 1000.) eLo += p;
      else if (hz >= 1000. && hz < 10000.) eHi += p;
      if (hz >= 6000.) eAir += p;
      if (hz >= 2000. && hz < 12000.) { nLog += std::log(p + 1e-20); nLin += p; nN++; }
    }
    f.brightDb = 10. * std::log10((eHi + 1e-20) / (eLo + 1e-20));
    f.airDb = 10. * std::log10((eAir + 1e-20) / (tot + 1e-20));
    f.noiseFlat = (nN && nLin > 0) ? std::exp(nLog / nN) / (nLin / nN) : 0.;
    if (tot > 0) { for (double& b : f.band) b /= tot; f.centroid = cnum / tot; }
    if (f.brightDb < -20.) f.attacks = 1; // top end 20 dB under the body: HP 'attacks' are just leakage
    f.flatness = (used && lin > 0) ? std::exp(logSum / used) / (lin / used) : 0.;
    f.lowTonality = (lowN && lowSum > 0) ? lowMax / (lowSum / lowN) : 0.;
  }

  // fingerprint: log power relative to the loudest cell, 60 dB range -> 0..-1
  {
    double mx = 1e-30;
    for (int s = 0; s < kFpSegs; s++)
      for (int b = 0; b < kFpBands; b++)
      {
        if (cellCount[s]) cell[s][b] /= cellCount[s];
        mx = std::max(mx, cell[s][b]);
      }
    for (int s = 0; s < kFpSegs; s++)
      for (int b = 0; b < kFpBands; b++)
      {
        const double db = 10. * std::log10((cell[s][b] + 1e-30) / mx);
        f.fp[s * kFpBands + b] = (float) std::clamp(db / 60., -1., 0.);
      }
  }

  f.lufs = MaxMomentaryLufs(channels, sr, std::min(frames, (size_t) (sr * 5.)));
  f.druminess = Druminess(env, on, pk, f.attackMs);
  f.lateTransient = LateTransient(x, sr, onS);

  f.desc[0] = (float) std::log10(std::max(5., f.decay40));
  f.desc[1] = (float) (f.brightDb / 20.);
  f.desc[2] = (float) (std::max(-60., f.airDb) / 20.);
  f.desc[3] = (float) f.noiseFlat;
  f.desc[4] = (float) std::log10(std::max(1., f.lowTonality));
  f.desc[5] = (float) (std::min(f.attacks, 5) / 5.);
  f.desc[6] = (float) (std::max(-70., f.lufs) / 20.);
  f.desc[7] = (float) f.druminess;
  f.desc[8] = (float) f.lateTransient;

  f.ok = true;
  ClassifyDrum(f);
  return f;
}

// Name hint: only explicit words in the file name (word boundaries), used when
// the audio is ambiguous (low confidence). Returns -1 when the name says nothing.
inline int DrumClassFromName(std::string name)
{
  std::transform(name.begin(), name.end(), name.begin(), [](unsigned char c) { return (char) std::tolower(c); });
  for (char& c : name) if (!std::isalnum((unsigned char) c)) c = ' ';
  name = " " + name + " ";
  auto has = [&](const char* w) { return name.find(std::string(" ") + w) != std::string::npos; };
  auto word = [&](const char* w) { return name.find(std::string(" ") + w + " ") != std::string::npos; };
  if (has("kick") || has("bombo") || word("bd") || word("kik")) return kClsKick;
  if (has("clap") || has("palma")) return kClsClap;
  if (has("snare") || has("redoblante") || word("sd") || word("snr") || has("rim")) return kClsSnare;
  if (has("openhat") || has("open hat") || has("ohh") || word("oh") || has("hho")) return kClsHHO;
  if (has("hat") || has("hihat") || word("hh") || word("chh") || has("hhc") || has("charles")) return kClsHHC;
  if (has("crash") || has("ride") || has("cymbal") || has("plato") || has("china") || has("splash")) return kClsCymbal;
  if (has("tom") || has("floor")) return kClsTom;
  if (has("fx") || has("riser") || has("sweep") || has("loop") || has("noise")) return kClsFX;
  if (has("perc") || has("conga") || has("bongo") || has("cowbell") || has("shaker") || has("tamb")) return kClsPerc;
  return -1;
}

} // namespace tu
