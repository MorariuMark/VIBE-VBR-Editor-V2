@echo off
setlocal enabledelayedexpansion

cd /d "%~dp0"
echo ===================================================
echo   Installing Voice Cloning Environment (Qwen3-TTS)
echo ===================================================
echo.
echo Installing only inside the project folder...
echo.

:: 1. Create Virtual Environment if not exists
if not exist ".venv" (
    echo [1/4] Creating virtual environment venv...
    python -m venv .venv
    if errorlevel 1 (
        echo [ERROR] Failed to create virtual environment. Please check your Python installation.
        pause
        exit /b 1
    )
) else (
    echo [1/4] Virtual environment venv already exists.
)

:: 2. Activate Virtual Environment
echo [2/4] Activating virtual environment...
call .venv\Scripts\activate

:: 3. Upgrade pip
echo Upgrading pip...
python -m pip install --upgrade pip

:: 4. Install CUDA-enabled PyTorch & Torchaudio
echo [3/4] Installing PyTorch & Torchaudio with GPU (CUDA 12.1) support...
pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu121
if errorlevel 1 (
    echo [ERROR] Failed to install PyTorch/Torchaudio. Retrying with default index...
    pip install torch torchaudio
)

:: 5. Install Qwen3-TTS and Flask Server requirements
echo [4/6] Installing qwen-tts, flask, soundfile, and dependencies...
pip install -U qwen-tts
pip install flask soundfile numpy requests
if errorlevel 1 (
    echo [ERROR] Failed to install Qwen-TTS/Flask dependencies.
    pause
    exit /b 1
)

:: 6. Install LuxTTS dependencies
echo Installing LuxTTS model dependencies...
pip install -r LuxTTS/requirements.txt
if errorlevel 1 (
    echo [ERROR] Failed to install LuxTTS dependencies.
    pause
    exit /b 1
)

:: 7. Download portable CUDA toolkit into the project (tools\cuda) for the S2 engine
if exist "tools\cuda\bin\nvcc.exe" (
    echo [5/6] CUDA toolkit already installed locally at tools\cuda. Skipping.
) else (
    echo [5/6] Downloading portable CUDA 12.9 toolkit into tools\cuda ^(fully local, no admin, ~700 MB^)...
    if not exist "tools\cuda_download" mkdir "tools\cuda_download"
    set "CUDA_BASE=https://developer.download.nvidia.com/compute/cuda/redist"
    curl -L --retry 5 -o "tools\cuda_download\nvcc.zip"       "!CUDA_BASE!/cuda_nvcc/windows-x86_64/cuda_nvcc-windows-x86_64-12.9.86-archive.zip"      || goto cuda_dl_fail
    curl -L --retry 5 -o "tools\cuda_download\cudart.zip"     "!CUDA_BASE!/cuda_cudart/windows-x86_64/cuda_cudart-windows-x86_64-12.9.79-archive.zip"   || goto cuda_dl_fail
    curl -L --retry 5 -o "tools\cuda_download\cublas.zip"     "!CUDA_BASE!/libcublas/windows-x86_64/libcublas-windows-x86_64-12.9.1.4-archive.zip"      || goto cuda_dl_fail
    curl -L --retry 5 -o "tools\cuda_download\cccl.zip"       "!CUDA_BASE!/cuda_cccl/windows-x86_64/cuda_cccl-windows-x86_64-12.9.27-archive.zip"      || goto cuda_dl_fail
    if not exist "tools\cuda" mkdir "tools\cuda"
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-ChildItem 'tools\cuda_download\*.zip' | ForEach-Object { $tmp = Join-Path $env:TEMP ('vibe_cuda_' + $_.BaseName); if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }; Expand-Archive -LiteralPath $_.FullName -DestinationPath $tmp -Force; Get-ChildItem $tmp -Directory | ForEach-Object { Copy-Item (Join-Path $_.FullName '*') 'tools\cuda' -Recurse -Force } }; Get-ChildItem 'tools\cuda_download' -Filter *.zip | Remove-Item -Force"
    if errorlevel 1 goto cuda_dl_fail
    if not exist "tools\cuda\bin\nvcc.exe" goto cuda_dl_fail
    echo CUDA toolkit installed locally: tools\cuda
)

:: 8. Build the CUDA-enabled S2 engine (s2.exe) into models\s2pro
if exist "s2.cpp\build-cuda\s2.exe" (
    echo [6/6] CUDA-enabled S2 engine already built. Skipping rebuild.
) else (
    if exist "tools\cuda\bin\nvcc.exe" (
        echo [6/6] Building CUDA-enabled S2 engine ^(first build takes ~10-20 min^)...
        call "%~dp0build_s2_cuda.bat"
        if errorlevel 1 (
            echo [WARNING] S2 GPU engine build failed. S2 Pro will fall back to CPU-only mode.
        )
    ) else (
        echo [6/6] Skipping S2 GPU engine build ^(no CUDA toolkit^). S2 Pro will be CPU-only.
    )
)

:: 9. Setup local folders
if not exist "presets" mkdir presets
if not exist "assets\default_voices" mkdir assets\default_voices
if not exist ".hf_cache" mkdir .hf_cache

echo.
echo ===================================================
echo   Installation Completed Successfully!
echo ===================================================
echo   Virtual Environment: .venv
echo   HF cache location:   .hf_cache (fully local)
echo   CUDA toolkit:        tools\cuda (fully local)
echo   S2 GPU engine:       models\s2pro\s2.exe
echo ===================================================
echo.
pause
exit /b 0

:cuda_dl_fail
echo [ERROR] Failed to download/extract the CUDA toolkit into tools\cuda.
echo         Check your internet connection and retry, or download CUDA 12.9+
echo         manually and place "tools\cuda\bin\nvcc.exe".
pause
exit /b 1
