#pragma once

#include "IPlug_include_in_plug_hdr.h"
#include "Smoothers.h"
#include "DSP/SlotEngine.h"
#include "DSP/TransientDetector.h"
#include "DSP/Dynamics.h"
#include "DSP/PreviewPlayer.h"
#include "DSP/PreviewCache.h"
#include "DSP/InputPlayer.h"
#include "DSP/InputMeter.h"
#include "DSP/SampleMap.h"
#include "DSP/SampleClassifier.h"
#include <atomic>
#include <vector>
#include <string>
#include <thread>
#include <mutex>

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
  kMsgTagClearSlot = 5,  // ctrlTag = slot index
  kMsgTagChooseFolder = 6,
  kMsgTagLoadPath = 7,   // ctrlTag = slot index, data = path
  kMsgTagRemoveRoot = 8, // ctrlTag = root index
  kMsgTagRescanLibrary = 9,
  kMsgTagGetLibrary = 10,
  kMsgTagPreviewPath = 11, // data = path: play the start of that file (library hover/click, slot audition)
  kMsgTagPreviewStop = 12,
  kMsgTagRebuildMap = 13, // rebuild the whole map (aligned to the current one)
  kMsgTagInputPlay = 14,  // data = path (empty = the bundled demo input): play it INTO the input
  kMsgTagInputStop = 15,
  kMsgTagAudioGet = 16,   // standalone app: list devices + current audio state
  kMsgTagAudioSet = 17,   // data = JSON {in, out, sr, buffer}
  kMsgTagAudioTest = 18,  // play a test tone on the output
  kMsgTagMidiIn = 19      // data = MIDI input port name ("off" = none)
};

class DrumReplacer final : public Plugin
{
public:
  DrumReplacer(const InstanceInfo& info);
  ~DrumReplacer() override;
  
#if IPLUG_DSP
  void ProcessBlock(sample** inputs, sample** outputs, int nFrames) override;
  void ProcessMidiMsg(const IMidiMsg& msg) override;
  void OnReset() override;
#endif
  bool OnMessage(int msgTag, int ctrlTag, int dataSize, const void* pData) override;
  void OnWebMessage(const char* jsonStr);
  void OnParamChange(int paramIdx) override;
  void OnIdle() override;
  void OnUIOpen() override;
  void OnUIClose() override;
  bool SerializeState(IByteChunk& chunk) const override;
  int UnserializeState(const IByteChunk& chunk, int startPos) override;

private:
  void InitParams();
  bool LoadSlot(int slot, const char* path); // non-audio thread
  void LoadLibrarySettings();
  void SaveLibrarySettings() const;
  void ScanLibraryAndSend();
  void SendLibraryToUI();
  void StartLibraryAnalysis();
  struct LibraryFile;
  static bool NeedsAnalysis(const LibraryFile& f);
  void StopLibraryAnalysis();

  struct LibraryFile
  {
    int root = 0;
    std::string path;
    std::string name;
    std::string rel;
    long long size = 0;
    double durMs = 0;
    int sampleRate = 0;
    int channels = 0;
    double centroidHz = 0;
    double rolloffHz = 0;
    double flatness = 0;
    double attackMs = 0;
    double decayMs = 0;
    double crest = 0;
    double zcr = 0;
    double rms = 0;
    double peak = 0;
    double lufs = -70, druminess = 0, lateTransient = 0;
    float emb[4] = {0.f, 0.f, 0.f, 0.f}; // 4-D timbre embedding (similar-sounds list)
    int featureVersion = 0;
    bool analyzed = false;
    // recognition engine (v3): drum type, confidence, map position, fingerprint
    int cls = -1;
    double clsConf = 0;
    float mapX = -1.f, mapY = -1.f;
    std::vector<float> fp; // tu::kFeatSize values (fingerprint + descriptors), kept to rebuild the map without re-analysing
  };

  struct AnalysisResult
  {
    int generation = 0;
    int index = -1;
    bool done = false;
    bool analyzed = false;
    double durMs = 0;
    double centroid = 0;
    double rolloff = 0;
    double flatness = 0;
    double attack = 0;
    double decay = 0;
    double crest = 0;
    double zcr = 0;
    double rms = 0;
    double peak = 0;
    double lufs = -70, druminess = 0, lateTransient = 0;
    int featureVersion = 0;
    int processed = 0;
    int total = 0;
    std::string name;
    int cls = -1;
    double clsConf = 0;
    std::vector<float> fp;
    // map result (sent once, after every file is analysed)
    bool isMap = false;
    std::vector<int> mapIndex;
    std::vector<int> mapCls;      // final type per mapped file (name / own model / rules)
    int modelClasses = 0, modelFiles = 0;
    std::vector<tu::MapPoint> mapPts;
  };

  std::vector<std::string> mLibraryRoots;
  std::vector<LibraryFile> mLibraryFiles;
  bool mLibraryScanned = false;

  std::thread mAnalysisThread;
  std::mutex mAnalysisMutex;
  std::atomic<int> mAnalysisGeneration{0};
  std::atomic<bool> mAnalysisRunning{false};
  std::atomic<bool> mAnalysisCancel{false}; // stops a running map (t-SNE) early
  bool mForceMapRebuild = false;           // set by kMsgTagRebuildMap (UI thread)
  std::atomic<int> mAnalysisTotal{0};
  std::atomic<int> mAnalysisDone{0};
  std::vector<AnalysisResult> mAnalysisResults;

  void SendMidiOut(int offset, float velocity);
  void SendSlotToUI(int slot);
  void SendAudioSetupToUI(); // standalone app only (no-op in the AU)

  // Hits waiting to fire. countdown = samples from the start of the next block.
  // Everything is scheduled kLatency samples late so it lines up with the delayed dry signal.
  static constexpr int kMaxHits = 64;
  struct Hit { int countdown; float velocity; };
  Hit mHits[kMaxHits];
  int mNumHits = 0;

  TransientDetector mDetector;
  HitGate mGate;
  Slot mSlots[kNumSlots];
  PreviewPlayer mPreview;          // library / slot audition, independent of MIX
  PreviewCache mPreviewCache;      // decoded preview heads (filled by the analyser and by previews)
  InputPlayer mInputPlayer;        // demo / file INPUT, summed with the live input
  InputMeter mInputMeter;          // live input peaks + hits for the TRIGGER view
  std::vector<float> mMeterPeaks;  // OnIdle scratch
  std::vector<InputMeter::HitMark> mMeterHits;
  bool mInputPlayingSent = false;  // last state told to the UI
  std::vector<sample> mIn[2];      // live input + INPUT player, sized in OnReset
  std::vector<float> mPrev[2];     // sized in OnReset
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
