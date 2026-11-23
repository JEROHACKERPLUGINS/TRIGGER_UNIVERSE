cmake_minimum_required(VERSION 3.14)
project(TriggerUniverse VERSION 1.0.0)

if(NOT DEFINED IPLUG2_DIR)
  set(IPLUG2_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../_iPlug2" CACHE PATH "iPlug2 root directory")
endif()

include(${IPLUG2_DIR}/iPlug2.cmake)
find_package(iPlug2 REQUIRED)

iplug_add_plugin(${PROJECT_NAME}
  SOURCES
    DrumReplacer.cpp
    DrumReplacer.h
    DSP/SlotEngine.h
    DSP/TransientDetector.h
    DSP/Dynamics.h
    DSP/WavFile.h
    DSP/PreviewPlayer.h
    DSP/PreviewCache.h
    DSP/InputPlayer.h
    DSP/SampleAnalysis.h
    DSP/SampleMap.h
    DSP/SampleClassifier.h
    resources/resource.h
    ${IPLUG2_DIR}/WDL/fft.c
  WEB_RESOURCES
    resources/web/index.html
    resources/web/style.css
    resources/web/app.js
    resources/web/native-ui.js
    # demo INPUT (SN TOP 1) and demo one-shot, same files as the prototype
    ../../prototype/samples/SN_TOP_1COMMIT_17-140.wav
    ../../prototype/samples/SNARE.cm.wav
  UI WEBVIEW
  FORMATS APP AU
)
