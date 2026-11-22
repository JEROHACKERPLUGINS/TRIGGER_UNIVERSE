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
  int version = 2;
  bool ok = false;
};

static WavFeatures AnalyzeWav(const std::string& path)
{
  WavFeatures out;
  std::vector<std::vector<float>> channels;
  double sr = 0;
  if (!LoadWavFile(path, channels, sr) || channels.empty() || sr <= 0)
    return out;

  const size_t frames = channels[0].size();
  if (!frames)
    return out;

  out.durMs = (double) frames / sr * 1000.0;

  const size_t n = std::min(frames, (size_t) std::max(1.0, sr * 5.0));
  const int nch = (int) channels.size();
  std::vector<float> mono(n, 0.f);
  for (int c = 0; c < nch; ++c)
  {
    const auto& src = channels[(size_t) c];
    const size_t m = std::min(n, src.size());
    for (size_t i = 0; i < m; ++i)
      mono[i] += src[i] / (float) nch;
  }

  double peak = 0, sum = 0;
  for (size_t i = 0; i < n; ++i)
  {
    const double a = std::abs(mono[i]);
    if (a > peak) peak = a;
    sum += (double) mono[i] * mono[i];
  }
  out.peak = peak;
  out.rms = std::sqrt(sum / (double) std::max<size_t>(1, n));
  out.crest = out.rms > 1e-9 ? out.peak / out.rms : 0;

  const size_t zcN = std::min(n, (size_t) std::max(1.0, sr * 2.0));
  int crossings = 0;
  for (size_t i = 1; i < zcN; ++i)
    if ((mono[i] >= 0.f) != (mono[i - 1] >= 0.f))
      ++crossings;
  out.zcr = zcN > 1 ? (double) crossings / ((double) zcN / sr) : 0;

  const size_t block = std::max<size_t>(1, (size_t)(sr * 0.001));
  const size_t blocks = n / block;
  if (blocks)
  {
    std::vector<float> env(blocks, 0.f);
    for (size_t b = 0; b < blocks; ++b)
    {
      float p = 0.f;
      for (size_t i = 0; i < block; ++i)
        p = std::max(p, std::abs(mono[b * block + i]));
      env[b] = p;
    }
    size_t peakIdx = 0;
    for (size_t b = 1; b < blocks; ++b)
      if (env[b] > env[peakIdx]) peakIdx = b;
    const float thr = env[peakIdx] * 0.1f;
    size_t start = peakIdx;
    while (start > 0 && env[start - 1] > thr) --start;
    size_t end = peakIdx;
    while (end + 1 < blocks && env[end + 1] > thr) ++end;
    const double blockMs = 1000.0 * (double) block / sr;
    out.attack = (double)(peakIdx - start) * blockMs;
    out.decay = (double)(end - peakIdx) * blockMs;
  }

  const int N = 2048;
  const size_t search = std::min(n, (size_t) std::max(1.0, sr * 2.0));
  size_t best = 0;
  double bestEnergy = -1;
  for (size_t start = 0; start + (size_t) N <= search; start += N / 2)
  {
    double e = 0;
    for (int i = 0; i < N; ++i)
      e += (double) mono[start + i] * mono[start + i];
    if (e > bestEnergy) { bestEnergy = e; best = start; }
  }
  if (bestEnergy <= 0)
    best = 0;

  std::vector<WDL_FFT_REAL> buf((size_t) N, 0);
  constexpr double kPi = 3.14159265358979323846;
  for (int i = 0; i < N; ++i)
  {
    const double w = 0.5 - 0.5 * std::cos(2.0 * kPi * i / (N - 1));
    buf[(size_t) i] = (best + (size_t) i < n)
      ? (WDL_FFT_REAL)(mono[best + (size_t) i] * w) : 0;
  }

  WDL_real_fft(buf.data(), N, 0);

  double num = 0, den = 0, sumLog = 0;
  int bins = 0;
  std::vector<double> mags((size_t) N / 2, 0.0);
  for (int i = 1; i < N / 2; ++i)
  {
    const int idx = WDL_fft_permute(N / 2, i);
    const double re = buf[(size_t) idx * 2];
    const double im = buf[(size_t) idx * 2 + 1];
    const double mag = std::sqrt(re * re + im * im);
    mags[(size_t) i] = mag;
    const double f = (double) i * sr / (double) N;
    num += f * mag;
    den += mag;
    sumLog += std::log(mag + 1e-12);
    ++bins;
  }

  out.centroid = den > 0 ? num / den : 0;

  double acc = 0;
  const double target = den * 0.85;
  for (int i = 1; i < N / 2; ++i)
  {
    acc += mags[(size_t) i];
    if (acc >= target)
    {
      out.rolloff = (double) i * sr / (double) N;
      break;
    }
  }

  const double geo = bins > 0 ? std::exp(sumLog / (double) bins) : 0;
  const double arith = bins > 0 ? den / (double) bins : 0;
  out.flatness = arith > 1e-12 ? geo / arith : 0;

  out.ok = true;
  out.version = 2;
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
  GetParam(kSensitivity)->InitPercentage("Sensitivity", 45.); // ~-30 dBFS: real kit tracks fire on bleed below that
  GetParam(kRetrigger)->InitMilliseconds("Retrigger", 50., 0., 1000.);
  GetParam(kDetail)->InitPercentage("Detail", 50.);
  GetParam(kDetectorMode)->InitInt("Mode", 0, 0, 3); // ponytail: unused until we know what the original modes do
  GetParam(kLowCut)->InitFrequency("Low Cut", 30., 20., 20000.);
  GetParam(kHighCut)->InitFrequency("High Cut", 15000., 20., 20000.);
  GetParam(kSuppression)->InitPercentage("Suppression", 50.);

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

#ifdef WEBVIEW_EDITOR_DELEGATE
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

      if (r.index >= 0 && r.index < (int) mLibraryFiles.size())
      {
        auto& f = mLibraryFiles[(size_t) r.index];
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
                              {"v", r.featureVersion}, {"analyzed", r.analyzed},
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

  // 1. Detect. Hits come out at the end of the detector's peak window, which is exactly
  //    when the delayed dry signal reaches the onset, so they fire right away.
  mDetector.SetParams(GetParam(kSensitivity)->Value(), GetParam(kRetrigger)->Value(),
                      GetParam(kDetail)->Value(), GetParam(kLowCut)->Value(),
                      GetParam(kHighCut)->Value(), GetParam(kSuppression)->Value());
  mDetector.Process(inputs[0], inputs[1], nFrames, inGain, [&](int offset, float velocity) {
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
    const double veloCurve = GetParam(SlotParam(s, kSlotVeloCurve))->Value();
    const double dynCurve = GetParam(SlotParam(s, kSlotDynCurve))->Value();
    for (int h = 0; h < numDue; h++)
      slot.Trigger(due[h].countdown, ShapeVelocity(due[h].velocity, veloCurve, dynCurve));

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
    mDelay[0][mDelayPos] = inputs[0][i];
    mDelay[1][mDelayPos] = inputs[1][i];
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
      lf.featureVersion = f.value("v", 0);
      lf.analyzed = f.value("analyzed", false);
      if (!lf.path.empty())
        mLibraryFiles.push_back(std::move(lf));
    }
  }
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
  j["files"] = nlohmann::json::array();
  for (const auto& f : mLibraryFiles)
    j["files"].push_back({{"root", f.root}, {"path", f.path}, {"name", f.name},
                          {"rel", f.rel}, {"size", f.size}, {"dur", f.durMs},
                          {"sr", f.sampleRate}, {"ch", f.channels},
                          {"centroid", f.centroidHz}, {"rolloff", f.rolloffHz},
                          {"flatness", f.flatness}, {"attack", f.attackMs},
                          {"decay", f.decayMs}, {"crest", f.crest},
                          {"zcr", f.zcr}, {"rms", f.rms}, {"peak", f.peak},
                          {"v", f.featureVersion}, {"analyzed", f.analyzed}});

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
        lf.durMs = oit->second.durMs;
        lf.sampleRate = oit->second.sampleRate;
        lf.channels = oit->second.channels;
        lf.centroidHz = oit->second.centroidHz;
        lf.rms = oit->second.rms;
        lf.analyzed = oit->second.analyzed;
      }
      if (!lf.analyzed)
      {
        const WavInfo wi = ReadWavInfo(lf.path);
        lf.durMs = wi.durMs;
        lf.sampleRate = wi.sampleRate;
        lf.channels = wi.channels;
      }

      mLibraryFiles.push_back(std::move(lf));

      if (mLibraryFiles.size() >= 5000)
        break;
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

  nlohmann::json files = nlohmann::json::array();
  for (const auto& f : mLibraryFiles)
    files.push_back({{"root", f.root}, {"path", f.path}, {"name", f.name},
                     {"rel", f.rel}, {"size", f.size}, {"dur", f.durMs},
                     {"sr", f.sampleRate}, {"ch", f.channels},
                     {"centroid", f.centroidHz}, {"rolloff", f.rolloffHz},
                     {"flatness", f.flatness}, {"attack", f.attackMs},
                     {"decay", f.decayMs}, {"crest", f.crest},
                     {"zcr", f.zcr}, {"rms", f.rms}, {"peak", f.peak},
                     {"v", f.featureVersion}, {"analyzed", f.analyzed}});

  SendJSONFromDelegate({{"id", "library"}, {"roots", roots}, {"files", files}});
#endif
}

