# XO — referencia funcional de la base de samples

**Fecha:** 20/11/2026
**Fuente:** `~/Library/Application Support/XO/1070072/Data/sample.db` (XO 1.8.10)
**Alcance:** análisis funcional y de estructura de datos. **No** se copian samples, código, assets ni diseño propietario. Se usa solo como referencia para el modelo de biblioteca de TRIGGER UNIVERSE.

---

## 1. Versión y metadatos

La tabla `meta` tiene 21 filas históricas. La última:

| Campo | Valor |
| --- | --- |
| `metaVersion` | 2 |
| `version` | 21 |
| `productId` | `XOBV0001` |
| `productVersion` | 1.8.10 |
| `date` | 2026-11-20 14:01:29 |

Las filas anteriores corresponden a versiones de desarrollo (`Cotton Juce 5`, 2018–2021). No aportan al producto actual.

---

## 2. Esquema

```sql
CREATE TABLE meta (
  metaVersion INTEGER,
  version INTEGER,
  productId TEXT,
  productVersion TEXT,
  date TEXT
);

CREATE TABLE samples (
  path TEXT PRIMARY KEY,
  path_normalized TEXT,
  filename TEXT,
  file_modified_time INTEGER,
  file_added_time INTEGER,
  file_size INTEGER,
  file_hash TEXT,
  sampleRate INTEGER,
  nChannels INTEGER,
  domain TEXT,
  product TEXT,
  offset INTEGER,
  length INTEGER,
  lengthMs REAL,
  centroid REAL,
  loudness REAL,
  peak REAL,
  druminess REAL,
  lateTransient REAL,
  coord_x REAL,
  coord_y REAL,
  coord_z REAL,
  coord_w REAL,
  category TEXT,
  star INTEGER,
  unsupported TEXT,
  format TEXT
);

CREATE TABLE productVersions (
  product TEXT PRIMARY KEY,
  version TEXT
);
```

Índices: `filename`, `path`, `path_normalized`, `domain`, `product`, `lengthMs`, `centroid`, `druminess`, `lateTransient`, `coord_x`, `coord_y`, `category`, `star`, `unsupported`, `format`, `file_added_time`.

**Lectura para TRIGGER UNIVERSE:** el esquema confirma las features que XO considera importantes para el Universe:

- duración (`lengthMs`),
- centroide (`centroid`),
- loudness / peak,
- druminess,
- late transient (cola/transiente tardío),
- coordenadas 4D (`coord_x`, `coord_y`, `coord_z`, `coord_w`),
- categoría, producto, formato, hash y metadata de archivo.

Es una buena lista de campos para `features` en `docs/fase1/modelo_datos.md`, aunque nuestro esquema puede normalizar y separar tags/favoritos.

---

## 3. Volumen y composición

| Dato | Valor |
| --- | --- |
| Samples | **8.746** |
| Formato | **wav** (100%) |
| Sample rate | **44.1 kHz** (100%) |
| Canales | **8.474 estéreo**, **272 mono** |
| `domain` | `sound` (100%) |
| `star` | 0 en todas las filas de esta base |
| Productos | `XOCP0001` 6.737 · `XOCP0003` 2.009 |

### Categorías

| Categoría | Samples |
| --- | ---: |
| Kick | 2.473 |
| Snare | 1.735 |
| Perc | 1.265 |
| HHC | 868 |
| FX | 573 |
| Clap | 562 |
| HHO | 527 |
| Tom | 380 |
| Cymbal | 363 |
| **Total** | **8.746** |

Son las mismas 9 categorías que usa el prototipo de TRIGGER UNIVERSE (`Kick`, `Snare`, `Perc`, `HHC`, `FX`, `Clap`, `HHO`, `Tom`, `Cymbal`).

---

## 4. Rangos de features

