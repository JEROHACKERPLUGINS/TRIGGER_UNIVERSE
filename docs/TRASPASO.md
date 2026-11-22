# TRASPASO — TRIGGER UNIVERSE

**Fecha:** 20/11/2026
**Propósito:** dejar todo el contexto necesario para retomar el proyecto en un chat nuevo sin perder decisiones, estado ni próximos pasos.
**Documento principal:** este archivo. **Prompt listo para pegar:** [`PROMPT_REINICIO.md`](PROMPT_REINICIO.md).

---

## 1. Qué es

**TRIGGER UNIVERSE** es un plugin de audio que combina tres cosas:

1. El **motor de drum triggering** existente (DrumReplacer / iPlug2).
2. Un **universo visual de samples** estilo XO: nube de puntos, búsqueda, similitud, exploración.
3. Un **mixer de 8 slots** con edición no destructiva por capa.

El usuario busca un sample en HOME o en FILE SEARCH, lo arrastra a uno de los 8 slots del dock, entra a la página TRIGGER para editarlo (sample, ADSR, tone, phase) y el INPUT dispara las capas cargadas.

**No es un beatmaker.** Quedan fuera de alcance: step sequencer, patrones, groove, swing, BPM sync y preset browser.

---

## 2. Estado en una línea

**Fase 0 aprobada. Motor auditado y testeado. Prototipo UI navegable con audio real funcionando. Build del plugin bloqueado por entorno (faltan Xcode completo, CMake, Node y SDK VST3).**

---

## 3. Cómo retomar ahora mismo

### 3.1 Abrir el prototipo

```bash
cd /Users/dante/Desktop/TRIGGER_UNIVERSE/prototype
python3 -m http.server 8765 --bind 127.0.0.1
```

Abrir: <http://127.0.0.1:8765/>

Si el servidor no está corriendo, levantarlo con el comando de arriba. Verificar:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8765/
# 200
```

### 3.2 Probar el audio en 10 segundos

1. Click en el corchete **TRIGGER** (izquierda).
2. Click en **▶ INPUT** dentro de INPUT DETECTOR.
3. Se escucha `SNARE.cm.wav` y se disparan los slots cargados.
4. El meter MASTER de la página y el mini VU de OUTPUT se mueven.
5. Para cargar capas, volvé a HOME o FILE SEARCH y hacé **ALT + drag** de un sample a un slot.

Si no se escucha nada:

- Hacer click dentro de la página (política de autoplay de Chromium).
- Revisar la consola del browser (`tools.browser.console`).
- Confirmar que `prototype/samples/SNARE.cm.wav` existe.
- El `AudioContext` debe estar en `running` (`window.__audio.context.state`).

### 3.3 Handles de debug

En la consola del prototipo:

```js
window.__TU          // estado completo (slots, samples, filtros)
window.__audio       // contexto, hits, buffer, playInput, stopInput, playSlot
window.__audio.hits  // 22 hits detectados por el detector JS
window.__selectSample(sampleObj)
window.__setTriggerOpen(true)
```

---

## 4. Decisiones cerradas

| # | Tema | Decisión |
| --- | --- | --- |
| 1 | Framework | **iPlug2**. Se conserva el motor existente; **no** se migra a JUCE |
| 2 | Formatos | **AU + VST3**. **AAX fuera** por decisión del usuario |
| 3 | UI final | **React + TypeScript** sobre el bridge WebView de iPlug2 |
| 4 | Prototipo | HTML/CSS/JS sin build step, porque no hay Node instalado |
| 5 | Envelope | **ADSR real** (agregar Decay al motor) + fade in/out + start/end/trim. **Sin time-stretch** |
| 6 | Fase | **Ø = 180°** (polaridad). **Phase shift separado**: 0° / 90° / 180° / 260° |
| 7 | Auto-phase | Corre automáticamente al cargar un sample. Por defecto **solo polaridad**; offset en 0 salvo que **TIMING** esté activo |
| 8 | Slots | Dock fijo de 8 recuadros de glass **01–08**, cuadrados y centrados, vacíos al inicio |
| 9 | Editor | Vive dentro de la página TRIGGER y pertenece al slot seleccionado (default SLOT 01). Se abre con doble click en un slot (o click en uno vacío); el click en un slot lleno audiciona |
| 10 | Paneles del editor | **SAMPLE / ENVELOPE / TONE / SLOT**, los 4 visibles a la vez en la página TRIGGER |
| 11 | Tab SLOT | Solo **Auto Phase** y sus controles. Sin Level/Pan/Tune/Mute/Solo/Pol |
| 12 | TRIGGER | Tercera página full-screen, se abre con el corchete vertical TRIGGER (izquierda). Contiene INPUT DETECTOR + editor/ADSR + banco de 8 faders. El corchete vuelve a la vista anterior; **Esc siempre vuelve a HOME** |
| 13 | HOME | Vista principal (ex Universe). Full-bleed, nube de puntos 3D abstracta, sin ejes de frecuencia/ms. Search arriba, similitud abajo. **Esc vuelve acá desde cualquier vista** |
| 14 | FILE SEARCH | Árbol tipo Finder con root en la carpeta elegida por el usuario. Subcarpetas reales. Samples reales primero |
| 15 | OUTPUT | Knob arriba a la derecha. Settings funcional. AUTO PHASE ALL vive en Settings |
| 16 | Export | **Eliminado de la UI** por decisión del usuario (20/11); el export real no está implementado |
| 17 | XO | Solo se usó como referencia funcional/UX. **No se copió código, assets ni diseño propietario** |

### 4.1 Hallazgos de XO (referencia funcional)

El análisis de `sample.db` de XO 1.8.10 quedó documentado en [`referencias/XO_sample_db.md`](referencias/XO_sample_db.md). Resumen:

- **8.746 samples**, todos WAV, 44.1 kHz (8.474 estéreo, 272 mono).
- **9 categorías**: Kick 2.473, Snare 1.735, Perc 1.265, HHC 868, FX 573, Clap 562, HHO 527, Tom 380, Cymbal 363.
- Esquema con features: `lengthMs`, `centroid`, `loudness`, `peak`, `druminess`, `lateTransient`.
- **Coordenadas 4D** (`coord_x`, `coord_y`, `coord_z`, `coord_w`), no solo 2D.
- `centroid` normalizado 0–1; `lengthMs` 11.4 ms–27.997 s; `druminess` 0.1–0.996.
- Confirmación de que el Universe de XO se basa en features tímbricas + proyección, no en ejes de duración/frecuencia solamente.
- **No se copió nada**: solo estructura y estadísticas para informar nuestro modelo de datos.

---

## 5. Arquitectura

### 5.1 Motor actual (auditado, no reescrito)

```
Audio in 2ch
  → Input Gain
  → TransientDetector
      → Hits (offset + velocity)
      → MIDI Out
      → 8 Slots × 8 voces
  → Delay 5 ms
  → HitGate sobre el seco
  → Crossfade Dry/Wet
  → Output Gain
  → Audio out
