# Prototipo UI — estado actual

Fecha: 20/11/2026. Prototipo navegable en `prototype/` (`index.html`, `style.css`, `app.js`). Datos sintéticos; sin assets de XO/Slate.

## Layout elegido (Opción A)

- **HOME / File Search / TRIGGER full-bleed**: las tres páginas ocupan toda el área principal. HOME es la vista del mapa (ex Universe).
- **Página TRIGGER**: INPUT DETECTOR grande + los 4 paneles del editor a la vez + banco de 8 faders largos, sin fila de título/INPUT/HITS/MASTER. Se abre desde el corchete vertical TRIGGER (izquierda).
- **Dock fijo de 8 slots cuadrados** abajo, centrado y visible en todas las vistas: recuadros de glass vacíos donde se arrastran los samples.
- **Search flotante** arriba de HOME, centrado, estilo XO.
- **Similarity bar** flotante arriba del dock, estilo XO.
- **FILE SEARCH** con árbol tipo Finder y root `LOCATION` (la carpeta elegida por el usuario).

Opciones alternativas propuestas:
- **B**: editor en pestaña lateral colapsable + TRIGGER modal.
- **C**: tres workspaces (Explore / Edit / Trigger) a pantalla completa.

## Sample editor = slot cargado

El editor vive dentro de la página TRIGGER y corresponde al slot seleccionado (por defecto **SLOT 01**). Se abre al clickear un slot del dock. Incluye:

- **SLOT**: Level, Pan, Tune, Mute/Solo/Ø, Auto Phase (REF INPUT / SLOT 1), Timing, Offset, Shift 0°/90°/180°/260°.
- **SAMPLE**: waveform, start/end, fade in/out, reverse, normalize, audition.
- **ENVELOPE**: A/D/R editable con tres puntos libres en X e Y (attack: tiempo + pico; decay: tiempo + nivel; release: punto final libre en tiempo + nivel), sin hold ni sustain. El release cae por defecto al final del sample.
- **TONE**: tone, cut, velocity sensitivity, gain, playback one-shot/gate, loop.

El browser (HOME / File Search) solo selecciona y preescucha. El flujo es: buscar → **ALT + drag** a un slot del dock → **doble click** en el slot para abrir TRIGGER y editar. Un click simple en un slot lleno audiciona su sample.

## Fase / polaridad

- **Ø = 180°**; el botón Ø y el segmento 180° están sincronizados.
- 90° y 260° son phase shift real (all-pass/Hilbert), separados de la polaridad.
- **Auto Phase** corre automáticamente al cargar un sample en un slot. Por defecto **solo corrige polaridad**; el offset queda en **0** y se muestra como `suggested`. El toggle **TIMING** permite aplicar también el offset medido.
- El análisis real será GCC-PHAT (ver `docs/auto_phase.md`).

## Trigger Slots y faders

- Ocho **Trigger Slots** de glass **01 … 08**, cuadrados, en un dock fijo abajo, centrados y con separación.
- Al comenzar un drag, los 8 se encienden con un glow mint más brillante y se magnifican con caída por proximidad, estilo Dock de macOS; sin contorno general. El slot magnetizado mantiene un glow más fuerte.
- Arrancan **vacíos**: muestran `+` / `DROP`.
- Al llenarse muestran dot de categoría, nombre y duración; el × los vacía.
- En la página TRIGGER, arriba de cada slot hay un **fader vertical largo** con meter real, M/S/Ø, nivel dB y badge de fase, alineado columna a columna. Los 4 paneles del editor (SAMPLE, ENVELOPE/A-D-R, TONE, SLOT) se ven al mismo tiempo.

## FILE SEARCH

- Árbol con root `LOCATION` (carpeta elegida) y subcarpetas reales.
- En el prototipo los paths son sintéticos (`SAMPLES FOLDER/Kicks/...`); en el plugin se construirán desde la carpeta real elegida con selector nativo.
- **Rediseño 20/11:** árbol con iconos de carpeta, filas de 24 px y tipografía 10.5 px; lista con filas altas (11.5 px) y solo **nombre + duración + punto de categoría** (sin columnas CAT/BRIGHT). Path con contador a la derecha; el preview footer es solo informativo (categoría y duración) y al clickear una fila el sample se reproduce al instante. El search sigue flotante arriba y la lista arranca debajo para no tapar la cabecera.

## Estética

- Glassmorphism unificado: search, Trigger Slots, fader strips, página TRIGGER, Settings y OUTPUT comparten gradiente mint, borde claro, insets de luz y blur donde conviene; fondo aurora.
- Puntos del Universe más saturados, con halo aditivo, núcleo vivo y brillo especular para sensación 3D.
- Sin BPM, sin secuenciador, sin preset browser.

