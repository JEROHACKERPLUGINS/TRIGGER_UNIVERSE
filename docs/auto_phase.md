# AUTO PHASE entre los 8 faders — viabilidad y diseño

Fecha: 20/11/2026. Documento técnico para la función de alineación automática de fase por slot.

## 1. ¿Se puede?

**Sí.** Es una operación de análisis offline + aplicación de dos parámetros por slot:

1. **Polaridad** (normal / invertida, equivalente a 180°).
2. **Offset temporal** (adelanto/retardo en muestras o ms).

No requiere tocar el audio thread para analizar. El resultado se guarda por slot y se aplica con un crossfade corto para evitar clicks.

## 2. Referencia

El auto-phase puede comparar cada capa contra:

- **INPUT**: el transitorio de entrada del trigger (referencia natural del drum replacer).
- **SLOT 1** (o cualquier slot): una capa tomada como referencia para alinear las demás entre sí.

La UI del prototipo ya expone `REF: INPUT / SLOT 1` en el popover del fader y un botón `AUTO PHASE ALL`.

## 3. Algoritmo propuesto

Para cada slot:

1. Tomar una ventana corta del sample (primeros 80–200 ms) y de la referencia.
2. Sumar a mono y decimar (por ejemplo a 12 kHz) para abaratar el cálculo.
3. Calcular la **correlación cruzada** (preferentemente GCC-PHAT para robustez en percusión).
4. Buscar el pico dentro de un rango de lags permitido.
5. **Polaridad** = signo del pico de correlación.
6. **Lag** = posición del pico, refinada con interpolación parabólica para precisión sub-muestra.
7. Confianza = altura del pico normalizada. Si es baja, no aplicar y avisar.
8. Guardar `offset` y `polarity` por slot.

Complejidad: una ventana de 200 ms a 12 kHz son ~2400 muestras; la correlación es del orden de millones de operaciones por slot, hecha en background/UI thread. Es barato.

## 4. Límite importante: offsets negativos

El motor actual reporta **5 ms de lookahead** (`TransientDetector::LatencySamples()`), y el seco se retrasa igual. Consecuencias:

- **Retardos positivos**: seguros; se implementan con una línea de delay por slot.
- **Adelantos negativos**: solo viables dentro del lookahead disponible (hasta ~5 ms) o si se agrega un pre-roll/delay global a la referencia.
- Si el lag calculado excede el rango permitido, se debe:
  - clampear al límite y avisar en la UI, o
  - alinear todas las capas al **último** transitorio (solo delays positivos), o
  - agregar un delay global de referencia.

**Regla de producto:** no prometer adelanto negativo que el motor no pueda conservar. Mostrar el offset aplicado y el límite.

## 5. Aplicación sin clicks

- El análisis y la preparación ocurren fuera del audio thread.
- El offset/polaridad se aplican en el próximo bloque o entre eventos, con un **crossfade de 2–5 ms**.
- No se modifica el archivo original (no destructivo).
- El cambio se guarda en el estado del plugin y se expone a automatización.

## 6. Comportamiento en la UI

- **Al cargar un sample en un fader**, el auto-phase se ejecuta automáticamente contra la referencia configurada (INPUT por defecto).
- El fader muestra un badge con el resultado: `Ø +3.4ms`, `+1.2ms`, `—`.
- Al tocar el fader se abre un popover centrado con:
  - Level, Pan, Tune, M/S/Ø.
  - `AUTO PHASE` con referencia `INPUT` / `SLOT 1`.
  - Resultado: confianza, polaridad y offset.
  - Offset manual y phase shift 0°/90°/260°.
- `AUTO PHASE ALL` re-analiza las 8 capas.
- La fase ya **no** vive en el editor del sample; vive en el slot/fader.

## 7. Casos límite

- Samples sin transitorio claro o con silencio inicial: confianza baja → no aplicar.
- Samples con DC offset: filtrar antes de correlacionar.
- Samples estéreo: analizar el mono sum o el canal con más energía.
- Samples muy cortos (< 20 ms): limitar la ventana.
- Samples con loop: analizar solo el primer ataque.
- Capas con polaridad ya invertida manualmente: permitir override y marcar como manual.

## 8. Estado en el prototipo (22/11/2026)

El prototipo **analiza el audio real** (`computePhaseAlignment` en `prototype/app.js`) y el criterio cambió respecto de §3: en vez de correlacionar cada capa contra la referencia por separado, se maximiza la **energía de la suma real** (REF + todas las capas), así las capas suman bien con el input **y entre ellas**.

1. Bandas de fase cero: LOW 40–250 Hz, LOW-MID 250 Hz–1,5 kHz, HIGH > 1,5 kHz.
2. **Dónde**: se ubica el golpe en el tiempo con el contorno del ataque (|LOW-MID + HIGH| suavizado 0,5 ms), independiente de la polaridad (−5…+10 ms). Sin esto un atraso puro se lee como fase (2 ms ≈ 144° a 200 Hz).
3. **Fase primero**: en ese punto se mide la diferencia de fase en LOW contra el objetivo; **≥ 90° → Ø**.
4. **Offset después**: con la polaridad fija, ajuste fino ±1,5 ms: candidatos que no pierden más de 0,5 dB de LOW ni 1 dB de LOW-MID; entre ellos, el que más HIGH deja (ataque alineado).
5. Refinamiento de cada capa contra REF + las demás (fase en su posición actual, offset ±1,5 ms alrededor del anclaje) hasta converger.
6. Reporte: ganancia de LOW y cuerpo contra no hacer nada, pares que se cancelan (correlación LOW+MID < −0,15) y capas en el límite de −5 ms.

REF = INPUT usa el promedio de los golpes más fuertes alineados en el onset del detector: la energía sumada sobre K golpes es igual (salvo constantes) a la energía contra su promedio. GCC-PHAT sigue siendo útil para ubicar el transiente en material ruidoso; el criterio de suma por bandas es el que decide. Global: ON/OFF, una REF (INPUT o un slot) y un MODO (OFFSET / Ø / BOTH) para todos; el resultado se guarda aparte de los ajustes manuales.

Validación: copias corridas 0/2/3,5/6 ms → +0/+2,0/+3,5/+6,0 ms sin invertir; copias invertidas corridas 0/2/1/0,5 ms → Ø +0/+2,0/+1,0/+0,5 ms (Δφ 180°); 4 capas contra SN TOP 1 en 244 ms; verificación con filtros distintos: LOW +1,8 dB, cuerpo +2,5 dB, agudos +0,1 dB.
