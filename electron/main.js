const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, spawnSync } = require('child_process');

// ─── Single home base: EVERYTHING lives inside the app's own folder.
// Redirect Electron's userData (settings, projects, caches) so nothing is
// ever written to %APPDATA% / C: drive. All data goes to <APP_ROOT>/userData.
let APP_ROOT;
try {
  if (app.isPackaged) {
    // Portable app installed inside the project folder:
    // <APP_ROOT>/VIBE-BR-Video Editor/VIBE-BR-Video Editor.exe
    const exeDir = path.dirname(app.getPath('exe'));
    const parent = path.dirname(exeDir);
    APP_ROOT = (fs.existsSync(path.join(parent, 'package.json')) || fs.existsSync(path.join(parent, '.venv')))
      ? parent
      : exeDir;
  } else {
    // Dev mode: main.js lives in <project>/electron/ -> root is one level up
    APP_ROOT = path.join(__dirname, '..');
  }
  app.setPath('userData', path.join(APP_ROOT, 'userData'));
  console.log(`[Main] App root: ${APP_ROOT} | userData: ${app.getPath('userData')}`);
} catch (e) {
  console.error('[Main] Failed to redirect userData:', e);
}

// Force dedicated GPU and ignore GPU blocklists
app.commandLine.appendSwitch('force_high_performance_gpu');
app.commandLine.appendSwitch('ignore-gpu-blocklist');

let useGPU = true;
try {
  const userDataPath = app.getPath('userData');
  const settingsFile = path.join(userDataPath, 'settings.json');
  if (fs.existsSync(settingsFile)) {
    const data = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
    if (data.hasOwnProperty('gpuAcceleration')) {
      useGPU = !!data.gpuAcceleration;
    }
  }
} catch (e) {
  console.error("Failed to read settings.json at startup:", e);
}

if (!useGPU) {
  console.log("[Main] GPU hardware acceleration disabled by settings.");
  app.disableHardwareAcceleration();
} else {
  console.log("[Main] GPU hardware acceleration enabled by settings.");
}

function getFFmpegPath() {
  const isWin = process.platform === 'win32';
  const userProfile = process.env.USERPROFILE || process.env.HOME || '';
  
  const ffmpegPaths = [
    // 1. Local bin folder (project-specific)
    path.join(__dirname, '..', 'bin', isWin ? 'ffmpeg.exe' : 'ffmpeg'),
    path.join(__dirname, '..', 'bin', 'ffmpeg'),

    // 2. Linux system paths
    '/usr/bin/ffmpeg',
    '/usr/local/bin/ffmpeg',
    '/snap/bin/ffmpeg',

    // 3. Windows environment fallbacks
    'E:\\pinokio_home\\bin\\miniconda\\Library\\bin\\ffmpeg.exe',
    'E:\\pinokio_home\\bin\\ffmpeg-env\\Library\\bin\\ffmpeg.exe',
    path.join(userProfile, 'pinokio', 'bin', 'miniconda', 'Library', 'bin', 'ffmpeg.exe'),
    path.join(userProfile, 'pinokio', 'bin', 'ffmpeg-env', 'Library', 'bin', 'ffmpeg.exe'),
    'C:\\pinokio_home\\bin\\miniconda\\Library\\bin\\ffmpeg.exe',
    'C:\\pinokio_home\\bin\\ffmpeg-env\\Library\\bin\\ffmpeg.exe',
    path.join(userProfile, 'miniconda3', 'Library', 'bin', 'ffmpeg.exe'),
    path.join(userProfile, 'anaconda3', 'Library', 'bin', 'ffmpeg.exe'),
    'C:\\miniconda3\\Library\\bin\\ffmpeg.exe',
    'E:\\miniconda3\\Library\\bin\\ffmpeg.exe',
  ];

  if (isWin) {
    const localAppData = process.env.LOCALAPPDATA || path.join(userProfile, 'AppData', 'Local');
    const wingetFolder = path.join(localAppData, 'Microsoft', 'WinGet', 'Packages');
    if (fs.existsSync(wingetFolder)) {
      try {
        const pkgs = fs.readdirSync(wingetFolder);
        for (const pkg of pkgs) {
          if (pkg.toLowerCase().includes('ffmpeg')) {
            const pkgPath = path.join(wingetFolder, pkg);
            const scanDirs = [pkgPath, path.join(pkgPath, 'bin')];
            try {
              const subdirs = fs.readdirSync(pkgPath);
              for (const sub of subdirs) {
                scanDirs.push(path.join(pkgPath, sub, 'bin'));
                scanDirs.push(path.join(pkgPath, sub));
              }
            } catch (e) {}
            
            for (const dir of scanDirs) {
              const exe = path.join(dir, 'ffmpeg.exe');
              if (fs.existsSync(exe)) {
                ffmpegPaths.push(exe);
              }
            }
          }
        }
      } catch (err) {
        console.error("Error scanning WinGet FFmpeg:", err);
      }
    }
  }

  // Fall back to system command
  ffmpegPaths.push('ffmpeg');

  for (const p of ffmpegPaths) {
    if (p === 'ffmpeg' || fs.existsSync(p)) {
      console.log("[Main] Resolved FFmpeg path:", p);
      return p;
    }
  }
  return 'ffmpeg';
}

