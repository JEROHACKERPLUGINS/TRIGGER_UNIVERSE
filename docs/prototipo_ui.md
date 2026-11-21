# Prototipo UI — estado actual

Fecha: 20/11/2026. Prototipo navegable en `prototype/` (`index.html`, `style.css`, `app.js`). Datos sintéticos; sin assets de XO/Slate.

## Layout elegido (Opción A)

- **Universe / File Search full-bleed**: ocupa toda el área principal.
- **Sample editor flotante** a la derecha: se abre al clickear un fader de TRIGGER. No recorta el mapa; entra sobre la imagen.
- **TRIGGER como drawer inferior**: pestaña abajo; se abre al clickearla o al arrastrar desde la waveform. Contiene el detector y los 8 faders.
- **Search flotante** arriba del Universe, centrado, estilo XO.
- **Similarity bar** flotante abajo, estilo XO.
- **FILE SEARCH** con árbol tipo Finder y root `LOCATION` (la carpeta elegida por el usuario).

Opciones alternativas propuestas:
- **B**: editor en pestaña lateral colapsable + TRIGGER modal.
- **C**: tres workspaces (Explore / Edit / Trigger) a pantalla completa.

## Sample editor = slot cargado

El editor corresponde al sample cargado en el fader seleccionado (por defecto **TRIGGER 01**). Se abre al clickear el fader. Incluye:

- **SLOT**: Level, Pan, Tune, Mute/Solo/Ø, Auto Phase (REF INPUT / SLOT 1), Timing, Offset, Shift 0°/90°/180°/260°.
- **SAMPLE**: waveform, start/end, fade in/out, reverse, normalize, audition.
- **ENVELOPE**: ADSR editable.
- **TONE**: tone, cut, velocity sensitivity, gain, playback one-shot/gate, loop.

El browser (Universe / File Search) solo selecciona y preescucha; no abre el editor. El flujo es: buscar → arrastrar a un fader → clickear el fader para editar.

## Fase / polaridad

- **Ø = 180°**; el botón Ø y el segmento 180° están sincronizados.
- 90° y 260° son phase shift real (all-pass/Hilbert), separados de la polaridad.
- **Auto Phase** corre automáticamente al cargar un sample en un fader. Por defecto **solo corrige polaridad**; el offset queda en **0** y se muestra como `suggested`. El toggle **TIMING** permite aplicar también el offset medido.
- El análisis real será GCC-PHAT (ver `docs/auto_phase.md`).

## Faders

- Se identifican solo por número: **01 … 08**.
- Cada uno: level, meter, M/S/Ø, pan/tune, badge de fase.
- El nombre del sample se muestra debajo, no como nombre del fader.

## FILE SEARCH

- Árbol con root `LOCATION` (carpeta elegida) y subcarpetas reales.
- En el prototipo los paths son sintéticos (`SAMPLES FOLDER/Kicks/...`); en el plugin se construirán desde la carpeta real elegida con selector nativo.
- Columnas: NAME, CAT, LEN, BRIGHT. Preview + Audition + drag a TRIGGER.

## Estética

- Glassmorphism: paneles translúcidos, blur, bordes de luz, fondo aurora.
- Puntos del Universe más saturados, con halo aditivo, núcleo vivo y brillo especular para sensación 3D.
- Sin BPM, sin secuenciador, sin preset browser.

## Settings

- Menú funcional arriba a la derecha (el CSS faltaba y por eso no abría).
- Contiene **AUTO PHASE ALL**, **FLIP ALL POLARITY**, **LIBRARY FOLDERS…**, **AUDIO / MIDI…**.
- **OUTPUT** knob en la barra superior, a la derecha.

## Actualización 20/11 — audio real y ajustes finales

- **La app es el Universe**: logo, nombre de sesión, FILE SEARCH, OUTPUT, Settings y Export flotan dentro del mapa. No hay topbar separado.
- **Search centrado** arriba, sin contorno de panel; **Similarity** flotante abajo.
- **TRIGGER** es una pestaña mínima (`TRIGGER ▲`). Se abre al **arrastrar un sample** o al clickear la pestaña, y **queda abierto**. Se cierra al clickear el Universe, al seleccionar un sample, o desde la cabecera.
- **Editor de sample**: tabs **SAMPLE → ENVELOPE → TONE → SLOT**. El tab SLOT quedó solo con **AUTO PHASE** (REF, re-analizar, TIMING, resultado, OFFSET, SHIFT); se quitaron Level/Pan/Tune/Mute/Solo/Pol de esa ventana.
- **Fase**: 0/90/180/260; **180 = Ø**. El badge del fader muestra `90°`, `180°` o `260°` y se mantiene recíproco con la ventana.
- **Faders**: solo números 01–08.
- **Audio real**: `prototype/samples/SNARE.cm.wav` se decodifica con Web Audio. El primer golpe (0.51 s) queda como sample del fader 01; el archivo completo es el **INPUT** del trigger. El botón **▶ INPUT** dispara las 8 capas en cada transiente detectado.
- **AUDIO TEST**: botón arriba a la derecha que reanuda el `AudioContext`, reproduce el snare y dispara las 8 capas. El **LED verde** al lado indica que el audio está `running`. Es la forma rápida de verificar que el motor suena. Si el WAV todavía está cargando, espera hasta 5 s y arranca solo.
- **Medidores reales**: master y faders usan analizadores Web Audio.
- **Polaridad 180** verificada offline (correlación −1.0). 90/260 quedan como UI hasta el DSP C++.
- **Cache busting**: `index.html` carga `style.css?v=3` y `app.js?v=3`. Subir la versión al editar assets para evitar que Chromium sirva la versión vieja.
- Detalles y mediciones en `docs/audio_tests.md`.
