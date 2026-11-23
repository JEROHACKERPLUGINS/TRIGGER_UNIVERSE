/*
 ==============================================================================
 
 This file is part of the iPlug 2 library. Copyright (C) the iPlug 2 developers. 
 
 See LICENSE.txt for  more info.
 
 ==============================================================================
*/

#include "IPlugAPP_host.h"

#ifdef OS_WIN
#include <sys/stat.h>
#include <cstdio>
#include <algorithm>
#include "win32_utf8.h"
#endif

#include "IPlugLogger.h"

using namespace iplug;

#ifndef MAX_PATH_LEN
#define MAX_PATH_LEN 2048
#endif

#define STRBUFSZ 100

std::unique_ptr<IPlugAPPHost> IPlugAPPHost::sInstance;
UINT gSCROLLMSG;

IPlugAPPHost::IPlugAPPHost()
: mIPlug(MakePlug(InstanceInfo{this}))
{
}

IPlugAPPHost::~IPlugAPPHost()
{
  mExiting = true;
  
  CloseAudio();
  
  if (mMidiIn)
    mMidiIn->cancelCallback();

  if (mMidiOut)
    mMidiOut->closePort();
}

//static
IPlugAPPHost* IPlugAPPHost::Create()
{
  sInstance = std::make_unique<IPlugAPPHost>();
  return sInstance.get();
}

bool IPlugAPPHost::Init()
{
  mIPlug->SetHost("standalone", mIPlug->GetPluginVersion(false));
    
  if (!InitState())
    return false;
  
  TryToChangeAudioDriverType(); // will init RTAudio with an API type based on gState->mAudioDriverType
  ProbeAudioIO(); // find out what audio IO devs are available and put their IDs in the global variables gAudioInputDevs / gAudioOutputDevs
  InitMidi(); // creates RTMidiIn and RTMidiOut objects
  ProbeMidiIO(); // find out what midi IO devs are available and put their names in the global variables gMidiInputDevs / gMidiOutputDevs
  SelectMIDIDevice(ERoute::kInput, mState.mMidiInDev.Get());
  SelectMIDIDevice(ERoute::kOutput, mState.mMidiOutDev.Get());
  
  mIPlug->OnParamReset(kReset);
  mIPlug->OnActivate(true);
  
  return true;
}

bool IPlugAPPHost::OpenWindow(HWND pParent)
{
  return mIPlug->OpenWindow(pParent) != nullptr;
}

void IPlugAPPHost::CloseWindow()
{
  mIPlug->CloseWindow();
}

