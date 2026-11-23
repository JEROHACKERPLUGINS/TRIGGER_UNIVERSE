# PROMPT DE REINICIO — pegar en el chat nuevo

Sos el agente que continúa **TRIGGER UNIVERSE**, un plugin de audio en desarrollo. El repo está en:

```
/Users/dante/Desktop/TRIGGER_UNIVERSE
```

Antes de responder o tocar código, leé en este orden:

1. `README.md`
2. `docs/TRASPASO.md` ← contexto completo, estado, decisiones y próximos pasos
3. `docs/auditoria/02_arquitectura_y_plan.md`
4. `docs/audio_tests.md`
5. `docs/auto_phase.md`
6. `docs/prototipo_ui.md`

No propongas reescribir nada antes de leer esos archivos.

**Último estado: 22/11/2026.** Lo nuevo de esa sesión está resumido en `docs/TRASPASO.md` §2.1 (detección en tiempo real en `prototype/detector-worklet.js`, RETRIGGER estilo Trigger 2, editor SAMPLE + ENVELOPE multipunto con zoom, faders de consola, selección múltiple estilo Finder, teclas 1–8 / Alt+1–8 / Tab, botón **BOUNCE** de samples modificados, **TONE/CUT con fase cero** horneado en el sample, **GATE AUTO THRESHOLD**, **AUTO PHASE global con análisis real por bandas**). Si cambian parámetros que afectan la fase, las lecturas de fase y RE-ANALYZE ALL se ponen en rojo. El panel de Auto Phase tiene dos tarjetas: fase de todos los slots arriba, fase del slot seleccionado abajo. RE-ANALYZE decide primero la fase (≥ 90° → Ø, medida donde cae el golpe) y después ajusta el offset fino. PHASE por slot es 0°/90°. `index.html` va en `style.css?v=225` / `app.js?v=244` / `native-ui.js?v=4`. Lo último (preview nativo, audio de la app standalone, motor de reconocimiento y universe con ejes fijos: graves izq. / agudos der., cortos arriba / largos abajo, parecidos agrupados) está en `docs/TRASPASO.md` §2.2–§2.8 (incluye LUFS / druminess / doble ataque, clasificador propio que aprende de la biblioteca y similares por embedding 4D; nada de XO). Al tocar `app.js` o `style.css`, subí el `?v=` de `index.html`.

---

## Qué es el proyecto

Plugin (AU + VST3, **iPlug2**) que combina:

- el motor de drum triggering existente (`engine/DrumReplacer`, auditado y reutilizado),
- un universo visual de samples estilo XO (nube de puntos, búsqueda, similitud),
- un mixer de 8 slots con edición no destructiva.

La UI final será **React + TypeScript** sobre el bridge WebView de iPlug2. El prototipo actual es HTML/CSS/JS sin build step porque no hay Node instalado.

---

## Estado actual (20/11/2026)

- **Fase 0 completada y aprobada.**
- Motor existente importado en `engine/` y **no reescrito**.
- Tests DSP existentes: **3/3 pasan**.
- Tests C++ con `SNARE.cm.wav`: detector y `SlotEngine` verificados. El INPUT del prototipo es **SN TOP 1 (0:17–2:20)**.
- **Prototipo UI navegable y con audio real funcionando** en `prototype/`.
- **AUv2 compilado y validado** con CMake + Command Line Tools (sin Xcode): `scripts/build-au.sh` instala el componente y `auval` pasa. Node.js y SDK de VST3 quedan pendientes para React/VST3.
- **Commit inicial creado en `main`**, árbol limpio.

El prototipo se prueba así:

```bash
cd /Users/dante/Desktop/TRIGGER_UNIVERSE/prototype
python3 -m http.server 8765 --bind 127.0.0.1
```

Abrir <http://127.0.0.1:8765/>. Para escuchar: apretá el corchete **TRIGGER** (izquierda) y clickeá **▶ INPUT** en INPUT DETECTOR. Los slots arrancan vacíos: volvé al browser y hacé **ALT + drag** de samples a los 8 slots.

---

## Decisiones cerradas — no reabrir sin motivo

