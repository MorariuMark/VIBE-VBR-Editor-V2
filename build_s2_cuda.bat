@echo off
setlocal
cd /d "%~dp0"

echo ===================================================
echo   Building s2 engine with CUDA GPU support (S2_CUDA)
echo ===================================================
echo.

set "CUDA_ROOT=%~dp0tools\cuda"
if exist "%CUDA_ROOT%\bin\nvcc.exe" goto cuda_ok
echo [ERROR] CUDA toolkit not found at tools\cuda.
echo         Re-run install_voice_clone.bat so CUDA is installed locally,
echo         or place a CUDA 12.9+ portable toolkit into tools\cuda.
pause
exit /b 1

:cuda_ok
echo [1/5] Using local CUDA toolkit: %CUDA_ROOT%

set "VCVARS=C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
if exist "%VCVARS%" goto msvc_ok
set "VCVARS=C:\Program Files (x86)\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat"
if exist "%VCVARS%" goto msvc_ok
set "VCVARS=C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat"
if exist "%VCVARS%" goto msvc_ok
set "VCVARS=C:\Program Files\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
if exist "%VCVARS%" goto msvc_ok
echo [ERROR] Visual Studio 2022 Build Tools ^(MSVC^) not found.
echo         Install "Visual Studio 2022 Build Tools" with the C++ workload
echo         ("Desktop development with C++") to continue.
pause
exit /b 1

:msvc_ok
echo [2/5] Using MSVC environment: %VCVARS%
call "%VCVARS%"
if errorlevel 1 goto cfg_fail

set "CUDACXX=%CUDA_ROOT%\bin\nvcc.exe"
set "CUDA_PATH=%CUDA_ROOT%"

echo [3/5] Configuring CMake with S2_CUDA=ON (Ninja) ...
cmake -S s2.cpp -B s2.cpp\build-cuda -G Ninja -DS2_CUDA=ON -DS2_VULKAN=OFF -DCMAKE_BUILD_TYPE=Release -DCMAKE_CUDA_ARCHITECTURES=89 -DCUDAToolkit_ROOT="%CUDA_ROOT%"
if errorlevel 1 goto cfg_fail

echo [4/5] Building Release (this takes several minutes on first run)...
cmake --build s2.cpp\build-cuda --config Release --parallel 8
if errorlevel 1 goto build_fail

set "SRC=s2.cpp\build-cuda\bin\s2.exe"
if not exist "%SRC%" set "SRC=s2.cpp\build-cuda\s2.exe"
if not exist "%SRC%" goto missing_exe
echo [5/5] Built: %SRC%

if not exist "models\s2pro" mkdir "models\s2pro"
copy /y "%SRC%" "models\s2pro\s2.exe" >nul
if errorlevel 1 goto deploy_fail

:: Deploy ggml shared libraries next to the engine (required at runtime)
for %%D in (ggml.dll ggml-base.dll ggml-cpu.dll ggml-cuda.dll ggml-vulkan.dll) do (
    if exist "s2.cpp\build-cuda\bin\%%D" (
        copy /y "s2.cpp\build-cuda\bin\%%D" "models\s2pro\%%D" >nul
        if errorlevel 1 goto deploy_fail
    )
)

echo.
echo ===================================================
echo   Build complete! GPU-enabled engine deployed to:
echo     models\s2pro\s2.exe
echo   The TTS server will auto-detect CUDA on next launch.
echo ===================================================
echo.
pause
exit /b 0

:cfg_fail
echo [ERROR] CMake configuration failed.
pause
exit /b 1

:build_fail
echo [ERROR] Build failed.
pause
exit /b 1

:missing_exe
echo [ERROR] Could not locate built s2.exe.
pause
exit /b 1

:deploy_fail
echo [ERROR] Failed to deploy s2.exe into models\s2pro.
pause
exit /b 1