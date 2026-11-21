# Fase 0 — Informe de auditoría del Trigger existente

Proyecto auditado: `~/Desktop/DrumTrig-main` (DrumReplacer).
Fecha: 20/11/2026. Solo lectura: no se modificó el código original.

## 1. Resumen ejecutivo

El código existente **es una base sólida y reutilizable**. No es un prototipo descartable:

- Motor de detección de transientes completo y funcionando.
- 8 slots con 8 voces cada uno, disparados por el mismo golpe (capas), con carga de WAV y swap lock-free.
- 132 parámetros nativos, todos automatizables.
- Estado versionado que guarda los 8 samples y todos los parámetros.
- UI WebView (HTML/CSS/JS) con 4 paneles y 8 strips.
- 3 tests DSP que **pasan** en esta máquina.

Lo que **no existe** y hay que construir: biblioteca indexada, Universe 2D, browser de samples, editor de sample, presets `.drp`, formatos AU/CLAP, y los controles de fase/alineación temporal por slot.

**Conclusión:** conservar el motor iPlug2 y construir encima. Migrar a JUCE implicaría reescribir lo que el brief pide expresamente auditar y reutilizar.

## 2. Qué es el código actual

| Aspecto | Hallazgo |
| --- | --- |
| Lenguaje | C++17 |
| Framework | iPlug2 snapshot 1.0.0 vendorizado en `_iPlug2/` (sin `.git`, no se puede fijar commit) |
| Formatos configurados | **VST3 solamente** en `DrumReplacer/CMakeLists.txt:26`. El `.xcodeproj` conserva targets VST2/AU/AUv3/AAX/APP, pero no son el build real |
| UI | WebView iPlug2, **HTML/CSS/JS plano** (sin React, sin bundler) |
| Slots | **8**, cada uno con **8 voces** (`DrumReplacer.h:13`, `DSP/SlotEngine.h:96`) |
| Disparo | Todos los slots con sample suenan en **cada** golpe: son capas, no alternativas (`DrumReplacer.cpp:243-250`) |
| Samples | WAV en RAM, precargados; swap atómico sin locks |
| Parámetros | **132** = 28 globales + 8 × 13 (`DrumReplacer.h:79-80`) |
| Estado | Chunk versionado v2: versión + baseDir + presetName + 8 paths + 132 params |
| Presets | No hay `.drp`; solo un preset default de fábrica |
| Tests | 3 tests sin framework; **los 3 pasan** |

## 3. Motor de trigger (lo que ya funciona)

### 3.1 Detección

`DSP/TransientDetector.h` implementa:

1. Mono `(L+R)/2 × Input Gain`.
2. High-pass (Low Cut) y low-pass (High Cut) de 2º orden (RBJ, Q=0.707).
3. `|x|` → envolvente rápida (ataque instantáneo, release 5 ms) y lenta (promedio 50 ms).
4. Disparo cuando: rápida > umbral **y** rápida > lenta × k **y** rápida > umbral de supresión.
5. Ventana de captura de pico de **5 ms**; el hit se reporta al final con velocity.
6. Re-arma tras Retrigger y cuando la señal cae a la mitad del umbral.

Mapeos:

| Control | Implementación |
| --- | --- |
| Sensitivity | 0 % = −6 dBFS, 100 % = −60 dBFS |
| Detail | 0 % = k 6 (solo golpes claros), 100 % = k 1.5 (ghost notes) |
| Retrigger | 0–1000 ms |
| Suppression | % del pico del golpe anterior, decae con τ=50 ms |
| Velocity | mapa fijo de 40 dB bajo 0 dBFS, clamp 0.05–1 |
| Latencia | 5 ms reportados al host con `SetLatency`; el seco se retrasa igual |

**No existe “Hold” en el detector.** Lo más cercano es la ventana fija de 5 ms y el estado de retrigger. El gate sí tiene “Sustain”.

### 3.2 Slots y voces

- `Slot` tiene 8 voces y roba la más vieja cuando se agota (sin fade → puede clickear).
- `SamplerVoice` lee con interpolación lineal, aplica offset sample-accurate, velocity, attack, sustain-fraction y release.
- El pitch se implementa cambiando la velocidad de lectura (`tune` ±24 st) y compensando el sample rate del archivo.
- `SetSample` / `SwapIfPending` / `CollectGarbage`: handoff lock-free; el sample viejo se libera en `OnIdle`.

### 3.3 Tiempo real

Verificado: **no hay I/O de disco, allocations ni locks en el audio callback**.

- Buffers `mWet` y `mDelay` se dimensionan en `OnReset`.
- Hits en array fijo `mHits[64]`; `std::sort` sobre POD en stack.
- Carga de samples en hilo de UI/host; swap atómico.
- Comunicación a UI por `std::atomic` + `OnIdle`.