- **Framework:** iPlug2. **No** migrar a JUCE.
- **Formatos:** AU + VST3. **AAX fuera.**
- **UI final:** React + TypeScript sobre WebView de iPlug2.
- **Envelope:** **A/D/R** con tres puntos libres en X e Y (attack: tiempo + pico; decay: tiempo + nivel; release: punto final libre en tiempo + nivel), sin hold ni sustain. El release queda por defecto al final del sample; el readout R es la duración desde el decay hasta ese punto. Incluye fade in/out + start/end/trim. **Sin time-stretch.**
- **Fase:** `Ø = 180°` (polaridad: botón Ø del canal + Auto Phase). Phase shift por slot: **0° / 90°** (180°/260° quitados del selector; el ajuste fino es el OFFSET escrito).
- **Auto-phase:** global: ON/OFF (el título del panel), REF = INPUT o cualquiera de los 8 slots para todos, MODO = OFFSET / Ø / BOTH (default Ø). Corre al cargar un sample o cambiar la REF. El resultado se guarda aparte de lo manual (apagarlo no pierde nada).
- **Trigger Slots:** dock fijo de 8 recuadros de glass `01`–`08`, cuadrados y centrados, vacíos al inicio, con la misma textura glass que search/TRIGGER/Settings/OUTPUT. Al arrancar un drag se encienden con glow mint y se magnifican tipo Dock de macOS. Click en un slot lleno **audiciona** su sample; doble click lo abre en TRIGGER; click en uno vacío abre TRIGGER.
- **Faders:** 8 faders verticales (≈136 px) alineados arriba de los slots, con meter de pico, M/S/Ø y nivel. La tira de **AUTO PHASE** va arriba del banco y sigue al slot seleccionado.
- **TONE:** CUT/TONE se aplican al sample con **fase cero** (FFT, fuera del audio thread), no con IIR en tiempo real, para que las capas no se desfasen al ecualizar. CUT default 100% (sin filtro).
- **Gate:** AUTO THRESHOLD aprende en la primera escucha del INPUT y se bloquea 5 s de play después de encontrar el primer punto ideal; a mano lo pisa; Alt+click lo re-arma.
- **Editor:** sample view angosto (~30–32%) en la página TRIGGER. **SAMPLE + ENVELOPE** comparten **una sola waveform**: sample con trim/fades + curva A/D/R × fades + handles de start/end/fades y A/D/R. **TONE** es una tira full-width debajo. **Alt+click resetea cualquier valor a su default** (faders/OUTPUT 0 dB, MIX 100%, detector de fábrica, etc.).
- **Paneles del editor:** **SAMPLE + ENVELOPE** en una sola waveform y **TONE** en una tira full-width. **AUTO PHASE** queda sobre los faders. Readouts en dos filas: START/END/FADE IN/FADE OUT y A/D/R.
- **Auto Phase (panel):** al lado de los faders: ON/OFF, REF, MODO, RE-ANALYZE ALL; para el slot seleccionado OFFSET escrito (texto, no knob/fader) y PHASE 0/90. Canales con Ø/90° en verde; sin Level/Pan/Tune/Mute/Solo/Pol en el editor.
- **TRIGGER:** corchete vertical glass a la izquierda; abre la página full-screen con detector Slate en cinco columnas (GATE/INPUT/FILTER/waveform/DETECT), sample view con una sola waveform SAMPLE + ENVELOPE, tira TONE compacta y fila de faders centrada con un panel vertical de Auto Phase en el margen derecho (se angosta; arriba de los faders en <=1000). OUTPUT y MIX están en la cápsula master superior y MIX abre en 100%. **Esc vuelve siempre a HOME**; el corchete vuelve a la vista anterior.
- **Detector:** INPUT VOLUME escala medidor, waveform, detección y **velocity**; **DETAIL es el threshold de detección** (línea dashed) con 1.5× de headroom y detección normalizada a 0 dBFS (**Detail 100 = 0 hits incluso con volumen al máximo**); **SENSITIVITY es el rango dinámico** (0% fijo, 100% amplio), no una ganancia de detección; RETRIGGER es la ventana ciega; LOWCUT/HIGHCUT filtran solo la detección; SUPPRESS en INPUT. **GATE C1-style**: threshold con flecha naranja sobre el medidor INPUT (pre-gate) + ATTACK/HOLD/RELEASE; el gate es post-VOLUME, la detección usa la señal post-gate y **ATTACK 0 es instantáneo con lookahead de 1 ms**. El gate usa **detector peak de 8 ms + 4 dB de histéresis + release mínimo 5 ms** (inspirado en Slate CLEAN) para no hacer chatter/flams; defaults **HOLD 30 / RELEASE 150**. La waveform del detector es post-gate (azul) con fantasma rojo pre-gate; el **VU GR rojo** está junto a los knobs del GATE. MIX 0% = input original, 100% = samples.
- **En vivo:** el input se dispara hit por hit (loop de 20 ms, lookahead 80 ms). Mover cualquier parámetro del detector mientras suena recalcula hits/gate y cambia los próximos disparos sin reiniciar. Detail/Retrig/Suppress/filtros y el gate afectan la detección; Sensitivity cambia la dinámica de los samples; Input Volume escala detección, velocity y audio seco; MIX/OUTPUT son inmediatos. Salir de TRIGGER detiene el INPUT y sus disparos.
- **HOME** (ex Universe): vista principal full-bleed, nube de puntos 3D abstracta, sin ejes. Search arriba, similitud abajo. **Esc vuelve acá desde cualquier vista.**
- **FILE SEARCH:** árbol tipo Finder con root en la carpeta elegida por el usuario; subcarpetas reales; samples reales primero.
- **OUTPUT + MIX** arriba a la derecha, en una cápsula glass. **TRIGGER** es un corchete vertical glass a la izquierda y **SETTINGS** otro a la derecha. **AUTO PHASE ALL** vive en Settings.
- **Fuera de alcance:** step sequencer, patrones, groove, swing, BPM sync, preset browser.
- **XO:** solo referencia funcional/UX. **No copiar código, assets ni diseño propietario.**