let mainWindow;
const isDev = !app.isPackaged;

// Single instance lock: focus the existing window instead of spawning a second app
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

function cleanTemporaryArtifacts() {
  try {
    const distPath = path.join(__dirname, '..', 'dist');
    if (!fs.existsSync(distPath)) return;

    // 1. Clean temp_mix_*.wav files in dist
    const files = fs.readdirSync(distPath);
    files.forEach(file => {
      if (file.startsWith('temp_mix_') && file.endsWith('.wav')) {
        const filePath = path.join(distPath, file);
        fs.unlinkSync(filePath);
      }
    });

    // 2. Clean generated session voices in dist/voices
    const voicesPath = path.join(distPath, 'voices');
    if (fs.existsSync(voicesPath)) {
      const dirs = fs.readdirSync(voicesPath);
      dirs.forEach(dir => {
        const dirPath = path.join(voicesPath, dir);
        if (fs.statSync(dirPath).isDirectory()) {
          fs.rmSync(dirPath, { recursive: true, force: true });
        }
      });
    }
    console.log('[Main] Startup temporary files cleanup complete.');
  } catch (err) {
    console.error('[Main] Failed to clean temporary artifacts on launch:', err);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1200,
    minHeight: 800,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#0a0a0f',
    icon: path.join(__dirname, '..', 'assets', 'icon.ico'),
    fullscreen: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false,
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.maximize();
    mainWindow.show();
  });

  // Deny navigation away from the app and window.open popups
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const allowed = isDev ? url.startsWith('http://localhost:5173') : url.startsWith('file://');
    if (!allowed) event.preventDefault();
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    console.log(`[Renderer Console] [Level ${level}] ${message} (${sourceId}:${line})`);
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  cleanTemporaryArtifacts();
  createWindow();
  startPythonServer();
});

app.on('quit', () => {
  stopPythonServer();
  killAllFFmpegProcesses();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ─── IPC Handlers ───────────────────────────────────────────

// Window controls
ipcMain.on('window-minimize', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  win?.minimize();
});
ipcMain.on('window-maximize', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win?.isMaximized()) win.unmaximize();
  else win?.maximize();
});
ipcMain.on('window-close', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  win?.close();
});

// GPU Settings
ipcMain.handle('set-gpu-acceleration', async (event, enabled) => {
  try {
    const userDataPath = app.getPath('userData');
    const settingsFile = path.join(userDataPath, 'settings.json');
    let settings = {};
    if (fs.existsSync(settingsFile)) {
      settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
    }
    settings.gpuAcceleration = enabled;
    fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2), 'utf8');
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('get-gpu-acceleration', async () => {
  try {
    const userDataPath = app.getPath('userData');
    const settingsFile = path.join(userDataPath, 'settings.json');
    if (fs.existsSync(settingsFile)) {
      const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
      if (settings.hasOwnProperty('gpuAcceleration')) {
        return !!settings.gpuAcceleration;
      }
    }
  } catch (err) {}
  return true;
});

ipcMain.handle('detect-gpu-codecs', async () => {
  return new Promise((resolve) => {
    const ffmpegPath = getFFmpegPath();
    const { execFile } = require('child_process');
    execFile(ffmpegPath, ['-encoders'], (error, stdout, stderr) => {
      const codecs = {
        h264_nvenc: false,
        h264_amf: false,
        h264_qsv: false,
      };
      if (error) {
        console.error('[Main] Failed to detect GPU codecs:', error);
        resolve(codecs);
        return;
      }
      const output = stdout + stderr;
      codecs.h264_nvenc = output.includes('h264_nvenc');
      codecs.h264_amf = output.includes('h264_amf');
      codecs.h264_qsv = output.includes('h264_qsv');
      console.log('[Main] Detected GPU codecs:', codecs);
      resolve(codecs);
    });
  });
});

ipcMain.handle('check-file-exists', async (event, filePath) => {
  try {
    return fs.existsSync(filePath);
  } catch (err) {
    return false;
  }
});

// File dialog
ipcMain.handle('open-file-dialog', async (event, options) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: options?.filters || [
      { name: 'Media Files', extensions: ['mp4', 'webm', 'avi', 'mov', 'mkv', 'mp3', 'wav', 'ogg', 'png', 'jpg', 'jpeg', 'gif', 'webp'] },
    ],
  });
  return result.filePaths;
});

