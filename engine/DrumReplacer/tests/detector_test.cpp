// Builds a drum loop from ../samples at known positions and checks the detector finds
// every hit once, on time, with velocity following level.
// cd tests && clang++ -std=c++17 -I.. detector_test.cpp -o /tmp/det && /tmp/det
#include "DSP/TransientDetector.h"
#include "DSP/WavFile.h"
#include <cassert>
#include <cstdio>
#include <cstdlib>
#include <vector>

struct Placed { const char* file; double timeSec; float gain; };

int main()
{
  const double sr = 44100.;
  const Placed hits[] = {
    {"../samples/LR - Kick Rock 1.wav",    0.2, 1.0f},
    {"../samples/LR - Snare Indie 1.wav",  0.7, 1.0f},
    {"../samples/LR - Kick Rock 1.wav",    1.2, 0.5f},
    {"../samples/LR - Snare Indie 1.wav",  1.7, 0.6f},
    {"../samples/LR - Kick Rock 1.wav",    2.2, 0.4f},
  };
  const int n = (int) (4.5 * sr);
  std::vector<float> L(n), R(n);
  srand(1);
  for (int i = 0; i < n; i++) // -60 dBFS noise floor
    L[i] = R[i] = 0.001f * (rand() / (float) RAND_MAX * 2.f - 1.f);

  std::vector<int> expectedOnset;
  for (auto& h : hits)
  {
    std::vector<std::vector<float>> ch; double fileSR;
    if (!LoadWavFile(h.file, ch, fileSR)) { printf("can't read %s (run from tests/)\n", h.file); return 1; }
    assert(fileSR == sr);
    const int start = (int) (h.timeSec * sr);
    int onset = -1;
    for (size_t i = 0; i < ch[0].size() && start + (int) i < n; i++)
    {
      L[start + i] += ch[0][i] * h.gain;
      R[start + i] += ch[1][i] * h.gain;
      if (onset < 0 && std::fabs(ch[0][i]) > 0.01f) onset = start + (int) i;
    }
    expectedOnset.push_back(onset);
  }

  TransientDetector det;
  det.Reset(sr);
  // Prototype semantics: DETAIL 14 % (default, 0.21 full scale); RETRIGGER 200 ms
  // keeps the ringing snare from firing again (retrigger is blind time only).
  det.SetParams(51., 200., 14., 20., 20000., 0.);

  std::vector<int> pos; std::vector<float> vel;
  const int block = 256;
  for (int b = 0; b < n; b += block)
  {
    const int len = std::min(block, n - b);
    det.Process(&L[b], &R[b], len, 1., [&](int off, float v, int) { pos.push_back(b + off); vel.push_back(v); });
  }

  const int win = det.LatencySamples();
  for (size_t i = 0; i < pos.size(); i++)
    printf("hit %zu at %.4f s (onset+%.2f ms) vel %.2f\n", i, (pos[i] - win) / sr,
           i < expectedOnset.size() ? (pos[i] - win - expectedOnset[i]) * 1000. / sr : 0., vel[i]);

  assert(pos.size() == expectedOnset.size());       // every hit once, no tail retriggers
  for (size_t i = 0; i < pos.size(); i++)
  {
    const double errMs = (pos[i] - win - expectedOnset[i]) * 1000. / sr;
    assert(errMs >= -0.5 && errMs <= 3.);            // aligned with the onset after latency
  }
  assert(vel[0] > vel[2] && vel[2] > vel[4]);        // kicks: louder -> higher velocity
  assert(vel[1] > vel[3]);                           // snares too

  puts("detector_test: OK");
}
