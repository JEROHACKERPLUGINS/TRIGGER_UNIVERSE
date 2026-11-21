# DrumReplacer — Plan de Recreación (iPlug2 + WebView)

## Identidad del plugin

| Campo | Valor |
|-------|-------|
| **Nombre** | DrumReplacer |
| **Versión** | 2.1.9 |
| **Bundle ID** | `com.mycompany.DrumReplacer` |
| **Formato** | Mach-O universal binary (x86_64 + arm64) |
| **Tipo** | Mach-O 64-bit bundle → audio plugin multi-formato |
| **Framework original** | JUCE (`JuceAudioProcessor`, `JucePluginFactory`) |
| **Framework recreación** | **iPlug2** (`https://github.com/iplug2/iplug2`) |
| **UI recreación** | **WebView** (HTML/CSS/JS) con comunicación C++↔JS vía `IWebSocketServer` |
| **DRM** | Pace Eden (iLok) — se omite |
| **Compilador** | Clang, C++17 |
| **Funciones** | 1,202 |
| **Strings** | 12,746 |

---

## Formatos de plugin soportados

1. **VST3** — `Steinberg::IPluginFactory`, `kExeSubType_Vst3Plugin`
2. **VST2** — `kExeSubType_VstPlugin`
3. **AudioUnit (AU)** — `kExeSubType_AUPlugin`, `kExeSubType_AULegacyPlugin`
4. **AAX** — `kExeSubType_AvidAaxPlugIn`
5. **AAX HCP Dispatch** — `kExeSubType_ProToolsPlugInHCPDispatch`
6. **Pro Tools** — `kExeSubType_ProToolsPlugIn`
7. **MOTU** — `kExeSubType_MotuPlugin`

### Entry points originales (exports del binario)

```
_GetPluginFactory  → 0x16b8018
_bundleEntry       → 0x16b8000
_bundleExit        → 0x16b800c
```

En iPlug2, el macro `IPLUG2_MAIN_ARGS` genera automáticamente estos entry points para todos los formatos.

---

## Dependencias del sistema

```
Metal.framework          (weak — renderizado GPU)
MetalKit.framework       (weak — vistas Metal)
Security.framework       (criptografía)
Accelerate.framework     (vDSP, FFT, BLAS)
AudioToolbox.framework   (audio file I/O)
Cocoa.framework
CoreAudio.framework
CoreAudioKit.framework
CoreMIDI.framework
Foundation.framework
QuartzCore.framework
WebKit.framework         (WebView embebido)
AppKit.framework
CoreGraphics.framework
CoreImage.framework
CoreText.framework
libc++.1.dylib
libSystem.B.dylib
libobjc.A.dylib
zlib                     (decompresión de instrumentos TCI)
```

---

## Clases del plugin original (found via REA RTTI/strings)

- `DrumReplacerAudioProcessor` → hereda de `juce::JuceAudioProcessor`
- `DrumReplacerAudioProcessorEditor` → hereda de `juce::AudioProcessorEditor`
- `CParameterManager` → serialización de parámetros/presets
- `CGatePane` → panel UI del gate
- `CCapturedMidiDrag` → drag-and-drop MIDI
- `SampleFileBrowser` → browser de samples
- `BrowserPresetSet` → conjunto de browser presets

### Componentes de UI original (LookAndFeel / sprites)

El binario original contiene nombres de sprites estilo "LookAndFeel" (`_LF` suffix) de JUCE. Cada color de knob está mapeado a un grupo de parámetros:

| Sprite | Color | Parámetros asociados |
|--------|-------|---------------------|
| `knobBig_LF` | Genérico (grande) | Knob de uso general / preset nav |
| `knobBlueLeft_LF` | Azul (izquierda) | Canal izquierdo del detector |
| `knobBlueRight_LF` | Azul (derecha) | Canal derecho del detector |
| `knobBlueFilter_LF` | Azul (filtro) | Low Cut / High Cut |
| `knobRedSuppr_LF` | Rojo (supresión) | `m_detectorSupr` |
| `knobRedGate_LF` | Rojo (gate) | Attack / Sustain / Release del gate |
| `knobViolet_LF` | Violeta | Gain / Mix |
| `knobOrange_LF` | Naranja | Dinámica / velocity curve |
| `knobCurveOrange_LF` | Naranja (curva) | `m_dynamicsCurve` |
| `knobCurveBlue_LF` | Azul (curva) | `m_veloCurve` |

Botones y labels:
| Elemento | Propósito |
|----------|-----------|
| `SavePreset_LF` | Botón/icono para guardar preset |
| `ResetCapturedMidi_LF` | Botón para resetear MIDI capturado |
| `btnTrigger_LF` | Botón de disparo manual del trigger |

En la recreación con WebView, estos sprites se reemplazan por elementos HTML/CSS estilizados con los mismos colores semánticos para mantener la identidad visual.

---

## Parámetros del plugin

### Detector de transientes

| Variable | Nombre | Tipo | Rango |
|----------|--------|------|-------|
| `m_detectorSens` | Sensitivity | Float | 0.0–1.0 |
| `m_detectorRetrig` | Retrigger | Float (ms) | 0–1000 |
| `m_detectorDetail` | Detail | Float | 0.0–1.0 |
| `m_detectorMode` | Mode | Int | 0–N |
| `m_detectorLowCut` | Low Cut | Float (Hz) | 20–20000 |
| `m_detectorHighCut` | High Cut | Float (Hz) | 20–20000 |
| `m_detectorSupr` | Suppression | Float | 0.0–1.0 |

### Ganancia y mezcla

| Variable | Nombre | Tipo | Rango |
|----------|--------|------|-------|
| `m_inputGain` | Input Gain | Float (dB) | −24–24 |
| `m_outputGain` | Output Gain | Float (dB) | −24–24 |
| `m_outputMix` | Mix | Float | 0.0–1.0 |

### Gate

| Variable | Nombre | Tipo | Rango |
|----------|--------|------|-------|
| `m_gateEnabled` | Gate On | Bool | — |
| `m_gateAttack` | Attack | Float (ms) | 0–500 |
| `m_gateSust` | Sustain | Float | 0.0–1.0 |
| `m_gateRelease` | Release | Float (ms) | 0–500 |

### MIDI

| Variable | Nombre | Tipo | Rango |
|----------|--------|------|-------|
| `m_bIsMidiInEnabled` | MIDI In Enable | Bool | — |
| `m_bIsMidiOutEnabled` | MIDI Out Enable | Bool | — |
| `m_nMidiInNote` | MIDI In Note | Int | 0–127 |
| `m_nMidiInChannel` | MIDI In Channel | Int | 1–16 |
| `m_nMidiOutNote` | MIDI Out Note | Int | 0–127 |
| `m_nMidiOutChannel` | MIDI Out Channel | Int | 1–16 |

### Por slot/instrumento

