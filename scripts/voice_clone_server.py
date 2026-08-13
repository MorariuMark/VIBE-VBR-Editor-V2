import os
import sys
import uuid
import time
import gc
import glob
import subprocess

# Configure project-local Hugging Face home directory before loading anything else
project_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.environ["HF_HOME"] = os.path.join(project_dir, ".hf_cache")
sys.path.append(os.path.join(project_dir, "LuxTTS"))

from flask import Flask, request, jsonify
import numpy as np
import soundfile as sf

# Flask application
app = Flask(__name__)

# Global model reference
model = None
model_type = None # "luxtts" or "qwen3tts_0.6b"
transcriber = None

# Create temp directories inside project
temp_dir = os.path.join(project_dir, "dist", "voice_temp")
os.makedirs(temp_dir, exist_ok=True)

# Create voice cache directories inside project presets
cache_dir = os.path.abspath(os.path.join(project_dir, "presets", "media", "voice_cache"))
os.makedirs(cache_dir, exist_ok=True)

import hashlib
import json

# ─── Fast startup helpers ────────────────────────────────────
# torch import + CUDA detection take seconds, and scan_installed_models()
# walks the local model cache (slow once models are downloaded). Both are
# moved to a background thread so Flask binds immediately and /status
# never blocks on them.

_gpu_info = {
    "ready": False,
    "cuda_available": False,
    "gpu_name": "CPU",
    "vram_total": 0,
}

def _warmup_background():
    try:
        import torch
        _gpu_info["cuda_available"] = bool(torch.cuda.is_available())
        if _gpu_info["cuda_available"]:
            _gpu_info["gpu_name"] = torch.cuda.get_device_name(0)
            _gpu_info["vram_total"] = torch.cuda.get_device_properties(0).total_memory / (1024**3)
    except Exception as e:
        print(f"[Python Server] Torch warmup failed: {str(e)}", flush=True)
    finally:
        _gpu_info["ready"] = True
    try:
        scan = scan_installed_models()
        print(f"[Python Server] Auto-detected models: {json.dumps(scan, indent=2)}", flush=True)
        # Warm the s2 GPU-backend probe in the background so the first
        # generation never blocks for up to ~6 minutes.
        if scan.get("s2pro", {}).get("installed"):
            binary = find_s2_binary()
            if binary:
                print("[Python Server] Probing s2 GPU backends in background...", flush=True)
                probe_s2_backends(binary)
    except Exception as e:
        print(f"[Python Server] Model scan failed: {str(e)}", flush=True)

def get_cache_key(text, ref_audio, ref_text, temperature, speed, model_type):
    ref_audio_stat = ""
    if os.path.exists(ref_audio):
        stat = os.stat(ref_audio)
        ref_audio_stat = f"{ref_audio}_{stat.st_mtime}_{stat.st_size}"
    else:
        ref_audio_stat = ref_audio
        
    payload = f"{text}||{ref_audio_stat}||{ref_text}||{temperature}||{speed}||{model_type}"
    return hashlib.sha256(payload.encode('utf-8')).hexdigest()

@app.route("/status", methods=["GET"])
def status():
    with gen_lock:
        generating = gen_busy > 0
    return jsonify({
        "status": "active",
        "cuda_available": _gpu_info["cuda_available"],
        "model_loaded": model is not None or model_type == "s2pro",
        "model_type": model_type,
        "gpu_name": _gpu_info["gpu_name"],
        "vram_total": _gpu_info["vram_total"],
        "generating": generating,
        "s2_capabilities": _s2_backend_probe_cache,
    })

import threading
import shutil
import traceback
import requests
from huggingface_hub import HfApi

# Global download state
download_lock = threading.Lock()
download_state = {
    "downloading": False,
    "model_name": None,
    "total_bytes": 0,
    "downloaded_bytes": 0,
    "error": None
}

# ─── Generation cancellation / reset state ─────────────────────
# Cancel works with a token: /cancel bumps the token; every /clone
# request snapshots the token at entry and compares it at its
# checkpoints. A bumped token only affects requests that were already
# in flight — requests that START after the cancel are unaffected, so a
# fresh run never inherits a stale cancel.
gen_lock = threading.Lock()
cancel_token = 0
gen_busy = 0
current_s2_proc = None

def snapshot_cancel_token():
    with gen_lock:
        return cancel_token

def bump_cancel():
    """Request cancellation of any in-flight generation."""
    global cancel_token
    with gen_lock:
        cancel_token += 1
    proc = current_s2_proc
    if proc is not None:
        try:
            proc.kill()
        except Exception:
            pass

def check_cancel(token):
    with gen_lock:
        return cancel_token != token

def inc_busy():
    global gen_busy
    with gen_lock:
        gen_busy += 1

def dec_busy():
    global gen_busy
    with gen_lock:
        gen_busy = max(0, gen_busy - 1)

def check_model_installed(model_name):
    if model_name == "luxtts":
        local_path = os.path.join(project_dir, "models", "luxtts")
        critical_files = [
            "model.pt",
            "text_encoder.onnx",
            "fm_decoder.onnx",
            "config.json",
            "tokens.txt",
            os.path.join("vocoder", "config.yaml"),
            os.path.join("vocoder", "vocos.bin")
        ]
        if not os.path.exists(local_path):
            return False
        for f in critical_files:
            file_path = os.path.join(local_path, f)
            if not os.path.exists(file_path) or os.path.getsize(file_path) < 100:
                return False
        return True
    elif model_name == "qwen3tts_0.6b":
        local_path = os.path.join(project_dir, "models", "qwen3tts")
        critical_files = [
            "model.safetensors",
            "config.json",
            "vocab.json",
            "merges.txt",
            os.path.join("speech_tokenizer", "model.safetensors"),
            os.path.join("speech_tokenizer", "config.json")
        ]
        if not os.path.exists(local_path):
            return False
        for f in critical_files:
            file_path = os.path.join(local_path, f)
            if not os.path.exists(file_path) or os.path.getsize(file_path) < 100:
                return False
        return True
    elif model_name == "qwen3tts_1.7b":
        local_path = os.path.join(project_dir, "models", "qwen3tts_1.7b")
        critical_files = [
            "model.safetensors",
            "config.json",
            "vocab.json",
            "merges.txt",
            os.path.join("speech_tokenizer", "model.safetensors"),
            os.path.join("speech_tokenizer", "config.json")
        ]
        if not os.path.exists(local_path):
            return False
        for f in critical_files:
            file_path = os.path.join(local_path, f)
            if not os.path.exists(file_path) or os.path.getsize(file_path) < 100:
                return False
        return True
    elif model_name == "s2pro":
        local_path = os.path.join(project_dir, "models", "s2pro")
        if not os.path.exists(local_path):
            return False
        model_file = os.path.join(local_path, S2_PRO_MODEL_FILE)
        tokenizer_file = os.path.join(local_path, S2_PRO_TOKENIZER_FILE)
        if not os.path.exists(model_file) or not os.path.exists(tokenizer_file):
            return False
        # Partial-download guard: the GGUF must be near its full ~3.3 GB size
        if os.path.getsize(model_file) < 3 * 1024**3:
            return False
        if os.path.getsize(tokenizer_file) < 1024**2:
            return False
        return True
    return False

