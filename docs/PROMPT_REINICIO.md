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
- Tests C++ con `SNARE.cm.wav`: detector y `SlotEngine` verificados.
- **Prototipo UI navegable y con audio real funcionando** en `prototype/`.
- **Build del plugin bloqueado**: faltan Xcode completo, CMake, Node.js y SDK de VST3.
- **Commit inicial creado en `main`**, árbol limpio.

El prototipo se prueba así:

```bash
cd /Users/dante/Desktop/TRIGGER_UNIVERSE/prototype
python3 -m http.server 8765 --bind 127.0.0.1
```

Abrir <http://127.0.0.1:8765/>. Para escuchar: abrí **TRIGGER ▲** y clickeá **▶ INPUT** para reproducir `SNARE.cm.wav` y disparar las 8 capas.

---

## Decisiones cerradas — no reabrir sin motivo

- **Framework:** iPlug2. **No** migrar a JUCE.
- **Formatos:** AU + VST3. **AAX fuera.**
- **UI final:** React + TypeScript sobre WebView de iPlug2.
- **Envelope:** ADSR real (agregar Decay) + fade in/out + start/end/trim. **Sin time-stretch.**
- **Fase:** `Ø = 180°` (polaridad). Phase shift separado: 0° / 90° / 180° / 260°.
- **Auto-phase:** corre al cargar un sample. Por defecto solo polaridad; offset en 0 salvo **TIMING** activo.
- **Faders:** solo números `01`–`08`, sin nombres de rol.
- **Editor:** pertenece al sample del fader seleccionado (default TRIGGER 01). Se abre al clickear el fader.
- **Tabs del editor:** SAMPLE → ENVELOPE → TONE → SLOT.
- **Tab SLOT:** solo Auto Phase y sus controles. Sin Level/Pan/Tune/Mute/Solo/Pol.
- **TRIGGER:** pestaña chica abajo; abre al arrastrar un sample o al clickearla; queda abierto; cierra al clickear el Universe, al seleccionar un sample o desde la cabecera.
- **Universe:** full-bleed, nube de puntos 3D abstracta, sin ejes. Search arriba, similitud abajo.
- **FILE SEARCH:** árbol tipo Finder con root en la carpeta elegida por el usuario; subcarpetas reales; samples reales primero.
- **OUTPUT** arriba a la derecha. Settings funcional. **AUTO PHASE ALL** vive en Settings.
- **Fuera de alcance:** step sequencer, patrones, groove, swing, BPM sync, preset browser.
- **XO:** solo referencia funcional/UX. **No copiar código, assets ni diseño propietario.**

---

## Qué está implementado en el prototipo

- Universe full-bleed con 1000 samples sintéticos + `SNARE.cm.wav` real.
- Zoom con rueda anclado al cursor; pan con click derecho o Ctrl+click; click izquierdo en vacío solo cierra paneles; hover/snap dentro de un aura de 20 px con tooltip.
- FILE SEARCH con árbol, búsqueda, preview, audition al click en cada fila y ALT + drag a faders. Al entrar a FILE SEARCH se cierran TRIGGER, INPUT DETECTOR y el editor con animación.
- Editor flotante con tabs SAMPLE / ENVELOPE / TONE / SLOT.
- Waveform real, start/end, fades, reverse, ADSR, tone/cut, tune, pan, loop.
- TRIGGER drawer con detector, 8 faders numerados, meters reales, M/S/Ø, badges de fase.
- Settings con AUTO PHASE ALL, FLIP ALL POLARITY, LIBRARY FOLDERS, AUDIO/MIDI.
- SIMILARITY funcional: 33 vecinos por features, flechas y teclas ← →, seguimiento suave del Universe y línea animada.
- Favoritos persistentes (`localStorage`) con corazón en la barra y en FILE SEARCH, más el nodo FAVORITES.
- OUTPUT knob real con mini VU vertical de salida. Export eliminado.
- Web Audio: 8 capas, snare real como INPUT, primer golpe como sample del slot 01, polaridad 180° real.

Limitaciones del prototipo:

- Auto-phase **simulado** (la UX es real; el análisis no).
- Similitud basada en features sintéticas, no en análisis tímbrico real.
- 90° / 260° **no** se aplican al audio; solo 180°.
- Offsets negativos clampeados a 0 en Web Audio.
- Velocity no aplicada; Normalize/folder picker son demos.

---

## Próximo paso recomendado

### Prioridad 1 — Desbloquear el build

1. Instalar **Xcode completo**.
2. `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer`
3. Instalar **CMake** y **Node.js**.
4. Bajar SDK VST3 con `engine/_iPlug2/Scripts/download-iplug-sdks.sh` (sin AAX).
5. Recuperar/crear `scripts/build-mac.sh`.
6. Hacer el **build baseline** del VST3 actual y verificarlo en Ableton.

### Prioridad 2 — Si el build sigue bloqueado

Continuar en el prototipo y en los headers DSP:

- Implementar **GCC-PHAT** real en C++ (`docs/auto_phase.md`) y tests con el snare.
- Implementar phase shift 90°/260° con all-pass/Hilbert.
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