---

## Qué está implementado en el prototipo

- HOME full-bleed con 1000 samples sintéticos + `SNARE.cm.wav` real. El INPUT del trigger es el caso real **SN TOP 1 (0:17–2:20, 123 s)**.
- Zoom con rueda anclado al cursor; pan con click derecho o Ctrl+click; click izquierdo en vacío solo cierra paneles; hover/snap dentro de un aura de 20 px con el nombre en la barra inferior.
- FILE SEARCH con árbol, búsqueda, preview, audition al click en cada fila y ALT + drag a los 8 slots del dock. El dock queda siempre visible. El drag convierte el sample en una partícula del tamaño de su punto de HOME, con glow/estela, nombre sutil, magnetismo a slots y burst al soltar.
- Editor integrado en la página TRIGGER con una sola waveform **SAMPLE + ENVELOPE** en un sample view angosto y **TONE** en una tira full-width; Auto Phase sobre los faders.
- Waveform real, start/end, fades, reverse, A/D/R, tone/cut, tune, pan.
- TRIGGER como página full-screen sin header de stats, con INPUT DETECTOR estilo Slate en columnas, sample view con una sola waveform SAMPLE + ENVELOPE, tira TONE full-width, banco de 8 faders con Auto Phase y dock de 8 slots cuadrados.
- Settings con AUTO PHASE ALL, FLIP ALL POLARITY, LIBRARY FOLDERS, AUDIO/MIDI.
- SIMILARITY funcional: 33 vecinos por features, flechas y teclas ← →, seguimiento suave de HOME y línea animada.
- Favoritos persistentes (`localStorage`) con corazón en la barra y en FILE SEARCH, más el nodo FAVORITES.
- OUTPUT knob real con mini VU vertical de salida. Export eliminado.
- Web Audio: 8 capas, snare real como INPUT, primer golpe como sample del slot 01, polaridad 180° real.

Limitaciones del prototipo:

- Auto-phase con **análisis real** en el prototipo (energía de la suma por bandas: LOW decide polaridad, HIGH el offset fino); falta portarlo al C++.
- Similitud basada en features sintéticas, no en análisis tímbrico real.
- 90° **no** se aplica al audio; solo 180° (Ø).
- Offsets negativos aplicados dentro del lookahead (clampeados al próximo bloque si caen en el pasado).
- Velocity aplicada en los disparos del INPUT (pico real); el preview usa velocity 1. ONE SHOT / GATE y LOOP se retiraron de TONE; los disparos son one-shot sin loop. Reverse usa envolvente completa. La escala VISUAL se limita a 90/100 para no solapar el layout. Folder picker y Audio/MIDI son demos.

---

## Próximo paso recomendado

### Hecho — AUv2 compilado y validado

- CMake + Command Line Tools alcanzan: no hace falta Xcode para el AU local.
- `scripts/build-au.sh Debug` compila, instala en `~/Library/Audio/Plug-Ins/Components` y valida con `auval`.
- Guía completa: `docs/build-au.md`.

### Prioridad 1 — Portar el layout al WebView

1. Sincronizar `prototype/index.html`, `style.css` y `app.js` con `engine/DrumReplacer/resources/web/`.
2. Separar la UI pura de Web Audio y crear el bridge nativo (`SPVFUI` / `BPCFUI` / mensajes JSON).
3. Mapear cada control nuevo a un parámetro C++.
4. Probar el AU en GarageBand, Ableton o Reaper.

### Prioridad 2 — Portar el DSP que falta

- Auto-threshold del gate, TONE/CUT con fase cero, envelope multipunto, Auto Phase y 90° real.
- Implementar **GCC-PHAT** real en C++ (`docs/auto_phase.md`) y tests con el snare.
- Extender `SlotEngine` con Decay, start/end, fades y offset.
- Avanzar el modelo de datos de Fase 1 (`docs/fase1/modelo_datos.md`).

---

## Cómo trabajar

- Leé el código y los docs antes de proponer cambios.
- Mantené el estilo y la estructura existentes.
- No reescribas el motor sin una razón técnica documentada.
- No agregues dependencias ni builds nuevos sin confirmar.
- Si tocás `prototype/style.css` o `app.js`, subí el `?v=` en `index.html` para evitar cache.
- Verificá visualmente con el browser y, si hay audio, con **TRIGGER → ▶ INPUT**.
- Documentá las decisiones nuevas en `docs/`.

---

## Primer mensaje esperado

Respondé con:

1. Un resumen de 5 líneas del estado actual.
2. La lista de bloqueos de entorno.
3. La opción que recomendás como próximo paso (build baseline vs. DSP/prototipo).
4. Una pregunta concreta al usuario si falta una decisión.

No empieces a codear hasta confirmar el próximo paso.
