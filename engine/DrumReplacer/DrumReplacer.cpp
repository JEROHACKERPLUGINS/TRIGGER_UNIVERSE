#include "DrumReplacer.h"
#include "IPlug_include_in_plug_src.h"
#include "IPlugPaths.h"
#include "DSP/WavFile.h"
#include <filesystem>
#include <algorithm>
#include <cctype>
#include <fstream>
#include <map>
#include <cmath>
#include "fft.h"

#ifdef WEBVIEW_EDITOR_DELEGATE
// Native "choose a file" dialog, same osascript approach as LReverb's
// PromptForCustomIRFolder: no IGraphics in a WebView build, and the script is a
// fixed literal, so there's no shell-injection surface. Blocks the UI thread
// while the dialog is open.
// ponytail: macOS only; add IFileOpenDialog (see LReverb) when Windows lands.
static std::string PromptForWavFile()
{
#ifdef __APPLE__
  FILE* p = popen("osascript -e 'try' -e 'POSIX path of (choose file with prompt \"Choose a WAV sample\")' -e 'on error' -e '\"\"' -e 'end try' 2>/dev/null", "r");
  if (!p) return "";
  std::string out;
  char buf[1024];
  size_t n;
  while ((n = fread(buf, 1, sizeof(buf), p)) > 0) out.append(buf, n);
  pclose(p);
  while (!out.empty() && (out.back() == '\n' || out.back() == '\r')) out.pop_back();
  return out;
#else
  return "";
#endif
}

static std::string PromptForFolder()
{
#ifdef __APPLE__
  FILE* p = popen("osascript -e 'try' -e 'POSIX path of (choose folder with prompt \"Choose your samples folder\")' -e 'on error' -e '\"\"' -e 'end try' 2>/dev/null", "r");
  if (!p) return "";
  std::string out;
  char buf[1024];
  size_t n;
  while ((n = fread(buf, 1, sizeof(buf), p)) > 0) out.append(buf, n);
  pclose(p);
  while (!out.empty() && (out.back() == '\n' || out.back() == '\r')) out.pop_back();
  return out;
#else
  return "";
#endif
}

// A file shipped inside the app / plugin bundle (Resources/web/), "" if missing.
static std::string BundledFile(const char* name)
{
  WDL_String res;
  BundleResourcePath(res, BUNDLE_ID);
  std::string path = std::string(res.Get()) + "/web/" + name;
  std::error_code ec;
  return std::filesystem::exists(path, ec) ? path : std::string();
}

static bool IsBundledDemoSample(const char* path)
{
  const std::string p(path ? path : "");
  const std::string tail = "/web/SNARE.cm.wav";
  return p.size() >= tail.size() && p.compare(p.size() - tail.size(), tail.size(), tail) == 0;
}

static std::string LibrarySettingsPath()
{
  const char* home = getenv("HOME");
  if (!home) return "";
  return std::string(home) + "/Library/Application Support/TriggerUniverse/library.json";
}

static std::string PathBaseName(const std::string& path)
{
  const auto pos = path.find_last_of("/\\");
  return pos == std::string::npos ? path : path.substr(pos + 1);
}

struct WavInfo
{
  double durMs = 0;
  int sampleRate = 0;
  int channels = 0;
};
static WavInfo ReadWavInfo(const std::string& path)
{
  WavInfo info;
  std::ifstream f(path, std::ios::binary);
  if (!f)
    return info;

  char riff[4] = {}, wave[4] = {};
  uint32_t riffSize = 0;
  f.read(riff, 4);
  f.read((char*) &riffSize, 4);
  f.read(wave, 4);
  if (std::string(riff, 4) != "RIFF" || std::string(wave, 4) != "WAVE")
    return info;

  uint16_t channels = 0, bits = 0, audioFormat = 0;
  uint32_t sampleRate = 0, byteRate = 0, dataSize = 0;

  while (f)
  {
    char id[4] = {};
    uint32_t size = 0;
    f.read(id, 4);
    f.read((char*) &size, 4);
    if (!f)
      break;
    const std::string cid(id, 4);

    if (cid == "fmt ")
    {
      f.read((char*) &audioFormat, 2);
      f.read((char*) &channels, 2);
      f.read((char*) &sampleRate, 4);
      f.read((char*) &byteRate, 4);
      f.seekg(2, std::ios::cur); // block align
      f.read((char*) &bits, 2);
      if (size > 16)
        f.seekg((std::streamoff) size - 16, std::ios::cur);
    }
    else if (cid == "data")
    {
      dataSize = size;
      break;
    }
    else
    {
      f.seekg((std::streamoff) size + (size & 1), std::ios::cur);
    }
  }

  if (byteRate > 0 && dataSize > 0)
    info.durMs = (double) dataSize / (double) byteRate * 1000.0;
  info.sampleRate = (int) sampleRate;
  info.channels = (int) channels;
  return info;
}

struct WavFeatures
{
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
  int version = tu::kAnalysisVersion;
  bool ok = false;
  int cls = -1;
  double conf = 0;
  std::vector<float> fp;
};

// Recognition engine (DSP/SampleAnalysis.h): drum type + fingerprint for the map.
// Only the start of the file is decoded (the analysis uses the first 5 s);
// the duration comes from the WAV header.
static WavFeatures AnalyzeWav(const std::string& path, PreviewCache* pCache = nullptr, long long fileSize = 0)
{
  WavFeatures out;
  std::vector<std::vector<float>> channels;
  double sr = 0;
  const WavInfo info = ReadWavInfo(path);
  if (!LoadWavFile(path, channels, sr, 8u << 20) || channels.empty() || sr <= 0)
    return out; // ok = false, centroid 0: the UI keeps it off the map
  if (pCache) pCache->Put(path, fileSize, channels, sr); // the preview plays from memory from now on

  const tu::SampleFeatures f = tu::AnalyzeSample(channels, sr, info.durMs);
  if (!f.ok)
    return out;

  out.durMs = f.durMs;
  out.centroid = f.centroid;
  out.rolloff = 0;
  out.flatness = f.noiseFlat;
  out.attack = f.attackMs;
  out.decay = f.decay40;
  out.crest = f.rms > 1e-9 ? f.peak / f.rms : 0;
  out.zcr = 0;
  out.rms = f.rms;
  out.peak = f.peak;
  out.lufs = f.lufs;
  out.druminess = f.druminess;
  out.lateTransient = f.lateTransient;
  out.cls = f.cls;
  out.conf = f.conf;
  // Ambiguous audio: an explicit word in the file name ("kick", "hat", ...) decides.
  if (f.conf < 0.2)
  {
    const int byName = tu::DrumClassFromName(PathBaseName(path));
    if (byName >= 0) { out.cls = byName; out.conf = 0.2; }
  }
  out.fp.assign(f.fp, f.fp + tu::kFpSize);
  out.fp.insert(out.fp.end(), f.desc, f.desc + tu::kDescSize); // stored as one feature row
  out.ok = true;
  return out;
}
#endif