// Folder import dialog (scan folder for images)
const FOLDER_IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.avif'];

ipcMain.handle('open-folder-dialog', async (event, options) => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      title: options?.title || 'Select Image Folder',
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true, folderPath: null, files: [] };
    }

    const folderPath = result.filePaths[0];
    const entries = fs.readdirSync(folderPath, { withFileTypes: true });
    const files = entries
      .filter(e => e.isFile())
      .map(e => {
        const ext = path.extname(e.name).toLowerCase();
        return { name: e.name, path: path.join(folderPath, e.name), ext };
      })
      .filter(f => FOLDER_IMAGE_EXTENSIONS.includes(f.ext))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

    return { canceled: false, folderPath, files };
  } catch (err) {
    return { canceled: false, folderPath: null, files: [], error: err.message };
  }
});

// Save dialog
ipcMain.handle('save-file-dialog', async (event, options) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    filters: options?.filters || [
      { name: 'MP4 Video', extensions: ['mp4'] },
    ],
    defaultPath: options?.defaultPath || 'output.mp4',
  });
  return result.filePath;
});

// Read file as buffer (for media)
ipcMain.handle('read-file', async (event, filePath) => {
  try {
    const data = fs.readFileSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const mimeMap = {
      '.mp4': 'video/mp4', '.webm': 'video/webm', '.avi': 'video/x-msvideo',
      '.mov': 'video/quicktime', '.mkv': 'video/x-matroska',
      '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
      '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
      '.gif': 'image/gif', '.webp': 'image/webp',
    };
    return {
      data: data.toString('base64'),
      mime: mimeMap[ext] || 'application/octet-stream',
      name: path.basename(filePath),
      path: filePath,
      ext,
    };
  } catch (err) {
    return { error: err.message };
  }
});

// Read file as raw ArrayBuffer (for high-performance binary access)
ipcMain.handle('read-file-buffer', async (event, filePath) => {
  try {
    const data = fs.readFileSync(filePath);
    return new Uint8Array(data);
  } catch (err) {
    return { error: err.message };
  }
});

// Get file info
ipcMain.handle('get-file-info', async (event, filePath) => {
  try {
    const stats = fs.statSync(filePath);
    return {
      name: path.basename(filePath),
      path: filePath,
      size: stats.size,
      ext: path.extname(filePath).toLowerCase(),
    };
  } catch (err) {
    return { error: err.message };
  }
});

let exportProcess = null;
let exportStderr = '';
let exportResolve = null;
let auxiliaryProcesses = new Set();

function killAuxiliaryProcesses() {
  for (const proc of auxiliaryProcesses) {
    try { proc.kill('SIGKILL'); } catch (e) {}
  }
  auxiliaryProcesses.clear();
}

function killAllFFmpegProcesses() {
  if (exportProcess) {
    try { exportProcess.kill('SIGKILL'); } catch (e) {}
    exportProcess = null;
  }
  killAuxiliaryProcesses();
}

// FFmpeg export (Native FFmpeg Command)
ipcMain.handle('export-video', async (event, { args, outputPath, totalDuration }) => {
  return new Promise((resolve) => {
    const ffmpegPath = getFFmpegPath();

    console.log('[Main] Spawn FFmpeg (Native Export):', ffmpegPath, args.join(' '));
    exportProcess = spawn(ffmpegPath, args);
    let stderr = '';

    exportProcess.stderr.on('data', (data) => {
      const log = data.toString();
      stderr += log;

      let percent = null;
      if (totalDuration && totalDuration > 0) {
        const timeMatch = log.match(/time=(\d{2}):(\d{2}):(\d{2})\.(\d{2})/);
        if (timeMatch) {
          const hours = parseInt(timeMatch[1], 10);
          const minutes = parseInt(timeMatch[2], 10);
          const seconds = parseInt(timeMatch[3], 10);
          const ms = parseInt(timeMatch[4], 10);
          const currentTime = hours * 3600 + minutes * 60 + seconds + ms / 100;
          percent = Math.min(99, Math.round((currentTime / totalDuration) * 100));
        }
      }

      mainWindow?.webContents.send('export-progress', {
        percent,
        log
      });
    });

    exportProcess.on('close', (code) => {
      exportProcess = null;
      if (code === 0) {
        mainWindow?.webContents.send('export-progress', { percent: 100 });
        resolve({ success: true, outputPath });
      } else {
        resolve({ success: false, error: stderr });
      }
    });

    exportProcess.on('error', (err) => {
      exportProcess = null;
      resolve({ success: false, error: err.message });
    });
  });
});

