// clang++ -std=c++17 -O2 -I.. slot_shape_test.cpp -o /tmp/slot_shape_test && /tmp/slot_shape_test
// Slot shape (DSP/SlotShape.h): look-ahead silence + OFFSET, polarity, envelope length,
// START / END, zero-phase EQ keeps timing, and the INPUT GATE (GATE mode).
// (Matched sample by sample against the prototype's renderSlotOffline in Chrome:
//  -116 dB / -96 dB max difference on two very different slots, see docs/TRASPASO.md.)
#include "DSP/SlotShape.h"
#include "DSP/InputGate.h"
#include <cassert>
#include <cstdio>

using namespace tu;

int main()
{
  const double sr = 48000.;
  SampleData src; src.numChannels = 1; src.sampleRate = sr;
  src.ch[0].assign((size_t) sr, 0.f); src.ch[0][0] = 1.f; // impulse at t = 0, 1 s long
  for (size_t i = 1; i < src.ch[0].size(); i++) src.ch[0][i] = 0.25f;
  src.numFrames = (int) src.ch[0].size();
  const size_t look = (size_t) std::lround(kLookMs / 1000. * sr);

  // untouched: whole sample after kLookMs of silence
  SlotShape none;
  auto* a = RenderShapedSample(src, none);
  printf("untouched: %d frames (pre %zu)\n", a->numFrames, look);
  assert(a->ch[0][look - 1] == 0.f && a->ch[0][look + 100] > 0.2f && a->numFrames >= (int) (look + sr * 0.99));

  // OFFSET -5 ms -> no pre silence; +10 ms -> 15 ms; polarity flips
  SlotShape sh; sh.valid = true; sh.env = {{0, 0}, {0.001, 1}, {500, 1}}; sh.offsetMs = -5;
  auto* b = RenderShapedSample(src, sh);
  sh.offsetMs = 10; sh.polarity = true;
  auto* c = RenderShapedSample(src, sh);
  const size_t pre10 = (size_t) std::lround(15. / 1000. * sr);
  printf("offset -5: first sound at %zu; +10 & Ø: at %zu, value %.2f\n",
         (size_t) 0, pre10, c->ch[0][pre10 + 1000]);
  assert(b->ch[0][100] > 0.2f && c->ch[0][pre10 - 1] == 0.f && c->ch[0][pre10 + 1000] < -0.2f);

  // envelope ends at 500 ms (+4 ms ramp): the buffer stops there, START / END trims
  printf("env 500 ms: %d frames (~%zu)\n", b->numFrames, (size_t) (0.506 * sr));
  assert(std::abs(b->numFrames - (int) (0.506 * sr)) < 200);
  SlotShape half = sh; half.polarity = false; half.offsetMs = 0; half.end = 0.25; half.env = {{0, 0}, {0.001, 1}, {1000, 1}};
  auto* d = RenderShapedSample(src, half);
  printf("END 0.25: %d frames (~%zu)\n", d->numFrames, look + (size_t) (0.25 * sr));
  assert(std::abs(d->numFrames - (int) (look + 0.25 * sr)) < 400);

  // zero-phase EQ: a click stays where it was
  SampleData imp = src; std::fill(imp.ch[0].begin(), imp.ch[0].end(), 0.f); imp.ch[0][24000] = 1.f;
  SlotShape eq; eq.valid = true; eq.cut = 40; eq.tone = 50; eq.env = {{0, 0}, {0.001, 1}, {1000, 1}};
  auto* e = RenderShapedSample(imp, eq);
  size_t argmax = 0; for (size_t i = 0; i < e->ch[0].size(); i++) if (std::fabs(e->ch[0][i]) > std::fabs(e->ch[0][argmax])) argmax = i;
  printf("zero-phase EQ: click at %zu (expected %zu)\n", argmax, look + 24000);
  assert(argmax == look + 24000);

  // INPUT GATE: opens on a burst, holds, releases
  InputGate g; g.Reset(sr); g.SetParams(-24., 0.5, 30., 150.);
  double open = 0, after = 0;
  for (int i = 0; i < 4800; i++) open = g.Process(0.5);             // 100 ms loud
  for (int i = 0; i < (int) (0.5 * sr); i++) after = g.Process(0.0); // 500 ms silence
  printf("gate: %.3f while loud, %.4f after 500 ms of silence\n", open, after);
  assert(open > 0.99 && after < 0.1);
  puts("slot_shape_test OK");
}
