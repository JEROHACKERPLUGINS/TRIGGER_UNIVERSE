# TRIGGER_UNIVERSE

Plugin de audio (AU + VST3, iPlug2) que combina un motor de drum triggering, un universo visual de samples y un mixer de ocho capas.

## Estado actual — 22/11/2026

- **Fase 0 completada y aprobada.** Motor auditado, arquitectura definida y plan de integración acordado.
- **Motor existente reutilizado** en `engine/` (`engine/DrumReplacer` + `engine/_iPlug2`). No se reescribió.
- **Prototipo UI navegable** en `prototype/`, con audio real: **SN TOP 1 (0:17–2:20)** es el INPUT del trigger y `SNARE.cm.wav` queda como sample de slot.
- **Diseño de datos de Fase 1** iniciado en `docs/fase1/modelo_datos.md`.
- **Build del plugin bloqueado por entorno**: faltan Xcode completo, CMake, Node.js y SDK de VST3. Los headers DSP sí se compilan y testean con CommandLineTools.

> Para retomar el trabajo desde cero, leer [`docs/TRASPASO.md`](docs/TRASPASO.md) y usar [`docs/PROMPT_REINICIO.md`](docs/PROMPT_REINICIO.md).

## Probar el prototipo

```bash
cd prototype
python3 -m http.server 8765 --bind 127.0.0.1
```

Abrir <http://127.0.0.1:8765/>. Para escuchar: apretá el corchete **TRIGGER** (izquierda), click en **▶ INPUT** para reproducir el track real (0:17–2:20) y disparar los slots cargados; o hacé click en un sample de **HOME** o de **FILE SEARCH** para escucharlo al instante. El audio arranca con el primer click (política de autoplay del browser).

Controles principales:

