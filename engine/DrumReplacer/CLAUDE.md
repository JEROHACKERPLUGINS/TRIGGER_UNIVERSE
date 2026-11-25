# CLAUDE.md — DrumReplacer

## Qué es

Drum replacer construido sobre iPlug2 (`../_iPlug2`) con UI WebView (HTML/CSS/JS). Detecta los golpes de una pista de batería y dispara samples en hasta **8 slots** en paralelo (capas), alineados con el original. Recreación de la funcionalidad descrita en `../plug.md`. Plan por fases en `../fases.md`.

- **Formato actual:** solo **VST3 en macOS** (universal arm64 + x86_64). AU/CLAP/AAX quedan para la Fase 7.
- **DAW de prueba:** Ableton Live 12. Logic y Pro Tools no cargan VST3.
- **Estado:** Fases 0–5 hechas. De la Fase 4 solo el gate y las curvas (sin capas por velocity ni links entre slots, a pedido).

## Build

```bash
./scripts/build-mac.sh            # Debug
./scripts/build-mac.sh Release
```

El script compila el scheme `macOS-VST3` con `xcodebuild`, **firma** (Developer ID si está en el keychain, si no ad-hoc), verifica la firma con `codesign --verify` y corre el validador de Steinberg. Instala en `~/Library/Audio/Plug-Ins/VST3/DrumReplacer.vst3`.

**Compilá siempre con el script, no con `xcodebuild` a mano.** El proyecto Xcode tiene `CODE_SIGN_IDENTITY = ""`, y pisa al xcconfig. Sin el script, el bundle queda solo con la firma del linker, que no cubre `Resources/web`. Ableton lo rechaza con `code has no resources but signature indicates they must be present` y no aparece en el browser. Su log de escaneo está en `~/Library/Preferences/Ableton/Live 12.x/PluginScanner.txt`.

Validador VST3: `../_iPlug2/Dependencies/IPlug/VST3_SDK/validator` (se compiló con `download-vst3-sdk.sh master build-validator`, requiere `cmake` de brew).

## Archivos

| Archivo | Qué hace |
|---|---|
| `config.h` | Macros de iPlug2 (nombre, IDs propios `BQ5P`/`MyCo`, `PLUG_DOES_STATE_CHUNKS 1`, 1000×680) y `DRUMREPLACER_PRO` |
| `DrumReplacer.h/.cpp` | Clase del plugin: params, estado, `ProcessBlock`, MIDI, mensajes con la UI |
| `DSP/TransientDetector.h` | Detector de golpes |
| `DSP/SlotEngine.h` | `SampleData`, `SamplerVoice`, `Slot` (8 voces por slot, swap lock-free de samples) |
| `DSP/Dynamics.h` | `ShapeVelocity` (curvas VELO/DYN) y `HitGate` |
| `DSP/WavFile.h` | Lector WAV copiado de LReverb (`LoadWavFile`), mantener ambos en sync |
| `DSP/PretrainedClassifier.h` | Clasificador de tipo de sample pre-entrenado (gradient-boosted trees). Reemplaza a las reglas de `ClassifyDrum` cuando su prob ≥ `kSure`. Lo usan `AnalyzeWav` y el paso de clasificación de la librería. El resultado se guarda por archivo en la librería (`pc` = tipo o −1, `pm` = `kModelId`) y se recalcula, en paralelo y desde el fingerprint guardado, solo para los archivos con otro `pm`: tras reentrenar, la primera pasada lo hace una vez y las siguientes no cuestan nada |
| `DSP/PretrainedWeights.h` | **Generado** por `../../ml/train.py`, no editar a mano. Con `kReady = false` todo sigue con las reglas. Ver `../../ml/README.md` |
| `resources/web/index.html, style.css, ui.js` | UI |
| `resources/web/script.js` | Puente JS de iPlug2 (no tocar) |
| `scripts/build-mac.sh` | Build + firma + validador |
| `tests/*.cpp` | Tests sin framework (ver abajo) |
| `samples/` | 4 samples one-shot (kick, snare, 2 toms) |
| `samples/realdrums/` | 4 pistas reales de la misma batería (mono, 48 kHz, 168 s): kick in, snare up, tom 1, tom 2 |

