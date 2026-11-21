#pragma once

#include "IPlug_include_in_plug_hdr.h"
#include "Smoothers.h"
#include "DSP/SlotEngine.h"
#include "DSP/TransientDetector.h"
#include "DSP/Dynamics.h"
#include <atomic>

using namespace iplug;

const int kNumPresets = 1;
const int kNumSlots = 8;
const int kStateVersion = 2; // v2: 8 slots (v1 had 16, not loadable)

#if DRUMREPLACER_PRO
constexpr bool kIsPro = true;
#else
constexpr bool kIsPro = false;
#endif

enum EParams
{
  // Detector
  kSensitivity = 0,
  kRetrigger,
  kDetail,
  kDetectorMode,
  kLowCut,
  kHighCut,
  kSuppression,
  // Gain
  kInputGain,
  kOutputGain,
  kMix,
  // Gate
  kGateEnabled,
  kGateAttack,
  kGateSustain,
  kGateRelease,
  // MIDI
  kMidiInEnabled,
  kMidiInNote,
  kMidiInChannel,
  kMidiOutEnabled,
  kMidiOutNote,
  kMidiOutChannel,
  // Links between slots
  kAttackLink,
  kSustainLink,
  kReleaseLink,
  kDynLink,
  kVeloLink,
  kTuneLink,
  kRangeTopLink,
  kRangeBottomLink,
  // Per-slot params start here: kSlotBase + slot * kNumSlotParams + ESlotParam
  kSlotBase
};

enum ESlotParam
{
  kSlotVol = 0,
  kSlotPan,
  kSlotTune,
  kSlotAttack,
  kSlotRelease,
  kSlotSustain,
  kSlotVeloCurve,
  kSlotDynCurve,
  kSlotRangeTop,
  kSlotRangeBottom,
  kSlotPhase,
  kSlotSolo,
  kSlotMute,
  kNumSlotParams
};

constexpr int kNumParams = kSlotBase + kNumSlots * kNumSlotParams;
constexpr int SlotParam(int slot, int p) { return kSlotBase + slot * kNumSlotParams + p; }

enum EMsgTags
{
  kMsgTagLoadSample = 4, // ctrlTag = slot index
  kMsgTagClearSlot = 5   // ctrlTag = slot index
};

class DrumReplacer final : public Plugin
{
public:
  DrumReplacer(const InstanceInfo& info);
  
#if IPLUG_DSP
  void ProcessBlock(sample** inputs, sample** outputs, int nFrames) override;
  void ProcessMidiMsg(const IMidiMsg& msg) override;
  void OnReset() override;
#endif
  bool OnMessage(int msgTag, int ctrlTag, int dataSize, const void* pData) override;
  void OnParamChange(int paramIdx) override;
  void OnIdle() override;
  void OnUIOpen() override;
  void OnUIClose() override { mUIOpen = false; }
  bool SerializeState(IByteChunk& chunk) const override;
  int UnserializeState(const IByteChunk& chunk, int startPos) override;

private:
  void InitParams();
  bool LoadSlot(int slot, const char* path); // non-audio thread

  void SendMidiOut(int offset, float velocity);
  void SendSlotToUI(int slot);

  // Hits waiting to fire. countdown = samples from the start of the next block.
  // Everything is scheduled kLatency samples late so it lines up with the delayed dry signal.
  static constexpr int kMaxHits = 64;
  struct Hit { int countdown; float velocity; };
  Hit mHits[kMaxHits];
  int mNumHits = 0;

  TransientDetector mDetector;
  HitGate mGate;
  Slot mSlots[kNumSlots];
  std::vector<float> mWet[2];      // sized in OnReset
  std::vector<sample> mDelay[2];   // dry delay = detector latency, sized in OnReset
  int mDelayPos = 0;
  LogParamSmooth<sample, 1> mInGainSmooth, mOutGainSmooth, mMixSmooth;

  // Audio thread -> UI: hit count and last velocity, read in OnIdle
  std::atomic<int> mHitCount{0};
  std::atomic<float> mLastHitVelocity{0.f};
  int mHitCountSent = 0;
  bool mUIOpen = false;

  int mNoteOffIn = -1; // samples until the pending MIDI out note-off, -1 = none
  int mOutNote = 0, mOutChannel = 0;

  // Non-parameter state, saved in the chunk
  WDL_String mSlotPaths[kNumSlots];
  bool mSlotOk[kNumSlots] = {}; // last LoadSlot result, for the UI
  WDL_String mBaseDir;
  WDL_String mPresetName;
};
