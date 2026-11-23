# TRASPASO — TRIGGER UNIVERSE

**Fecha:** 20/11/2026 · **actualizado 22/11/2026** (ver §2.1)
**Propósito:** dejar todo el contexto necesario para retomar el proyecto en un chat nuevo sin perder decisiones, estado ni próximos pasos.
**Documento principal:** este archivo. **Prompt listo para pegar:** [`PROMPT_REINICIO.md`](PROMPT_REINICIO.md).

---

## 1. Qué es

**TRIGGER UNIVERSE** es un plugin de audio que combina tres cosas:

1. El **motor de drum triggering** existente (DrumReplacer / iPlug2).
2. Un **universo visual de samples** estilo XO: nube de puntos, búsqueda, similitud, exploración.
3. Un **mixer de 8 slots** con edición no destructiva por capa.

El usuario busca un sample en HOME o en FILE SEARCH, lo arrastra a uno de los 8 slots del dock, entra a la página TRIGGER para editarlo (sample, A/D/R, tone, phase) y el INPUT dispara las capas cargadas.

**No es un beatmaker.** Quedan fuera de alcance: step sequencer, patrones, groove, swing, BPM sync y preset browser.

---

## 2. Estado en una línea

**Fase 0 aprobada. Motor auditado y testeado. Prototipo UI navegable con audio real funcionando. Build del plugin bloqueado por entorno (faltan Xcode completo, CMake, Node y SDK VST3).**

---

## 2.1 Sesión 22/11/2026 — qué cambió (leer primero)

Todo esto está en `prototype/` (sin commit en git todavía). El README tiene el detalle de cada control.

- **Detección en tiempo real** (`prototype/detector-worklet.js`, AudioWorklet): GATE → INPUT → FILTER → DETECT corren muestra por muestra sobre el audio que suena; los knobs se aplican en la muestra siguiente. **Lookahead de 100 ms** en el seco (`RT_LOOKAHEAD`); los hits llegan con ≥86 ms de margen y los slots se programan en el onset exacto (`playSlot(..., atTime)`, error 0,000 ms). Fallback precalculado si no hay AudioWorklet. Con el input detenido se ve una vista previa estática (`detectInputHits`, misma lógica que el worklet).
- **Gate**: antes se desfasaba ~50 ms al mover knobs (curvas AudioParam programadas tarde en Chrome); ahora vive en el worklet. `prototype/gate-worklet.js` quedó **sin uso**: se puede borrar.
- **RETRIGGER estilo Trigger 2**: solo tiempo ciego; pasado ese tiempo, si la señal sigue sobre DETAIL vuelve a disparar (0 ms = flams, ~4 disparos por golpe en SN TOP 1). **Default 30 ms** (16 daba ~2 por golpe). El C++ (`engine/DrumReplacer/DSP/TransientDetector.h`) todavía tiene la lógica vieja (rearma solo si la señal cae).
- **Página TRIGGER**: detector y SAMPLE + ENVELOPE 50/50. Editor dibujado en píxeles reales (antes era un SVG estirado). Se quitaron **END / FADE IN / FADE OUT**: quedan **START** (bandera abajo + botón **⇥ TRANSIENT**) y el envelope. **Release y readouts (START / ATTACK / DECAY / RELEASE como duraciones) se dejaron como estaban a pedido del usuario.**
- **Envelope multipunto** (estilo LFO Tool): doble click agrega puntos sin límite (pasado R, el nuevo punto pasa a ser R); doble click sobre un punto extra lo borra; niveles libres. Modelo: `slot.adsr` (A/D/R) + `slot.envPts [{t,v,id}]`; `slotEnvPoints()` arma la forma y `scheduleSlot` programa todos los puntos.
- **Zoom con la ruedita** en SAMPLE + ENVELOPE y en la waveform del input (20 ms–20 s); Shift+rueda = scroll.
- **Faders de consola**: verticales propios (`.sf-fader`), 0 dB a 3/4 del recorrido (`FADER_TAPER`), escala en dB, medidor en la misma escala, más largos (`--fader-h`).
- **Selección múltiple estilo Finder** (`multiSel`, scopes `env` / `knobs` / `faders` / `slots`): click = uno; **Shift o Cmd+click = sumar/quitar de a uno**; recuadro desde cualquier espacio vacío (también el negro entre paneles); click afuera deselecciona salvo sobre algo seleccionado; mover uno mueve el grupo; Cmd+A; Delete borra puntos. **Faders y slots nunca se mezclan.** Pasar a UNIVERSE deselecciona todo.
- **Teclado**: **Tab** alterna TRIGGER ↔ UNIVERSE; **1–8** reproducen el slot; **Alt+1–8** cargan el sample (HOME/FILE SEARCH: el seleccionado; TRIGGER: el del editor). Arrastrar el sample del editor a un slot: desde su nombre arriba de la waveform.
- **Bugs viejos arreglados**: click en vacío del editor dejaba el sample pegado al cursor (ahora el drag termina también en `pointerup`).
- **BOUNCE · MODIFIED SAMPLES** (abajo a la izquierda de TRIGGER, espejo del panel de Auto Phase): pide una carpeta (`showDirectoryPicker`) y escribe un WAV 24-bit por cada Trigger Slot cargado (o solo los slots seleccionados) tal cual suena en la mezcla, a velocity 1: START, envelope con todos sus puntos, reverse, tune, TONE/CUT, GAIN, polaridad, **nivel del fader, pan (sale siempre estéreo) y OFFSET de Auto Phase** (positivo = silencio antes del golpe; negativo = recorta el arranque). Mute/solo se ignoran; 90° no tiene DSP todavía. Ojo: si el WAV bounceado se vuelve a cargar con el mismo OFFSET, se aplica dos veces. Nunca toca el original y no pisa archivos: si ya existe agrega ` 2`. Sin selector de carpetas en el browser, cae a Descargas. Render offline (`renderSlotOffline`) con la misma cadena que la reproducción: diferencia máx. 0,0035 contra una referencia calculada aparte; polaridad: correlación −1.
- **TONE con fase cero** (decisión de arquitectura, vale también para el C++): CUT (pasa-bajos 12 dB/oct, 200 Hz–20 kHz) y TONE (shelf ±12 dB en 4 kHz) **ya no son filtros IIR en tiempo real**. Como cada slot reproduce un sample fijo, el EQ se aplica al sample fuera del audio thread: FFT → magnitud de los mismos filtros (fase descartada) → IFFT (`zeroPhaseEq`, `slotPlayBuffer`, cacheado por sample/reverse/CUT/TONE; ~4–18 ms por cambio). Así las capas quedan **en fase entre sí y con el input con cualquier EQ**, sin latencia. Medido: corrimiento de fase 0,0–0,2° en 500 Hz–4 kHz para CUT 50/75 y TONE ±100 (antes: hasta −149° con CUT 50 y ±53° con TONE ±100); magnitud idéntica a la curva anterior. **CUT arranca en 100% (sin filtro)**. El cambio de EQ se oye desde el siguiente disparo. En C++: mismo esquema (render offline del sample procesado + swap atómico), nada de IIR por voz.
- **Bounce a la frecuencia nativa**: el sample real se decodifica además a su sample rate original (48 kHz) y el bounce sale a esa frecuencia, sin el remuestreo a 44,1 kHz del contexto. El procesamiento es float 32; solo el WAV de salida es 24-bit.
- **GATE AUTO THRESHOLD**: la primera vez que suena el INPUT, la flecha del threshold se mueve sola (etiqueta mint **AUTO**) hacia el hueco entre el bleed y los golpes, usando solo lo ya escuchado; desde que encuentra el primer punto ideal sigue afinando **5 s de play** y se **bloquea** (aunque el INPUT siga sonando; si lo detenés antes, se bloquea ahí). Después no se mueve más salvo a mano. Mover el threshold a mano termina el aprendizaje; **Alt+click** en la flecha o el valor lo vuelve a −24 dB y lo re-arma. Algoritmo: picos de 10 ms → máximos locales ≥ 6 dB sobre la mediana → división Otsu en dB (bleed / golpes) → mitad entre p95 del bleed y p5 de los golpes (si se solapan, 3 dB bajo el golpe más suave); necesita ≥ 8 golpes. En SN TOP 1 encuentra el punto a los 4,6 s y se bloquea a los 9,6 s en **−16,5 dB**: pasan 135/135 golpes y el gate abre en 0/203 picos de bleed (con −24 dB abría en 128/203; abierto 20,9% del tiempo vs 38,6%). En el prototipo el estado no se guarda entre recargas; en el plugin va en el estado del preset.
- **AUTO PHASE global** (panel a la derecha de los faders, **dividido en dos tarjetas**: arriba la fase de **todos** los slots —ON/OFF, REF, MODO, RE-ANALYZE ALL y reporte de la suma— y abajo la fase **individual** del slot seleccionado —OFFSET, PHASE y resultado—; en ≤1000 px quedan lado a lado arriba de los faders): el título **AUTO PHASE** es el botón ON/OFF (verde = encendido). **REF** = INPUT o cualquiera de los 8 slots, **para todos** (el slot de referencia no se mueve y su canal dice REF). **MODO** = OFFSET / Ø / BOTH (default Ø). **RE-ANALYZE ALL** analiza todo. Debajo, para el slot seleccionado: **OFFSET escrito** (campo de texto, −5…+50 ms, Enter confirma, Alt+click borra la parte manual) y **PHASE** 0° / 90°. El resultado automático se guarda aparte de lo manual (`slot.ap`): polaridad efectiva = Ø manual XOR inversión auto; offset efectivo = trim manual + lag auto (`effPolarity`, `effOffset`), así apagar AUTO PHASE o cambiar el modo no pierde nada. El campo muestra el offset total; escribir un valor guarda la diferencia como trim. Los **canales con Ø o 90° se marcan en verde** (borde, badge y botón Ø). 90° sigue sin DSP. Se borró el popover viejo por slot.
- **AUTO PHASE con audio real** (ya no simulado, `computePhaseAlignment`): el criterio es la energía de la **suma real** (REF + todas las capas) en 3 bandas de fase cero: **LOW 40–250 Hz decide la polaridad** (gana la que deja más low), **LOW-MID 250 Hz–1,5 kHz** no puede perder más de 1 dB (sin huecos en el cuerpo) y, entre esos offsets, **HIGH > 1,5 kHz elige el offset fino** (ataque junto); además LOW no puede caer más de 0,5 dB. Pasos: (1) anclar cada capa al REF (lags −5…+10 ms); (2) afinar cada capa contra REF + las otras capas ya alineadas (±1,5 ms) hasta que nada cambie; (3) reportar en el panel `SUM LOW +x dB · BODY +y dB` contra no hacer nada, avisar pares que se siguen cancelando (`02↔05 cancel`) y capas que tocan el límite de −5 ms (aire antes del golpe → **⇥ TRANSIENT**). REF = INPUT usa el promedio de los golpes más fuertes alineados en el onset del detector (equivale exactamente a sumar la energía sobre todos esos golpes). Las capas se analizan como suenan (START, envelope, tune, EQ, gain, nivel) a velocity 1, sin polaridad/offset/pan. Cambiar REF o MODO re-analiza; cambios de TONE/tune/START piden **RE-ANALYZE ALL**. Validado: copia con START +2 ms → **+2,0 ms**, corr 1,00; copia invertida → **Ø**, corr 1,00; 4 capas contra SN TOP 1 en 244 ms, y verificación con otro filtro: LOW **+1,8 dB**, cuerpo **+2,5 dB**, agudos +0,1 dB. Con SNARE.cm sin recortar el análisis caía en Ø −4,7 ms (parche por los ~12 ms de aire); con ⇥ TRANSIENT queda en −0,4 ms sin invertir.
- **Lecturas de fase vencidas en rojo**: el análisis guarda una huella de lo que usó (sample, START, reverse, tune, TONE/CUT, GAIN, envelope, nivel del fader, VOLUME del input, REF y modo). Si algo de eso cambia después, **RE-ANALYZE ALL** (con pulso), el reporte de la suma, el resultado del slot y la lectura de fase + borde superior de los **canales afectados** se ponen en **rojo** hasta re-analizar. Si cambia la REF (el slot de referencia o el VOLUME del input), se marcan todos. Pan, mute/solo y los Ø/offsets manuales no cuentan.
- **RE-ANALYZE: primero fase, después offset**: (0) ubica el golpe en el tiempo con el contorno del ataque (|LOW-MID + HIGH| suavizado 0,5 ms), que no depende de la polaridad —si no, un atraso puro se lee como fase: 2 ms ≈ 144° a 200 Hz—; (1) mide la **fase en LOW** contra el objetivo en ese punto y, si es **≥ 90°, invierte (Ø)**; (2) con la polaridad fija, ajusta el **offset fino ±1,5 ms** para acercarlo a donde tiene que ir (LOW −0,5 dB, cuerpo −1 dB, máximo HIGH). El offset ya no puede "arreglar" la fase saltando medio ciclo. El slot muestra `Δφ 134° → Ø`. Validado con el snare como REF: copias corridas 0/2/3,5/6 ms → +0/+2,0/+3,5/+6,0 ms sin invertir; copias invertidas corridas 0/2/1/0,5 ms → Ø +0/+2,0/+1,0/+0,5 ms.
- **PHASE por slot = 0° / 90°** (decisión 22/11): se quitaron 180° y 260° del selector. La polaridad (Ø, 180°) sigue en el botón Ø de cada canal y en el modo Ø de Auto Phase; el ajuste fino lo hace el OFFSET escrito. 90° sigue sin DSP en el prototipo (all-pass/Hilbert en C++).
- **Ojo con la caché**: al tocar `app.js`/`style.css`, subir `?v=` en `index.html` (va en `v=224`) y en `detector-worklet.js?v=` dentro de `app.js`; si no, Chrome sigue usando la copia vieja.
- **GitHub**: el repo `JEROHACKERPLUGINS/TRIGGER_UNIVERSE` se puede leer pero Claude no puede hacer push (falta instalar la Claude GitHub App en esa org). Los cambios se commitean desde la Mac.