DrumReplacer::DrumReplacer(const InstanceInfo& info)
: iplug::Plugin(info, MakeConfig(kNumParams, kNumPresets))
{
  InitParams();

#ifdef WEBVIEW_EDITOR_DELEGATE
  LoadLibrarySettings();
  // The "params" JSON message with all parameters exceeds the default 8 KB
  // JS string limit, which truncates SAMFD() and throws "Unexpected EOF".
  SetMaxJSStringLength(1 << 22);
  // iPlug2's virtual dispatch from the WKWebView handler doesn't reach the
  // plugin override in this build; handle the JSON directly.
  SetCustomMessageHandler([this](const char* json) { OnWebMessage(json); });
#ifdef DEBUG
  SetEnableDevTools(true);
#endif
  
  mEditorInitFunc = [&]()
  {
    LoadIndexHtml(__FILE__, GetBundleID());
    EnableScroll(false);
  };
#endif
  
  MakeDefaultPreset("Default", kNumPresets);
}

DrumReplacer::~DrumReplacer()
{
  StopLibraryAnalysis();
  SaveLibrarySettings();
}

void DrumReplacer::InitParams()
{
  // Detector
  // Same meaning and defaults as the prototype (see TransientDetector.h):
  // SENSITIVITY = dynamic range of the triggered hits, DETAIL = threshold.
  GetParam(kSensitivity)->InitPercentage("Sensitivity", 51.);
  GetParam(kRetrigger)->InitMilliseconds("Retrigger", 30., 0., 1000.);
  GetParam(kDetail)->InitPercentage("Detail", 14.);
  GetParam(kDetectorMode)->InitInt("Mode", 0, 0, 3); // ponytail: unused until we know what the original modes do
  GetParam(kLowCut)->InitFrequency("Low Cut", 20., 20., 20000.);
  GetParam(kHighCut)->InitFrequency("High Cut", 20000., 20., 20000.);
  GetParam(kSuppression)->InitPercentage("Suppression", 0.);

  // Gain
  GetParam(kInputGain)->InitGain("Input Gain", 0., -24., 24.);
  GetParam(kOutputGain)->InitGain("Output Gain", 0., -24., 24.);
  GetParam(kMix)->InitPercentage("Mix", 0.);

  // Gate
  GetParam(kGateEnabled)->InitBool("Gate On", false);
  GetParam(kGateAttack)->InitMilliseconds("Gate Attack", 1., 0., 500.);
  GetParam(kGateSustain)->InitPercentage("Gate Sustain", 0.); // floor between hits
  GetParam(kGateRelease)->InitMilliseconds("Gate Release", 100., 0., 500.);

  // MIDI
  GetParam(kMidiInEnabled)->InitBool("MIDI In", true);
  GetParam(kMidiInNote)->InitPitch("MIDI In Note", 36, 0, 127);
  GetParam(kMidiInChannel)->InitInt("MIDI In Channel", 10, 1, 16);
  GetParam(kMidiOutEnabled)->InitBool("MIDI Out", false);
  GetParam(kMidiOutNote)->InitPitch("MIDI Out Note", 36, 0, 127);
  GetParam(kMidiOutChannel)->InitInt("MIDI Out Channel", 10, 1, 16);

  // Links
  GetParam(kAttackLink)->InitBool("Attack Link", false);
  GetParam(kSustainLink)->InitBool("Sustain Link", false);
  GetParam(kReleaseLink)->InitBool("Release Link", false);
  GetParam(kDynLink)->InitBool("Dynamics Link", false);
  GetParam(kVeloLink)->InitBool("Velocity Link", false);
  GetParam(kTuneLink)->InitBool("Tune Link", false);
  GetParam(kRangeTopLink)->InitBool("Range Top Link", false);
  GetParam(kRangeBottomLink)->InitBool("Range Bottom Link", false);

  // Slots
  for (int s = 0; s < kNumSlots; s++)
  {
    WDL_String group, n;
    group.SetFormatted(16, "Slot %i", s + 1);
    auto name = [&](const char* p) { n.SetFormatted(64, "S%i %s", s + 1, p); return n.Get(); };
    const char* g = group.Get();

    GetParam(SlotParam(s, kSlotVol))->InitGain(name("Volume"), 0., -70., 6., 0.1, 0, g);
    GetParam(SlotParam(s, kSlotPan))->InitDouble(name("Pan"), 0., -100., 100., 1., "%", 0, g);
    GetParam(SlotParam(s, kSlotTune))->InitDouble(name("Tune"), 0., -24., 24., 0.01, "st", 0, g);
    GetParam(SlotParam(s, kSlotAttack))->InitMilliseconds(name("Attack"), 0., 0., 2000., 0, g);
    GetParam(SlotParam(s, kSlotRelease))->InitMilliseconds(name("Release"), 500., 0., 5000., 0, g);
    GetParam(SlotParam(s, kSlotSustain))->InitPercentage(name("Sustain"), 100., 0., 100., 0, g);
    GetParam(SlotParam(s, kSlotVeloCurve))->InitPercentage(name("Velocity Curve"), 50., 0., 100., 0, g);
    GetParam(SlotParam(s, kSlotDynCurve))->InitPercentage(name("Dynamics Curve"), 100., 0., 100., 0, g);
    GetParam(SlotParam(s, kSlotRangeTop))->InitPercentage(name("Range Top"), 100., 0., 100., 0, g);
    GetParam(SlotParam(s, kSlotRangeBottom))->InitPercentage(name("Range Bottom"), 0., 0., 100., 0, g);
    GetParam(SlotParam(s, kSlotPhase))->InitBool(name("Phase Invert"), false, "", 0, g);
    GetParam(SlotParam(s, kSlotSolo))->InitBool(name("Solo"), false, "", 0, g);
    GetParam(SlotParam(s, kSlotMute))->InitBool(name("Mute"), false, "", 0, g);
  }
}

bool DrumReplacer::SerializeState(IByteChunk& chunk) const
{
  int version = kStateVersion;
  chunk.Put(&version);
  chunk.PutStr(mBaseDir.Get());
  chunk.PutStr(mPresetName.Get());
  for (int s = 0; s < kNumSlots; s++)
    chunk.PutStr(mSlotPaths[s].Get());

  return SerializeParams(chunk);
}

int DrumReplacer::UnserializeState(const IByteChunk& chunk, int startPos)
{
  int version = 0;
  startPos = chunk.Get(&version, startPos);
  if (startPos < 0 || version != kStateVersion)
    return -1;

  startPos = chunk.GetStr(mBaseDir, startPos);
  startPos = chunk.GetStr(mPresetName, startPos);
  for (int s = 0; s < kNumSlots && startPos >= 0; s++)
    startPos = chunk.GetStr(mSlotPaths[s], startPos);
  if (startPos < 0)
    return -1;

  for (int s = 0; s < kNumSlots; s++)
  {
    const WDL_String path(mSlotPaths[s]); // copy: LoadSlot rewrites mSlotPaths[s]
    LoadSlot(s, path.Get()); // on a missing file the slot stays empty, path is kept
  }

  return UnserializeParams(chunk, startPos);
}

