#include "DrumReplacer.h"
#include "IPlug_include_in_plug_src.h"
#include "IPlugPaths.h"
#include "AppAudioSetup.h"
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
  int preCls = -1; // pre-trained model's sure type (-1 = not sure)
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
  // Pre-trained model (ml/, DSP/PretrainedClassifier.h): replaces the rules when it is sure.
  {
    float feat[tu::kFeatSize];
    std::copy(f.fp, f.fp + tu::kFpSize, feat);
    std::copy(f.desc, f.desc + tu::kDescSize, feat + tu::kFpSize);
    double prob = 0.;
    const int cls = tu::PretrainedOrRules(feat, f.durMs, f.cls, &prob);
    if (prob > 0.) { out.cls = cls; out.conf = prob; out.preCls = cls; }
  }
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
  GetParam(kMix)->InitPercentage("Mix", 100.); // starts on the triggered samples

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
  for (int s = 0; s < kNumSlots; s++) // v3: the slot's shape (SAMPLE ENVELOPE / TONE / PHASE / mode)
    chunk.PutStr(mSlotShapeJson[s].c_str());

  return SerializeParams(chunk);
}

int DrumReplacer::UnserializeState(const IByteChunk& chunk, int startPos)
{
  int version = 0;
  startPos = chunk.Get(&version, startPos);
  if (startPos < 0 || (version != 2 && version != kStateVersion))
    return -1;

  startPos = chunk.GetStr(mBaseDir, startPos);
  startPos = chunk.GetStr(mPresetName, startPos);
  for (int s = 0; s < kNumSlots && startPos >= 0; s++)
    startPos = chunk.GetStr(mSlotPaths[s], startPos);
  WDL_String shapes[kNumSlots];
  if (version >= 3)
    for (int s = 0; s < kNumSlots && startPos >= 0; s++)
      startPos = chunk.GetStr(shapes[s], startPos);
  if (startPos < 0)
    return -1;
  for (int s = 0; s < kNumSlots; s++)
  {
    mSlotShapeJson[s] = shapes[s].Get();
    mSlotShape[s] = tu::SlotShape();
    if (!mSlotShapeJson[s].empty()) ApplySlotShapeJSON(s, mSlotShapeJson[s]); // re-rendered by LoadSlot below
  }

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
    mSlotSource[slot].reset(pData);
  }
  else
  {
    delete pData;
    mSlotSource[slot].reset();
  }
  mSlotOk[slot] = ok;
  RenderSlotNow(slot);
  return ok;
}

// The voices play the sample with the slot's shape baked in (DSP/SlotShape.h).
void DrumReplacer::RenderSlotNow(int slot)
{
  if (slot < 0 || slot >= kNumSlots) return;
  if (!mSlotSource[slot]) { mSlots[slot].SetSample(new SampleData); return; } // empty clears the slot
  mSlots[slot].SetSample(tu::RenderShapedSample(*mSlotSource[slot], mSlotShape[slot]), mContinueOnRender);
}

