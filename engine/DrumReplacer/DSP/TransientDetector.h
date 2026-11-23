#pragma once

#include <algorithm>
#include <cmath>

// Transient detector for drum replacement. Realtime-safe: no allocations.
// Same behaviour as the prototype's detector (prototype/detector-worklet.js):
//
//   mono sum * input gain -> HP (low cut) -> LP (high cut) -> |x| (clipped at 1)
//   fast envelope (instant attack, 5 ms release), slow envelope (50 ms average)
//
//   DETAIL      threshold on the fast envelope, relative to full scale:
//               0..100 % -> 0..1.5 (14 % = 0.21 = -13.5 dBFS). Higher = fewer hits.
//   SUPPRESSION after a hit the threshold is lifted to peak * suppression and
//               decays over 50 ms (cuts flams / bleed right after a hit).
//   RETRIGGER   blind time after each hit. Once it has passed the detector fires
//               again as soon as the envelope is above the threshold; a fresh hit
//               after the signal dipped below half the threshold also needs the
//               transient test (fast > slow * 2.5).
//
// A hit starts when the envelope crosses the threshold; the detector captures the
// peak for kPeakWindowMs and reports the hit at the END of that window. The plugin
// reports that window as latency and delays the dry signal by it, so the
// replacement lines up with the original onset.
//
// Velocity = the hit's peak level (0..2, full scale = 1, after input gain): the
// plugin shapes it with SENSITIVITY (dynamic range) and the slot's velocity amount,
// see TriggerGain() in Dynamics.h. SENSITIVITY does not move the threshold.
class TransientDetector
{
public:
  static constexpr double kPeakWindowMs = 5.;
  static constexpr double kDetailMax = 1.5;
  static constexpr double kTransientRatio = 2.5;

  void Reset(double sampleRate)
  {
    mSR = sampleRate;
    mWindow = std::max(1, (int) std::lround(kPeakWindowMs * 0.001 * sampleRate));
    mFastRel = std::exp(-1. / (0.005 * sampleRate));
    mSlowCoef = 1. - std::exp(-1. / (0.050 * sampleRate));
    mSupprDecay = std::exp(-1. / (0.050 * sampleRate));
    mHP.Clear(); mLP.Clear();
    mLowCut = mHighCut = -1.; // force coefficient update
    mFast = mSlow = mSupprThresh = 0.;
    mCapturing = false;
    mArmed = true;
    mDipped = true;
    mHold = mCounter = 0;
    mPeak = mVelPeak = 0.;
  }

  int LatencySamples() const { return mWindow; }

  // Plugin units: percentages 0..100, ms, Hz. sensitivityPct is accepted for API
  // compatibility; it only shapes the velocity (in the plugin).
  void SetParams(double /*sensitivityPct*/, double retriggerMs, double detailPct,
                 double lowCutHz, double highCutHz, double suppressionPct)
  {
    mThresh = std::clamp(detailPct, 0., 100.) / 100. * kDetailMax;
    mRearm = std::max(0.01, mThresh * 0.5);
    mRetrigSamples = std::max(0, (int) std::lround(retriggerMs * 0.001 * mSR));
    mSuppr = std::clamp(suppressionPct, 0., 100.) * 0.01;
    // Like the prototype: 20 Hz / 20 kHz mean "off".
    if (lowCutHz != mLowCut) { mLowCut = lowCutHz; mUseHP = lowCutHz > 20.; if (mUseHP) mHP.SetHighPass(lowCutHz, mSR); }
    if (highCutHz != mHighCut) { mHighCut = highCutHz; mUseLP = highCutHz < 20000.; if (mUseLP) mLP.SetLowPass(highCutHz, mSR); }
  }

  // onHit(int offsetInBlock, float velocity0to2)
  template <typename T, typename F>
  void Process(const T* inL, const T* inR, int nFrames, double gain, F&& onHit)
  {
    for (int i = 0; i < nFrames; i++)
    {
      double f = (inL[i] + inR[i]) * 0.5 * gain;
      if (mUseHP) f = mHP.Process(f);
      if (mUseLP) f = mLP.Process(f);
      const double level = std::fabs(f);
      const double velLevel = std::min(2., level);
      const double d = std::min(1., level);
      mFast = d > mFast ? d : mFast * mFastRel;
      mSlow += (d - mSlow) * mSlowCoef;
      mSupprThresh *= mSupprDecay;
      const double thresh = std::max(mThresh, mSupprThresh);

      if (!mCapturing && mArmed && mFast > thresh && (!mDipped || mFast > mSlow * kTransientRatio))
      {
        mCapturing = true;
        mPeak = 0.; mVelPeak = 0.;
        mCounter = 0;
      }
      if (mCapturing)
      {
        mPeak = std::max(mPeak, mFast);
        mVelPeak = std::max(mVelPeak, velLevel);
        if (++mCounter >= mWindow)
        {
          onHit(i, (float) mVelPeak);
          mCapturing = false;
          mArmed = false;
          mDipped = false;
          mSupprThresh = mPeak * mSuppr;
          mHold = mWindow + mRetrigSamples;
        }
      }
      // RETRIGGER: blind time only
      if (!mArmed)
      {
        if (mHold > 0) mHold--;
        if (mHold <= 0) mArmed = true;
      }
      if (mArmed && mFast < mRearm) mDipped = true;
    }
  }

private:
  struct Biquad
  {
    double b0 = 1., b1 = 0., b2 = 0., a1 = 0., a2 = 0., z1 = 0., z2 = 0.;
    void Clear() { z1 = z2 = 0.; }
    double Process(double x)
    {
      const double y = b0 * x + z1;
      z1 = b1 * x - a1 * y + z2;
      z2 = b2 * x - a2 * y;
      return y;
    }
    // RBJ cookbook, Q = 0.707 (coefficients change, state is kept: no click)
    void Set(double f, double sr, bool highPass)
    {
      f = std::clamp(f, 10., sr * 0.49);
      const double w0 = 2. * M_PI * f / sr, c = std::cos(w0), alpha = std::sin(w0) / (2. * 0.70710678);
      const double a0 = 1. + alpha;
      b0 = (highPass ? (1. + c) : (1. - c)) / 2. / a0;
      b1 = (highPass ? -(1. + c) : (1. - c)) / a0;
      b2 = b0;
      a1 = -2. * c / a0;
      a2 = (1. - alpha) / a0;
    }
    void SetHighPass(double f, double sr) { Set(f, sr, true); }
    void SetLowPass(double f, double sr) { Set(f, sr, false); }
  };

  double mSR = 44100.;
  int mWindow = 1;
  double mFastRel = 0., mSlowCoef = 0., mSupprDecay = 0.;
  double mThresh = 0.21, mRearm = 0.105, mSuppr = 0.;
  int mRetrigSamples = 0;
  double mLowCut = -1., mHighCut = -1.;
  bool mUseHP = false, mUseLP = false;
  Biquad mHP, mLP;

  double mFast = 0., mSlow = 0., mSupprThresh = 0., mPeak = 0., mVelPeak = 0.;
  bool mCapturing = false, mArmed = true, mDipped = true;
  int mHold = 0, mCounter = 0;
};
