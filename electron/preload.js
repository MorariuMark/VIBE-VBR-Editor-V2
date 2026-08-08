const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Window controls
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),

  // File operations
  openFileDialog: (options) => ipcRenderer.invoke('open-file-dialog', options),
  openFolderDialog: (options) => ipcRenderer.invoke('open-folder-dialog', options),
  saveFileDialog: (options) => ipcRenderer.invoke('save-file-dialog', options),
  readFile: (filePath) => ipcRenderer.invoke('read-file', filePath),
  readFileBuffer: (filePath) => ipcRenderer.invoke('read-file-buffer', filePath),
  getFileInfo: (filePath) => ipcRenderer.invoke('get-file-info', filePath),

  // Export
  exportVideo: (config) => ipcRenderer.invoke('export-video', config),
  onExportProgress: (callback) => ipcRenderer.on('export-progress', (event, data) => callback(data)),
  removeExportProgress: () => ipcRenderer.removeAllListeners('export-progress'),
  startFrameExport: (config) => ipcRenderer.invoke('start-frame-export', config),
  sendFrame: (buffer) => ipcRenderer.invoke('send-frame', buffer),
  endFrameExport: () => ipcRenderer.invoke('end-frame-export'),
  killExport: () => ipcRenderer.invoke('kill-export'),

  // Video optimization (GOP transcoding)
  optimizeVideo: (config) => ipcRenderer.invoke('optimize-video', config),
  onOptimizeProgress: (callback) => ipcRenderer.on('optimize-progress', (event, data) => callback(data)),
  removeOptimizeProgress: () => ipcRenderer.removeAllListeners('optimize-progress'),

  // GPU Settings
  setGPUAcceleration: (enabled) => ipcRenderer.invoke('set-gpu-acceleration', enabled),
  getGPUAcceleration: () => ipcRenderer.invoke('get-gpu-acceleration'),
  detectGpuCodecs: () => ipcRenderer.invoke('detect-gpu-codecs'),

  // File system utilities
  checkFileExists: (filePath) => ipcRenderer.invoke('check-file-exists', filePath),

  // Voice Cloning
  openVoiceCloneWindow: () => ipcRenderer.send('open-voice-clone-window'),
  setActiveProjectState: (state) => ipcRenderer.invoke('set-active-project-state', state),
  getActiveProjectState: () => ipcRenderer.invoke('get-active-project-state'),
  applyTimelineVoices: (config) => ipcRenderer.invoke('apply-timeline-voices', config),
  onTimelineVoicesUpdated: (callback) => ipcRenderer.on('timeline-voices-updated', (event, data) => callback(data)),
  removeTimelineVoicesUpdated: () => ipcRenderer.removeAllListeners('timeline-voices-updated'),
  onProjectStateUpdated: (callback) => ipcRenderer.on('project-state-updated', (event, data) => callback(data)),
  removeProjectStateUpdated: () => ipcRenderer.removeAllListeners('project-state-updated'),
  saveVoicePreset: (preset) => ipcRenderer.invoke('save-voice-preset', preset),
  loadVoicePresets: () => ipcRenderer.invoke('load-voice-presets'),
  saveCharacterPreset: (preset) => ipcRenderer.invoke('save-character-preset', preset),
  loadCharacterPresets: () => ipcRenderer.invoke('load-character-presets'),
  deleteCharacterPreset: (presetName) => ipcRenderer.invoke('delete-character-preset', presetName),
  saveMediaPreset: (preset) => ipcRenderer.invoke('save-media-preset', preset),
  loadMediaPresets: () => ipcRenderer.invoke('load-media-presets'),
  deleteMediaPreset: (presetId) => ipcRenderer.invoke('delete-media-preset', presetId),
  getProjectPath: () => ipcRenderer.invoke('get-project-path'),
  getDownloadsPath: () => ipcRenderer.invoke('get-downloads-path'),
  listDefaultVoices: () => ipcRenderer.invoke('list-default-voices'),
  copyFile: (src, dest) => ipcRenderer.invoke('copy-file', { src, dest }),
  mixAudioClips: (config) => ipcRenderer.invoke('mix-audio-clips', config),
  deleteFile: (filePath) => ipcRenderer.invoke('delete-file', filePath),

  // Settings Window
  openSettingsWindow: () => ipcRenderer.send('open-settings-window'),
  setActiveSettingsState: (state) => ipcRenderer.invoke('set-active-settings-state', state),
  getActiveSettingsState: () => ipcRenderer.invoke('get-active-settings-state'),
  applyProjectSettings: (config) => ipcRenderer.invoke('apply-project-settings', config),
  onProjectSettingsUpdated: (callback) => ipcRenderer.on('project-settings-updated', (event, data) => callback(data)),
  removeProjectSettingsUpdated: () => ipcRenderer.removeAllListeners('project-settings-updated'),

  // Graphics Creator Window
  openGraphicsCreatorWindow: () => ipcRenderer.send('open-graphics-creator-window'),
  addMediaToProject: (mediaItem) => ipcRenderer.invoke('add-media-to-project', mediaItem),
  onMediaItemAdded: (callback) => ipcRenderer.on('media-item-added', (event, data) => callback(data)),
  removeMediaItemAdded: () => ipcRenderer.removeAllListeners('media-item-added'),
});