# ─── Auto-detection of installed models ─────────────────────
# Scans the project-local "models/" directory AND the local Hugging Face
# cache (.hf_cache/hub) so any model the user has on disk is automatically
# discovered and offered in the UI — no hardcoded lists.

MODELS_DIR = os.path.join(project_dir, "models")
HF_HUB_DIR = os.path.join(project_dir, ".hf_cache", "hub")

MODEL_INFO = {
    "luxtts": {
        "name": "LuxTTS 1.7B",
        "type": "luxtts",
        "repo_id": "YatharthS/LuxTTS",
        "local_dir": "luxtts",
    },
    "qwen3tts_0.6b": {
        "name": "Qwen3-TTS 0.6B",
        "type": "qwen3tts",
        "repo_id": "Qwen/Qwen3-TTS-12Hz-0.6B-Base",
        "local_dir": "qwen3tts",
    },
    "qwen3tts_1.7b": {
        "name": "Qwen3-TTS 1.7B",
        "type": "qwen3tts",
        "repo_id": "Qwen/Qwen3-TTS-12Hz-1.7B-Base",
        "local_dir": "qwen3tts_1.7b",
    },
    "s2pro": {
        "name": "S2 Pro 5B (GGUF Q4_K_M)",
        "type": "s2pro",
        "repo_id": "rodrigomt/s2-pro-gguf",
        "local_dir": "s2pro",
    },
}

def find_s2_binary():
    """Locate the s2.cpp engine executable (built from https://github.com/rodrigomatta/s2.cpp)."""
    candidates = [
        os.path.join(project_dir, "models", "s2pro", "s2.exe"),
        os.path.join(project_dir, "s2.cpp", "build", "s2.exe"),
        os.path.join(project_dir, "s2.cpp", "build", "Release", "s2.exe"),
        os.path.join(project_dir, "s2.cpp", "build", "bin", "s2.exe"),
        os.path.join(project_dir, "s2.cpp", "build", "Debug", "s2.exe"),
        os.path.join(project_dir, "s2.cpp", "s2.exe"),
    ]
    for c in candidates:
        if os.path.isfile(c):
            return c
    return shutil.which("s2")

def s2_subprocess_env():
    """Env for spawning the s2 engine: prepend MinGW runtime dirs so the
    MinGW-built binary finds libgcc_s_seh-1.dll / libstdc++-6.dll etc., plus
    the project-local CUDA toolkit bin so the CUDA build finds cudart64_12.dll
    and cublas64_12.dll at runtime."""
    env = dict(os.environ)
    extra = []
    for cand in (
        os.path.join(project_dir, "tools", "mingw64", "bin"),
        os.path.join(project_dir, "mingw64", "bin"),
        os.path.join(project_dir, "tools", "cuda", "bin"),
        os.path.join(project_dir, "s2.cpp", "build"),
    ):
        if os.path.isdir(cand):
            extra.append(cand)
    s2_bin = find_s2_binary()
    if s2_bin:
        d = os.path.dirname(s2_bin)
        if d not in extra and os.path.isdir(d):
            extra.append(d)
    if extra:
        env["PATH"] = os.pathsep.join(extra + [env.get("PATH", "")])
    return env

_s2_backend_probe_cache = None

def probe_s2_backends(binary):
    """Determine which GPU backends the built s2 engine actually supports.

    Builds compiled without e.g. GGML_USE_CUDA still list --cuda/--vulkan in
    --help, but abort model init immediately ("backend is unavailable...")
    when those flags are used. Probe each backend with a 1-token generation;
    unsupported backends fail in ~1-2 s, supported ones succeed.
    """
    global _s2_backend_probe_cache
    if _s2_backend_probe_cache is not None:
        return _s2_backend_probe_cache

    model_file = os.path.join(project_dir, "models", "s2pro", S2_PRO_MODEL_FILE)
    tokenizer_file = os.path.join(project_dir, "models", "s2pro", S2_PRO_TOKENIZER_FILE)
    ref_files = glob.glob(os.path.join(project_dir, "assets", "default_voices", "*.wav"))
    ref_audio = ref_files[0] if ref_files else ""
    ref_text = ""
    if ref_audio:
        tx = ref_audio + ".txt"
        if os.path.isfile(tx):
            try:
                ref_text = open(tx, "r", encoding="utf-8").read().strip()
            except OSError:
                ref_text = ""

    caps = {"cuda": False, "vulkan": False}
    if not (os.path.isfile(model_file) and os.path.isfile(tokenizer_file) and ref_audio):
        _s2_backend_probe_cache = caps
        return caps

    proc_flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
    for name, flag in (("cuda", "--cuda"), ("vulkan", "--vulkan")):
        out_path = os.path.join(temp_dir, f"_s2probe_{name}.wav")
        cmd = [
            binary, "--model", model_file, "--tokenizer", tokenizer_file,
            "--prompt-audio", ref_audio, "--text", "x", "--output", out_path,
            "--max-tokens", "1", "--log-level", "error",
            flag, "0", "--gpu-layers", "1",
        ]
        if ref_text:
            cmd += ["--prompt-text", ref_text]
        try:
            proc = subprocess.run(
                cmd, capture_output=True, text=True, encoding="utf-8",
                errors="replace", timeout=180, creationflags=proc_flags,
                env=s2_subprocess_env(),
            )
            detail = (proc.stderr or proc.stdout or "")
            caps[name] = (proc.returncode == 0) and os.path.isfile(out_path)
            if caps[name]:
                try:
                    os.remove(out_path)
                except OSError:
                    pass
        except Exception:
            caps[name] = False
        if not caps[name] and name == "cuda":
            # On machines without a CUDA build, Vulkan is the only other GPU option
            continue

    print(f"[Python Server] s2 backend probe: {caps}", flush=True)
    _s2_backend_probe_cache = caps
    return caps