---

## 2.2 Sesión 22/11/2026 (noche) — AU: preview nativo y motor de reconocimiento

- **Preview en el AU**: el WebView del plugin no tiene Web Audio, así que el hover/click del universe, FILE SEARCH y los slots no sonaban. Ahora la UI manda `SAMFUI 11` (path en base64) / `12` (stop) y el C++ lo toca con `DSP/PreviewPlayer.h` (−8 dB, 0,8 s, fades sin click, lock-free), **encima de la salida y sin depender de MIX**. Click en un slot = preview del archivo crudo (todavía sin las ediciones del slot).
- **WAV**: `LoadWavFile(..., maxBytes)` lee solo el principio (preview/análisis de archivos largos) y tolera chunks `data` truncados.
- **Biblioteca**: un re-escaneo (p. ej. agregar una location) borraba casi todas las features → los samples se apilaban en el centro. Arreglado; los WAV ilegibles quedan fuera del mapa y no se re-analizan siempre.
- **Motor de reconocimiento (XO-style)**, `DSP/SampleAnalysis.h` + `DSP/SampleMap.h`, versión de análisis **3** (re-analiza la biblioteca una vez):
  - Huella: 16 bandas mel × 6 tramos (0–10/30/70/150/300/600 ms desde el golpe), relativa al máximo.
  - Tipo por audio: Kick / Snare / Clap / HHC / HHO / Cymbal / Tom / Perc / FX, con reglas sobre sub-graves, brillo (dB 1–10 kHz vs 40 Hz–1 kHz), aire, ruido 2–12 kHz, decaimiento a −40 dB, ataques > 1 kHz (claps) y re-golpes (loops/stems → FX). Si la confianza es baja (< 0,2) decide el nombre del archivo. Medido: 4/4 one-shots reales del repo, 96/108 sintéticos.
  - Mapa: **t-SNE** (como XO) sobre huella + duración + tipo → islas por tipo, ordenadas por parecido/duración. 360 samples 0,2 s, 1980 samples 2,9 s; vecinos del mismo tipo 100%. Se calcula en el hilo de análisis, se guarda en la biblioteca (`cls`, `conf`, `mx`, `my`, `fp`) y llega a la UI como `{"id":"map"}`.
- Tests nuevos en `engine/DrumReplacer/tests/`: `preview_player_test`, `sample_analysis_test` (acepta WAVs como argumento), `sample_map_test` (escribe `/tmp/sample_map.csv`).
- **Pendiente para que el AU suene en Ableton**: (1) los knobs del detector no significan lo mismo en UI y C++ (DETAIL invertido; el C++ tiene el detector viejo); (2) MIX arranca en 0 % (solo seco); (3) los samples de demo no tienen path nativo → el slot se ve cargado pero el motor está vacío; (4) el AU se registra como Music Effect (`aumf`) — confirmar cómo lo trata Live.
- **Standalone sin audio (resuelto)**: iPlug pedía siempre 2 entradas; el micrófono de la MacBook es mono → RtAudio no abría el stream (`probeDeviceOpen: does not support the requested channel count`) y no sonaba nada. Parche en `engine/_iPlug2/IPlug/APP/IPlugAPP_host.cpp/.h`: con `APP_NO_AUDIO_INPUT 1` (config.h) la app abre **solo la salida** (no usa entrada ni pide micrófono; la entrada de canal es cosa del AU). Sin ese define, abre las entradas que el dispositivo tenga (mono → ambos canales; sin entrada → silencio).
- `index.html`: `app.js?v=229`, `native-ui.js?v=4`.

