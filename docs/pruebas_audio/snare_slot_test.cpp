#include "DSP/SlotEngine.h"
#include "DSP/WavFile.h"
#include <cstdio>
#include <cmath>
#include <vector>
#include <memory>
#include <algorithm>

static std::vector<std::vector<float>> gCh; static double gSr = 0.;

static std::unique_ptr<Slot> makeSlot()
{
  auto* p = new SampleData;
  p->numChannels = (int)gCh.size();
  p->numFrames = (int)gCh[0].size();
  p->sampleRate = gSr;
  p->ch[0] = gCh[0];
  if (gCh.size() > 1) p->ch[1] = gCh[1];
  auto s = std::make_unique<Slot>();
  s->SetSample(p);
  s->SwapIfPending();
  return s;
}

int main()
{
  if (!LoadWavFile("/Users/dante/Desktop/SNARE.cm.wav", gCh, gSr)) { printf("load fail\n"); return 1; }
  const int sr = (int)gSr;

  // exact playback
  {
    auto slot = makeSlot();
    std::vector<float> L(48000, 0.f), R(48000, 0.f);
    VoiceParams vp; slot->Trigger(0, 1.f);
    for (int b = 0; b < 48000; b += 256) slot->Render(&L[b], &R[b], std::min(256, 48000 - b), vp);
    double err = 0., peak = 0.;
    for (int i = 0; i < 48000; i++) { err = std::max(err, (double)std::fabs(L[i] - gCh[0][i])); peak = std::max(peak, (double)std::fabs(L[i])); }
    printf("exact: err %.3e peak %.3f\n", err, peak);
  }

  // offset + velocity
  {
    auto slot = makeSlot();
    std::vector<float> L(256, 0.f), R(256, 0.f);
    VoiceParams vp; slot->Trigger(100, 0.5f); slot->Render(L.data(), R.data(), 256, vp);
    double pre = 0., err = 0.;
    for (int i = 0; i < 100; i++) pre = std::max(pre, (double)std::fabs(L[i]));
    for (int i = 0; i < 100; i++) err = std::max(err, (double)std::fabs(L[100 + i] - 0.5f * gCh[0][i]));
    printf("offset/vel: pre %.3e err %.3e\n", pre, err);
  }

  // tune +12
  {
    auto slot = makeSlot();
    std::vector<float> L(512, 0.f), R(512, 0.f);
    VoiceParams vp; vp.ratio = 2.0; slot->Trigger(0, 1.f); slot->Render(L.data(), R.data(), 512, vp);
    double err = 0.;
    for (int i = 0; i < 200; i++) err = std::max(err, (double)std::fabs(L[i] - gCh[0][2 * i]));
    printf("tune +12: err %.3e\n", err);
  }

  // release fade
  {
    auto slot = makeSlot();
    std::vector<float> L(15000, 0.f), R(15000, 0.f);
    VoiceParams vp; vp.sustainFrac = 0.02; vp.releaseSamples = 480.;
    slot->Trigger(0, 1.f);
    for (int b = 0; b < 15000; b += 256) slot->Render(&L[b], &R[b], std::min(256, 15000 - b), vp);
    auto ampAt = [&](double t) { int i = (int)(t * sr); double m = 0; for (int k = 0; k < 200 && i + k < 15000; k++) m = std::max(m, (double)std::fabs(L[i + k])); return m; };
    printf("release: 0.155s %.4f, 0.175s %.4f, 0.25s %.4f\n", ampAt(0.155), ampAt(0.175), ampAt(0.25));
  }

  // voice stealing
  {
    auto slot = makeSlot();
    std::vector<float> L(1024, 0.f), R(1024, 0.f);
    VoiceParams vp; for (int i = 0; i < 9; i++) slot->Trigger(0, 1.f);
    slot->Render(L.data(), R.data(), 1024, vp);
    double peak = 0.; for (float v : L) peak = std::max(peak, (double)std::fabs(v));
    printf("voice stealing: peak %.3f\n", peak);
  }
  puts("snare_slot_test2: OK");
  return 0;
}