```

Puntos clave:

- El detector reporta el hit **5 ms antes** del pico; esa latencia se declara al host y se compensa en el seco.
- `SlotEngine` ya soporta playback, offset, velocity, tune, release y voice stealing.
- El audio thread no debe leer disco, decodificar, hacer FFT ni esperar a la UI.
- Los samples se preparan fuera del audio thread y se entregan con swap atómico.

### 5.2 Arquitectura objetivo

```
Host (AU / VST3)
  → Plugin iPlug2
      → Audio thread intacto: Detector → 8 Slots → Dry/Wet → Output
      → Bridge iPlug2 (parámetros + mensajes JSON)
      → UI WebView (React + TS): Universe, Browser, Inspector, Mixer, Trigger
      → Background/UI thread:
           Scanner multi-root → SQLite (paths, metadata, features)
           Analyzer (duración, pitch, centroide, etc.)
           Layout 2D + similitud
           Loader de samples a slots
```

### 5.3 Reglas de oro

- Cambios de polaridad/offset se preparan fuera del callback y se aplican sin clicks (crossfade 2–5 ms).
- Medidores/eventos a la UI a ~20 ms, nunca por sample.
- La edición es no destructiva: nunca modifica el WAV original.
- Reemplazar un slot no afecta a los demás.

---

## 6. Estructura del repo

```
TRIGGER_UNIVERSE/
├── README.md                     estado y cómo correr el prototipo
├── docs/
│   ├── TRASPASO.md               este documento
│   ├── PROMPT_REINICIO.md        prompt para chat nuevo
│   ├── Brief_Tecnico_...docx     brief v0.2
│   ├── auditoria/
│   │   ├── 00_entorno.md
│   │   ├── 01_informe_auditoria.md
│   │   └── 02_arquitectura_y_plan.md
│   ├── fase1/modelo_datos.md     esquema SQLite / indexado
│   ├── prototipo_ui.md           decisiones de UI
│   ├── audio_tests.md            pruebas y mediciones
│   ├── auto_phase.md             diseño GCC-PHAT + lookahead
│   ├── pruebas_audio/            tests C++ con el snare real
│   └── referencias/              specs, notas XO, capturas
├── engine/
│   ├── DrumReplacer/             motor iPlug2 original
│   │   ├── DSP/                  TransientDetector, SlotEngine, Dynamics, WavFile
│   │   ├── tests/                tests DSP existentes
│   │   └── ...
│   └── _iPlug2/                  framework
└── prototype/
    ├── index.html
    ├── style.css
    ├── app.js
    └── samples/SNARE.cm.wav