| Variable | Nombre | Tipo | Rango |
|----------|--------|------|-------|
| `m_vol` | Volume | Float (dB) | −∞–6 |
| `m_pan` | Pan | Float | −1.0–1.0 |
| `m_tune` | Tune | Float (semitones) | −24–24 |
| `m_attack` | Attack | Float (ms) | 0–2000 |
| `m_release` | Release | Float (ms) | 0–5000 |
| `m_sust` | Sustain | Float | 0.0–1.0 |
| `m_veloCurve` | Velocity Curve | Float | 0.0–1.0 |
| `m_dynamicsCurve` | Dynamics Curve | Float | 0.0–1.0 |
| `m_rangeTop` | Range Top | Float | 0.0–1.0 |
| `m_rangeBottom` | Range Bottom | Float | 0.0–1.0 |
| `m_phaze` | Phase Invert | Bool | — |
| `m_solo` | Solo | Bool | — |
| `m_mute` | Mute | Bool | — |
| `m_artNum` | Articulation | Int | 0–N |
| `m_soloButtonEnabled` | Solo button available | Bool | — |
| `m_muteButtonEnabled` | Mute button available | Bool | — |

### Estado de carga de instrumento por slot

| Variable | Nombre | Tipo |
|----------|--------|------|
| `m_instrumentFileName` | Nombre del archivo .dri cargado | String |
| `m_instrumentFullPath` | Ruta absoluta del .dri | String |
| `m_instrumentPathFromBaseDir` | Ruta relativa desde `m_baseDir` | String |
| `m_isInstrLoaded` | Instrumento cargado en el slot | Bool |

### Sistema de slots y velocity layering

| Variable | Descripción |
|----------|-------------|
| `m_nSlot` | Índice o cantidad de slots activos |
| `m_bSlot` | Slot habilitado/deshabilitado (bool) |
| `m_sSlot` | Identificador de slot (string) |
| `m_nVeloTopSlot` | Límite superior de velocity para este slot |
| `m_nVeloBotSlot` | Límite inferior de velocity para este slot |
| `m_nArticulation` | ID de articulación dentro del slot (nombre C++ original, corresponde a `m_artNum`) |

**Algoritmo de selección de capa por velocity:**
Para un hit con velocity V, el `SlotEngine` busca dentro del `InstrumentData` la capa (`VelocityLayer`) donde `velMin <= V < velMax`. Si ninguna capa coincide exactamente, se selecciona la capa más cercana (menor distancia al centro del rango). Si hay una sola capa, se usa para todas las velocidades.

### Estado y linking

| Variable | Nombre |
|----------|--------|
| `m_lastLoadedPresetName` | Nombre preset cargado |
| `m_isPresetChanged` | Dirty flag |
| `m_isInitializationComplete` | Init flag |
| `m_baseDir` | Directorio base samples |
| `m_AttackLink`, `m_SuskLink`, `m_ReleaseLink` | Links ADSR entre slots |
| `m_DynLink`, `m_VeloLink`, `m_TuneLink` | Links dinámica/velocity/tune |
| `m_RangeTopLink`, `m_RangeBottomLink` | Links de rango |

### Sistema de presets

El plugin original tiene un sistema de presets con banco de fábrica y guardado/carga. Strings encontrados en el binario:

| String | Contexto |
|--------|----------|
| `Factory Presets` | Nombre del banco de presets incorporados |
| `instrument_preset_ver` | Clave de versión en la serialización del preset |
| `Save Preset as ` | Texto del diálogo para guardar preset |
| `File selected is not a valid DrumReplacer Preset!` | Error al cargar archivo inválido |
| `m_lastLoadedPresetName` | Nombre del último preset cargado |
| `m_isPresetChanged` | Flag de "dirty" (cambios sin guardar) |
| `sate_of_pluginVersion` | Versión del plugin en el estado guardado |

**Formato de archivo de preset (.drp):** XML/ValueTree con raíz `DRUMREPLACER`. Debe validarse que el archivo seleccionado tenga este header. La clave `instrument_preset_ver` indica la versión del formato de preset para compatibilidad forward/backward.

**Lógica de dirty flag:** `m_isPresetChanged` se pone a `true` cuando cualquier parámetro cambia después de cargar/guardar. La UI muestra un indicador visual (asterisco en el nombre del preset). Al intentar cargar otro preset o cerrar, se pregunta si guardar cambios.

### Global

| Variable | Nombre | Tipo |
|----------|--------|------|
| `m_bRespectOsScaling` | OS Scaling | Bool |
| `m_bEnableLoadByDoubleclick` | Load on double-click | Bool |
| `m_bBrowserAuditionIsEnabledByDefault` | Audition default | Bool |
| `param_base_fir` | Base FIR filter | Float |

### Feature de audición de samples

El plugin original permite preescuchar samples desde el file browser antes de cargarlos. Strings relevantes:

```
"Warning, audition is not available.\n\rPlugin is not getting audio data,
it is probably bypassed or your DAW track input monitoring is not enabled"
```

Este warning aparece cuando el usuario intenta usar la audición pero el plugin no está recibiendo audio (porque el track está en bypass o el input monitoring del DAW no está activado).

**Implementación en la recreación:**
- El botón de audición en el file browser envía `{"cmd":"audition","path":"/path/to/sample.dri"}` al backend
- El `InstrumentLoader` carga temporalmente el TCI en un `SlotEngine` de preview
- Si `IsAudioRunning()` es false, se envía al WebView el mensaje `{"type":"warning","text":"Audition is not available...plugin is bypassed or track input monitoring is not enabled"}`
- La preescucha se detiene al soltar el click o al seleccionar definitivamente el instrumento

### Versiones del plugin (licensing tiers)

El binario contiene este string que revela un modelo de versiones:

```
"Transient Gate module is available in Pro version only."
```

DrumReplacer tiene al menos dos tiers: una versión base y una versión **Pro** que desbloquea el módulo de Transient Gate. En la recreación:
- Se puede implementar con un flag de build `#define DRUMREPLACER_PRO` o una variable `m_isPro`
- Si `m_isPro == false`, el gate panel en la UI debe mostrarse deshabilitado/gris con el tooltip del mensaje original
- El `GateProcessor` devuelve los hits sin filtrar si no está en modo Pro

---

## Pipeline de procesamiento de audio

```
Entrada
  │
  ▼
[Input Gain]
  │
  ▼
[Detector de transientes] ──► MIDI Out (si habilitado)
  │                           
  │ (lista de hits)
  ▼
[Gate Processor] (attack/sustain/release noise gate)
  │
  │ (hits filtrados)
  ▼
[Slot Engine] (8–16 slots en paralelo)
  │
  │ Cada slot:
  │   ├─ Selección de capa por velocity (m_nVeloTopSlot/m_nVeloBotSlot)
  │   ├─ Pitch shift (m_tune)
  │   ├─ Envolvente ADSR (m_attack/m_sust/m_release)
  │   ├─ Curva de velocity/dinámica
  │   ├─ Volumen + Pan
  │   └─ Solo/Mute/Phase
  │
  ▼
[Mix Dry/Wet]
  │
  ▼
[Output Gain]
  │
  ▼
Salida
```

---

## Formato de instrumentos comprimidos (TCI)

