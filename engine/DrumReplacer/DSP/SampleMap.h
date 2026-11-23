#pragma once

// TRIGGER UNIVERSE · sample map (XO-like behaviour, own implementation).
//
// The map has meaning on both axes, and similar sounds clump together:
//   X: low (bass) on the left, high (bright) on the right
//   Y: short on top, long at the bottom ("sounding" length: until it decays
//      40 dB, not the file length; FX / loops use the file length)
// Pipeline (library analysis thread):
//  1. Axis values per sample: brightness = mel centroid of the fingerprint's
//     body (10-150 ms) + perceptual brightness; length = log decay40 (+ a bit of
//     file length).
//  2. Base position = percentile on each axis (fills the frame evenly, any library).
//  3. Clumping: each sample is pulled toward the positions of its 8 most similar
//     sounds (timbre space: cepstrum + length + descriptors + soft type, robust
//     z-score, PCA-24), while staying anchored to its base. Similar sounds end
//     up together and close, like XO's constellations, and the axes keep meaning.
//  4. Small local relaxation so points do not sit exactly on top of each other.
//  Insert: when most samples already have a position, the old ones stay; new ones
//  get their base from the old samples' distributions and are pulled toward
//  their most similar OLD neighbours. Axes are fixed, so the map never flips.
// Deterministic: same library, same map.

#include "SampleAnalysis.h"
#include <algorithm>
#include <atomic>
#include <cmath>
#include <numeric>
#include <vector>