bool IPlugAPPHost::InitState()
{
#if defined OS_WIN
  char strPath[MAX_PATH_LEN];
  SHGetSpecialFolderPathUTF8(NULL, strPath, MAX_PATH_LEN, CSIDL_LOCAL_APPDATA, FALSE);
  mINIPath.SetFormatted(MAX_PATH_LEN, "%s\\%s\\", strPath, BUNDLE_NAME);
#elif defined OS_MAC
  mINIPath.SetFormatted(MAX_PATH_LEN, "%s/Library/Application Support/%s/", getenv("HOME"), BUNDLE_NAME);
#else
  #error NOT IMPLEMENTED
#endif

  struct stat st;

  if (stat(mINIPath.Get(), &st) == 0) // if directory exists
  {
    mINIPath.Append("settings.ini"); // add file name to path

    char buf[STRBUFSZ];
    
    if (stat(mINIPath.Get(), &st) == 0) // if settings file exists read values into state
    {
      DBGMSG("Reading ini file from %s\n", mINIPath.Get());
      
      mState.mAudioDriverType = GetPrivateProfileInt("audio", "driver", 0, mINIPath.Get());

      GetPrivateProfileString("audio", "indev", "Built-in Input", buf, STRBUFSZ, mINIPath.Get()); mState.mAudioInDev.Set(buf);
      GetPrivateProfileString("audio", "outdev", "Built-in Output", buf, STRBUFSZ, mINIPath.Get()); mState.mAudioOutDev.Set(buf);
      // TRIGGER UNIVERSE: an input opens only once the user picked it in AUDIO SETUP
      // (the system default input can be a virtual device that crashes duplex with another output)
      mInputChosen = GetPrivateProfileInt("audio", "inchosen", 0, mINIPath.Get()) != 0;

      //audio
      mState.mAudioInChanL = GetPrivateProfileInt("audio", "in1", 1, mINIPath.Get()); // 1 is first audio input
      mState.mAudioInChanR = GetPrivateProfileInt("audio", "in2", 2, mINIPath.Get());
      mState.mAudioOutChanL = GetPrivateProfileInt("audio", "out1", 1, mINIPath.Get()); // 1 is first audio output
      mState.mAudioOutChanR = GetPrivateProfileInt("audio", "out2", 2, mINIPath.Get());
      //mState.mAudioInIsMono = GetPrivateProfileInt("audio", "monoinput", 0, mINIPath.Get());

      mState.mBufferSize = GetPrivateProfileInt("audio", "buffer", 512, mINIPath.Get());
      mState.mAudioSR = GetPrivateProfileInt("audio", "sr", 44100, mINIPath.Get());

      //midi
      GetPrivateProfileString("midi", "indev", "no input", buf, STRBUFSZ, mINIPath.Get()); mState.mMidiInDev.Set(buf);
      GetPrivateProfileString("midi", "outdev", "no output", buf, STRBUFSZ, mINIPath.Get()); mState.mMidiOutDev.Set(buf);

      mState.mMidiInChan = GetPrivateProfileInt("midi", "inchan", 0, mINIPath.Get()); // 0 is any
      mState.mMidiOutChan = GetPrivateProfileInt("midi", "outchan", 0, mINIPath.Get()); // 1 is first chan
    }

    // if settings file doesn't exist, populate with default values, otherwise overwrite
    UpdateINI();
  }
  else // folder doesn't exist - make folder and make file
  {
#if defined OS_WIN
    // folder doesn't exist - make folder and make file
    CreateDirectory(mINIPath.Get(), NULL);
    mINIPath.Append("settings.ini");
    UpdateINI(); // will write file if doesn't exist
#elif defined OS_MAC
    mode_t process_mask = umask(0);
    int result_code = mkdir(mINIPath.Get(), S_IRWXU | S_IRWXG | S_IRWXO);
    umask(process_mask);

    if (!result_code)
    {
      mINIPath.Append("settings.ini");
      UpdateINI(); // will write file if doesn't exist
    }
    else
    {
      return false;
    }
#else
  #error NOT IMPLEMENTED
#endif
  }

  return true;
}

void IPlugAPPHost::UpdateINI()
{
  char buf[STRBUFSZ]; // temp buffer for writing integers to profile strings
  const char* ini = mINIPath.Get();

  sprintf(buf, "%u", mState.mAudioDriverType);
  WritePrivateProfileString("audio", "driver", buf, ini);

  WritePrivateProfileString("audio", "indev", mState.mAudioInDev.Get(), ini);
  WritePrivateProfileString("audio", "outdev", mState.mAudioOutDev.Get(), ini);
  WritePrivateProfileString("audio", "inchosen", mInputChosen ? "1" : "0", ini);

  sprintf(buf, "%u", mState.mAudioInChanL);
  WritePrivateProfileString("audio", "in1", buf, ini);
  sprintf(buf, "%u", mState.mAudioInChanR);
  WritePrivateProfileString("audio", "in2", buf, ini);
  sprintf(buf, "%u", mState.mAudioOutChanL);
  WritePrivateProfileString("audio", "out1", buf, ini);
  sprintf(buf, "%u", mState.mAudioOutChanR);
  WritePrivateProfileString("audio", "out2", buf, ini);
  //sprintf(buf, "%u", mState.mAudioInIsMono);
  //WritePrivateProfileString("audio", "monoinput", buf, ini);

  WDL_String str;
  str.SetFormatted(32, "%i", mState.mBufferSize);
  WritePrivateProfileString("audio", "buffer", str.Get(), ini);

  str.SetFormatted(32, "%i", mState.mAudioSR);
  WritePrivateProfileString("audio", "sr", str.Get(), ini);

  WritePrivateProfileString("midi", "indev", mState.mMidiInDev.Get(), ini);
  WritePrivateProfileString("midi", "outdev", mState.mMidiOutDev.Get(), ini);

  sprintf(buf, "%u", mState.mMidiInChan);
  WritePrivateProfileString("midi", "inchan", buf, ini);
  sprintf(buf, "%u", mState.mMidiOutChan);
  WritePrivateProfileString("midi", "outchan", buf, ini);
}