## 2.3 Sesión 22/11/2026 (noche) — mapa tipo XO: estable, lleno y medido

- **Features v4** (`kAnalysisVersion 4`, re-analiza una vez): la fila guardada por archivo (`fp`, `kFeatSize` = 96 + 6) es la huella + descriptores **sin volumen** (decay40 log, brillo, aire, ruido 2–12 kHz, tonalidad grave, ataques). RMS/peak quedan para filtros, no para la posición.
- **Mapa** (`DSP/SampleMap.h`): huella → cepstrum (DCT, 8 coef × 6 tramos) + log duración + descriptores → z-score robusto (mediana/MAD) con pesos por bloque → tipo como sesgo (one-hot 2,6) → PCA-24 → t-SNE (perplejidad 50, exageración 4) → **llenado por transporte óptimo por proyecciones** hacia un disco parejo (girasol), blend 0,55 → 0,85 según el tamaño → raros (lejos de todo en features) al borde → caja 0..1.
- **Estable**: si ≥ 70 % ya tiene posición, los viejos **no se mueven** y cada nuevo entra en el promedio de sus 10 vecinos más parecidos + relajación local. Si no (o con **REBUILD MAP**, `SAMFUI 13`), se rearma todo y se **alinea al mapa anterior** (Procrustes: rotación/espejo/escala). Re-escanear conserva posiciones.
- **Criterios de aceptación** (`tests/sample_map_test.cpp`, ~2000 samples por defecto): pureza de vecinos por tipo ≥ 85 % (medido 94 %), trustworthiness ≥ 0,90 (0,97), separación kick/snare/hat ≥ 0,25 (0,37), llenado ≥ 45 % de una grilla 20×20 y celda más densa ≤ 4× (72 %, 1,7×), sin superposición, raros más lejos del centro que la mediana, insertar 10 % no mueve ningún viejo y los nuevos caen entre los suyos ≥ 80 % (98 %), rebuild alineado con desplazamiento mediano < 0,15 (0,09). 5000 samples: 15 s en segundo plano, todo OK. Bibliotecas < 1000: pureza ≥ 70 %.
- **UI**: el mapa se dibuja en la zona libre (medida: debajo del buscador, arriba del dock), proporción máx. 1,7:1; la profundidad ya **no mueve** los puntos (antes la escala por RMS separaba vecinos); fondo/estrellas a pantalla completa; los puntos se deslizan a su lugar nuevo (650 ms); botón **REBUILD MAP** en LIBRARY FOLDERS. `app.js?v=233`.

## 2.4 Sesión 22/11/2026 (noche) — universe con ejes fijos (pedido del usuario)

- **Decisión**: el universe tiene ejes con significado. **X: graves a la izquierda, agudos a la derecha** (invertido el 22/11 19:22 a pedido del usuario; `kMapVersion 3`). **Y: cortos arriba, largos abajo.** Dentro de eso, los sonidos parecidos se agrupan (como las constelaciones de XO). Reemplaza al t-SNE + llenado de §2.3 (esa lógica quedó en el historial de git).
- `DSP/SampleMap.h` (`kMapVersion 2`; al cambiar, las posiciones guardadas se descartan y el mapa se rearma): brillo = centroide mel del cuerpo (10–150 ms) + brillo perceptual; largo = log decay40 (largo audible, no el del archivo; FX usa el del archivo). Base = mezcla 60/40 de percentil y valor real en cada eje (llena el cuadro sin estirar casi-duplicados). Agrupamiento: cada sample se acerca a sus 8 más parecidos (espacio de timbre: cepstrum + largo + descriptores + tipo suave, z-score robusto, PCA-24), pull 0,5 × 2 pasadas, anclado a su base. Separación mínima entre puntos. Insertar: los viejos no se mueven; los nuevos toman su base de la distribución de los viejos y se acercan a sus parecidos viejos. Ejes fijos → el mapa no se da vuelta nunca. 2000 samples: 0,06 s.
- Criterios (`tests/sample_map_test.cpp`, biblioteca sintética con variación continua de afinación/color): Spearman X 1,00 e Y 1,00 (≥ 0,85), parecidos juntos 0,06 (≤ 0,35), familias en su lugar (kicks izq., hats der.-arriba, platos der.-abajo, toms izq.), pureza 82 % (≥ 65), llenado 46 % (≥ 35 % desde 1000 samples), sin apilados, insertar no mueve viejos y cae a 0,006 de un rebuild.
- UI: **sin rótulos de ejes** (decisión del usuario); las posiciones provisorias (mientras analiza) usan los mismos ejes.
- **Look del universe = el de la web original** (decisión del usuario: "se perdió la emoción gráfica"): pantalla completa con desborde (`bleed` 36 px, la nube pasa detrás del buscador / dock / bordes), parallax de profundidad (`scale = .84 + z·.32`), fondo y estrellas como antes. En el plugin la profundidad `z` se reparte por percentil de nivel + variación fija por sample (`assignNativeDepth`), porque el RMS crudo daba ~0 y todo salía chico y apagado. Grupos orgánicos: pull 0,42, dispersión fija por sample 0,014, ejes 75 % percentil. `app.js?v=240`.

## 2.5 Sesión 22/11/2026 (noche) — medidas nuevas, clasificador propio y similares 4D

- **Decisión**: no se usa nada de XO (ni código, ni `models.xpak`, ni su base de samples), aunque sea para uso personal; el repo `NEW-CODE-X` es un análisis por ingeniería inversa de XO y no se porta. De ahí solo se tomó la idea de **qué** medir; todo lo de abajo es código propio.
- `DSP/SampleAnalysis.h` (`kAnalysisVersion 5`, `kDescSize 9`): **LUFS** (ITU-R BS.1770, K-weighting para cualquier sample rate, máximo momentáneo 400 ms; 997 Hz −20 dBFS = −23,01 mono / −20,00 estéreo), **druminess** (0,35 ataque + 0,65 energía en los primeros 250 ms de 2 s), **late transient** (subida de nivel en dB de un segundo ataque entre 40 ms y 1,5 s; 1,5 dB = 0, 10 dB = 1). Test: `tests/measures_test.cpp`.
- `DSP/SampleClassifier.h`: **clasificador que aprende de la biblioteca**. Entrena una regresión softmax (Adam, L2, clases balanceadas) con los archivos cuyo nombre dice el tipo y etiqueta el resto; tipo final = nombre > modelo (p ≥ 0,55) > reglas. Clases con < 6 archivos nombrados no se aprenden. Corre en el hilo de análisis antes del mapa. Test (`tests/classifier_test.cpp`, 40 % con nombre): sin nombre 88 % (reglas) → 98 % (reglas + modelo).
- `DSP/SampleMap.h`: además de x/y, cada sample tiene un **embedding 4D** (4 primeras componentes del espacio de timbre) → la lista de similares de la UI usa esa distancia (+0,35 si cambia el tipo). 93 % de los 5 más cercanos comparten tipo.
- Plugin/UI: la biblioteca guarda `lufs`, `drum`, `late`, `e[4]`; el mensaje `map` trae `[idx, x, y, e0..e3, tipo]` + `modelClasses`/`modelFiles` (la UI avisa "Tipos aprendidos de tu biblioteca"). Profundidad del universe por percentil de LUFS. `app.js?v=241`.

## 2.6 Sesión 22/11/2026 (23 h) — Mac Pro: bibliotecas enormes y build con SDK viejo

- Rescatado del Mac Pro (cambios locales sin commitear) y adaptado al código nuevo:
  - **Biblioteca en bloques**: `libraryBegin` / `libraryChunk` (1500 archivos) / `libraryEnd`; la UI sigue aceptando `library`. Índice `state.nativeByIndex`, re-layout durante el análisis como mucho cada 1,5 s, lista de FILE SEARCH con "SHOW MORE" (+2000).
  - **Escaneo**: sin tope de 5000 archivos y sin abrir cada WAV (lo hace el analizador en segundo plano). Los archivos conocidos conservan toda su entrada cacheada.
  - **iPlug2**: `WKDownloadDelegate` solo con SDK ≥ 11.3 (el Mac Pro compila con MacOSX11.1.sdk).
- Bug arreglado del commit `3822f2d`: `lufs`/`drum`/`late`/`e` estaban duplicados al guardar y no se mandaban a la UI al abrir la biblioteca.
- Ojo: el mapa busca vecinos por fuerza bruta (O(n²)); con 100k samples el armado en segundo plano va a tardar mucho. Pendiente: kd-tree.
- `app.js?v=242`.

