# 🎬 VIBE-BR Video Editor

> **Automated multi-character dialogue video editor** for short-form brain-rot content and long-form video automation.

Turn a script + a folder of images into a finished video. The app parses the script, matches images to the dialogue using a filename naming convention, arranges everything on a multi-track timeline, generates character voices with local TTS, and exports with FFmpeg — no manual editing required.

---

## ✨ Features

### 📝 Script Parsing
- Paste dialogue scripts formatted as `**Character:** line` or `Name: line`.
- Characters and per-speaker timeline tracks are auto-generated.
- `Name:` blocks support multi-line dialogue.

### 🖼️ Image → Timeline Sync (Naming Convention)
Timeline placement is driven by **filenames**, so an image folder + script fully automate the edit:

```
<png in folder>  ->  "<start phrase> ___ <end phrase>.png"
```

- The image appears when the **start phrase** begins being spoken.
- The image disappears when the **end phrase** finishes being spoken.
- No `___` separator → the whole filename is the covered span.
- Fuzzy matching tolerates typos, number words (`one` = `1`), and small word skips.
- Timing comes from TTS word timings when available, otherwise proportional estimates.

### 🤖 VBS Automation Engine
A build-script language (`VBS`) drives the whole pipeline from a console panel:

- `PARSE_SCRIPT`, `GENERATE_VOICES`, `APPLY_VOICES`, `SET_VOICE`, `APPLY_RANDOM_BACKGROUND`
- Variables (`SET`), loops (`FOR ... ENDFOR`), conditionals (`IF/ELSE/ENDIF`)
- Model management (`LOAD_MODEL`, `UNLOAD_MODEL`) and full export orchestration
- Guardrails: loop iteration caps, per-command line numbers, clean abort handling

### 🎙️ Voice Cloning & TTS
- Local Python server (Flask + LuxTTS / Qwen3-TTS) — no cloud calls.
- Reference-audio voice cloning, word-level timings, per-character voice configs.
- Voice lines land on the timeline automatically with word-synced captions.

### ⏱️ Multi-Track Timeline
- Character, captions, video, broll/PIP, window (slideshow), and audio tracks.
- Drag, resize, split, lock, rename, extract audio; overlap prevention.
- Zoomable ruler, waveform rendering, undo/redo history (drag-safe).

### 🎨 Real-Time Preview Canvas
- Canvas 2D renderer with free-transform handles (drag / rotate / scale / flip / skew).
- Keyframe animation, entrance/exit transitions, word-synced caption highlighting.
- Character PNG assets with per-character text styles (color, stroke, glow, background).

### 📤 FFmpeg Export
- Canvas frame streaming (GPU-accelerated) or native FFmpeg mode.
- GPU codec detection (NVENC / AMF / QSV) with automatic fallback.
- Presets (9:16, 1:1, 16:9), custom resolution/FPS/CRF, audio mixing of all timeline clips.

### 🪟 Multi-Window Desktop App
- **Project Settings** window — resolution, FPS, broll layout, project metadata.
- **Voice Cloning** window — generate/preview voices before applying.
- **Vector Graphics Studio** — create SVG-style overlays and export them to media.

---

## 🚀 Quick Start

### Prerequisites
- **Node.js** 18+
- **FFmpeg** — placed in `./bin/` or available on `PATH` (auto-detected from common install locations).
- *(Optional, for voice cloning)* Python 3.10+ venv with the TTS deps in `./.venv/`.

### Setup
```bash
git clone https://github.com/MorariuMark/VIBE-BR-Video-Editor.git
cd VIBE-BR-Video-Editor
npm install
```

### Run (dev)
```bash
npm run dev
```
Spins up the Vite dev server and launches Electron.

### Package
```bash
npm run build          # vite build + electron-builder (NSIS installer + zip)
```

---

## 🏗️ Architecture

```
React 18 + Vite  ──IPC──►  Electron 28 main process
      │                        │
      │                        ├── FFmpeg (export, audio mix, optimize)
      │                        └── Python TTS server (LuxTTS / Qwen3-TTS)
      └── Canvas 2D renderer (preview + export frame streaming)
```

- `src/store/ProjectContext.jsx` — reducer-based global state with undo/redo history.
- `src/engine/` — `scriptParser`, `renderEngine`, `animationEngine`, `automationEngine`, `exportEngine`, `scriptImageMatcher`.
- `electron/main.js` — window management, IPC handlers, FFmpeg/TTS process orchestration.
- `scripts/voice_clone_server.py` — local TTS model server (`http://127.0.0.1:5555`).

## 📁 Structure

```
├── electron/          # Main process + preload (context bridge)
├── src/
│   ├── components/    # Timeline, PreviewCanvas, ScriptEditor, MediaLibrary, ...
│   ├── engine/        # Parsing, rendering, animation, automation, export logic
│   ├── store/         # ProjectContext (state + history)
│   ├── utils/         # fileHelpers, scriptImageMatcher
│   ├── styles/        # CSS design tokens
│   ├── App.jsx        # Main editor layout
│   └── main.jsx       # Entry point (hash-routed windows)
├── assets/            # App icon, default character voices
├── presets/           # Voice/character/media preset libraries
├── scripts/           # TTS server, dev/build helpers
└── package.json
```

## ⌨️ Shortcuts

| Key | Action |
|:---:|---|
| `V` / `C` / `H` | Select / Cut / Hand tools |
| `Space` | Play / pause preview |
| `Delete` | Delete selected clip |
| `Ctrl+Z` / `Ctrl+Shift+Z` | Undo / redo |

## 📄 License

MIT
