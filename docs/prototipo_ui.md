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
- **Rediseño 20/11:** árbol con iconos de carpeta, filas de 24 px y tipografía 10.5 px; lista con filas altas (11.5 px) y solo **nombre + duración + punto de categoría** (sin columnas CAT/BRIGHT). Path con contador a la derecha; el preview footer es solo informativo (categoría y duración) y al clickear una fila el sample se reproduce al instante. El search sigue flotante arriba y la lista arranca debajo para no tapar la cabecera.

## Estética

- Glassmorphism: paneles translúcidos, blur, bordes de luz, fondo aurora.
- Puntos del Universe más saturados, con halo aditivo, núcleo vivo y brillo especular para sensación 3D.
- Sin BPM, sin secuenciador, sin preset browser.

## Settings

- Menú funcional arriba a la derecha (el CSS faltaba y por eso no abría).
- Contiene **AUTO PHASE ALL**, **FLIP ALL POLARITY**, **LIBRARY FOLDERS…**, **AUDIO / MIDI…**.
- **OUTPUT** knob en la barra superior, a la derecha.

## Actualización 20/11 — audio real y ajustes finales

- **La app es el Universe**: logo y título centrados, search con toggle folder/universo, Settings y OUTPUT + VU vertical a la derecha. No hay topbar separado.
- **Search centrado** arriba, sin contorno de panel; **Similarity** flotante abajo.
- **TRIGGER** es una pestaña mínima (`TRIGGER ▲`). Se abre al **arrastrar un sample** o al clickear la pestaña, y **queda abierto**. Se cierra al clickear el Universe, al seleccionar un sample, o desde la cabecera.
- **Editor de sample**: tabs **SAMPLE → ENVELOPE → TONE → SLOT**. El tab SLOT quedó solo con **AUTO PHASE** (REF, re-analizar, TIMING, resultado, OFFSET, SHIFT); se quitaron Level/Pan/Tune/Mute/Solo/Pol de esa ventana.
- **Fase**: 0/90/180/260; **180 = Ø**. El badge del fader muestra `90°`, `180°` o `260°` y se mantiene recíproco con la ventana.
- **Faders**: solo números 01–08.
- **Audio real**: `prototype/samples/SNARE.cm.wav` se decodifica con Web Audio. El primer golpe (0.51 s) queda como sample del fader 01; el archivo completo es el **INPUT** del trigger. El botón **▶ INPUT** dispara las 8 capas en cada transiente detectado.
- **AUDIO TEST eliminado** de la barra: el audio se inicia con **▶ INPUT** o al clickear un sample del Universo o una fila de FILE SEARCH.
- **Medidores reales**: master y faders usan analizadores Web Audio.
- **Polaridad 180** verificada offline (correlación −1.0). 90/260 quedan como UI hasta el DSP C++.
- **Cache busting**: `index.html` carga `style.css?v=N` y `app.js?v=N`. Subir la versión al editar assets para evitar que Chromium sirva la versión vieja.
- Detalles y mediciones en `docs/audio_tests.md`.

## Actualización 20/11 — Universe full-bleed

- El Universe ocupa **el 100% de la ventana**: `.app` sin padding, `.workspace` sin margen inferior y `.canvas-wrap` en `inset:0`.
- Sin borde, radio, fondo de panel ni sombra interna: el canvas es transparente y deja ver el fondo aurora del `body`. No se percibe dónde termina el mapa.
- La proyección usa un **overscan de 36 px** fuera de los cuatro lados, así los puntos sangran fuera del viewport y no quedan cortados justo en el borde.
- Se eliminó la leyenda `SAMPLE UNIVERSE`, que quedaba pisada por el logo.
- La UI sigue flotando arriba y abajo (brand, search, acciones, similarity, TRIGGER); el reacomodo de esos bloques queda como paso siguiente.

## Actualización 20/11 — barra superior

