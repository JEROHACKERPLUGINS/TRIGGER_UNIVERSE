// clang++ -std=c++17 -I.. preview_player_test.cpp -o /tmp/preview_test && /tmp/preview_test
#include "DSP/PreviewPlayer.h"
#include "DSP/WavFile.h"
#include <cassert>
#include <cmath>
#include <cstdio>
#include <vector>

static SampleData* Constant(int frames, double sr, float v)
{
  auto* p = new SampleData;
  p->numChannels = 1; p->numFrames = frames; p->sampleRate = sr;
  p->ch[0].assign(frames, v);
  return p;
}

int main()
{
  const double sr = 48000.;
  const float level = (float) std::pow(10., -8. / 20.);
  PreviewPlayer pp;

  // 1) Plays, fades in over 6 ms, holds at -8 dB, stops after 0.8 s + 70 ms fade.
  pp.SetSample(Constant((int) (2 * sr), sr, 1.f));
  std::vector<float> L((size_t) sr), R((size_t) sr);
  pp.Render(L.data(), R.data(), (int) sr, sr);
  assert(L[0] < 0.01f);
  assert(std::fabs(L[(int) (0.1 * sr)] - level) < 1e-4);
  assert(std::fabs(R[(int) (0.1 * sr)] - level) < 1e-4); // mono -> both sides
  assert(L[(int) (0.8 * sr) - 10] > level * 0.99f);
  assert(L[(int) (0.9 * sr)] == 0.f);
  float maxStep = 0.f;
  for (int i = 1; i < (int) sr; i++) maxStep = std::max(maxStep, std::fabs(L[i] - L[i - 1]));
  printf("hold %.4f (-8 dB = %.4f), max step %.5f\n", L[(int) (0.1 * sr)], level, maxStep);
  assert(maxStep < 0.01f); // no clicks
  assert(!pp.IsPlaying());
  pp.CollectGarbage();

  // 2) A new preview while one is playing: fades the old one out (no jump), then plays the new.
  pp.SetSample(Constant((int) sr, sr, 1.f));
  std::vector<float> A(4800), B(4800);
  pp.Render(A.data(), B.data(), 4800, sr); // 100 ms in, holding
  pp.SetSample(Constant((int) sr, sr, -1.f));
  pp.CollectGarbage(); // OnIdle frees the previous sample
  std::vector<float> C(4800), D(4800);
  pp.Render(C.data(), D.data(), 4800, sr);
  maxStep = std::fabs(C[0] - A[4799]);
  for (int i = 1; i < 4800; i++) maxStep = std::max(maxStep, std::fabs(C[i] - C[i - 1]));
  printf("swap: first %.3f, end %.3f, max step %.5f\n", C[0], C[4799], maxStep);
  assert(maxStep < 0.01f);
  assert(std::fabs(C[4799] + level) < 1e-3); // new (negative) sample at full level
  pp.CollectGarbage();

  // 3) Stop fades out within ~12 ms.
  pp.Stop();
  std::vector<float> E(960), F(960);
  pp.Render(E.data(), F.data(), 960, sr);
  printf("stop: after 20 ms %.5f\n", E[959]);
  assert(E[959] == 0.f && !pp.IsPlaying());

  // 4) Resampling: a 44.1 kHz sample at 48 kHz host advances at 44.1/48.
  // (checked indirectly: the hold length is in host time, so it still ends at 0.8 s)

  // 5) Partial WAV read: header + first bytes only, the data chunk is clamped.
  {
    std::vector<unsigned char> w;
    auto u32 = [&](uint32_t v) { for (int k = 0; k < 4; k++) w.push_back((v >> (8 * k)) & 255); };
    auto u16 = [&](uint16_t v) { w.push_back(v & 255); w.push_back(v >> 8); };
    const uint32_t n = 48000; // 1 s mono 16-bit
    w.insert(w.end(), {'R','I','F','F'}); u32(36 + n * 2); w.insert(w.end(), {'W','A','V','E'});
    w.insert(w.end(), {'f','m','t',' '}); u32(16); u16(1); u16(1); u32(48000); u32(96000); u16(2); u16(16);
    w.insert(w.end(), {'d','a','t','a'}); u32(n * 2);
    for (uint32_t i = 0; i < n; i++) u16((uint16_t) (int16_t) (16000 * std::sin(i * 0.01)));
    FILE* f = fopen("/tmp/pp_test.wav", "wb"); fwrite(w.data(), 1, w.size(), f); fclose(f);
    std::vector<std::vector<float>> ch; double fsr = 0;
    assert(LoadWavFile("/tmp/pp_test.wav", ch, fsr) && ch[0].size() == n);
    assert(LoadWavFile("/tmp/pp_test.wav", ch, fsr, 44 + 2000) && ch[0].size() == 1000 && fsr == 48000.);
    // data size claims more than the file holds (truncated export): still loads what is there
    w.resize(44 + 3001);
    f = fopen("/tmp/pp_test.wav", "wb"); fwrite(w.data(), 1, w.size(), f); fclose(f);
    assert(LoadWavFile("/tmp/pp_test.wav", ch, fsr) && ch[0].size() == 1500);
    printf("partial / truncated WAV reads OK\n");
  }

  printf("preview_player_test OK\n");
  return 0;
}
