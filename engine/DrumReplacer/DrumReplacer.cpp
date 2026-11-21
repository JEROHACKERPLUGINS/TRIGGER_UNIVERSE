#include "DrumReplacer.h"
#include "IPlug_include_in_plug_src.h"
#include "IPlugPaths.h"
#include "DSP/WavFile.h"

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
#endif

DrumReplacer::DrumReplacer(const InstanceInfo& info)
: iplug::Plugin(info, MakeConfig(kNumParams, kNumPresets))
{
  InitParams();

#ifdef WEBVIEW_EDITOR_DELEGATE
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
  GetParam(kMix)->InitPercentage("Mix", 100.);

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

bool DrumReplacer::OnMessage(int msgTag, int ctrlTag, int dataSize, const void* pData)
{
  if (ctrlTag < 0 || ctrlTag >= kNumSlots)
    return false;

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

void DrumReplacer::OnUIOpen()
{
  Plugin::OnUIOpen(); // pushes every param value (SPVFD)
  mUIOpen = true;
  mHitCountSent = mHitCount.load();
#ifdef WEBVIEW_EDITOR_DELEGATE
  SendJSONFromDelegate({{"id", "init"}, {"pro", kIsPro}, {"numSlots", kNumSlots}});
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