Deuda conocida (audible, no de timing): cortes sin fade al cambiar sample o robar voz, y el último frame del sample no se reproduce.

## 4. Parámetros actuales

### 4.1 Globales (28)

| # | Nombre | Default | Rango | Estado |
| --- | --- | --- | --- | --- |
| 0 | Sensitivity | 45 % | 0–100 % | OK |
| 1 | Retrigger | 50 ms | 0–1000 ms | OK |
| 2 | Detail | 50 % | 0–100 % | OK |
| 3 | Mode | 0 | 0–3 | **sin uso** |
| 4 | Low Cut | 30 Hz | 20–20000 Hz | OK |
| 5 | High Cut | 15 kHz | 20–20000 Hz | OK |
| 6 | Suppression | 50 % | 0–100 % | OK |
| 7 | Input Gain | 0 dB | −24…24 dB | OK |
| 8 | Output Gain | 0 dB | −24…24 dB | OK |
| 9 | Mix | 100 % | 0–100 % | OK |
| 10–13 | Gate On / Attack / Sustain / Release | off / 1 ms / 0 % / 100 ms | — | OK (Pro) |
| 14–19 | MIDI In/Out (enable, note, channel) | In on, C1, ch10 | — | OK |
| 20–27 | 8 links entre slots | false | — | **sin uso** |

### 4.2 Por slot (13 × 8)

| Parámetro | Default | Rango | Estado |
| --- | --- | --- | --- |
| Volume | 0 dB | −70…6 dB | OK |
| Pan | 0 % | −100…100 % | OK |
| Tune | 0 st | −24…24 st | OK |
| Attack | 0 ms | 0–2000 ms | OK |
| Release | 500 ms | 0–5000 ms | OK |
| Sustain | 100 % | 0–100 % | OK (fracción del sample, no ADSR clásico) |
| Velocity Curve | 50 % | 0–100 % | OK |
| Dynamics Curve | 100 % | 0–100 % | OK |
| Range Top | 100 % | 0–100 % | **sin uso** |
| Range Bottom | 0 % | 0–100 % | **sin uso** |
| Phase Invert (Ø) | false | bool | OK |
| Solo | false | bool | OK |
| Mute | false | bool | OK |

**No existe:** Decay, Start/End, Fade In/Out, Phase Offset/Align, velocity layers, articulación, loops.

## 5. Mapeo contra el brief v0.2

| Requisito del brief | Estado actual | Trabajo |
| --- | --- | --- |
| Motor de trigger reutilizado | ✅ Completo | Auditar/mapear (hecho) |
| 8 slots como capas del mismo golpe | ✅ Completo | Mantener |
| Level, Pan, Tune, Mute, Solo, Ø por slot | ✅ Completo | Mantener |
| ADSR por slot | ⚠️ Parcial (A/S/R, sin Decay) | Agregar Decay o ADSR real |
| Phase Align / offset por slot | ❌ No existe | Implementar delay por slot + sync UI |
| Flip All Polarity global | ❌ No existe | Implementar |
| Waveform de entrada + eventos | ❌ No existe | UI + datos del detector |
| 8 faders visibles | ⚠️ Hay 8 strips de knobs, no faders | Rediseñar mixer |
| Drag & drop de sample a slot | ❌ No existe | Implementar |
| Start/End y fades | ❌ No existe | Implementar en editor |
| Editor de sample no destructivo | ❌ No existe | Construir |
| Universe 2D (X duración, Y frecuencia) | ❌ No existe | Construir análisis + mapa |
| Búsqueda, filtros, favoritos, historial | ❌ No existe | Construir índice |
| Similitud tímbrica | ❌ No existe | Features + métrica |
| Browser clásico de carpetas | ❌ No existe (solo diálogo nativo) | Construir |
| Múltiples carpetas/discos | ❌ No existe | Indexador multi-root |
| Bancos virtuales | ❌ No existe | Modelo de datos |
| Missing files / relocalizar | ⚠️ Parcial (path se conserva) | UI + relink |
| Presets `.drp` | ❌ No existe | Preset manager |
| AU como primer formato | ❌ Solo VST3 configurado | Agregar target AU |
| Escaneo/análisis en background | ❌ No existe | Threads + cola |
| Cero I/O en audio thread | ✅ Cumple | Mantener |

## 6. Respuestas a las preguntas de la auditoría (brief §15)

