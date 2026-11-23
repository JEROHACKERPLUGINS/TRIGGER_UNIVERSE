#pragma once

// Standalone app only: the AUDIO SETUP panel of the WebView UI talks to iPlug2's
// APP host through these (no-ops / empty in the AU and other formats).
// Kept in its own file so the host's headers (RtAudio, SWELL) stay out of the plugin.
#include <string>

std::string TUAppAudioStateJSON();               // {"id":"audio", devices, in, out, sr, ...} or ""
void TUAppApplyAudio(const std::string& json);   // {in, out, sr, buffer}
void TUAppApplyMidiIn(const std::string& name);  // "off" = none