std::string IPlugAPPHost::GetAudioDeviceName(uint32_t deviceID) const
{
  auto str = mDAC->getDeviceInfo(deviceID).name;
  std::size_t pos = str.find(':');

  if (pos != std::string::npos)
  {
    std::string subStr = str.substr(pos + 1);
    return subStr;
  }
  else
  {
    return str;
  }
}

std::optional<uint32_t> IPlugAPPHost::GetAudioDeviceID(const char* deviceNameToTest) const
{
  auto deviceIDs = mDAC->getDeviceIds();

  for (auto deviceID : deviceIDs)
  {
    auto name = GetAudioDeviceName(deviceID);

    if (std::string_view(deviceNameToTest) == name)
    {
      return deviceID;
    }
  }
  
  return std::nullopt;
}

int IPlugAPPHost::GetMIDIPortNumber(ERoute direction, const char* nameToTest) const
{
  int start = 1;
  
  auto nameStrView = std::string_view(nameToTest);
  
  if (direction == ERoute::kInput)
  {
    if (nameStrView == OFF_TEXT) return 0;
    
  #ifdef OS_MAC
    start = 2;
    if (nameStrView == "virtual input") return 1;
  #endif
    
    for (int i = 0; i < mMidiIn->getPortCount(); i++)
    {
      if (nameStrView == mMidiIn->getPortName(i).c_str())
        return (i + start);
    }
  }
  else
  {
    if (nameStrView == OFF_TEXT) return 0;
  
  #ifdef OS_MAC
    start = 2;
    if (nameStrView == "virtual output") return 1;
  #endif
  
    for (int i = 0; i < mMidiOut->getPortCount(); i++)
    {
      if (nameStrView == mMidiOut->getPortName(i).c_str())
        return (i + start);
    }
  }
  
  return -1;
}

void IPlugAPPHost::ProbeAudioIO()
{
  mAudioInputDevIDs.clear();
  mAudioOutputDevIDs.clear();

  if (!mDAC)
    return;

  DBGMSG("\nRtAudio Version %s", RtAudio::getVersion().c_str());

  RtAudio::DeviceInfo info;

  auto deviceIDs = mDAC->getDeviceIds();

  for (auto deviceID : deviceIDs)
  {
    info = mDAC->getDeviceInfo(deviceID);

    if (info.inputChannels > 0)
    {
      mAudioInputDevIDs.push_back(deviceID);
    }
    
    if (info.outputChannels > 0)
    {
      mAudioOutputDevIDs.push_back(deviceID);
    }
    
    if (info.isDefaultInput)
    {
      mDefaultInputDev = deviceID;
    }
    
    if (info.isDefaultOutput)
    {
      mDefaultOutputDev = deviceID;
    }
  }
}

void IPlugAPPHost::ProbeMidiIO()
{
  if (!mMidiIn || !mMidiOut)
    return;
  else
  {
    int nInputPorts = mMidiIn->getPortCount();

    mMidiInputDevNames.push_back(OFF_TEXT);

#ifdef OS_MAC
    mMidiInputDevNames.push_back("virtual input");
#endif

    for (int i=0; i<nInputPorts; i++)
    {
      mMidiInputDevNames.push_back(mMidiIn->getPortName(i));
    }

    int nOutputPorts = mMidiOut->getPortCount();

    mMidiOutputDevNames.push_back(OFF_TEXT);

#ifdef OS_MAC
    mMidiOutputDevNames.push_back("virtual output");
#endif

    for (int i=0; i<nOutputPorts; i++)
    {
      mMidiOutputDevNames.push_back(mMidiOut->getPortName(i));
      //This means the virtual output port wont be added as an input
    }
  }
}

bool IPlugAPPHost::AudioSettingsInStateAreEqual(AppState& os, AppState& ns)
{
  if (os.mAudioDriverType != ns.mAudioDriverType) return false;
  if (std::string_view(os.mAudioInDev.Get()) != ns.mAudioInDev.Get()) return false;
  if (std::string_view(os.mAudioOutDev.Get()) != ns.mAudioOutDev.Get()) return false;
  if (os.mAudioSR != ns.mAudioSR) return false;
  if (os.mBufferSize != ns.mBufferSize) return false;
  if (os.mAudioInChanL != ns.mAudioInChanL) return false;
  if (os.mAudioInChanR != ns.mAudioInChanR) return false;
  if (os.mAudioOutChanL != ns.mAudioOutChanL) return false;
  if (os.mAudioOutChanR != ns.mAudioOutChanR) return false;
//  if (os.mAudioInIsMono != ns.mAudioInIsMono) return false;

  return true;
}

