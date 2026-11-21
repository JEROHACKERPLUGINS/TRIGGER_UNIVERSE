# DrumReplacer — Desarrollo por fases sobre `_iPlug2`

## Context

`plug.md` describe un drum replacer (detector de transientes → gate → slots de samples → mix) con UI WebView. El código de ejemplo de `plug.md` usa una API de iPlug2 que **no existe** en el repo (`iplug2::IPlug2`, `IPLUG2_MAIN_ARGS`, `SetWebViewURL`, rapidjson, `iplug2_add_plugin`). Este plan reordena el trabajo en fases chicas, cada una compilable y verificable, usando la API real de `_iPlug2/`.

### Correcciones a `plug.md` (aplican a todas las fases)

| `plug.md` dice | API real en `_iPlug2` |
|---|---|
| `iplug2::IPlug2` | `iplug::Plugin(info, MakeConfig(kNumParams, kNumPresets))` |
| `ProcessBlock(..., pMidiMsgs, n)` | `ProcessBlock(sample** in, sample** out, int n)` + `ProcessMidiMsg(const IMidiMsg&)` |
| `OnMessageFromWebView` / rapidjson | `OnMessage(msgTag, ctrlTag, size, data)` + JS `SAMFUI`; JSON con `nlohmann::json` (ya incluido, `SendJSONFromDelegate`) |
| `setParam` manual | JS `BPCFUI / SPVFUI / EPCFUI`; C++→JS automático vía `SPVFD` |
| `iplug2_add_plugin(... USE_WEBVIEW)` | `iplug_add_plugin(... UI WEBVIEW WEB_RESOURCES ...)` (ver `Examples/IPlugWebUI/CMakeLists.txt`) |
| `find_package(ZLIB)` | `WDL/zlib` ya está en el repo |
| `alloca`, `std::vector` de hits, `SendHitToUI` en `ProcessBlock` | Prohibido en audio thread: buffer de hits prealocado + `ISender`/`IPlugQueue` → `OnIdle` |
| Enum: 13 slot params y `kNumParams` | Real: 20 globales + 16 × 13 = **228** params, índice `kSlotBase + s*kNumSlotParams + p` |
| Rango slot params 0–1 genérico | Rangos reales de la tabla (dB, semitonos, ms) con `InitDouble/InitGain/InitBool` |
| IDs `'Trg2'` / `'Ssla'` | Usar IDs propios: los de `plug.md` chocan con el plugin original si está instalado en el host |

Plantilla base: `Examples/IPlugWebUI` (ya trae WebView, knobs JS, MIDI in/out, `PLUG_CHANNEL_IO "2-2"`).

---

## Fases

Cada fase termina con algo que se abre y se prueba. No pasar a la siguiente sin la verificación de la anterior.

### Fase 0 — Scaffold (≈1 h)
1. `cd _iPlug2/Examples && python3 duplicate.py IPlugWebUI DrumReplacer MyCompany ../../DrumReplacer` → proyecto en `trig/DrumReplacer/`.
2. En `DrumReplacer/CMakeLists.txt` apuntar `IPLUG2_DIR` a `../_iPlug2`.
3. `config.h`: nombre, IDs propios, `PLUG_DOES_STATE_CHUNKS 1`, `PLUG_TYPE 0` (efecto con MIDI in/out), tamaño UI.
- **Verifica:** `cmake --preset` / build target APP y VST3; la app standalone abre con la UI de ejemplo.

### Fase 1 — Parámetros + estado (≈½ día)
- `DrumReplacer.h`: enum de globales (`kSensitivity … kMidiOutChannel`), `kNumSlots = 16`, `kNumSlotParams = 13`, `kSlotBase`, `kNumParams = kSlotBase + kNumSlots*kNumSlotParams`. Helper `SlotParam(s, p)`.
- Constructor: `InitDouble/InitGain/InitBool/InitInt` con los rangos de las tablas de `plug.md`.
- `SerializeState/UnserializeState` (patrón `Examples/IPlugChunks/IPlugChunks.cpp:36`): params + paths de samples por slot + `baseDir` + nombre de preset + versión de estado.
- **Verifica:** en un host (Reaper) guardar proyecto, reabrir, valores y paths se restauran.

### Fase 2 — Motor de samples, disparado por MIDI (≈1–2 días)
- `SamplerVoice.h`, `SlotEngine.h` (header-only, estilo `IPlugDrumSynth_DSP.h`): voces prealocadas, offset sample-accurate, pitch por interpolación lineal, envolvente A/S/R, vol/pan/phase, solo/mute.
- Carga de **WAV** (no `.dri` todavía) en hilo no-audio; swap atómico del `InstrumentData` en el slot.
- `ProcessMidiMsg`: nota/canal MIDI in → `Trigger` del slot.
- **Verifica:** standalone con teclado MIDI dispara el sample del slot 1; sin clicks ni allocations (correr con Instruments / ASan).