```

**Tamaños aproximados:** `engine/` 185 MB, `prototype/` 2.4 MB, `docs/` 13 MB.
**Git:** commit inicial creado en `main` con los 3.704 archivos del proyecto. Árbol limpio. `.git` ocupa ~122 MB (el contenido staged era ~201 MB). Identidad local usada: `Dante <dante@localhost>`.

---

## 7. Prototipo UI — comportamiento actual

Archivos: `prototype/index.html`, `prototype/style.css`, `prototype/app.js`.
Estética: glassmorphism unificado (search, Trigger Slots, TRIGGER, Settings y OUTPUT comparten gradiente mint, borde e insets), fondo aurora, puntos saturados con halo aditivo y brillo especular.

### 7.1 Layout

- **La app es HOME**: el canvas ocupa el 100% de la ventana, sin padding, borde, radio, fondo de panel ni sombra. El fondo aurora del `body` se ve a través del canvas y los puntos tienen un overscan de 36 px, así que sangran fuera del viewport. No se percibe el final del mapa.
- **La UI flota** sobre ese mapa. Arriba: logo y título **TRIGGER UNIVERSE** centrados; search centrado con toggle folder/universo; **OUTPUT + mini VU vertical** al extremo derecho. En los bordes: **corchete TRIGGER a la izquierda** y **corchete SETTINGS a la derecha**. Abajo: similarity, Trigger Slots y zoom.
- **Search** centrado arriba, sin contorno de panel.
- **Similarity bar** flotante abajo, estilo XO.
- **TRIGGER** es una tercera página full-screen (como HOME o FILE SEARCH). Se abre desde el corchete TRIGGER izquierdo y contiene el detector grande + los 4 paneles del editor a la vez + el banco de faders largos. No tiene fila de título/INPUT/HITS/MASTER.
- **Editor de sample** integrado en la página TRIGGER; ya no es una ventana flotante.
- **Dock de 8 slots cuadrados** siempre visible y centrado abajo, sobre cualquier vista; se llena con ALT + drag desde el browser. En la página TRIGGER, cada slot tiene su fader arriba con meter, M/S/Ø y nivel.

### 7.2 HOME (mapa de samples)

- 1000 samples sintéticos + 1 real (`SNARE.cm`, id 9001).
- Posición: X = duración en log, Y = brightness en log. La nube tiene sensación 3D, sin ejes visibles.
- Hover: el nombre del sample aparece en una **barra sutil abajo** (estilo XO), centrada y sin tooltip flotante. Al salir, vuelve al sample seleccionado.
- Click en un punto: lo selecciona y habilita hover por el mapa (sin arrastrar). **ALT + drag** convierte el sample en una **partícula arrastrable** del mismo tamaño que su punto en HOME, con glow y estela, que sigue al cursor y se imanta a los 8 slots del dock; al soltar vuela al slot y hace burst/impact. Si se suelta fuera de un slot, toast de Finder (demo). El click/hover hace snap al sample más cercano dentro de un aura de 20 px.
- **Rueda:** zoom anclado al cursor (0.7×–6×).
- **Click derecho + arrastrar o Ctrl + click izquierdo + arrastrar:** pan con cursor de mano. Sin auto-pan en bordes.
- **Click izquierdo en vacío:** solo cierra paneles; no mueve la cámara. El pan queda en click derecho o Ctrl+click.
- Botones `−`, `+`, `⤢` para zoom/reset.
- Click en HOME cierra Settings y la barra de similitud. **Esc vuelve siempre a HOME**, desde TRIGGER, FILE SEARCH, Settings o cualquier popover. El corchete TRIGGER sigue recordando la vista anterior.
- **Scrub:** mantener el click y moverse por el mapa reproduce un preview corto de cada sample y dibuja una estela multicolor entre los puntos visitados; al soltar, la estela se desvanece en ~2,4 s.
- **SIMILARITY**: al seleccionar un sample se calculan 33 vecinos por categoría, duración (log), brightness (log) y druminess, con una separación visual mínima para no caer en casi-duplicados. Las flechas `◂ ▸` (o `← →`) recorren la lista; el mapa hace un **seguimiento suave** (solo si el sample queda cerca del borde, dejando libre el dock) y traza una **línea animada** desde el anterior. La barra tiene fade en ambos bordes y se auto-oculta a los 3,5 s sin navegar; se oculta al panear, hacer zoom, abrir TRIGGER/editor, buscar o cambiar de vista.

### 7.3 FILE SEARCH

- Alterna HOME ↔ File Search con el botón del buscador.
- **Rediseño 20/11:** árbol tipo Finder con iconos de carpeta, filas de 24 px y tipografía 10.5 px. Root `ALL SAMPLES` → `SAMPLES FOLDER` → subcarpetas (`Kicks`, `Snares`, `Hats`, `Percussion`, …).
- En el prototipo los paths son sintéticos; el sample real aparece primero.
- Lista con filas altas (11.5 px): solo **nombre + duración + punto de categoría**, sin columnas CAT/BRIGHT. Path con contador a la derecha.
- Búsqueda global por texto (nombre, categoría, carpeta, path), flotante arriba; la lista arranca debajo para no tapar la cabecera.
- **FAVORITES** es un nodo fijo arriba del árbol. El corazón de cada fila (y el de la barra de similitud) agrega/quita favoritos, que se persisten en `localStorage`.
- Click en una fila: selecciona y **reproduce el audio al instante**; no hay botón Audition. El preview inferior solo muestra categoría y duración.
- Al entrar a FILE SEARCH, TRIGGER, INPUT DETECTOR y el editor se cierran con una animación de salida (fade + slide).
- Drag de una fila a un slot del dock.
- Hasta 1200 filas visibles; contador real.
- `CHANGE` muestra un toast demo: en el plugin abrirá selector nativo de carpeta.

### 7.4 Editor de sample

Vive dentro de la página TRIGGER. Corresponde al slot seleccionado. Header con `SLOT 01`, nombre, metadata y grip de drag.

Paneles (visibles a la vez en la página TRIGGER):

1. **SAMPLE**
   - Waveform real del sample del slot.
   - Handles arrastrables de **start / end / fade in / fade out**.
   - Readout en ms.
   - **▶ Audition**, **Reverse** (real en Web Audio), **Normalize** (toast demo).
   - Drag desde la waveform a otro slot.
2. **ENVELOPE**
   - ADSR editable con handles.
   - Readout A/D/S/R y botón Reset.
3. **TONE**
   - TONE (−100…+100), CUT (0–100%), VEL SENS, GAIN.
   - PLAYBACK: ONE SHOT / GATE; LOOP.
4. **SLOT**
   - Solo **AUTO PHASE**:
     - REF: INPUT / SLOT 1.
     - **RE-ANALYZE & ALIGN**.
     - **TIMING** on/off.
     - Resultado: `corr`, polaridad, offset o `suggested`.
     - OFFSET manual (−5…+50 ms).
     - SHIFT: 0° / 90° / 180° / 260°.

**Fase y badges:** 180° = Ø. El botón Ø y el segmento 180° son recíprocos. Los badges de fase se mantienen en el editor.

### 7.5 TRIGGER (página)

- Tercera página full-screen, como HOME o FILE SEARCH. Se abre con el **corchete TRIGGER** izquierdo; se vuelve con el mismo corchete (recuerda la vista anterior).
- Sin fila de header: se quitaron título, INPUT, HITS y MASTER. El contenido arranca arriba; el corchete TRIGGER activo identifica la página.
- **INPUT DETECTOR** a la izquierda, más grande: waveform del INPUT real (≈205 px de alto en 717 px de ventana), 8 knobs compactos en una sola fila (Sens, Retrig, Detail, Low, High, Supp, Input, Output), GATE, **▶ INPUT**, MIX.
- **Editor de sample** a la derecha con los **4 paneles visibles al mismo tiempo**: SAMPLE y ENVELOPE/ADSR arriba; TONE y SLOT abajo. El ADSR tiene ≈158 px de alto.
- **Banco de 8 faders** arriba del dock, alineado columna a columna con los slots:
  - Fader vertical largo (≈116 px), meter real, M/S/Ø, nivel dB y badge de fase.
  - Click en un fader selecciona el slot para el editor.
- **Dock de 8 slots cuadrados** abajo, siempre visible en todas las vistas:
  - Recuadros de glass `01`–`08`, cuadrados y centrados, vacíos al inicio.
  - ALT + drag desde HOME o FILE SEARCH para asignar; el × vacía el slot. Click en un slot lleno **audiciona** su sample; doble click lo abre en TRIGGER.
  - Click en un slot abre la página TRIGGER con ese slot cargado.
  - Nombre, dot de categoría y duración cuando tiene sample.

### 7.6 Settings / OUTPUT

- **OUTPUT knob** al extremo derecho: arrastrar verticalmente, −24…+6 dB, aplica al master gain real. Al lado tiene un **mini VU vertical** de salida, alimentado por el analizador master.
- **Settings**: se abre desde el corchete vertical derecho; el menú aparece a su izquierda y el corchete se resalta mientras está abierto. Contiene AUTO PHASE ALL, FLIP ALL POLARITY, LIBRARY FOLDERS…, AUDIO / MIDI…
  - AUTO PHASE ALL re-analiza las 8 capas.
  - FLIP ALL invierte polaridad en los 8 slots.
  - Los otros dos son toasts demo.
- **AUDIO TEST y LED eliminados** de la barra: el audio se inicia con **▶ INPUT**, al clickear un sample de HOME, una fila de FILE SEARCH o un Trigger Slot cargado.

---

## 8. Audio real en el prototipo

### 8.1 Archivo

`prototype/samples/SNARE.cm.wav` (copiado de `~/Desktop/SNARE.cm.wav`).

| Dato | Valor |
| --- | --- |
| Duración | 8.1489 s |
| Canales | 2 |
| Sample rate | 48000 Hz |
| Bit depth | 24-bit PCM |
| Peak | 0.00 dBFS |
| RMS | −21.34 dBFS |

No es un solo hit: es una **secuencia de snare** con 11 golpes principales, ghosts/flams y un transiente final en ~8.14 s.

### 8.2 Qué está cableado

- `decodeAudioData` carga el WAV; el contexto lo remuestrea a 44.1 kHz.
- **Primer golpe** recortado de 0.14 s a 0.65 s (0.51 s) → sample del **slot 01**.
- **Archivo completo** → **INPUT** del trigger.
- Waveform del editor: real. Waveform de INPUT: real, con marcas de los transientes detectados.
- 8 capas Web Audio, cada una con:
  - playbackRate (tune),
  - start/end,
  - fades in/out,
  - ADSR (attack/decay/sustain/release),
  - gain por slot,
  - lowpass (cut) + high shelf (tone),
  - pan,
  - mute/solo,
  - polaridad 180° como gain −1.
- Meters master y por slot con `AnalyserNode`.
- OUTPUT knob aplica al master gain.
- **▶ INPUT** reproduce el archivo completo y dispara las 8 capas en cada hit detectado.

### 8.3 Limitaciones del prototipo

- **90° y 260° no se aplican al audio**: solo se guardan y se muestran. El DSP real va en C++ (all-pass / Hilbert).
- **180° sí se aplica** como inversión de polaridad (gain −1).
- El **auto-phase es simulado**: lag/polaridad/confianza determinísticos por `sample.id`. La UX es real; el análisis no.
- **Offsets negativos no se aplican** en Web Audio: `scheduleSlot` usa `Math.max(0, s.offset)`. El rango de UI es −5…+50 ms.
- **Velocity** no se usa en el preview.
- **Normalize** es un toast demo.
- **ALT + drag fuera de un slot** muestra el toast de export a Finder; el drag real al Finder queda para el plugin.
- **Similitud**: usa features sintéticas (categoría, duración, brightness, druminess), no análisis tímbrico del audio. La línea y el paneo suave son efectos de navegación.
- **ONE SHOT / GATE** se guarda pero el scheduler no distingue el modo gate.
- El motor C++ no se puede compilar como plugin (faltan SDKs); los headers DSP sí se compilan y testean.

---

## 9. Pruebas ejecutadas

### 9.1 Motor C++ — TransientDetector

Compilado con `clang++ -std=c++17 -I engine/DrumReplacer` y CommandLineTools.

| Configuración | Hits |
| --- | --- |
| Defaults (Sens 45, Retrig 50, Detail 50, Supp 50) | **23** |
| Retrig 250 ms | **17** |
| Detail 0 | **17** |
| Sens 20 | **12** |
| Sens 70 | **22** |

Con defaults detecta los golpes principales y también ghosts/flams. Con **Sens 20 + Retrig 250 + Detail bajo** quedan los **12 principales**.

### 9.2 Motor C++ — SlotEngine

| Prueba | Resultado |
| --- | --- |
| Playback exacto ratio 1, gain 1, velocity 1 | **maxErr 0.000e+00**, peak 1.000 |
| Offset 100 + velocity 0.5 | pre 0.000, err 0.000 |
| Tune +12 st (ratio 2) | err 0.000 |
| Release: sustain 2%, 10 ms | 0.155 s amp 0.7987 → 0.175 s 0.0000 → 0.25 s 0.0000 |
| Voice stealing (9 triggers, 8 voces) | render sin crash, peak 0.033 |

### 9.3 Web Audio

| Prueba | Master | Slot 01 |
| --- | --- | --- |
| Audition normal (Level −3, ataque 0) @130 ms | 11.33% | 8.26% |
| Level −60 dB | 2.35% | 3% (idle) |
| Mute | 0% | 3% (idle) |
| Ataque 400 ms @90 ms | 5.03% | 3.84% |
| INPUT completo (8 capas) @700 ms | 16.68% | slot 07: 14.90% |

**Polaridad 180°:** correlación offline con la señal original **−0.9999999999993**, peak 1.0. Verificado.

**Detector JS:** 22 hits con defaults (el C++ detecta 23; difiere en el transiente final 8.141 s). Con Retrig 250: 16. Con Sens 20: 12.

### 9.4 Cómo repetir los tests C++

```bash
cd engine/DrumReplacer
clang++ -std=c++17 -I. ../../docs/pruebas_audio/snare_detector_test.cpp -o /tmp/snare_det_test
/tmp/snare_det_test