1. **¿Lenguaje/framework y versión de JUCE?** C++17 + **iPlug2 1.0.0** (no JUCE). El original reverse-engineered en `plug.md` sí era JUCE 2.1.9.
2. **¿Los 8 slots son capas del mismo transitorio?** Sí. Todos los slots con sample se disparan en cada hit. Confirmado en `DrumReplacer.cpp:243-250`.
3. **¿Cómo se cargan los samples y qué formatos?** WAV únicamente, precargados en RAM. PCM 16/24/32 y float 32/64. Sin AIFF/FLAC/MP3/CAF ni `.dri`.
4. **¿Qué parámetros están implementados y son automatizables?** Los 132 existen y son automatizables; 10 están definidos pero sin uso (Mode, 8 links, Range Top/Bottom).
5. **¿Cómo se guarda/restaura el estado?** Chunk versionado v2 con versión, baseDir, presetName, 8 paths y todos los params. Sin archivos de preset.
6. **¿Qué GUI conviene conservar?** La arquitectura WebView y el bridge iPlug2. El layout actual (4 paneles + 8 strips) se reemplaza por el layout del brief.
7. **¿Qué indexación se adapta?** No hay ninguna. Propuesta: SQLite + escaneo incremental en background, con cache de features y waveforms.
8. **¿Qué pitch detection y fallback?** No hay. Propuesta: YIN/autocorrelación para tonales; centroide espectral y flatness para percusivos/ruido.
9. **¿Qué versión permite WebView estable?** No aplica: iPlug2 WebView ya funciona. Si se migrara a JUCE, la referencia XO usa JUCE 8.0.7 + WebKit.
10. **¿Riesgos de memoria/latencia/host?** Faltan SDKs y Xcode; no hay build universal configurado; clicks en robo de voz; no hay Decay ni phase offset; AU no compilado; presets y browser ausentes.
11. **¿El motor permite offset negativo?** Hoy no hay offset. El detector ya usa 5 ms de lookahead y el seco se retrasa igual, así que un offset negativo pequeño es viable dentro de ese lookahead. El rango exacto debe definirse tras implementar y medir.
12. **¿Cómo evitar clicks y visualizar alineación?** Aplicar polaridad/offset con crossfade o en límites de bloque, y mostrar waveform de entrada + sample con marcadores de transitorio y offset.

## 7. Contradicciones documentación ↔ código

| Documento | Dice | Realidad |
| --- | --- | --- |
| `CLAUDE.md` | 8 slots, 132 params, VST3 | ✅ correcto |
| `fases.md` | 16 slots, 228 params | ❌ plan viejo, superado por v2 |
| `CLAUDE.md` | build con `./scripts/build-mac.sh` | ❌ el script **no existe** |
| `CLAUDE.md` | validador VST3 en `VST3_SDK/validator` | ❌ el SDK **no está** en el zip |
| `CLAUDE.md` | universal arm64 + x86_64 | ⚠️ no hay setting universal; `ARCHS_STANDARD_64_BIT` |
| `plug.md` | original v2.1.9, 16 slots, `.dri`/TCI | Es la spec del original; el código recreado no lo implementa |
| `DrumReplacer/README.md` | “basic volume control effect” | ❌ texto de plantilla, desactualizado |

## 8. Tests ejecutados

```bash
cd DrumReplacer/tests
clang++ -std=c++17 -I.. slot_engine_test.cpp -o /tmp/dr_slot && /tmp/dr_slot
clang++ -std=c++17 -I.. detector_test.cpp  -o /tmp/dr_det  && /tmp/dr_det
clang++ -std=c++17 -I.. dynamics_test.cpp   -o /tmp/dr_dyn  && /tmp/dr_dyn
```

Resultado:

```
slot_engine_test: OK
detector_test: OK   (5 hits, desvío ≤ 0.05 ms)
dynamics_test: OK
```

## 9. Riesgos principales

1. **Entorno incompleto:** sin Xcode, cmake, node ni SDKs de VST3/CLAP. Bloquea compilar y validar.
2. **Migración de framework:** cambiar a JUCE sería reescribir el motor ya probado. Riesgo alto e innecesario para el MVP.
3. **Phase offset:** requiere diseño cuidadoso para no clickear y para definir offsets negativos.
4. **ADSR:** el motor actual no tiene Decay; el brief pide ADSR. Hay que decidir si se agrega o se reinterpreta.
5. **Rendimiento del Universe:** análisis de miles de samples no puede tocar el audio thread ni bloquear la UI.
6. **Escalabilidad del índice:** múltiples discos, archivos movidos y missing files necesitan un modelo de datos claro desde el día uno.
7. **Licencias/legal:** el brief prohíbe copiar código, assets ni diseño de XO/Slate. El análisis de XO debe ser funcional, no de extracción.

## 10. Recomendación

1. **Conservar iPlug2** y el motor actual.
2. **Agregar AU + VST3** como formatos objetivo; AAX después.
3. **Construir la biblioteca y el Universe** como módulos nuevos, sin tocar el audio callback.
4. **Extender el motor de slots** con Decay, Start/End, fades y Phase/Align.
5. **Rediseñar la UI** con React + TypeScript (o JS plano si se prioriza velocidad), manteniendo el bridge iPlug2.

El plan detallado y las decisiones que necesitan tu aprobación están en `02_arquitectura_y_plan.md`.