bool DrumReplacer::LoadSlot(int slot, const char* path)
{
  auto* pData = new SampleData;
  mSlotPaths[slot].Set(path);

  std::vector<std::vector<float>> chans;
  double sr = 0.;
  const bool ok = path && *path && LoadWavFile(path, chans, sr) && !chans.empty();
  if (ok && IsBundledDemoSample(path))
  {
    // The demo SNARE.cm file holds several hits: the slot gets the first one
    // (510 ms with a 10 ms fade), like the prototype.
    const size_t keep = std::min(chans[0].size(), (size_t) (0.51 * sr));
    const size_t fade = std::min(keep, (size_t) (0.01 * sr));
    for (auto& c : chans)
    {
      c.resize(std::min(c.size(), keep));
      for (size_t k = 0; k < fade && k < c.size(); k++) c[c.size() - 1 - k] *= (float) k / (float) fade;
    }
  }
  if (ok)
  {
    pData->numChannels = std::min((int) chans.size(), 2);
    for (int c = 0; c < pData->numChannels; c++)
      pData->ch[c] = std::move(chans[c]);
    pData->numFrames = (int) pData->ch[0].size();
    pData->sampleRate = sr;
  }
  mSlots[slot].SetSample(pData); // empty SampleData clears the slot
  mSlotOk[slot] = ok;
  return ok;
}

void DrumReplacer::OnIdle()
{
  for (auto& slot : mSlots)
    slot.CollectGarbage();
  mPreview.CollectGarbage();
  mInputPlayer.CollectGarbage();

#ifdef WEBVIEW_EDITOR_DELEGATE
  {
    const bool playing = mInputPlayer.IsPlaying();
    if (mUIOpen && playing != mInputPlayingSent)
    {
      mInputPlayingSent = playing;
      SendJSONFromDelegate({{"id", "input"}, {"playing", playing}, {"dur", mInputPlayer.DurationSec()}});
    }
  }
  std::vector<AnalysisResult> pending;
  {
    std::lock_guard<std::mutex> lock(mAnalysisMutex);
    pending.swap(mAnalysisResults);
  }

  if (!pending.empty())
  {
    const int currentGen = mAnalysisGeneration.load();
    for (const auto& r : pending)
    {
      if (r.generation != currentGen)
        continue;

      if (r.done)
      {
        mAnalysisRunning = false;
        SaveLibrarySettings();
        if (mUIOpen)
          SendJSONFromDelegate({{"id", "analysisDone"}, {"total", r.total}});
        continue;
      }

      if (r.isMap)
      {
        nlohmann::json pts = nlohmann::json::array();
        for (size_t k = 0; k < r.mapIndex.size(); k++)
        {
          const int idx = r.mapIndex[k];
          if (idx < 0 || idx >= (int) mLibraryFiles.size()) continue;
          auto& lf = mLibraryFiles[(size_t) idx];
          const auto& mp = r.mapPts[k];
          lf.mapX = mp.x;
          lf.mapY = mp.y;
          std::copy(mp.e, mp.e + 4, lf.emb);
          if (k < r.mapCls.size()) lf.cls = r.mapCls[k];
          pts.push_back({idx, mp.x, mp.y, mp.e[0], mp.e[1], mp.e[2], mp.e[3], tu::DrumClassName(lf.cls)});
        }
        SaveLibrarySettings();
        if (mUIOpen)
          SendJSONFromDelegate({{"id", "map"}, {"pts", pts}, {"modelClasses", r.modelClasses}, {"modelFiles", r.modelFiles}});
        continue;
      }

      if (r.index >= 0 && r.index < (int) mLibraryFiles.size())
      {
        auto& f = mLibraryFiles[(size_t) r.index];
        f.cls = r.cls;
        f.clsConf = r.clsConf;
        f.fp = r.fp;
        f.mapX = f.mapY = -1.f; // placed by the next map
        f.durMs = r.durMs;
        f.centroidHz = r.centroid;
        f.rolloffHz = r.rolloff;
        f.flatness = r.flatness;
        f.attackMs = r.attack;
        f.decayMs = r.decay;
        f.crest = r.crest;
        f.zcr = r.zcr;
        f.rms = r.rms;
        f.peak = r.peak;
        f.lufs = r.lufs;
        f.druminess = r.druminess;
        f.lateTransient = r.lateTransient;
        f.featureVersion = r.featureVersion;
        f.analyzed = r.analyzed;
      }
      mAnalysisDone = r.processed;

      if (mUIOpen)
        SendJSONFromDelegate({{"id", "analyzed"}, {"index", r.index}, {"dur", r.durMs},
                              {"centroid", r.centroid}, {"rolloff", r.rolloff},
                              {"flatness", r.flatness}, {"attack", r.attack},
                              {"decay", r.decay}, {"crest", r.crest},
                              {"zcr", r.zcr}, {"rms", r.rms}, {"peak", r.peak},
                              {"lufs", r.lufs}, {"drum", r.druminess}, {"late", r.lateTransient},
                              {"v", r.featureVersion}, {"analyzed", r.analyzed},
                              {"cls", tu::DrumClassName(r.cls)}, {"conf", r.clsConf},
                              {"name", r.name}, {"done", r.processed}, {"total", r.total}});

      if (r.processed > 0 && r.processed % 100 == 0)
        SaveLibrarySettings();
    }
  }

  const int hits = mHitCount.load();
  if (mUIOpen && hits != mHitCountSent)
  {
    mHitCountSent = hits;
    SendJSONFromDelegate({{"id", "hit"}, {"vel", mLastHitVelocity.load()}});
  }
#endif
}