// Optimize video for frame-by-frame seeking (transcode with GOP=1)
ipcMain.handle('optimize-video', async (event, { filePath, duration }) => {
  return new Promise((resolve) => {
    try {
      const dir = path.dirname(filePath);
      const ext = path.extname(filePath);
      const base = path.basename(filePath, ext);
      const outputPath = path.join(dir, `${base}_optimized.mp4`);

      const ffmpegPath = getFFmpegPath();
      const args = [
        '-y',
        '-i', filePath,
        '-c:v', 'libx264',
        '-g', '1',
        '-preset', 'superfast',
        '-crf', '18',
        '-c:a', 'aac',
        outputPath
      ];

      console.log('[Main] Optimizing video:', ffmpegPath, args.join(' '));
      const proc = spawn(ffmpegPath, args);
      auxiliaryProcesses.add(proc);
      let stderr = '';

      proc.stderr.on('data', (data) => {
        const log = data.toString();
        stderr += log;

        if (duration && duration > 0) {
          const timeMatch = log.match(/time=(\d{2}):(\d{2}):(\d{2})\.(\d{2})/);
          if (timeMatch) {
            const hours = parseInt(timeMatch[1], 10);
            const minutes = parseInt(timeMatch[2], 10);
            const seconds = parseInt(timeMatch[3], 10);
            const ms = parseInt(timeMatch[4], 10);
            const currentTime = hours * 3600 + minutes * 60 + seconds + ms / 100;
            const percent = Math.min(99, Math.round((currentTime / duration) * 100));
            mainWindow?.webContents.send('optimize-progress', { percent, filePath });
          }
        }
      });

      proc.on('close', (code) => {
        auxiliaryProcesses.delete(proc);
        if (code === 0) {
          mainWindow?.webContents.send('optimize-progress', { percent: 100, filePath });
          resolve({ success: true, outputPath });
        } else {
          resolve({ success: false, error: stderr });
        }
      });

      proc.on('error', (err) => {
        auxiliaryProcesses.delete(proc);
        resolve({ success: false, error: err.message });
      });
    } catch (err) {
      resolve({ success: false, error: err.message });
    }
  });
});

ipcMain.handle('start-frame-export', async (event, { settings, audioPath, backgroundVideoPath, totalDuration, outputPath }) => {
  return new Promise((resolve) => {
    const ffmpegPath = getFFmpegPath();

    const width = settings.width || 1080;
    const height = settings.height || 1920;
    const fps = settings.fps || 60;
    const codec = settings.codec || 'libx264';
    const crf = settings.crf || 18;

    const isGPU = codec && codec !== 'libx264';
    const args = [
      '-y',
    ];

    if (isGPU) {
      args.push('-hwaccel', 'auto');
    }

    // Input 0: Background video (if provided, loop it infinitely)
    if (backgroundVideoPath) {
      args.push('-stream_loop', '-1', '-i', backgroundVideoPath);
    }

    // Input 1 (or 0 if no bg video): Raw transparent video stream from stdin
    args.push(
      '-f', 'rawvideo',
      '-pix_fmt', 'rgba',
      '-s', `${width}x${height}`,
      '-r', String(fps),
      '-i', '-'
    );

    // Input 2 (or 1 if no bg video): Audio path
    if (audioPath) {
      args.push('-i', audioPath);
    }

    // Overlay transparent canvas on top of scaled/cropped background video
    if (backgroundVideoPath) {
      args.push(
        '-filter_complex',
        `[0:v]scale=${width}:${height}:force_original_aspect_ratio=increase,` +
        `crop=${width}:${height},setsar=1[bg];` +
        `[bg][1:v]overlay=format=auto[out]`,
        '-map', '[out]'
      );
    } else {
      args.push('-map', '0:v');
    }

    // Audio mapping
    if (audioPath) {
      const audioIndex = backgroundVideoPath ? 2 : 1;
      args.push('-map', `${audioIndex}:a`);
    }

    args.push(
      '-c:v', codec,
      '-pix_fmt', 'yuv420p',
      '-r', String(fps)
    );

    if (codec === 'libx264') {
      args.push('-preset', 'medium', '-crf', String(crf));
    } else if (codec === 'h264_nvenc') {
      args.push('-preset', 'p4', '-rc', 'vbr', '-cq', String(crf));
    } else if (codec === 'h264_amf') {
      args.push('-rc', 'cqp', '-qp_i', String(crf), '-qp_p', String(crf));
    } else if (codec === 'h264_qsv') {
      args.push('-global_quality', String(crf));
    }

    if (audioPath) {
      args.push('-c:a', 'aac', '-b:a', '192k');
    }

    if (totalDuration) {
      args.push('-t', String(totalDuration));
    }

    args.push('-shortest');
    args.push(outputPath);

    console.log('[Main] Spawn FFmpeg (Frame Stream):', ffmpegPath, args.join(' '));
    exportProcess = spawn(ffmpegPath, args);
    exportProcess.stdin.on('error', (err) => {
      console.warn('[Main] FFmpeg stdin write error ignored (write EOF):', err.message);
    });
    exportStderr = '';
    exportResolve = resolve;

    exportProcess.stderr.on('data', (data) => {
      exportStderr += data.toString();
      
      // Parse progress and send percent update if possible
      let percent = null;
      if (totalDuration && totalDuration > 0) {
        const log = data.toString();
        const timeMatch = log.match(/time=(\d{2}):(\d{2}):(\d{2})\.(\d{2})/);
        if (timeMatch) {
          const hours = parseInt(timeMatch[1], 10);
          const minutes = parseInt(timeMatch[2], 10);
          const seconds = parseInt(timeMatch[3], 10);
          const ms = parseInt(timeMatch[4], 10);
          const currentTime = hours * 3600 + minutes * 60 + seconds + ms / 100;
          percent = Math.min(99, Math.round((currentTime / totalDuration) * 100));
        }
      }
      
      mainWindow?.webContents.send('export-progress', { percent, log: data.toString() });
    });

    exportProcess.on('close', (code) => {
      if (code === 0) {
        mainWindow?.webContents.send('export-progress', { percent: 100 });
        exportResolve({ success: true, outputPath });
      } else {
        exportResolve({ success: false, error: exportStderr });
      }
      exportProcess = null;
    });

    exportProcess.on('error', (err) => {
      exportResolve({ success: false, error: err.message });
      exportProcess = null;
    });
  });
});