- Click en un **Trigger Slot 01–08** con sample: lo **audiciona** al instante con su nivel, pan y tone. **Doble click** abre la página **TRIGGER** con ese slot en el editor; en un slot vacío, el click abre TRIGGER para cargarlo.
- **Esc** vuelve siempre a **HOME** (la vista principal del mapa), desde TRIGGER, FILE SEARCH, Settings o cualquier popover.
- La página **TRIGGER** se estira de forma proporcional al cambiar el tamaño de la ventana: **INPUT DETECTOR y SAMPLE + ENVELOPE comparten el ancho 50/50** y el editor se redibuja a la resolución real de la ventana.
- La **escala de interfaz** de VISUAL ofrece **90% y 100%**; por encima de 100% el layout fijo de TRIGGER se solapaba con el dock, así que se limita a esos dos valores.
- **Doble click en cualquier valor numérico** (knobs del detector, mezcla, OUTPUT, niveles de fader, tone/cut/vel/gain, start/end/fades, A/D/R y offset) convierte ese mismo número en editable, en su lugar. **Enter** confirma, **Esc** cancela. **Alt+click resetea ese valor a su default**: faders y OUTPUT a 0 dB, MIX a 100%, detector a sus valores de fábrica, etc. Después del reset el doble click vuelve a abrir el editor normalmente. Acepta decimales con coma o punto y unidades como `%`, `ms`, `Hz`, `k`, `dB` o `st`.
- El corchete **TRIGGER** (izquierda) abre una página completa con un **INPUT DETECTOR estilo Slate en cinco columnas** (GATE · INPUT · FILTER · waveform · DETECT), un **sample view angosto con una sola waveform SAMPLE + ENVELOPE**, una **tira TONE compacta a todo el ancho** y **AUTO PHASE en un panel vertical al lado del banco de 8 faders**. **OUTPUT y MIX** viven en la cápsula master de arriba. No hay fila de título/INPUT/HITS/MASTER: el contenido arranca arriba y el corchete TRIGGER activo indica la página.
- **INPUT real:** `SN_TOP_1COMMIT_17-140.wav` (mono 48 kHz, 123 s, recorte 0:17–2:20, normalizado a −0.5 dBFS) se decodifica completo y alimenta el detector; la waveform de 2 s lo sigue. `SNARE.cm.wav` sigue disponible como one-shot real para los slots.
- **Jerarquía del detector:** **INPUT VOLUME** escala el medidor, la waveform, la detección y la **velocity** de los samples; **DETAIL** es el threshold de detección (la línea dashed): más Detail = más threshold (ignora bleed), menos Detail = atrapa ghost notes; el rango de Detail tiene headroom (1.5×) y la detección se normaliza a 0 dBFS, así que **Detail 100 = 0 hits incluso con Input Volume al máximo**; **SENSITIVITY** controla el **rango dinámico** de los samples (0% = nivel fijo, 100% = dinámica amplia, como el control Dynamics de Trigger 2); **RETRIGGER** funciona como en Trigger 2: es el tiempo ciego después de cada hit y, pasado ese tiempo, si la señal sigue por encima del threshold (DETAIL/SUPPRESS) **vuelve a disparar**. **RETRIGGER 0 ms = flams/metralleta** (~4 disparos por golpe en SN TOP 1); el default es **30 ms**, el valor más bajo que deja un solo hit por golpe en este track (con 16 ms salían ~2 por golpe).
- **Faders de consola**: más largos (alto ~27% de la ventana, 196–320 px), recorrido vertical real con escala en dB (+6 · 0 · −6 · −12 · −24 · −48), **0 dB a 3/4 del recorrido** con un leve imán, y el medidor de cada slot en la misma escala. Arrastrá el cap (Shift = fino), click en el riel salta a ese valor, Alt+click = 0 dB, flechas ↑↓ = 0.5 dB. AUTO PHASE sigue en el panel vertical al lado del banco de faders.
- La waveform del detector es **post-gate** (azul) con un **fantasma rojo suave** del input pre-gate; así se ve qué está quitando el gate. Los buckets de la waveform usan límites temporales uniformes, así que los marcadores naranjas siguen sobre los transientes en todo el track de 2 minutos (no se corren con el tiempo).
- **Medidores de PICO reales (no RMS):** el VU de **INPUT** muestra el pico pre-gate con un hold corto y una lectura numérica al lado del header; el VU de **OUTPUT/MASTER** también usa el pico real post-master. La flecha de GATE THRESHOLD y la barra de INPUT comparten la misma escala en dB, así que el threshold se lee contra el medidor. **VEL** junto a DETECT muestra la velocity del último hit disparado.
- **SAMPLE + ENVELOPE** es **una sola waveform** dibujada en píxeles reales (sin estirar): **START** (bandera abajo, arrastrable) y el envelope **A/D/R**. Se quitaron **END, FADE IN y FADE OUT**: el envelope ya define la forma (attack = fade in, release = final). Se ve el sample original tenue y, encima, en color, **cómo suena con el envelope aplicado**; grilla de tiempo con escala automática. Readouts editables: START · ATTACK · DECAY · RELEASE.
- **GATE** es un gate de threshold estilo **C1 Gate**: tiene **THRESHOLD** (la flechita naranja sobre el medidor INPUT), **ATTACK / HOLD / RELEASE** y **VU GR** rojo junto a sus knobs. El medidor INPUT es **pre-gate**; la flechita se arrastra para fijar el nivel de apertura. La detección usa la señal **post-gate**, así que el gate también define qué dispara. **ATTACK 0** es realmente instantáneo: la envolvente de 1 ms abre un bloque antes del transiente (lookahead) para no comerse el ataque. El detector del gate usa **8 ms de release** (estilo CLEAN de Slate) y **4 dB de histéresis**, y el release tiene un mínimo de **5 ms**: así no aparece chatter/flams cuando el release es corto. **HOLD 30 ms / RELEASE 150 ms** es el default balanceado: protege el cuerpo del golpe y deja que el release module solo la cola. Prender/apagar GATE hace un **glide de 8 ms** para no producir un click. Solo procesa el input original, no los samples; poné **MIX por debajo de 100%** para escucharlo.
- **MIX 0% = input original, 100% = samples disparados** (arranca en **100%**); **OUTPUT** es el volumen final del plugin. **DETAIL** es el threshold de detección; **GATE THRESHOLD** es el umbral del gate sobre el input, independiente.
- **TONE** quedó con **TONE · CUT · VELOCITY · GAIN**. Se quitaron **ONE SHOT / GATE** y **LOOP** de la tira. **Reverse** sigue invirtiendo el audio y abriendo la envolvente completa; **OFFSET** acepta valores negativos (se adelanta el sample dentro del lookahead).
- Hover sobre cada knob del detector muestra su rol: **Detail = threshold**, **Sensitivity = rango dinámico**, **Retrigger = ventana ciega (audible)**, **Gate = threshold + envolvente del input original**, etc. La waveform tiene su propia leyenda en el tooltip.
- **Detección en tiempo real:** toda la cadena del INPUT DETECTOR (GATE → INPUT → FILTER → DETECT) corre en un AudioWorklet (`prototype/detector-worklet.js`), muestra por muestra, sobre el audio que está sonando, igual que el motor del plugin. No se precalcula nada sobre el archivo: cada cambio de **Detail, Sensitivity, Retrigger, Filter, Suppress, Input Volume o Gate** se aplica en la muestra siguiente. El input seco sale con un **lookahead de 100 ms** (como cualquier drum replacer; el DAW lo compensa): eso da tiempo a confirmar el golpe y disparar los slots exactamente en su onset, y deja lugar para el OFFSET negativo. La waveform del detector, el VU de INPUT, el GR del gate, el LED, VEL y el contador de hits se dibujan con lo que el detector va procesando en vivo; detenido, se muestra una vista previa estática de los primeros 2 s. Los filtros son solo de detección, como en Slate, así que no cambian el tono del input seco.
- Los 8 **Trigger Slots** arrancan **vacíos**, son cuadrados y quedan centrados abajo. Arrastrá samples desde HOME o FILE SEARCH para llenarlos; el **×** de cada slot lo vacía. En la página TRIGGER, arriba de cada slot aparece su fader largo con meter, M/S/Ø y nivel.
- Mantené el click y movete por HOME: se escucha un preview inmediato de cada sample (snap dentro de un aura de ~20 px) y queda una **estela de colores** entre los puntos visitados. Al soltar, la estela se desvanece.
- Click en un sample: lo selecciona y permite hacer hover por el mapa. **ALT + arrastrar** desde HOME o FILE SEARCH a uno de los **8 Trigger Slots** del dock para asignarlo. Mientras arrastrás, el sample se convierte en una **partícula del mismo tamaño que su punto en HOME**, con glow y una estela; sin orbe ni anillo, con el nombre como caption sutil. Al empezar el drag, los 8 Trigger Slots se encienden con un glow mint más brillante y se **magnifican tipo Dock de macOS**; al acercarte a uno se imanta, y al soltar vuela hacia el slot y explota en un burst. Si se suelta fuera, se muestra el toast de export a Finder (demo).
- Rueda del mouse: zoom anclado al cursor. Click derecho + arrastrar o **Ctrl + click izquierdo + arrastrar**: pan. Click izquierdo en vacío: solo cierra paneles, sin mover la cámara.
- Al pasar por un sample de HOME o una fila de FILE SEARCH, su nombre aparece en una **barra sutil abajo**, estilo XO; ya no hay tooltip flotante.
- **FILE SEARCH** alterna entre **HOME** y el árbol de carpetas (ícono de carpeta a la derecha del buscador). El dock de Trigger Slots queda siempre visible, así podés arrastrar sin salir del browser. El efecto de la partícula queda contenido dentro de la app: nunca se dibuja sobre el Finder.
- Click en una fila de FILE SEARCH: selecciona el sample y **reproduce su audio al instante**; ya no hay botón Audition en el pie.
- **SIMILARITY** (abajo): al seleccionar un sample se arma una lista de 33 parecidos. Las flechas `◂ ▸` o las teclas `← →` recorren esa lista; HOME hace un paneo suave solo si el sample queda cerca del borde y dibuja una línea animada entre ambos.
- **♥** en la barra de similitud o en cada fila de FILE SEARCH: agrega/quita favoritos persistentes. **FAVORITES** aparece arriba del árbol de carpetas.
- El corchete **SETTINGS** (derecha) abre el menú con AUTO PHASE ALL, FLIP ALL POLARITY, LIBRARY FOLDERS y AUDIO/MIDI.
- La textura **glass** es la misma familia en el search, los Trigger Slots, Settings y el bloque OUTPUT. La página **TRIGGER** toma de **FILE SEARCH** su transparencia plana (rgba(8,12,20,.34), borde fino, radio 10 px) y su tipografía, para que ambas vistas se lean igual.
- Mover **START** corre el envelope con él; si el punto R estaba al final del sample, se queda al final.
- **Puntos extra de envelope** (estilo LFO Tool): **doble click** en cualquier lugar de la onda después de START agrega un punto, **sin límite de cantidad**; si cae después de R, ese punto pasa a ser el nuevo R y el R anterior queda como punto común. Cada punto se arrastra en tiempo (solo entre sus vecinos) y nivel; **todos los niveles son libres**, también los de A/D/R. **Doble click sobre un punto extra lo borra**. El audio se programa con todos los puntos.
- **⇥ TRANSIENT** (junto a START): lleva START al onset del sample (primer pico sobre −20 dB, retrocediendo hasta donde estaba bajo −40 dB y al cruce por cero previo), así no se come el ataque ni hace click.
- **Zoom con la ruedita**: en SAMPLE + ENVELOPE (anclado al cursor, Shift+rueda o swipe horizontal = scroll, ×N arriba a la derecha) y en la waveform del INPUT DETECTOR (20 ms – 20 s; detenido, Shift+rueda recorre el track; sonando, la ventana sigue al playhead). Con zoom, ambas leen las muestras reales.
- **Tab** alterna entre la página **TRIGGER** y **UNIVERSE** (HOME); en campos de texto y valores en edición, Tab funciona normal.
- **Selección múltiple como en el Finder**: **click** selecciona uno; **Shift+click (o Cmd+click) suma o quita de a uno** (el que clickeaste antes entra también); **arrastrar en cualquier espacio vacío** —también el negro entre y alrededor de los paneles— dibuja un recuadro que selecciona todo lo que toca, en todas las zonas a la vez (knobs, faders/slots y puntos; con Shift/Cmd apretado, suma); **click en cualquier otro lado deselecciona todo**, salvo que toques algo ya seleccionado: así lo movés y se mueve **todo el grupo**. **Cmd/Ctrl+A** selecciona todo en la zona activa. Funciona en:
  - **puntos del envelope** (mismo corrimiento en tiempo y nivel, sin cruzar a los no seleccionados; **Delete** borra los puntos extra seleccionados);
  - **knobs del detector** (giran todos con el mismo movimiento);
  - **faders**: se mueven juntos y **M / S / Ø**, Alt+click (0 dB) y las flechas se aplican a todos los seleccionados;
  - **Trigger Slots** (los cuadrados de abajo): selección propia. Faders y slots **nunca se mezclan**: un recuadro vertical que cruza los dos se queda con el primero que toca, y Shift+click en uno limpia la selección del otro.
