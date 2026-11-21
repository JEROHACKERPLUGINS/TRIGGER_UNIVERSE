# Pruebas de audio C++ (SNARE.cm.wav)

Requieren `clang++` (CommandLineTools) y el WAV del usuario en `~/Desktop/SNARE.cm.wav`.

## Detector

```bash
cd engine/DrumReplacer
clang++ -std=c++17 -I. ../../docs/pruebas_audio/snare_detector_test.cpp -o /tmp/snare_det_test
/tmp/snare_det_test
```

Resultado esperado (resumen): 23 hits con defaults (Sens 45, Retrig 50, Detail 50), 17 con Retrig 250, 12 con Sens 20. Ver `docs/audio_tests.md`.

## SlotEngine

```bash
cd engine/DrumReplacer
clang++ -std=c++17 -I. ../../docs/pruebas_audio/snare_slot_test.cpp -o /tmp/snare_slot_test
/tmp/snare_slot_test
```

Resultado esperado: playback exacto `err 0.000e+00`, offset/velocity `err 0.000e+00`, tune +12 `err 0.000e+00`, release fade a 0 en ~10 ms, voice stealing sin crash.
