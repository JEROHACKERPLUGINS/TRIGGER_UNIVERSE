#pragma once

#include <algorithm>
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
    mChokeAt = -1;
    mPrev = nullptr;
    mXfadeLeft = 0;
    mSample = pSample;
    mOffset = offset;
    mVelocity = velocity;
    mPos = 0.;
    mAge = 0;
    mRelGain = 1.f;
    mActive = true;
  }

  void Stop() { mActive = false; mPrev = nullptr; mXfadeLeft = 0; }

  // Real-time edit: keep playing from the same position, now on the new buffer,
  // crossfading from the old one over `samples` (no click, no restart).
  void Retarget(const SampleData* pNew, int samples)
  {
    if (!mActive || !pNew || pNew->numFrames < 2) { Stop(); return; }
    mPrev = mSample;
    mSample = pNew;
    mXfadeLen = mXfadeLeft = std::max(1, samples);
  }
  bool Crossfading() const { return mActive && mXfadeLeft > 0; }
  bool Choking() const { return mChokeAt >= 0; }

  // ONE SHOT with choke: a new hit on the same slot fades this one out over
  // `samples`, starting at `offset` in the current block (no click, no overlap).
  void Choke(int offset, int samples)
  {
    if (!mActive || mChokeAt >= 0) return;
    mChokeAt = std::max(0, offset);
    mChokeLen = mChokeLeft = std::max(1, samples);
  }

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
      const bool xf = mXfadeLeft > 0 && mPrev != nullptr;
      if ((mPos >= last && !xf) || mRelGain <= 0.f) { mActive = false; mPrev = nullptr; mXfadeLeft = 0; break; }

      const int i0 = (int) mPos;
      const float frac = (float) (mPos - i0);
      float l = 0.f, r = 0.f;
      if (mPos < last)
      {
        l = srcL[i0] + (srcL[i0 + 1] - srcL[i0]) * frac;
        r = srcR[i0] + (srcR[i0 + 1] - srcR[i0]) * frac;
      }
      if (xf)
      {
        // old buffer fades out while the new one fades in
        const float a = (float) mXfadeLeft / (float) mXfadeLen;
        float ol = 0.f, orr = 0.f;
        const int plast = mPrev->numFrames - 1;
        if (mPos < plast)
        {
          const float* pL = mPrev->ch[0].data();
          const float* pR = mPrev->numChannels > 1 ? mPrev->ch[1].data() : pL;
          ol = pL[i0] + (pL[i0 + 1] - pL[i0]) * frac;
          orr = pR[i0] + (pR[i0 + 1] - pR[i0]) * frac;
        }
        l = l * (1.f - a) + ol * a;
        r = r * (1.f - a) + orr * a;
        if (--mXfadeLeft <= 0) mPrev = nullptr;
      }

      float env = mVelocity;
      if (mAge < p.attackSamples) env *= (float) (mAge / p.attackSamples);
      if (p.sustainFrac < 1. && mPos >= releaseStart) mRelGain -= relStep;
      env *= mRelGain > 0.f ? mRelGain : 0.f;

      if (mChokeAt >= 0 && i >= mChokeAt)
      {
        env *= (float) mChokeLeft / (float) mChokeLen;
        if (--mChokeLeft <= 0) { mActive = false; mPrev = nullptr; mXfadeLeft = 0; mChokeAt = -1; break; }
      }

      outL[i] += l * env * p.gainL;
      outR[i] += r * env * p.gainR;

      mPos += p.ratio;
      mAge++;
    }
    mOffset = 0;
    if (mChokeAt > 0) mChokeAt = 0; // the fade goes on from the start of the next block
  }

private:
  const SampleData* mSample = nullptr;
  const SampleData* mPrev = nullptr; // crossfading from this one (real-time edit)
  int mXfadeLeft = 0, mXfadeLen = 1;
  int mChokeAt = -1, mChokeLeft = 0, mChokeLen = 1;
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
  // continuePlaying: the voices that are sounding move to the new buffer
  // (crossfade) instead of stopping: an edit of the envelope / tone / phase is
  // heard right away on the hit that is ringing. A new file stops them.
  void SetSample(SampleData* pSample, bool continuePlaying = false)
  {
    mPendingContinue.store(continuePlaying);
    delete mPending.exchange(pSample);
  }
  void CollectGarbage()
  {
    if (mCrossfading.load()) return; // voices still read the old buffer
    delete mRetired.exchange(nullptr);
  }

  // --- audio thread ---
  void SwapIfPending()
  {
    if (mRetired.load() != nullptr) return; // previous one not collected yet, try next block
    if (mCrossfading.load()) return;
    SampleData* pNew = mPending.exchange(nullptr);
    if (!pNew) return;
    const bool cont = mPendingContinue.load() && pNew->numFrames > 1;
    bool any = false;
    for (auto& v : mVoices)
    {
      if (cont && v.IsActive()) { v.Retarget(pNew, kXfadeSamples); any = true; }
      else v.Stop(); // ponytail: a new file hard-stops the old voices
    }
    mCrossfading.store(any);
    mRetired.store(mCurrent);
    mCurrent = pNew;
  }

  bool HasSample() const { return mCurrent && mCurrent->numFrames > 1; }
  double SampleRate() const { return mCurrent ? mCurrent->sampleRate : 44100.; }

  // ONE SHOT with choke (like Trigger 2): the new hit cuts the one that is still
  // ringing on this slot (5 ms fade from the new hit's position), so hits never pile up.
  void Trigger(int offset, float velocity)
  {
    if (!HasSample()) return;
    for (auto& v : mVoices)
      if (v.IsActive()) v.Choke(offset, kChokeSamples);
    SamplerVoice* pVoice = nullptr;
    for (auto& v : mVoices)
      if (!v.IsActive()) { pVoice = &v; break; }
    if (!pVoice) // every voice still fading: take the oldest
    {
      pVoice = &mVoices[0];
      for (auto& v : mVoices) if (v.Age() > pVoice->Age()) pVoice = &v;
    }
    pVoice->Start(mCurrent, offset, velocity);
  }

  void Render(float* outL, float* outR, int nFrames, const VoiceParams& p)
  {
    if (!HasSample()) return;
    bool xf = false;
    for (auto& v : mVoices) { v.Render(outL, outR, nFrames, p); xf |= v.Crossfading(); }
    if (!xf && mCrossfading.load(std::memory_order_relaxed)) mCrossfading.store(false);
  }

private:
  static constexpr int kXfadeSamples = 256; // ~5 ms
  static constexpr int kChokeSamples = 240; // 5 ms @ 48 kHz
  std::atomic<SampleData*> mPending{nullptr};
  std::atomic<SampleData*> mRetired{nullptr};
  std::atomic<bool> mPendingContinue{false};
  std::atomic<bool> mCrossfading{false};
  SampleData* mCurrent = nullptr;
  SamplerVoice mVoices[kNumVoices];
};
