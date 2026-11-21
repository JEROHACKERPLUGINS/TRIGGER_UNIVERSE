#pragma once

#include <algorithm>
#include <cmath>

// Transient detector for drum replacement. Realtime-safe: no allocations.
//
// Pipeline per sample: mono sum * gain -> HP (low cut) -> LP (high cut) -> |x| ->
//   fast envelope (instant attack, 5 ms release) and slow envelope (50 ms average).
// A hit starts when fast > threshold (sensitivity), fast > slow * k (detail) and
// fast > the post-hit suppression threshold. The detector then captures the peak for
// kPeakWindowMs and reports the hit at the END of that window, with velocity from the
// peak. The plugin reports that window as latency and delays the dry signal by it, so
// the replacement lines up with the original onset.
class TransientDetector
{
public:
  static constexpr double kPeakWindowMs = 5.;

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
    mState = kArmed;
    mCounter = 0;
    mPeak = 0.;
  }

  int LatencySamples() const { return mWindow; }

  // Plugin units: percentages 0..100, ms, Hz.
  void SetParams(double sensitivityPct, double retriggerMs, double detailPct,
                 double lowCutHz, double highCutHz, double suppressionPct)
  {
    // 0% -> -6 dBFS, 100% -> -60 dBFS
    mThresh = DbToAmp(-6. - 0.54 * sensitivityPct);
    // Onset must jump k times above the running average. Sustained material sits around
    // fast/slow ~1.6, so k stays above that. 0% -> 6 (only clear hits), 100% -> 1.5 (ghost notes).
    mK = 6. - 0.045 * detailPct;
    mRetrigSamples = (int) (retriggerMs * 0.001 * mSR);
    mSuppr = suppressionPct * 0.01;
    if (lowCutHz != mLowCut) { mLowCut = lowCutHz; mHP.SetHighPass(lowCutHz, mSR); }
    if (highCutHz != mHighCut) { mHighCut = highCutHz; mLP.SetLowPass(highCutHz, mSR); }
  }

  // onHit(int offsetInBlock, float velocity01)
  template <typename T, typename F>
  void Process(const T* inL, const T* inR, int nFrames, double gain, F&& onHit)
  {
    for (int i = 0; i < nFrames; i++)
    {
      const double x = std::fabs(mLP.Process(mHP.Process((inL[i] + inR[i]) * 0.5 * gain)));
      mFast = x > mFast ? x : mFast * mFastRel;
      mSlow += (x - mSlow) * mSlowCoef;
      mSupprThresh *= mSupprDecay;
      const double thresh = std::max(mThresh, mSupprThresh);

      switch (mState)
      {
        case kArmed:
          if (mFast > thresh && mFast > mSlow * mK)
          {
            mState = kCapturing;
            mCounter = 0;
            mPeak = mFast;
          }
          break;
        case kCapturing:
          mPeak = std::max(mPeak, mFast);
          if (++mCounter >= mWindow)
          {
            onHit(i, PeakToVelocity(mPeak));
            mSupprThresh = mPeak * mSuppr;
            mState = kHolding;
          }
          break;
        case kHolding:
          // Re-arm after the retrigger time AND once the hit has decayed below half the
          // threshold, so a long kick tail can't fire twice.
          if (++mCounter >= mWindow + mRetrigSamples && mFast < thresh * 0.5)
            mState = kArmed;
          break;
      }
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
    // RBJ cookbook, Q = 0.707
    void Set(double f, double sr, bool highPass)
    {
      f = std::clamp(f, 10., sr * 0.45);
      const double w0 = 2. * M_PI * f / sr, c = std::cos(w0), alpha = std::sin(w0) / (2. * 0.7071);
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

  enum EState { kArmed, kCapturing, kHolding };

  static double DbToAmp(double db) { return std::pow(10., db / 20.); }

  // ponytail: fixed 40 dB range below 0 dBFS -> 0..1. Fase 4 velocity/dynamics curves shape it.
  static float PeakToVelocity(double peak)
  {
    const double db = 20. * std::log10(std::max(peak, 1e-9));
    return (float) std::clamp(1. + db / 40., 0.05, 1.);
  }

  double mSR = 44100.;
  int mWindow = 1;
  double mFastRel = 0., mSlowCoef = 0., mSupprDecay = 0.;
  double mThresh = 0.1, mK = 3., mSuppr = 0.;
  int mRetrigSamples = 0;
  double mLowCut = -1., mHighCut = -1.;
  Biquad mHP, mLP;

  double mFast = 0., mSlow = 0., mSupprThresh = 0., mPeak = 0.;
  EState mState = kArmed;
  int mCounter = 0;
};