namespace tu
{

// Bump when the layout logic changes: stored positions from another version are dropped.
constexpr int kMapVersion = 3; // 3 = fixed axes (bass LEFT, bright right, short top) + similarity clumps

// x, y: position on the map. e: 4-D timbre embedding (first 4 principal
// components of the similarity space, ~-1..1) for the similar-sounds list.
struct MapPoint { float x = .5f, y = .5f; float e[4] = {0.f, 0.f, 0.f, 0.f}; };

struct MapItem
{
  const float* feat = nullptr; // kFeatSize values (fingerprint + descriptors)
  double durMs = 0;
  int cls = kClsPerc;
  float prevX = -1.f, prevY = -1.f; // position in the stored map, < 0 = new
};

struct MapParams
{
  double wTimbre = 2.0;   // similarity space: cepstrum block (total)
  double wDur = 1.0;      //                   log duration
  double wDesc = 1.2;     //                   descriptor block (total)
  double wType = 1.6;     //                   one-hot type bias
  int pcaDims = 24;
  int neighbours = 8;     // clumping: pulled toward this many similar sounds
  double pull = 0.42;     // 0 = pure axes, 1 = pure similarity
  int pullIters = 2;
  double spacing = 0.5;   // min distance between points, x ideal even spacing
  double scatter = 0.014; // organic spread inside a group (fixed per sample): clouds, not lines
  double rankBlend = 0.75; // axis = blend of percentile (fills the frame) and real value (keeps
                          // near-identical sounds together instead of stretching them out)
  double insertWhenKnown = 0.7;
  bool forceRebuild = false;
};

constexpr int kCepCoeffs = 8;

// ------------------------------------------------------------ features
inline std::vector<std::vector<double>> MapFeatureRows(const std::vector<MapItem>& items, const MapParams& P)
{
  const int n = (int) items.size();
  const int nCep = kFpSegs * kCepCoeffs;
  const int D = nCep + 1 + kDescSize;
  std::vector<std::vector<double>> R((size_t) n, std::vector<double>((size_t) D, 0.));
  for (int i = 0; i < n; i++)
  {
    const float* f = items[(size_t) i].feat;
    for (int s = 0; s < kFpSegs; s++)
      for (int c = 0; c < kCepCoeffs; c++)
      {
        double acc = 0.;
        for (int b = 0; b < kFpBands; b++)
          acc += f[s * kFpBands + b] * std::cos(M_PI * c * (b + .5) / kFpBands);
        R[(size_t) i][(size_t) (s * kCepCoeffs + c)] = acc;
      }
    R[(size_t) i][(size_t) nCep] = std::log10(std::clamp(items[(size_t) i].durMs, 10., 60000.));
    for (int k = 0; k < kDescSize; k++) R[(size_t) i][(size_t) (nCep + 1 + k)] = f[kFpSize + k];
  }
  // robust z-score per column
  std::vector<double> col((size_t) n);
  for (int d = 0; d < D; d++)
  {
    for (int i = 0; i < n; i++) col[(size_t) i] = R[(size_t) i][(size_t) d];
    std::vector<double> tmp = col;
    std::nth_element(tmp.begin(), tmp.begin() + n / 2, tmp.end());
    const double med = tmp[(size_t) (n / 2)];
    for (auto& v : tmp) v = std::fabs(v - med);
    std::nth_element(tmp.begin(), tmp.begin() + n / 2, tmp.end());
    double mad = tmp[(size_t) (n / 2)] * 1.4826;
    if (mad < 1e-9)
    {
      double m = 0, v = 0; for (double x : col) m += x; m /= n;
      for (double x : col) v += (x - m) * (x - m);
      mad = std::sqrt(v / n);
    }
    if (mad < 1e-9) mad = 1.;
    const double w = d < nCep ? P.wTimbre / std::sqrt((double) nCep)
                   : d == nCep ? P.wDur
                   : P.wDesc / std::sqrt((double) kDescSize);
    for (int i = 0; i < n; i++)
      R[(size_t) i][(size_t) d] = std::clamp((R[(size_t) i][(size_t) d] - med) / mad, -6., 6.) * w;
  }
  // soft type bias
  for (int i = 0; i < n; i++)
    for (int c = 0; c < kNumClasses; c++)
      R[(size_t) i].push_back(items[(size_t) i].cls == c ? P.wType / std::sqrt(2.) : 0.);
  return R;
}

// ------------------------------------------------------------ PCA
inline std::vector<std::vector<double>> PcaReduce(const std::vector<std::vector<double>>& X, int dims)
{
  const int n = (int) X.size(), D = (int) X[0].size();
  dims = std::min(dims, D);
  std::vector<double> mean((size_t) D, 0.);
  for (const auto& r : X) for (int k = 0; k < D; k++) mean[(size_t) k] += r[(size_t) k] / n;
  // covariance (D x D, small)
  std::vector<double> C((size_t) D * D, 0.);
  for (const auto& r : X)
    for (int a = 0; a < D; a++)
    {
      const double xa = r[(size_t) a] - mean[(size_t) a];
      for (int b = a; b < D; b++) C[(size_t) a * D + b] += xa * (r[(size_t) b] - mean[(size_t) b]);
    }
  for (int a = 0; a < D; a++) for (int b = 0; b < a; b++) C[(size_t) a * D + b] = C[(size_t) b * D + a];
  std::vector<std::vector<double>> V;
  for (int comp = 0; comp < dims; comp++)
  {
    std::vector<double> v((size_t) D);
    for (int k = 0; k < D; k++) v[(size_t) k] = 1. + 0.31 * ((k * 7 + comp * 5) % 13);
    double lambda = 0.;
    for (int it = 0; it < 100; it++)
    {
      std::vector<double> w((size_t) D, 0.);
      for (int a = 0; a < D; a++) for (int b = 0; b < D; b++) w[(size_t) a] += C[(size_t) a * D + b] * v[(size_t) b];
      for (const auto& u : V) { double dp = 0; for (int k = 0; k < D; k++) dp += w[(size_t) k] * u[(size_t) k]; for (int k = 0; k < D; k++) w[(size_t) k] -= dp * u[(size_t) k]; }
      double nr = 0; for (double x : w) nr += x * x; nr = std::sqrt(nr);
      if (nr < 1e-12) break;
      lambda = nr;
      for (int k = 0; k < D; k++) v[(size_t) k] = w[(size_t) k] / nr;
    }
    if (lambda < 1e-9) break;
    V.push_back(v);
  }
  std::vector<std::vector<double>> Y((size_t) n, std::vector<double>(V.size(), 0.));
  for (int i = 0; i < n; i++)
    for (size_t c = 0; c < V.size(); c++)
    {
      double dot = 0;
      for (int k = 0; k < D; k++) dot += (X[(size_t) i][(size_t) k] - mean[(size_t) k]) * V[c][(size_t) k];
      Y[(size_t) i][c] = dot;
    }
  return Y;
}

inline double Dist2(const std::vector<double>& a, const std::vector<double>& b)
{
  double s = 0; for (size_t k = 0; k < a.size(); k++) { const double t = a[k] - b[k]; s += t * t; } return s;
}

// ------------------------------------------------------------ spacing
// Points in 0..1. Moves only the points with movable[i]. Keeps neighbourhoods:
// each point is pulled back toward where it started, and pushed away from
// points closer than the target spacing (grid hashing, O(n)).
inline void RelaxSpacing(std::vector<double>& Y, const std::vector<char>& movable, int iters, double springK, double spacingK = 0.85)
{
  const int n = (int) (Y.size() / 2);
  if (n < 2) return;
  const double r = spacingK / std::sqrt((double) n); // target spacing (x ideal even spacing in a unit square)
  const std::vector<double> home = Y;
  const int G = std::max(1, (int) (1. / r));
  std::vector<std::vector<int>> grid((size_t) G * G);
  for (int it = 0; it < iters; it++)
  {
    for (auto& c : grid) c.clear();
    for (int i = 0; i < n; i++)
    {
      const int gx = std::clamp((int) (Y[(size_t) i * 2] * G), 0, G - 1), gy = std::clamp((int) (Y[(size_t) i * 2 + 1] * G), 0, G - 1);
      grid[(size_t) gy * G + gx].push_back(i);
    }
    std::vector<double> mv(Y.size(), 0.);
    for (int i = 0; i < n; i++)
    {
      if (!movable[(size_t) i]) continue;
      const double x = Y[(size_t) i * 2], y = Y[(size_t) i * 2 + 1];
      const int gx = std::clamp((int) (x * G), 0, G - 1), gy = std::clamp((int) (y * G), 0, G - 1);
      for (int oy = -1; oy <= 1; oy++) for (int ox = -1; ox <= 1; ox++)
      {
        const int cx = gx + ox, cy = gy + oy;
        if (cx < 0 || cy < 0 || cx >= G || cy >= G) continue;
        for (int j : grid[(size_t) cy * G + cx])
        {
          if (j == i) continue;
          double dx = x - Y[(size_t) j * 2], dy = y - Y[(size_t) j * 2 + 1];
          double dd = std::sqrt(dx * dx + dy * dy);
          if (dd >= r) continue;
          if (dd < 1e-9) { dx = std::cos(i * 2.399) ; dy = std::sin(i * 2.399); dd = 1.; }
          const double push = (r - dd) / r * r * .25;
          mv[(size_t) i * 2] += dx / dd * push; mv[(size_t) i * 2 + 1] += dy / dd * push;
        }
      }
      mv[(size_t) i * 2] += (home[(size_t) i * 2] - x) * springK;
      mv[(size_t) i * 2 + 1] += (home[(size_t) i * 2 + 1] - y) * springK;
    }
    for (int i = 0; i < n; i++)
    {
      Y[(size_t) i * 2] = std::clamp(Y[(size_t) i * 2] + mv[(size_t) i * 2], .01, .99);
      Y[(size_t) i * 2 + 1] = std::clamp(Y[(size_t) i * 2 + 1] + mv[(size_t) i * 2 + 1], .01, .99);
    }
  }
}


// ------------------------------------------------------------ axes
// Brightness: centroid (in mel bands, 0..15) of the body's spectrum, plus a bit
// of the perceptual brightness descriptor. Higher = brighter.
inline double MapBrightness(const float* f)
{
  double num = 0, den = 0;
  for (int s = 0; s <= 3; s++)       // 0-150 ms after the onset
    for (int b = 0; b < kFpBands; b++)
    {
      const double p = std::pow(10., 6. * f[s * kFpBands + b]); // fp is dB/60 relative to the loudest cell
      num += b * p; den += p;
    }
  const double mel = den > 0 ? num / den / (kFpBands - 1) : .5;
  return mel + 0.1 * f[kFpSize + 1];
}

// Length (log10 ms): how long it sounds; FX / loops use the file length.
inline double MapLength(const float* f, double durMs, int cls)
{
  const double fileLen = std::log10(std::clamp(durMs, 5., 60000.));
  if (cls == kClsFX) return fileLen;
  const double decay = f[kFpSize + 0]; // log10(decay40 ms)
  return 0.8 * std::min(decay, fileLen) + 0.2 * fileLen;
}

// Percentile of v among the sorted values (ties -> middle), 0..1.
inline double Percentile(const std::vector<double>& sorted, double v)
{
  const auto lo = std::lower_bound(sorted.begin(), sorted.end(), v);
  const auto hi = std::upper_bound(sorted.begin(), sorted.end(), v);
  const double r = ((lo - sorted.begin()) + (hi - sorted.begin())) * .5;
  return sorted.size() > 1 ? std::clamp(r / (double) (sorted.size() - 1), 0., 1.) : .5;
}

inline double AxisToUnit(double t) { return .03 + .94 * t; }

// k most similar (feature space) among the candidates
inline std::vector<int> NearestIn(const std::vector<std::vector<double>>& X, int i, const std::vector<int>& cand, int k)
{
  std::vector<std::pair<double, int>> d;
  d.reserve(cand.size());
  for (int j : cand) if (j != i) d.push_back({Dist2(X[(size_t) i], X[(size_t) j]), j});
  k = std::min<int>(k, (int) d.size());
  std::partial_sort(d.begin(), d.begin() + k, d.end());
  std::vector<int> out;
  for (int m = 0; m < k; m++) out.push_back(d[(size_t) m].second);
  return out;
}

// ------------------------------------------------------------ entry point
// Returns {} if cancelled.
inline std::vector<MapPoint> ComputeSampleMap(const std::vector<MapItem>& items, const MapParams& P = {},
                                              const std::atomic<bool>* cancel = nullptr, bool* didFullBuild = nullptr)
{
  const int n = (int) items.size();
  std::vector<MapPoint> out((size_t) n);
  if (didFullBuild) *didFullBuild = false;
  if (n == 0) return out;
  auto cancelled = [&] { return cancel && cancel->load(); };

  std::vector<double> B((size_t) n), L((size_t) n);
  for (int i = 0; i < n; i++)
  {
    B[(size_t) i] = MapBrightness(items[(size_t) i].feat);
    L[(size_t) i] = MapLength(items[(size_t) i].feat, items[(size_t) i].durMs, items[(size_t) i].cls);
  }
  const auto X = n >= 3 ? PcaReduce(MapFeatureRows(items, P), P.pcaDims) : std::vector<std::vector<double>>((size_t) n);

  std::vector<int> old;
  for (int i = 0; i < n; i++) if (items[(size_t) i].prevX >= 0.f) old.push_back(i);
  const bool insert = !P.forceRebuild && (int) old.size() >= 6 && old.size() >= P.insertWhenKnown * n;

  // base = percentile on each axis (insert: among the old samples, so new ones
  // land where a full build would have put them)
  std::vector<double> refB, refL;
  for (int i = 0; i < n; i++)
    if (!insert || items[(size_t) i].prevX >= 0.f) { refB.push_back(B[(size_t) i]); refL.push_back(L[(size_t) i]); }
  std::sort(refB.begin(), refB.end());
  std::sort(refL.begin(), refL.end());
  // real value scaled by the 2nd-98th percentile range
  auto scaled = [](const std::vector<double>& ref, double v) {
    const double a = ref[(size_t) (0.02 * (ref.size() - 1))], b = ref[(size_t) (0.98 * (ref.size() - 1))];
    return b - a > 1e-12 ? std::clamp((v - a) / (b - a), 0., 1.) : .5;
  };
  auto axis = [&](const std::vector<double>& ref, double v) {
    return P.rankBlend * Percentile(ref, v) + (1. - P.rankBlend) * scaled(ref, v);
  };
  std::vector<double> base((size_t) n * 2), Y((size_t) n * 2);
  for (int i = 0; i < n; i++)
  {
    base[(size_t) i * 2] = AxisToUnit(axis(refB, B[(size_t) i]));      // bass -> left, bright -> right
    base[(size_t) i * 2 + 1] = AxisToUnit(axis(refL, L[(size_t) i]));  // short -> 0 (top in the UI)
  }

  std::vector<char> movable((size_t) n, 1);
  if (insert)
  {
    for (int i : old)
    {
      Y[(size_t) i * 2] = items[(size_t) i].prevX; Y[(size_t) i * 2 + 1] = items[(size_t) i].prevY;
      movable[(size_t) i] = 0;
    }
    for (int i = 0; i < n; i++)
    {
      if (!movable[(size_t) i]) continue;
      if ((i & 63) == 0 && cancelled()) return {};
      const auto nb = NearestIn(X, i, old, P.neighbours);
      double mx = 0, my = 0;
      for (int j : nb) { mx += Y[(size_t) j * 2]; my += Y[(size_t) j * 2 + 1]; }
      const double k = (double) std::max<size_t>(1, nb.size());
      Y[(size_t) i * 2] = (1. - P.pull) * base[(size_t) i * 2] + P.pull * mx / k;
      Y[(size_t) i * 2 + 1] = (1. - P.pull) * base[(size_t) i * 2 + 1] + P.pull * my / k;
    }
  }
  else
  {
    std::vector<int> all((size_t) n);
    std::iota(all.begin(), all.end(), 0);
    std::vector<std::vector<int>> nb((size_t) n);
    for (int i = 0; i < n; i++)
    {
      if ((i & 63) == 0 && cancelled()) return {};
      if (n >= 3) nb[(size_t) i] = NearestIn(X, i, all, P.neighbours);
    }
    Y = base;
    for (int it = 0; it < P.pullIters; it++)
    {
      std::vector<double> Z((size_t) n * 2);
      for (int i = 0; i < n; i++)
      {
        double mx = 0, my = 0;
        for (int j : nb[(size_t) i]) { mx += Y[(size_t) j * 2]; my += Y[(size_t) j * 2 + 1]; }
        const double k = (double) std::max<size_t>(1, nb[(size_t) i].size());
        const double pull = nb[(size_t) i].empty() ? 0. : P.pull;
        Z[(size_t) i * 2] = (1. - pull) * base[(size_t) i * 2] + pull * mx / k;
        Z[(size_t) i * 2 + 1] = (1. - pull) * base[(size_t) i * 2 + 1] + pull * my / k;
      }
      Y = Z;
    }
    if (didFullBuild) *didFullBuild = true;
  }
  // fixed per-sample scatter (golden-angle spiral offsets): groups read as star clouds
  for (int i = 0; i < n; i++)
  {
    if (!movable[(size_t) i]) continue;
    const double h = std::fmod(std::sin((B[(size_t) i] * 12.9898 + L[(size_t) i] * 78.233) * 43758.5453) * 43758.5453, 1.);
    const double a = (i + std::fabs(h) * 97.) * 2.39996322972865332, r = P.scatter * std::sqrt(std::fabs(h));
    Y[(size_t) i * 2] += r * std::cos(a);
    Y[(size_t) i * 2 + 1] += r * std::sin(a);
  }
  RelaxSpacing(Y, movable, 12, 0.15, P.spacing);
  // 4-D embedding: first 4 PCA components of the similarity space, scaled by 3 sigma
  double sd[4] = {0, 0, 0, 0};
  const int ed = n >= 3 ? std::min<int>(4, (int) X[0].size()) : 0;
  for (int i = 0; i < n; i++) for (int k = 0; k < ed; k++) sd[k] += X[(size_t) i][(size_t) k] * X[(size_t) i][(size_t) k];
  for (int k = 0; k < ed; k++) sd[k] = std::sqrt(sd[k] / n) * 3. + 1e-12;
  for (int i = 0; i < n; i++)
  {
    MapPoint& o = out[(size_t) i];
    o.x = (float) std::clamp(Y[(size_t) i * 2], .01, .99);
    o.y = (float) std::clamp(Y[(size_t) i * 2 + 1], .01, .99);
    for (int k = 0; k < ed; k++) o.e[k] = (float) std::clamp(X[(size_t) i][(size_t) k] / sd[k], -1., 1.);
  }
  return out;
}

} // namespace tu
