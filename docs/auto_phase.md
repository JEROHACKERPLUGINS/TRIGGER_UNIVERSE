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

## 8. Estado en el prototipo

El prototipo actual **simula** el análisis (lag/polaridad/confianza determinísticos por sample) para validar la UX. La implementación real usará GCC-PHAT y una línea de delay por slot en el `SlotEngine`, con el límite de lookahead documentado.