## Cadena de audio (`ProcessBlock`)

```
input ──► TransientDetector ──► hits (offset, velocity)
  │                               │
  │                               ├─► MIDI Out (nota de 10 ms)
  │                               ├─► HitGate (abre con cada golpe)
  │                               └─► 8 slots: ShapeVelocity(VELO, DYN) → Trigger
  │                                                                         │
  └─► delay = latencia ─► × Input Gain × gate ─► (1 − Mix) ─┐               ▼
                                                            ├─► × Output Gain ─► out
                                    wet (suma de slots) × Mix ┘
```

1. **Detector:** mono `(L+R)/2 × Input Gain` → HP (Low Cut) → LP (High Cut) → `|x|` → envolvente rápida (ataque instantáneo, release 5 ms) y lenta (promedio 50 ms). Arranca un golpe cuando:
   - rápida > umbral (Sensitivity: 0% = −6 dBFS, 100% = −60 dBFS)
   - rápida > lenta × k (Detail: 0% → k=6, 100% → k=1.5)
   - rápida > umbral de supresión (Suppression: % del pico del golpe anterior, decae con τ=50 ms)
2. **Ventana de pico:** captura el pico durante 5 ms y recién ahí reporta el golpe, con velocity = pico mapeado en 40 dB por debajo de 0 dBFS. Re-arma después de Retrigger y cuando la señal cae a la mitad del umbral (evita disparos dobles en colas largas).
3. **Latencia:** esos 5 ms se le informan al host con `SetLatency` y el seco se atrasa lo mismo, así que el sample cae justo en el inicio del golpe. **Al cambiar la latencia, Ableton necesita que saques y vuelvas a poner el plugin.**
4. **Hits programados:** `mHits[]` guarda cada golpe con un `countdown` en samples desde el inicio del bloque. Los de MIDI In se programan `offset + latencia`, para que suenen alineados igual que los detectados. En cada bloque se toman los que vencen, se ordenan por offset y se disparan.
5. **Slots:** todos los slots con sample suenan en cada golpe (son capas del mismo tambor). Por slot: vol, pan (equal power, unidad al centro), tune (cambia la velocidad de lectura con interpolación lineal; también compensa el sample rate del archivo), attack, sustain (% del sample que suena antes del fade), release, Ø (invierte fase), solo, mute.
6. **Mix:** con 100% solo suena el reemplazo. Input Gain, Output Gain y Mix tienen smoothing de 20 ms.

**Mode** (`kDetectorMode`) existe pero **no hace nada**: no sabemos qué hacen los modos del original.

### Gate (Pro)

`HitGate` actúa sobre el **seco** (la señal original), no sobre los samples: cada golpe lo abre en Attack, después cierra en Release hasta el piso Sustain (0% = mute entre golpes). Sirve para limpiar el bleed cuando se baja el Mix. Es una interpretación propia del Attack/Sustain/Release del original. Solo corre si `DRUMREPLACER_PRO` es 1; con 0, la UI muestra el panel gris con el tooltip del original.

### Curvas (por slot)

`ShapeVelocity(v, VELO, DYN)`:
- **VELO:** exponente `2^((50 − VELO)/25)`. 50% lineal, 100% → v^0.25 (levanta los suaves), 0% → v^4.
- **DYN:** `1 − dyn + dyn × curva`. 100% rango completo, 0% todos los golpes al máximo.

## Parámetros

Índices estables: **no reordenar**, rompe las sesiones guardadas. Si hay que agregar params globales, van al final del bloque global y obligan a subir `kStateVersion`, porque corren los índices de los slots.

