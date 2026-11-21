#include "DSP/TransientDetector.h"
#include "DSP/WavFile.h"
#include <cstdio>
#include <vector>
#include <string>
#include <cmath>
#include <algorithm>

static void run(const std::vector<std::vector<float>>& ch, double sr, const char* label,
                double sens, double retrig, double detail, double supp)
{
  const size_t n = ch[0].size();
  const std::vector<float>& L = ch[0];
  const std::vector<float> monoFallback;
  const std::vector<float>& R = ch.size() > 1 ? ch[1] : L;
  TransientDetector det;
  det.Reset(sr);
  det.SetParams(sens, retrig, detail, 30., 15000., supp);
  std::vector<int> pos; std::vector<float> vel;
  const int block = 256;
  for (size_t b = 0; b < n; b += block)
  {
    const int len = (int) std::min<size_t>(block, n - b);
    det.Process(&L[b], &R[b], len, 1., [&](int off, float v) { pos.push_back((int)b + off); vel.push_back(v); });
  }
  const int win = det.LatencySamples();
  printf("%s -> %zu hits\n", label, pos.size());
  for (size_t i = 0; i < pos.size(); i++)
    printf("  %.4f s  vel %.2f\n", (pos[i] - win) / sr, vel[i]);
}

int main()
{
  std::vector<std::vector<float>> ch; double sr = 0.;
  const char* path = "/Users/dante/Desktop/SNARE.cm.wav";
  if (!LoadWavFile(path, ch, sr)) { printf("cannot read %s\n", path); return 1; }
  printf("file: sr %.0f, channels %zu, frames %zu, duration %.4f s\n",
         sr, ch.size(), ch[0].size(), ch[0].size() / sr);
  double peak = 0., sumsq = 0.;
  for (auto& c : ch) for (float v : c) { peak = std::max(peak, (double)std::fabs(v)); sumsq += (double)v * v; }
  const double total = (double)ch.size() * ch[0].size();
  printf("peak %.2f dBFS, rms %.2f dBFS\n", 20 * std::log10(std::max(peak, 1e-9)), 20 * std::log10(std::sqrt(sumsq / total)));
  run(ch, sr, "defaults sens45 retrig50 detail50 supp50", 45., 50., 50., 50.);
  run(ch, sr, "retrig250", 45., 250., 50., 50.);
  run(ch, sr, "detail0", 45., 50., 0., 50.);
  run(ch, sr, "sens20", 20., 50., 50., 50.);
  run(ch, sr, "sens70 (old test default)", 70., 50., 50., 50.);
  return 0;
}
