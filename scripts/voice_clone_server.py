import os
import sys
import uuid
import time
import gc
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
    import torch
    cuda_avail = torch.cuda.is_available()
    return jsonify({
        "status": "active",
        "cuda_available": cuda_avail,
        "model_loaded": model is not None or model_type == "s2pro",
        "model_type": model_type,
        "gpu_name": torch.cuda.get_device_name(0) if cuda_avail else "CPU",
        "vram_total": torch.cuda.get_device_properties(0).total_memory / (1024**3) if cuda_avail else 0
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
        
        if model is not None and model_type == requested_type:
            return jsonify({"success": True, "message": f"Model {requested_type} already loaded"})
            
        if model is not None:
            print(f"[Python Server] Unloading existing {model_type} model to switch...", flush=True)
            del model
            model = None
            model_type = None
            gc.collect()
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
                
        device = "cuda:0" if torch.cuda.is_available() else "cpu"
        
        if requested_type in ["qwen3tts_0.6b", "qwen3tts_1.7b"]:
            print(f"[Python Server] Loading Qwen3-TTS {requested_type} model on {device}...", flush=True)
            from qwen_tts import Qwen3TTSModel
            dtype = torch.float32
            
            local_path = os.path.join(project_dir, "models", "qwen3tts" if requested_type == "qwen3tts_0.6b" else "qwen3tts_1.7b")
            if os.path.exists(os.path.join(local_path, "model.safetensors")):
                model_id_or_path = local_path
                print(f"[Python Server] Loading Qwen3-TTS from local folder: {local_path}", flush=True)
            else:
                model_id_or_path = "Qwen/Qwen3-TTS-12Hz-0.6B-Base" if requested_type == "qwen3tts_0.6b" else "Qwen/Qwen3-TTS-12Hz-1.7B-Base"
                print(f"[Python Server] Loading Qwen3-TTS from Hugging Face Hub: {model_id_or_path}", flush=True)
                
            model = Qwen3TTSModel.from_pretrained(
                model_id_or_path,
                device_map=device,
                dtype=dtype,
                attn_implementation="eager"
            )
            model_type = requested_type
            print(f"[Python Server] Qwen3-TTS {requested_type} model loaded successfully.", flush=True)
        elif requested_type == "s2pro":
            # S2 Pro runs through the s2.cpp engine (per-invocation CLI); no
            # persistent model is kept in memory. "Load" validates the engine.
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
        else: # default: luxtts
            lux_device = "cuda" if torch.cuda.is_available() else "cpu"
            print(f"[Python Server] Loading LuxTTS model on {lux_device}...", flush=True)
            from zipvoice.luxvoice import LuxTTS
            
            local_path = os.path.join(project_dir, "models", "luxtts")
            if os.path.exists(os.path.join(local_path, "model.pt")):
                print(f"[Python Server] Loading LuxTTS from local folder: {local_path}", flush=True)
                model = LuxTTS(model_path=local_path, device=lux_device)
            else:
                print("[Python Server] Loading LuxTTS from Hugging Face Hub snapshot...", flush=True)
                model = LuxTTS(device=lux_device)
                
            model_type = "luxtts"
            print("[Python Server] LuxTTS model loaded successfully.", flush=True)
            
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

@app.route("/clone", methods=["POST"])
def clone_voice():
    global model, model_type
    
    data = request.json or {}
    requested_model = data.get("model_name")
    if requested_model == "s2pro":
        model_type = "s2pro"
    
    # Auto-load if not loaded (torch models only; s2pro is stateless per-invocation)
    if model is None and model_type != "s2pro":
        try:
            import torch
            lux_device = "cuda" if torch.cuda.is_available() else "cpu"
            print(f"[Python Server] Model not loaded. Auto-loading default LuxTTS model...", flush=True)
            from zipvoice.luxvoice import LuxTTS
            model = LuxTTS(device=lux_device)
            model_type = "luxtts"
        except Exception as load_err:
            return jsonify({"success": False, "error": f"Model not loaded and auto-load failed: {str(load_err)}"}), 500
            
    try:
        import torch
        data = request.json or {}
        text = data.get("text", "")
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
            
            # Backend: explicit user choice, else CUDA when available, else CPU.
            s2_backend = data.get("s2_backend", "auto")
            if s2_backend == "cuda":
                cmd += ["--cuda", "0"]
            elif s2_backend == "vulkan":
                cmd += ["--vulkan", "0"]
            elif s2_backend != "cpu" and torch.cuda.is_available():
                cmd += ["--cuda", "0"]
            
            if temperature is not None:
                cmd += ["--temperature", str(float(temperature))]
            if data.get("top_p") is not None:
                cmd += ["--top-p", str(float(data["top_p"]))]
            if data.get("top_k") is not None:
                cmd += ["--top-k", str(int(data["top_k"]))]
            if data.get("max_tokens") is not None:
                cmd += ["--max-tokens", str(int(data["max_tokens"]))]
            gpu_layers = data.get("gpu_layers")
            if gpu_layers is not None and float(gpu_layers) >= 0:
                cmd += ["--gpu-layers", str(int(float(gpu_layers)))]
            if data.get("codec_cpu"):
                cmd += ["--codec-cpu"]
            
            print(f"[Python Server] Running s2.cpp: {' '.join(cmd)}", flush=True)
            proc_flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
            proc = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=900,
                creationflags=proc_flags,
            )
            if proc.returncode != 0:
                detail = (proc.stderr or proc.stdout or "").strip()
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
            "words": words
        })
        
    except Exception as e:
        traceback.print_exc()
        print(f"[Python Server] Voice clone failed: {str(e)}", flush=True)
        return jsonify({"success": False, "error": str(e)}), 500

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
    print(f"[Python Server] Auto-detected models: {json.dumps(scan_installed_models(), indent=2)}", flush=True)
    app.run(host="127.0.0.1", port=5555, debug=False, threaded=True)