## 2.7 Sesión 22/11/2026 (23:30) — la app suena: detector del prototipo, INPUT de demo, caché, sin auto-escaneo

- **Sin auto-escaneo al abrir**: la app / el AU muestran la biblioteca cacheada tal cual. Se escanean las carpetas (y se analizan solo los archivos nuevos o cambiados) con RESCAN o al agregar una location. Única excepción: la primera vez (locations sin caché). Si hay samples analizados con un motor viejo, la UI avisa (`libraryStale`) y se re-analizan con RESCAN. Sin límite de archivos (el tope de 5000 ya no existe).
- **Caché de audio** (`DSP/PreviewCache.h`): el primer segundo de cada sample decodificado en memoria (LRU, 384 MB ≈ 1000 samples estéreo 48 kHz). La llena el analizador mientras lee cada archivo y cada preview; el preview sale de memoria al instante.
- **Detector = el del prototipo** (`DSP/TransientDetector.h`, verificado contra `detector-worklet.js` con SN TOP 1: 136/136 golpes, mismos tiempos y velocidades). DETAIL = umbral (0–100 % → 0–1,5 de full scale; antes estaba invertido), SUPPRESS, RETRIGGER = tiempo ciego. SENSITIVITY ya no es umbral: es el rango dinámico de los golpes (`TriggerGain` en `Dynamics.h`, misma fórmula que `playSlot`); el VELOCITY del slot dosifica cuánto sigue al golpe. Defaults = prototipo (SENS 51, DETAIL 14, RETRIG 30, SUPP 0, LOW 20, HIGH 20k).
- **INPUT de demo en la app** (`DSP/InputPlayer.h`): ▶ INPUT hace que el motor reproduzca SN TOP 1 dentro de su entrada (sumado a la entrada real); pasa por INPUT, detector, delay y MIX. Si no hay ningún slot cargado, el slot 01 recibe SNARE.cm (primer golpe, 510 ms) como en el prototipo. Los dos WAV van dentro del bundle (`Resources/web/`). La UI muestra el contador de triggers y el LED / velocidad de cada golpe (`hit`). Mensajes nuevos: `14` INPUT play, `15` INPUT stop; motor → UI `input` {playing}, `libraryStale`.
- Ojo: con MIX en 0 % se escucha solo el INPUT (igual que en la web); para oír los samples disparados hay que subir MIX.
- `app.js?v=243`. Test nuevo: `tests/input_player_test.cpp`.

## 2.8 Sesión 22/11/2026 (23:45) — AUDIO / MIDI SETUP en la app y audio que no falla en silencio

- **Por qué la app no sonaba**: el host APP de iPlug2 arrancaba en 44100 Hz con "Built-in Input/Output", pedía siempre 2 canales de entrada y, si el stream no abría (salida bloqueada en 48 kHz, entrada mono, sin entrada), quedaba muda sin decir nada.
- **Host** (`_iPlug2/IPlug/APP/IPlugAPP_host.*`, parche local marcado "TRIGGER UNIVERSE"): `InitAudio` abre la entrada con los canales que tenga (mono → ambos lados), acepta "sin entrada" (`off`), y si falla reintenta al sample rate del dispositivo de salida y después solo salida; deja el motivo en `GetAudioNote()`. API pública nueva: `ListAudioDevices`, `ApplyAudioSettings`, `ApplyMidiInput`, `IsAudioRunning`, etc. Sin salida → aviso en el panel en vez de un MessageBox.
- **Plugin**: `AppAudioSetup.{h,cpp}` (solo APP; aislado para que RtAudio/SWELL no entren al resto). Mensajes 16 = estado/dispositivos, 17 = aplicar {in,out,sr,buffer}, 18 = Test (3 pitidos de 660 Hz por la ruta del preview, independiente de MIX), 19 = entrada MIDI. Motor → UI `audio` {devices, in, out, sr, buffer, running, activeSR, activeBuffer, inChans, note}.
- **Crash al arrancar (23:47)**: el host había tomado como entrada la entrada por defecto del sistema ("Dolby Audio Bridge", virtual, 130 ch) junto con la salida Antelope (otro dispositivo) y la app se caía. Ahora: la entrada queda en "Sin entrada" hasta que el usuario la elige en el panel (`inchosen` en settings.ini) y hay un guard (`audio-input.guard` junto a settings.ini): si la app muere con una entrada abierta, el próximo arranque es sin entrada y lo avisa.
- **Crash real (encontrado con AddressSanitizer, 23:55)**: heap-buffer-overflow en `ProcessBlock` escribiendo la salida. El host APP de iPlug2 siempre le pasaba al plugin un bloque completo de `APP_SIGNAL_VECTOR_SIZE` (64) frames dentro del buffer del dispositivo, y `IPlugAPP::AppProcess` ignoraba `nFrames`; con un buffer de dispositivo de 32 samples (elegido en el panel) se escribía fuera del buffer de RtAudio y se corrompía la memoria → crash en cada arranque. Ahora el callback procesa en trozos de ≤ 64 frames y `AppProcess` respeta `nFrames` (`IPlugAPP_host.cpp`, `IPlugAPP.cpp`). Cualquier tamaño de buffer funciona. Diagnóstico reutilizable: `diagnostico-asan.command` (build con ASan en `build-asan/`, corre 25 s y deja `asan.log`).
- **Biblioteca blindada**: `library.json` se lee entrada por entrada con valores tolerantes (un NaN guardado como `null` o una entrada rota ya no tira la app al abrir; esa entrada se re-analiza con RESCAN), se escribe sin NaN/inf, con UTF-8 inválido reemplazado y de forma atómica (`.tmp` + rename). El hilo de análisis atrapa excepciones (antes cerraban la app entera).
- **UI**: SETTINGS → AUDIO / MIDI… abre el panel (Output + Test, Input con "Sin entrada", Sample rate, Buffer, MIDI input, estado, REFRESH, ▶ INPUT DE DEMO). Si al abrir la app el audio no está corriendo, el panel se abre solo. `app.js?v=244`.

## 2.9 Sesión 23/11/2026 (00:05) — INPUT en vivo en la app y canal de entrada

- La vista TRIGGER de la app no recibía nada del motor (dibujaba "INPUT DEL HOST" plano). Ahora `DSP/InputMeter.h` guarda el pico de la entrada cada 1 ms (después de INPUT, lo que ve el detector) y cada golpe en su onset; `OnIdle` los manda como `inmeter` {from, peaks, hits} y la UI los dibuja como el prototipo (onda, línea DETAIL, marcas naranjas, medidor y dB, ventana = zoom del detector). Si una entrada abierta no trae señal 2 s, avisa "SIN SEÑAL EN <placa> · CANAL n" (canal equivocado o permiso de Micrófono de macOS).
- Canal de entrada elegible (AUDIO / MIDI → Input channel): cada canal solo (mono → a los dos lados, sin perder 6 dB) o pares estéreo. Host: `in1/in2` de settings.ini → `firstChannel` / `nChannels` de RtAudio.
- `app.js?v=245`. Test: `tests/input_meter_test.cpp`.

## 2.10 Sesión 23/11/2026 (00:30) — cadena completa por slot en el motor, ONE SHOT / GATE, OUTPUT meter, MIX 100 %

- **Orden** (pedido del usuario): INPUT → TRIGGER → TRIGGER SLOT → SAMPLE ENVELOPE → TONE → PHASE → OUTPUT.
- Antes el motor de la app solo recibía nivel/pan/tune/velocity/fase/solo/mute: SAMPLE + ENVELOPE no hacía nada. Ahora la UI manda la **forma** de cada slot (mensaje 20, JSON: path, dur, start, end, reverse, tune, cut, tone, gain, fadeIn, fadeOut, env = `slotEnvPoints`, pol = `effPolarity`, offset = `effOffset`, mode), revisada cada 150 ms (cualquier edición entra). El motor (`DSP/SlotShape.h`) la hornea en el buffer que tocan las voces, con las mismas fórmulas que BOUNCE (`renderSlotOffline`): reverse, CUT/TONE de fase cero (magnitudes de BiquadFilterNode de Web Audio), START/END sobre la duración de la UI, TUNE, envolvente con todos los puntos (1 ms mínimo en el primer tramo, rampa a 0 en 4 ms), fades, GAIN, polaridad y OFFSET. **Verificado contra el prototipo en Chrome**: dos slots muy distintos dan −116 dB y −96 dB de diferencia máxima (correlación 1,000000).
- **OFFSET negativo**: el seco se retrasa 5 ms más (`tu::kLookMs`, latencia = ventana del detector + 5 ms) y cada sample empieza con 5 ms + OFFSET de silencio.
- Por golpe quedan en tiempo real: velocity/SENS, fader, pan, mute/solo y el modo. TUNE y Ø ya no se aplican en tiempo real (van horneados). 90° sigue sin DSP (como en el prototipo).
- ~~ONE SHOT / GATE por slot~~ (reemplazado en §2.12: solo ONE SHOT con corte; el GATE va antes del detector).
- **OUTPUT meter**: el motor manda el pico de salida (`outmeter`) → `#outVuBar` y `#masterMeter`.
- **MIX arranca en 100 %** (motor y UI).
- Estado del plugin v3: guarda la forma de cada slot (v2 sigue cargando).
- `app.js?v=246`. Test: `tests/slot_shape_test.cpp`.