S2_PRO_MODEL_FILE = "s2-pro-q4_k_m.gguf"
S2_PRO_TOKENIZER_FILE = "tokenizer.json"

def _dir_size(path):
    total = 0
    for root, _, files in os.walk(path):
        for f in files:
            try:
                total += os.path.getsize(os.path.join(root, f))
            except OSError:
                pass
    return total

def hf_cache_snapshot_path(repo_id):
    cache_dir = os.path.join(HF_HUB_DIR, "models--" + repo_id.replace("/", "--"))
    if not os.path.isdir(cache_dir):
        return None
    snap = os.path.join(cache_dir, "snapshots")
    if os.path.isdir(snap):
        snapshots = [d for d in os.listdir(snap) if os.path.isdir(os.path.join(snap, d))]
        if snapshots:
            return os.path.join(snap, snapshots[0])
    return cache_dir

def scan_installed_models():
    """Auto-detect every known model: local models/ dir + HF cache."""
    result = {}
    for mid, info in MODEL_INFO.items():
        entry = {
            "installed": False, "local": False, "hf_cached": False,
            "size_bytes": 0, "path": None
        }
        if check_model_installed(mid):
            local_dir = os.path.join(MODELS_DIR, info["local_dir"])
            entry["installed"] = True
            entry["local"] = True
            entry["size_bytes"] = _dir_size(local_dir)
            entry["path"] = local_dir
        hf_path = hf_cache_snapshot_path(info["repo_id"])
        if hf_path:
            entry["hf_cached"] = True
            if not entry["installed"]:
                entry["size_bytes"] = max(entry["size_bytes"], _dir_size(hf_path))
                entry["path"] = hf_path
        result[mid] = entry
    return result

def scan_hf_cache_extras():
    """List any other models present in the HF cache (unknown repos)."""
    extras = []
    known_repos = {info["repo_id"] for info in MODEL_INFO.values()}
    if not os.path.isdir(HF_HUB_DIR):
        return extras
    try:
        for name in os.listdir(HF_HUB_DIR):
            if not name.startswith("models--"):
                continue
            repo_id = name[len("models--"):].replace("--", "/")
            if repo_id in known_repos:
                continue
            snapshot = hf_cache_snapshot_path(repo_id)
            if not snapshot:
                continue
            has_weights = any(f.endswith((".safetensors", ".bin", ".pt", ".onnx"))
                              for _, _, files in os.walk(snapshot) for f in files)
            if not has_weights:
                continue
            extras.append({
                "id": f"hf:{repo_id}",
                "name": repo_id,
                "type": "hfcache",
                "installed": True,
                "hf_cached": True,
                "size_bytes": _dir_size(snapshot),
                "path": snapshot,
                "loaded": False,
                "downloadable": False,
            })
    except OSError as e:
        print(f"[Python Server] HF cache scan failed: {e}", flush=True)
    return extras

def download_model_thread(model_name):
    global download_state
    try:
        api = HfApi()
        if model_name == "luxtts":
            repo_id = "YatharthS/LuxTTS"
            dest_dir = os.path.join(project_dir, "models", "luxtts")
            files_to_download = [
                "config.json",
                "tokens.txt",
                "model.pt",
                "text_encoder.onnx",
                "fm_decoder.onnx",
                "vocoder/config.yaml",
                "vocoder/vocos.bin"
            ]
        elif model_name == "qwen3tts_0.6b":
            repo_id = "Qwen/Qwen3-TTS-12Hz-0.6B-Base"
            dest_dir = os.path.join(project_dir, "models", "qwen3tts")
            files_to_download = [
                "config.json",
                "generation_config.json",
                "merges.txt",
                "model.safetensors",
                "preprocessor_config.json",
                "speech_tokenizer/config.json",
                "speech_tokenizer/configuration.json",
                "speech_tokenizer/model.safetensors",
                "speech_tokenizer/preprocessor_config.json",
                "tokenizer_config.json",
                "vocab.json"
            ]
        elif model_name == "qwen3tts_1.7b":
            repo_id = "Qwen/Qwen3-TTS-12Hz-1.7B-Base"
            dest_dir = os.path.join(project_dir, "models", "qwen3tts_1.7b")
            files_to_download = [
                "config.json",
                "generation_config.json",
                "merges.txt",
                "model.safetensors",
                "preprocessor_config.json",
                "speech_tokenizer/config.json",
                "speech_tokenizer/configuration.json",
                "speech_tokenizer/model.safetensors",
                "speech_tokenizer/preprocessor_config.json",
                "tokenizer_config.json",
                "vocab.json"
            ]
        elif model_name == "s2pro":
            repo_id = "rodrigomt/s2-pro-gguf"
            dest_dir = os.path.join(project_dir, "models", "s2pro")
            files_to_download = [S2_PRO_MODEL_FILE, S2_PRO_TOKENIZER_FILE]
        else:
            raise ValueError(f"Unknown model: {model_name}")

        os.makedirs(dest_dir, exist_ok=True)
        
        print(f"[Download Thread] Listing files in HF repo {repo_id}...", flush=True)
        info = api.model_info(repo_id=repo_id, files_metadata=True)
        sizes = {sibling.rfilename: sibling.size for sibling in info.siblings if sibling.size is not None}
        
        total_bytes = 0
        for f in files_to_download:
            total_bytes += sizes.get(f, 0)
            
        with download_lock:
            download_state["downloading"] = True
            download_state["model_name"] = model_name
            download_state["total_bytes"] = total_bytes
            download_state["downloaded_bytes"] = 0
            download_state["error"] = None

        print(f"[Download Thread] Total size of {model_name} to download: {total_bytes} bytes", flush=True)
        
        for filename in files_to_download:
            url = f"https://huggingface.co/{repo_id}/resolve/main/{filename}"
            target_path = os.path.join(dest_dir, filename)
            
            os.makedirs(os.path.dirname(target_path), exist_ok=True)
            
            attempts = 0
            while True:
                attempts += 1
                try:
                    print(f"[Download Thread] Downloading {filename} (attempt {attempts})...", flush=True)
                    response = requests.get(url, stream=True, allow_redirects=True, timeout=60)
                    if response.status_code != 200:
                        raise Exception(f"HTTP status {response.status_code}")
                        
                    with open(target_path, "wb") as f:
                        for chunk in response.iter_content(chunk_size=1024*1024):
                            if chunk:
                                f.write(chunk)
                                with download_lock:
                                    download_state["downloaded_bytes"] += len(chunk)
                    break
                except Exception as e:
                    if attempts >= 4:
                        raise Exception(f"Failed to download {filename} after {attempts} attempts: {str(e)}")
                    print(f"[Download Thread] Retry {attempts}/4 for {filename}: {str(e)}", flush=True)
                    time.sleep(5)
                            
        print(f"[Download Thread] Download of {model_name} completed successfully!", flush=True)
        with download_lock:
            download_state["downloading"] = False
            download_state["downloaded_bytes"] = total_bytes
            
    except Exception as e:
        traceback.print_exc()
        print(f"[Download Thread] Error downloading {model_name}: {str(e)}", flush=True)
        with download_lock:
            download_state["downloading"] = False
            download_state["error"] = str(e)