#if IPLUG_DSP
void DrumReplacer::ProcessBlock(sample** inputs, sample** outputs, int nFrames)
{
  const double sr = GetSampleRate();
  const sample inGain = GetParam(kInputGain)->DBToAmp();
  const double sens = GetParam(kSensitivity)->Value();

  // 0. INPUT = live input + the INPUT player (demo / file), like a track in the DAW
  if ((int) mIn[0].size() < nFrames) { mIn[0].resize(nFrames); mIn[1].resize(nFrames); }
  sample* inL = mIn[0].data();
  sample* inR = mIn[1].data();
  std::copy(inputs[0], inputs[0] + nFrames, inL);
  std::copy(inputs[1], inputs[1] + nFrames, inR);
  {
    float* tL = mPrev[0].data(); // scratch, refilled by the preview below
    float* tR = mPrev[1].data();
    std::fill(tL, tL + nFrames, 0.f);
    std::fill(tR, tR + nFrames, 0.f);
    mInputPlayer.Render(tL, tR, nFrames, sr);
    for (int i = 0; i < nFrames; i++) { inL[i] += tL[i]; inR[i] += tR[i]; }
  }

  // 1. Detect. Hits come out at the end of the detector's peak window, which is exactly
  //    when the delayed dry signal reaches the onset, so they fire right away.
  mDetector.SetParams(GetParam(kSensitivity)->Value(), GetParam(kRetrigger)->Value(),
                      GetParam(kDetail)->Value(), GetParam(kLowCut)->Value(),
                      GetParam(kHighCut)->Value(), GetParam(kSuppression)->Value());
  mDetector.Process(inL, inR, nFrames, inGain, [&](int offset, float velocity) {
    if (mNumHits < kMaxHits) mHits[mNumHits++] = {offset, velocity};
  });

  // 2. Take the hits due in this block; keep the rest for later blocks.
  Hit due[kMaxHits];
  int numDue = 0, numKept = 0;
  for (int h = 0; h < mNumHits; h++)
  {
    if (mHits[h].countdown < nFrames)
      due[numDue++] = mHits[h];
    else
      mHits[numKept++] = {mHits[h].countdown - nFrames, mHits[h].velocity};
  }
  mNumHits = numKept;
  std::sort(due, due + numDue, [](const Hit& a, const Hit& b) { return a.countdown < b.countdown; });
  if (numDue)
  {
    mLastHitVelocity.store(due[numDue - 1].velocity);
    mHitCount.fetch_add(numDue);
  }

  for (int h = 0; h < numDue; h++)
    SendMidiOut(due[h].countdown, due[h].velocity);
  if (mNoteOffIn >= 0)
  {
    if (mNoteOffIn < nFrames)
    {
      IMidiMsg off;
      off.MakeNoteOffMsg(mOutNote, mNoteOffIn, mOutChannel);
      SendMidiMsg(off);
      mNoteOffIn = -1;
    }
    else
      mNoteOffIn -= nFrames;
  }

  // 3. Render slots
  float* wetL = mWet[0].data();
  float* wetR = mWet[1].data();
  std::fill(wetL, wetL + nFrames, 0.f);
  std::fill(wetR, wetR + nFrames, 0.f);

  bool anySolo = false;
  for (int s = 0; s < kNumSlots; s++)
    anySolo |= GetParam(SlotParam(s, kSlotSolo))->Bool();

  for (int s = 0; s < kNumSlots; s++)
  {
    Slot& slot = mSlots[s];
    slot.SwapIfPending();
    // the UI sends the slot VELOCITY amount (0..100 %) in kSlotVeloCurve
    const double velAmount = GetParam(SlotParam(s, kSlotVeloCurve))->Value();
    for (int h = 0; h < numDue; h++)
      slot.Trigger(due[h].countdown, TriggerGain(due[h].velocity, sens, velAmount));

    const bool audible = !GetParam(SlotParam(s, kSlotMute))->Bool()
                      && (!anySolo || GetParam(SlotParam(s, kSlotSolo))->Bool());
    if (!audible) continue; // voices keep their place, just silent this block

    VoiceParams p;
    const float vol = (float) GetParam(SlotParam(s, kSlotVol))->DBToAmp()
                    * (GetParam(SlotParam(s, kSlotPhase))->Bool() ? -1.f : 1.f);
    const double pan = GetParam(SlotParam(s, kSlotPan))->Value() / 100.; // -1..1, equal power, unity at center
    p.gainL = vol * (float) (std::cos((pan + 1.) * M_PI / 4.) * M_SQRT2);
    p.gainR = vol * (float) (std::sin((pan + 1.) * M_PI / 4.) * M_SQRT2);
    p.ratio = slot.SampleRate() / sr * std::pow(2., GetParam(SlotParam(s, kSlotTune))->Value() / 12.);
    p.attackSamples = GetParam(SlotParam(s, kSlotAttack))->Value() * 0.001 * sr;
    p.sustainFrac = GetParam(SlotParam(s, kSlotSustain))->Value() / 100.;
    p.releaseSamples = GetParam(SlotParam(s, kSlotRelease))->Value() * 0.001 * sr;
    slot.Render(wetL, wetR, nFrames, p);
  }

  // 4. Delayed dry (through the hit-keyed gate) + wet mix, output gain
  const bool gateOn = kIsPro && GetParam(kGateEnabled)->Bool();
  const double gateAtk = GetParam(kGateAttack)->Value() * 0.001 * sr;
  const double gateRel = GetParam(kGateRelease)->Value() * 0.001 * sr;
  const double gateFloor = GetParam(kGateSustain)->Value() * 0.01;
  int nextHit = 0;
  const sample outGain = GetParam(kOutputGain)->DBToAmp();
  const sample mix = GetParam(kMix)->Value() / 100.;
  const int delayLen = (int) mDelay[0].size();
  for (int i = 0; i < nFrames; i++)
  {
    const sample dryL = mDelay[0][mDelayPos], dryR = mDelay[1][mDelayPos];
    mDelay[0][mDelayPos] = inL[i];
    mDelay[1][mDelayPos] = inR[i];
    if (++mDelayPos == delayLen) mDelayPos = 0;

    while (nextHit < numDue && due[nextHit].countdown == i)
    {
      mGate.Trigger();
      nextHit++;
    }
    const sample gate = gateOn ? mGate.Process(gateAtk, gateRel, gateFloor) : 1.;
    const sample g = mInGainSmooth.Process(inGain) * gate;
    const sample m = mMixSmooth.Process(mix);
    const sample o = mOutGainSmooth.Process(outGain);
    outputs[0][i] = (dryL * g * (1. - m) + wetL[i] * m) * o;
    outputs[1][i] = (dryR * g * (1. - m) + wetR[i] * m) * o;
  }

  // 5. Preview (library hover / slot audition): on top of everything, not
  //    affected by MIX or OUTPUT, so it is heard even with MIX at 0%.
  float* prevL = mPrev[0].data();
  float* prevR = mPrev[1].data();
  std::fill(prevL, prevL + nFrames, 0.f);
  std::fill(prevR, prevR + nFrames, 0.f);
  mPreview.Render(prevL, prevR, nFrames, sr);
  for (int i = 0; i < nFrames; i++)
  {
    outputs[0][i] += prevL[i];
    outputs[1][i] += prevR[i];
  }
}

void DrumReplacer::SendMidiOut(int offset, float velocity)
{
  if (!GetParam(kMidiOutEnabled)->Bool())
    return;
  if (mNoteOffIn >= 0) // close the previous note first
  {
    IMidiMsg off;
    off.MakeNoteOffMsg(mOutNote, offset, mOutChannel);
    SendMidiMsg(off);
  }
  mOutNote = GetParam(kMidiOutNote)->Int();
  mOutChannel = GetParam(kMidiOutChannel)->Int() - 1;
  IMidiMsg on;
  on.MakeNoteOnMsg(mOutNote, std::clamp((int) std::lround(velocity * 127.f), 1, 127), offset, mOutChannel);
  SendMidiMsg(on);
  mNoteOffIn = offset + (int) (0.010 * GetSampleRate()); // 10 ms notes
}