## 2.11 Sesión 23/11/2026 (00:25) — mixer de capas como Trigger 2 y ediciones en tiempo real

- **Faders / pan / velocity / mute / solo** de cada capa: la UI los manda al motor apenas cambian (mismo sondeo que la forma, ahora cada 60 ms). Se aplican por bloque, también sobre los golpes que ya suenan (balance de lo que se está triggeando, como el mixer de Trigger 2).
- **VU de cada fader**: el motor mide cada capa después de su fader / pan / gate (`outmeter.slots`) y la UI los dibuja como en la web.
- **Ediciones en tiempo real**: un cambio de envolvente / TONE / CUT / GAIN / Ø / OFFSET / START-END / reverse ya no espera al próximo golpe ni corta el que suena: las voces pasan al buffer nuevo en la misma posición con un crossfade de 5 ms (`Slot::SetSample(p, true)`, `SamplerVoice::Retarget`). El buffer viejo se libera recién cuando terminó el crossfade. Un archivo nuevo en el slot sigue cortando las voces viejas.
- `app.js?v=247`. Test: `tests/realtime_edit_test.cpp`.

## 2.12 Sesión 23/11/2026 (00:35) — GATE al principio, ONE SHOT con corte

- **Orden del motor**: INPUT (+ INPUT de demo) → **GATE** → INPUT DETECTOR → TRIGGER SLOT → SAMPLE ENVELOPE → TONE → PHASE → fader/pan → MIX → OUTPUT.
- **GATE** = lo primero, ordena la entrada antes del detector (como el worklet): `InputGate` con umbral / attack / hold / release de la UI (mensaje 21) y on/off (`kGateEnabled`, glide de 8 ms), mira 1 ms adelante (la entrada se retrasa 1 ms; latencia = 1 ms + ventana del detector + 5 ms). El detector y el seco reciben la entrada gateada. Se sacó el gate viejo disparado por golpes que actuaba solo sobre el seco (y ya no depende de PRO). Verificado contra el worklet con GATE on: 136/136 golpes, mismos tiempos y velocidades. El LED y el medidor GR de la UI siguen al motor (`outmeter.gate/gateOn`).
- **Modo de disparo**: solo ONE SHOT; un golpe nuevo **pisa** al que suena en ese slot (fade de 5 ms desde la posición del golpe nuevo, sin superponer). Se sacó la fila MODE (ONE SHOT/GATE) de la caja PHASE y el modo GATE por slot del motor.
- `app.js?v=248`. Test: `tests/choke_test.cpp`.

## 2.13 Sesión 23/11/2026 (00:45) — AU

- El AU (`aumf TRGU DANT`, Music Effect) toma la entrada de la **pista del DAW** y sale a la **pista del DAW**: no hay placa, ni sample rate ni buffer propios. El motor le avisa a la UI `init.host = "plugin"` (o `"app"`); en plugin se oculta SETTINGS → AUDIO / MIDI… y la vista TRIGGER dice "ENTRADA DEL PLUGIN" (sin alarma por silencio: con el transporte parado es normal).
- Build: `construir-au.command` (Release, instala en `~/Library/Audio/Plug-Ins/Components`, corre auval y deja `TriggerUniverse-AU.zip`). `app.js?v=249`.

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
3. Se disparan los slots cargados. Con **MIX 100%** se escuchan solo los samples; el input original queda reemplazado.
4. El **mini VU de OUTPUT** se mueve, el medidor **INPUT** muestra el nivel que pasa por el gate y el VOLUME, y el **VU GR rojo** muestra la reducción del gate.
5. Para escuchar el **input original y el GATE**, bajá **MIX** por debajo de 100% (**0% = solo input original**). El LED junto a GATE indica open/closed.
6. Para cargar capas, volvé a HOME o FILE SEARCH y hacé **ALT + drag** de un sample a un slot.

Si no se escucha nada:

- Hacer click dentro de la página (política de autoplay de Chromium).
- Revisar la consola del browser (`tools.browser.console`).
- Confirmar que `prototype/samples/SN_TOP_1COMMIT_17-140.wav` (INPUT) y `prototype/samples/SNARE.cm.wav` (sample) existen.
- El `AudioContext` debe estar en `running` (`window.__audio.context.state`).

### 3.3 Handles de debug

En la consola del prototipo:

```js
window.__TU          // estado completo (slots, samples, filtros)
window.__audio       // contexto, hits, buffer, playInput, stopInput, playSlot
window.__audio.hits  // hits detectados por el detector JS
window.__audio.gateEnv // envolvente del gate (5 ms por bloque)
window.__audio.gains   // ganancias dry / wet / gate / input
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
| 5 | Envelope | **A/D/R** en la UI con tres puntos libres en X e Y: attack (tiempo + pico), decay (tiempo + nivel) y release (punto final libre en tiempo + nivel). Sin hold ni sustain; el release queda por defecto al final del sample y R es la duración desde el decay hasta ese punto. El motor sigue soportando ADSR. Incluye fade in/out + start/end/trim. **Sin time-stretch** |
| 6 | Fase | **Ø = 180°** (polaridad, botón Ø del canal y Auto Phase). **Phase shift por slot: 0° / 90°** (180°/260° quitados del selector el 22/11; el OFFSET escrito hace el ajuste fino) |
| 7 | Auto-phase | **Global**: ON/OFF, una REF (INPUT o cualquiera de los 8 slots) y un MODO (OFFSET / Ø / BOTH) para todos los slots. Corre al cargar un sample o cambiar la REF. Default ON, REF INPUT, modo **Ø**. El resultado se guarda aparte de lo manual |
| 8 | Slots | Dock fijo de 8 recuadros de glass **01–08**, cuadrados y centrados, vacíos al inicio |
| 9 | Editor | Vive dentro de la página TRIGGER y pertenece al slot seleccionado (default SLOT 01). Se abre con doble click en un slot (o click en uno vacío); el click en un slot lleno audiciona |
| 10 | Paneles del editor | **SAMPLE + ENVELOPE** en una sola waveform (sample + trim/fades + curva A/D/R) y **TONE** compacta a todo el ancho; **AUTO PHASE** vive en un panel vertical al lado del banco de faders |
| 11 | Auto Phase | Panel vertical al lado del banco de faders: título = botón ON/OFF, REF, MODO, RE-ANALYZE ALL; por slot seleccionado OFFSET **escrito** (no knob/fader) y PHASE 0/90. Canales con Ø/90° en verde |
| 12 | TRIGGER | Tercera página full-screen, se abre con el corchete vertical TRIGGER (izquierda). Contiene INPUT DETECTOR estilo Slate en cinco columnas (GATE · INPUT · FILTER · waveform · DETECT) + sample view angosto con una sola waveform SAMPLE + ENVELOPE + tira TONE full-width + banco de 8 faders con Auto Phase. OUTPUT y MIX están en la cápsula master superior. El corchete vuelve a la vista anterior; **Esc siempre vuelve a HOME** |
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
    └── samples/
        ├── SN_TOP_1COMMIT_17-140.wav   INPUT real (0:17–2:20)
        └── SNARE.cm.wav                one-shot real
```

**Tamaños aproximados:** `engine/` 185 MB, `prototype/` ~14 MB (11 MB del INPUT real de 123 s), `docs/` 13 MB.
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

- 1000 samples sintéticos + 1 real (`SNARE.cm`, id 9001). El INPUT del trigger es el caso real **SN TOP 1 (0:17–2:20)**, separado del sample.
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

1. **SAMPLE + ENVELOPE** (una sola waveform con trim/fades y la curva A/D/R superpuesta)
   - Izquierda: waveform real, handles de **start / end / fade in / fade out**, readouts en ms y **Reverse**.
   - Derecha: **ENVELOPE · A/D/R** con tres puntos libres en X e Y, waveform fantasma detrás y readouts A/D/R editables.
   - Audition se hace clickeando un Trigger Slot lleno o una fila de FILE SEARCH.
   - Drag desde la waveform a otro slot.
2. **TONE** (todo el ancho)
   - TONE (−100…+100), CUT (0–100%), VELOCITY, GAIN.
   - Sin ONE SHOT / GATE ni LOOP: el disparo es one-shot sin loop.
