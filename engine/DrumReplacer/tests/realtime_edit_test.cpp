// clang++ -std=c++17 -O2 -I.. realtime_edit_test.cpp -o /tmp/realtime_edit_test && /tmp/realtime_edit_test
// An edit while a hit rings: the voice keeps playing from the same point on the new
// buffer (crossfade, no click), the old buffer is freed only after the crossfade;
// a new file (continuePlaying = false) still stops the voice.
#include "DSP/SlotEngine.h"
#include <cassert>
#include <cstdio>
#include <cmath>

static SampleData* Dc(float v, int n) { auto* s = new SampleData; s->numChannels = 1; s->sampleRate = 48000; s->ch[0].assign((size_t) n, v); s->numFrames = n; return s; }

int main()
{
  Slot slot; VoiceParams p;
  slot.SetSample(Dc(0.5f, 48000)); slot.SwapIfPending(); slot.CollectGarbage();
  slot.Trigger(0, 1.f);
  std::vector<float> L(64), R(64);
  auto block = [&] { std::fill(L.begin(), L.end(), 0.f); std::fill(R.begin(), R.end(), 0.f); slot.SwapIfPending(); slot.Render(L.data(), R.data(), 64, p); };
  for (int b = 0; b < 10; b++) block();                  // ringing at 0.5
  slot.SetSample(Dc(0.25f, 48000), true);                // edit: gain -6 dB
  float prev = L[63], maxStep = 0.f;
  for (int b = 0; b < 8; b++)
  {
    block();
    for (int i = 0; i < 64; i++) { maxStep = std::max(maxStep, std::fabs(L[i] - prev)); prev = L[i]; }
    slot.CollectGarbage();                               // must not free the old buffer mid-crossfade
  }
  printf("after edit: %.3f (0.25), max step %.4f, still playing: %d\n", L[63], maxStep, (int) (L[63] != 0.f));
  assert(std::fabs(L[63] - 0.25f) < 1e-4 && maxStep < 0.01f);
  slot.SetSample(Dc(0.9f, 48000), false);                // a new file: stops
  block();
  printf("new file: %.3f (0 = stopped)\n", L[63]);
  assert(L[63] == 0.f);
  puts("realtime_edit_test OK");
}