void DrumReplacer::StartLibraryAnalysis()
{
  StopLibraryAnalysis();

  struct Job { int index; std::string path; std::string name; };
  std::vector<Job> jobs;
  jobs.reserve(mLibraryFiles.size());
  for (size_t i = 0; i < mLibraryFiles.size(); ++i)
  {
    const auto& f = mLibraryFiles[i];
    if (!f.analyzed || f.featureVersion < 2 || f.durMs <= 0 || f.centroidHz <= 0)
      jobs.push_back({(int) i, f.path, f.name});
  }

  mAnalysisTotal = (int) jobs.size();
  mAnalysisDone = 0;

  if (jobs.empty())
  {
#ifdef WEBVIEW_EDITOR_DELEGATE
    if (mUIOpen)
      SendJSONFromDelegate({{"id", "analysisDone"}, {"total", 0}});
#endif
    return;
  }

  const int gen = ++mAnalysisGeneration;
  mAnalysisRunning = true;

#ifdef WEBVIEW_EDITOR_DELEGATE
  if (mUIOpen)
    SendJSONFromDelegate({{"id", "analysisStart"}, {"total", (int) jobs.size()}});
#endif

  mAnalysisThread = std::thread([this, gen, jobs]() {
    static std::once_flag fftOnce;
    std::call_once(fftOnce, []() { WDL_fft_init(); });

    int processed = 0;
    for (const auto& job : jobs)
    {
      if (mAnalysisGeneration.load() != gen)
        return;

      const WavFeatures feat = AnalyzeWav(job.path);
      AnalysisResult result;
      result.generation = gen;
      result.index = job.index;
      result.name = job.name;
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
      result.featureVersion = feat.version;
      result.processed = ++processed;
      result.total = (int) jobs.size();

      {
        std::lock_guard<std::mutex> lock(mAnalysisMutex);
        mAnalysisResults.push_back(std::move(result));
      }
    }

    AnalysisResult done;
    done.generation = gen;
    done.done = true;
    done.processed = processed;
    done.total = (int) jobs.size();
    {
      std::lock_guard<std::mutex> lock(mAnalysisMutex);
      mAnalysisResults.push_back(std::move(done));
    }
  });
}

void DrumReplacer::StopLibraryAnalysis()
{
  ++mAnalysisGeneration;
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
  SendJSONFromDelegate({{"id", "init"}, {"pro", kIsPro}, {"numSlots", kNumSlots}});
  if (!mLibraryScanned && !mLibraryRoots.empty())
  {
    ScanLibraryAndSend();
  }
  else
  {
    SendLibraryToUI();
    const bool needsAnalysis = std::any_of(mLibraryFiles.begin(), mLibraryFiles.end(),
                                           [](const LibraryFile& f) { return !f.analyzed; });
    if (needsAnalysis)
      StartLibraryAnalysis();
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

