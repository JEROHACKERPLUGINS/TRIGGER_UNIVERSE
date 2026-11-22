# Crear el plugin AU (macOS)

Guía corta para pasar del prototipo web a un **AUv2** que abra en GarageBand, Logic, Ableton o Reaper.

## Estado de partida

- Motor nativo listo en `engine/DrumReplacer` (detector, 8 slots, gate, MIDI, carga de WAV, estado).
- UI WebView de iPlug2 ya conectada por `SPVFUI` / `SPVFD` / mensajes JSON.
- El target AU ya está declarado en `engine/DrumReplacer/CMakeLists.txt` (`FORMATS AU VST3`).
- **AUv2 compilado y validado con `auval`** usando CMake + Command Line Tools (sin Xcode).
- El prototipo lindo sigue en `prototype/`; todavía no es la UI del plugin.

## 1. Entorno (una sola vez)

Para compilar y validar el AU **no hace falta Xcode completo**: alcanza con **CMake 3.14+** y las **Command Line Tools** de Apple (que ya vienen con macOS).

- CMake desde <https://cmake.org/download/> (instalador `.dmg`; no hace falta Homebrew). Si no queda en el `PATH`, el script lo busca en `/Applications/CMake.app/Contents/bin/cmake`.
- Xcode completo es **opcional**: sirve para depurar con Instruments y para firmar/notarizar la distribución, pero no es requisito para el AU local.

Para **AU no hacen falta Node.js ni el SDK de VST3**. El VST3 se agrega después.

## 2. Compilar e instalar el AU

```bash
scripts/build-au.sh Debug
```

El script detecta si hay Xcode:

- con Xcode usa el generador **Xcode** (`build-xcode/`);
- sin Xcode usa **Unix Makefiles** (`build-clt/`), que es el camino probado en esta máquina.

Compila `DrumReplacer-au`, copia el bundle a:

```
~/Library/Audio/Plug-Ins/Components/TriggerUniverse.component
```

y corre `auval`. Para una build final usá `scripts/build-au.sh Release`.

> Con Xcode, el script reinstala la copia final del `.component`: Xcode firma
> después del deploy automático de iPlug2, así que la copia que deja el deploy
> queda sin firma y `auval` falla al abrir en frío.

Equivalente manual sin Xcode:

```bash
cd engine/DrumReplacer
/Applications/CMake.app/Contents/bin/cmake -B build-clt -G "Unix Makefiles" -DCMAKE_BUILD_TYPE=Debug
/Applications/CMake.app/Contents/bin/cmake --build build-clt --target DrumReplacer-au -j "$(sysctl -n hw.ncpu)"
killall -9 AudioComponentRegistrar
auval -v aumf TRGU DANT
```

> `aumf` = music effect (el tipo del plist). Si cambiás el tipo a efecto puro, validá con `aufx`.
> `auval -a` lista todos los AU instalados.

## 3. Primera prueba en un host

1. Abrí GarageBand (gratis) o Reaper.
2. Insertá **DrumReplacer** en una pista de audio.
3. Verificá que pase audio y que la UI WebView abra.
4. Probá guardar el proyecto, cerrarlo y reabrirlo: el estado debe volver.

Si no aparece: cerrá el host, `killall -9 AudioComponentRegistrar`, reabrí. Si sigue sin aparecer, revisá que el `.component` sea `arm64` (o universal) y que `auval` pase.

### Probar la UI sin DAW

El target standalone usa la misma WebView que el AU:

```bash
scripts/run-app.sh
```

La UI del plugin se copia desde `prototype/` con:

```bash
scripts/sync-web.sh
```

Corré el sync después de tocar `prototype/index.html`, `style.css`, `app.js` o `native-ui.js`.

## 4. Identidad antes de distribuir

En `engine/DrumReplacer/config.h` y los plists:

- `PLUG_MFR`, `PLUG_MFR_ID` (4 caracteres únicos), `PLUG_UNIQUE_ID` (4 caracteres).
- `BUNDLE_DOMAIN`, `BUNDLE_NAME`, URL, email y copyright.
- Versión (`PLUG_VERSION_HEX`, `PLUG_VERSION_STR`).
- `PLUG_WIDTH` / `PLUG_HEIGHT` al tamaño real del layout nuevo.

No distribuyas con IDs genéricos: la build actual usa **Dante / TRGU**. Si los cambiás, actualizá `config.h` y `resources/TriggerUniverse-AU-Info.plist` juntos.

## 5. Llevar el layout del prototipo al plugin

El prototipo es HTML/CSS/JS, así que entra directo en el WebView de iPlug2:

1. Copiar `prototype/index.html`, `style.css`, `app.js` y `detector-worklet.js` a `engine/DrumReplacer/resources/web/` (o generar la copia desde un script para no divergir).
2. Separar `app.js` en dos capas:
   - **UI pura**: DOM, canvas, drag, teclas, paneles.
   - **Audio**: hoy usa Web Audio; en el plugin se reemplaza por el bridge.
3. Crear un adaptador `native-bridge.js`:
   - controles → `BPCFUI` / `SPVFUI` / `EPCFUI`;
   - cargar/limpiar sample → mensajes `kMsgTagLoadSample` / `kMsgTagClearSlot`;
   - medidores, hits, waveform y estado de slots ← `SendJSONFromDelegate`.
4. Definir **una sola tabla de parámetros** (C++ `EParams` + espejo JS). Cada control nuevo del layout necesita su parámetro nativo.
5. Medidores y waveform a ~20–30 Hz desde `OnIdle`, nunca por sample.
6. Diálogos de archivo/carpeta con `NSOpenPanel` (o el puente actual), no con APIs web (`showDirectoryPicker` no existe en WKWebView).
7. Para iterar la UI rápido: build **Debug** carga `Resources/web/index.html` desde el código fuente; **Release** lo carga del bundle.

## 6. Portar el DSP que falta

Ya está en C++: detector, retrigger, gate básico, 8 slots con voces, dry/wet, MIDI, carga de WAV.

Falta portar desde el prototipo:

- Gate auto-threshold.
- TONE/CUT con fase cero (FFT offline + swap atómico).
- Envelope multipunto y fades.
- Auto Phase (análisis por bandas, offset y polaridad).
- Phase 90° real (all-pass/Hilbert).
- Velocity/dinámica y curvas por slot.
- Reverse, offsets negativos, bounce.
- Biblioteca: scanner, SQLite, features, similitud y universo.

Regla: el audio thread no lee disco, no decodifica, no hace FFT ni espera a la UI. Todo se prepara afuera y se entrega con swap atómico.

## 7. Estado, presets y distribución

- Serializar **todos** los parámetros + rutas/bookmarks de samples + prefs de UI, con versión de estado y migración.
- Probar: reabrir proyecto, automatización, undo, offline bounce, 44.1/48/96 kHz y buffers 32–1024.
- Universal binary: `cmake -B build -G Xcode -DIPLUG2_UNIVERSAL=ON`.
- Para otros usuarios: Apple Developer Program, Developer ID, notarización y staple. Para uso propio alcanza con firma ad-hoc/Xcode.
- AUv3 (App Store/iOS) queda para después; AUv2 es el camino corto.

## Orden recomendado

1. CMake + Command Line Tools (Xcode opcional).
2. `scripts/build-au.sh Debug` y `auval` en verde.
3. Probar el AU actual en GarageBand/Reaper (aunque la UI sea la vieja).
4. Portar el layout nuevo y el bridge de parámetros.
5. Portar DSP feature por feature, comparando contra el prototipo.
6. Estado/presets y pruebas en hosts.
7. Firma, notarización y release.