bool IPlugAPPHost::MIDISettingsInStateAreEqual(AppState& os, AppState& ns)
{
  if (std::string_view(os.mMidiInDev.Get()) != ns.mMidiInDev.Get()) return false;
  if (std::string_view(os.mMidiOutDev.Get()) != ns.mMidiOutDev.Get()) return false;
  if (os.mMidiInChan != ns.mMidiInChan) return false;
  if (os.mMidiOutChan != ns.mMidiOutChan) return false;

  return true;
}

bool IPlugAPPHost::TryToChangeAudioDriverType()
{
  CloseAudio();

  if (mDAC)
  {
    mDAC = nullptr;
  }

  // Skip RtAudio initialization in no-I/O mode or screenshot mode
  if (mNoIO || IsScreenshotMode())
    return true;

#if defined OS_WIN
  if (mState.mAudioDriverType == kDeviceASIO)
    mDAC = std::make_unique<RtAudio>(RtAudio::WINDOWS_ASIO);
  else if (mState.mAudioDriverType == kDeviceDS)
    mDAC = std::make_unique<RtAudio>(RtAudio::WINDOWS_DS);
#elif defined OS_MAC
  if (mState.mAudioDriverType == kDeviceCoreAudio)
    mDAC = std::make_unique<RtAudio>(RtAudio::MACOSX_CORE);
  //else
  //mDAC = std::make_unique<RtAudio>(RtAudio::UNIX_JACK);
#else
  #error NOT IMPLEMENTED
#endif

  if (mDAC)
  {
    mDAC->setErrorCallback(ErrorCallback);
    return true;
  }

  return false;
}

bool IPlugAPPHost::TryToChangeAudio()
{
  // Skip audio initialization in no-I/O mode or screenshot mode
  if (mNoIO || IsScreenshotMode())
    return true;

#if defined OS_WIN
  // ASIO has one device, use the output for the input ID
  auto inputID = GetAudioDeviceID(mState.mAudioDriverType == kDeviceASIO ? mState.mAudioOutDev.Get() : mState.mAudioInDev.Get());
#elif defined OS_MAC
  // TRIGGER UNIVERSE: "off" = output only (the INPUT player still feeds the plug)
  if (!mInputChosen) mState.mAudioInDev.Set(OFF_TEXT);
  const bool noInput = std::string_view(mState.mAudioInDev.Get()) == OFF_TEXT;
  auto inputID = noInput ? std::optional<uint32_t>(0u) : GetAudioDeviceID(mState.mAudioInDev.Get());
#else
  #error NOT IMPLEMENTED
#endif
  auto outputID = GetAudioDeviceID(mState.mAudioOutDev.Get());

  bool failedToFindDevice = false;
  bool resetToDefault = false;

  if (!inputID)
  {
    if (mDefaultInputDev)
    {
      resetToDefault = true;
      inputID = mDefaultInputDev;

      if (mAudioInputDevIDs.size())
        mState.mAudioInDev.Set(GetAudioDeviceName(inputID.value()).c_str());
    }
    else
      failedToFindDevice = true;
  }

  if (!outputID)
  {
    if (mDefaultOutputDev)
    {
      resetToDefault = true;
      outputID = mDefaultOutputDev;

      if (mAudioOutputDevIDs.size())
        mState.mAudioOutDev.Set(GetAudioDeviceName(outputID.value()).c_str());
    }
    else
      failedToFindDevice = true;
  }

  if (resetToDefault)
  {
    DBGMSG("Couldn't find previous audio device, reseting to default\n");
    UpdateINI();
  }

  // TRIGGER UNIVERSE: no input device at all is fine (output only); a missing
  // output is reported in the app's AUDIO SETUP panel instead of a modal box.
  if (!inputID && outputID) { inputID = 0u; failedToFindDevice = false; mState.mAudioInDev.Set(OFF_TEXT); }
  if (failedToFindDevice)
    mAudioNote = "No hay dispositivo de salida de audio: elegí uno en AUDIO SETUP";

  if (inputID && outputID)
  {
    return InitAudio(inputID.value(), outputID.value(), mState.mAudioSR, mState.mBufferSize);
  }

  return false;
}