Strings encontrados: `DRUMREPLACER COMPRESSED INSTRUMENT`, `DRUMREPLACER COMPRESSED INSTRUMENT 2`

**Estructura inferida del archivo .dri:**

```
┌──────────────────────────────────┐
│  Magic (string ASCII)            │  "DRUMREPLACER COMPRESSED INSTRUMENT 2"
├──────────────────────────────────┤
│  Header:                         │
│    version                        │
│    sample_rate                    │
│    num_samples                    │
│    num_velocity_layers            │
│    num_sample_loops               │
│    midi_unity_note                │
│    midi_pitch_fraction            │
│    sample_period                  │
├──────────────────────────────────┤
│  Por cada velocity layer:         │
│    vel_min / vel_max              │
│    compressed_size                │
│    uncompressed_size              │
│    zlib_compressed_audio_data[]   │
├──────────────────────────────────┤
│  Metadatos adicionales:           │
│    midi_data_base64 (opcional)    │
│    sampler_data                   │
└──────────────────────────────────┘
```

**Descompresión:** `zlib inflate` con buffer de salida precalculado desde `uncompressed_size`.

Claves de serialización del original:
```
NumSampleLoops, SampleLength, SamplePeriod, SamplerData
MidiUnityNote, MidiPitchFraction, midiDataBase64
samples, samples_count_in_mw
```

---

## Plan de recreación con iPlug2

### Fase 1: Setup del proyecto

**Estructura de archivos:**

```
DrumReplacer/
├── config.h                    # Macros de iPlug2 + IDs
├── DrumReplacer.cpp                # Entry point principal (IPLUG2_MAIN_ARGS)
├── DrumReplacer.h / .cpp           # Clase principal del plugin
├── TransientDetector.h / .cpp  # Detección de transientes
├── GateProcessor.h / .cpp      # Noise gate
├── SlotEngine.h / .cpp         # Motor de slots/voces
├── SamplerVoice.h / .cpp       # Voz de sampleo
├── ParameterManager.h / .cpp   # CParameterManager
├── PresetManager.h / .cpp      # Carga/guarda presets
├── InstrumentLoader.h / .cpp   # Carga TCI + zlib
├── MidiHandler.h / .cpp        # Manejo MIDI in/out
├── web/
│   ├── index.html              # UI web principal
│   ├── style.css               # Estilos
│   ├── ui.js                   # Lógica de UI + WebSocket bridge
│   ├── components/
│   │   ├── knob.js             # Componente knob rotativo
│   │   ├── slot-strip.js       # Tira de slot
│   │   ├── gate-panel.js       # Panel del gate
│   │   ├── file-browser.js     # Browser de samples
│   │   └── preset-browser.js   # Lista de presets
│   └── assets/
│       ├── knob-sprites.png    # Sprites de knobs
│       └── bg.png              # Fondo del plugin
├── DSP/
│   ├── FIRFilter.h / .cpp      # Filtro FIR
│   └── DynamicsCurve.h / .cpp  # Curvas de velocity/dinámica
├── resources/
│   └── icon.png
├── CMakeLists.txt
└── README.md
```

### Fase 2: `config.h` — Configuración de iPlug2

```cpp
#pragma once

#define PLUG_MFR      "MyCompany"
#define PLUG_NAME     "DrumReplacer"
#define PLUG_CLASS_NAME DrumReplacerPlugin
#define PLUG_VERSION  "2.1.9"
#define PLUG_UNIQUE_ID 'T','r','g','2'
#define PLUG_MFR_ID   'S','s','l','a'
#define PLUG_MFR_EMAIL "info@mycompany.com"
#define PLUG_MFR_URL   "https://mycompany.com"

// Formatos
#define PLUG_DOES_AUDIO_IN     1
#define PLUG_DOES_MIDI_IN      1
#define PLUG_DOES_MIDI_OUT     1
#define PLUG_DOES_STATE_CHUNKS 1
#define PLUG_HAS_UI            1
#define PLUG_CHANNEL_IO        "2-2"     // stereo in → stereo out
#define PLUG_LATENCY           0

// iPlug2 specifics
#define IPLUG2_MAIN_ARGS(...) /* generado automáticamente */
#define IPLUG2_WEBVIEW_URL    "web/index.html"
```

### Fase 3: `DrumReplacer.h` / `DrumReplacer.cpp` — Clase principal

```cpp
#pragma once
#include "IPlug2.h"
#include "IPlug2_WebView.h"
#include "TransientDetector.h"
#include "GateProcessor.h"
#include "SlotEngine.h"
#include "ParameterManager.h"
#include "PresetManager.h"
#include "InstrumentLoader.h"
#include "MidiHandler.h"

const int kNumSlots = 16;

enum EParams {
    // Detector
    kParamSensitivity = 0,
    kParamRetrigger,
    kParamDetail,
    kParamDetectorMode,
    kParamLowCut,
    kParamHighCut,
    kParamSuppression,
    // Gain
    kParamInputGain,
    kParamOutputGain,
    kParamMix,
    // Gate
    kParamGateEnabled,
    kParamGateAttack,
    kParamGateSustain,
    kParamGateRelease,
    // MIDI
    kParamMidiInEnabled,
    kParamMidiInNote,
    kParamMidiInChannel,
    kParamMidiOutEnabled,
    kParamMidiOutNote,
    kParamMidiOutChannel,
    // Slot params (base + kNumSlots * kNumSlotParams)
    kParamSlotVol,
    kParamSlotPan,
    kParamSlotTune,
    kParamSlotAttack,
    kParamSlotRelease,
    kParamSlotSustain,
    kParamSlotVeloCurve,
    kParamSlotDynCurve,
    kParamSlotRangeTop,
    kParamSlotRangeBottom,
    kParamSlotPhase,
    kParamSlotSolo,
    kParamSlotMute,
    kNumParams
};

class DrumReplacerPlugin : public iplug2::IPlug2 {
public:
    DrumReplacerPlugin(const iplug2::InstanceInfo& info);
    ~DrumReplacerPlugin();

    void OnReset() override;
    void OnIdle() override;
    void ProcessBlock(float** inputs, float** outputs, int nFrames,
                      const IMidiMsg* pMidiMsgs, int nMidiMsgs) override;

    // State
    bool SerializeState(const iplug2::IByteChunk& chunk) const override;
    int  UnserializeState(const iplug2::IByteChunk& chunk, int startPos) override;

    // WebView message handler
    void OnMessageFromWebView(const char* json) override;

private:
    void SendParamsToUI();
    void SendHitToUI(int slot, float velocity);

    TransientDetector m_detector;
    GateProcessor     m_gate;
    SlotEngine        m_slots[kNumSlots];
    ParameterManager  m_paramMgr;
    PresetManager     m_presetMgr;
    InstrumentLoader  m_instrLoader;
    MidiHandler       m_midiHandler;

    float m_sampleRate = 44100.0f;
    bool  m_isInitialized = false;
};
```

### Fase 4: `DrumReplacer.cpp` — Implementación del procesamiento