void DrumReplacer::OnReset()
{
  const double sr = GetSampleRate();
  for (auto& w : mWet)
    w.assign(GetBlockSize(), 0.f);
  for (auto& w : mPrev)
    w.assign(GetBlockSize(), 0.f);
  for (auto& w : mIn)
    w.assign(GetBlockSize(), 0.);

  mDetector.Reset(sr);
  mGate.Reset();
  const int latency = mDetector.LatencySamples();
  for (auto& d : mDelay)
    d.assign(latency, 0.);
  mDelayPos = 0;
  if (GetLatency() != latency)
    SetLatency(latency);

  for (auto* s : {&mInGainSmooth, &mOutGainSmooth, &mMixSmooth})
    s->SetSmoothTime(20., sr);
  mInGainSmooth.SetValue(GetParam(kInputGain)->DBToAmp());
  mOutGainSmooth.SetValue(GetParam(kOutputGain)->DBToAmp());
  mMixSmooth.SetValue(GetParam(kMix)->Value() / 100.);

  mNumHits = 0;
  mNoteOffIn = -1;
}
#endif

void DrumReplacer::OnWebMessage(const char* jsonStr)
{
#ifdef WEBVIEW_EDITOR_DELEGATE
  auto json = nlohmann::json::parse(jsonStr, nullptr, false);
  if (json.is_discarded() || !json.contains("msg"))
    return;

  const std::string msg = json["msg"].get<std::string>();

  if (msg == "SPVFUI")
  {
    const int idx = json.value("paramIdx", -1);
    const double value = json.value("value", 0.0);
    if (idx >= 0 && idx < NParams())
    {
      GetParam(idx)->SetNormalized(value);
      OnParamChange(idx);
    }
  }
  else if (msg == "BPCFUI")
  {
    const int idx = json.value("paramIdx", -1);
    if (idx >= 0 && idx < NParams())
      BeginInformHostOfParamChange(idx);
  }
  else if (msg == "EPCFUI")
  {
    const int idx = json.value("paramIdx", -1);
    if (idx >= 0 && idx < NParams())
      EndInformHostOfParamChange(idx);
  }
  else if (msg == "SAMFUI")
  {
    const int msgTag = json.value("msgTag", -1);
    const int ctrlTag = json.value("ctrlTag", -1);
    std::vector<unsigned char> data;

    if (json.contains("data") && json["data"].is_string())
    {
      const std::string dStr = json["data"].get<std::string>();
      const int dSize = (int) dStr.size();
      int numPaddingBytes = 0;
      if (dSize >= 2 && dStr[dSize - 2] == '=')
        numPaddingBytes = 2;
      else if (dSize >= 1 && dStr[dSize - 1] == '=')
        numPaddingBytes = 1;
      data.resize((dSize * 3) / 4 - numPaddingBytes);
      wdl_base64decode(dStr.c_str(), data.data(), (int) data.size());
    }

    OnMessage(msgTag, ctrlTag, (int) data.size(), data.data());
  }
#endif
}

bool DrumReplacer::OnMessage(int msgTag, int ctrlTag, int dataSize, const void* pData)
{
  if (msgTag == kMsgTagChooseFolder)
  {
#ifdef WEBVIEW_EDITOR_DELEGATE
    const std::string folder = PromptForFolder();
    if (!folder.empty())
    {
      const auto it = std::find(mLibraryRoots.begin(), mLibraryRoots.end(), folder);
      if (it == mLibraryRoots.end())
      {
        mLibraryRoots.push_back(folder);
        ScanLibraryAndSend();
      }
      else
      {
        SendLibraryToUI();
      }
    }
#endif
    return true;
  }

  if (msgTag == kMsgTagRemoveRoot)
  {
#ifdef WEBVIEW_EDITOR_DELEGATE
    if (ctrlTag >= 0 && ctrlTag < (int) mLibraryRoots.size())
    {
      mLibraryRoots.erase(mLibraryRoots.begin() + ctrlTag);
      ScanLibraryAndSend();
    }
#endif
    return true;
  }

  if (msgTag == kMsgTagRescanLibrary)
  {
#ifdef WEBVIEW_EDITOR_DELEGATE
    ScanLibraryAndSend();
#endif
    return true;
  }

  if (msgTag == kMsgTagGetLibrary)
  {
#ifdef WEBVIEW_EDITOR_DELEGATE
    SendLibraryToUI();
#endif
    return true;
  }

  if (msgTag == kMsgTagPreviewPath)
  {
    if (pData && dataSize > 0)
    {
      // Only the first ~2 MB: a preview plays <= 0.8 s, long multitrack
      // files must not stall the UI thread.
      const std::string path((const char*) pData, (size_t) dataSize);
      std::error_code ec;
      const long long fileSize = (long long) std::filesystem::file_size(path, ec);
      if (SampleData* pCached = ec ? nullptr : mPreviewCache.GetCopy(path, fileSize))
      {
        mPreview.SetSample(pCached); // from memory: instant
        return true;
      }
      std::vector<std::vector<float>> chans;
      double sr = 0.;
      if (LoadWavFile(path, chans, sr, 2u << 20) && !chans.empty() && sr > 0.)
      {
        if (!ec) mPreviewCache.Put(path, fileSize, chans, sr);
        auto* pData2 = new SampleData;
        pData2->numChannels = std::min((int) chans.size(), 2);
        for (int c = 0; c < pData2->numChannels; c++)
          pData2->ch[c] = std::move(chans[c]);
        pData2->numFrames = (int) pData2->ch[0].size();
        pData2->sampleRate = sr;
        mPreview.SetSample(pData2);
      }
    }
    return true;
  }

  if (msgTag == kMsgTagInputPlay)
  {
    std::string path = (pData && dataSize > 0) ? std::string((const char*) pData, (size_t) dataSize) : std::string();
    if (path.empty()) path = BundledFile("SN_TOP_1COMMIT_17-140.wav");
    std::vector<std::vector<float>> chans;
    double sr = 0.;
    if (!path.empty() && LoadWavFile(path, chans, sr) && !chans.empty() && sr > 0.)
    {
      auto* pIn = new SampleData;
      pIn->numChannels = std::min((int) chans.size(), 2);
      for (int c = 0; c < pIn->numChannels; c++)
        pIn->ch[c] = std::move(chans[c]);
      pIn->numFrames = (int) pIn->ch[0].size();
      pIn->sampleRate = sr;
      mInputPlayer.Start(pIn);
    }
#ifdef WEBVIEW_EDITOR_DELEGATE
    else
      SendJSONFromDelegate({{"id", "input"}, {"playing", false}, {"error", "No se pudo leer el INPUT"}});
#endif
    return true;
  }

  if (msgTag == kMsgTagInputStop)
  {
    mInputPlayer.Stop();
    return true;
  }

  if (msgTag == kMsgTagRebuildMap)
  {
#ifdef WEBVIEW_EDITOR_DELEGATE
    mForceMapRebuild = true;
    StartLibraryAnalysis();
#endif
    return true;
  }

  if (msgTag == kMsgTagPreviewStop)
  {
    mPreview.Stop();
    return true;
  }

  if (ctrlTag < 0 || ctrlTag >= kNumSlots)
    return false;

  if (msgTag == kMsgTagLoadPath)
  {
#ifdef WEBVIEW_EDITOR_DELEGATE
    if (pData && dataSize > 0)
    {
      const std::string path((const char*) pData, (size_t) dataSize);
      LoadSlot(ctrlTag, path.c_str());
      SendSlotToUI(ctrlTag);
    }
#endif
    return true;
  }

  if (msgTag == kMsgTagLoadSample)
  {
#ifdef WEBVIEW_EDITOR_DELEGATE
    const std::string path = PromptForWavFile();
    if (path.empty())
      return true;
    LoadSlot(ctrlTag, path.c_str());
    SendSlotToUI(ctrlTag);
#endif
    return true;
  }
  if (msgTag == kMsgTagClearSlot)
  {
    LoadSlot(ctrlTag, "");
    SendSlotToUI(ctrlTag);
    return true;
  }
  return false;
}