ipcMain.handle('send-frame', async (event, buffer) => {
  return new Promise((resolve) => {
    if (exportProcess && exportProcess.stdin && exportProcess.stdin.writable) {
      try {
        exportProcess.stdin.write(Buffer.from(buffer), (err) => {
          resolve(!err);
        });
      } catch (err) {
        resolve(false);
      }
    } else {
      resolve(false);
    }
  });
});

ipcMain.handle('end-frame-export', async () => {
  return new Promise((resolve) => {
    if (exportProcess && exportProcess.stdin) {
      exportProcess.stdin.end(() => {
        resolve(true);
      });
    } else {
      resolve(false);
    }
  });
});

ipcMain.handle('kill-export', async () => {
  return new Promise((resolve) => {
    if (exportProcess) {
      try {
        console.log('[Main] Killing FFmpeg export process...');
        exportProcess.kill('SIGKILL');
        exportProcess = null;
        resolve({ success: true });
      } catch (err) {
        resolve({ success: false, error: err.message });
      }
    } else {
      // Also kill any auxiliary ffmpeg (optimize/mix) still running
      const hadAux = auxiliaryProcesses.size > 0;
      killAuxiliaryProcesses();
      if (!hadAux) {
        resolve({ success: false, error: 'No active export process' });
      } else {
        resolve({ success: true });
      }
    }
  });
});

// ─── Voice Cloning & Python Server Integration ───────────────

let pythonServerProcess = null;

