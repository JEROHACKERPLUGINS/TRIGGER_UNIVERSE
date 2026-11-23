#include "AppAudioSetup.h"

#if defined(APP_API)
#include "IPlugAPP_host.h"
#include "json.hpp"

using namespace iplug;

std::string TUAppAudioStateJSON()
{
  auto* pHost = IPlugAPPHost::sInstance.get();
  if (!pHost)
    return {};
  nlohmann::json devs = nlohmann::json::array();
  for (const auto& d : pHost->ListAudioDevices())
    devs.push_back({{"name", d.name}, {"in", d.inChannels}, {"out", d.outChannels}, {"sr", d.preferredSR},
                    {"rates", d.sampleRates}, {"defIn", d.isDefaultIn}, {"defOut", d.isDefaultOut}});
  const auto& st = pHost->GetAppState();
  const nlohmann::json j = {{"id", "audio"},
                            {"devices", devs},
                            {"midiIns", pHost->ListMidiInputs()},
                            {"in", st.mAudioInDev.Get()}, {"out", st.mAudioOutDev.Get()},
                            {"midiIn", st.mMidiInDev.Get()},
                            {"sr", st.mAudioSR}, {"buffer", st.mBufferSize},
                            {"in1", st.mAudioInChanL}, {"in2", st.mAudioInChanR},
                            {"running", pHost->IsAudioRunning()},
                            {"activeSR", pHost->GetActiveSampleRate()},
                            {"activeBuffer", pHost->GetActiveBufferSize()},
                            {"inChans", pHost->GetActiveInputChannels()},
                            {"note", pHost->GetAudioNote()}};
  return j.dump();
}

void TUAppApplyAudio(const std::string& json)
{
  auto* pHost = IPlugAPPHost::sInstance.get();
  if (!pHost)
    return;
  const auto j = nlohmann::json::parse(json, nullptr, false);
  if (j.is_discarded())
    return;
  const std::string in = j.value("in", std::string(pHost->GetAppState().mAudioInDev.Get()));
  const std::string out = j.value("out", std::string(pHost->GetAppState().mAudioOutDev.Get()));
  pHost->ApplyAudioSettings(in.c_str(), out.c_str(), j.value("sr", 0u), j.value("buffer", 0u),
                            j.value("in1", 0u), j.value("in2", 0u));
}

void TUAppApplyMidiIn(const std::string& name)
{
  if (auto* pHost = IPlugAPPHost::sInstance.get())
    pHost->ApplyMidiInput(name.empty() ? OFF_TEXT : name.c_str());
}

#else

std::string TUAppAudioStateJSON() { return {}; }
void TUAppApplyAudio(const std::string&) {}
void TUAppApplyMidiIn(const std::string&) {}

#endif
