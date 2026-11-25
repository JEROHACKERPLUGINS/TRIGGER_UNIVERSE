# ml/ — clasificador pre-entrenado de tipo de sample

Entrena el modelo que usa el plugin para saber si un sample es Kick, Snare, Clap, HHC, HHO, Cymbal, Tom, Perc o FX, **antes** de que el usuario tenga una librería propia. Reemplaza a las reglas escritas a mano de `SampleAnalysis.h` cuando está seguro.

Orden de decisión en el plugin (de mayor a menor prioridad):

1. el nombre del archivo lo dice (`DrumClassFromName`)
2. el modelo de la librería del usuario está seguro (`SampleClassifier.h`)
3. **el modelo pre-entrenado** (`DSP/PretrainedClassifier.h`, pesos en `DSP/PretrainedWeights.h`), si su probabilidad es ≥ `kSure`
4. las reglas (`ClassifyDrum`)

## Pipeline

```
librería WAV ──► tu_features (C++, el mismo AnalyzeSample del plugin) ──► feat_*.csv
     │                                                                      │
     └─► names.py: palabras de nombres y carpetas → grupos → etiqueta ──► labels.tsv
                                                                            │
                                              train.py ◄────────────────────┘
                                                 │
                     DSP/PretrainedWeights.h ◄───┴──► train_report.md, predictions.tsv
```

```bash
# 1. lista de archivos (ruta relativa a ROOT)
cd ROOT && find . -type f -iname '*.wav' -printf '%s\t%P\n' > wavs.tsv

# 2. features: 4 procesos en paralelo; si se corta, se vuelve a correr y sigue donde quedó
g++ -std=c++17 -O2 -I../engine/DrumReplacer tu_features.cpp -o tu_features
for s in 0 1 2 3; do ./tu_features ROOT wavs.tsv feat_$s.csv $s 4 & done; wait

# 3. etiquetas desde los nombres (+ reporte de grupos de palabras)
python3 names.py wavs.tsv labels.tsv names_report.md

# 4. entrenar, validar por pack y exportar a C++
python3 train.py labels.tsv feat_*.csv --out ../engine/DrumReplacer/DSP/PretrainedWeights.h

# 5. verificar que el C++ da lo mismo que sklearn
cd ../engine/DrumReplacer/tests
clang++ -std=c++17 -O2 -I.. pretrained_test.cpp -o /tmp/pt && /tmp/pt feat_all.csv predictions.tsv
```

## Etiquetas desde los nombres (`names.py`)

Cada nombre de archivo y de carpeta se parte en palabras (camelCase, `Kick01`, separadores). Las palabras que significan lo mismo se agrupan con un tipo:

- **semillas** por grupo, en inglés, en español y abreviadas: `kick, kik, bd, kd, bombo, bassdrum…`, `snare, sd, sn, snr, rim, redoblante…`, `hh, hihat, charles…`
- **plurales:** `kicks`, `snarez`, `rides`
- **pegadas:** solo al principio o al final, y solo palabras de batería largas: `lofikick`, `hihats`, `bassdrums`. Las cortas o comunes quedan afuera: `rack` agarraría "crack", `hats` "whats", `wood` "hollywood".
- **mal escritas:** 5 letras o más, misma inicial, parecido ≥ 0,84: `cymbl`, `darabuka`.
- **pares:** `bass drum` → bassdrum, `hi hat` → hihat, `T1`/`T2` → tom, `FT` → floor tom.

Reglas especiales:

- **hi-hat:** abierto o cerrado según `open/op/ohh` o `closed/chh/pedal`.
- **`OH`:** solo vale como *open hat* al lado de una palabra de hat. En los kits multimic es el *overhead*, y en ese caso decide la carpeta (`KD MID/OH ISO` → Kick).
- **contradicciones:** `snare clap` → Clap; un tambor gana sobre FX o Perc; dos tambores distintos → sin etiqueta.

Si el archivo no dice nada, decide la carpeta más cercana que nombre un solo tipo. Se excluyen del entrenamiento los loops, fills, grooves, instrumentos tonales y voces, también cuando lo que lo dice es una carpeta (`loops/hats/…`). El reporte lista los grupos que se formaron y las palabras frecuentes que quedaron sin agrupar, para ir sumando semillas.

## Modelo (`train.py`)

- Features: `RawFeatureRow` (`SampleMap.h`), 58 valores por archivo: cepstro de 8 coeficientes de cada uno de los 6 segmentos del fingerprint, log de la duración y los 9 descriptores. Los calcula el mismo código del plugin, así que entrenamiento y plugin ven los mismos números.
- **Gradient-boosted trees** (sklearn `HistGradientBoostingClassifier`, 300 rondas, 31 hojas, clases balanceadas). Se probaron MLP de 64/32, 128/64 y 256/128: quedaron unos 5 puntos abajo.
- **Validación agrupada por pack** (`GroupKFold`): un pack nunca está a la vez en train y en test. Los samples de un mismo pack suenan parecido y comparten nombres, así que mezclarlos inflaría el número.
- `kSure`: umbral que maximiza el acierto de "modelo si está seguro, si no reglas" en los packs de validación.
- El C++ recorre los árboles (`PretrainedPredictRow`). `pretrained_test` exige una coincidencia de ≥ 99,9 % con sklearn.
- Si cambia `kAnalysisVersion`, el modelo se apaga solo (`kTrainedAnalysisVersion`) hasta reentrenar.

## Resultado actual (librería KONTAKT2/SAMPLES, 25-11-2026)

113.702 WAV. Se analizan 113.051. Quedan 54.856 con etiqueta por nombre, en 312 packs. Se excluyen 52.444 (loops, instrumentos, voces) y 6.182 quedan sin etiqueta.

| Acierto en packs no vistos | |
|---|---:|
| Reglas (`ClassifyDrum`) | 52,9 % |
| **Modelo pre-entrenado** | **75,0 %** |

| Tipo | reglas | modelo |
|---|---:|---:|
| Kick | 69 % | 86 % |
| Snare | 82 % | 81 % |
| Clap | 39 % | 72 % |
| HHC | 45 % | 68 % |
| HHO | 15 % | 71 % |
| Cymbal | 14 % | 74 % |
| Tom | 48 % | 68 % |
| Perc | 12 % | 57 % |
| FX | 68 % | 70 % |

Parte del error es ruido de las etiquetas: nombres o carpetas que no dicen la verdad. Por ejemplo, en "Open Hats" hay archivos que son percs o crashes. `train_report.md` lista los desacuerdos fuertes entre el nombre y el audio.

Los archivos intermedios (`wavs.tsv`, `labels.tsv`, `feat_*.csv`, `predictions.tsv`, reportes) tienen rutas de la librería y **no van al repo** (`.gitignore`).