```cpp
#include "DrumReplacer.h"
#include "IPlug2_Param.h"

// Inicialización de parámetros — se registran en el constructor

DrumReplacerPlugin::DrumReplacerPlugin(const iplug2::InstanceInfo& info)
    : iplug2::IPlug2(info, kNumParams,
                      /* extra knobs program change */ 0,
                      /* num presets */ 128) {

    // Detector
    AddParam(new iplug2::IParamFloat(kParamSensitivity,
        "Sensitivity", 0.0, 1.0, 0.7, "", IParam::kFlagNone));
    AddParam(new iplug2::IParamFloat(kParamRetrigger,
        "Retrigger", 0.1, 1000.0, 50.0, "ms", IParam::kFlagNone));
    AddParam(new iplug2::IParamFloat(kParamDetail,
        "Detail", 0.0, 1.0, 0.5, "", IParam::kFlagNone));
    AddParam(new iplug2::IParamInt(kParamDetectorMode,
        "Mode", 0, 3, 0, "", IParam::kFlagNone));
    AddParam(new iplug2::IParamFloat(kParamLowCut,
        "Low Cut", 20.0, 20000.0, 30.0, "Hz", IParam::kFlagNone));
    AddParam(new iplug2::IParamFloat(kParamHighCut,
        "High Cut", 20.0, 20000.0, 15000.0, "Hz", IParam::kFlagNone));
    AddParam(new iplug2::IParamFloat(kParamSuppression,
        "Suppress", 0.0, 1.0, 0.5, "", IParam::kFlagNone));

    // Gain
    AddParam(new iplug2::IParamFloat(kParamInputGain,
        "Input", -24.0, 24.0, 0.0, "dB", IParam::kFlagNone));
    AddParam(new iplug2::IParamFloat(kParamOutputGain,
        "Output", -24.0, 24.0, 0.0, "dB", IParam::kFlagNone));
    AddParam(new iplug2::IParamFloat(kParamMix,
        "Mix", 0.0, 1.0, 1.0, "", IParam::kFlagNone));

    // Gate
    AddParam(new iplug2::IParamBool(kParamGateEnabled,
        "Gate", false, "", IParam::kFlagNone));
    AddParam(new iplug2::IParamFloat(kParamGateAttack,
        "Gate Atk", 0.0, 500.0, 10.0, "ms", IParam::kFlagNone));
    AddParam(new iplug2::IParamFloat(kParamGateSustain,
        "Gate Sus", 0.0, 1.0, 0.5, "", IParam::kFlagNone));
    AddParam(new iplug2::IParamFloat(kParamGateRelease,
        "Gate Rel", 0.0, 500.0, 100.0, "ms", IParam::kFlagNone));

    // MIDI
    AddParam(new iplug2::IParamBool(kParamMidiInEnabled,
        "MIDI In", false));
    AddParam(new iplug2::IParamInt(kParamMidiInNote,
        "MIDI In Note", 0, 127, 60));
    AddParam(new iplug2::IParamInt(kParamMidiInChannel,
        "MIDI In Ch", 1, 16, 10));
    AddParam(new iplug2::IParamBool(kParamMidiOutEnabled,
        "MIDI Out", false));
    AddParam(new iplug2::IParamInt(kParamMidiOutNote,
        "MIDI Out Note", 0, 127, 60));
    AddParam(new iplug2::IParamInt(kParamMidiOutChannel,
        "MIDI Out Ch", 1, 16, 10));

    // Slot params (kNumSlots * 13 params)
    const char* slotParamNames[] = {
        "Vol", "Pan", "Tune", "Attack", "Release", "Sustain",
        "VeloCrv", "DynCrv", "RangeT", "RangeB", "Phase", "Solo", "Mute"
    };
    for (int s = 0; s < kNumSlots; s++) {
        char name[64];
        for (int p = 0; p < 13; p++) {
            snprintf(name, 64, "S%d %s", s + 1, slotParamNames[p]);
            int paramIdx = kParamSlotVol + s * 13 + p;
            if (p < 10)
                AddParam(new iplug2::IParamFloat(paramIdx, name, 0.0, 1.0, 0.5));
            else
                AddParam(new iplug2::IParamBool(paramIdx, name, false));
        }
    }

    // WebView
    SetWebViewURL(IPLUG2_WEBVIEW_URL);
}

void DrumReplacerPlugin::OnReset() {
    m_sampleRate = GetSampleRate();
    m_detector.Reset(m_sampleRate);
    m_gate.Reset(m_sampleRate);
    for (int s = 0; s < kNumSlots; s++)
        m_slots[s].Reset(m_sampleRate);
}

void DrumReplacerPlugin::ProcessBlock(float** inputs, float** outputs,
                                   int nFrames,
                                   const IMidiMsg* pMidiMsgs, int nMidiMsgs) {
    // 1. Read params
    float sensitivity  = GetParam(kParamSensitivity)->Value();
    float retrigger    = GetParam(kParamRetrigger)->Value();
    float detail       = GetParam(kParamDetail)->Value();
    int   detMode      = (int)GetParam(kParamDetectorMode)->Value();
    float lowCut       = GetParam(kParamLowCut)->Value();
    float highCut      = GetParam(kParamHighCut)->Value();
    float suppression  = GetParam(kParamSuppression)->Value();
    float inputGain    = GetParam(kParamInputGain)->Value();
    float outputGain   = GetParam(kParamOutputGain)->Value();
    float mix          = GetParam(kParamMix)->Value();
    bool  gateOn       = GetParam(kParamGateEnabled)->Bool();
    float gateAtk      = GetParam(kParamGateAttack)->Value();
    float gateSus      = GetParam(kParamGateSustain)->Value();
    float gateRel      = GetParam(kParamGateRelease)->Value();

    // 2. Process MIDI input events
    m_midiHandler.ProcessMidiIn(pMidiMsgs, nMidiMsgs);

    // 3. Apply input gain to dry buffer (keep copy for dry/wet)
    float* dryL = (float*)alloca(nFrames * sizeof(float));
    float* dryR = (float*)alloca(nFrames * sizeof(float));
    float gainLin = powf(10.0f, inputGain / 20.0f);
    for (int i = 0; i < nFrames; i++) {
        dryL[i] = inputs[0][i] * gainLin;
        dryR[i] = inputs[1][i] * gainLin;
    }

    // 4. Transient detection
    m_detector.SetParams(sensitivity, retrigger, detail, detMode,
                         lowCut, highCut, suppression);
    auto hits = m_detector.Process(dryL, dryR, nFrames);

    // 5. Gate filter
    if (gateOn) {
        hits = m_gate.Filter(hits, gateAtk * m_sampleRate / 1000.0f,
                             gateSus, gateRel * m_sampleRate / 1000.0f);
    }

    // 6. Clear output buffers
    memset(outputs[0], 0, nFrames * sizeof(float));
    memset(outputs[1], 0, nFrames * sizeof(float));

    // 7. Fire hits into slot engine
    for (auto& hit : hits) {
        m_slots[hit.slot].Trigger(hit.timestamp, hit.velocity);
        m_midiHandler.SendMidiOut(hit.slot, hit.velocity);
        SendHitToUI(hit.slot, hit.velocity);
    }

    // 8. Render slots
    for (int s = 0; s < kNumSlots; s++) {
        float vol   = GetParam(kParamSlotVol + s * 13)->Value();
        float pan   = GetParam(kParamSlotPan + s * 13)->Value();
        float tune  = GetParam(kParamSlotTune + s * 13)->Value();
        float atk   = GetParam(kParamSlotAttack + s * 13)->Value();
        float rel   = GetParam(kParamSlotRelease + s * 13)->Value();
        float sus   = GetParam(kParamSlotSustain + s * 13)->Value();
        bool  phase = GetParam(kParamSlotPhase + s * 13)->Bool();
        bool  solo  = GetParam(kParamSlotSolo + s * 13)->Bool();
        bool  mute  = GetParam(kParamSlotMute + s * 13)->Bool();

        m_slots[s].SetParams(vol, pan, tune, atk, rel, sus, phase, solo, mute);
        m_slots[s].Render(outputs[0], outputs[1], nFrames);
    }

    // 9. Dry/wet mix + output gain
    float outGainLin = powf(10.0f, outputGain / 20.0f);
    for (int i = 0; i < nFrames; i++) {
        outputs[0][i] = (outputs[0][i] * mix + dryL[i] * (1.0f - mix)) * outGainLin;
        outputs[1][i] = (outputs[1][i] * mix + dryR[i] * (1.0f - mix)) * outGainLin;
    }

    // 10. Process MIDI from keyboard input
    m_midiHandler.ProcessKeyboardMidi(pMidiMsgs, nMidiMsgs,
        [this](int slot, float vel) { m_slots[slot].Trigger(0, vel); });
}

// WebView message handler — recibe comandos desde el frontend JS
void DrumReplacerPlugin::OnMessageFromWebView(const char* json) {
    // Parsear JSON. Ejemplos de comandos esperados:
    // {"cmd":"setParam","id":0,"val":0.75}
    // {"cmd":"loadPreset","name":"My Kit"}
    // {"cmd":"savePreset","name":"My Kit"}
    // {"cmd":"loadInstrument","slot":0,"path":"/path/to/kick.dri"}
    // {"cmd":"setBaseDir","path":"/Library/.../DrumReplacer/Samples"}

    rapidjson::Document doc;
    doc.Parse(json);

    std::string cmd = doc["cmd"].GetString();
    if (cmd == "setParam") {
        int id = doc["id"].GetInt();
        float val = doc["val"].GetFloat();
        GetParam(id)->Set(val);
        InformHostOfParamChange(id, val);
    } else if (cmd == "loadPreset") {
        m_presetMgr.Load(doc["name"].GetString(), this);
        SendParamsToUI();
    } else if (cmd == "savePreset") {
        m_presetMgr.Save(doc["name"].GetString(), this);
    } else if (cmd == "loadInstrument") {
        int slot = doc["slot"].GetInt();
        const char* path = doc["path"].GetString();
        m_instrLoader.Load(path, m_slots[slot]);
    } else if (cmd == "setBaseDir") {
        m_paramMgr.SetBaseDir(doc["path"].GetString());
    }
}

void DrumReplacerPlugin::SendParamsToUI() {
    // Enviar todos los parámetros al frontend al inicio
    rapidjson::StringBuffer buf;
    rapidjson::Writer<rapidjson::StringBuffer> writer(buf);
    writer.StartObject();
    writer.Key("type"); writer.String("init");
    writer.Key("params"); writer.StartArray();
    for (int i = 0; i < kNumParams; i++) {
        writer.StartObject();
        writer.Key("id"); writer.Int(i);
        writer.Key("val"); writer.Double(GetParam(i)->Value());
        writer.EndObject();
    }
    writer.EndArray();
    writer.EndObject();
    SendMessageToWebView(buf.GetString());
}

void DrumReplacerPlugin::SendHitToUI(int slot, float velocity) {
    char buf[128];
    snprintf(buf, 128,
        "{\"type\":\"hit\",\"slot\":%d,\"velocity\":%.2f}", slot, velocity);
    SendMessageToWebView(buf);
}
```

