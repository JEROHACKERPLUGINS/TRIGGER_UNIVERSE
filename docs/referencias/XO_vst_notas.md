# Notas de referencia — XO.vst (reverse engineering funcional)

Fecha: 20/11/2026. Analizado desde `/Users/dante/Desktop/XO.vst`.

## Identificación del binario

| Campo | Valor |
| --- | --- |
| Nombre | XO |
| Versión | 1.8.10 |
| Bundle ID | `com.xlnaudio.xo` |
| Formato | VST2 (símbolo exportado `_VSTPluginMain`) |
| Arquitecturas | x86_64 + arm64 (universal) |
| Firma | Developer ID Application: XLN Audio AB (6A3P2F8YN2), válida |
| Framework detectado | JUCE 8.0.7 (rutas de símbolos `juce_audio_plugin_client_VST2.cpp`) |
| UI | Enlaza `WebKit.framework` → interfaz web embebida |
| Ubicación del bundle | `~/Desktop/XO.vst`, copia instalada en `/Library/Audio/Plug-Ins/VST/XO.vst` |
| Standalone | `/Applications/XLN Audio/XO.app` (misma versión 1.8.10) |

Nota: `spctl` reporta *rejected (the code is valid but does not seem to be an app)*. Es normal en bundles VST; la firma es válida.

## Implicancias para TRIGGER_UNIVERSE

- No hace falta iPlug2 para abrirlo; iPlug2 es un framework de creación de plugins, no un host.
- Hosts disponibles en esta máquina: Ableton Live 11.3.35 Suite (VST2) y el standalone XO.app.
- El uso de JUCE 8 + WebKit por parte de la referencia es consistente con la arquitectura prevista (JUCE + React/WebView).
- Xcode completo **no** está instalado (solo CommandLineTools), necesario más adelante para compilar AU.

## Alcance del análisis

Solo análisis **funcional y de arquitectura**: comportamiento del Universe, filtros, búsqueda, inspector/editor, parámetros y formato de presets. No copiar código, assets, tipografías ni recursos gráficos propietarios, según el brief v0.2.

## Información a recolectar

1. Capturas breves del Universe, inspector/editor y flujo de búsqueda/filtros.
2. Lista de parámetros automatizables expuestos al host.
3. Presets de ejemplo y una carpeta pequeña de samples para observar metadata/tags.
4. Confirmar qué subsistema se quiere replicar funcionalmente: Universe, editor, o esquema de índice/presets.