3. **AUTO PHASE** (no es panel del editor)
   - Tira horizontal arriba del banco de faders, atada al slot seleccionado:
     - REF: INPUT / SLOT 1.
     - **RE-ANALYZE & ALIGN**.
     - **TIMING** on/off.
     - Resultado: `corr`, polaridad, offset o `suggested`.
     - OFFSET manual (−5…+50 ms).
     - PHASE: 0° / 90° (Ø en el canal).

**Fase y badges:** 180° = Ø. El botón Ø y el segmento 180° son recíprocos. Los badges de fase se mantienen en el editor.

### 7.5 TRIGGER (página)

- Tercera página full-screen, como HOME o FILE SEARCH. Se abre con el **corchete TRIGGER** izquierdo; se vuelve con el mismo corchete (recuerda la vista anterior).
- Sin fila de header: se quitaron título, INPUT, HITS y MASTER. El contenido arranca arriba; el corchete TRIGGER activo identifica la página.
- **INPUT DETECTOR** a la izquierda (~68–70% del ancho; ~70/30 en ventanas angostas), en columnas estilo Slate: **GATE** (ON/OFF + ATTACK, HOLD, RELEASE + **VU GR** rojo), **INPUT** (medidor pre-gate centrado + **flecha de GATE THRESHOLD** + VOLUME + SUPPRESS + ▶ INPUT), **FILTER** (LOWCUT, HIGHCUT centrados), **waveform central post-gate** y **DETECT** (DETAIL, RETRIGGER, SENSITIVITY centrados).
- **Jerarquía del detector:** **INPUT VOLUME** escala el medidor, la waveform, la señal que llega al detector y la **velocity** de los samples; **DETAIL** es el threshold de detección (línea dashed mint, independiente del volumen): más Detail = más threshold (ignora bleed), menos Detail = atrapa ghost notes; el rango tiene 1.5× de headroom para poder ponerlo por encima de los transientes y silenciar los triggers; **SENSITIVITY** controla el **rango dinámico** de la velocity (0% = nivel fijo, 100% = dinámica amplia), como el control Dynamics de Trigger 2; **RETRIGGER** es la ventana ciega después de cada hit donde no se permite otro disparo (solo audio, sin gráfica); LOWCUT/HIGHCUT filtran **solo la detección** (no el audio seco).
- **GATE C1-style:** threshold sobre el input con **flecha naranja en el medidor INPUT** (el medidor es pre-gate) + **ATTACK/HOLD/RELEASE** y **VU GR** rojo junto a los knobs del GATE. El gate es post-VOLUME y su señal **post-gate alimenta la detección**; la waveform del detector se dibuja post-gate en azul con un **fantasma rojo suave del input pre-gate**. ATTACK 0 es instantáneo: la envolvente de 1 ms se abre un bloque antes del transiente (lookahead) para no recortar el ataque. El detector del gate usa **8 ms de release (CLEAN de Slate) + 4 dB de histéresis + release mínimo 5 ms**; defaults **HOLD 30 ms / RELEASE 150 ms** para preservar el cuerpo y evitar flams. Prender/apagar el gate hace un glide de 8 ms para evitar el click del cambio de ganancia. Solo procesa el input original, nunca los samples.
- **Medidores:** INPUT y OUTPUT/MASTER usan el **pico real** del analizador (float time-domain), no RMS, con un hold corto para que los transientes de 1 ms sean visibles. La barra de INPUT y la flecha de threshold comparten la misma escala en dB (inset 4% para que los labels 0/−48 entren en el track). INPUT muestra el pico pre-gate; el header muestra el valor numérico y el VU master el pico post-OUTPUT. VEL junto a DETECT muestra la velocity del último hit.
- **Zoom de la waveform:** muestra una ventana de **2 s** (≈6 transientes en SN TOP 1) y sigue al playhead durante la reproducción. Las líneas naranjas de hit llegan hasta el pico post-gate de cada transiente, no hasta el borde superior. El retrigger no se dibuja: solo afecta el disparo.
- **Detección en vivo:** el input se analiza y los slots se disparan hit por hit con un loop de 20 ms y 80 ms de lookahead. Al mover cualquier parámetro mientras suena el input se recalculan hits/gate y los próximos disparos cambian en el momento. Detail/Retrigger/Suppress/Lowcut/Highcut y el gate (threshold/attack/hold/release) afectan los disparos futuros; Sensitivity cambia el rango dinámico de los samples; Input Volume escala detección, velocity y audio seco; MIX y OUTPUT son inmediatos. Los filtros no alteran el audio seco (solo la detección). Salir de TRIGGER detiene el INPUT y sus disparos.
- **OUTPUT + MIX** están en la cápsula master superior, no dentro del detector. **MIX** es el blend seco/húmedo: **0% = input original**, **100% = samples disparados**; arranca en **100%**. **OUTPUT** es el volumen final del plugin (master gain). Para escuchar el gate hay que bajar MIX de 100%.
- **Sample view** a la derecha (~30–32% del ancho): **SAMPLE + ENVELOPE** en **una sola waveform**. El gráfico muestra el sample completo con trim/fades, la curva final A/D/R × fades en mint, los handles de start/end/fade in/out y los tres puntos A/D/R. Abajo van dos filas de readouts editables: START/END/FADE IN/FADE OUT y A/D/R. **TONE** sigue como tira full-width debajo del detector/editor.
- **Banco de 8 faders** arriba del dock, alineado columna a columna con los slots:
  - Fader vertical (≈136 px), meter real, M/S/Ø, nivel dB y badge de fase.
  - **AUTO PHASE** en una tira horizontal arriba de los faders, atada al slot seleccionado.
  - Click en un fader selecciona el slot para el editor y la tira de Auto Phase.
- **Fila inferior:** banco de 8 faders + **panel vertical de Auto Phase** a la derecha, centrados como grupo. El banco de faders y el dock de slots quedan centrados en su posición original; el panel de Auto Phase ocupa el margen derecho sin moverlos (se angosta a ~98 px en 1076 y pasa arriba de los faders en <=1000). **TONE** quedó en una tira compacta (38 px) y el chrome superior (título, OUTPUT y MIX) se achicó para dar más alto al detector y al sample view.
- **Dock de 8 slots cuadrados** abajo, siempre visible en todas las vistas:
  - Recuadros de glass `01`–`08`, cuadrados y centrados, vacíos al inicio.
  - ALT + drag desde HOME o FILE SEARCH para asignar; el × vacía el slot. Click en un slot lleno **audiciona** su sample; doble click lo abre en TRIGGER.
  - Click en un slot abre la página TRIGGER con ese slot cargado.
  - Nombre, dot de categoría y duración cuando tiene sample.

### 7.6 Settings / OUTPUT

- **OUTPUT + MIX** en la cápsula master al extremo derecho. **OUTPUT** (−24…+6 dB) aplica al master gain real y tiene un **mini VU vertical** alimentado por el analizador master. **MIX** (0–100%) hace el blend entre input original (0%) y samples disparados (100%).
- **Settings**: se abre desde el corchete vertical derecho; el menú aparece a su izquierda y el corchete se resalta mientras está abierto. Contiene AUTO PHASE ALL, FLIP ALL POLARITY, LIBRARY FOLDERS…, AUDIO / MIDI…
  - AUTO PHASE ALL re-analiza las 8 capas.
  - FLIP ALL invierte polaridad en los 8 slots.
  - Los otros dos son toasts demo.
- **AUDIO TEST y LED eliminados** de la barra: el audio se inicia con **▶ INPUT**, al clickear un sample de HOME, una fila de FILE SEARCH o un Trigger Slot cargado.

---

## 8. Audio real en el prototipo

### 8.1 Archivos

**INPUT real:** `prototype/samples/SN_TOP_1COMMIT_17-140.wav`, recorte de `SN TOP 1COMMIT.18_01.wav` entre **0:17 y 2:20** (123.0 s), mono, 48 kHz, 16-bit PCM, normalizado de −5.5 a **−0.5 dBFS** para que el caso real tenga un nivel comparable al viejo SNARE.cm. El archivo original dura 276.8 s.

| Dato | Valor |
| --- | --- |
| Duración | 123.0 s |
| Canales | 1 |
| Sample rate | 48000 Hz |
| Bit depth | 16-bit PCM |
| Peak | −0.5 dBFS |
| RMS | −26.88 dBFS |

**Sample de slot:** `prototype/samples/SNARE.cm.wav` (copiado de `~/Desktop/SNARE.cm.wav`). Duración 8.1489 s, 2 canales, 48 kHz, 24-bit; 11 golpes principales + ghosts/flams. El primer hit (0.14–0.65 s) sigue siendo el one-shot real del slot 01.