### Fase 5: `TransientDetector.h` / `.cpp`

```cpp
#pragma once
#include <vector>

struct HitEvent {
    double timestamp;    // sample offset
    float  velocity;     // 0.0–1.0
    int    slot;         // slot asignado (0..15)
};

class TransientDetector {
public:
    void Reset(double sampleRate);
    void SetParams(float sensitivity, float retriggerMs, float detail,
                   int mode, float lowCutHz, float highCutHz, float suppression);
    std::vector<HitEvent> Process(const float* left, const float* right, int nFrames);

private:
    double m_sampleRate = 44100.0;
    float  m_sensitivity = 0.7f;
    float  m_retriggerSamples = 2205;  // ~50ms @ 44.1kHz
    float  m_detail = 0.5f;
    int    m_mode = 0;
    float  m_lowCutHz = 30.0f;
    float  m_highCutHz = 15000.0f;
    float  m_suppression = 0.5f;

    // Estado interno
    float m_envelope = 0.0f;
    int   m_samplesSinceLastHit = 0;
    bool  m_wasAboveThreshold = false;

    // Filtros
    void ApplyBandpassFilter(float* buffer, int nFrames);
    float EnvelopeFollower(float sample);
    bool  DetectHit(float envelope);

    // Coeficientes de filtro
    float m_lpState[2] = {0, 0};  // lowpass
    float m_hpState[2] = {0, 0};  // highpass
};
```

**Algoritmo:**
1. Aplicar filtro bandpass (low cut + high cut) con biquad de 2º orden
2. Envelope follower: `env = alpha * abs(sample) + (1 - alpha) * env` donde `alpha` depende de `m_detail`
3. Threshold adaptativo derivado de `m_sensitivity` y media del envelope
4. Hysteresis + retrigger: si `m_wasAboveThreshold == false` y `env > threshold` → hit
5. `m_suppression` reduce falsos positivos bajando ganancia post-hit

**Ventana Blackman-Harris 4-term 92dB para análisis FFT:**

El binario original contiene el string `blackman_harris_4term_92db`, lo que indica que el detector puede usar una FFT con esta ventana de análisis de alto rango dinámico (92 dB de atenuación de lóbulos laterales). Los coeficientes son:

```
a0 = 0.35875
a1 = 0.48829
a2 = 0.14128
a3 = 0.01168

w[n] = a0 - a1*cos(2πn/N) + a2*cos(4πn/N) - a3*cos(6πn/N)
```

**Uso en el detector:** La FFT con esta ventana permite análisis espectral preciso de transientes en presencia de componentes tonales fuertes, mejorando la discriminación entre golpes de batería y contenido armónico sostenido. En macOS, `Accelerate.framework` permite calcular esta ventana eficientemente:

