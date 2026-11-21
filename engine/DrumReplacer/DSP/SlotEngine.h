#pragma once

#include <atomic>
#include <cmath>
#include <vector>

// Decoded sample, owned by a Slot. Mono samples keep one channel.
struct SampleData
{
  std::vector<float> ch[2];
  int numChannels = 0;
  int numFrames = 0;
  double sampleRate = 44100.;
};

// Per-block values a slot hands to its voices.
struct VoiceParams
{
  float gainL = 1.f, gainR = 1.f;   // volume * pan * phase
  double ratio = 1.;                // sample SR / host SR * tune
  double attackSamples = 0.;        // host samples
  double sustainFrac = 1.;          // fraction of the sample played before release starts
  double releaseSamples = 0.;       // host samples
};

class SamplerVoice
{
public:
  bool IsActive() const { return mActive; }
  long Age() const { return mAge; }

  void Start(const SampleData* pSample, int offset, float velocity)
  {
    mSample = pSample;
    mOffset = offset;
    mVelocity = velocity;
    mPos = 0.;
    mAge = 0;
    mRelGain = 1.f;
    mActive = true;
  }

  void Stop() { mActive = false; }

  // Adds into outL/outR.
  void Render(float* outL, float* outR, int nFrames, const VoiceParams& p)
  {
    if (!mActive) return;
    const float* srcL = mSample->ch[0].data();
    const float* srcR = mSample->numChannels > 1 ? mSample->ch[1].data() : srcL;
    const int last = mSample->numFrames - 1;
    // ponytail: sustain = how much of the sample plays before the release fade. Guess at the
    // original's meaning; revisit when comparing against it in Fase 4.
    const double releaseStart = p.sustainFrac * mSample->numFrames;
    const float relStep = p.releaseSamples > 0. ? (float) (1. / p.releaseSamples) : 1.f;

    for (int i = mOffset; i < nFrames; i++)
    {
      if (mPos >= last || mRelGain <= 0.f) { mActive = false; break; }

      const int i0 = (int) mPos;
      const float frac = (float) (mPos - i0);
      const float l = srcL[i0] + (srcL[i0 + 1] - srcL[i0]) * frac;
      const float r = srcR[i0] + (srcR[i0 + 1] - srcR[i0]) * frac;

      float env = mVelocity;
      if (mAge < p.attackSamples) env *= (float) (mAge / p.attackSamples);
      if (p.sustainFrac < 1. && mPos >= releaseStart) mRelGain -= relStep;
      env *= mRelGain > 0.f ? mRelGain : 0.f;

      outL[i] += l * env * p.gainL;
      outR[i] += r * env * p.gainR;

      mPos += p.ratio;
      mAge++;
    }
    mOffset = 0;
  }

private:
  const SampleData* mSample = nullptr;
  double mPos = 0.;
  long mAge = 0;
  int mOffset = 0;
  float mVelocity = 0.f;
  float mRelGain = 1.f;
  bool mActive = false;
};

// One layer of the replacement: a sample plus its voices. Every hit fires every slot.
// Sample swap is lock-free: the UI thread posts to mPending, the audio thread takes it at
// block start and hands the old one back through mRetired for the UI thread to delete.
class Slot
{
public:
  static constexpr int kNumVoices = 8;

  ~Slot()
  {
    delete mPending.load();
    delete mRetired.load();
    delete mCurrent;
  }

  // --- UI / non-audio thread ---
  void SetSample(SampleData* pSample) { delete mPending.exchange(pSample); }
  void CollectGarbage() { delete mRetired.exchange(nullptr); }

  // --- audio thread ---
  void SwapIfPending()
  {
    if (mRetired.load() != nullptr) return; // previous one not collected yet, try next block
    SampleData* pNew = mPending.exchange(nullptr);
    if (!pNew) return;
    // ponytail: hard-stops voices of the old sample (click on load), fade-out if it bothers
    for (auto& v : mVoices) v.Stop();
    mRetired.store(mCurrent);
    mCurrent = pNew;
  }

  bool HasSample() const { return mCurrent && mCurrent->numFrames > 1; }
  double SampleRate() const { return mCurrent ? mCurrent->sampleRate : 44100.; }

  void Trigger(int offset, float velocity)
  {
    if (!HasSample()) return;
    // ponytail: steals the oldest voice with no fade
    SamplerVoice* pVoice = &mVoices[0];
    for (auto& v : mVoices)
    {
      if (!v.IsActive()) { pVoice = &v; break; }
      if (v.Age() > pVoice->Age()) pVoice = &v;
    }
    pVoice->Start(mCurrent, offset, velocity);
  }

  void Render(float* outL, float* outR, int nFrames, const VoiceParams& p)
  {
    if (!HasSample()) return;
    for (auto& v : mVoices) v.Render(outL, outR, nFrames, p);
  }

private:
  std::atomic<SampleData*> mPending{nullptr};
  std::atomic<SampleData*> mRetired{nullptr};
  SampleData* mCurrent = nullptr;
  SamplerVoice mVoices[kNumVoices];
};