- **Teclas 1–8** reproducen ese Trigger Slot (en HOME y en TRIGGER, sin cambiar el slot seleccionado). **Alt+1–8** lleva el sample al slot: el seleccionado en HOME / FILE SEARCH, o el del editor en la página TRIGGER.
- Al pasar a **UNIVERSE** se deselecciona todo.
- Para llevar el sample del editor a un slot, **arrastrá su nombre** (arriba de la waveform), como un archivo.

## Documentación

- [`docs/TRASPASO.md`](docs/TRASPASO.md) — estado completo, decisiones, archivos, pruebas y próximos pasos.
- [`docs/PROMPT_REINICIO.md`](docs/PROMPT_REINICIO.md) — prompt listo para pegar en un chat nuevo.
- [`docs/Brief_Tecnico_Trigger_Universe_para_Mica_v0.2.docx`](docs/Brief_Tecnico_Trigger_Universe_para_Mica_v0.2.docx) — brief de producto y especificación funcional v0.2.
- [`docs/auditoria/01_informe_auditoria.md`](docs/auditoria/01_informe_auditoria.md) — auditoría del Trigger existente.
- [`docs/auditoria/02_arquitectura_y_plan.md`](docs/auditoria/02_arquitectura_y_plan.md) — arquitectura, decisiones y plan por fases.
- [`docs/prototipo_ui.md`](docs/prototipo_ui.md) — decisiones de UI del prototipo.
- [`docs/audio_tests.md`](docs/audio_tests.md) — mediciones y pruebas con el snare real.
- [`docs/auto_phase.md`](docs/auto_phase.md) — diseño de auto-phase (GCC-PHAT + límite de lookahead).
- [`docs/fase1/modelo_datos.md`](docs/fase1/modelo_datos.md) — esquema de biblioteca e indexado.
- [`docs/referencias/XO_sample_db.md`](docs/referencias/XO_sample_db.md) — estructura y estadísticas de la base de XO (referencia funcional).
- [`docs/referencias/`](docs/referencias/) — specs del original, notas de XO y capturas.

