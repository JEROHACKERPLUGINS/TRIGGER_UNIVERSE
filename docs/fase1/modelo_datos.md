# Fase 1 — Modelo de datos e indexación

Propuesta para la biblioteca de samples. No toca el audio thread ni el motor actual.

## 1. Dependencia SQLite

Usar **SQLite3 del sistema** (`-lsqlite3`, disponible en el SDK de macOS). No hace falta vendorizar ni agregar otra dependencia externa. La operación será exclusivamente en background/UI thread.

## 2. Esquema propuesto

```sql
CREATE TABLE roots (
  id INTEGER PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  display_name TEXT,
  enabled INTEGER DEFAULT 1,
  last_scan INTEGER,
  last_error TEXT
);

CREATE TABLE banks (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT,
  enabled INTEGER DEFAULT 1
);

CREATE TABLE bank_roots (
  bank_id INTEGER NOT NULL REFERENCES banks(id) ON DELETE CASCADE,
  root_id INTEGER NOT NULL REFERENCES roots(id) ON DELETE CASCADE,
  PRIMARY KEY (bank_id, root_id)
);

CREATE TABLE folders (
  id INTEGER PRIMARY KEY,
  root_id INTEGER NOT NULL REFERENCES roots(id) ON DELETE CASCADE,
  parent_id INTEGER REFERENCES folders(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  name TEXT NOT NULL,
  mtime INTEGER
);

CREATE TABLE samples (
  id INTEGER PRIMARY KEY,
  root_id INTEGER NOT NULL REFERENCES roots(id) ON DELETE CASCADE,
  folder_id INTEGER REFERENCES folders(id) ON DELETE SET NULL,
  path TEXT NOT NULL UNIQUE,
  rel_path TEXT NOT NULL,
  filename TEXT NOT NULL,
  size INTEGER NOT NULL,
  mtime INTEGER NOT NULL,
  content_hash TEXT,
  missing INTEGER DEFAULT 0,
  favorite INTEGER DEFAULT 0,
  category TEXT DEFAULT 'other',
  created_at INTEGER,
  updated_at INTEGER
);

CREATE TABLE features (
  sample_id INTEGER PRIMARY KEY REFERENCES samples(id) ON DELETE CASCADE,
  duration_s REAL,
  useful_duration_s REAL,
  pitch_hz REAL,
  pitch_confidence REAL,
  centroid_hz REAL,
  rolloff_hz REAL,
  flatness REAL,
  rms REAL,
  peak REAL,
  attack_ms REAL,
  decay_ms REAL,
  channels INTEGER,
  sample_rate INTEGER,
  bit_depth INTEGER,
  waveform_cache_path TEXT,
  analyzed_at INTEGER
);

CREATE TABLE tags (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE sample_tags (
  sample_id INTEGER NOT NULL REFERENCES samples(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (sample_id, tag_id)
);

CREATE TABLE history (
  id INTEGER PRIMARY KEY,
  sample_id INTEGER NOT NULL REFERENCES samples(id) ON DELETE CASCADE,
  played_at INTEGER NOT NULL
);

CREATE TABLE presets (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  payload BLOB NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE INDEX idx_samples_folder ON samples(folder_id);
CREATE INDEX idx_samples_mtime ON samples(mtime);
CREATE INDEX idx_samples_filename ON samples(filename COLLATE NOCASE);
CREATE INDEX idx_features_duration ON features(useful_duration_s);
CREATE INDEX idx_features_pitch ON features(pitch_hz);
CREATE INDEX idx_features_centroid ON features(centroid_hz);
```

## 3. Decisiones de diseño

- **Bancos virtuales:** `banks` + `bank_roots` apuntan a carpetas reales. No se copian ni mueven archivos.
- **Escaneo incremental:** comparar `(path, size, mtime)`; el hash solo se calcula cuando cambia el archivo.
- **Missing files:** `missing=1` en vez de borrar; se conserva el path para relocalizar.
- **Análisis:** una sola pasada por archivo; cache de features y waveform en `~/Library/Application Support/TRIGGER_UNIVERSE/cache/`.
- **Pitch:** YIN/autocorrelación para tonales; si la confianza es baja, usar centroide espectral y marcar `pitch_hz` como nulo.
- **Streaming a la UI:** mandar lotes con `OnIdle`, nunca un evento por archivo.
- **Similitud (Fase 2):** normalizar features y usar distancia ponderada; no depender de la posición X/Y.

## 4. Módulos C++ nuevos (bajo `engine/DrumReplacer/`)

| Módulo | Responsabilidad |
| --- | --- |
| `Library/Model.h` | Structs: `SampleRecord`, `Features`, `Bank`, `Root` |
| `Library/Database.h/.cpp` | Esquema, consultas, transacciones |
| `Library/Analyzer.h/.cpp` | Decodificación offline + features + caché de waveform |
| `Library/Scanner.h/.cpp` | Recorrido multi-root, detección de cambios, progreso |
| `Library/IndexService.h/.cpp` | Fachada usada por el plugin; colas y callbacks al bridge |

Ninguno de estos módulos es incluido por `ProcessBlock`.

## 5. UI React

- Ubicación: `engine/DrumReplacer/resources/web/` (reemplaza el JS plano actual).
- El bridge iPlug2 (`script.js`) se conserva; React solo consume `params`, `init`, `slot`, `hit` y mensajes nuevos (`library:progress`, `library:ready`, `universe:points`).
- La vista previa en navegador seguirá funcionando con un servidor local (`file://` no carga módulos).