bool IPlugAPPHost::SelectMIDIDevice(ERoute direction, const char* pPortName)
{
  int port = GetMIDIPortNumber(direction, pPortName);

  if (direction == ERoute::kInput)
  {
    if (port == -1)
    {
      mState.mMidiInDev.Set(OFF_TEXT);
      UpdateINI();
      port = 0;
    }

    //TODO: send all notes off?
    if (mMidiIn)
    {
      mMidiIn->closePort();

      if (port == 0)
      {
        return true;
      }
  #if defined OS_WIN
      else
      {
        mMidiIn->openPort(port-1);
        return true;
      }
  #elif defined OS_MAC
      else if (port == 1)
      {
        std::string virtualMidiInputName = "To ";
        virtualMidiInputName += BUNDLE_NAME;
        mMidiIn->openVirtualPort(virtualMidiInputName);
        return true;
      }
      else
      {
        mMidiIn->openPort(port-2);
        return true;
      }
  #else
   #error NOT IMPLEMENTED
  #endif
    }
  }
  else
  {
    if (port == -1)
    {
      mState.mMidiOutDev.Set(OFF_TEXT);
      UpdateINI();
      port = 0;
    }
    
    if (mMidiOut)
    {
      //TODO: send all notes off?
      mMidiOut->closePort();
      
      if (port == 0)
        return true;
#if defined OS_WIN
      else
      {
        mMidiOut->openPort(port-1);
        return true;
      }
#elif defined OS_MAC
      else if (port == 1)
      {
        std::string virtualMidiOutputName = "From ";
        virtualMidiOutputName += BUNDLE_NAME;
        mMidiOut->openVirtualPort(virtualMidiOutputName);
        return true;
      }
      else
      {
        mMidiOut->openPort(port-2);
        return true;
      }
#else
  #error NOT IMPLEMENTED
#endif
    }
  }
  
  return false;
}

std::string IPlugAPPHost::GuardPath() const
{
  std::string dir(mINIPath.Get());
  const auto slash = dir.find_last_of('/');
  if (slash != std::string::npos) dir.erase(slash + 1);
  return dir + "audio-input.guard";
}

void IPlugAPPHost::CloseAudio()
{
  std::remove(GuardPath().c_str()); // closed cleanly: not a crash
  if (mDAC && mDAC->isStreamOpen())
  {
    if (mDAC->isStreamRunning())
    {
      mAudioEnding = true;
    
      while (!mAudioDone)
        Sleep(10);
      
      mDAC->abortStream();
    }
    
    mDAC->closeStream();
  }
}