- Se eliminó el nombre de sesión (`INIT — Untitled Kit`) y el pill `UI PROTOTYPE`.
- El logo + **TRIGGER UNIVERSE** quedó centrado como masthead del plugin.
- **FILE SEARCH** dejó de ser un botón de texto: ahora es un ícono dentro del buscador. En Universe muestra una carpeta; en File Search muestra una órbita para volver.
- **Settings** quedó a la derecha. **OUTPUT** pasó al extremo derecho, con un **mini VU vertical** de salida. **Export se eliminó** de la UI.
- Se eliminaron **AUDIO TEST**, el LED de estado y **Export**. El audio se inicia con **▶ INPUT** o al clickear un sample del Universo o una fila de FILE SEARCH.
- El toggle folder/universo ahora tiene **contorno circular** (hover/foco).

## Actualización 20/11 — similitud y favoritos

- Al seleccionar un sample se arma una lista de **33 vecinos** ordenada por categoría + duración (log) + brightness (log) + druminess.
- Para evitar casi-duplicados, cada vecino debe estar a una **distancia visual mínima** del sample base y de los anteriores. Así las flechas recorren la nube.
- **◂ ▸** o **← →** navegan la lista. El índice se muestra como `3 / 25 · Nombre`.
- Al navegar, el Universe hace un **seguimiento suave** (solo si el sample queda cerca del borde) y dibuja una **línea con estela** desde el anterior. No recentra cada selección.
- Al volver desde FILE SEARCH, el Universe solo ajusta si el sample seleccionado quedó fuera del área segura.
- La barra tiene **fade en ambos bordes** (efecto “desde el infinito”) y se **auto-oculta a los 3,5 s** sin navegar. Se oculta al panear, hacer zoom, abrir TRIGGER/editor, buscar o cambiar a FILE SEARCH; cada paso entre similares reinicia el timer.
- **♥** en la barra de similitud y en cada fila de FILE SEARCH agrega/quita favoritos.
- Los favoritos se guardan en `localStorage` (`tu:favorites:v1`) y sobreviven al reload.
- **FAVORITES** es un nodo fijo arriba del árbol; muestra el contador y una lista propia. Si está vacío, indica cómo agregar favoritos.

## Actualización 21/11 — file browser

- Click en una fila de FILE SEARCH: selecciona y **reproduce el audio al instante**. Se eliminó el botón **▶ Audition** del pie; el preview footer quedó solo informativo.
- Al entrar a FILE SEARCH se cierran **TRIGGER**, **INPUT DETECTOR** y el editor de sample con una salida animada (fade + slide). El drawer ya se deslizaba; ahora el detector, el editor y Settings acompañan con la misma curva.
- Los paneles usan `visibility` + `opacity` + `transform` en vez de `display:none` para poder animar el cierre.

## Actualización 21/11 — performance

- El waveform del **INPUT** solo se redibuja con el drawer TRIGGER abierto.
- Los meters corren a ~25 fps; los 8 slots solo se actualizan si el drawer está visible. El VU de OUTPUT sigue siempre.
- `drawUniverse` se coalesce por `requestAnimationFrame` en mousemove/wheel.
- El tooltip solo rehace su HTML cuando cambia el sample; la posición se actualiza aparte.
- Resultado: el renderer de OpenCode pasó de ~99 % a ~12 % de CPU en reposo.

## Actualización 21/11 — scrub y estela

- Mantener el **click izquierdo** y moverse por el Universe activa un modo scrub: cada sample bajo el cursor dispara un **preview de 0,8 s** en el momento y queda seleccionado para hover/tooltip. El preview anterior hace un fade de 20 ms.
- El scrub va dejando una **estela** que conecta los samples visitados. Cada segmento usa el color de la categoría del destino, con glow aditivo, núcleo brillante, nodos y cabeza viva mientras el botón está apretado.
- Al soltar, la estela se desvanece en ~2,4 s. Un nuevo click la reinicia.
- El click/hover hace **snap** al sample más cercano dentro de un **aura de 20 px**. El click en vacío solo cierra paneles: no busca ni centra nada.
- El preview usa el buffer procedural cacheado de cada sample sintético o el WAV real de `SNARE.cm`.
