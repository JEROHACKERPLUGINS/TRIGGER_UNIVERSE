# Auditoría Fase 0 — Entorno y materiales

Fecha: 20/11/2026.

## Materiales recibidos

| Material | Ubicación | Estado |
| --- | --- | --- |
| Brief v0.2 | `docs/Brief_Tecnico_Trigger_Universe_para_Mica_v0.2.docx` | Leído |
| Trigger existente (ZIP) | `~/Desktop/DrumTrig-main` | Descomprimido |
| Specs del original (RE) | `~/Desktop/DrumTrig-main/plug.md` | Leído (parcial) |
| Plan de fases previo | `~/Desktop/DrumTrig-main/fases.md` | Leído |
| Notas de implementación | `~/Desktop/DrumTrig-main/DrumReplacer/CLAUDE.md` | Leído |
| Referencia visual XO | `~/Desktop/XO.vst`, `/Applications/XLN Audio/XO.app` | Analizado (ver `docs/referencias/`) |

## Entorno de esta Mac

| Herramienta | Estado | Impacto |
| --- | --- | --- |
| Xcode completo | **No instalado** (solo CommandLineTools) | Bloquea compilar AU / AUv3 y abrir `.xcworkspace` |
| `xcodebuild` | Apunta a CommandLineTools | Igual que arriba |
| `cmake` | No instalado | Bloquea el build por CMake y el validator VST3 |
| `node` / `npm` | No instalados | Bloquea toolchain JS para el UI WebView |
| Python | 3.9.6 | Disponible para scripts |
| Ableton Live | 11.3.35 Suite | Host VST2; el proyecto actual genera **VST3** |
| .vst3 del Trigger | No instalado | No se pudo verificar en host todavía |

## Observaciones iniciales de documentación (a confirmar en código)

- `CLAUDE.md` afirma: iPlug2 + WebView, **8 slots en paralelo**, solo **VST3 macOS**, fases 0–5 completadas.
- `fases.md` describe un plan **anterior** con 16 slots, 20 globales y 228 parámetros → contradicción con `CLAUDE.md` (8 slots, 28 globales, 132 parámetros).
- `plug.md` es la ingeniería inversa del original: parámetros, pipeline, presets `.drp`, formato `.dri` (inferido) y tiers Basic/Pro.

Estos datos se verifican contra el código en el informe principal.
