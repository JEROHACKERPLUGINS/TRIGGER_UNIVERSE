// clang++ -std=c++17 -O2 -I.. input_player_test.cpp -o /tmp/input_player_test && /tmp/input_player_test
// INPUT player (plays a file into the input), preview cache (LRU of decoded heads)
// and the per-hit gain (SENSITIVITY / slot VELOCITY, same formula as the prototype).
#include "DSP/InputPlayer.h"
#include "DSP/PreviewCache.h"
#include "DSP/Dynamics.h"
#include <cassert>
#include <cstdio>

int main()
{
  // --- INPUT player: plays the whole file once at the host rate, click-free, then stops
  {
    const double fileSR = 44100., hostSR = 48000.;
    auto* s = new SampleData; s->numChannels = 1; s->sampleRate = fileSR;
    s->ch[0].assign((size_t) fileSR, 0.5f); s->numFrames = (int) s->ch[0].size(); // 1 s of DC 0.5
    InputPlayer p;
    p.Start(s);
    std::vector<float> L(256), R(256);
    long frames = 0; float maxStep = 0, prev = 0, peak = 0;
    bool started = false;
    for (int b = 0; b < 400; b++)
    {
      std::fill(L.begin(), L.end(), 0.f); std::fill(R.begin(), R.end(), 0.f);
      p.Render(L.data(), R.data(), 256, hostSR);
      for (int i = 0; i < 256; i++)
      {
        if (L[i] != 0.f) { started = true; frames++; }
        maxStep = std::max(maxStep, std::fabs(L[i] - prev)); prev = L[i];
        peak = std::max(peak, L[i]);
        assert(L[i] == R[i]); // mono file -> both channels
      }
      p.CollectGarbage();
    }
    printf("input player: %.3f s played (1.000), peak %.2f, max step %.4f, playing after end: %d\n",
           frames / hostSR, peak, maxStep, (int) p.IsPlaying());
    assert(started && std::fabs(frames / hostSR - 1.) < 0.01 && peak > .49f && maxStep < 0.01f && !p.IsPlaying());

    // stop in the middle fades out within ~5 ms
    auto* s2 = new SampleData(*s);
    InputPlayer q; q.Start(s2);
    for (int b = 0; b < 20; b++) { std::fill(L.begin(), L.end(), 0.f); std::fill(R.begin(), R.end(), 0.f); q.Render(L.data(), R.data(), 256, hostSR); }
    q.Stop();
    int tail = 0;
    for (int b = 0; b < 4; b++)
    {
      std::fill(L.begin(), L.end(), 0.f); std::fill(R.begin(), R.end(), 0.f);
      q.Render(L.data(), R.data(), 256, hostSR);
      for (int i = 0; i < 256; i++) tail += L[i] != 0.f;
    }
    printf("stop: %d samples of fade (<= 241)\n", tail);
    assert(tail <= 241 && !q.IsPlaying());
  }

  // --- preview cache: hit after Put, LRU eviction above the budget, copy is independent
  {
    PreviewCache c;
    std::vector<std::vector<float>> ch(2, std::vector<float>(96000, 0.25f)); // 2 s stereo @48k
    c.Put("/a.wav", 100, ch, 48000.);
    SampleData* a = c.GetCopy("/a.wav", 100);
    assert(a && a->numFrames == 48000 && a->numChannels == 2); // only the first 1 s
    assert(!c.GetCopy("/a.wav", 101));                          // changed file = miss
    delete a;
    const size_t per = 48000 * 2 * sizeof(float);
    const int n = (int) (PreviewCache::kBudgetBytes / per) + 50;
    for (int i = 0; i < n; i++) c.Put("/f" + std::to_string(i) + ".wav", 1, ch, 48000.);
    printf("cache: %zu entries, %.0f MB (budget %.0f MB)\n", c.Count(), c.Bytes() / 1048576., PreviewCache::kBudgetBytes / 1048576.);
    assert(c.Bytes() <= PreviewCache::kBudgetBytes && !c.GetCopy("/a.wav", 100) && c.GetCopy("/f" + std::to_string(n - 1) + ".wav", 1));
  }

  // --- per-hit gain
  {
    // velocity amount 0 = every hit at the slot level
    assert(std::fabs(TriggerGain(0.1f, 51., 0.) - 1.f) < 1e-6);
    // sensitivity 100 spreads soft / hard more than 0
    const float r100 = TriggerGain(1.f, 100., 100.) / TriggerGain(.25f, 100., 100.);
    const float r0 = TriggerGain(1.f, 0., 100.) / TriggerGain(.25f, 0., 100.);
    printf("gain hard/soft: sens 100 x%.1f, sens 0 x%.1f\n", r100, r0);
    assert(r100 > r0 && r0 > 1.f && TriggerGain(2.f, 100., 100.) <= 2.2f);
  }
  puts("input_player_test OK");
}