bool DrumReplacer::ApplySlotShapeJSON(int slot, const std::string& json)
{
  if (slot < 0 || slot >= kNumSlots) return false;
  const auto j = nlohmann::json::parse(json, nullptr, false);
  if (j.is_discarded() || !j.is_object()) return false;
  auto num = [&](const char* k, double def) {
    const auto it = j.find(k);
    return (it != j.end() && it->is_number() && std::isfinite(it->get<double>())) ? it->get<double>() : def;
  };
  auto flag = [&](const char* k) { const auto it = j.find(k); return it != j.end() && ((it->is_boolean() && it->get<bool>()) || (it->is_number() && it->get<double>() != 0)); };
  tu::SlotShape sh;
  sh.valid = true;
  if (j.contains("path") && j["path"].is_string()) sh.path = j["path"].get<std::string>();
  sh.start = std::clamp(num("start", 0.), 0., 1.);
  sh.end = std::clamp(num("end", 1.), 0., 1.);
  sh.reverse = flag("reverse");
  sh.tune = std::clamp(num("tune", 0.), -48., 48.);
  sh.cut = std::clamp(num("cut", 100.), 0., 100.);
  sh.tone = std::clamp(num("tone", 0.), -100., 100.);
  sh.gainDb = std::clamp(num("gain", 0.), -70., 12.);
  sh.fadeInMs = std::max(0., num("fadeIn", 0.));
  sh.fadeOutMs = std::max(0., num("fadeOut", 0.));
  sh.polarity = flag("pol");
  sh.offsetMs = std::clamp(num("offset", 0.), -tu::kLookMs, 50.);
  sh.mode = (int) num("mode", 0.) == 1 ? 1 : 0;
  sh.durMs = std::max(0., num("dur", 0.));
  if (j.contains("env") && j["env"].is_array())
    for (const auto& p : j["env"])
      if (p.is_array() && p.size() >= 2 && p[0].is_number() && p[1].is_number())
        sh.env.push_back({std::max(0., p[0].get<double>()), std::clamp(p[1].get<double>(), 0., 1.)});
  if (sh.env.size() < 2) sh.env = {{0., 0.}, {0.001, 1.}, {1e7, 1.}};
  const bool audioChanged = !sh.SameAudio(mSlotShape[slot]);
  mSlotMode[slot].store(sh.mode);
  mSlotShape[slot] = std::move(sh);
  mSlotShapeJson[slot] = json;
  if (audioChanged)
  {
    mContinueOnRender = true; // an edit: the ringing hits move to the new sound (real time)
    RenderSlotNow(slot);
    mContinueOnRender = false;
  }
  return true;
}