function startPythonServer() {
  const isWin = process.platform === 'win32';
  const projectDir = APP_ROOT || path.join(__dirname, '..');
  const serverScript = path.join(projectDir, 'scripts', 'voice_clone_server.py');
  
  if (!fs.existsSync(serverScript)) {
    console.log(`[Main] voice_clone_server.py not found at ${serverScript}. Voice cloning will not be available.`);
    return;
  }

  // Fallback chain: project .venv -> bundled venv (resources) -> system python
  const candidates = [];
  if (isWin) {
    candidates.push(
      path.join(projectDir, '.venv', 'Scripts', 'python.exe'),
      path.join(process.resourcesPath || '', '.venv', 'Scripts', 'python.exe'),
      'python.exe',
      'py.exe'
    );
  } else {
    candidates.push(
      path.join(projectDir, '.venv', 'bin', 'python'),
      path.join(process.resourcesPath || '', '.venv', 'bin', 'python'),
      'python3',
      'python'
    );
  }

  let pythonPath = null;
  for (const cand of candidates) {
    if (cand.includes(path.sep) && path.isAbsolute(cand) && fs.existsSync(cand)) {
      pythonPath = cand;
      break;
    }
    // On PATH
    try {
      const probe = spawnSync(cand, ['-c', 'import flask, torch; print("ok")'], { timeout: 15000, windowsHide: true, encoding: 'utf8' });
      if (probe.status === 0 && probe.stdout && probe.stdout.toString().trim() === 'ok') {
        pythonPath = cand;
        break;
      }
    } catch (e) {
      // try next candidate
    }
  }

  if (!pythonPath) {
    console.log('[Main] No Python with Flask+Torch found. Voice cloning will not be available until the TTS environment is installed (run install_voice_clone.bat).');
    return;
  }

  console.log(`[Main] Starting Python Voice Cloning server using: ${pythonPath}`);

  // Set project-local cache path
  const hfCachePath = path.join(projectDir, '.hf_cache');

  pythonServerProcess = spawn(pythonPath, [serverScript], {
    cwd: projectDir,
    env: {
      ...process.env,
      HF_HOME: hfCachePath
    }
  });

  pythonServerProcess.stdout.on('data', (data) => {
    console.log(`[Python Server stdout] ${data.toString().trim()}`);
  });

  pythonServerProcess.stderr.on('data', (data) => {
    console.error(`[Python Server stderr] ${data.toString().trim()}`);
  });

  pythonServerProcess.on('error', (err) => {
    console.error('[Main] Failed to start Python server:', err.message);
    pythonServerProcess = null;
  });

  pythonServerProcess.on('close', (code) => {
    console.log(`[Main] Python server exited with code ${code}`);
    pythonServerProcess = null;
  });
}

function stopPythonServer() {
  if (pythonServerProcess) {
    console.log('[Main] Stopping Python Voice Cloning server...');
    pythonServerProcess.kill('SIGTERM');
    pythonServerProcess = null;
  }
}

let voiceCloneWindow = null;
let settingsWindow = null;

function createSettingsWindow() {
  if (settingsWindow) {
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 480,
    height: 520,
    parent: mainWindow,
    modal: false,
    backgroundColor: '#0a0a0f',
    title: 'Project Settings',
    resizable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false,
    },
  });

  if (isDev) {
    settingsWindow.loadURL('http://localhost:5173/#/settings');
  } else {
    settingsWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), { hash: '/settings' });
  }

  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
}

function createVoiceCloneWindow() {
  if (voiceCloneWindow) {
    voiceCloneWindow.focus();
    return;
  }

  voiceCloneWindow = new BrowserWindow({
    width: 850,
    height: 750,
    parent: mainWindow,
    modal: false,
    backgroundColor: '#0a0a0f',
    title: 'Voice Cloning & TTS',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false,
    },
  });

  if (isDev) {
    voiceCloneWindow.loadURL('http://localhost:5173/#/voice-clone');
  } else {
    voiceCloneWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), { hash: '/voice-clone' });
  }

  voiceCloneWindow.on('closed', () => {
    voiceCloneWindow = null;
  });
}

let graphicsCreatorWindow = null;

function createGraphicsCreatorWindow() {
  graphicsCreatorWindow = new BrowserWindow({
    width: 1280,
    height: 850,
    parent: mainWindow,
    modal: false,
    autoHideMenuBar: true,
    title: 'Vector Graphics Studio',
    icon: path.join(__dirname, '..', 'assets', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false,
    },
  });

  if (isDev) {
    graphicsCreatorWindow.loadURL('http://localhost:5173/#/graphics-creator');
  } else {
    graphicsCreatorWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), { hash: '/graphics-creator' });
  }

  graphicsCreatorWindow.on('closed', () => {
    graphicsCreatorWindow = null;
  });
}

// IPC Triggers
ipcMain.on('open-voice-clone-window', () => {
  if (voiceCloneWindow) {
    voiceCloneWindow.focus();
    voiceCloneWindow.webContents.send('project-state-updated');
  } else {
    createVoiceCloneWindow();
  }
});

ipcMain.on('open-settings-window', () => {
  if (settingsWindow) {
    settingsWindow.focus();
  } else {
    createSettingsWindow();
  }
});

ipcMain.on('open-graphics-creator-window', () => {
  if (graphicsCreatorWindow) {
    graphicsCreatorWindow.focus();
  } else {
    createGraphicsCreatorWindow();
  }
});

let activeProjectState = null;
let activeSettingsState = null;

ipcMain.handle('set-active-settings-state', (event, state) => {
  activeSettingsState = state;
  return { success: true };
});

ipcMain.handle('get-active-settings-state', () => {
  return activeSettingsState;
});