```cpp
#include <Accelerate/Accelerate.h>

void ComputeBlackmanHarris92dB(float* window, int N) {
    const float a0 = 0.35875f, a1 = 0.48829f, a2 = 0.14128f, a3 = 0.01168f;
    for (int i = 0; i < N; i++) {
        float n = (float)i / (float)(N - 1);
        window[i] = a0 - a1 * cosf(2.0f * M_PI * n)
                       + a2 * cosf(4.0f * M_PI * n)
                       - a3 * cosf(6.0f * M_PI * n);
    }
    // Aplicar ventana al buffer antes de ejecutar vDSP_fft_zrip()
}
```

Nota: el detector basado puramente en envelope follower (algoritmo principal descrito arriba) es suficiente para una primera implementación. El análisis FFT con Blackman-Harris es una optimización avanzada para mejor precisión en señales complejas.

### Fase 6: `GateProcessor.h` / `.cpp` (Transient Gate — Pro only)

```cpp
#pragma once
#include <vector>

class GateProcessor {
public:
    void Reset(double sampleRate);
    std::vector<HitEvent> Filter(const std::vector<HitEvent>& hits,
                                  float attackSamples, float sustain,
                                  float releaseSamples);

private:
    double m_sampleRate = 44100.0;
    int    m_gateState = 0;    // 0=closed, 1=attack, 2=open, 3=sustain, 4=release
    int    m_gateTimer = 0;
    bool   m_gateOpen = false;
};
```

### Fase 7: `SlotEngine.h` / `.cpp`

Cada slot contiene N `SamplerVoice` para polifonía. La polyfonía evita cortar colas de samples previos.

```cpp
#pragma once
#include "SamplerVoice.h"
#include <vector>
#include <memory>

class SlotEngine {
public:
    void Reset(double sampleRate);
    void SetParams(float vol, float pan, float tune,
                   float atkMs, float relMs, float sus,
                   bool phase, bool solo, bool mute);
    void LoadInstrument(const InstrumentData& data);
    void Trigger(int sampleOffset, float velocity);
    void Render(float* outL, float* outR, int nFrames);

private:
    double m_sampleRate = 44100.0;
    std::vector<std::unique_ptr<SamplerVoice>> m_voices;
    InstrumentData m_instrument;
    float m_vol = 0.0f, m_pan = 0.0f, m_tune = 0.0f;
    float m_atkMs = 0.0f, m_relMs = 50.0f, m_sus = 1.0f;
    bool  m_phase = false, m_solo = false, m_mute = false;
};
```

### Fase 8: `SamplerVoice.h` / `.cpp`

```cpp
#pragma once
#include <vector>

struct InstrumentData {
    std::vector<float> samples;  // PCM float mono o stereo
    double sampleRate = 44100.0;
    int    numChannels = 1;
    int    midiUnityNote = 60;
    struct VelocityLayer {
        float velMin, velMax;
        int   sampleStart, sampleLength;
    };
    std::vector<VelocityLayer> layers;
};

class SamplerVoice {
public:
    void Trigger(int sampleOffset, float velocity, const InstrumentData& instr);
    void Render(float* outL, float* outR, int nFrames,
                float vol, float pan, float tuneSemi,
                float atkSamples, float relSamples,
                float susLevel, bool phase, bool active);

    bool IsFinished() const { return m_done; }

private:
    const InstrumentData* m_instr = nullptr;
    int   m_readPos = 0;
    int   m_startOffset = 0;
    int   m_attackSamples = 0;
    int   m_releaseSamples = 0;
    int   m_totalSamples = 0;
    float m_velocity = 0.0f;
    bool  m_releasing = false;
    bool  m_done = true;

    // Pitch shifting (linear interpolation)
    float m_pitchRatio = 1.0f;
    float m_phaseAccum = 0.0f;

    float ReadSample(int channel);
    float EnvelopeGain();
};
```

### Fase 9: `InstrumentLoader.h` / `.cpp` — Formato TCI + zlib

```cpp
#pragma once
#include "SlotEngine.h"
#include <zlib.h>
#include <string>
#include <cstdio>

class InstrumentLoader {
public:
    bool Load(const std::string& path, SlotEngine& slot);

private:
    bool ReadHeader(FILE* f, InstrumentData& data);
    bool DecompressLayer(FILE* f, InstrumentData::VelocityLayer& layer,
                         std::vector<float>& buffer);

    static constexpr const char* MAGIC_V1 = "DRUMREPLACER COMPRESSED INSTRUMENT";
    static constexpr const char* MAGIC_V2 = "DRUMREPLACER COMPRESSED INSTRUMENT 2";
};

bool InstrumentLoader::Load(const std::string& path, SlotEngine& slot) {
    FILE* f = fopen(path.c_str(), "rb");
    if (!f) return false;

    InstrumentData data;
    if (!ReadHeader(f, data)) { fclose(f); return false; }

    // Leer header + layers
    uint32_t numLayers;
    fread(&numLayers, sizeof(uint32_t), 1, f);

    size_t totalSamples = 0;
    for (uint32_t i = 0; i < numLayers; i++) {
        InstrumentData::VelocityLayer layer;
        fread(&layer.velMin, sizeof(float), 1, f);
        fread(&layer.velMax, sizeof(float), 1, f);

        uint32_t compSize, uncompSize;
        fread(&compSize, sizeof(uint32_t), 1, f);
        fread(&uncompSize, sizeof(uint32_t), 1, f);

        layer.sampleStart = totalSamples;
        layer.sampleLength = uncompSize / sizeof(float) / data.numChannels;

        // zlib decompress
        std::vector<uint8_t> compressed(compSize);
        std::vector<uint8_t> uncompressed(uncompSize);
        fread(compressed.data(), 1, compSize, f);

        uLongf destLen = uncompSize;
        int ret = uncompress(uncompressed.data(), &destLen,
                             compressed.data(), compSize);
        if (ret != Z_OK) { fclose(f); return false; }

        // Convertir a float
        float* floats = reinterpret_cast<float*>(uncompressed.data());
        data.samples.insert(data.samples.end(), floats,
                            floats + uncompSize / sizeof(float));

        totalSamples += layer.sampleLength;
        data.layers.push_back(layer);
    }

    fclose(f);
    slot.LoadInstrument(data);
    return true;
}
```

