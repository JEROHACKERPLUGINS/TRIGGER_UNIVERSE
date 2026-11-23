#pragma once

#include <algorithm>
#include <cmath>
#include <vector>

// INPUT GATE envelope (prototype/detector-worklet.js, "GATE" section): an 8 ms
// peak detector on the input with 4 dB of hysteresis, HOLD, ATTACK / RELEASE
// smoothing. Used by the GATE trigger mode: a GATE slot's sample is multiplied
// by this envelope, so it lasts as long as the hit does at the input.
// Process() writes the gain of each input sample; the plugin delays it so it
// lines up with the (delayed) dry signal and the voices.
class InputGate
{
public:
  void Reset(double sr) { mSR = sr; mDet = 0.; mGain = 0.; mHoldLeft = 0; mLatch = false; Apply(); }

  void SetParams(double thresholdDb, double attackMs, double holdMs, double releaseMs)
  {
    if (thresholdDb == mThDb && attackMs == mAtkMs && holdMs == mHoldMs && releaseMs == mRelMs) return;
    mThDb = thresholdDb; mAtkMs = attackMs; mHoldMs = holdMs; mRelMs = releaseMs;
    Apply();
  }

  // level = |input| after INPUT gain (mono). Returns the gate gain 0..1.
  double Process(double level)
  {
    mDet = std::max(level, mDet * mDetDecay);
    const bool open = mDet >= (mLatch ? mCloseThr : mThr);
    if (open) { mLatch = true; mHoldLeft = mHoldSamples; }
    else mLatch = false;
    const double target = (mLatch || mHoldLeft > 0) ? 1. : 0.;
    if (!mLatch && mHoldLeft > 0) mHoldLeft--;
    if (target > mGain) mGain += (1. - mGain) * mAtkCoef;
    else mGain += (0. - mGain) * mRelCoef;
    return mGain;
  }

private:
  void Apply()
  {
    const double sr = mSR;
    mThr = std::pow(10., mThDb / 20.);
    mCloseThr = mThr * std::pow(10., -4. / 20.);
    mDetDecay = std::exp(-1. / (0.008 * sr));
    const double atk = std::max(0., mAtkMs / 1000.);
    mAtkCoef = atk > 0. ? 1. - std::exp(-1. / (atk * sr)) : 1.;
    mRelCoef = 1. - std::exp(-1. / (std::max(0.005, mRelMs / 1000.) * sr));
    mHoldSamples = std::max(0, (int) std::lround(mHoldMs / 1000. * sr));
  }

  double mSR = 48000.;
  double mThDb = -24., mAtkMs = 0.5, mHoldMs = 30., mRelMs = 150.;
  double mThr = 0.063, mCloseThr = 0.04, mDetDecay = 0.997, mAtkCoef = 1., mRelCoef = 0.001;
  int mHoldSamples = 0;
  double mDet = 0., mGain = 0.;
  int mHoldLeft = 0;
  bool mLatch = false;
};