void DrumReplacer::SendSlotToUI(int slot)
{
#ifdef WEBVIEW_EDITOR_DELEGATE
  const std::string path = mSlotPaths[slot].Get();
  const std::string name = path.substr(path.find_last_of('/') + 1);
  SendJSONFromDelegate({{"id", "slot"}, {"slot", slot}, {"name", name}, {"ok", mSlotOk[slot]}});
#endif
}

void DrumReplacer::LoadLibrarySettings()
{
  const std::string path = LibrarySettingsPath();
  if (path.empty())
    return;
  std::ifstream in(path);
  if (!in)
    return;
  nlohmann::json j;
  try { in >> j; } catch (...) { return; }

  mLibraryRoots.clear();
  mLibraryFiles.clear();
  if (j.contains("roots") && j["roots"].is_array())
    for (const auto& r : j["roots"])
      if (r.is_string())
        mLibraryRoots.push_back(r.get<std::string>());

  if (j.contains("files") && j["files"].is_array())
  {
    for (const auto& f : j["files"])
    {
      LibraryFile lf;
      lf.root = f.value("root", 0);
      lf.path = f.value("path", "");
      lf.name = f.value("name", "");
      lf.rel = f.value("rel", "");
      lf.size = f.value("size", 0LL);
      lf.durMs = f.value("dur", 0.0);
      lf.sampleRate = f.value("sr", 0);
      lf.channels = f.value("ch", 0);
      lf.centroidHz = f.value("centroid", 0.0);
      lf.rolloffHz = f.value("rolloff", 0.0);
      lf.flatness = f.value("flatness", 0.0);
      lf.attackMs = f.value("attack", 0.0);
      lf.decayMs = f.value("decay", 0.0);
      lf.crest = f.value("crest", 0.0);
      lf.zcr = f.value("zcr", 0.0);
      lf.rms = f.value("rms", 0.0);
      lf.peak = f.value("peak", 0.0);
      lf.lufs = f.value("lufs", -70.0);
      lf.druminess = f.value("drum", 0.0);
      lf.lateTransient = f.value("late", 0.0);
      if (f.contains("e") && f["e"].is_array() && f["e"].size() == 4)
        for (int k = 0; k < 4; k++) lf.emb[k] = f["e"][(size_t) k].get<float>();
      lf.featureVersion = f.value("v", 0);
      lf.analyzed = f.value("analyzed", false);
      lf.cls = f.value("cls", -1);
      lf.clsConf = f.value("conf", 0.0);
      lf.mapX = f.value("mx", -1.0f);
      lf.mapY = f.value("my", -1.0f);
      if (f.contains("fp") && f["fp"].is_array() && f["fp"].size() == (size_t) tu::kFeatSize)
        lf.fp = f["fp"].get<std::vector<float>>();
      if (!lf.path.empty())
        mLibraryFiles.push_back(std::move(lf));
    }
  }
  // positions from another map layout are not reused: the map is rebuilt
  if (j.value("mapVersion", 0) != tu::kMapVersion)
    for (auto& lf : mLibraryFiles) lf.mapX = lf.mapY = -1.f;
  mLibraryScanned = !mLibraryRoots.empty() && !mLibraryFiles.empty();
}

void DrumReplacer::SaveLibrarySettings() const
{
  const std::string path = LibrarySettingsPath();
  if (path.empty())
    return;
  std::error_code ec;
  std::filesystem::create_directories(std::filesystem::path(path).parent_path(), ec);

  nlohmann::json j;
  j["roots"] = mLibraryRoots;
  j["mapVersion"] = tu::kMapVersion;
  j["files"] = nlohmann::json::array();
  for (const auto& f : mLibraryFiles)
  {
    nlohmann::json e = {{"root", f.root}, {"path", f.path}, {"name", f.name},
                        {"rel", f.rel}, {"size", f.size}, {"dur", f.durMs},
                        {"sr", f.sampleRate}, {"ch", f.channels},
                        {"centroid", f.centroidHz}, {"rolloff", f.rolloffHz},
                        {"flatness", f.flatness}, {"attack", f.attackMs},
                        {"decay", f.decayMs}, {"crest", f.crest},
                        {"zcr", f.zcr}, {"rms", f.rms}, {"peak", f.peak},
                        {"lufs", f.lufs}, {"drum", f.druminess}, {"late", f.lateTransient},
                        {"e", {f.emb[0], f.emb[1], f.emb[2], f.emb[3]}},
                        {"v", f.featureVersion}, {"analyzed", f.analyzed},
                        {"cls", f.cls}, {"conf", f.clsConf}, {"mx", f.mapX}, {"my", f.mapY}};
    if ((int) f.fp.size() == tu::kFeatSize)
    {
      nlohmann::json fp = nlohmann::json::array();
      for (float v : f.fp) fp.push_back(std::round(v * 1000.f) / 1000.f); // 3 decimals: smaller file
      e["fp"] = fp;
    }
    j["files"].push_back(std::move(e));
  }

  std::ofstream out(path);
  if (out)
    out << j.dump();
}