- **0–27 globales:** Sensitivity, Retrigger, Detail, Mode, Low Cut, High Cut, Suppression, Input Gain, Output Gain, Mix, Gate On/Attack/Sustain/Release, MIDI In On/Note/Channel, MIDI Out On/Note/Channel, 8 links (definidos pero sin usar).
- **28+ slots:** `SlotParam(s, p) = kSlotBase + s × 13 + p`, con p = Vol, Pan, Tune, Attack, Release, Sustain, VeloCurve, DynCurve, RangeTop, RangeBottom, Phase, Solo, Mute. RangeTop/Bottom están definidos pero sin usar.
- **Total:** 28 + 8 × 13 = 132.

Defaults a tener en cuenta:
- **Sensitivity 45%** (≈ −30 dBFS). Con las pistas reales de `samples/realdrums`, el 70% original (−44 dBFS) disparaba con el bleed: el kick daba 320 golpes en vez de 193, y los toms 340 en vez de unos 15. Los toms piden más alto que el kick (≈ −25 dB).
- **MIDI In encendido**, nota C1 (36) en canal 10. Notas con C3 = 60, como Ableton.

## Estado (`SerializeState`)

Orden en el chunk: `kStateVersion` (int) → `mBaseDir` → `mPresetName` → paths de los 8 slots → `SerializeParams`.

- `UnserializeState` rechaza cualquier otra versión, y el host carga los defaults. La v1 tenía 16 slots.
- Al restaurar, cada path se recarga con `LoadSlot`. Si el archivo no existe, el slot queda vacío pero el path se conserva (la UI lo muestra como "(missing)").
- `mBaseDir` y `mPresetName` se guardan pero todavía no se usan (Fase 6).

## Threads

- **Audio thread** (`ProcessBlock`, `ProcessMidiMsg`): sin allocations ni locks. Buffers (`mWet`, `mDelay`) dimensionados en `OnReset`.
- **Carga de samples** (`LoadSlot`, en el hilo de UI o del host): lee el WAV y lo pasa a `Slot::SetSample` (`mPending`, atómico). El audio thread lo toma al principio del bloque (`SwapIfPending`), corta las voces del sample viejo y lo deja en `mRetired`. `OnIdle` lo borra (`CollectGarbage`).
- **Golpes hacia la UI:** el audio thread incrementa `mHitCount` (atómico) y guarda `mLastHitVelocity`. `OnIdle` (cada 20 ms) compara y manda `{"id":"hit"}` si la UI está abierta.
- **Diálogo de archivo:** `PromptForWavFile` usa `osascript` (mismo enfoque que LReverb, porque no hay IGraphics) y bloquea el hilo de UI mientras está abierto. Solo macOS.

## Librería grande (100k+ archivos)

- **Análisis:** varios workers (`min(6, núcleos − 2)`) dentro de `mAnalysisThread`. Cada uno toma archivos con un índice atómico y solo toca los ítems que tomó. `PreviewCache` tiene su propio lock.
- **Guardado:** el JSON de la librería pesa más de 100 MB. Durante el análisis se escribe en `mSaveThread` (`SaveLibrarySettingsAsync`, sobre una copia), como mucho cada `kSaveEverySec` (30 s). Antes se guardaba cada 100 archivos en el hilo de UI y la app quedaba congelada. `SaveLibrarySettings()` (síncrono, espera al de fondo) queda solo para el destructor.
- **UI:** los archivos analizados llegan en un solo mensaje por tick (`analyzedBatch`). El recálculo del layout durante el análisis se espacia con el tamaño de la librería.
- **Mapa denso** (`drawUniverseDense` en `app.js`): con ≥ 3000 puntos en vista no hay halos aditivos (con 100k puntos sumaban a blanco). Los puntos son chicos y su tamaño y opacidad siguen la densidad, así que al hacer zoom crecen, como en XO. Se dibuja un `Path2D` por color y nivel de profundidad.

## UI ↔ C++