clang++ -std=c++17 -I. ../../docs/pruebas_audio/snare_slot_test.cpp -o /tmp/snare_slot_test
/tmp/snare_slot_test
```

Requieren el WAV en `~/Desktop/SNARE.cm.wav`. Resultados completos en `docs/audio_tests.md`.

### 9.5 Tests DSP originales

Los 3 tests existentes en `engine/DrumReplacer/tests/` pasan:
`detector_test.cpp`, `dynamics_test.cpp`, `slot_engine_test.cpp`.

---

## 10. Auto-phase — diseño

Documento completo: `docs/auto_phase.md`.

### 10.1 Algoritmo propuesto

1. Tomar una ventana corta del sample (primeros 80–200 ms) y de la referencia.
2. Sumar a mono y decimar (ej. 12 kHz).
3. **GCC-PHAT** entre capa y referencia.
4. Buscar el pico dentro del rango de lags permitido.
5. **Polaridad** = signo del pico.
6. **Lag** = posición del pico, refinada con interpolación parabólica.
7. **Confianza** = altura del pico normalizada. Si es baja, no aplicar y avisar.
8. Guardar `offset` y `polarity` por slot.

### 10.2 Referencia

- **INPUT**: transiente de entrada del trigger (default).
- **SLOT 1** (o cualquier slot): alinear capas entre sí.

### 10.3 Límite crítico: lookahead de 5 ms

El motor reporta `TransientDetector::LatencySamples()` ≈ **5 ms**.

- **Delays positivos:** seguros (línea de delay por slot).
- **Adelantos negativos:** solo hasta ~5 ms, o agregando pre-roll/delay global.
- Si el lag excede el rango: clampear y avisar, alinear al último transitorio, o agregar delay global.
- **Regla de producto:** no prometer adelanto negativo que el motor no pueda conservar.

### 10.4 Aplicación sin clicks

- Análisis y preparación fuera del audio thread.
- Offset/polaridad se aplican en el próximo bloque o entre eventos, con crossfade de 2–5 ms.
- No se modifica el archivo original.
- Se guarda en el estado del plugin y se expone a automatización.

### 10.5 Comportamiento en la UI

- Al cargar un sample, auto-phase corre automáticamente contra la referencia configurada.
- Badge de fase del slot: `Ø +3.4ms`, `+1.2ms`, `—`.
- El editor del slot muestra confianza, polaridad, offset y phase shift.
- **AUTO PHASE ALL** re-analiza las 8 capas.

---

## 11. Limitaciones y deuda técnica

### 11.1 Entorno

| Faltante | Impacto |
| --- | --- |
| Xcode completo | No se puede compilar el plugin AU/VST3 |
| CMake | No se puede generar el build |
| Node.js | No se puede construir la UI React final |
| SDK VST3 | No se puede linkear VST3 |
| `scripts/build-mac.sh` | Falta; necesario para firmar recursos WebView del bundle |

AAX **no** se necesita.

### 11.2 Prototipo

- Auto-phase simulado.
- 90°/260° sin DSP.
- Offsets negativos clampeados a 0.
- Velocity no aplicada.
- Gate/one-shot no diferenciados en el scheduler.
- Normalize/folder picker/Audio-MIDI son demos.
- Datos sintéticos: 1000 samples; el árbol no refleja una carpeta real.
- Cache busting manual (`?v=N` en `index.html`); si se edita CSS/JS y no se ve el cambio, subir la versión.

### 11.3 Producto

- Persistencia de biblioteca todavía no implementada.
- Proyección 2D de HOME todavía no usa features tímbricas reales; usa duración y brightness.
- La similitud del prototipo usa features sintéticas; falta similitud tímbrica real (MFCC, centroide, etc.) sobre audio analizado.
- No hay presets ni automatización.

---

## 12. Próximos pasos priorizados

### Paso 0 — Desbloquear el build (primero)

1. Instalar **Xcode completo** desde App Store.
2. `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer`
3. Instalar **CMake** y **Node.js**.
4. Descargar SDK VST3: `engine/_iPlug2/Scripts/download-iplug-sdks.sh` (sin AAX).
5. Recuperar/crear `scripts/build-mac.sh`.
6. Hacer el **build baseline** del VST3 actual y verificarlo en Ableton.
7. Recién después integrar cambios.

### Paso 1 — Biblioteca real (Fase 1)

- Implementar scanner multi-root en background con SQLite.
- Esquema definido en `docs/fase1/modelo_datos.md`.
- Análisis offline: duración, pitch, centroide, rolloff, flatness, RMS/peak, ataque/decay, canales, sample rate.
- Árbol Finder real + búsqueda + favoritos + missing files.
- Audition sin cargar slot.

### Paso 2 — Universe real (Fase 2)

- Proyección 2D con features (no solo duración/brightness).
- Similitud tímbrica.
- Filtros por categoría, rango, fecha, carpeta.
- Zoom/pan y selección ya resueltos en el prototipo.

### Paso 3 — Editor y phase (Fase 3)

- Extender `Slot` con Decay, Start/End, fades, Phase Shift y Align.
- Implementar **GCC-PHAT** en C++ y tests con el snare real + una segunda capa.
- Implementar **90°/260°** con all-pass/Hilbert por slot.
- Validar offsets negativos contra el lookahead.

### Paso 4 — Slots / mixer (Fase 4)

- Drag & drop real desde Universe/Browser.
- Estado único slot ↔ inspector.
- Flip All / Restore.
- Crossfade en cambios de polaridad/offset.

### Paso 5 — Release (Fase 5)

- Presets `.drp`, dirty flag, missing files, automatización.
- AU + VST3, firma/notarización, validación en hosts.
- Rendimiento con bibliotecas grandes.

---

## 13. Preguntas abiertas

1. **Acceso a carpetas** en el sandbox del plugin: ¿security-scoped bookmarks en macOS? ¿Copiar índice a Application Support?
2. **Persistencia**: ¿SQLite embebido o JSON binario? El modelo propone SQLite.
3. **UI final**: ¿WebView de iPlug2 o vista nativa? La decisión aprobada es React + TS sobre WebView.
4. **Nombres/IDs del plugin**: bundle ID, manufacturer code, plugin code, nombre comercial.
5. **Licencia** del motor original y de iPlug2 para distribución.
6. **Formato de preset** `.drp`: compatibilidad con el DrumReplacer original.
7. **Phase shift**: ¿all-pass de primer orden por slot o Hilbert? Validar CPU y estabilidad.
8. **Offset negativo**: ¿clampear a −5 ms o agregar delay global?
9. **Biblioteca por defecto**: ¿escanea toda la carpeta del usuario o solo roots elegidos?
10. **Idioma de la UI**: el prototipo está en inglés; el brief y los docs en español.

---

## 14. Archivos clave

| Archivo | Para qué |
| --- | --- |
| `prototype/index.html` | Estructura del prototipo |
| `prototype/style.css` | Glass UI, HOME, editor, trigger |
| `prototype/app.js` | UI + Web Audio + detector JS |
| `prototype/samples/SNARE.cm.wav` | Sample real |
| `engine/DrumReplacer/DSP/TransientDetector.h` | Detector C++ testeado |
| `engine/DrumReplacer/DSP/SlotEngine.h` | Motor de slots testeado |
| `engine/DrumReplacer/DSP/WavFile.h` | Lectura WAV para tests |
| `docs/audio_tests.md` | Mediciones completas |
| `docs/auto_phase.md` | Diseño de auto-phase |
| `docs/auditoria/02_arquitectura_y_plan.md` | Arquitectura y fases |
| `docs/fase1/modelo_datos.md` | Esquema de biblioteca |
| `docs/prototipo_ui.md` | Decisiones de UI |
| `docs/referencias/XO_sample_db.md` | Esquema y estadísticas de la base de XO |
| `docs/referencias/capturas_prototipo/` | Capturas del prototipo |
| `docs/referencias/capturas_prototipo/11_audio_test_trigger.jpeg` | AUDIO TEST + TRIGGER abierto + meters |
| `docs/referencias/capturas_xo/` | Capturas de referencia XO |

---

## 15. Historial de correcciones importantes

1. **Settings no abría**: faltaba todo el CSS de `.settings-menu`.
2. **`classList.toggle('on solo')` inválido**: cortaba `updateInspector`; separado en dos toggles.
3. **TDZ de audio**: `detectInputHits` y el knob OUTPUT accedían a variables `let` antes de inicializarse. Se movieron las variables de audio al inicio y se agregó `audioReady`.
4. **Archivo real fuera de FILE SEARCH**: quedaba después de los primeros 500; ahora se ordena primero y se muestran hasta 1200.
5. **Pestaña TRIGGER no se ocultaba**: estaba fuera de `.app`; se movió adentro.
6. **Hover con carreras**: reemplazado por apertura al arrastrar/tab y cierre al clickear el Universe.
7. **Editor**: tabs reordenados; SLOT solo auto-phase; 180° recíproco con badge y Ø; badges 90°/180°/260°.
8. **AUDIO TEST**: se agregó botón + LED de estado; el CSS/JS se sirve con `?v=` para evitar cache viejo. Si se clickea antes de que termine la carga del WAV, espera hasta 5 s y arranca solo.
9. **Layout roto en ventanas angostas**: la media query de 1040 px conservaba reglas del layout viejo (`.app` con tres filas y `.workspace` con tres columnas); el Universe quedaba aplastado a 52 px. Se eliminaron esas dos reglas.
10. **FILE SEARCH rediseñado**: menos datos por fila, tipografía mayor y jerarquía tipo Finder. Ver 7.3.
11. **Barra superior rediseñada**: título centrado, search con toggle folder/universo, OUTPUT + mini VU al extremo derecho y AUDIO TEST eliminado. Ver 7.1 y 7.6.
12. **SIMILARITY funcional + FAVORITES**: navegación por 33 vecinos, seguimiento suave y línea animada, teclas ← →, favoritos persistentes y nodo FAVORITES en FILE SEARCH. Ver 7.2 y 7.3.
13. **Performance del prototipo**: el waveform del INPUT solo se dibuja con la página TRIGGER abierta; meters a ~25 fps con escrituras cacheadas; redraw de HOME coalescido por frame; barra de nombre inferior sin tooltip flotante. El renderer de OpenCode bajó de ~99 % a ~12 % de CPU en reposo.
14. **File browser**: click en una fila reproduce el audio al instante y se eliminó el botón Audition del pie. En esa iteración, al cambiar a FILE SEARCH se cerraban TRIGGER, INPUT DETECTOR y el editor con animación de salida.
15. **TRIGGER como página + dock de slots**: TRIGGER, INPUT DETECTOR y el editor/ADSR pasaron a una tercera vista full-screen. El drawer y los faders se reemplazaron por un dock fijo de 8 slots de glass vacíos, siempre visible para arrastrar samples desde Universe/FILE SEARCH. Ver 7.1, 7.4 y 7.5.
16. **Layout Slate-style**: TRIGGER pasó arriba junto a Settings, con el mismo tamaño. Los slots ahora son cuadrados, centrados y con más separación. En la página TRIGGER se recuperó el banco de 8 faders verticales con meter, M/S/Ø y nivel, alineado sobre los slots. Ver 7.1 y 7.5.
17. **TRIGGER expandido**: se quitó la fila de título/INPUT/HITS/MASTER para subir todo; el detector pasó a 400 px de ancho con waveform de ≈205 px y knobs en una fila; el ADSR creció a ≈158 px; los 4 paneles del editor se muestran juntos (SAMPLE/ENVELOPE arriba, TONE/SLOT abajo) y los faders se alargaron a ≈116 px. Ver 7.5.
18. **Drag de partículas**: ALT + drag ya no usa un pill de texto; el sample se convierte en una partícula del mismo tamaño que su dot de HOME, con glow y una estela con los mismos anchos/puntos que la del scrub, sin orbe, anillo ni tether; el nombre aparece como caption sutil. Los slots tienen magnetismo con radio de captura y el drop hace fly-in + burst + impact en el slot y en el fader. Todo el FX vive dentro de la app (canvas fijo), nunca sobre el Finder. Ver 7.2.
19. **Barra de nombre XO**: se eliminó el tooltip flotante de HOME. El nombre del sample hovereado (o de la fila de FILE SEARCH) aparece centrado en una barra fina **debajo de los slots**; al salir vuelve al seleccionado. En la página TRIGGER muestra el slot seleccionado o `TRIGGER SLOT 0X · EMPTY`.
20. **Trigger Slots + invitación al drag**: los 8 cuadrados pasan a llamarse **Trigger Slots**. Al comenzar un arrastre, todos se encienden con un glow mint más brillante y se magnifican con caída por proximidad, estilo Dock de macOS; no hay contorno general. El slot magnetizado mantiene su glow más fuerte.
21. **Glass unificado**: search, Trigger Slots, fader strips, página TRIGGER, Settings y OUTPUT comparten la misma textura: gradiente mint, borde claro, insets de luz, glow suave y blur donde conviene.
22. **Corchetes laterales**: TRIGGER pasó a un corchete vertical glass a la izquierda y SETTINGS a uno simétrico a la derecha. Se magnifican y brillan al hover, se resaltan al estar activos y el menú de Settings se ancla al corchete derecho. Ver 7.2.
23. **HOME + Esc + audition de slots**: la vista principal pasa a llamarse **HOME**. **Esc** vuelve a HOME desde TRIGGER, FILE SEARCH, Settings o cualquier popover. Click en un Trigger Slot lleno **audiciona su sample** con nivel/pan/tone y un flash mint; doble click abre el slot en TRIGGER; click en un slot vacío abre TRIGGER para cargarlo.
24. **TRIGGER con la transparencia de FILE SEARCH**: el detector, el editor y el banco de faders de la página TRIGGER usan el mismo fondo plano `rgba(8,12,20,.34)`, borde `--line` y radio de 10 px que `.tree-pane` / `.file-main`, sin blur ni brillos internos. La tipografía sube a 10–12 px con los valores en mono, y el fader seleccionado usa el mismo tinte violeta que la fila seleccionada de FILE SEARCH.
25. **TRIGGER proporcional**: el split detector/editor pasó a `2fr/3fr` (40/60) en todos los tamaños; el gap y el banco de faders usan medidas fluidas (`min(8vw,12vh)`), la altura de los faders escala con el slot y la fila inferior del editor recibe algo más de altura para que el panel SLOT no desborde en ventanas anchas y bajas. Probado en 900×1200, 1280×720, 1366×768, 1400×900, 1600×700 y 1920×1080 sin overflow.
26. **Edición numérica por doble click**: todos los valores numéricos editables (8 knobs del detector, MIX, OUTPUT master, 8 niveles de fader, TONE/CUT/VEL SENS/GAIN, START/END/FADE IN/FADE OUT, A/D/S/R y OFFSET) se vuelven editables en su lugar con doble click, sin ventana flotante. Enter confirma, Esc cancela, el blur confirma y abrir otro valor confirma el anterior. Acepta coma o punto decimal y sufijos `%`, `ms`, `s`, `Hz`, `k`, `dB` y `st`; clampa al rango del parámetro y redondea al step.
27. **Faders centrados**: el nivel en dB de cada fader queda centrado bajo el track y el badge de fase pasa a una segunda línea centrada; el número editable conserva exactamente esa posición.

---

## 16. Prompt de reinicio

Ver [`PROMPT_REINICIO.md`](PROMPT_REINICIO.md). Pegarlo en el chat nuevo y adjuntar/abrir este repositorio.

---

## 17. Nota final

El prototipo es la referencia visual y de interacción, **no** la implementación final. El motor C++ ya está auditado y testeado; el próximo salto grande es **desbloquear el entorno de build** y llevar el prototipo a iPlug2 + React sin romper el audio thread.