### Fase 10: Interfaz web — `web/index.html`

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>DrumReplacer</title>
<link rel="stylesheet" href="style.css">
</head>
<body>
<div id="app">
  <!-- Header -->
  <header>
    <span class="logo">DRUMREPLACER</span>
    <div class="preset-controls">
      <select id="preset-selector"></select>
      <button id="btn-save">Save</button>
      <button id="btn-load">Load</button>
    </div>
  </header>

  <!-- Main Layout -->
  <div class="main-layout">
    <!-- Detector section -->
    <section class="panel" id="detector-panel">
      <h3>DETECTOR</h3>
      <div class="knob-row">
        <div class="knob" data-param="0" data-label="SENS"></div>
        <div class="knob" data-param="1" data-label="RETRIG"></div>
        <div class="knob" data-param="2" data-label="DETAIL"></div>
      </div>
      <div class="knob-row">
        <div class="knob" data-param="4" data-label="LO CUT"></div>
        <div class="knob" data-param="5" data-label="HI CUT"></div>
        <div class="knob" data-param="6" data-label="SUPPR"></div>
      </div>
    </section>

    <!-- Gate section -->
    <section class="panel" id="gate-panel">
      <h3>GATE</h3>
      <div class="switch-row">
        <label class="switch">
          <input type="checkbox" data-param="10" id="gate-enable">
          <span class="slider"></span>
        </label>
      </div>
      <div class="knob-row">
        <div class="knob" data-param="11" data-label="ATK"></div>
        <div class="knob" data-param="12" data-label="SUS"></div>
        <div class="knob" data-param="13" data-label="REL"></div>
      </div>
    </section>

    <!-- Gain section -->
    <section class="panel" id="gain-panel">
      <h3>GAIN</h3>
      <div class="knob-row">
        <div class="knob" data-param="7"  data-label="IN"></div>
        <div class="knob" data-param="8"  data-label="OUT"></div>
        <div class="knob" data-param="9"  data-label="MIX"></div>
      </div>
    </section>

    <!-- MIDI section -->
    <section class="panel" id="midi-panel">
      <h3>MIDI</h3>
      <div class="midi-grid">
        <label>In Note <input type="number" data-param="15" min="0" max="127"></label>
        <label>In Ch  <input type="number" data-param="16" min="1" max="16"></label>
        <label>Out Note<input type="number" data-param="18" min="0" max="127"></label>
        <label>Out Ch <input type="number" data-param="19" min="1" max="16"></label>
      </div>
    </section>

    <!-- Slot Strips -->
    <div id="slots-container">
      <!-- Generado dinámicamente por JS -->
    </div>
  </div>
</div>

<script src="components/knob.js"></script>
<script src="components/slot-strip.js"></script>
<script src="ui.js"></script>
</body>
</html>
```

### Fase 11: `web/ui.js` — JavaScript bridge

```js
// WebSocket bridge: iPlug2 expone sendMessageToWebView/OnMessageFromWebView
let ws = null;
const params = {};
let paramCallbacks = {};

// iPlug2 crea un WebSocket interno; la UI se conecta a él
function connectToHost() {
    // iPlug2 injecta window.__iplug2_send y window.__iplug2_recv
    // o expone un websocket en ws://localhost:PORT
    if (window.__iplug2_send) {
        // API directa
        window.__iplug2_recv = handleMessage;
    } else {
        ws = new WebSocket('ws://localhost:8080');
        ws.onmessage = (e) => handleMessage(JSON.parse(e.data));
        ws.onopen = () => console.log('Connected to plugin');
    }
}

function sendToHost(msg) {
    const json = JSON.stringify(msg);
    if (window.__iplug2_send) {
        window.__iplug2_send(json);
    } else if (ws) {
        ws.send(json);
    }
}

function handleMessage(msg) {
    switch (msg.type) {
        case 'init':
            // Recibir todos los params al inicio
            msg.params.forEach(p => {
                params[p.id] = p.val;
                updateUI(p.id, p.val);
            });
            break;
        case 'paramChange':
            params[msg.id] = msg.val;
            updateUI(msg.id, msg.val);
            break;
        case 'hit':
            // Flash visual del slot
            flashSlot(msg.slot, msg.velocity);
            break;
    }
}

// Knob rotativo vía pointer events
class Knob {
    constructor(el, paramId, label) {
        this.el = el;
        this.paramId = paramId;
        this.value = params[paramId] || 0.5;
        this.angle = this.valueToAngle(this.value);
        this.bindEvents();
    }

    bindEvents() {
        let startY = 0, startVal = 0;
        this.el.addEventListener('pointerdown', (e) => {
            this.el.setPointerCapture(e.pointerId);
            startY = e.clientY;
            startVal = this.value;
        });
        this.el.addEventListener('pointermove', (e) => {
            if (!this.el.hasPointerCapture(e.pointerId)) return;
            const delta = (startY - e.clientY) * 0.005;
            this.value = Math.max(0, Math.min(1, startVal + delta));
            this.angle = this.valueToAngle(this.value);
            this.render();
            sendToHost({ cmd: 'setParam', id: this.paramId, val: this.value });
        });
    }

    valueToAngle(v) { return -135 + v * 270; }  // -135° a +135°
    render() {
        this.el.style.transform = `rotate(${this.angle}deg)`;
    }
}

function flashSlot(slot, velocity) {
    const strip = document.querySelector(`.slot-strip[data-slot="${slot}"]`);
    if (strip) {
        strip.classList.add('hit-flash');
        strip.style.setProperty('--vel', velocity);
        setTimeout(() => strip.classList.remove('hit-flash'), 150);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    connectToHost();
    // Inicializar knobs
    document.querySelectorAll('.knob').forEach(el => {
        const paramId = parseInt(el.dataset.param);
        const label = el.dataset.label;
        new Knob(el, paramId, label);
    });
    // Inicializar switches
    document.querySelectorAll('input[type="checkbox"][data-param]').forEach(el => {
        el.addEventListener('change', () => {
            const paramId = parseInt(el.dataset.param);
            sendToHost({ cmd: 'setParam', id: paramId, val: el.checked ? 1 : 0 });
        });
    });
    // Generar slot strips
    const container = document.getElementById('slots-container');
    for (let s = 0; s < 16; s++) {
        const strip = document.createElement('div');
        strip.className = 'slot-strip';
        strip.dataset.slot = s;
        strip.innerHTML = `<span class="slot-label">S${s+1}</span>`;
        container.appendChild(strip);
        // Knobs del slot...
    }
});
```

### Fase 12: `CMakeLists.txt`

```cmake
cmake_minimum_required(VERSION 3.22)
project(DrumReplacer VERSION 2.1.9 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_OSX_DEPLOYMENT_TARGET "10.13")

# iPlug2
add_subdirectory(lib/iplug2)

# RapidJSON
find_package(RapidJSON REQUIRED)

# zlib
find_package(ZLIB REQUIRED)

iplug2_add_plugin(DrumReplacer
    MANUFACTURER_NAME   "MyCompany"
    PLUGIN_NAME         "DrumReplacer"
    PLUGIN_UNIQUE_ID    "Trg2"
    PLUGIN_MFR_ID       "Ssla"
    VERSION             "2.1.9"
    FORMATS             VST3 AU VST2 AAX

    USE_WEBVIEW         ON
    WEBVIEW_URL         "web/index.html"

    SOURCES
        DrumReplacer.h
        DrumReplacer.cpp
        TransientDetector.h
        TransientDetector.cpp
        GateProcessor.h
        GateProcessor.cpp
        SlotEngine.h
        SlotEngine.cpp
        SamplerVoice.h
        SamplerVoice.cpp
        ParameterManager.h
        ParameterManager.cpp
        PresetManager.h
        PresetManager.cpp
        InstrumentLoader.h
        InstrumentLoader.cpp
        MidiHandler.h
        MidiHandler.cpp
        DSP/FIRFilter.h
        DSP/FIRFilter.cpp
        DSP/DynamicsCurve.h
        DSP/DynamicsCurve.cpp

    RESOURCES
        web/
        resources/icon.png
)