@app.route("/model_status", methods=["GET"])
def get_model_status():
    scan = scan_installed_models()
    return jsonify({mid: e["installed"] for mid, e in scan.items()})

@app.route("/list_models", methods=["GET"])
def list_models():
    scan = scan_installed_models()
    models = []
    for mid, info in MODEL_INFO.items():
        e = scan[mid]
        models.append({
            "id": mid,
            "name": info["name"],
            "type": info["type"],
            "installed": e["installed"],
            "local": e["local"],
            "hf_cached": e["hf_cached"],
            "size_bytes": e["size_bytes"],
            "path": e["path"],
            "loaded": model is not None and model_type == mid,
            "downloadable": True,
        })
    models.extend(scan_hf_cache_extras())
    return jsonify({"models": models})

@app.route("/download_model", methods=["POST"])
def download_model():
    global download_state
    data = request.json or {}
    model_name = data.get("model_name")
    
    with download_lock:
        if download_state["downloading"]:
            return jsonify({"success": False, "error": "A download is already in progress"}), 400
            
    t = threading.Thread(target=download_model_thread, args=(model_name,))
    t.daemon = True
    t.start()
    return jsonify({"success": True, "message": f"Started download of {model_name}"})

@app.route("/download_progress", methods=["GET"])
def download_progress():
    global download_state
    with download_lock:
        return jsonify(download_state)

@app.route("/uninstall_model", methods=["POST"])
def uninstall_model():
    global model, model_type
    data = request.json or {}
    model_name = data.get("model_name")
    
    try:
        import torch
        if model is not None and (
            (model_name == "luxtts" and model_type == "luxtts") or
            (model_name == "qwen3tts_0.6b" and model_type == "qwen3tts_0.6b") or
            (model_name == "qwen3tts_1.7b" and model_type == "qwen3tts_1.7b")
        ):
            print(f"[Python Server] Unloading {model_type} model before uninstall...", flush=True)
            del model
            model = None
            model_type = None
            gc.collect()
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
                
        if model_name == "luxtts":
            dest_dir = os.path.join(project_dir, "models", "luxtts")
        elif model_name == "qwen3tts_0.6b":
            dest_dir = os.path.join(project_dir, "models", "qwen3tts")
        elif model_name == "qwen3tts_1.7b":
            dest_dir = os.path.join(project_dir, "models", "qwen3tts_1.7b")
        elif model_name == "s2pro":
            dest_dir = os.path.join(project_dir, "models", "s2pro")
        else:
            return jsonify({"success": False, "error": f"Unknown model name: {model_name}"}), 400
            
        if os.path.exists(dest_dir):
            shutil.rmtree(dest_dir)
            print(f"[Python Server] Uninstalled {model_name} (deleted {dest_dir})", flush=True)
            return jsonify({"success": True, "message": f"Successfully uninstalled {model_name}"})
        else:
            return jsonify({"success": True, "message": f"Model {model_name} was not installed"})
            
    except Exception as e:
        traceback.print_exc()
        return jsonify({"success": False, "error": str(e)}), 500