void DrumReplacer::ScanLibraryAndSend()
{
  std::map<std::string, LibraryFile> old;
  for (const auto& f : mLibraryFiles)
    old[f.path] = f;

  mLibraryFiles.clear();
  namespace fs = std::filesystem;

  for (size_t r = 0; r < mLibraryRoots.size(); ++r)
  {
    const std::string root = mLibraryRoots[r];
    std::error_code ec;
    if (!fs::is_directory(root, ec))
      continue;

    for (fs::recursive_directory_iterator it(root, fs::directory_options::skip_permission_denied, ec), end;
         !ec && it != end; it.increment(ec))
    {
      if (!it->is_regular_file(ec))
        continue;
      std::string ext = it->path().extension().string();
      std::transform(ext.begin(), ext.end(), ext.begin(),
                     [](unsigned char c) { return (char) std::tolower(c); });
      if (ext != ".wav")
        continue;

      std::error_code relEc;
      std::string rel = fs::relative(it->path(), root, relEc).string();
      if (relEc)
        rel = it->path().filename().string();

      LibraryFile lf;
      lf.root = (int) r;
      lf.path = it->path().string();
      lf.name = it->path().filename().string();
      lf.rel = rel;
      lf.size = (long long) it->file_size(ec);

      const auto oit = old.find(lf.path);
      if (oit != old.end() && oit->second.size == lf.size)
      {
        // Keep every cached field (features, type, fingerprint, map place...):
        // known files keep their analysis and their place; new ones are inserted.
        LibraryFile cached = oit->second;
        cached.root = lf.root;
        cached.path = lf.path;
        cached.name = lf.name;
        cached.rel = lf.rel;
        cached.size = lf.size;
        lf = std::move(cached);
      }
      // New files are not opened here: the background analyzer reads the header
      // and the features. On big libraries (100k+ files) reading every WAV
      // header during the scan blocked the UI for minutes.

      mLibraryFiles.push_back(std::move(lf));
    }
  }

  std::sort(mLibraryFiles.begin(), mLibraryFiles.end(), [](const LibraryFile& a, const LibraryFile& b) {
    return a.root == b.root ? a.rel < b.rel : a.root < b.root;
  });

  mLibraryScanned = true;
  SaveLibrarySettings();
  SendLibraryToUI();
  StartLibraryAnalysis();
}

void DrumReplacer::SendLibraryToUI()
{
#ifdef WEBVIEW_EDITOR_DELEGATE
  nlohmann::json roots = nlohmann::json::array();
  for (const auto& r : mLibraryRoots)
    roots.push_back({{"path", r}, {"name", PathBaseName(r)}});

  // A 100k+ file library serialises to tens of MB: send it in blocks so the
  // WebView never has to parse one huge JSON message.
  static constexpr size_t kChunkSize = 1500;
  SendJSONFromDelegate({{"id", "libraryBegin"}, {"roots", roots}, {"total", (int) mLibraryFiles.size()}});

  nlohmann::json files = nlohmann::json::array();
  for (const auto& f : mLibraryFiles)
  {
    files.push_back({{"root", f.root}, {"path", f.path}, {"name", f.name},
                     {"rel", f.rel}, {"size", f.size}, {"dur", f.durMs},
                     {"sr", f.sampleRate}, {"ch", f.channels},
                     {"centroid", f.centroidHz}, {"rolloff", f.rolloffHz},
                     {"flatness", f.flatness}, {"attack", f.attackMs},
                     {"decay", f.decayMs}, {"crest", f.crest},
                     {"zcr", f.zcr}, {"rms", f.rms}, {"peak", f.peak},
                     {"lufs", f.lufs}, {"drum", f.druminess}, {"late", f.lateTransient},
                     {"e", {f.emb[0], f.emb[1], f.emb[2], f.emb[3]}},
                     {"v", f.featureVersion}, {"analyzed", f.analyzed},
                     {"cls", f.cls >= 0 ? tu::DrumClassName(f.cls) : ""}, {"conf", f.clsConf},
                     {"mx", f.mapX}, {"my", f.mapY}});
    if (files.size() >= kChunkSize)
    {
      SendJSONFromDelegate({{"id", "libraryChunk"}, {"files", files}});
      files = nlohmann::json::array();
    }
  }
  if (!files.empty())
    SendJSONFromDelegate({{"id", "libraryChunk"}, {"files", files}});
  SendJSONFromDelegate({{"id", "libraryEnd"}, {"total", (int) mLibraryFiles.size()}});
#endif
}

// Not analyzed with the current recognition engine yet. A file that failed to
// decode is marked analyzed with centroid 0: it is not retried on every open.
bool DrumReplacer::NeedsAnalysis(const LibraryFile& f)
{
  return !f.analyzed || f.featureVersion < tu::kAnalysisVersion;
}

