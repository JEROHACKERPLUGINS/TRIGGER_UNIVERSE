// clang++ -std=c++17 -O2 -I.. sample_map_test.cpp -o /tmp/map_test && /tmp/map_test [perClass, default 220 = ~2000 samples]
// Acceptance criteria of the map (docs/TRASPASO.md §2.4), synthetic library
// (every drum type, many variations) + a few odd sounds:
//   X axis      Spearman(x, brightness) >= 0.85      (bass left, bright right)
//   Y axis      Spearman(y, length)   >= 0.85        (map y 0 = short = top of the screen)
//   clumps      similar sounds close: mean map distance to the 5 most similar sounds
//               <= 0.35 x the mean distance to 5 random samples
//   families    kicks left, hats right-top, cymbals right-bottom, toms left (centres)
//   purity      >= 65 % of the 10 nearest map neighbours share the detected type
//   fill        >= 35 % of a 20x20 grid used (scaled down below 1000 samples)
//   no stacks   5th percentile of the nearest-neighbour distance >= 0.10 x ideal spacing
//   insert      adding 10 % new samples moves no old one; new ones land within
//               0.08 (median) of where a full build puts them
//   similar     >= 75 % of the 5 nearest in the 4-D embedding share the type
//   determinism same input, same map
// Writes /tmp/sample_map.csv (x, y, type, dur, odd) for a visual check.
#include "DSP/SampleMap.h"
#include "drum_synth.h"
#include <cassert>
#include <chrono>
#include <cstdio>

using namespace tu;

static std::vector<float> Odd(int k, double sr = 48000.)
{
  const int n = (int) (0.6 * sr);
  std::vector<float> y((size_t) n, 0.f);
  Rng g((unsigned) (k * 31 + 7));
  for (int i = 0; i < n; i++)
  {
    const double t = i / sr;
    switch (k % 3)
    {
      case 0: y[(size_t) i] = (float) (0.5 * std::sin(2 * M_PI * (1200. + 400. * k) * t) * std::min(1., t / 0.05)); break;
      case 1: y[(size_t) i] = (float) (i < 40 ? 0.9 : 0.); break;
      case 2: y[(size_t) i] = (float) (0.3 * g.n() * (t < 0.3 ? 1. : 0.)); break;
    }
  }
  return y;
}

struct Lib { std::vector<SampleFeatures> f; std::vector<std::vector<float>> feat; std::vector<char> odd; };

static void Add(Lib& L, const std::vector<float>& y, bool odd)
{
  L.f.push_back(AnalyzeSample({y}, 48000.));
  std::vector<float> v(kFeatSize);
  std::copy(L.f.back().fp, L.f.back().fp + kFpSize, v.begin());
  std::copy(L.f.back().desc, L.f.back().desc + kDescSize, v.begin() + kFpSize);
  L.feat.push_back(v);
  L.odd.push_back(odd);
}

static std::vector<MapItem> Items(const Lib& L, int count, const std::vector<MapPoint>* prev = nullptr)
{
  std::vector<MapItem> it;
  for (int i = 0; i < count; i++)
  {
    MapItem m; m.feat = L.feat[(size_t) i].data(); m.durMs = L.f[(size_t) i].durMs; m.cls = L.f[(size_t) i].cls;
    if (prev && i < (int) prev->size()) { m.prevX = (*prev)[(size_t) i].x; m.prevY = (*prev)[(size_t) i].y; }
    it.push_back(m);
  }
  return it;
}

static double D2(const MapPoint& a, const MapPoint& b) { return (a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y); }

static double Spearman(const std::vector<double>& a, const std::vector<double>& b)
{
  auto ranks = [](const std::vector<double>& v) {
    std::vector<int> idx(v.size()); std::iota(idx.begin(), idx.end(), 0);
    std::sort(idx.begin(), idx.end(), [&](int i, int j) { return v[(size_t) i] < v[(size_t) j]; });
    std::vector<double> r(v.size());
    for (size_t k = 0; k < idx.size(); k++) r[(size_t) idx[k]] = (double) k;
    return r;
  };
  const auto ra = ranks(a), rb = ranks(b);
  const double n = (double) a.size(), m = (n - 1) / 2.;
  double sab = 0, saa = 0, sbb = 0;
  for (size_t i = 0; i < a.size(); i++) { sab += (ra[i] - m) * (rb[i] - m); saa += (ra[i] - m) * (ra[i] - m); sbb += (rb[i] - m) * (rb[i] - m); }
  return sab / std::sqrt(saa * sbb);
}

