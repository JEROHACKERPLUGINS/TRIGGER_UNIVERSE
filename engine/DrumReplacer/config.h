#define PLUG_NAME "TRIGGER UNIVERSE"
#define PLUG_MFR "Dante"
#define PLUG_VERSION_HEX 0x00010000
#define PLUG_VERSION_STR "1.0.0"
#define PLUG_UNIQUE_ID 'TRGU'
#define PLUG_MFR_ID 'DANT'
#define PLUG_URL_STR "https://github.com/JEROHACKERPLUGINS/TRIGGER_UNIVERSE"
#define PLUG_EMAIL_STR "dante@localhost"
#define PLUG_COPYRIGHT_STR "Copyright 2026 Dante"
#define PLUG_CLASS_NAME DrumReplacer

#define BUNDLE_NAME "TriggerUniverse"
#define BUNDLE_MFR "Dante"
#define BUNDLE_DOMAIN "com"

#define SHARED_RESOURCES_SUBPATH "TriggerUniverse"

#define PLUG_CHANNEL_IO "2-2"

#define PLUG_LATENCY 0
#define PLUG_TYPE 0
#define PLUG_DOES_MIDI_IN 1
#define PLUG_DOES_MIDI_OUT 1
#define PLUG_DOES_MPE 0
#define PLUG_DOES_STATE_CHUNKS 1
#define PLUG_HAS_UI 1
#define PLUG_WIDTH 1440
#define PLUG_HEIGHT 900
#define PLUG_FPS 60
#define PLUG_SHARED_RESOURCES 0
#define PLUG_HOST_RESIZE 1

#define AUV2_ENTRY DrumReplacer_Entry
#define AUV2_ENTRY_STR "DrumReplacer_Entry"
#define AUV2_FACTORY DrumReplacer_Factory
#define AUV2_VIEW_CLASS DrumReplacer_View
#define AUV2_VIEW_CLASS_STR "DrumReplacer_View"

#define AAX_TYPE_IDS 'IPWV'
#define AAX_TYPE_IDS_AUDIOSUITE 'IPWA'
#define AAX_PLUG_MFR_STR "MyCompany"
#define AAX_PLUG_NAME_STR "DrumReplacer\nDRPL"
#define AAX_PLUG_CATEGORY_STR "Effect"
#define AAX_DOES_AUDIOSUITE 1

#define VST3_SUBCATEGORY "Fx"

#define APP_NUM_CHANNELS 2
#define APP_N_VECTOR_WAIT 0
#define APP_MULT 1
#define APP_COPY_AUV3 0
#define APP_SIGNAL_VECTOR_SIZE 64

// 1 = Pro build (Transient Gate enabled). 0 = base version: gate shown disabled.
#define DRUMREPLACER_PRO 1
