// clang++ -std=c++17 -O1 -g -I.. onset_test.cpp -o /tmp/onset_test && /tmp/onset_test
// EXACT ONSET: the same hit at different levels crosses the threshold at different
// times, but crossing - lead (the real onset) must be the same, so the replacement
// keeps its position relative to the original whatever the dynamics.
#include "DSP/TransientDetector.h"
#include "DSP/SlotEngine.h"
#include <cassert>
#include <cstdio>
#include <cmath>
#include <vector>
int main()
{
  setvbuf(stdout, nullptr, _IONBF, 0);
  const double sr = 48000.;
  const int onsetAt = 4800; // 100 ms
  int ref = -1000000;
  for (double g : {1.0, 0.6, 0.35, 0.25})
  {
    // drum-like: 2 ms linear attack, 180 Hz decaying sine, plus a little noise floor
    std::vector<float> x(48000, 0.f);
    unsigned seed = 1;
    for (int i = 0; i < (int) x.size(); i++)
    {
      seed = seed * 1664525u + 1013904223u;
      x[i] = (float) (((seed >> 9) / 8388608.0 - 1.0) * 0.0005);
      if (i >= onsetAt)
      {
        const double t = (i - onsetAt) / sr;
        const double att = std::min(1., t / 0.002);
        x[i] += (float) (g * att * std::exp(-t / 0.08) * std::sin(2 * M_PI * 180. * t + 0.3));
      }
    }
    TransientDetector det; det.Reset(sr); det.SetParams(51, 30, 14, 20, 20000, 0);
    int found = -1, lead = -1;
    for (int b = 0; b < (int) x.size(); b += 64)
      det.Process(&x[b], &x[b], 64, 1., [&](int off, float, int l) { if (found < 0) { found = b + off; lead = l; } });
    assert(found >= 0);
    const int crossing = found - det.LatencySamples();
    const int onset = crossing - lead;
    printf("gain %.2f: crossing %+5d  lead %3d  -> onset %+4d samples from the true start\n", g, crossing - onsetAt, lead, onset - onsetAt);
    if (ref == -1000000) ref = onset;
    assert(std::abs(onset - ref) <= 2);          // same position at every level
    assert(std::abs(onset - onsetAt) <= 30);     // and at the start of the attack (10 % point, < 0.6 ms)
  }
  // the voice starts `lead` into the pre-roll, never past it
  Slot slot; VoiceParams p;
  auto* s = new SampleData; s->numChannels = 1; s->sampleRate = 48000; s->numFrames = 480;
  s->ch[0].assign(480, 0.f); for (int i = 240; i < 480; i++) s->ch[0][i] = 1.f; s->leadFrames = 240;
  slot.SetSample(s); slot.SwapIfPending();
  std::vector<float> L(512, 0.f), R(512, 0.f);
  slot.Trigger(0, 1.f, 100, 48000.);
  slot.Render(L.data(), R.data(), 512, p);
  int first = -1; for (int i = 0; i < 512; i++) if (L[i] > 0.5f) { first = i; break; }
  printf("pre-roll 240, lead 100 -> sound at %d (expect 140)\n", first);
  assert(first == 140);
  printf("OK\n");
}