int main(int argc, char** argv)
{
  const int per = argc > 1 ? atoi(argv[1]) : 220;
  Lib L;
  for (int k = 0; k < per; k++)
    for (int c = 0; c < kNumClasses; c++) Add(L, Vary(SynthDrum(c, (unsigned) (k + 100)), (unsigned) (k * 16 + c)), false);
  for (int k = 0; k < std::max(3, per / 8); k++) Add(L, Odd(k), true);
  const int n = (int) L.f.size();
  const auto items = Items(L, n);

  auto t0 = std::chrono::steady_clock::now();
  bool full = false;
  const auto map = ComputeSampleMap(items, {}, nullptr, &full);
  const double secs = std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count();
  assert(full && (int) map.size() == n);

  // axes
  std::vector<double> mx, my, dark, len;
  for (int i = 0; i < n; i++)
  {
    mx.push_back(map[(size_t) i].x); my.push_back(map[(size_t) i].y);
    dark.push_back(MapBrightness(items[(size_t) i].feat)); // brightness: x grows with it
    len.push_back(MapLength(items[(size_t) i].feat, items[(size_t) i].durMs, items[(size_t) i].cls));
  }
  const double sx = Spearman(mx, dark), sy = Spearman(my, len);

  // clumps: map distance to the 5 most similar sounds vs 5 pseudo-random samples
  const auto X = PcaReduce(MapFeatureRows(items, {}), 24);
  std::vector<int> all((size_t) n); std::iota(all.begin(), all.end(), 0);
  double dSim = 0, dRnd = 0;
  for (int i = 0; i < n; i++)
  {
    for (int j : NearestIn(X, i, all, 5)) dSim += std::sqrt(D2(map[(size_t) i], map[(size_t) j]));
    for (int k = 1; k <= 5; k++) dRnd += std::sqrt(D2(map[(size_t) i], map[(size_t) ((i * 7919 + k * 104729) % n)]));
  }
  const double clump = dSim / dRnd;

  // purity + nearest-neighbour distance
  double purity = 0;
  std::vector<double> nnDist((size_t) n);
  for (int i = 0; i < n; i++)
  {
    std::vector<std::pair<double, int>> d;
    for (int j = 0; j < n; j++) if (j != i) d.push_back({D2(map[(size_t) i], map[(size_t) j]), j});
    std::partial_sort(d.begin(), d.begin() + 10, d.end());
    int same = 0; for (int k = 0; k < 10; k++) same += L.f[(size_t) d[(size_t) k].second].cls == L.f[(size_t) i].cls;
    purity += same / 10.; nnDist[(size_t) i] = std::sqrt(d[0].first);
  }
  purity /= n;
  std::vector<double> sd = nnDist; std::sort(sd.begin(), sd.end());
  const double nn5 = sd[(size_t) (0.05 * n)] * std::sqrt((double) n);

  // fill
  int grid[20][20] = {}, used = 0;
  for (const auto& p : map) grid[std::min(19, (int) (p.y * 20))][std::min(19, (int) (p.x * 20))]++;
  for (auto& row : grid) for (int c : row) used += c > 0;
  const double fill = used / 400.;

  // family centres (screen terms: x right = bass, map y small = top = short)
  auto centre = [&](int c) {
    double x = 0, y = 0; int m = 0;
    for (int i = 0; i < n; i++) if (L.f[(size_t) i].cls == c && !L.odd[(size_t) i]) { x += map[(size_t) i].x; y += map[(size_t) i].y; m++; }
    return MapPoint{(float) (x / std::max(1, m)), (float) (y / std::max(1, m))};
  };
  printf("family centres (x: 0 bass .. 1 bright, y: 0 short .. 1 long)\n");
  for (int c = 0; c < kNumClasses; c++) { const auto p = centre(c); printf("  %-7s x %.2f  y %.2f\n", DrumClassName(c), p.x, p.y); }
  const auto ck = centre(kClsKick), ch = centre(kClsHHC), cc = centre(kClsCymbal), ct = centre(kClsTom);
  const bool families = ck.x < .4 && ch.x > .55 && cc.x > .55 && cc.y > ch.y + .2 && ct.x < .5; // (toms vs kicks in length depends on the kicks: 808s are long)

  // insert
  const int base = (int) (0.9 * n);
  const auto m90 = ComputeSampleMap(Items(L, base));
  bool full2 = true;
  const auto mIns = ComputeSampleMap(Items(L, n, &m90), {}, nullptr, &full2);
  assert(!full2);
  int moved = 0;
  for (int i = 0; i < base; i++) moved += (mIns[(size_t) i].x != m90[(size_t) i].x || mIns[(size_t) i].y != m90[(size_t) i].y);
  std::vector<double> err;
  for (int i = base; i < n; i++) err.push_back(std::sqrt(D2(mIns[(size_t) i], map[(size_t) i])));
  std::sort(err.begin(), err.end());
  const double insErr = err[err.size() / 2];

  // 4-D embedding: the similar-sounds list (5 nearest in e) should share the type
  double ePure = 0;
  for (int i = 0; i < n; i++)
  {
    std::vector<std::pair<double, int>> d;
    for (int j = 0; j < n; j++) if (j != i)
    {
      double s2 = 0; for (int k = 0; k < 4; k++) s2 += std::pow(map[(size_t) i].e[k] - map[(size_t) j].e[k], 2);
      d.push_back({s2, j});
    }
    std::partial_sort(d.begin(), d.begin() + 5, d.end());
    int same = 0; for (int k = 0; k < 5; k++) same += L.f[(size_t) d[(size_t) k].second].cls == L.f[(size_t) i].cls;
    ePure += same / 5.;
  }
  ePure /= n;

  const auto again = ComputeSampleMap(items);
  for (int i = 0; i < n; i++) assert(again[(size_t) i].x == map[(size_t) i].x && again[(size_t) i].y == map[(size_t) i].y);

  printf("map of %d samples in %.2f s\n", n, secs);
  printf("  X axis     %.2f   (>= 0.85)\n", sx);
  printf("  Y axis     %.2f   (>= 0.85)\n", sy);
  printf("  clumps     %.2f   (<= 0.35)\n", clump);
  printf("  families   %s\n", families ? "OK" : "WRONG");
  printf("  purity     %.0f %%  (>= 65)\n", 100 * purity);
  const double fillBar = .35 * std::min(1., n / 1000.); // small libraries are naturally sparse
  printf("  fill       %.0f %%  (>= %.0f)\n", 100 * fill, 100 * fillBar);
  printf("  no stacks  p5 nn %.2f x ideal  (>= 0.10)\n", nn5);
  printf("  insert     %d old moved (0), new within %.3f of a full build (<= 0.08)\n", moved, insErr);
  printf("  similar    %.0f %% of the 5 nearest in the 4-D embedding share the type (>= 75)\n", 100 * ePure);

  FILE* f = fopen("/tmp/sample_map.csv", "w");
  fprintf(f, "x,y,type,dur,odd\n");
  for (int i = 0; i < n; i++) fprintf(f, "%.4f,%.4f,%s,%.0f,%d\n", map[(size_t) i].x, map[(size_t) i].y, DrumClassName(L.f[(size_t) i].cls), L.f[(size_t) i].durMs, (int) L.odd[(size_t) i]);
  fclose(f);

  const bool ok = sx >= .85 && sy >= .85 && clump <= .35 && families && purity >= .65 && fill >= fillBar && nn5 >= .10 && moved == 0 && insErr <= .08 && ePure >= .75;
  printf(ok ? "sample_map_test OK\n" : "sample_map_test FAILED\n");
  return ok ? 0 : 1;
}