## Settings

- Menú funcional arriba a la derecha (el CSS faltaba y por eso no abría).
- Contiene **AUTO PHASE ALL**, **FLIP ALL POLARITY**, **LIBRARY FOLDERS…**, **AUDIO / MIDI…**.
- **OUTPUT** knob en la barra superior, a la derecha.

## Actualización 20/11 — audio real y ajustes finales

- **La app es HOME**: logo y título centrados, search con toggle folder/HOME, OUTPUT + VU vertical a la derecha y corchetes verticales TRIGGER/SETTINGS en los bordes. No hay topbar separado.
- **Search centrado** arriba, sin contorno de panel; **Similarity** flotante abajo.
- **TRIGGER** es un corchete vertical glass a la izquierda; **SETTINGS** es su simétrico a la derecha. Abre una **tercera página full-screen** con INPUT DETECTOR + editor/A-D-R + banco de faders. **Esc vuelve siempre a HOME**, desde cualquier vista.
- **Editor de sample**: en la página TRIGGER se ven los 4 paneles a la vez (**SAMPLE / ENVELOPE / TONE / SLOT**); la barra de tabs quedó oculta. El panel SLOT conserva **AUTO PHASE** (REF, re-analizar, TIMING, resultado, OFFSET, SHIFT).
- **Fase**: 0/90/180/260; **180 = Ø**. Los badges se mantienen en el editor.
- **Slots**: solo números 01–08, sin faders.
- **Audio real**: `prototype/samples/SNARE.cm.wav` se decodifica con Web Audio y el archivo completo es el **INPUT** del trigger. El botón **▶ INPUT** dispara los slots cargados en cada transiente detectado. Los slots arrancan vacíos; se llenan con ALT + drag.
- **AUDIO TEST eliminado** de la barra: el audio se inicia con **▶ INPUT** o al clickear un sample del Universo o una fila de FILE SEARCH.
- **Medidores reales**: master y salida usan analizadores Web Audio.
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

## Actualización 21/11 — envelope A/D/R

- Se eliminó **Sustain** del envelope. Quedan **Attack, Decay y Release**, cada uno con su handle y su readout editable.
- Los **tres puntos son libres en X e Y**: Attack ajusta tiempo y pico; Decay ajusta tiempo y nivel; Release es el punto final y se mueve en tiempo y nivel.
- No hay meseta de hold: el release sale directamente del decay. Por defecto el punto de release cae al final del sample.
- El readout **R** es la duración desde el decay hasta el punto de release; editarlo mueve ese punto. El eje del gráfico usa la duración del sample.
- La **waveform del sample** se superpone como silueta tenue detrás del envelope, respetando start/end y reverse.
- El panel se llama **ENVELOPE · ADR** y el reset deja A 0 / D 120, release al final del sample, pico 100%, nivel de decay 50% y nivel final 0%.
- El release se acomoda a cada sample (cae al final); R = duración del sample − A − D. Si el sample es más largo, R es mayor.

## Actualización 21/11 — edición numérica por doble click

- Todos los parámetros con valor numérico son editables con **doble click**: knobs del detector, MIX, OUTPUT master, niveles de los 8 faders, TONE/CUT/VEL SENS/GAIN, START/END/FADE IN/FADE OUT, A/D/R y OFFSET.
- El número existente se vuelve **editable en su lugar** (contenteditable), conservando posición, tipografía y unidad; no abre ninguna ventana flotante. **Enter** confirma, **Esc** cancela; el blur confirma y abrir otro valor confirma el anterior.
- Acepta coma o punto decimal y sufijos (`1.2k` → 1200 Hz, `0.25s` → 250 ms). Clampa al rango del parámetro y redondea al step.
- Los valores muestran cursor de texto; al hover y en edición aparece un **recuadro gris neutro**, sin glow ni cambio de color (rojo tenue solo si el valor es inválido). La selección de texto dentro del editor también es gris.
- Los **niveles de los faders** quedan centrados y el badge de fase pasa a una segunda línea centrada.
- Los valores numéricos detienen el click para que el contenedor (por ejemplo el fader) no se re-renderice entre los dos clicks; el doble click funciona igual en los 8 niveles.

## Actualización 21/11 — TRIGGER se estira uniformemente

