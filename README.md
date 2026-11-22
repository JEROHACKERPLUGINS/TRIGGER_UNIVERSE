# TRIGGER_UNIVERSE

Plugin de audio (AU + VST3, iPlug2) que combina un motor de drum triggering, un universo visual de samples y un mixer de ocho capas.

## Estado actual — 20/11/2026

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
- La página **TRIGGER** se estira de forma proporcional al cambiar el tamaño de la ventana: el detector ocupa ~68–70% y el sample view ~30–32%, y el dock, los faders y sus gaps escalan juntos.
- **Doble click en cualquier valor numérico** (knobs del detector, mezcla, OUTPUT, niveles de fader, tone/cut/vel/gain, start/end/fades, A/D/R y offset) convierte ese mismo número en editable, en su lugar. **Enter** confirma, **Esc** cancela. **Alt+click resetea ese valor a su default**: faders y OUTPUT a 0 dB, MIX a 100%, detector a sus valores de fábrica, etc. Después del reset el doble click vuelve a abrir el editor normalmente. Acepta decimales con coma o punto y unidades como `%`, `ms`, `Hz`, `k`, `dB` o `st`.
- El corchete **TRIGGER** (izquierda) abre una página completa con un **INPUT DETECTOR estilo Slate en cinco columnas** (GATE · INPUT · FILTER · waveform · DETECT), un **sample view angosto con una sola waveform SAMPLE + ENVELOPE**, una **tira TONE compacta a todo el ancho** y **AUTO PHASE en un panel vertical al lado del banco de 8 faders**. **OUTPUT y MIX** viven en la cápsula master de arriba. No hay fila de título/INPUT/HITS/MASTER: el contenido arranca arriba y el corchete TRIGGER activo indica la página.
- **INPUT real:** `SN_TOP_1COMMIT_17-140.wav` (mono 48 kHz, 123 s, recorte 0:17–2:20, normalizado a −0.5 dBFS) se decodifica completo y alimenta el detector; la waveform de 2 s lo sigue. `SNARE.cm.wav` sigue disponible como one-shot real para los slots.
- **Jerarquía del detector:** **INPUT VOLUME** escala el medidor, la waveform, la detección y la **velocity** de los samples; **DETAIL** es el threshold de detección (la línea dashed): más Detail = más threshold (ignora bleed), menos Detail = atrapa ghost notes; el rango de Detail tiene headroom (1.5×) para poder llevarlo por encima de los transientes y dejar de disparar; **SENSITIVITY** controla el **rango dinámico** de los samples (0% = nivel fijo, 100% = dinámica amplia, como el control Dynamics de Trigger 2); **RETRIGGER** es la ventana ciega después de cada hit (solo audio, sin gráfica).
- **Ventana más grande y ordenada**: el detector creció (68–70% del ancho), los knobs y sus labels/valores son más grandes, INPUT quedó centrado con su VU, FILTER y DETECT centrados, y el GR rojo vive junto a los knobs del GATE. El título del plugin y la cápsula OUTPUT/MIX se achicaron; TONE es más baja y AUTO PHASE pasó a un panel vertical al lado de los faders. Los faders y el dock quedan centrados en su posición original; el panel de fase ocupa el margen derecho y se angosta en ventanas chicas (en <=1000 pasa arriba de los faders).
- La waveform del detector es **post-gate** (azul) con un **fantasma rojo suave** del input pre-gate; así se ve qué está quitando el gate.
- **Medidores de PICO reales (no RMS):** el VU de **INPUT** muestra el pico pre-gate con un hold corto y una lectura numérica al lado del header; el VU de **OUTPUT/MASTER** también usa el pico real post-master. La flecha de GATE THRESHOLD y la barra de INPUT comparten la misma escala en dB, así que el threshold se lee contra el medidor. **VEL** junto a DETECT muestra la velocity del último hit disparado.
- **SAMPLE + ENVELOPE** es **una sola waveform**: el sample completo, el trim, los fades y la curva A/D/R viven en el mismo gráfico. La curva mint final combina el envelope con los fades; los handles editan start/end, fade in/out y los tres puntos A/D/R, y abajo hay dos filas de readouts editables (START/END/FADE IN/FADE OUT y A/D/R).
- **GATE** es un gate de threshold estilo **C1 Gate**: tiene **THRESHOLD** (la flechita naranja sobre el medidor INPUT), **ATTACK / HOLD / RELEASE** y **VU GR** rojo junto a sus knobs. El medidor INPUT es **pre-gate**; la flechita se arrastra para fijar el nivel de apertura. La detección usa la señal **post-gate**, así que el gate también define qué dispara. **ATTACK 0** es realmente instantáneo: la envolvente de 1 ms abre un bloque antes del transiente (lookahead) para no comerse el ataque. Solo procesa el input original, no los samples; poné **MIX por debajo de 100%** para escucharlo.
- **MIX 0% = input original, 100% = samples disparados** (arranca en **100%**); **OUTPUT** es el volumen final del plugin. **DETAIL** es el threshold de detección; **GATE THRESHOLD** es el umbral del gate sobre el input, independiente.
- Hover sobre cada knob del detector muestra su rol: **Detail = threshold**, **Sensitivity = rango dinámico**, **Retrigger = ventana ciega (audible)**, **Gate = threshold + envolvente del input original**, etc. La waveform tiene su propia leyenda en el tooltip.
- **Todo el INPUT DETECTOR responde en vivo** mientras suena el input: los slots se disparan hit por hit (no se preprograma el sample entero). **Detail** cambia el threshold; **Sensitivity** cambia la dinámica de los samples; **Retrigger/Filter/Suppress** cambian los próximos disparos; **Input Volume** escala detección, velocity y audio seco; **Gate threshold/attack/hold/release** cambian el gate y la detección post-gate; **MIX/OUTPUT** son inmediatos. Los filtros son solo de detección, como en Slate, así que no cambian el tono del input seco.
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
- El panel **ENVELOPE · ADR** superpone la **waveform del sample** (recortada y reversible) como silueta detrás del envelope. El punto de Release cae por defecto al final del sample, así que R se adapta a cada sample; su nivel final se puede arrastrar.

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