bool IPlugAPPHost::InitAudio(uint32_t inID, uint32_t outID, uint32_t sr, uint32_t iovs)
{
  // TRIGGER UNIVERSE: never fail silently. The stock version asked for exactly the
  // plug's channel count at a fixed rate; a mono input, a device locked to another
  // rate or no input device at all left the app mute with no message. Now:
  //  - inID 0 or "off" = no input stream (the plug gets silence + its INPUT player)
  //  - the input opens with as many channels as the device has (1 -> both sides)
  //  - if the stream does not open, retry at the output device's own rate, then
  //    without input; mAudioNote says what happened.
  // Crash guard: the guard file exists while an input stream is open. Found at the
  // first start of a launch = the app died with that input open -> start without input.
  std::string crashNote;
  if (mFirstInit)
  {
    mFirstInit = false;
    struct stat gst;
    if (stat(GuardPath().c_str(), &gst) == 0 && std::string_view(mState.mAudioInDev.Get()) != OFF_TEXT)
    {
      crashNote = std::string("La app se cerró sola la última vez con la entrada ") + mState.mAudioInDev.Get()
                + " abierta: arrancó sin entrada. Elegí la entrada de nuevo en AUDIO / MIDI SETUP para probarla.";
      mState.mAudioInDev.Set(OFF_TEXT);
      mInputChosen = false;
      inID = 0;
    }
  }

  CloseAudio();
  mAudioNote.clear();

  const bool noInput = inID == 0 || std::string_view(mState.mAudioInDev.Get()) == OFF_TEXT;
  uint32_t devInChans = 0;
  uint32_t outPreferredSR = 0;
  if (!noInput) { try { devInChans = mDAC->getDeviceInfo(inID).inputChannels; } catch (...) {} }
  try { outPreferredSR = mDAC->getDeviceInfo(outID).preferredSampleRate; } catch (...) {}

  auto tryOpen = [&](bool withInput, uint32_t rate) -> bool {
    if (mDAC->isStreamOpen()) mDAC->closeStream();
    RtAudio::StreamParameters iParams, oParams;
    iParams.deviceId = inID;
    // chosen channels (settings.ini in1 / in2, 1-based): a pair, or one channel = mono
    const uint32_t first = std::min<uint32_t>(std::max<uint32_t>(mState.mAudioInChanL, 1) - 1, devInChans > 0 ? devInChans - 1 : 0);
    const uint32_t wanted = std::min<uint32_t>(std::max<int>(1, (int) mState.mAudioInChanR - (int) mState.mAudioInChanL + 1), 2);
    iParams.nChannels = withInput ? std::min<uint32_t>({wanted, (uint32_t) GetPlug()->MaxNChannels(ERoute::kInput), devInChans - first}) : 0;
    iParams.firstChannel = withInput ? first : 0;
    oParams.deviceId = outID;
    oParams.nChannels = GetPlug()->MaxNChannels(ERoute::kOutput);
    oParams.firstChannel = 0;

    mBufferSize = iovs; // mBufferSize may get changed by stream
    mStreamInChans = (int) iParams.nChannels;
    mBufIndex = 0;
    mSamplesElapsed = 0;
    mSampleRate = static_cast<double>(rate);
    mVecWait = 0;
    mAudioEnding = false;
    mAudioDone = false;

    DBGMSG("trying to start audio stream @ %i sr, buffer size %i\nindev = %s\noutdev = %s\ninputs = %i\noutputs = %i\n",
      rate, mBufferSize, withInput ? GetAudioDeviceName(inID).c_str() : "off", GetAudioDeviceName(outID).c_str(), iParams.nChannels, oParams.nChannels);

    mIPlug->SetBlockSize(APP_SIGNAL_VECTOR_SIZE);
    mIPlug->SetSampleRate(mSampleRate);
    mIPlug->OnReset();

    RtAudio::StreamOptions options;
    options.flags = RTAUDIO_NONINTERLEAVED;
    auto status = mDAC->openStream(&oParams, iParams.nChannels > 0 ? &iParams : nullptr, RTAUDIO_FLOAT64, rate, &mBufferSize, &AudioCallback, this, &options);
    if (status != RtAudioErrorType::RTAUDIO_NO_ERROR)
    {
      DBGMSG("%s", mDAC->getErrorText().c_str());
      return false;
    }
    mInputBufPtrs.Empty();
    mOutputBufPtrs.Empty();
    for (int i = 0; i < GetPlug()->MaxNChannels(ERoute::kInput); i++) mInputBufPtrs.Add(nullptr);   // set in callback
    for (int i = 0; i < (int) oParams.nChannels; i++) mOutputBufPtrs.Add(nullptr); // set in callback
    if (mDAC->startStream() != RTAUDIO_NO_ERROR)
    {
      DBGMSG("Error starting stream: %s\n", mDAC->getErrorText().c_str());
      return false;
    }
    return true;
  };

  std::string firstError;
  bool ok = tryOpen(!noInput && devInChans > 0, sr);
  if (!ok) firstError = mDAC->getErrorText();
  if (!ok && outPreferredSR > 0 && outPreferredSR != sr)
  {
    ok = tryOpen(!noInput && devInChans > 0, outPreferredSR);
    if (ok)
    {
      mAudioNote = "Sample rate " + std::to_string(sr) + " no disponible: se usa " + std::to_string(outPreferredSR) + " Hz (el del dispositivo)";
      mState.mAudioSR = outPreferredSR;
    }
  }
  if (!ok && !noInput)
  {
    const uint32_t rate = outPreferredSR > 0 ? outPreferredSR : sr;
    ok = tryOpen(false, rate);
    if (ok)
    {
      mAudioNote = "La entrada " + GetAudioDeviceName(inID) + " no abrió junto con la salida: audio solo de salida (INPUT de demo disponible)";
      mState.mAudioSR = rate;
    }
  }
  if (!ok)
  {
    mStreamInChans = 0;
    mAudioNote = "No se pudo abrir " + GetAudioDeviceName(outID) + ": " + (firstError.empty() ? mDAC->getErrorText() : firstError);
    return false;
  }
  if (mStreamInChans == 1 && mAudioNote.empty())
    mAudioNote = "Entrada mono (canal " + std::to_string(mState.mAudioInChanL) + "): va a los dos lados";
  if (!crashNote.empty())
    mAudioNote = crashNote;
  if (mStreamInChans > 0)
  {
    if (FILE* f = fopen(GuardPath().c_str(), "w")) { fputs(mState.mAudioInDev.Get(), f); fclose(f); }
  }

  mActiveState = mState;
  UpdateINI();
  return true;
}