- El detector y el editor mantienen un split **40/60** (`2fr/3fr`) en cualquier resolución, en vez de dejar el detector fijo mientras el editor absorbe todo el ancho.
- El tamaño de los Trigger Slots y de los faders sigue una medida fluida: `clamp(52px, min(8vw, 12vh), 132px)`, con gaps `min(1.4vw, 2vh)`. El banco crece o se achica junto con la ventana y nunca se come la altura útil en ventanas anchas y bajas.
- La altura de los faders es proporcional al slot (`≈2.05×`), así el banco también estira en vertical.
- La fila inferior del editor (TONE / SLOT) recibe más altura para que el panel SLOT siga entrando completo.
- Verificado sin overflow en 900×1200, 1280×720, 1366×768, 1400×900, 1600×700 y 1920×1080.

## Actualización 21/11 — TRIGGER con la transparencia de FILE SEARCH

- La página **TRIGGER** copia la estética de **FILE SEARCH**: paneles con fondo plano `rgba(8,12,20,.34)`, borde `--line` de 1 px, radio 10 px y sin blur ni insets de glass.
- Los cuatro paneles del editor usan la misma familia, un punto más transparentes (`rgba(8,12,20,.20)`), con borde fino y sin sombras internas.
- La tipografía se unifica: títulos de 10,5 px con letter-spacing .14em, labels de 10–12 px, valores en mono y chips algo más grandes; el texto del estado vacío se acortó para no truncarse.
- El **banco de faders** también pasa a fondo plano .34 con borde fino; el fader seleccionado usa el tinte violeta de la fila seleccionada de FILE SEARCH.

## Actualización 21/11 — HOME, Esc y audition de slots

- La vista principal pasa a llamarse **HOME** (antes Universe) en la UI y la documentación.
- **Esc** vuelve siempre a **HOME**: cierra TRIGGER, FILE SEARCH, Settings, el popover de slot y cualquier drag en curso.
- Click en un **Trigger Slot** con sample lo **audiciona** al instante con su nivel/pan/tone, con un flash mint en el slot y el nombre en la barra inferior. Ya no abre TRIGGER.
- **Doble click** en un slot abre la página TRIGGER con ese slot en el editor; el click en un slot vacío también abre TRIGGER para cargarlo.

## Actualización 21/11 — corchetes laterales

- **TRIGGER** pasó a un **corchete vertical glass a la izquierda**, pegado al borde y centrado verticalmente.
- **SETTINGS** es el corchete simétrico a la derecha; el menú se abre a su izquierda y el corchete queda activo.
- Los corchetes comparten la textura glass y la dinámica de los Trigger Slots: se **magnifican al hover** desde el borde, brillan más y dejan un acento mint en el borde interno.
- El header quedó solo con logo, search y OUTPUT.

## Actualización 21/11 — textura glass unificada

- Search, **Trigger Slots**, fader strips del banco, paneles de la página TRIGGER, **Settings** y el bloque **OUTPUT** ahora comparten la misma textura glass: gradiente mint, borde claro, insets de luz y glow suave.
- OUTPUT pasó a ser una **cápsula glass** redondeada, a juego con el search.
- Settings dejó el azul plano y usa el mismo vidrio mint, más oscuro para legibilidad.
- Los Trigger Slots mantienen su tint translúcido y sus estados de invitación/magnetismo.

## Actualización 21/11 — Trigger Slots invitan al drag

- Los 8 cuadrados pasan a llamarse **Trigger Slots**.
- Al empezar un drag, **todos** se encienden con un glow mint más brillante: borde, sombra y tinte.
- Se **magnifican tipo Dock de macOS**: base 1.05× y hasta 1.12× para el más cercano al cursor, con origen abajo. No hay contorno general.
- El slot magnetizado mantiene su glow más fuerte; los demás quedan en modo invitación.

## Actualización 21/11 — barra de nombre XO

- Se eliminó el **tooltip flotante** del Universe.
- El nombre del sample hovereado aparece centrado en una **barra fina y sutil debajo de los slots**, con fondo oscuro translúcido y texto al 72%.
- También actualiza al hoverear filas de FILE SEARCH; al salir vuelve al sample seleccionado.
- En la página TRIGGER la barra sigue debajo de los slots y muestra el slot seleccionado (o `TRIGGER SLOT 0X · EMPTY`).
- La similarity bar, el file browser y las herramientas de zoom se corrieron hacia arriba para dejarle lugar.

## Actualización 21/11 — drag de partículas