## Principios de alcance

- **HOME** (el mapa de samples) sirve para **descubrir, editar y asignar** samples; no es un beatmaker.
- Fuera de alcance: step sequencer, patrones A/B, groove, swing, nudge, BPM sync y preset browser.
- El motor de Trigger existente se **audita y reutiliza**; no se reemplaza sin una razón técnica documentada.
- El envelope de amplitud (**A/D/R**) tiene los **tres handles libres en X e Y**: attack ajusta tiempo y pico, decay ajusta tiempo y nivel, y release es el punto final, libre en tiempo y nivel. Por defecto el release queda al final del sample; no hay meseta de hold. Phase/Align (polaridad + alineación temporal) es un sistema **independiente**, aunque comparta panel visual.
- Los ocho slots son destinos independientes de drag & drop; reemplazar uno no debe afectar a los demás.
- La edición es **no destructiva**: nunca modifica el archivo de sample original.

## Estructura

```
engine/
  DrumReplacer/        motor iPlug2 original + DSP reutilizable
    DSP/               TransientDetector, SlotEngine, Dynamics, WavFile
    tests/             tests DSP existentes
  _iPlug2/             framework iPlug2
prototype/             UI navegable (HTML/CSS/JS) + snare real
docs/                  auditoría, diseño, pruebas y capturas
```

## Fases

| Fase | Trabajo | Estado |
| --- | --- | --- |
| 0 | Auditoría y cimentación | ✅ completada y aprobada |
| 1 | Library / Browser (scanner, SQLite, análisis) | 🟡 modelo de datos diseñado |
| 2 | HOME (proyección, filtros, similitud) | 🟡 prototipo visual |
| 3 | Sample Editor + Phase / Align | 🟡 prototipo UI y diseño DSP |
| 4 | Ocho slots / mixer / trigger | 🟡 motor testeado, prototipo con audio |
| 5 | Pulido, presets, automatización, release | ⬜ pendiente |

## Stack

- **Plugin:** C++ + iPlug2 (AU + VST3; AAX fuera).
- **UI final:** React + TypeScript sobre el bridge WebView de iPlug2.
- **Prototipo:** HTML/CSS/JS sin build step (no hay Node instalado todavía).
- **Audio:** motor C++ existente (`TransientDetector`, `SlotEngine`) reutilizado.
- **Indexado:** escaneo y análisis en background; sin disco, decodificación, FFT ni allocations en el audio callback.