std::vector<IPlugAPPHost::DeviceSummary> IPlugAPPHost::ListAudioDevices()
{
  std::vector<DeviceSummary> out;
  if (!mDAC) return out;
  ProbeAudioIO();
  for (auto id : mDAC->getDeviceIds())
  {
    RtAudio::DeviceInfo info;
    try { info = mDAC->getDeviceInfo(id); } catch (...) { continue; }
    DeviceSummary d;
    d.id = id;
    d.name = GetAudioDeviceName(id);
    d.inChannels = info.inputChannels;
    d.outChannels = info.outputChannels;
    d.preferredSR = info.preferredSampleRate;
    for (auto r : info.sampleRates) d.sampleRates.push_back(r);
    d.isDefaultIn = info.isDefaultInput;
    d.isDefaultOut = info.isDefaultOutput;
    out.push_back(std::move(d));
  }
  return out;
}

bool IPlugAPPHost::ApplyAudioSettings(const char* inDev, const char* outDev, uint32_t sr, uint32_t bufferSize, uint32_t in1, uint32_t in2)
{
  if (in1 > 0) { mState.mAudioInChanL = in1; mState.mAudioInChanR = std::max(in1, in2 > 0 ? in2 : in1 + 1); }
  if (inDev && std::string_view(inDev) != mState.mAudioInDev.Get()) mInputChosen = std::string_view(inDev) != OFF_TEXT;
  if (inDev) mState.mAudioInDev.Set(inDev);
  if (outDev) mState.mAudioOutDev.Set(outDev);
  if (sr) mState.mAudioSR = sr;
  if (bufferSize) mState.mBufferSize = bufferSize;
  UpdateINI();
  ProbeAudioIO();
  return TryToChangeAudio();
}

bool IPlugAPPHost::ApplyMidiInput(const char* name)
{
  mState.mMidiInDev.Set(name && *name ? name : OFF_TEXT);
  UpdateINI();
  return SelectMIDIDevice(ERoute::kInput, mState.mMidiInDev.Get());
}

bool IPlugAPPHost::InitMidi()
{
  // Skip MIDI initialization in no-I/O mode or screenshot mode
  if (mNoIO || IsScreenshotMode())
    return true;

  try
  {
    mMidiIn = std::make_unique<RtMidiIn>();
  }
  catch (RtMidiError &error)
  {
    mMidiIn = nullptr;
    error.printMessage();
    return false;
  }

  try
  {
    mMidiOut = std::make_unique<RtMidiOut>();
  }
  catch (RtMidiError &error)
  {
    mMidiOut = nullptr;
    error.printMessage();
    return false;
  }

  mMidiIn->setCallback(&MIDICallback, this);
  mMidiIn->ignoreTypes(false, true, false );

  return true;
}

void ApplyFades(double *pBuffer, int nChans, int nFrames, bool down)
{
  for (int i = 0; i < nChans; i++)
  {
    double *pIO = pBuffer + (i * nFrames);
    
    if (down)
    {
      for (int j = 0; j < nFrames; j++)
        pIO[j] *= ((double) (nFrames - (j + 1)) / (double) nFrames);
    }
    else
    {
      for (int j = 0; j < nFrames; j++)
        pIO[j] *= ((double) j / (double) nFrames);
    }
  }
}