// Background job: analyse what is missing (type + fingerprint), then build the
// XO-style map (t-SNE) over the whole library. Works on a snapshot, so the UI
// thread can keep using mLibraryFiles; results come back through OnIdle.
void DrumReplacer::StartLibraryAnalysis()
{
  StopLibraryAnalysis();

  struct Item { int index; std::string path; std::string name; bool needs; bool ok; double durMs; int cls; std::vector<float> fp; float mx, my; long long size; };
  std::vector<Item> items;
  items.reserve(mLibraryFiles.size());
  int numJobs = 0;
  bool mapMissing = false;
  for (size_t i = 0; i < mLibraryFiles.size(); ++i)
  {
    const auto& f = mLibraryFiles[i];
    const bool needs = NeedsAnalysis(f);
    const bool ok = !needs && f.centroidHz > 0 && (int) f.fp.size() == tu::kFeatSize;
    // re-analysed files lose their old position: the map is rebuilt or they are inserted
    items.push_back({(int) i, f.path, f.name, needs, ok, f.durMs, f.cls, f.fp, needs ? -1.f : f.mapX, needs ? -1.f : f.mapY, f.size});
    numJobs += needs ? 1 : 0;
    mapMissing |= ok && f.mapX < 0.f;
  }
  if (mForceMapRebuild) mapMissing = true;

  mAnalysisTotal = numJobs;
  mAnalysisDone = 0;

  if (numJobs == 0 && !mapMissing)
  {
#ifdef WEBVIEW_EDITOR_DELEGATE
    if (mUIOpen)
      SendJSONFromDelegate({{"id", "analysisDone"}, {"total", 0}});
#endif
    return;
  }

  const int gen = ++mAnalysisGeneration;
  mAnalysisCancel = false;
  mAnalysisRunning = true;

#ifdef WEBVIEW_EDITOR_DELEGATE
  if (mUIOpen && numJobs > 0)
    SendJSONFromDelegate({{"id", "analysisStart"}, {"total", numJobs}});
#endif

  const bool forceRebuild = mForceMapRebuild;
  mForceMapRebuild = false;
  mAnalysisThread = std::thread([this, gen, items = std::move(items), numJobs, forceRebuild]() mutable {
    int processed = 0;
    for (auto& it : items)
    {
      if (!it.needs) continue;
      if (mAnalysisGeneration.load() != gen) return;

      const WavFeatures feat = AnalyzeWav(it.path, &mPreviewCache, it.size);
      AnalysisResult result;
      result.generation = gen;
      result.index = it.index;
      result.name = it.name;
      result.analyzed = true; // attempted; failed decodes stay at centroid 0
      result.durMs = feat.durMs;
      result.centroid = feat.centroid;
      result.rolloff = feat.rolloff;
      result.flatness = feat.flatness;
      result.attack = feat.attack;
      result.decay = feat.decay;
      result.crest = feat.crest;
      result.zcr = feat.zcr;
      result.rms = feat.rms;
      result.peak = feat.peak;
      result.lufs = feat.lufs;
      result.druminess = feat.druminess;
      result.lateTransient = feat.lateTransient;
      result.featureVersion = feat.version;
      result.cls = feat.cls;
      result.clsConf = feat.conf;
      result.fp = feat.fp;
      result.processed = ++processed;
      result.total = numJobs;

      it.ok = feat.ok && feat.centroid > 0 && (int) feat.fp.size() == tu::kFeatSize;
      it.durMs = feat.durMs;
      it.cls = feat.cls;
      it.fp = feat.fp;

      std::lock_guard<std::mutex> lock(mAnalysisMutex);
      mAnalysisResults.push_back(std::move(result));
    }

    int modelClasses = 0, modelFiles = 0;
    // XO-like map over every analysable file: insert new ones into the stored
    // map, or rebuild (aligned to the previous one) when most are new / asked.
    // Own classifier: learns from the files whose name says the type, labels the rest.
    {
      std::vector<tu::MapItem> ci;
      std::vector<size_t> where;
      std::vector<int> nameCls, ruleCls;
      for (size_t q = 0; q < items.size(); q++)
        if (items[q].ok)
        {
          tu::MapItem m; m.feat = items[q].fp.data(); m.durMs = items[q].durMs; m.cls = 0;
          ci.push_back(m); where.push_back(q);
          nameCls.push_back(tu::DrumClassFromName(items[q].name));
          ruleCls.push_back(items[q].cls);
        }
      if (!ci.empty())
      {
        tu::MapParams cp; cp.wType = 0.; // the model must not see the type it predicts
        auto X = tu::MapFeatureRows(ci, cp);
        for (auto& row : X) row.resize(row.size() - tu::kNumClasses);
        if (mAnalysisGeneration.load() != gen) return;
        const auto R = tu::ClassifyLibrary(X, nameCls, ruleCls);
        for (size_t q = 0; q < where.size(); q++) items[where[q]].cls = R.cls[q];
        modelClasses = R.learnedClasses; modelFiles = R.trainingFiles;
      }
    }

    std::vector<tu::MapItem> mi;
    AnalysisResult map;
    map.generation = gen;
    map.isMap = true;
    map.modelClasses = modelClasses; map.modelFiles = modelFiles;
    for (const auto& it : items)
      if (it.ok)
      {
        map.mapCls.push_back(it.cls);
        tu::MapItem m;
        m.feat = it.fp.data();
        m.durMs = it.durMs;
        m.cls = it.cls;
        m.prevX = it.mx; m.prevY = it.my;
        mi.push_back(m);
        map.mapIndex.push_back(it.index);
      }
    if (!mi.empty())
    {
      tu::MapParams P;
      P.forceRebuild = forceRebuild;
      map.mapPts = tu::ComputeSampleMap(mi, P, &mAnalysisCancel);
      if (map.mapPts.size() != mi.size()) return; // cancelled
      std::lock_guard<std::mutex> lock(mAnalysisMutex);
      mAnalysisResults.push_back(std::move(map));
    }

    AnalysisResult done;
    done.generation = gen;
    done.done = true;
    done.processed = processed;
    done.total = numJobs;
    std::lock_guard<std::mutex> lock(mAnalysisMutex);
    mAnalysisResults.push_back(std::move(done));
  });
}

void DrumReplacer::StopLibraryAnalysis()
{
  ++mAnalysisGeneration;
  mAnalysisCancel = true;
  if (mAnalysisThread.joinable())
    mAnalysisThread.join();

  mAnalysisRunning = false;
  {
    std::lock_guard<std::mutex> lock(mAnalysisMutex);
    mAnalysisResults.clear();
  }
}

void DrumReplacer::OnUIClose()
{
  mUIOpen = false;
  SaveLibrarySettings();
}

void DrumReplacer::OnUIOpen()
{
  Plugin::OnUIOpen(); // pushes every param value (SPVFD)
  mUIOpen = true;
  mHitCountSent = mHitCount.load();
#ifdef WEBVIEW_EDITOR_DELEGATE
  SendJSONFromDelegate({{"id", "init"}, {"pro", kIsPro}, {"numSlots", kNumSlots},
                        {"demoInput", BundledFile("SN_TOP_1COMMIT_17-140.wav")},
                        {"demoSample", BundledFile("SNARE.cm.wav")}});
  // Opening the app / plugin never scans or analyses by itself: the cached
  // library is shown as it was. The folders are scanned (and new / changed files
  // analysed) only on RESCAN or when a location is added. The very first time
  // (locations but no cache yet) the folders are listed once.
  if (!mLibraryScanned && !mLibraryRoots.empty() && mLibraryFiles.empty())
    ScanLibraryAndSend();
  else
  {
    SendLibraryToUI();
    const int stale = (int) std::count_if(mLibraryFiles.begin(), mLibraryFiles.end(), [](const LibraryFile& f) { return NeedsAnalysis(f); });
    if (stale > 0)
      SendJSONFromDelegate({{"id", "libraryStale"}, {"count", stale}});
  }
  if (mAnalysisRunning)
    SendJSONFromDelegate({{"id", "analysisStart"}, {"total", mAnalysisTotal.load()}, {"done", mAnalysisDone.load()}});
#endif
  for (int s = 0; s < kNumSlots; s++)
    SendSlotToUI(s);
}

void DrumReplacer::OnParamChange(int paramIdx)
{
  DBGMSG("%s %f\n", GetParam(paramIdx)->GetName(), GetParam(paramIdx)->Value());
}

#if IPLUG_DSP
void DrumReplacer::ProcessMidiMsg(const IMidiMsg& msg)
{
  TRACE;

  if (GetParam(kMidiInEnabled)->Bool()
      && msg.StatusMsg() == IMidiMsg::kNoteOn && msg.Velocity() > 0
      && msg.Channel() + 1 == GetParam(kMidiInChannel)->Int()
      && msg.NoteNumber() == GetParam(kMidiInNote)->Int()
      && mNumHits < kMaxHits)
  {
    mHits[mNumHits++] = {msg.mOffset + GetLatency(), msg.Velocity() / 127.f}; // delayed like the dry signal
  }

  SendMidiMsg(msg); // MIDI thru
}
#endif