void DrumReplacer::OnIdle()
{
  for (auto& slot : mSlots)
    slot.CollectGarbage();
  mPreview.CollectGarbage();
  mInputPlayer.CollectGarbage();

#ifdef WEBVIEW_EDITOR_DELEGATE
  if (mUIOpen)
  {
    const float outPk = mOutPeak.exchange(0.f);
    nlohmann::json sl = nlohmann::json::array();
    for (int k = 0; k < kNumSlots; k++) sl.push_back(std::round(std::min(mSlotPeak[k].exchange(0.f), 4.f) * 10000.f) / 10000.f);
    SendJSONFromDelegate({{"id", "outmeter"}, {"peak", std::round(std::min(outPk, 4.f) * 10000.f) / 10000.f}, {"slots", sl},
                          {"gate", std::round(mGateNow.load() * 1000.f) / 1000.f}, {"gateOn", GetParam(kGateEnabled)->Bool()}});
    const uint32_t from = mInputMeter.Drain(mMeterPeaks, mMeterHits);
    if (!mMeterPeaks.empty())
    {
      nlohmann::json pk = nlohmann::json::array(), hk = nlohmann::json::array();
      for (float v : mMeterPeaks) pk.push_back(std::round(std::min(v, 4.f) * 10000.f) / 10000.f);
      for (const auto& hm : mMeterHits) hk.push_back({hm.bin, std::round(hm.velocity * 1000.f) / 1000.f});
      SendJSONFromDelegate({{"id", "inmeter"}, {"from", from}, {"peaks", pk}, {"hits", hk}});
    }
  }
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
          if (k < r.mapPre.size()) { lf.preCls = r.mapPre[k]; lf.preModel = tu::pretrained::kModelId; }
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
        f.preCls = r.preCls;
        f.preModel = tu::pretrained::kModelId;
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

  // 1. INPUT GATE, first of all (like the prototype's worklet): it cleans the input
  //    before the detector and the dry signal. Level after INPUT gain, 4 dB
  //    hysteresis, HOLD, ATTACK / RELEASE; it looks 1 ms ahead (the input is
  //    delayed 1 ms, part of the plugin latency) so ATTACK 0 keeps the transient.
  //    GATE off = gain 1 (8 ms glide when it is switched).
  mInGate.SetParams(mGateTh.load(), mGateAtk.load(), mGateHold.load(), mGateRel.load());
  const double gateTarget = GetParam(kGateEnabled)->Bool() ? 1. : 0.;
  const double gateStep = 1. / std::max(1., 0.008 * sr);
  const int lookN = (int) mGateLook[0].size();
  double gateLast = 1.;
  for (int i = 0; i < nFrames; i++)
  {
    const double c = mInGate.Process(std::fabs((inL[i] + inR[i]) * 0.5 * inGain));
    if (mGateEn < gateTarget) mGateEn = std::min(gateTarget, mGateEn + gateStep);
    else if (mGateEn > gateTarget) mGateEn = std::max(gateTarget, mGateEn - gateStep);
    const double g = 1. - mGateEn * (1. - c);
    sample xl = inL[i], xr = inR[i];
    if (lookN > 0)
    {
      std::swap(xl, mGateLook[0][(size_t) mGateLookPos]);
      std::swap(xr, mGateLook[1][(size_t) mGateLookPos]);
      if (++mGateLookPos >= lookN) mGateLookPos = 0;
    }
    inL[i] = xl * g;
    inR[i] = xr * g;
    gateLast = g;
  }
  mGateNow.store((float) gateLast, std::memory_order_relaxed); // gate LED / GR meter

  // 2. Detect (on the gated input). Hits come out at the end of the detector's peak
  //    window, which is exactly when the delayed dry signal reaches the onset.
  mDetector.SetParams(GetParam(kSensitivity)->Value(), GetParam(kRetrigger)->Value(),
                      GetParam(kDetail)->Value(), GetParam(kLowCut)->Value(),
                      GetParam(kHighCut)->Value(), GetParam(kSuppression)->Value());
  mInputMeter.Push(inL, inR, nFrames, inGain); // live INPUT for the TRIGGER view (what the detector sees)
  const int detLatency = mDetector.LatencySamples();
  mDetector.Process(inL, inR, nFrames, inGain, [&](int offset, float velocity, int lead) {
    if (mNumHits < kMaxHits) mHits[mNumHits++] = {offset, velocity, lead};
    mInputMeter.MarkHit(nFrames - offset + detLatency + lead, velocity); // at the real onset
  });

  // 2. Take the hits due in this block; keep the rest for later blocks.
  Hit due[kMaxHits];
  int numDue = 0, numKept = 0;
  for (int h = 0; h < mNumHits; h++)
  {
    if (mHits[h].countdown < nFrames)
      due[numDue++] = mHits[h];
    else
      mHits[numKept++] = {mHits[h].countdown - nFrames, mHits[h].velocity, mHits[h].lead};
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
    if (mAudition[s].exchange(false, std::memory_order_acq_rel))
      slot.Trigger(0, 1.f); // audition: full level, through the fader / pan / MIX like a hit
    for (int h = 0; h < numDue; h++)
      slot.Trigger(due[h].countdown, TriggerGain(due[h].velocity, sens, velAmount), due[h].lead, sr);

    const bool audible = !GetParam(SlotParam(s, kSlotMute))->Bool()
                      && (!anySolo || GetParam(SlotParam(s, kSlotSolo))->Bool());
    if (!audible) continue; // voices keep their place, just silent this block

    VoiceParams p;
    // polarity and TUNE are baked into the slot's sample (SlotShape), with the
    // envelope, tone and offset; per hit only level, pan and velocity remain
    const float vol = (float) GetParam(SlotParam(s, kSlotVol))->DBToAmp();
    const double pan = GetParam(SlotParam(s, kSlotPan))->Value() / 100.; // -1..1, equal power, unity at center
    p.gainL = vol * (float) (std::cos((pan + 1.) * M_PI / 4.) * M_SQRT2);
    p.gainR = vol * (float) (std::sin((pan + 1.) * M_PI / 4.) * M_SQRT2);
    p.ratio = slot.SampleRate() / sr;
    p.attackSamples = 0.;  // the SAMPLE ENVELOPE does attack / decay / release
    p.sustainFrac = 1.;
    p.releaseSamples = 0.;
    float* tL = mTmp[0].data();
    float* tR = mTmp[1].data();
    std::fill(tL, tL + nFrames, 0.f);
    std::fill(tR, tR + nFrames, 0.f);
    slot.Render(tL, tR, nFrames, p);
    float pk = 0.f;
    for (int i = 0; i < nFrames; i++)
    {
      const float l = tL[i], r = tR[i];
      wetL[i] += l; wetR[i] += r;
      pk = std::max(pk, std::max(std::fabs(l), std::fabs(r)));
    }
    if (pk > mSlotPeak[s].load(std::memory_order_relaxed)) mSlotPeak[s].store(pk, std::memory_order_relaxed); // fader VU
  }

  // 5. Delayed dry (already through the INPUT GATE) + wet mix, output gain
  const sample outGain = GetParam(kOutputGain)->DBToAmp();
  const sample mix = GetParam(kMix)->Value() / 100.;
  const int delayLen = (int) mDelay[0].size();
  for (int i = 0; i < nFrames; i++)
  {
    const sample dryL = mDelay[0][mDelayPos], dryR = mDelay[1][mDelayPos];
    mDelay[0][mDelayPos] = inL[i];
    mDelay[1][mDelayPos] = inR[i];
    if (++mDelayPos == delayLen) mDelayPos = 0;

    const sample g = mInGainSmooth.Process(inGain);
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
  float outPk = 0.f;
  for (int i = 0; i < nFrames; i++)
  {
    outputs[0][i] += prevL[i];
    outputs[1][i] += prevR[i];
    outPk = std::max(outPk, (float) std::max(std::fabs(outputs[0][i]), std::fabs(outputs[1][i])));
  }
  if (outPk > mOutPeak.load(std::memory_order_relaxed)) mOutPeak.store(outPk, std::memory_order_relaxed); // OUTPUT meter
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
  mInputMeter.Reset(sr);
  // dry delay = detector window + kLookMs (room for a negative OFFSET: every
  // shaped sample starts with kLookMs + OFFSET of silence, see SlotShape.h)
  const int look = (int) std::lround(tu::kLookMs * 0.001 * sr);
  const int gateLook = (int) std::lround(0.001 * sr); // INPUT GATE sees 1 ms ahead
  const int dryDelay = mDetector.LatencySamples() + look;
  for (auto& d : mDelay)
    d.assign(dryDelay, 0.);
  const int latency = dryDelay + gateLook; // reported to the host
  mInGate.Reset(sr);
  for (auto& g : mGateLook)
    g.assign((size_t) gateLook, 0.);
  mGateLookPos = 0;
  mGateEn = GetParam(kGateEnabled)->Bool() ? 1. : 0.;
  for (auto& w : mTmp)
    w.assign((size_t) GetBlockSize(), 0.f);
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

  if (msgTag == kMsgTagSlotShape)
  {
    if (ctrlTag >= 0 && ctrlTag < kNumSlots && pData && dataSize > 0)
      ApplySlotShapeJSON(ctrlTag, std::string((const char*) pData, (size_t) dataSize));
    return true;
  }

  if (msgTag == kMsgTagGateParams)
  {
    if (pData && dataSize > 0)
    {
      const auto j = nlohmann::json::parse(std::string((const char*) pData, (size_t) dataSize), nullptr, false);
      auto num = [&](const char* k, double def) {
        const auto it = j.find(k);
        return (!j.is_discarded() && it != j.end() && it->is_number()) ? it->get<double>() : def;
      };
      if (!j.is_discarded())
      {
        mGateTh.store(std::clamp(num("th", -24.), -80., 0.));
        mGateAtk.store(std::clamp(num("atk", 0.5), 0., 500.));
        mGateHold.store(std::clamp(num("hold", 30.), 0., 2000.));
        mGateRel.store(std::clamp(num("rel", 150.), 0., 5000.));
      }
    }
    return true;
  }

  if (msgTag == kMsgTagAudioGet)
  {
    SendAudioSetupToUI();
    return true;
  }

  if (msgTag == kMsgTagAudioSet)
  {
    if (pData && dataSize > 0)
      TUAppApplyAudio(std::string((const char*) pData, (size_t) dataSize));
    SendAudioSetupToUI();
    return true;
  }

  if (msgTag == kMsgTagMidiIn)
  {
    TUAppApplyMidiIn(pData && dataSize > 0 ? std::string((const char*) pData, (size_t) dataSize) : std::string("off"));
    SendAudioSetupToUI();
    return true;
  }

  if (msgTag == kMsgTagAudioTest)
  {
    // Test tone: three short 660 Hz beeps on both sides, through the preview path
    // (independent of MIX / OUTPUT), like the Test button of an audio setup.
    const double sr = 48000.;
    auto* pTone = new SampleData;
    pTone->numChannels = 2;
    pTone->sampleRate = sr;
    const int n = (int) (0.75 * sr);
    for (auto& c : pTone->ch) c.assign((size_t) n, 0.f);
    for (int i = 0; i < n; i++)
    {
      const double t = i / sr, local = std::fmod(t, 0.25);
      const double env = local < 0.15 ? std::min(1., std::min(local, 0.15 - local) / 0.01) : 0.;
      const float v = (float) (0.5 * env * std::sin(2. * M_PI * 660. * t));
      pTone->ch[0][(size_t) i] = pTone->ch[1][(size_t) i] = v;
    }
    pTone->numFrames = n;
    mPreview.SetSample(pTone);
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
  if (msgTag == kMsgTagAuditionSlot)
  {
    if (ctrlTag >= 0 && ctrlTag < kNumSlots) mAudition[ctrlTag].store(true, std::memory_order_release);
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

  // Tolerant reader: a value that is null / of another type (a NaN is saved as
  // null by the JSON writer) or one broken entry must never stop the app from
  // opening; that entry gets defaults (and is re-analysed on the next RESCAN).
  auto num = [](const nlohmann::json& o, const char* k, double def) {
    const auto it = o.find(k);
    if (it == o.end() || !it->is_number()) return def;
    const double v = it->get<double>();
    return std::isfinite(v) ? v : def;
  };
  auto str = [](const nlohmann::json& o, const char* k) {
    const auto it = o.find(k);
    return (it != o.end() && it->is_string()) ? it->get<std::string>() : std::string();
  };
  if (j.contains("files") && j["files"].is_array())
  {
    for (const auto& f : j["files"])
    {
      if (!f.is_object()) continue;
      try
      {
        LibraryFile lf;
        lf.root = (int) num(f, "root", 0);
        lf.path = str(f, "path");
        lf.name = str(f, "name");
        lf.rel = str(f, "rel");
        lf.size = (long long) num(f, "size", 0);
        lf.durMs = num(f, "dur", 0);
        lf.sampleRate = (int) num(f, "sr", 0);
        lf.channels = (int) num(f, "ch", 0);
        lf.centroidHz = num(f, "centroid", 0);
        lf.rolloffHz = num(f, "rolloff", 0);
        lf.flatness = num(f, "flatness", 0);
        lf.attackMs = num(f, "attack", 0);
        lf.decayMs = num(f, "decay", 0);
        lf.crest = num(f, "crest", 0);
        lf.zcr = num(f, "zcr", 0);
        lf.rms = num(f, "rms", 0);
        lf.peak = num(f, "peak", 0);
        lf.lufs = num(f, "lufs", -70);
        lf.druminess = num(f, "drum", 0);
        lf.lateTransient = num(f, "late", 0);
        if (f.contains("e") && f["e"].is_array() && f["e"].size() == 4)
          for (int k = 0; k < 4; k++)
          {
            const auto& v = f["e"][(size_t) k];
            lf.emb[k] = (v.is_number() && std::isfinite(v.get<double>())) ? v.get<float>() : 0.f;
          }
        lf.featureVersion = (int) num(f, "v", 0);
        lf.analyzed = f.contains("analyzed") && f["analyzed"].is_boolean() && f["analyzed"].get<bool>();
        lf.cls = (int) num(f, "cls", -1);
        if (lf.cls < -1 || lf.cls >= tu::kNumClasses) lf.cls = -1;
        lf.clsConf = num(f, "conf", 0);
        lf.preCls = (int) num(f, "pc", -1);
        if (lf.preCls < -1 || lf.preCls >= tu::kNumClasses) lf.preCls = -1;
        lf.preModel = (uint32_t) num(f, "pm", 0);
        lf.mapX = (float) num(f, "mx", -1);
        lf.mapY = (float) num(f, "my", -1);
        if (f.contains("fp") && f["fp"].is_array() && f["fp"].size() == (size_t) tu::kFeatSize)
        {
          bool good = true;
          std::vector<float> fp;
          fp.reserve((size_t) tu::kFeatSize);
          for (const auto& v : f["fp"])
          {
            if (!v.is_number() || !std::isfinite(v.get<double>())) { good = false; break; }
            fp.push_back(v.get<float>());
          }
          if (good) lf.fp = std::move(fp);
          else lf.featureVersion = 0; // broken fingerprint: analyse again on RESCAN
        }
        if (!lf.path.empty())
          mLibraryFiles.push_back(std::move(lf));
      }
      catch (...) { /* skip a broken entry */ }
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
    // never write NaN / inf: JSON stores them as null (see the tolerant reader)
    auto fin = [](double v, double def) { return std::isfinite(v) ? v : def; };
    nlohmann::json e = {{"root", f.root}, {"path", f.path}, {"name", f.name},
                        {"rel", f.rel}, {"size", f.size}, {"dur", fin(f.durMs, 0)},
                        {"sr", f.sampleRate}, {"ch", f.channels},
                        {"centroid", fin(f.centroidHz, 0)}, {"rolloff", fin(f.rolloffHz, 0)},
                        {"flatness", fin(f.flatness, 0)}, {"attack", fin(f.attackMs, 0)},
                        {"decay", fin(f.decayMs, 0)}, {"crest", fin(f.crest, 0)},
                        {"zcr", fin(f.zcr, 0)}, {"rms", fin(f.rms, 0)}, {"peak", fin(f.peak, 0)},
                        {"lufs", fin(f.lufs, -70)}, {"drum", fin(f.druminess, 0)}, {"late", fin(f.lateTransient, 0)},
                        {"e", {fin(f.emb[0], 0), fin(f.emb[1], 0), fin(f.emb[2], 0), fin(f.emb[3], 0)}},
                        {"v", f.featureVersion}, {"analyzed", f.analyzed},
                        {"cls", f.cls}, {"conf", fin(f.clsConf, 0)}, {"mx", fin(f.mapX, -1)}, {"my", fin(f.mapY, -1)},
                        {"pc", f.preCls}, {"pm", f.preModel}};
    if ((int) f.fp.size() == tu::kFeatSize)
    {
      nlohmann::json fp = nlohmann::json::array();
      bool good = true;
      for (float v : f.fp) { if (!std::isfinite(v)) { good = false; break; } fp.push_back(std::round(v * 1000.f) / 1000.f); } // 3 decimals: smaller file
      if (good) e["fp"] = fp;
    }
    j["files"].push_back(std::move(e));
  }

  // Written to a temp file and renamed: a crash while saving can't leave a
  // half-written library. Invalid UTF-8 in a file name is replaced, not thrown.
  std::string text;
  try { text = j.dump(-1, ' ', false, nlohmann::json::error_handler_t::replace); } catch (...) { return; }
  const std::string tmp = path + ".tmp";
  {
    std::ofstream out(tmp, std::ios::binary | std::ios::trunc);
    if (!out) return;
    out << text;
    if (!out) return;
  }
  std::filesystem::rename(tmp, path, ec);
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

  struct Item { int index; std::string path; std::string name; bool needs; bool ok; double durMs; int cls; std::vector<float> fp; float mx, my; long long size; int preCls; uint32_t preModel; };
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
    items.push_back({(int) i, f.path, f.name, needs, ok, f.durMs, f.cls, f.fp, needs ? -1.f : f.mapX, needs ? -1.f : f.mapY, f.size,
                     f.preCls, needs ? 0u : f.preModel});
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
   try {
    int processed = 0;
    for (auto& it : items)
    {
      if (!it.needs) continue;
      if (mAnalysisGeneration.load() != gen) return;

      WavFeatures feat;
      try { feat = AnalyzeWav(it.path, &mPreviewCache, it.size); } catch (...) { /* unreadable file: stays off the map */ }
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
      result.preCls = feat.preCls;
      result.fp = feat.fp;
      result.processed = ++processed;
      result.total = numJobs;

      it.ok = feat.ok && feat.centroid > 0 && (int) feat.fp.size() == tu::kFeatSize;
      it.durMs = feat.durMs;
      it.cls = feat.cls;
      it.preCls = feat.preCls;
      it.preModel = tu::pretrained::kModelId;
      it.fp = feat.fp;

      std::lock_guard<std::mutex> lock(mAnalysisMutex);
      mAnalysisResults.push_back(std::move(result));
    }

    int modelClasses = 0, modelFiles = 0;
    // XO-like map over every analysable file: insert new ones into the stored
    // map, or rebuild (aligned to the previous one) when most are new / asked.
    // Own classifier: learns from the files whose name says the type, labels the rest.
    {
      // Pre-trained model: only for files whose stored result is from another model (or
      // none: libraries analysed before it existed). Stored per file afterwards, so the
      // next passes cost nothing. Spread over the cores.
      {
        std::vector<size_t> todo;
        for (size_t q = 0; q < items.size(); q++)
          if (items[q].ok && items[q].preModel != tu::pretrained::kModelId)
          {
            if ((int) items[q].fp.size() == tu::kFeatSize) todo.push_back(q);
            else { items[q].preCls = -1; items[q].preModel = tu::pretrained::kModelId; }
          }
        const unsigned nt = std::max(1u, std::min(16u, std::thread::hardware_concurrency()));
        std::vector<std::thread> pool;
        for (unsigned t = 0; t < nt && t < todo.size(); t++)
          pool.emplace_back([&items, &todo, t, nt] {
            for (size_t j = t; j < todo.size(); j += nt)
            {
              auto& it = items[todo[j]];
              it.preCls = tu::PretrainedSureClass(it.fp.data(), it.durMs);
              it.preModel = tu::pretrained::kModelId;
            }
          });
        for (auto& th : pool) th.join();
      }
      std::vector<tu::MapItem> ci;
      std::vector<size_t> where;
      std::vector<int> nameCls, ruleCls;
      for (size_t q = 0; q < items.size(); q++)
        if (items[q].ok)
        {
          tu::MapItem m; m.feat = items[q].fp.data(); m.durMs = items[q].durMs; m.cls = 0;
          ci.push_back(m); where.push_back(q);
          nameCls.push_back(tu::DrumClassFromName(items[q].name));
          // the pre-trained model's type when it is sure, else the stored rules / last type
          ruleCls.push_back(items[q].preCls >= 0 ? items[q].preCls : items[q].cls);
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
        map.mapPre.push_back(it.preCls);
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
   }
   catch (...)
   {
     // An exception here (out of memory on a huge map, a library bug) used to
     // terminate the whole app. Now the analysis just ends; the UI is told it is done.
     AnalysisResult done;
     done.generation = gen;
     done.done = true;
     std::lock_guard<std::mutex> lock(mAnalysisMutex);
     mAnalysisResults.push_back(std::move(done));
   }
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

void DrumReplacer::SendAudioSetupToUI()
{
#ifdef WEBVIEW_EDITOR_DELEGATE
  const std::string j = TUAppAudioStateJSON();
  if (!j.empty())
  {
    const auto parsed = nlohmann::json::parse(j, nullptr, false);
    if (!parsed.is_discarded())
      SendJSONFromDelegate(parsed);
  }
#endif
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
#if defined(APP_API)
  const char* hostKind = "app";    // standalone: own audio device (AUDIO / MIDI SETUP)
#else
  const char* hostKind = "plugin"; // AU / VST: the input is the DAW track, no audio device
#endif
  SendJSONFromDelegate({{"id", "init"}, {"pro", kIsPro}, {"numSlots", kNumSlots}, {"host", hostKind},
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
  SendAudioSetupToUI(); // standalone: the UI opens AUDIO SETUP by itself if audio is not running
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
    mHits[mNumHits++] = {msg.mOffset + GetLatency(), msg.Velocity() / 127.f, 0}; // delayed like the dry signal
  }

  SendMidiMsg(msg); // MIDI thru
}
#endif