### 8.2 Qué está cableado

- `decodeAudioData` carga ambos WAV; el contexto los remuestrea a 44.1 kHz.
- **SN TOP 1 completo (123 s)** → **INPUT** del trigger.
- **Primer golpe de SNARE.cm** recortado de 0.14 s a 0.65 s (0.51 s) → sample del **slot 01**.
- Waveform del editor: real. Waveform de INPUT: real, con marcas de los transientes detectados.
- 8 capas Web Audio, cada una con:
  - playbackRate (tune),
  - start/end,
  - fades in/out,
  - A/D/R (attack/decay/release, sin hold; el release es el punto final libre),
  - gain por slot,
  - lowpass (cut) + high shelf (tone),
  - pan,
  - mute/solo,
  - polaridad 180° como gain −1.
- Meters master y por slot con `AnalyserNode`.
- OUTPUT knob aplica al master gain.
- **▶ INPUT** reproduce el archivo completo y dispara las 8 capas en cada hit detectado.

### 8.3 Limitaciones del prototipo

- **90° no se aplica al audio**: solo se guardan y se muestran. El DSP real va en C++ (all-pass / Hilbert).
- **180° sí se aplica** como inversión de polaridad (gain −1).
- El **auto-phase analiza el audio real** (suma por bandas, ver §2.1); falta pasarlo al C++.
- **Offsets negativos** se aplican adelantando el sample dentro del lookahead (20–80 ms); si el resultado cae en el pasado se clampa al próximo bloque de audio. El rango de UI es −5…+50 ms.
- **Velocity:** los disparos del INPUT usan el pico real del transiente; el preview de hover/audition usa velocity 1.
- **ALT + drag fuera de un slot** muestra el toast de export a Finder; el drag real al Finder queda para el plugin.
- **Similitud**: usa features sintéticas (categoría, duración, brightness, druminess), no análisis tímbrico del audio. La línea y el paneo suave son efectos de navegación.
- **ONE SHOT / GATE y LOOP** se retiraron de la tira TONE; el disparo es **one-shot sin loop**. **Reverse** reabre la envolvente para que el transiente invertido sea audible y restaura la forward al volver.
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

**Detector JS:** 22 hits con defaults (Sens 51, Detail 14, Retrig 16; el C++ detecta 23 y difiere en el transiente final 8.141 s). Gate ON/OFF no cambia el conteo (el gate solo procesa el input original). Con Detail 70: 11. Con Retrig 1000: 6. Con Sens 0: 0.

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

- Auto-phase real en el prototipo; falta en C++.
- 90° sin DSP.
- Offsets negativos aplicados dentro del lookahead y clampeados al próximo bloque si caen en el pasado.
- Velocity aplicada en los disparos del INPUT (pico real); el preview usa velocity 1.
- ONE SHOT / GATE y LOOP retirados de TONE; Reverse usa envolvente completa.
- La escala de interfaz VISUAL se limita a 90/100: los valores >100 hacían que el layout fijo de TRIGGER se solapara con el dock.
- Folder picker / Audio-MIDI son demos.
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
- Implementar **90°** con all-pass/Hilbert por slot.
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
| `prototype/samples/SN_TOP_1COMMIT_17-140.wav` | INPUT real 0:17–2:20 |
| `prototype/samples/SNARE.cm.wav` | One-shot real de slot |
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
28. **Doble click en faders**: el click sobre un valor numérico ya no se propaga al contenedor, así el fader no se re-renderiza entre los dos clicks y la edición in-place funciona en los 8 niveles. Se auditaron los valores numéricos (detector, MIX, OUTPUT, faders, tone, waveform, A/D/R y offset) con la secuencia de click completa.
29. **Editor numérico neutro**: se quitó el halo mint, el subrayado punteado y el cambio de color al hover. El valor editable se indica solo con un recuadro gris de 1 px y fondo apenas más claro; la selección de texto también usa gris. El estado inválido mantiene un borde rojo tenue.
30. **Envelope A/D/R sin hold**: los tres puntos son libres en X e Y. Attack ajusta tiempo y pico; Decay ajusta tiempo y nivel; Release es el punto final, libre en tiempo y nivel, y por defecto cae al final del sample. No hay meseta de sustain: el release sale directamente del decay. El readout R es la duración desde el decay hasta el punto de release; editarlo mueve ese punto. Mover Decay no mueve el release. Reset A 0 / D 120, release al final del sample, pico 100%, nivel de decay 50% y nivel final 0%. El motor sigue soportando ADSR.
31. **Waveform en el ADR**: el gráfico del envelope superpone la waveform del sample recortado (y reversible) como silueta tenue detrás de la línea. El release point queda por defecto al final de cada sample, de modo que R se recalcula por sample; su nivel final es libre.
32. **SAMPLE limpio**: se quitaron los botones Audition y Normalize del panel SAMPLE. Audition queda en el click de un Trigger Slot lleno o una fila de FILE SEARCH; Reverse queda junto a los readouts de start/end/fades y se marca en mint cuando está activo. Se eliminó el playhead de audition.
33. **TRIGGER 2.0**: el detector se dividió en **PRE-TRIGGER** (input, filtros, suppress, gate) y **POST-TRIGGER** (sens, retrig, detail, output, mix). SAMPLE y ENVELOPE se fusionaron en un solo panel grande, con la waveform a la izquierda y el ADR con waveform fantasma a la derecha. TONE pasó a todo el ancho. AUTO PHASE salió del editor y vive en una tira horizontal arriba de los faders, atada al slot seleccionado; el banco de faders se acortó para dar más alto al editor.
34. **TRIGGER 2.1 — detector Slate**: el detector pasó a seis columnas (GATE con ON/OFF + ATTACK/HOLD/RELEASE; INPUT con medidor + VOLUME + ▶ INPUT; FILTER con LOWCUT/HIGHCUT/SUPPRESS; waveform central; DETECT con SENSITIVITY/RETRIGGER/DETAIL; OUTPUT con medidor + VOLUME + MIX). Se agregaron los medidores verticales de INPUT/OUTPUT, los volúmenes de entrada/salida quedaron conectados al audio y el sample view se angostó a ~36%. TONE pasó a una tira full-width; el split del detector es ~64/36.
35. **TRIGGER 2.2 — flujo real del detector**: el GATE quedó **antes del VOLUME** con **THRESHOLD** (además de ATTACK/HOLD/RELEASE) y ahora cierra de verdad el input seco y la señal de detección; el VOLUME regula el nivel que llega a la waveform/detector y también al path seco; LOWCUT/HIGHCUT filtran solo la detección. SUPPRESS se movió a INPUT y FILTER quedó con LOWCUT/HIGHCUT. OUTPUT y MIX salieron del detector: viven en la cápsula master superior. **MIX 0% = input original, 100% = samples disparados** y ahora está conectado al grafo de audio (dry/wet), por lo que el gate se escucha al bajar MIX. La waveform del detector muestra el material gateado en azul oscuro y el que pasa en azul claro, con la línea de threshold y el LED open/closed.
36. **TRIGGER 2.3 — gate y detector alineados con Slate** (Trigger 2 Deep Dive 09:00–10:20 + manual): se eliminó el THRESHOLD del GATE. El gate ahora es **transient-driven**: abre en cada hit detectado y ATTACK/HOLD/RELEASE moldean su envolvente; no altera la detección (gate ON/OFF da el mismo conteo). **DETAIL** pasó a ser el threshold de detección, dibujado como línea dashed mint independiente del volumen; **SENSITIVITY** es la ganancia de detección y **RETRIGGER** se muestra como la **ventana roja** después de cada hit. La detección usa la señal normalizada al pico del sample, igual que la waveform. La waveform colorea el material que pasa el gate en azul claro y el tail gateado en azul oscuro; se quitaron la línea roja de threshold de gate y el cruce de responsabilidades. Defaults alineados al screenshot de Slate: Attack 0.5 ms, Hold 4 ms, Release 450 ms, Sens 51, Retrigger 16, Detail 14, Suppress 0%.
37. **Detector: foco y limpieza visual**: el retrigger dejó de dibujarse (solo afecta el audio/disparo), las líneas naranjas de hit ahora llegan al pico real de cada transiente en vez de cruzar todo el panel, y la waveform pasó a una ventana de **2 s** que muestra ~6 transientes (antes se veía todo el sample comprimido) y sigue al playhead durante la reproducción. Se agregó la etiqueta de escala temporal (2.0 s) abajo a la derecha.
38. **Detector: waveform limpia + VU de gain reduction**: se sacó el coloreado del gate en la waveform (el gate solo se ve en el LED y en el nuevo VU **GR**). El VU GR es rojo, vertical y llena de abajo hacia arriba mostrando la atenuación del gate en un rango de 0–24 dB; vive al lado del medidor INPUT, con label GR rojo en el header. La waveform queda azul limpia con la línea DETAIL, los hits naranjas al pico y la ventana de 2 s.
39. **Detección y disparo en tiempo real**: se eliminó la preprogramación de todos los hits al arrancar el input. Un loop de 20 ms con 80 ms de lookahead dispara los slots a medida que avanza el playhead y usa la lista de hits recalculada en vivo. Al mover Detail, Sens, Retrigger, Suppress, filtros, Input Volume o Gate mientras suena el input, los próximos disparos y la reducción del gate cambian sin reiniciar la reproducción. Los filtros siguen afectando solo la detección, no el audio seco.
40. **Alt+click reset**: todos los valores numéricos se resetean a su default con Alt+click sobre el número o el control (knobs, faders, MIX, OUTPUT, tone, sample, A/D/R, offset). Faders y OUTPUT van a 0 dB, MIX a 100%, el detector a sus defaults. Se limpia el estado de edición para que el doble click vuelva a abrir el editor después del reset.
41. **SAMPLE + ENVELOPE unificados en una waveform**: se eliminó el segundo gráfico ADR. La waveform única muestra el sample completo con trim/fades, la curva A/D/R superpuesta y la curva final que combina ADR × fades. Los handles editan start/end, fade in/out y attack/decay/release en el mismo SVG; los readouts se ordenaron en dos filas (sample/fades y A/D/R) con Reverse en el header. Los faders arrancan en 0 dB.
42. **Layout TRIGGER más grande y ordenado**: el detector pasó a ~68–70% del ancho y ganó altura al achicar el chrome superior, la tira TONE (38 px) y mover AUTO PHASE a un panel vertical adaptativo (98–180 px) al lado de los faders. El banco de faders y el dock quedan centrados en su posición original; el panel de fase vive en el margen derecho y se angosta según el espacio (98 px en 1076, 180 px desde 1280), con fallback arriba de los faders en <=1000. En el detector, el ON del GATE ocupa todo el ancho de su columna, el VU GR rojo vive junto a los knobs del gate, INPUT quedó centrado con su medidor y sus knobs, FILTER y DETECT quedaron centrados, y los knobs/labels crecieron a 30 px / 9 px. MIX abre en 100% y los faders en 0 dB.
43. **Gate C1 + detector post-gate**: se agregó **GATE THRESHOLD** como flecha arrastrable sobre el medidor INPUT (medidor pre-gate) y el gate pasó a ser post-VOLUME, con envolvente de 1 ms y ATTACK 0 realmente instantáneo. La detección usa la señal post-gate; la waveform central es post-gate (azul) con un fantasma rojo suave del input pre-gate. DETAIL ganó 1.5× de headroom: a 100% la línea queda por encima de todos los transientes y no dispara. El VU GR sigue junto a los knobs del GATE.