@app.route("/load", methods=["POST"])
def load_model():
    global model, model_type
    try:
        import torch
        data = request.json or {}
        requested_type = data.get("model_name", "luxtts")

        # S2 Pro runs through the s2.cpp engine (per-invocation CLI); no
        # persistent model is kept in memory. Loading it merely validates the
        # engine and must NEVER unload the in-memory torch model that may
        # already be resident (the frontend falls back to it if S2 Pro fails).
        if requested_type == "s2pro":
            local_path = os.path.join(project_dir, "models", "s2pro")
            model_file = os.path.join(local_path, S2_PRO_MODEL_FILE)
            tokenizer_file = os.path.join(local_path, S2_PRO_TOKENIZER_FILE)
            if not (os.path.exists(model_file) and os.path.exists(tokenizer_file)):
                return jsonify({"success": False, "error": "S2 Pro model files are missing. Download the model first."}), 400
            s2_binary = find_s2_binary()
            if not s2_binary:
                return jsonify({"success": False, "error": "S2 Pro engine (s2.exe) not found. Build s2.cpp (github.com/rodrigomatta/s2.cpp) and place s2.exe in models/s2pro/ or s2.cpp/build/."}), 400
            model_type = "s2pro"
            print(f"[Python Server] S2 Pro engine ready ({s2_binary}). Model invoked per request via s2.cpp CLI.", flush=True)
            return jsonify({"success": True, "message": f"S2 Pro engine ready ({s2_binary})"})

        if model is not None and model_type == requested_type:
            return jsonify({"success": True, "message": f"Model {requested_type} already loaded"})

        device = "cuda:0" if torch.cuda.is_available() else "cpu"

        # Build the new model object BEFORE dropping the current one so that a
        # failed switch (missing files, import error, OOM, ...) never leaves
        # the server without a model to generate with.
        new_model = None
        new_model_type = None

        if requested_type in ["qwen3tts_0.6b", "qwen3tts_1.7b"]:
            print(f"[Python Server] Loading Qwen3-TTS {requested_type} model on {device}...", flush=True)
            from qwen_tts import Qwen3TTSModel
            if torch.cuda.is_available():
                dtype = torch.bfloat16 if (hasattr(torch.cuda, "is_bf16_supported") and torch.cuda.is_bf16_supported()) else torch.float16
            else:
                dtype = torch.float32

            local_path = os.path.join(project_dir, "models", "qwen3tts" if requested_type == "qwen3tts_0.6b" else "qwen3tts_1.7b")
            if os.path.exists(os.path.join(local_path, "model.safetensors")):
                model_id_or_path = local_path
                print(f"[Python Server] Loading Qwen3-TTS from local folder: {local_path}", flush=True)
            else:
                model_id_or_path = "Qwen/Qwen3-TTS-12Hz-0.6B-Base" if requested_type == "qwen3tts_0.6b" else "Qwen/Qwen3-TTS-12Hz-1.7B-Base"
                print(f"[Python Server] Loading Qwen3-TTS from Hugging Face Hub: {model_id_or_path}", flush=True)

            new_model = Qwen3TTSModel.from_pretrained(
                model_id_or_path,
                device_map=device,
                dtype=dtype,
                attn_implementation="eager"
            )
            new_model_type = requested_type
        else: # luxtts
            lux_device = "cuda" if torch.cuda.is_available() else "cpu"
            print(f"[Python Server] Loading LuxTTS model on {lux_device}...", flush=True)
            from zipvoice.luxvoice import LuxTTS

            local_path = os.path.join(project_dir, "models", "luxtts")
            if os.path.exists(os.path.join(local_path, "model.pt")):
                print(f"[Python Server] Loading LuxTTS from local folder: {local_path}", flush=True)
                new_model = LuxTTS(model_path=local_path, device=lux_device)
            else:
                print("[Python Server] Loading LuxTTS from Hugging Face Hub snapshot...", flush=True)
                new_model = LuxTTS(device=lux_device)

            new_model_type = "luxtts"

        # Success — swap out the old model only now
        if model is not None:
            old_type = model_type
            print(f"[Python Server] Unloading existing {old_type} model to switch...", flush=True)
            del model
            gc.collect()
            if torch.cuda.is_available():
                torch.cuda.empty_cache()

        model = new_model
        model_type = new_model_type
        print(f"[Python Server] Model {requested_type} loaded successfully.", flush=True)
        return jsonify({"success": True, "message": f"Model {requested_type} loaded successfully"})
    except Exception as e:
        traceback.print_exc()
        print(f"[Python Server] Failed to load model: {str(e)}", flush=True)
        return jsonify({"success": False, "error": str(e)}), 500

@app.route("/unload", methods=["POST"])
def unload_model():
    global model, model_type
    try:
        import torch
        if model is not None:
            print(f"[Python Server] Unloading {model_type} model...", flush=True)
            del model
            model = None
            model_type = None
            gc.collect()
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
            print("[Python Server] Model unloaded and VRAM cleared.", flush=True)
            return jsonify({"success": True, "message": "Model unloaded and VRAM cleared"})
        return jsonify({"success": True, "message": "Model was not loaded"})
    except Exception as e:
        print(f"[Python Server] Failed to unload model: {str(e)}", flush=True)
        return jsonify({"success": False, "error": str(e)}), 500

@app.route("/cancel", methods=["POST"])
def cancel_generation():
    bump_cancel()
    print("[Python Server] Cancel requested. In-flight generation will be aborted.", flush=True)
    return jsonify({"success": True, "message": "Cancellation requested. Current generation will stop."})

_graceful_shutdown = {"shutting_down": False}

@app.route("/shutdown", methods=["POST"])
def shutdown_server():
    """Cancel any in-flight generation, unload the model from VRAM, then exit.

    Called by the Electron main process when the voice-clone window or the
    whole app closes, so a generation can never outlive the UI. The endpoint
    replies immediately; the actual exit happens a moment later so the HTTP
    response can flush first.
    """
    global model, model_type
    if _graceful_shutdown["shutting_down"]:
        return jsonify({"success": True, "message": "Shutdown already in progress"})
    _graceful_shutdown["shutting_down"] = True

    def _do_shutdown():
        global model, model_type
        try:
            bump_cancel()
            proc = current_s2_proc
            if proc is not None:
                try:
                    proc.kill()
                except Exception:
                    pass
            # Let the in-flight /clone request observe the bump and bail out.
            deadline = time.time() + 10.0
            while time.time() < deadline:
                with gen_lock:
                    busy = gen_busy > 0
                if not busy:
                    break
                time.sleep(0.25)
            try:
                import torch
                if model is not None:
                    print(f"[Python Server] Shutdown: unloading {model_type} model from VRAM...", flush=True)
                    del model
                    model = None
                model_type = None
                gc.collect()
                if torch.cuda.is_available():
                    torch.cuda.empty_cache()
                    torch.cuda.synchronize()
                    print("[Python Server] Shutdown: VRAM cleared.", flush=True)
            except Exception as e:
                print(f"[Python Server] Shutdown: model unload failed: {e}", flush=True)
        except Exception as e:
            print(f"[Python Server] Shutdown error: {e}", flush=True)
        finally:
            # Let the HTTP response for /shutdown flush before exiting.
            time.sleep(0.8)
            print("[Python Server] Shutdown complete. Exiting.", flush=True)
            os._exit(0)

    threading.Thread(target=_do_shutdown, daemon=True).start()
    return jsonify({"success": True, "message": "Shutting down: generation cancelled, model unloaded."})

@app.route("/reset", methods=["POST"])
def reset_server():
    global model, model_type, transcriber
    try:
        bump_cancel()
        if model is not None:
            print(f"[Python Server] Reset: unloading {model_type} model...", flush=True)
            try:
                del model
            except Exception:
                pass
            model = None
            model_type = None
            transcriber = None
            gc.collect()
            try:
                import torch
                if torch.cuda.is_available():
                    torch.cuda.empty_cache()
            except Exception:
                pass
        else:
            transcriber = None
            gc.collect()
        print("[Python Server] Reset complete. Models unloaded, engine ready.", flush=True)
        return jsonify({"success": True, "message": "Engine reset. All models unloaded."})
    except Exception as e:
        traceback.print_exc()
        print(f"[Python Server] Reset failed: {str(e)}", flush=True)
        return jsonify({"success": False, "error": str(e)}), 500