ipcMain.handle('apply-project-settings', async (event, payload) => {
  if (mainWindow) {
    mainWindow.webContents.send('project-settings-updated', payload);
  }
  if (settingsWindow) {
    settingsWindow.close();
  }
  return { success: true };
});

ipcMain.handle('set-active-project-state', (event, state) => {
  activeProjectState = state;
  return { success: true };
});

ipcMain.handle('get-active-project-state', () => {
  return activeProjectState;
});

ipcMain.handle('add-media-to-project', async (event, mediaItem) => {
  if (mainWindow) {
    mainWindow.webContents.send('media-item-added', mediaItem);
    return { success: true };
  }
  return { success: false, error: 'Main window not active' };
});

ipcMain.handle('apply-timeline-voices', async (event, payload) => {
  if (mainWindow) {
    mainWindow.webContents.send('timeline-voices-updated', payload);
    return { success: true };
  }
  return { success: false, error: 'Main window not available' };
});

const presetsFilePath = path.join(__dirname, '..', 'presets', 'voice_presets.json');
const charPresetsFilePath = path.join(__dirname, '..', 'presets', 'character_presets.json');

ipcMain.handle('save-voice-preset', async (event, preset) => {
  try {
    const presetsDir = path.dirname(presetsFilePath);
    if (!fs.existsSync(presetsDir)) {
      fs.mkdirSync(presetsDir, { recursive: true });
    }
    let presets = [];
    if (fs.existsSync(presetsFilePath)) {
      presets = JSON.parse(fs.readFileSync(presetsFilePath, 'utf8'));
    }
    // Remove existing preset with same name
    presets = presets.filter(p => p.name.toLowerCase() !== preset.name.toLowerCase());
    presets.push(preset);
    fs.writeFileSync(presetsFilePath, JSON.stringify(presets, null, 2), 'utf8');
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('load-voice-presets', async () => {
  try {
    if (fs.existsSync(presetsFilePath)) {
      return JSON.parse(fs.readFileSync(presetsFilePath, 'utf8'));
    }
    return [];
  } catch (err) {
    console.error('Failed to load presets:', err);
    return [];
  }
});

ipcMain.handle('save-character-preset', async (event, preset) => {
  try {
    const presetsDir = path.dirname(charPresetsFilePath);
    if (!fs.existsSync(presetsDir)) {
      fs.mkdirSync(presetsDir, { recursive: true });
    }
    let presets = [];
    if (fs.existsSync(charPresetsFilePath)) {
      presets = JSON.parse(fs.readFileSync(charPresetsFilePath, 'utf8'));
    }
    presets = presets.filter(p => p.name.toLowerCase() !== preset.name.toLowerCase());
    presets.push(preset);
    fs.writeFileSync(charPresetsFilePath, JSON.stringify(presets, null, 2), 'utf8');
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('load-character-presets', async () => {
  try {
    if (fs.existsSync(charPresetsFilePath)) {
      return JSON.parse(fs.readFileSync(charPresetsFilePath, 'utf8'));
    }
    return [];
  } catch (err) {
    console.error('Failed to load character presets:', err);
    return [];
  }
});

ipcMain.handle('delete-character-preset', async (event, presetName) => {
  try {
    if (fs.existsSync(charPresetsFilePath)) {
      let presets = JSON.parse(fs.readFileSync(charPresetsFilePath, 'utf8'));
      presets = presets.filter(p => p.name.toLowerCase() !== presetName.toLowerCase());
      fs.writeFileSync(charPresetsFilePath, JSON.stringify(presets, null, 2), 'utf8');
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

const mediaPresetsDir = path.join(__dirname, '..', 'presets', 'media');
const mediaPresetsFilePath = path.join(mediaPresetsDir, 'media_presets.json');

ipcMain.handle('save-media-preset', async (event, { filePath, name, type, duration }) => {
  try {
    const destSubdir = type === 'video' ? 'videos' : type === 'image' ? 'photos' : type === 'audio' ? 'audio' : 'voices';
    const targetDir = path.join(mediaPresetsDir, destSubdir);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const ext = path.extname(filePath);
    const baseName = path.basename(filePath, ext).replace(/[^a-zA-Z0-9_-]/g, '_');
    let targetFileName = `${baseName}${ext}`;
    let targetPath = path.join(targetDir, targetFileName);

    // If filename exists, generate unique name
    let counter = 1;
    while (fs.existsSync(targetPath)) {
      targetFileName = `${baseName}_${counter}${ext}`;
      targetPath = path.join(targetDir, targetFileName);
      counter++;
    }

    // Copy file to target path
    fs.copyFileSync(filePath, targetPath);

    // Read index and add preset metadata
    let presets = [];
    if (fs.existsSync(mediaPresetsFilePath)) {
      presets = JSON.parse(fs.readFileSync(mediaPresetsFilePath, 'utf8'));
    }

    const newPreset = {
      id: `preset_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      name: name,
      type: type,
      ext: ext,
      path: targetPath,
      dataUrl: `file:///${targetPath.replace(/\\/g, '/')}`,
      duration: duration
    };

    presets.push(newPreset);
    fs.writeFileSync(mediaPresetsFilePath, JSON.stringify(presets, null, 2), 'utf8');

    return { success: true, preset: newPreset };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('load-media-presets', async () => {
  try {
    if (fs.existsSync(mediaPresetsFilePath)) {
      const presets = JSON.parse(fs.readFileSync(mediaPresetsFilePath, 'utf8'));
      // Only keep presets where the file actually exists
      const validPresets = presets.filter(p => fs.existsSync(p.path));
      if (validPresets.length !== presets.length) {
        fs.writeFileSync(mediaPresetsFilePath, JSON.stringify(validPresets, null, 2), 'utf8');
      }
      return validPresets;
    }
    return [];
  } catch (err) {
    console.error('Failed to load media presets:', err);
    return [];
  }
});

ipcMain.handle('delete-media-preset', async (event, presetId) => {
  try {
    if (fs.existsSync(mediaPresetsFilePath)) {
      let presets = JSON.parse(fs.readFileSync(mediaPresetsFilePath, 'utf8'));
      const preset = presets.find(p => p.id === presetId);
      if (preset) {
        if (fs.existsSync(preset.path)) {
          fs.unlinkSync(preset.path);
        }
        presets = presets.filter(p => p.id !== presetId);
        fs.writeFileSync(mediaPresetsFilePath, JSON.stringify(presets, null, 2), 'utf8');
      }
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('get-project-path', () => {
  return path.join(__dirname, '..');
});

ipcMain.handle('get-downloads-path', () => {
  const { app } = require('electron');
  return app.getPath('downloads');
});

ipcMain.handle('list-default-voices', async () => {
  try {
    const voicesDir = path.join(__dirname, '..', 'assets', 'default_voices');
    if (!fs.existsSync(voicesDir)) return [];
    const files = fs.readdirSync(voicesDir);
    const wavFiles = files.filter(f => f.toLowerCase().endsWith('.wav'));
    const result = [];
    for (const file of wavFiles) {
      const wavPath = path.join(voicesDir, file);
      const txPath = wavPath + '.txt';
      let transcript = '';
      if (fs.existsSync(txPath)) {
        transcript = fs.readFileSync(txPath, 'utf8').trim();
      }
      result.push({
        name: file.replace('_ref.wav', '').replace('.wav', ''),
        path: wavPath,
        transcript
      });
    }
    return result;
  } catch (err) {
    console.error('Failed to list default voices:', err);
    return [];
  }
});

ipcMain.handle('copy-file', async (event, { src, dest }) => {
  try {
    fs.copyFileSync(src, dest);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('mix-audio-clips', async (event, { clips, outputPath }) => {
  return new Promise((resolve) => {
    try {
      const ffmpegPath = getFFmpegPath();
      const args = ['-y'];
      
      clips.forEach(clip => {
        args.push('-i', clip.path);
      });
      
      const filterParts = [];
      const labels = [];
      clips.forEach((clip, idx) => {
        const delayMs = Math.round(clip.startTime * 1000);
        filterParts.push(`[${idx}:a]adelay=${delayMs}|${delayMs}[a${idx}]`);
        labels.push(`[a${idx}]`);
      });
      
      filterParts.push(`${labels.join('')}amix=inputs=${clips.length}:normalize=0[out]`);
      
      args.push('-filter_complex', filterParts.join(';'));
      args.push('-map', '[out]');
      args.push(outputPath);
      
      console.log('[Main] Mix audio clips command:', ffmpegPath, args.join(' '));
      const proc = spawn(ffmpegPath, args);
      auxiliaryProcesses.add(proc);
      let stderr = '';
      proc.stderr.on('data', (d) => { stderr += d.toString(); });
      proc.on('close', (code) => {
        auxiliaryProcesses.delete(proc);
        if (code === 0) {
          resolve({ success: true, outputPath });
        } else {
          resolve({ success: false, error: stderr });
        }
      });
      proc.on('error', (err) => {
        auxiliaryProcesses.delete(proc);
        resolve({ success: false, error: err.message });
      });
    } catch (err) {
      resolve({ success: false, error: err.message });
    }
  });
});

ipcMain.handle('delete-file', async (event, filePath) => {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