44. **Peak meters + dynamics**: INPUT y OUTPUT/MASTER pasaron de RMS a **pico real** (analyser float + hold corto). La barra de INPUT, los labels y la flecha de GATE THRESHOLD usan una única función `meterPct()` en dB, así que el threshold se lee contra el medidor. Se corrigió el detector: el capture ya no se reinicia en cada sample por encima del threshold y ahora guarda el **pico real** del transiente y su `peakTime`; antes la velocity caía al nivel del final del ataque. **SENSITIVITY** dejó de ser ganancia de detección y pasó a controlar el **rango dinámico** (0.35×…2.0×); el VELOCITY por slot mezcla esa respuesta con nivel fijo. INPUT VOLUME escala la velocity, así que bajar/subir el volumen cambia el nivel de los samples disparados. Además, el gate abre un bloque antes (lookahead de 1 ms) para que ATTACK 0 no recorte el transiente. Medido: SNARE con input 0 dB → velocity 100%, OUTPUT peak 54%; input −12 dB → velocity 25%, OUTPUT peak 10%; SENSITIVITY 0 vs 100 sobre velocity 0.5 → OUTPUT 43% vs 14%; Detail 100 → 0 hits; Detail 46 → 12 hits. VEL visible junto a DETECT.

45. **Caso real como INPUT**: se agregó `SN_TOP_1COMMIT_17-140.wav`, recorte 0:17–2:20 (123 s, mono 48 kHz) del archivo real del usuario, normalizado a −0.5 dBFS. El detector corre sobre el archivo completo y la waveform de 2 s lo sigue; `SNARE.cm.wav` quedó como one-shot del slot 01. Con Detail 14 el detector encuentra **139 hits** en 123 s; con Detail 46, **56**; con Detail 100, **0**. La caché de block peaks de 1 ms reutiliza el análisis entre cambios de Detail/attack/hold/release: el recompute pasó de ~100 ms a ~32–47 ms sobre 5.4 M samples. En playback, el primer hit del excerpt aparece a los 2.29 s y los slots disparan con velocity real (p. ej. 64%). El INPUT se decodifica en ~0.6 s.

46. **Auditoría integral (22/11)**: la detección se normaliza a 0 dBFS, así Detail 100 da 0 hits a cualquier Input Volume; la velocity conserva el nivel pre-clamp para que los samples sigan respondiendo. Se corrigió el rearm con Detail 0 (antes solo disparaba una vez porque `fast < thr*0.5` nunca se cumplía). Los marcadores usan la velocity real del hit. PLAYBACK GATE sigue la envolvente del gate del INPUT; LOOP se extendió a 2 s con envolvente abierta y fade-out; Reverse abre la envolvente completa y restaura la forward. Los offsets negativos se aplican dentro del lookahead. Al salir de TRIGGER se detiene el INPUT y los disparos. Los modales SETTINGS/VISUAL se cierran al cambiar de vista o clickear afuera; Esc desde VISUAL vuelve a HOME; Space sobre un botón enfocado no dispara el INPUT. La selección de slot ya no reconstruye el DOM (double-click confiable) y los botones M/S/Ø refrescan su estado. La escala VISUAL se limita a 90/100 para evitar que el layout fijo se solape con el dock. Se verificaron 900×1200, 1076×717, 1280×800 y 1920×1080 sin overflow ni solapamientos.

47. **Fix drift de la waveform**: los 24.600 buckets de picos se calculaban con un `step = floor(data.length / n)`, que dejaba 0,28 s sin cubrir y acumulaba un corrimiento de ~0,14 s a los 60 s del track. Los marcadores usaban el tiempo real y la waveform el tiempo del bucket, así que a medida que avanzaba el input se separaban. Ahora cada bucket usa límites fraccionales uniformes (`i * data.length / n`) y el eje coincide con el tiempo real. Verificado a 3, 10, 30, 60, 90 y 110 s: marcadores dentro de ±3 px del pico post-gate.

48. **Gate toggle sin click**: al prender/apagar GATE con el input seco audible, el cambio brusco de `gateGain` podía percibirse como un segundo golpe/click. `rescheduleGate` ahora usa `cancelAndHoldAtTime` + un glide de 8 ms al valor actual de la envolvente antes de retomar la curva. Verificado: una sola fuente de INPUT y una sola muestra por hit al togglear; sin NaN en la automatización.

49. **TONE sin PLAYBACK/LOOP**: se quitaron de la tira TONE los botones **ONE SHOT / GATE** y **LOOP**, junto con sus handlers y CSS. TONE queda con TONE/CUT/VELOCITY/GAIN; el scheduler mantiene el path one-shot sin loop. La página TRIGGER sigue sin overflow a 900×1200, 1076×717, 1280×800 y 1920×1080.

50. **Gate sin flams (referencia Slate open source)**: se revisó `epsilon-records/slate` y se adoptó su detector **peak con 8 ms de release** y la idea de histéresis; el gate del prototipo usa **4 dB** y un **release mínimo de 5 ms**. El release ya no empieza dentro del ataque: con **HOLD 30 ms** el cuerpo del golpe queda intacto (ganancia mínima medida 0.997 en los primeros 30 ms) y el release solo modela la cola. Probado con RELEASE 5/15/50/150/450: **0 flams** en todos los casos; antes, con HOLD 4 y RELEASE 0/5/15, aparecían 60/42/7 flams. Defaults nuevos: **HOLD 30 ms / RELEASE 150 ms**. ATTACK 0 sigue instantáneo.

---

## 16. Prompt de reinicio

Ver [`PROMPT_REINICIO.md`](PROMPT_REINICIO.md). Pegarlo en el chat nuevo y adjuntar/abrir este repositorio.

---

## 17. Nota final

El prototipo es la referencia visual y de interacción, **no** la implementación final. El motor C++ ya está auditado y testeado; el próximo salto grande es **desbloquear el entorno de build** y llevar el prototipo a iPlug2 + React sin romper el audio thread.