@app.route("/clone", methods=["POST"])
def clone_voice():
    global model, model_type
    
    data = request.json or {}
    requested_model = data.get("model_name", "luxtts")

    # Snapshot the cancel token for THIS request. If /cancel was pressed
    # before this request started, abort immediately (prevents a cancelled
    # run from quietly resuming on the next block).
    gen_token = snapshot_cancel_token()
    if check_cancel(gen_token):
        print("[Python Server] Generation cancelled (pre-check).", flush=True)
        return jsonify({"success": False, "cancelled": True, "error": "Generation cancelled by user"})

    # Auto-load if model is not loaded OR if loaded model doesn't match the
    # requested torch model. S2 Pro needs no resident model, so it never
    # triggers (or unhooks) an in-memory load.
    # S2 Pro needs no resident torch model: just validate the engine and mark
    # the active model type (also works when /load s2pro was never called).
    if requested_model == "s2pro" and model_type != "s2pro":
        s2_binary = find_s2_binary()
        if not s2_binary:
            return jsonify({"success": False, "error": "S2 Pro engine (s2.exe) not found. Build s2.cpp (github.com/rodrigomatta/s2.cpp) and place s2.exe in models/s2pro/ or s2.cpp/build/."}), 500
        model_type = "s2pro"

    # Auto-load if model is not loaded OR if loaded model doesn't match the
    # requested torch model. S2 Pro needs no resident model, so it never
    # triggers (or unhooks) an in-memory load.
    if requested_model != "s2pro" and (model is None or (model_type != requested_model)):
        try:
            import torch
            device = "cuda:0" if torch.cuda.is_available() else "cpu"
            print(f"[Python Server] Model not loaded or mismatched. Auto-loading requested model '{requested_model}'...", flush=True)
            if requested_model in ["qwen3tts_0.6b", "qwen3tts_1.7b"]:
                from qwen_tts import Qwen3TTSModel
                dtype = torch.bfloat16 if (torch.cuda.is_available() and hasattr(torch.cuda, "is_bf16_supported") and torch.cuda.is_bf16_supported()) else (torch.float16 if torch.cuda.is_available() else torch.float32)
                local_path = os.path.join(project_dir, "models", "qwen3tts" if requested_model == "qwen3tts_0.6b" else "qwen3tts_1.7b")
                model_id_or_path = local_path if os.path.exists(os.path.join(local_path, "model.safetensors")) else ("Qwen/Qwen3-TTS-12Hz-0.6B-Base" if requested_model == "qwen3tts_0.6b" else "Qwen/Qwen3-TTS-12Hz-1.7B-Base")
                model = Qwen3TTSModel.from_pretrained(model_id_or_path, device_map=device, dtype=dtype, attn_implementation="eager")
                model_type = requested_model
            else:
                from zipvoice.luxvoice import LuxTTS
                lux_device = "cuda" if torch.cuda.is_available() else "cpu"
                local_path = os.path.join(project_dir, "models", "luxtts")
                if os.path.exists(os.path.join(local_path, "model.pt")):
                    model = LuxTTS(model_path=local_path, device=lux_device)
                else:
                    model = LuxTTS(device=lux_device)
                model_type = "luxtts"
        except Exception as load_err:
            # If auto-loading the requested model fails but another model is
            # already resident, keep that one instead of aborting the run.
            if model is not None and model_type:
                print(f"[Python Server] Auto-load of '{requested_model}' failed ({str(load_err)}). Falling back to loaded model '{model_type}'.", flush=True)
            else:
                return jsonify({"success": False, "error": f"Model not loaded and auto-load failed: {str(load_err)}"}), 500
            
    try:
        inc_busy()
        import torch
        data = request.json or {}
        text = data.get("text", "")
        device_used = "cuda:0" if torch.cuda.is_available() else "cpu"
        resp_extra = {"device_used": device_used}
        language = data.get("language", "English")
        ref_audio = data.get("ref_audio", "")
        ref_text = data.get("ref_text", "")
        temperature = data.get("temperature")
        speed = data.get("speed")
        
        if not text:
            return jsonify({"success": False, "error": "Target text is required."}), 400
        if not ref_audio or not os.path.exists(ref_audio):
            return jsonify({"success": False, "error": f"Reference audio file not found: {ref_audio}"}), 400

        # Check Cache
        cache_key = get_cache_key(text, ref_audio, ref_text, temperature, speed, model_type)
        cache_wav_path = os.path.join(cache_dir, f"{cache_key}.wav")
        cache_json_path = os.path.join(cache_dir, f"{cache_key}.json")
        
        if os.path.exists(cache_wav_path) and os.path.exists(cache_json_path):
            try:
                with open(cache_json_path, 'r', encoding='utf-8') as f:
                    cached_metadata = json.load(f)
                
                # Resolve save_path
                save_path = data.get("save_path", "")
                if save_path:
                    os.makedirs(os.path.dirname(save_path), exist_ok=True)
                    wav_path = save_path
                else:
                    file_id = str(uuid.uuid4())
                    wav_path = os.path.join(temp_dir, f"clip_{file_id}.wav")
                
                # Copy cached WAV file to save_path
                shutil.copyfile(cache_wav_path, wav_path)
                
                print(f"[Python Server] [Cache Hit] Served generated voice from cache for key {cache_key}", flush=True)
                return jsonify({
                    "success": True,
                    "wav_path": wav_path,
                    "duration": cached_metadata.get("duration"),
                    "words": cached_metadata.get("words", [])
                })
            except Exception as cache_err:
                print(f"[Python Server] [Cache Error] Failed reading cache: {str(cache_err)}. Recalculating...", flush=True)

        print(f"[Python Server] Generating voice clone ({model_type}) for text: '{text[:30]}...'", flush=True)
        
        if model_type in ["qwen3tts_0.6b", "qwen3tts_1.7b"]:
            gen_kwargs = {}
            if temperature is not None:
                temp_val = float(temperature)
                if temp_val <= 0.05:
                    gen_kwargs["do_sample"] = False
                    gen_kwargs["subtalker_dosample"] = False
                else:
                    gen_kwargs["do_sample"] = True
                    gen_kwargs["temperature"] = temp_val
                    gen_kwargs["subtalker_dosample"] = True
                    gen_kwargs["subtalker_temperature"] = temp_val
            
            # Auto-enable x_vector_only_mode if ref_text is empty/missing
            x_vector_only = not bool(ref_text and ref_text.strip())
            if x_vector_only:
                gen_kwargs["x_vector_only_mode"] = True
                ref_text_arg = None
            else:
                ref_text_arg = ref_text

            wavs, sr = model.generate_voice_clone(
                text=text,
                language=language,
                ref_audio=ref_audio,
                ref_text=ref_text_arg,
                **gen_kwargs
            )
            audio_data = wavs[0]
            if hasattr(audio_data, "cpu"):
                audio_data = audio_data.cpu().numpy()
            audio_data = np.squeeze(audio_data)
        elif model_type == "s2pro":
            # S2 Pro via the s2.cpp engine: per-request CLI invocation.
            s2_binary = find_s2_binary()
            if not s2_binary:
                return jsonify({"success": False, "error": "S2 Pro engine (s2.exe) not found. Build s2.cpp (github.com/rodrigomatta/s2.cpp) and place s2.exe in models/s2pro/ or s2.cpp/build/."}), 500
            local_path = os.path.join(project_dir, "models", "s2pro")
            model_file = os.path.join(local_path, S2_PRO_MODEL_FILE)
            tokenizer_file = os.path.join(local_path, S2_PRO_TOKENIZER_FILE)
            if not (os.path.exists(model_file) and os.path.exists(tokenizer_file)):
                return jsonify({"success": False, "error": "S2 Pro model files are missing. Download the model first."}), 500
            
            file_id = str(uuid.uuid4())
            out_wav = os.path.join(temp_dir, f"s2_{file_id}.wav")
            
            cmd = [
                s2_binary,
                "--model", model_file,
                "--tokenizer", tokenizer_file,
                "--prompt-audio", ref_audio,
                "--text", text,
                "--output", out_wav,
            ]
            if ref_text and ref_text.strip():
                cmd += ["--prompt-text", ref_text]
            else:
                return jsonify({"success": False, "error": "S2 Pro requires a reference transcript (ref_text). Use a default preset voice or provide one for the custom reference clip."}), 400

            # Backend: explicit user choice, else auto-detect from what this
            # particular s2 build actually supports (CUDA/Vulkan/CPU).
            s2_backend = data.get("s2_backend", "auto")
            capabilities = probe_s2_backends(s2_binary)
            backend_used = "cpu"
            if s2_backend == "cuda":
                if not capabilities.get("cuda"):
                    return jsonify({"success": False, "error": "This s2 engine build has no CUDA support (built CPU-only). Rebuild s2.cpp with -DS2_CUDA=ON and a CUDA Toolkit, or switch the S2 Backend to CPU."}), 400
                backend_flag = ["--cuda", "0"]
                backend_used = "cuda"
            elif s2_backend == "vulkan":
                if not capabilities.get("vulkan"):
                    return jsonify({"success": False, "error": "This s2 engine build has no Vulkan support. Rebuild s2.cpp with -DS2_VULKAN=ON, or switch the S2 Backend to CPU."}), 400
                backend_flag = ["--vulkan", "0"]
                backend_used = "vulkan"
            else:  # auto
                if capabilities.get("cuda"):
                    backend_flag = ["--cuda", "0"]
                    backend_used = "cuda"
                elif capabilities.get("vulkan"):
                    backend_flag = ["--vulkan", "0"]
                    backend_used = "vulkan"
                else:
                    backend_flag = []  # CPU-only build
                    print("[Python Server] WARNING: s2 engine built without GPU support (no CUDA/Vulkan). Falling back to CPU + system RAM. Rebuild s2.cpp with a GPU backend for acceleration.", flush=True)
            cmd += backend_flag
            resp_extra["s2_backend_used"] = backend_used

            if temperature is not None:
                cmd += ["--temperature", str(float(temperature))]
            if data.get("top_p") is not None:
                cmd += ["--top-p", str(float(data["top_p"]))]
            if data.get("top_k") is not None:
                cmd += ["--top-k", str(int(data["top_k"]))]
            if data.get("max_tokens") is not None:
                cmd += ["--max-tokens", str(int(data["max_tokens"]))]
            gpu_layers = data.get("gpu_layers")
            if backend_flag and gpu_layers is not None and float(gpu_layers) >= 0:
                cmd += ["--gpu-layers", str(int(float(gpu_layers)))]
            if data.get("codec_cpu"):
                cmd += ["--codec-cpu"]
            
            print(f"[Python Server] Running s2.cpp: {' '.join(cmd)}", flush=True)
            proc_flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
            proc = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                encoding="utf-8",
                errors="replace",
                creationflags=proc_flags,
                env=s2_subprocess_env(),
            )
            with gen_lock:
                current_s2_proc = proc
            try:
                try:
                    proc_out, proc_err = proc.communicate(timeout=900)
                except subprocess.TimeoutExpired:
                    try:
                        proc.kill()
                    except Exception:
                        pass
                    proc_out, proc_err = proc.communicate()
                    if check_cancel(gen_token):
                        print("[Python Server] s2.cpp terminated by cancel.", flush=True)
                        return jsonify({"success": False, "cancelled": True, "error": "Generation cancelled by user"})
                    return jsonify({"success": False, "error": "s2.cpp timed out after 900s"}), 500
            finally:
                with gen_lock:
                    if current_s2_proc is proc:
                        current_s2_proc = None
            if check_cancel(gen_token):
                print("[Python Server] s2.cpp finished but generation was cancelled.", flush=True)
                return jsonify({"success": False, "cancelled": True, "error": "Generation cancelled by user"})
            if proc.returncode != 0:
                detail = (proc_err or proc_out or "").strip()
                tail = detail.splitlines()[-3:] if detail else []
                return jsonify({"success": False, "error": f"s2.cpp failed (exit {proc.returncode}): {' | '.join(tail)}"}), 500
            
            audio_data, sr = sf.read(out_wav)
            try:
                os.remove(out_wav)
            except OSError:
                pass
        else: # luxtts
            # Encode reference prompt
            encoded_prompt = model.encode_prompt(ref_audio, prompt_text=ref_text)
            # Generate speech
            gen_kwargs = {}
            if temperature is not None:
                gen_kwargs["t_shift"] = float(temperature)
            if speed is not None:
                gen_kwargs["speed"] = float(speed)
                
            wav = model.generate_speech(text, encoded_prompt, **gen_kwargs)
            # Audio sample array conversion
            audio_data = wav[0].numpy() if wav.ndim > 1 else wav.numpy()
            sr = 48000
            
        duration = len(audio_data) / sr

        # Cancel checkpoint: if the user pressed Cancel while this block was
        # synthesizing, discard the result (nothing saved, nothing cached).
        if check_cancel(gen_token):
            print(f"[Python Server] Generation cancelled after synthesis ('{text[:30]}').", flush=True)
            return jsonify({"success": False, "cancelled": True, "error": "Generation cancelled by user"})

        # Write to file
        save_path = data.get("save_path", "")
        if save_path:
            os.makedirs(os.path.dirname(save_path), exist_ok=True)
            wav_path = save_path
        else:
            file_id = str(uuid.uuid4())
            wav_path = os.path.join(temp_dir, f"clip_{file_id}.wav")
            
        sf.write(wav_path, audio_data, sr, subtype='PCM_16')
        
        print(f"[Python Server] Generated WAV saved to {wav_path} (duration: {duration:.2f}s)", flush=True)

        # Transcribe audio for word-level timestamps
        words = []
        try:
            active_transcriber = None
            if model_type == "luxtts" and hasattr(model, "transcriber"):
                active_transcriber = model.transcriber
            else:
                global transcriber
                if transcriber is None:
                    trans_device = "cuda:0" if torch.cuda.is_available() else "cpu"
                    print(f"[Python Server] Loading local Whisper transcriber for Qwen3...", flush=True)
                    from transformers import pipeline
                    transcriber = pipeline("automatic-speech-recognition", model="openai/whisper-tiny", device=trans_device)
                active_transcriber = transcriber

            if active_transcriber is not None:
                transcription_result = active_transcriber(wav_path, return_timestamps="word")
                for chunk in transcription_result.get("chunks", []):
                    if check_cancel(gen_token):
                        break
                    ts = chunk.get("timestamp")
                    if ts is not None and ts[0] is not None and ts[1] is not None:
                        words.append({
                            "text": chunk.get("text", "").strip(),
                            "start": float(ts[0]),
                            "end": float(ts[1])
                        })
                print(f"[Python Server] Transcribed {len(words)} word timestamps.", flush=True)
        except Exception as trans_err:
            traceback.print_exc()
            print(f"[Python Server] Failed to transcribe word timestamps: {str(trans_err)}", flush=True)

        if check_cancel(gen_token):
            print(f"[Python Server] Generation cancelled after transcription (discarding clip).", flush=True)
            return jsonify({"success": False, "cancelled": True, "error": "Generation cancelled by user"})

        # Write to Cache
        try:
            shutil.copyfile(wav_path, cache_wav_path)
            with open(cache_json_path, 'w', encoding='utf-8') as f:
                json.dump({
                    "duration": duration,
                    "words": words
                }, f, indent=2)
            print(f"[Python Server] Saved generated speech clip to cache under key {cache_key}", flush=True)
        except Exception as cache_write_err:
            print(f"[Python Server] Failed to write speech clip to cache: {str(cache_write_err)}", flush=True)

        return jsonify({
            "success": True,
            "wav_path": wav_path,
            "duration": duration,
            "words": words,
            **resp_extra
        })
        
    except Exception as e:
        traceback.print_exc()
        print(f"[Python Server] Voice clone failed: {str(e)}", flush=True)
        return jsonify({"success": False, "error": str(e)}), 500
    finally:
        dec_busy()

