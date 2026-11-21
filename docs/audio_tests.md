# Pruebas de audio — SNARE.cm.wav

Fecha: 20/11/2026. Archivo: `/Users/dante/Desktop/SNARE.cm.wav` (copiado a `prototype/samples/SNARE.cm.wav`).

## 1. Archivo

| Dato | Valor |
| --- | --- |
| Duración | 8.1489 s |
| Canales | 2 |
| Sample rate | 48000 Hz |
| Bit depth | 24-bit PCM |
| Peak | 0.00 dBFS |
| RMS | −21.34 dBFS |
| DC | −0.00007 |

Es una **secuencia de snare con golpes principales y ghosts/flams**, no un único hit. Los golpes principales están a ~0.15, 0.855, 1.586, 2.322, 3.059, 3.789, 4.516, 5.240, 5.965, 6.690, 7.414 s; hay transientes secundarios ~0.18–0.37 s después de varios de ellos.

## 2. Motor C++ real — TransientDetector

Compilado con `clang++ -std=c++17 -I engine/DrumReplacer` (CommandLineTools), usando `DSP/WavFile.h` + `DSP/TransientDetector.h`.

| Configuración | Hits |
| --- | --- |
| Defaults del plugin: Sens 45, Retrig 50, Detail 50, Supp 50 | **23** |
| Retrig 250 ms | **17** |
| Detail 0 | **17** |
| Sens 20 | **12** |
| Sens 70 (default del test viejo) | **22** |

Con defaults (23): 0.152/1.00, 0.330/0.57, 0.855/1.00, 1.223/0.50, 1.586/1.00, 1.782/0.55, 2.322/1.00, 2.689/0.50, 3.059/0.99, 3.243/0.54, 3.789/1.00, 4.151/0.49, 4.516/1.00, 4.708/0.54, 5.240/1.00, 5.602/0.49, 5.965/1.00, 6.152/0.53, 6.690/0.99, 7.057/0.46, 7.414/1.00, 7.605/0.50, 8.141/0.95.

Con Sens 20 (12): los golpes principales + el transiente final 8.141. Los ghosts de ~0.5 de velocity desaparecen.

**Lectura:** el detector no está fallando; el archivo tiene 23 transientes. Sens 20 / Retrig 250 / Detail bajo permiten quedarse con los 12 principales. La decisión es musical; el default 45 detecta los ghosts.

## 3. Motor C++ real — SlotEngine

Con el WAV completo cargado en `SampleData` (2 canales, 391147 frames, 48 kHz):

| Prueba | Resultado |
| --- | --- |
| Playback exacto ratio 1, gain 1, velocity 1 | **maxErr 0.000e+00**, peak 1.000 |
| Offset 100 + velocity 0.5 | pre 0.000, err 0.000 |
| Tune +12 st (ratio 2) | err 0.000 |
| Release: sustain 2%, 10 ms | 0.155 s amp 0.7987 → 0.175 s 0.0000 → 0.25 s 0.0000 |
| Voice stealing (9 triggers, 8 voces) | render sin crash, peak 0.033 |

## 4. Prototipo Web Audio

- `decodeAudioData` carga el WAV; el contexto queda **running**.
- **Smoke test:** **▶ AUDIO TEST** (arriba a la derecha) reanuda el contexto, reproduce el archivo completo y dispara las 8 capas. El **LED verde** confirma `AudioContext.state === 'running'`. Verificado en Chromium: master 11.65% a los 700 ms, INPUT `■ STOP` activo.
- Se recorta el **primer golpe** (0.14–0.65 s) como sample del fader 01: **0.51 s**, 22491 frames a 44.1 kHz (el contexto remuestrea).
- El archivo completo queda como **INPUT** del trigger.
- Waveform del editor: real (no sintética).
- FILE SEARCH: el archivo aparece primero (`SNARE.cm · SNARE · 510 ms · 2.50 kHz`), entre 1001 samples.
- El waveform de INPUT dibuja los 8.15 s reales con marcas de los transientes detectados.
- El detector JS con defaults detecta **22** (el C++ 23; difiere en el transiente final 8.141). Con Retrig 250: 16; Sens 20: 12. La aproximación JS es cercana pero no idéntica al C++.

### Medición de salida (analizadores Web Audio)

| Prueba | Master | Slot 01 |
| --- | --- | --- |
| Audition normal (Level −3, ataque 0) @130 ms | 11.33% | 8.26% |
| Level −60 dB | 2.35% | 3% (idle) |
| Mute | 0% | 3% (idle) |
| Ataque 400 ms @90 ms | 5.03% | 3.84% |
| INPUT completo (8 capas) @700 ms | 16.68% | slot 07: 14.90% |

### Polaridad 180

Render offline del buffer real con `GainNode.gain = −1`:

- Correlación con la señal original: **−0.9999999999993**
- Peak: 1.0

La inversión de polaridad de 180° funciona. Los 90°/260° quedan como UI en el prototipo; el motor C++ real los implementará con all-pass/Hilbert (no hay DSP de fase en Web Audio).

## 5. Bugs encontrados y corregidos

1. **Settings no abría**: faltaba todo el CSS de `.settings-menu`.
2. **`classList.toggle('on solo')` inválido**: cortaba `updateInspector`; separado en dos toggles.
3. **TDZ de audio**: `detectInputHits` y el knob OUTPUT accedían a variables `let` antes de inicializarse. Se movieron las variables de audio al inicio y se agregó `audioReady`.
4. **Archivo real fuera de FILE SEARCH**: quedaba después de los primeros 500; ahora el sample real se ordena primero y se muestran hasta 1200.
5. **Pestaña TRIGGER no se ocultaba**: estaba fuera de `.app`; se movió adentro.
6. **Hover con carreras**: reemplazado por apertura al arrastrar/tab y cierre al clickear el Universe.
7. **Editor**: tabs reordenados SAMPLE → ENVELOPE → TONE → SLOT; SLOT solo auto-phase (sin Level/Pan/Tune/Mute/Solo/Pol); 180° recíproco con el badge y Ø; badges 90°/180°/260°.

## 6. Limitaciones actuales

- 90°/260° no se aplican al audio del prototipo (solo 180° polaridad). El DSP real va en el motor C++.
- El auto-phase del prototipo es simulado; el diseño real (GCC-PHAT + offset con límite de lookahead) está en `docs/auto_phase.md`.
- Tone/Cut del prototipo usan biquads aproximados; velocity no se usa en el preview.
- El motor C++ del plugin no se puede compilar (faltan Xcode completo, CMake y SDKs VST3); sí se compilaron y ejecutaron los headers DSP con CommandLineSuite.
- El contexto de audio remuestrea a 44.1 kHz; el WAV es 48 kHz.

## 7. Recomendación

- Para escuchar solo los **12 golpes principales** de este archivo: Sens ~20, Retrig 250, Detail bajo.
- Para detectar ghosts/flams: Sens 45–70, Retrig 50, Detail 50 (default actual).
- El siguiente paso de audio real es implementar el auto-phase GCC-PHAT y el phase shift 90/260 en el `SlotEngine`/plugin C++, y validar con este snare y una segunda capa.
