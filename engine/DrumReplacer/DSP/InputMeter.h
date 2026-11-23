#pragma once

#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstdint>
#include <vector>

// Live INPUT for the UI's TRIGGER view (the native app / AU have no Web Audio):
// the audio thread writes the input's peak every 1 ms (after INPUT gain, the
// level the detector sees) and every detected hit; the UI thread drains both in
// OnIdle and sends them to the WebView, which scrolls them like the prototype.
// Single producer (audio thread) / single consumer (UI thread), lock-free rings.
class InputMeter
{
public:
  static constexpr uint32_t kCap = 1u << 14;  // 16 s of 1 ms bins
  static constexpr uint32_t kHitCap = 256;

  struct HitMark { uint32_t bin; float velocity; };

  void Reset(double sampleRate)
  {
    mPerBin = std::max(1, (int) std::lround(sampleRate / 1000.));
    mCount = 0;
    mAcc = 0.f;
  }

  // --- audio thread ---
  template <typename T>
  void Push(const T* L, const T* R, int n, double gain)
  {
    uint32_t w = mWrite.load(std::memory_order_relaxed);
    for (int i = 0; i < n; i++)
    {
      const float v = (float) std::fabs((L[i] + R[i]) * 0.5 * gain);
      if (v > mAcc) mAcc = v;
      if (++mCount >= mPerBin)
      {
        mPeaks[w & (kCap - 1)] = mAcc;
        w++;
        mCount = 0;
        mAcc = 0.f;
      }
    }
    mWrite.store(w, std::memory_order_release);
  }

  // A hit whose onset was `samplesAgo` samples before the end of the last Push.
  void MarkHit(int samplesAgo, float velocity)
  {
    const uint32_t w = mWrite.load(std::memory_order_relaxed);
    const uint32_t back = (uint32_t) std::max(0, samplesAgo) / (uint32_t) mPerBin;
    const uint32_t hw = mHitWrite.load(std::memory_order_relaxed);
    mHits[hw & (kHitCap - 1)] = {w > back ? w - back : 0u, velocity};
    mHitWrite.store(hw + 1, std::memory_order_release);
  }

  // --- UI thread --- returns the absolute index of peaks[0]
  uint32_t Drain(std::vector<float>& peaks, std::vector<HitMark>& hits)
  {
    peaks.clear();
    hits.clear();
    const uint32_t w = mWrite.load(std::memory_order_acquire);
    uint32_t r = mRead;
    if (w - r > kCap) r = w - kCap; // UI was away: drop the oldest
    const uint32_t from = r;
    for (; r != w; r++) peaks.push_back(mPeaks[r & (kCap - 1)]);
    mRead = r;

    const uint32_t hw = mHitWrite.load(std::memory_order_acquire);
    uint32_t hr = mHitRead;
    if (hw - hr > kHitCap) hr = hw - kHitCap;
    for (; hr != hw; hr++) hits.push_back(mHits[hr & (kHitCap - 1)]);
    mHitRead = hr;
    return from;
  }

private:
  float mPeaks[kCap] = {};
  HitMark mHits[kHitCap] = {};
  std::atomic<uint32_t> mWrite{0}, mHitWrite{0};
  uint32_t mRead = 0, mHitRead = 0;  // UI thread only
  int mPerBin = 48, mCount = 0;      // audio thread only
  float mAcc = 0.f;
};