| Feature | Mínimo | Máximo | Promedio |
| --- | ---: | ---: | ---: |
| `lengthMs` | 11.4 ms | 27.997 s | 804.7 ms |
| `centroid` | 0.023 | 0.970 | 0.505 |
| `loudness` | −32.08 | +4.79 | — |
| `druminess` | 0.100 | 0.996 | — |
| `lateTransient` | −1.0 | 0.198 | — |

`centroid` está normalizado (0–1), no en Hz. `loudness` está en dB. `druminess` y `lateTransient` parecen features normalizadas por el analizador de XO. Solo **10 filas** tienen `lateTransient = −1.0`, probablemente un valor sentinel para “sin transiente tardío”.

### Coordenadas 4D

| Eje | Mínimo | Máximo |
| --- | ---: | ---: |
| `coord_x` | 0.0017 | 0.9970 |
| `coord_y` | −0.0003 | 0.9613 |
| `coord_z` | −0.1597 | 0.3331 |
| `coord_w` | −0.1305 | 0.3787 |

`x` e `y` están prácticamente en 0–1; `z` y `w` tienen rangos más chicos y centrados. La proyección visual de XO usa estas coordenadas, no solo duración/centroide.

---

## 5. Promedios por categoría

| Categoría | Duración media | Centroide medio | Druminess media | Late transient medio |
| --- | ---: | ---: | ---: | ---: |
| Clap | 611.8 ms | 0.664 | 0.937 | −0.001 |
| Cymbal | 4065.5 ms | 0.783 | 0.752 | 0.001 |
| FX | 1262.3 ms | 0.567 | 0.719 | −0.005 |
| HHC | 305.3 ms | 0.758 | 0.968 | 0.000 |
| HHO | 724.3 ms | 0.806 | 0.893 | 0.001 |
| Kick | 603.8 ms | 0.187 | 0.946 | 0.001 |
| Perc | 776.1 ms | 0.597 | 0.787 | 0.001 |
| Snare | 543.0 ms | 0.594 | 0.904 | 0.000 |
| Tom | 1136.2 ms | 0.272 | 0.871 | 0.000 |

**Lectura:** el centroide separa bien Kick/Tom (oscuros) de Hats/Cymbals (brillantes). La duración separa HHC de Cymbal. Druminess es alto en casi todo; no alcanza sola para distinguir categorías.

---

## 6. Implicancias para TRIGGER UNIVERSE

1. **No copiar la base ni los samples.** Es solo referencia estructural.
2. Nuestro modelo de Fase 1 ya cubre duración, centroide, RMS/peak, ataque/decay, canales y sample rate. Agregar **loudness**, **druminess** y **lateTransient** si se quiere similitud cercana a XO.
3. La proyección 2D del prototipo (duración + brightness) es una simplificación. El Universe final debería usar features tímbricas + una proyección (UMAP/PCA o layout propio) y similitud en el espacio de features.
4. Las 9 categorías y el árbol de carpetas del prototipo son consistentes con XO.
5. `coord_z`/`coord_w` confirman que XO no usa solo 2 dimensiones; el “4D” es real en los datos, aunque la UI lo proyecte.
6. El esquema usa `path` como PK; para nosotros conviene `id` + `path UNIQUE` para tolerar relocalización y roots múltiples.
7. `star` está vacío en esta base; los favoritos probablemente viven en otro estado/preset.

---

## 7. Consultas útiles (read-only)

```bash
DB="$HOME/Library/Application Support/XO/1070072/Data/sample.db"

sqlite3 -header -column "$DB" \
  "SELECT category, COUNT(*) n FROM samples GROUP BY category ORDER BY n DESC;"

sqlite3 -header -column "$DB" \
  "SELECT filename, category, lengthMs, centroid, druminess, lateTransient,
          coord_x, coord_y, coord_z, coord_w
   FROM samples LIMIT 10;"

sqlite3 -header -column "$DB" \
  "SELECT MIN(lengthMs), MAX(lengthMs), AVG(lengthMs),
          MIN(centroid), MAX(centroid), AVG(centroid)
   FROM samples;"
```

No modificar la base de XO.
