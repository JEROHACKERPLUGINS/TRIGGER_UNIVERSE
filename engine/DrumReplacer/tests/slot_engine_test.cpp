// clang++ -std=c++17 -I.. slot_engine_test.cpp -o /tmp/slot_test && /tmp/slot_test
#include "DSP/SlotEngine.h"
#include <cassert>
#include <cstdio>

int main()
{
  auto* pData = new SampleData;
  pData->numChannels = 1;
  pData->numFrames = 100;
  pData->ch[0].assign(100, 1.f); // constant 1.0, mono
  pData->sampleRate = 48000.;

  Slot slot;
  slot.SetSample(pData);
  slot.SwapIfPending();
  assert(slot.HasSample());

  float L[256] = {}, R[256] = {};
  VoiceParams p; // unity gain, ratio 1, no attack, full sustain
  slot.Trigger(10, 0.5f);
  slot.Render(L, R, 256, p);

  assert(L[9] == 0.f);                            // nothing before the hit offset
  assert(L[10] == 0.5f && R[10] == 0.5f);         // velocity scales, mono goes to both sides
  assert(L[10 + 98] == 0.5f && L[10 + 99] == 0.f); // plays 99 frames (interp needs i0+1) then stops

  // Swap retires the old sample and stops its voices; CollectGarbage frees it.
  auto* pData2 = new SampleData(*pData);
  slot.SetSample(pData2);
  slot.SwapIfPending();
  slot.CollectGarbage();
  float L2[64] = {}, R2[64] = {};
  slot.Render(L2, R2, 64, p);
  assert(L2[0] == 0.f); // old voice was stopped

  // Release: sustain 50% of 100 frames, release over 10 samples.
  float L3[256] = {}, R3[256] = {};
  p.sustainFrac = 0.5; p.releaseSamples = 10.;
  slot.Trigger(0, 1.f);
  slot.Render(L3, R3, 256, p);
  assert(L3[49] == 1.f && L3[50] < 1.f && L3[60] == 0.f);

  puts("slot_engine_test: OK");
}
