# TRIGGER_UNIVERSE

Plugin de audio (AU + VST3, iPlug2) que combina un motor de drum triggering, un universo visual de samples y un mixer de ocho capas.

## Estado actual — 20/11/2026

- **Fase 0 completada y aprobada.** Motor auditado, arquitectura definida y plan de integración acordado.
- **Motor existente reutilizado** en `engine/` (`engine/DrumReplacer` + `engine/_iPlug2`). No se reescribió.
- **Prototipo UI navegable** en `prototype/`, con audio real: `SNARE.cm.wav` carga en el slot 01 y dispara las 8 capas desde el INPUT.
- **Diseño de datos de Fase 1** iniciado en `docs/fase1/modelo_datos.md`.
- **Build del plugin bloqueado por entorno**: faltan Xcode completo, CMake, Node.js y SDK de VST3. Los headers DSP sí se compilan y testean con CommandLineTools.

> Para retomar el trabajo desde cero, leer [`docs/TRASPASO.md`](docs/TRASPASO.md) y usar [`docs/PROMPT_REINICIO.md`](docs/PROMPT_REINICIO.md).

## Probar el prototipo

```bash
cd prototype
python3 -m http.server 8765 --bind 127.0.0.1
```

Abrir <http://127.0.0.1:8765/>. Para escuchar: abrí **TRIGGER ▲** (abajo), click en **▶ INPUT** dentro del drawer para reproducir el snare real y disparar las 8 capas; o hacé click en un sample del Universo o de **FILE SEARCH** para escucharlo al instante. El audio arranca con el primer click (política de autoplay del browser).

Controles principales:

- Click en un fader **01–08** para abrir el editor del sample cargado en ese slot.
- **TRIGGER** (pestaña inferior) abre el drawer con el detector y los faders.
- Mantené el click y movete por el Universe: se escucha un preview inmediato de cada sample (snap dentro de un aura de ~20 px) y queda una **estela de colores** entre los puntos visitados. Al soltar, la estela se desvanece.
- Click en un sample: lo selecciona y permite hacer hover por el mapa. **ALT + arrastrar** desde el Universe o FILE SEARCH a un fader para asignarlo; si se suelta fuera de un fader, se muestra el toast de export a Finder (demo).
- Rueda del mouse: zoom anclado al cursor. Click derecho + arrastrar o **Ctrl + click izquierdo + arrastrar**: pan. Click izquierdo en vacío: solo cierra paneles, sin mover la cámara.
- **FILE SEARCH** alterna entre el universo y el árbol de carpetas (ícono de carpeta a la derecha del buscador). Al entrar, TRIGGER, INPUT DETECTOR y el editor se cierran con una salida animada.
- Click en una fila de FILE SEARCH: selecciona el sample y **reproduce su audio al instante**; ya no hay botón Audition en el pie.
- **SIMILARITY** (abajo): al seleccionar un sample se arma una lista de 33 parecidos. Las flechas `◂ ▸` o las teclas `← →` recorren esa lista; el Universe hace un paneo suave solo si el sample queda cerca del borde y dibuja una línea animada entre ambos.
- **♥** en la barra de similitud o en cada fila de FILE SEARCH: agrega/quita favoritos persistentes. **FAVORITES** aparece arriba del árbol de carpetas.
- **Settings** contiene AUTO PHASE ALL, FLIP ALL POLARITY, LIBRARY FOLDERS y AUDIO/MIDI.

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

- El Universo sirve para **descubrir, editar y asignar** samples; no es un beatmaker.
- Fuera de alcance: step sequencer, patrones A/B, groove, swing, nudge, BPM sync y preset browser.
- El motor de Trigger existente se **audita y reutiliza**; no se reemplaza sin una razón técnica documentada.
- ADSR (amplitud) y Phase/Align (polaridad + alineación temporal) son sistemas **independientes**, aunque compartan panel visual.
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
| 2 | Universe (proyección, filtros, similitud) | 🟡 prototipo visual |
| 3 | Sample Editor + Phase / Align | 🟡 prototipo UI y diseño DSP |
| 4 | Ocho slots / mixer / trigger | 🟡 motor testeado, prototipo con audio |
| 5 | Pulido, presets, automatización, release | ⬜ pendiente |

## Stack

- **Plugin:** C++ + iPlug2 (AU + VST3; AAX fuera).
- **UI final:** React + TypeScript sobre el bridge WebView de iPlug2.
- **Prototipo:** HTML/CSS/JS sin build step (no hay Node instalado todavía).
- **Audio:** motor C++ existente (`TransientDetector`, `SlotEngine`) reutilizado.
- **Indexado:** escaneo y análisis en background; sin disco, decodificación, FFT ni allocations en el audio callback.