### Fase 3 — Detector de transientes + cadena de audio (≈2–3 días)
- `TransientDetector.h`: biquad HP/LP (low/high cut), envelope follower (`detail`), threshold adaptativo (`sensitivity`), retrigger en ms, suppression. Escribe hits en array fijo (sin `std::vector`).
- `ProcessBlock`: input gain → detector → slots → dry/wet → output gain (con smoothers de `Smoothers.h`). MIDI out por hit con `SendMidiMsg`.
- Check runnable: `tests/detector_test.cpp` mínimo que lee un loop de batería WAV y `assert` el número de hits esperado.
- **Verifica:** test pasa; en el host, una pista de kick reemplazada suena en sincronía.

### Fase 4 — Gate, velocity layers, curvas, links (≈1–2 días)
- `GateProcessor` (detrás de flag `DRUMREPLACER_PRO`; si no es Pro, pasa hits sin filtrar).
- Selección de capa por velocity (algoritmo de `plug.md` línea 193), `veloCurve`, `dynamicsCurve`, `rangeTop/Bottom`.
- Links entre slots (`m_AttackLink` etc.): al mover un param linkeado, `OnParamChange` copia a los demás slots.
- **Verifica:** sample con varias capas cambia según la fuerza del golpe; gate off/on cambia hits detectados.

### Fase 5 — UI WebView (≈3–5 días)
- Reemplazar `resources/web/` con: paneles Detector / Gate / Gain / MIDI, 16 slot strips, knobs con colores semánticos de `plug.md` (reutilizar `knob-control.js` del ejemplo).
- Knobs → `BPCFUI/SPVFUI/EPCFUI`; host → `SPVFD` (ya automático).
- Hits → `ISender` en audio thread → `OnIdle` → `SendJSONFromDelegate({"type":"hit",...})` → flash en el strip.
- Carga de sample por slot: botón → `SAMFUI(kMsgLoadSample, slot)` → diálogo nativo en C++ → respuesta JSON con el nombre.
- Gate deshabilitado/gris si no es Pro, con el tooltip del original.
- **Verifica:** automatizar un knob en el host mueve el knob en la UI y viceversa; flashes visibles en tiempo real.

### Fase 6 — Presets, browser, audición (≈2–3 días)
- `PresetManager`: guardar/cargar `.drp` (JSON o XML con raíz `DRUMREPLACER` + `instrument_preset_ver`), validar header, mensaje de error del original.
- Dirty flag (`*` en nombre) y confirmación al cambiar preset.
- File browser de samples desde `baseDir` (listado en C++, enviado como JSON) + audición con slot de preview; warning si `IsAudioRunning()` es false.
- **Verifica:** guardar preset, cambiar todo, recargar → idéntico; audición suena con el transporte corriendo.

### Fase 7 — Formatos y release (≈1–2 días)
- Targets: VST3, AU, CLAP (+ AAX solo si tenés el SDK). VST2 está deprecado en el repo: omitir.
- Validación: `Scripts/validate_audiounit.sh`, pluginval, prueba en 2 hosts.
- Firma/notarización: `Scripts/notarise.sh`.
- **Verifica:** `auval` pasa; el plugin carga en Logic y Reaper.

### Fase 8 (opcional) — Compatibilidad `.dri`
- La estructura de `.dri` en `plug.md` es **inferida**; el loader de ejemplo es una suposición. Requiere archivos `.dri` reales para confirmar el layout con un hexdump antes de escribir código.
- Implementar `InstrumentLoader` con `WDL/zlib` como formato de carga adicional al WAV.

---

## Archivos críticos
- Nuevo: `trig/DrumReplacer/{config.h, DrumReplacer.h, DrumReplacer.cpp, CMakeLists.txt}`, `DSP/*.h`, `resources/web/*`.
- Referencias a reutilizar: `Examples/IPlugWebUI/*` (plantilla), `Examples/IPlugChunks/IPlugChunks.cpp` (state), `Examples/IPlugDrumSynth/IPlugDrumSynth_DSP.h` (voces), `IPlug/Extras/WebView/IPlugWebViewEditorDelegate.h` (bridge JS), `IPlug/ISender.h`, `IPlug/Extras/Smoothers.h`, `WDL/zlib`.

## Verificación end-to-end
Al final de Fase 5: en Reaper, pista con loop de batería → plugin → kick reemplazado audible, MIDI out graba notas en otra pista, UI refleja automatización, guardar/reabrir proyecto restaura todo.

Skipped: FFT Blackman-Harris en el detector (agregar solo si el envelope follower falla con material tonal), `ParameterManager`/`MidiHandler` como clases separadas (viven en la clase principal hasta que pesen).
