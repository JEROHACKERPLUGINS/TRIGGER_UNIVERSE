// clang++ -std=c++17 -O2 -I.. input_meter_test.cpp -o /tmp/input_meter_test && /tmp/input_meter_test
// Live input meter: 1 ms peaks, hit marks at the onset, ring overflow.
#include "DSP/InputMeter.h"
#include <cassert>
#include <cstdio>

int main()
{
  InputMeter m; m.Reset(48000.);
  std::vector<double> L(48000, 0.), R(48000, 0.);
  L[24000] = R[24000] = 0.5;                       // one sample at 500 ms
  for (int b = 0; b < 48000; b += 32) m.Push(&L[b], &R[b], 32, 2.0); // 32-sample device blocks
  m.MarkHit(48000 - 24000, 0.7f);                  // onset 24000 samples before the end
  std::vector<float> pk; std::vector<InputMeter::HitMark> hits;
  const uint32_t from = m.Drain(pk, hits);
  printf("bins %zu from %u, peak at 500 = %.2f, hit bin %u vel %.1f\n", pk.size(), from, pk[500], hits[0].bin, hits[0].velocity);
  assert(from == 0 && pk.size() == 1000 && std::fabs(pk[500] - 1.0f) < 1e-6 && pk[499] == 0.f && pk[501] == 0.f);
  assert(hits.size() == 1 && hits[0].bin == 500);
  // nothing new -> empty drain; overflow keeps the newest kCap bins
  assert(m.Drain(pk, hits) == 1000 && pk.empty() && hits.empty());
  std::vector<double> big(48 * (InputMeter::kCap + 100), 0.1);
  m.Push(big.data(), big.data(), (int) big.size(), 1.0);
  const uint32_t f2 = m.Drain(pk, hits);
  printf("overflow: kept %zu bins from %u\n", pk.size(), f2);
  assert(pk.size() == InputMeter::kCap && f2 == 1000 + 100);
  puts("input_meter_test OK");
}
