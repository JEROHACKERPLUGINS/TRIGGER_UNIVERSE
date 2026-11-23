// clang++ -std=c++17 -O1 -g -I.. choke_test.cpp -o /tmp/choke_test && /tmp/choke_test
// ONE SHOT with choke: a new hit fades the ringing one out in 5 ms from the new hit's
// position, so hits never pile up; no click.
#include "DSP/SlotEngine.h"
#include <cassert>
#include <cstdio>
#include <cmath>
int main()
{
  Slot slot; VoiceParams p;
  auto* s = new SampleData; s->numChannels = 1; s->sampleRate = 48000; s->ch[0].assign(48000, 0.5f); s->numFrames = 48000;
  slot.SetSample(s); slot.SwapIfPending();
  std::vector<float> L(64), R(64);
  float prev = 0.f, maxStep = 0.f, last = 0.f;
  for (int b = 0; b < 40; b++)
  {
    std::fill(L.begin(), L.end(), 0.f); std::fill(R.begin(), R.end(), 0.f);
    if (b == 0) slot.Trigger(0, 1.f);
    if (b == 20) slot.Trigger(32, 1.f);   // second hit while the first rings
    slot.Render(L.data(), R.data(), 64, p);
    for (int i = 0; i < 64; i++)
    {
      // the new hit's own onset (a DC test sample starts at full level) is not a click
      if (!(b == 20 && i == 32) && !(b == 0 && i == 0)) maxStep = std::max(maxStep, std::fabs(L[i] - prev));
      prev = L[i];
    }
    last = L[63];
  }
  // overlap would give 1.0 (0.5 + 0.5); choke leaves only the new hit
  printf("after 2nd hit: %.3f (0.5 = no pile-up), max step during the 5 ms fade %.4f\n", last, maxStep);
  fflush(stdout); assert(std::fabs(last - 0.5f) < 1e-4 && maxStep < 0.01f);
  puts("choke_test OK");
}