- **JS → C++:**
  - Knobs y botones usan `BPCFUI(idx)` / `SPVFUI(idx, normalizado)` / `EPCFUI(idx)` (gesto completo, para la automatización del host).
  - Load y clear usan `SAMFUI(4, slot)` y `SAMFUI(5, slot)` (`kMsgTagLoadSample`, `kMsgTagClearSlot`).
- **C++ → JS:**
  - Valores de params con `SPVFD(idx, normalizado)`. Al abrir la UI los manda todos `Plugin::OnUIOpen`.
  - Mensajes JSON con `SendJSONFromDelegate`; llegan a `OnMessage(-1, size, base64)` y `ui.js` los decodifica como UTF-8:
    - `params`: rangos y defaults (lo manda iPlug2 al cargar la página)
    - `init`: `{pro, numSlots}` (desde `OnUIOpen`)
    - `slot`: `{slot, name, ok}`
    - `hit`: `{vel}`
- **`ui.js`** replica los índices de `EParams` en `P`/`S`: si cambian en C++, hay que cambiarlos ahí. Convierte normalizado ↔ valor con la forma del param (lineal, exp para Hz, int, bool). Los rangos que tiene son solo un fallback para la vista previa; la verdad viene del mensaje `params`.
- **Knobs:** arrastre vertical, Shift para ajuste fino, doble clic vuelve al default.
- En **Debug**, iPlug2 carga `index.html` desde `resources/web` del código fuente (no del bundle): cambios de UI se ven reabriendo la ventana del plugin, sin recompilar. En Release usa el bundle.
- **Vista previa en el navegador:** servir `resources/web` con `python3 -m http.server` (abrirlo como `file://` no carga el CSS ni el JS). Sin plugin, `IPlugSendMsg` loguea en la consola.

## Tests

Sin framework, uno por módulo DSP. Desde `tests/`:

```bash
clang++ -std=c++17 -I.. slot_engine_test.cpp -o /tmp/slot && /tmp/slot
clang++ -std=c++17 -I.. detector_test.cpp -o /tmp/det && /tmp/det
clang++ -std=c++17 -I.. dynamics_test.cpp -o /tmp/dyn && /tmp/dyn
```

- `detector_test` arma un loop con `../samples` (3 kicks y 2 snares a distintos niveles) y exige: cada golpe una sola vez, alineado al inicio (−0.5 a +3 ms) y velocity decreciente con el nivel.
- `slot_engine_test` cubre offset, velocity, fin del sample, swap y release.
- `dynamics_test` cubre las curvas y el gate.
- `pretrained_test` chequea el modelo pre-entrenado. Con los archivos de `ml/` como argumentos (`feat_all.csv predictions.tsv`), exige que el C++ coincida con sklearn.
- Si cambia `RawFeatureRow`, `AnalyzeSample` o `kAnalysisVersion`, hay que reentrenar con `ml/`. Con otra versión el modelo se apaga solo.

Para calibrar con material real, correr el detector sobre `samples/realdrums` y comparar la cantidad de golpes por pista. Si un golpe de una pista coincide con uno de otra y tiene velocity baja, es bleed.

## Pendiente / decisiones abiertas

- **Fase 4 (resto):** capas por velocity, RangeTop/Bottom, links entre slots. Los params ya existen.
- **Fase 6:** presets `.drp`, browser de samples desde `mBaseDir`, preescucha.
- **Fase 7:** AU/CLAP, build Release, notarización, `PromptForWavFile` para Windows.
- **Fase 8 (opcional):** formato `.dri` del original. El layout de `plug.md` es una suposición: hace falta un archivo real.
- **Detector:**
  - Mode sin implementar.
  - El mapeo de velocity es un rango fijo de 40 dB.
  - La ventana de 5 ms es fija.
- **Slot:** el robo de voz y el cambio de sample cortan sin fade (puede hacer click).
- **Bugs conocidos de `_iPlug2` en Windows** (Space congela el DAW, UI recortada con escalado): documentados en el `CLAUDE.md` de LReverb. Esta copia de `_iPlug2` no tiene los fixes; aplicarlos antes de compilar para Windows.
