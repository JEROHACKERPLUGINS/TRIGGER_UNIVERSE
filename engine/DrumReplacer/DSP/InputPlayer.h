#pragma once

#include "SlotEngine.h"
#include <atomic>
#include <cmath>

// INPUT player: plays a whole file INTO the plugin's input (as if it came from the
// interface / the DAW track), so the standalone app can be heard and tested
// without a drum on the input. Same role as the prototype's "▶ INPUT" with
// SN TOP 1. It is summed with the live input, goes through INPUT gain, the
// detector, the dry delay and MIX like any input.
// Plays once; 5 ms fades at start / stop. Thread model like PreviewPlayer:
// Start()/Stop() from the UI thread, Render() on the audio thread,
// CollectGarbage() on the UI thread (OnIdle). Lock-free.
class InputPlayer
{
public:
  static constexpr double kFadeSec = 0.005;

  ~InputPlayer()
  {
    delete mPending.load();
    delete mRetired.load();
    delete mCurrent;
  }

  // --- UI thread ---
  void Start(SampleData* pSample) { delete mPending.exchange(pSample); }
  void Stop() { mStopRequest.store(true); }
  void CollectGarbage() { delete mRetired.exchange(nullptr); }
  bool IsPlaying() const { return mPlaying.load(); }
  double PositionSec() const { return mPosSec.load(); }
  double DurationSec() const { return mDurSec.load(); }

  // --- audio thread --- adds into L/R
  void Render(float* L, float* R, int nFrames, double hostSR)
  {
    if (mStopRequest.exchange(false) && mState == kPlaying)
      Fade(hostSR, -1);

    if (mPending.load(std::memory_order_relaxed) != nullptr && mRetired.load() == nullptr)
    {
      SampleData* pNew = mPending.exchange(nullptr);
      mRetired.store(mCurrent);
      mCurrent = pNew;
      mPos = 0.;
      mGain = 0.;
      mState = (mCurrent && mCurrent->numFrames > 1) ? kPlaying : kIdle;
      mStep = 1. / std::max(1., kFadeSec * hostSR);
      if (mCurrent && mCurrent->sampleRate > 0)
      {
        mRatio = mCurrent->sampleRate / hostSR;
        mDurSec.store((mCurrent->numFrames - 1) / mCurrent->sampleRate);
      }
    }

    if (mState == kIdle || !mCurrent) { mPlaying.store(false); return; }

    const float* sL = mCurrent->ch[0].data();
    const float* sR = mCurrent->numChannels > 1 ? mCurrent->ch[1].data() : sL;
    const int last = mCurrent->numFrames - 1;
    for (int i = 0; i < nFrames; i++)
    {
      if (mState == kStopping)
      {
        mGain -= mStep;
        if (mGain <= 0.) { mState = kIdle; break; }
      }
      else if (mGain < 1.)
        mGain = std::min(1., mGain + mStep);

      const int i0 = (int) mPos;
      if (i0 >= last) { mState = kIdle; break; }
      if (mState == kPlaying && last - i0 < (int) (kFadeSec * mCurrent->sampleRate))
        Fade(hostSR, -1); // end of the file: fade out
      const float fr = (float) (mPos - i0);
      const float g = (float) mGain;
      L[i] += (sL[i0] + (sL[i0 + 1] - sL[i0]) * fr) * g;
      R[i] += (sR[i0] + (sR[i0 + 1] - sR[i0]) * fr) * g;
      mPos += mRatio;
    }
    mPosSec.store(mCurrent->sampleRate > 0 ? mPos / mCurrent->sampleRate : 0.);
    mPlaying.store(mState != kIdle);
  }

private:
  enum EState { kIdle, kPlaying, kStopping };

  void Fade(double hostSR, int /*dir*/)
  {
    mStep = std::max(1e-6, mGain) / std::max(1., kFadeSec * hostSR);
    mState = kStopping;
  }

  std::atomic<SampleData*> mPending{nullptr};
  std::atomic<SampleData*> mRetired{nullptr};
  std::atomic<bool> mStopRequest{false};
  std::atomic<bool> mPlaying{false};
  std::atomic<double> mPosSec{0.}, mDurSec{0.};
  SampleData* mCurrent = nullptr;

  EState mState = kIdle;
  double mPos = 0., mRatio = 1., mGain = 0., mStep = 0.;
};
