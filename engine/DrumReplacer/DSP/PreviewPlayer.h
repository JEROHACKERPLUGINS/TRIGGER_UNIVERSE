#pragma once

#include "SlotEngine.h"
#include <atomic>
#include <cmath>

// Sample preview (hover / click in the library) played by the plugin itself:
// in the AU the WebView has no Web Audio, so the UI asks the engine to play it.
// Same feel as the prototype's hover preview: -8 dB, up to 0.8 s, 6 ms fade in,
// 70 ms fade out. A new preview fades the current one out first (no click).
// Thread model: SetSample()/Stop() from the UI thread, Render() on the audio
// thread, CollectGarbage() on the UI thread (OnIdle). Lock-free.
class PreviewPlayer
{
public:
  static constexpr double kLevelDb = -8.;
  static constexpr double kMaxSec = 0.8;
  static constexpr double kFadeInSec = 0.006;
  static constexpr double kFadeOutSec = 0.07;
  static constexpr double kSwapFadeSec = 0.012;

  ~PreviewPlayer()
  {
    delete mPending.load();
    delete mRetired.load();
    delete mCurrent;
  }

  // --- UI thread ---
  void SetSample(SampleData* pSample) { delete mPending.exchange(pSample); }
  void Stop() { mStopRequest.store(true); }
  void CollectGarbage() { delete mRetired.exchange(nullptr); }

  // --- audio thread --- adds into outL/outR
  void Render(float* outL, float* outR, int nFrames, double hostSR)
  {
    const float level = (float) std::pow(10., kLevelDb / 20.);
    for (int i = 0; i < nFrames; i++)
    {
      if (mStopRequest.exchange(false) && mState != kIdle && mState != kFadingOut)
        StartFadeOut(hostSR, kSwapFadeSec);

      if (mPending.load(std::memory_order_relaxed) != nullptr)
      {
        if (mState == kIdle) { if (!TakePending(hostSR)) { /* retired slot busy */ } }
        else if (mState != kFadingOut) StartFadeOut(hostSR, kSwapFadeSec);
      }

      if (mState == kIdle || !mCurrent) continue;

      // envelope
      switch (mState)
      {
        case kFadingIn:
          mGain += mStep;
          if (mGain >= 1.) { mGain = 1.; mState = kHolding; }
          break;
        case kHolding:
          if (mAge >= mHoldEnd) StartFadeOut(hostSR, kFadeOutSec);
          break;
        case kFadingOut:
          mGain -= mStep;
          if (mGain <= 0.) { mGain = 0.; mState = kIdle; continue; }
          break;
        default: break;
      }

      const int last = mCurrent->numFrames - 1;
      if (mPos >= last) { mState = kIdle; continue; }
      const float* L = mCurrent->ch[0].data();
      const float* R = mCurrent->numChannels > 1 ? mCurrent->ch[1].data() : L;
      const int i0 = (int) mPos;
      const float fr = (float) (mPos - i0);
      const float g = (float) mGain * level;
      outL[i] += (L[i0] + (L[i0 + 1] - L[i0]) * fr) * g;
      outR[i] += (R[i0] + (R[i0 + 1] - R[i0]) * fr) * g;
      mPos += mRatio;
      mAge++;
    }
  }

  bool IsPlaying() const { return mState != kIdle; }

private:
  enum EState { kIdle, kFadingIn, kHolding, kFadingOut };

  bool TakePending(double hostSR)
  {
    if (mRetired.load() != nullptr) return false; // UI thread hasn't collected the last one yet
    SampleData* pNew = mPending.exchange(nullptr);
    if (!pNew) return false;
    mRetired.store(mCurrent);
    mCurrent = pNew;
    if (!mCurrent || mCurrent->numFrames < 2) { mState = kIdle; return true; }
    mRatio = mCurrent->sampleRate / hostSR;
    mPos = 0.;
    mAge = 0;
    const double durSec = std::min(kMaxSec, (mCurrent->numFrames - 1) / mCurrent->sampleRate);
    mHoldEnd = (long) std::max(1., durSec * hostSR);
    mGain = 0.;
    mStep = 1. / std::max(1., kFadeInSec * hostSR);
    mState = kFadingIn;
    return true;
  }

  void StartFadeOut(double hostSR, double sec)
  {
    mStep = std::max(1e-6, mGain) / std::max(1., sec * hostSR);
    mState = kFadingOut;
  }

  std::atomic<SampleData*> mPending{nullptr};
  std::atomic<SampleData*> mRetired{nullptr};
  std::atomic<bool> mStopRequest{false};
  SampleData* mCurrent = nullptr;

  EState mState = kIdle;
  double mPos = 0., mRatio = 1., mGain = 0., mStep = 0.;
  long mAge = 0, mHoldEnd = 0;
};