- **ALT + drag** convierte el sample en una **partícula del mismo tamaño que su punto en el Universe**, con glow y estela aditiva; sin orbe, anillo ni tether.
- La partícula sigue al cursor con lag elástico y deja una estela con los **mismos anchos de línea, puntos y cadencia que la estela del scrub**.
- El **nombre** del sample aparece como caption sutil de 9 px debajo (o arriba si está cerca del borde), con alpha 0.48 y sube a 0.72 cuando se imanta a un slot.
- Los slots tienen **magnetismo** (radio de captura) y glow; al soltar, la partícula vuela al slot, hace burst y el slot/fader tienen un impacto.
- Si se suelta fuera de un slot, la partícula se disuelve y queda el toast de Finder (demo). Todo el FX está contenido en la app.

## Actualización 21/11 — TRIGGER expandido

- Se eliminó la fila de título/INPUT/HITS/MASTER; el contenido sube hasta el borde superior y el botón TRIGGER activo identifica la página.
- El **INPUT DETECTOR** pasó a 400 px de ancho, con waveform de ≈205 px de alto en una ventana de 717 px y los 8 knobs en una sola fila compacta.
- El **ADSR** creció a ≈158 px de alto y 327 px de ancho.
- Los **4 paneles del editor** se muestran juntos: SAMPLE y ENVELOPE/ADSR arriba, TONE y SLOT abajo.
- Los **faders** del banco pasaron a ≈116 px de recorrido, manteniendo meter, M/S/Ø y nivel.

## Actualización 21/11 — layout Slate Trigger

- En esa pasada **TRIGGER** se movió arriba junto a Settings; más tarde pasó a corchete lateral izquierdo.
- Los slots son **cuadrados**, están centrados y tienen más separación entre sí.
- La página TRIGGER recupera el **banco de 8 faders** verticales con meter, M/S/Ø, nivel y fase, alineado exactamente sobre los slots.
- El banco está dentro de la página (no en el dock): solo aparece al abrir TRIGGER, con los slots cuadrados debajo.

## Actualización 21/11 — primera pasada: TRIGGER page + dock

- TRIGGER, INPUT DETECTOR y el editor/ADSR se unificaron en una **tercera página full-screen**, abierta desde el corchete TRIGGER izquierdo.
- En esta primera pasada, el drawer inferior desapareció y quedaron **8 slots de glass** en un dock fijo abajo. La segunda pasada (layout Slate Trigger) recuperó los faders arriba de los slots dentro de la página TRIGGER.
- **ALT + drag** desde el Universe o FILE SEARCH asigna el sample a un slot; el × lo vacía.
- Click en un slot abre la página TRIGGER con ese slot cargado; el editor abre en **ENVELOPE (A/D/R)**.
- El paneo suave del Universe deja libre el dock y el waveform del INPUT solo corre con la página TRIGGER visible.

## Actualización 21/11 — file browser

- Click en una fila de FILE SEARCH: selecciona y **reproduce el audio al instante**. Se eliminó el botón **▶ Audition** del pie; el preview footer quedó solo informativo.
- El dock de slots queda siempre visible al cambiar de vista; así se puede arrastrar desde Universe o FILE SEARCH sin abrir la página TRIGGER. Settings y la barra de similitud siguen animando su salida.
- Los paneles usan `visibility` + `opacity` + `transform` en vez de `display:none` para poder animar el cierre.

## Actualización 21/11 — performance

- El waveform del **INPUT** solo se redibuja con la página TRIGGER abierta.
- Los meters corren a ~25 fps y solo escriben el DOM cuando el valor cambia. El VU de OUTPUT sigue siempre.
- `drawUniverse` se coalesce por `requestAnimationFrame` en mousemove/wheel.
- El nombre del hover se muestra en una barra fija sutil debajo de los slots; no hay tooltip flotante.
- Resultado: el renderer de OpenCode pasó de ~99 % a ~12 % de CPU en reposo.

## Actualización 21/11 — scrub y estela

- Mantener el **click izquierdo** y moverse por el Universe activa un modo scrub: cada sample bajo el cursor dispara un **preview de 0,8 s** en el momento y queda seleccionado para el nombre de la barra inferior. El preview anterior hace un fade de 20 ms.
- El scrub va dejando una **estela** que conecta los samples visitados. Cada segmento usa el color de la categoría del destino, con glow aditivo, núcleo brillante, nodos y cabeza viva mientras el botón está apretado.
- Al soltar, la estela se desvanece en ~2,4 s. Un nuevo click la reinicia.
- El click/hover hace **snap** al sample más cercano dentro de un **aura de 20 px**. El click en vacío solo cierra paneles: no busca ni centra nada.
- El preview usa el buffer procedural cacheado de cada sample sintético o el WAV real de `SNARE.cm`.