// static
int IPlugAPPHost::AudioCallback(void* pOutputBuffer, void* pInputBuffer, uint32_t nFrames, double streamTime, RtAudioStreamStatus status, void* pUserData)
{
  IPlugAPPHost* _this = (IPlugAPPHost*) pUserData;

  int nins = _this->GetPlug()->MaxNChannels(ERoute::kInput);
  int nouts = _this->GetPlug()->MaxNChannels(ERoute::kOutput);
  
  double* pInputBufferD = static_cast<double*>(pInputBuffer);
  double* pOutputBufferD = static_cast<double*>(pOutputBuffer);

  bool startWait = _this->mVecWait >= APP_N_VECTOR_WAIT; // wait APP_N_VECTOR_WAIT * iovs before processing audio, to avoid clicks
  bool doFade = _this->mVecWait == APP_N_VECTOR_WAIT || _this->mAudioEnding;
  
  if (startWait && !_this->mAudioDone)
  {
    if (doFade && pInputBufferD && _this->mStreamInChans > 0)
      ApplyFades(pInputBufferD, _this->mStreamInChans, nFrames, _this->mAudioEnding);
    
    // TRIGGER UNIVERSE: process the device buffer in chunks of at most
    // APP_SIGNAL_VECTOR_SIZE frames. The stock loop always handed the plug a full
    // APP_SIGNAL_VECTOR_SIZE block starting inside the device buffer, so a device
    // buffer smaller than that (or not a multiple of it, e.g. 32 samples) made
    // the plug write past the end of RtAudio's buffer (heap corruption, crash).
    const int streamIns = _this->mStreamInChans;
    for (int pos = 0; pos < (int) nFrames; )
    {
      const int n = std::min<int>(APP_SIGNAL_VECTOR_SIZE, (int) nFrames - pos);
      for (int c = 0; c < nins; c++)
      {
        // mono input -> both sides; no input -> silence
        double* pIn = (streamIns > 0 && pInputBufferD) ? pInputBufferD + std::min(c, streamIns - 1) * (int) nFrames + pos
                                                       : _this->mZeroInput;
        _this->mInputBufPtrs.Set(c, pIn);
      }
      for (int c = 0; c < nouts; c++)
        _this->mOutputBufPtrs.Set(c, pOutputBufferD + c * (int) nFrames + pos);

      _this->mIPlug->AppProcess(_this->mInputBufPtrs.GetList(), _this->mOutputBufPtrs.GetList(), n);
      _this->mSamplesElapsed += n;
      pos += n;
    }
    for (int c = 0; c < nouts; c++)
      for (int i = 0; i < (int) nFrames; i++)
        pOutputBufferD[c * (int) nFrames + i] *= APP_MULT;
    
    if (doFade)
      ApplyFades(pOutputBufferD, nouts, nFrames, _this->mAudioEnding);
    
    if (_this->mAudioEnding)
      _this->mAudioDone = true;
  }
  else
  {
    memset(pOutputBufferD, 0, nFrames * nouts * sizeof(double));
  }
  
  _this->mVecWait = std::min(_this->mVecWait + 1, uint32_t(APP_N_VECTOR_WAIT + 1));

  return 0;
}

// static
void IPlugAPPHost::MIDICallback(double deltatime, std::vector<uint8_t>* pMsg, void* pUserData)
{
  IPlugAPPHost* _this = (IPlugAPPHost*) pUserData;
  
  if (pMsg->size() == 0 || _this->mExiting)
    return;
  
  if (pMsg->size() > 3)
  {
    if (pMsg->size() > MAX_SYSEX_SIZE)
    {
      DBGMSG("SysEx message exceeds MAX_SYSEX_SIZE\n");
      return;
    }
    
    SysExData data { 0, static_cast<int>(pMsg->size()), pMsg->data() };
    
    _this->mIPlug->mSysExMsgsFromCallback.Push(data);
    return;
  }
  else if (pMsg->size())
  {
    IMidiMsg msg;
    msg.mStatus = pMsg->at(0);
    pMsg->size() > 1 ? msg.mData1 = pMsg->at(1) : msg.mData1 = 0;
    pMsg->size() > 2 ? msg.mData2 = pMsg->at(2) : msg.mData2 = 0;

    _this->mIPlug->mMidiMsgsFromCallback.Push(msg);
  }
}

// static
void IPlugAPPHost::ErrorCallback(RtAudioErrorType type, const std::string &errorText)
{
  std::cerr << "\nerrorCallback: " << errorText << "\n\n";
}