@app.route("/concatenate", methods=["POST"])
def concatenate_voices():
    try:
        data = request.json or {}
        wav_paths = data.get("wav_paths", [])
        pause_duration = float(data.get("pause_duration", 0.3))
        
        if not wav_paths:
            return jsonify({"success": False, "error": "No wav paths provided"}), 400
            
        print(f"[Python Server] Concatenating {len(wav_paths)} audio files with {pause_duration}s pause...", flush=True)
        
        combined_audio = []
        target_sr = None
        
        for path in wav_paths:
            if not os.path.exists(path):
                print(f"[Python Server] Warning: file not found: {path}", flush=True)
                continue
                
            audio_data, sr = sf.read(path)
            if target_sr is None:
                target_sr = sr
            
            # Ensure 1D mono audio array for consistent concatenation
            if hasattr(audio_data, "ndim") and audio_data.ndim > 1:
                audio_data = np.mean(audio_data, axis=1)
            
            combined_audio.append(audio_data)
            
            # Add silence between files
            if pause_duration > 0:
                silence = np.zeros(int(target_sr * pause_duration))
                combined_audio.append(silence)
                
        # Remove trailing silence if added
        if len(combined_audio) > 0 and pause_duration > 0:
            combined_audio.pop()
            
        if not combined_audio:
            return jsonify({"success": False, "error": "No valid audio data was loaded"}), 400
            
        concatenated = np.concatenate(combined_audio)
        total_duration = len(concatenated) / target_sr
        
        # Save master WAV in dist/
        master_path = os.path.join(project_dir, "dist", f"voiceover_{int(time.time())}.wav")
        sf.write(master_path, concatenated, target_sr, subtype='PCM_16')
        
        # Clean up temporary voice files
        for path in wav_paths:
            try:
                if os.path.exists(path) and "voice_temp" in path:
                    os.remove(path)
            except Exception as clean_err:
                print(f"[Python Server] Failed to clean up temp file {path}: {str(clean_err)}", flush=True)
                
        print(f"[Python Server] Concatenation successful. Master saved to {master_path} (duration: {total_duration:.2f}s)", flush=True)
        return jsonify({
            "success": True,
            "output_path": master_path,
            "duration": total_duration
        })
        
    except Exception as e:
        print(f"[Python Server] Concatenation failed: {str(e)}", flush=True)
        return jsonify({"success": False, "error": str(e)}), 500

if __name__ == "__main__":
    # Start server on local port 5555
    print("[Python Server] Starting Flask Voice Cloning Server on port 5555...", flush=True)
    threading.Thread(target=_warmup_background, daemon=True).start()
    app.run(host="127.0.0.1", port=5555, debug=False, threaded=True)