target_include_directories(DrumReplacer PRIVATE ${RAPIDJSON_INCLUDE_DIRS})
target_link_libraries(DrumReplacer PRIVATE
    iplug2::iplug2
    ZLIB::ZLIB
)

target_link_libraries(DrumReplacer PRIVATE
    "-framework Accelerate"
    "-framework AudioToolbox"
    "-framework CoreAudio"
    "-framework CoreMIDI"
    "-framework Cocoa"
    "-framework WebKit"
    "-weak_framework Metal"
    "-weak_framework MetalKit"
)

if(APPLE)
    set_target_properties(DrumReplacer PROPERTIES
        BUNDLE TRUE
        MACOSX_BUNDLE_GUI_IDENTIFIER "com.mycompany.DrumReplacer"
        MACOSX_BUNDLE_BUNDLE_NAME "DrumReplacer"
        MACOSX_BUNDLE_BUNDLE_VERSION "2.1.9"
    )
endif()
```

### Fase 13: Comunicación C++ ↔ WebView

iPlug2 con WebView proporciona dos métodos clave:

```cpp
// Enviar mensaje al WebView (C++ → JS)
void SendMessageToWebView(const char* json);

// Recibir mensaje del WebView (JS → C++)
virtual void OnMessageFromWebView(const char* json);
```

**Protocolo de mensajes:**

| Dirección | Tipo | Campos | Descripción |
|-----------|------|--------|-------------|
| C++ → JS | `init` | `params[]` | Estado inicial de todos los params |
| C++ → JS | `paramChange` | `id, val` | Un parámetro cambió (host automation) |
| C++ → JS | `hit` | `slot, velocity` | Flash visual de hit detectado |
| JS → C++ | `setParam` | `id, val` | Usuario movió un knob |
| JS → C++ | `loadPreset` | `name` | Cargar preset |
| JS → C++ | `savePreset` | `name` | Guardar preset |
| JS → C++ | `loadInstrument` | `slot, path` | Cargar .dri en un slot |
| JS → C++ | `setBaseDir` | `path` | Directorio base de samples |

---

## Resumen de diferencias JUCE → iPlug2

| Aspecto | JUCE (original) | iPlug2 (recreación) |
|---------|----------------|---------------------|
| **Factory** | `JucePluginFactory` + `GetPluginFactory()` export | `IPLUG2_MAIN_ARGS` macro |
| **Procesador** | `juce::AudioProcessor` con `processBlock` | `iplug2::IPlug2` con `ProcessBlock` |
| **Parámetros** | `juce::AudioParameterFloat/Bool/Int` | `iplug2::IParamFloat/Bool/Int` |
| **Buffer audio** | `juce::AudioBuffer<float>` | `float** inputs, float** outputs` |
| **MIDI** | `juce::MidiBuffer` | `const IMidiMsg* pMidiMsgs, int nMidiMsgs` |
| **Estado** | `getStateInformation/setStateInformation` | `SerializeState/UnserializeState` |
| **UI** | JUCE Components nativos | HTML/CSS/JS en WebView |
| **Knobs** | `juce::Slider` + LookAndFeel | `<canvas>` / `<div>` rotados vía CSS |
| **Editor** | `juce::AudioProcessorEditor` | No necesita — el WebView es el editor |
| **Build** | Projucer + CMake | Solo CMake |
| **Licencia** | JUCE license (GPL/commercial) | iPlug2: BSD-like, más liviano |
| **Binary size** | ~20-50 MB overhead JUCE | ~2-5 MB overhead iPlug2 |

---

## Notas finales

1. iPlug2 maneja WebView en macOS vía `WKWebView` (incluido en WebKit) y en Windows vía Microsoft Edge WebView2. Multiplataforma out-of-the-box.
2. La UI en web permite iterar rápido sin recompilar C++ — solo refrescar el WebView.
3. El knob rotativo se puede implementar con CSS `transform: rotate()` + pointer events, o con `<canvas>` para más control visual.
4. El `OnIdle()` de iPlug2 permite enviar actualizaciones periódicas al WebView (VU meters, posición de reproducción, etc.).
5. Para el file browser, se puede usar el diálogo nativo del OS invocándolo desde C++ y pasando el resultado al WebView.
6. El formato TCI con zlib es la pieza más compleja de reverse-engineerear sin el código fuente del loader original.
7. El DRM de Pace Eden se omite completamente (ver sección dedicada abajo).
8. La comunicación C++↔JS usa JSON serializado sobre el WebSocket interno de iPlug2 — mantener los mensajes pequeños (<1KB) para baja latencia.

---

## Detalles del DRM Pace Eden (omitido en la recreación)

El plugin original incluye un sistema completo de protección anti-copia Pace Eden (iLok). Se documenta aquí solo para referencia; **la recreación lo omite completamente**.

### Estructura del bundle Pace Eden embebido

```
__Pace_Eden.bundle/
└── Contents/
    ├── Info.plist          # Pace Eden v5.7.1 GM (c) 2023 PACE Anti-Piracy
    ├── MacOS/
    │   └── PaceEden        # Binario del runtime de protección
    ├── _CodeSignature/
    │   └── CodeResources   # Firma de código de Apple
    └── Resources/
        ├── en-us.xml       # Localización del wizard iLok (inglés)
        ├── common.xml       # Strings comunes del wizard
        ├── Experience/
        │   ├── publisher_foot.png
        │   ├── publisher_head.png
        │   ├── wizard_foot.png
        │   └── wizard_head.png
        └── Signatures/
            └── *.sig        # Firmas de integridad

PlugIns/
└── __Pace_Eden/
    └── libWrapHelper.dylib  # Helper de wrapping dinámico

Resources/
└── __Pace_Eden/
    └── Wrapper/
        └── wraptool.winfo   # Configuración del wrapper tool
```

### Funcionamiento general

1. **iLok License Manager** verifica que el usuario tenga una licencia válida para `com.mycompany.DrumReplacer` en su iLok (físico o cloud)
2. `libWrapHelper.dylib` es un helper que el runtime de Pace Eden carga para interceptar/proteger llamadas desde el plugin hacia funciones sensibles
3. Strings del binario original relacionados con licencias:
   - `license_version` — versión del esquema de licencia
   - `license manager:` — log del subsistema de licencias
   - `void pace::Ilok1Commander::init_key_data_from_product_id()` — símbolo RTTI de inicialización de claves
4. El wizard de autorización (localizado en `en-us.xml` / `common.xml`) guía al usuario a través del proceso de activación cuando no se detecta licencia

### Qué se omite en la recreación

- El bundle `__Pace_Eden.bundle` completo
- `libWrapHelper.dylib`
- Toda la lógica de verificación de licencia
- Los strings de error y advertencia de licencia
- El wizard de activación
- La restricción de funcionalidad vinculada a tiers de licencia

En su lugar, la recreación usa un simple flag `m_isPro` (#define o variable de configuración) para habilitar/deshabilitar features premium como el Transient Gate.