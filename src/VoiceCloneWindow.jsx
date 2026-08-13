import React, { useState, useEffect, useRef, useCallback } from 'react';

export default function VoiceCloneWindow() {
  const [serverOnline, setServerOnline] = useState(false);
  const [modelLoaded, setModelLoaded] = useState(false);
  const [serverStatus, setServerStatus] = useState('Checking...');
  const [gpuName, setGpuName] = useState('Detecting...');
  const [vramTotal, setVramTotal] = useState(null); // GB, null = unknown
  const [loadingModel, setLoadingModel] = useState(false);
  const [unloadingModel, setUnloadingModel] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [s2Caps, setS2Caps] = useState(null); // { cuda, vulkan } or null
  const cancelledRef = useRef(false);
  const fetchCtrlRef = useRef(null); // AbortController for in-flight generation request
  const [selectedModel, setSelectedModel] = useState('luxtts');
  const [autoUnload, setAutoUnload] = useState(false); // false = keep model in VRAM after generation
  const [modelInstalled, setModelInstalled] = useState({ luxtts: false, 'qwen3tts_0.6b': false, 'qwen3tts_1.7b': false, s2pro: false });
  const [modelsList, setModelsList] = useState([]); // auto-detected models from /list_models
  const [downloadingState, setDownloadingState] = useState({ downloading: false, model_name: null, progress: 0, error: null });
  const [showUninstallConfirm, setShowUninstallConfirm] = useState(null); // model id | null

  // S2 Pro engine settings (s2.cpp CLI)
  const [topP, setTopP] = useState(0.8);
  const [topK, setTopK] = useState(30);
  const [maxTokens, setMaxTokens] = useState(1024);
  const [gpuLayers, setGpuLayers] = useState(-1); // -1 = auto
  const [codecCpu, setCodecCpu] = useState(false);
  const [s2Backend, setS2Backend] = useState('auto'); // auto | cpu | cuda | vulkan

  // Redo mode states
  const [redoBlockId, setRedoBlockId] = useState(null);
  const [redoClipId, setRedoClipId] = useState(null);
  const [redoTrackId, setRedoTrackId] = useState(null);

  const MODEL_NAMES = {
    luxtts: 'LuxTTS 1.7B',
    'qwen3tts_0.6b': 'Qwen3-TTS 0.6B',
    'qwen3tts_1.7b': 'Qwen3-TTS 1.7B',
    s2pro: 'S2 Pro 5B (Q4_K_M)'
  };

  const applyModelDefaults = (modelId) => {
    if (modelId === 'luxtts') {
      setTemperature(0.5);
      setSpeed(1.0);
    } else if (modelId === 's2pro') {
      setTemperature(0.8);
      setTopP(0.8);
      setTopK(30);
      setMaxTokens(1024);
      setGpuLayers(-1);
      setCodecCpu(false);
      setS2Backend('auto');
    } else {
      setTemperature(0.0);
    }
  };

  const fetchModelInstalledStatus = async () => {
    try {
      const res = await fetch('http://127.0.0.1:5555/model_status');
      if (res.ok) {
        const data = await res.json();
        setModelInstalled(data);
      }
    } catch (e) {
      console.error("Error fetching model status", e);
    }
  };

  const fetchModelsList = async () => {
    try {
      const res = await fetch('http://127.0.0.1:5555/list_models');
      if (res.ok) {
        const data = await res.json();
        setModelsList(Array.isArray(data.models) ? data.models : []);
      }
    } catch (e) {
      console.error("Error fetching model list", e);
    }
  };
  const [splitPercent, setSplitPercent] = useState(60); // left panel % width
  const mainLayoutRef = useRef(null);
  const isDraggingRef = useRef(false);

  // Project state loaded from main process
  const [characters, setCharacters] = useState([]);
  const [dialogueBlocks, setDialogueBlocks] = useState([]);
  const [projectScriptText, setProjectScriptText] = useState('');

  // Default voices & Presets
  const [defaultVoices, setDefaultVoices] = useState([]);
  const [presets, setPresets] = useState([]);

  // Voice configuration per character ID
  // Map of characterId -> { type: 'default'|'preset'|'custom', refPath: '', refText: '', presetName: '' }
  const [voiceConfigs, setVoiceConfigs] = useState({});

  // Generation settings
  const [pauseDuration, setPauseDuration] = useState(0.3);
  const [temperature, setTemperature] = useState(0.5); // default for luxtts
  const [speed, setSpeed] = useState(1.0);
  const [generating, setGenerating] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [genLogs, setGenLogs] = useState([]);
  const [currentBlockIndex, setCurrentBlockIndex] = useState(-1);
  const [generationProgress, setGenerationProgress] = useState(0);

  // Audio Playback
  const [playingAudio, setPlayingAudio] = useState(null);
  const [playingBlobUrl, setPlayingBlobUrl] = useState(null);
  const [generatedResult, setGeneratedResult] = useState(null);
  const audioRef = useRef(new Audio());
  const logsEndRef = useRef(null);
  const [logCopied, setLogCopied] = useState(false);

  const handleCopyLogs = async () => {
    const text = genLogs.join('\n');
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setLogCopied(true);
    setTimeout(() => setLogCopied(false), 1600);
  };

  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollTop = logsEndRef.current.scrollHeight;
    }
  }, [genLogs]);

  // Theme synchronization from local storage
  useEffect(() => {
    const applyTheme = () => {
      const activeTheme = localStorage.getItem('theme') || 'default';
      document.body.classList.remove('theme-blue', 'theme-red');
      if (activeTheme === 'blue') {
        document.body.classList.add('theme-blue');
      } else if (activeTheme === 'red') {
        document.body.classList.add('theme-red');
      }
    };

    applyTheme();

    const handleStorageChange = (e) => {
      if (e.key === 'theme') {
        applyTheme();
      }
    };
    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  // 1. Initial Load & Heartbeat
  useEffect(() => {
    // Read project state sent by main window
    const loadProjectState = async () => {
      if (window.electronAPI && window.electronAPI.getActiveProjectState) {
        const state = await window.electronAPI.getActiveProjectState();
        if (state) {
          setCharacters(state.characters || []);
          setProjectScriptText(state.scriptText || '');
          
          // Never allow empty/blank lines in the script order preview: blocks
          // without script text — and longform fallback blocks whose text was
          // derived from an image filename (scriptMatched === false) — are
          // dropped entirely, so only text from the script box ever reaches
          // the AI and image names can never sneak into the narration.
          const sanitizeBlocks = (blocks) => (blocks || [])
            .filter(b => {
              const text = (b.text || '').trim();
              if (!text) return false;
              if (b.scriptMatched === false) return false;
              return true;
            });

          if (state.redoBlockId) {
            setRedoBlockId(state.redoBlockId);
            setRedoClipId(state.redoClipId);
            setRedoTrackId(state.redoTrackId);
            const filteredBlocks = sanitizeBlocks((state.dialogueBlocks || []).filter(b => b.id === state.redoBlockId));
            setDialogueBlocks(filteredBlocks);
          } else {
            setDialogueBlocks(sanitizeBlocks(state.dialogueBlocks || []));
            setRedoBlockId(null);
            setRedoClipId(null);
            setRedoTrackId(null);
          }

          // Clear previous generation states to make sure we don't display old results/logs
          setGeneratedResult(null);
          setGenLogs([]);
          setGenerationProgress(0);
          setCurrentBlockIndex(-1);
          
          // Initialize configs
          const configs = {};
          state.characters.forEach(char => {
            if (state.voiceConfigs && state.voiceConfigs[char.id]) {
              configs[char.id] = state.voiceConfigs[char.id];
            } else {
              configs[char.id] = {
                type: 'default',
                refPath: '',
                refText: '',
                presetName: ''
              };
            }
          });
          setVoiceConfigs(configs);
          return { characters: state.characters || [], voiceConfigs: state.voiceConfigs || {} };
        }
      }
      return { characters: [], voiceConfigs: {} };
    };

    // Load presets & default voices
    const loadMetadata = async (loadedState) => {
      const activeCharacters = loadedState?.characters || [];
      const activeVoiceConfigs = loadedState?.voiceConfigs || {};

      if (window.electronAPI) {
        const defaultList = await window.electronAPI.listDefaultVoices();
        setDefaultVoices(defaultList || []);

        const presetList = await window.electronAPI.loadVoicePresets();
        setPresets(presetList || []);

        // Auto-assign default voices to characters if matches (e.g. Peter, Stewie) or fallback to first default voice
        if (defaultList && defaultList.length > 0) {
          setVoiceConfigs(prev => {
            const next = { ...prev };
            const targetIds = new Set([...activeCharacters.map(c => c.id), ...Object.keys(next)]);
            targetIds.forEach(charId => {
              const char = activeCharacters.find(c => c.id === charId);
              const charName = char ? char.name.toLowerCase() : '';
              
              // Find matching default voice, or fallback to first available default voice
              const match = defaultList.find(v => charName && (charName.includes(v.name.toLowerCase()) || v.name.toLowerCase().includes(charName))) || defaultList[0];
              const existing = next[charId] || activeVoiceConfigs[charId];
              
              if (existing && existing.refPath) {
                if (existing.type === 'default') {
                  const matchedVoice = defaultList.find(v => v.name === existing.presetName) || match;
                  next[charId] = {
                    ...existing,
                    refPath: matchedVoice.path,
                    refText: existing.refText || matchedVoice.transcript,
                    presetName: matchedVoice.name
                  };
                } else {
                  next[charId] = existing;
                }
              } else {
                next[charId] = {
                  type: 'default',
                  refPath: match.path,
                  refText: match.transcript,
                  presetName: match.name
                };
              }
            });
            return next;
          });
        }
      }
    };

    // Listen to changes in project state (for instance when user triggers redo/replace clip)
    const handleProjectStateUpdated = () => {
      loadProjectState().then(loadMetadata);
    };

    if (window.electronAPI && window.electronAPI.onProjectStateUpdated) {
      window.electronAPI.onProjectStateUpdated(handleProjectStateUpdated);
    }

    loadProjectState().then(loadMetadata);

    // Heartbeat check Flask server
    const checkServer = async () => {
      try {
        const res = await fetch('http://127.0.0.1:5555/status');
        if (res.ok) {
          const data = await res.json();
          setServerOnline(true);
          setModelLoaded(data.model_loaded);
          if (data.model_loaded && data.model_type) {
            setSelectedModel(prev => {
              if (prev !== data.model_type) {
                applyModelDefaults(data.model_type);
              }
              return data.model_type;
            });
          }
          setGpuName(data.gpu_name || 'CPU');
          if (data.vram_total != null) {
            setVramTotal(data.vram_total);
          }
          if (data.s2_capabilities) {
            setS2Caps(data.s2_capabilities);
          }
          setServerStatus('Online');
          fetchModelInstalledStatus();
          fetchModelsList();
        } else {
          setServerOnline(false);
          setServerStatus('Error');
        }
      } catch (err) {
        setServerOnline(false);
        setServerStatus('Offline (Waiting for .venv startup...)');
      }
    };

    checkServer();
    const interval = setInterval(checkServer, 3000);

    return () => {
      clearInterval(interval);
      if (window.electronAPI && window.electronAPI.removeProjectStateUpdated) {
        window.electronAPI.removeProjectStateUpdated();
      }
    };
  }, [characters.length]);

  // Poll progress while downloading
  useEffect(() => {
    let active = true;
    let pollInterval = null;

    const checkDownloadProgress = async () => {
      try {
        const res = await fetch('http://127.0.0.1:5555/download_progress');
        if (!active) return;
        if (res.ok) {
          const data = await res.json();
          const progressPct = data.total_bytes > 0 ? Math.min(100, Math.round((data.downloaded_bytes / data.total_bytes) * 100)) : 0;
          
          setDownloadingState({
            downloading: data.downloading,
            model_name: data.model_name,
            progress: progressPct,
            error: data.error
          });

          if (!data.downloading) {
            clearInterval(pollInterval);
            pollInterval = null;
            fetchModelInstalledStatus();
            fetchModelsList();
          }
        }
      } catch (err) {
        console.error("Error polling download progress", err);
      }
    };

    if (downloadingState.downloading) {
      pollInterval = setInterval(checkDownloadProgress, 1000);
    }

    return () => {
      active = false;
      if (pollInterval) clearInterval(pollInterval);
    };
  }, [downloadingState.downloading]);

  // Draggable resizer for the main layout panels
  const handleResizerMouseDown = useCallback((e) => {
    e.preventDefault();
    isDraggingRef.current = true;
    const container = mainLayoutRef.current;
    if (!container) return;

    const onMouseMove = (ev) => {
      if (!isDraggingRef.current) return;
      const rect = container.getBoundingClientRect();
      const newPercent = Math.max(25, Math.min(75, ((ev.clientX - rect.left) / rect.width) * 100));
      setSplitPercent(newPercent);
    };

    const onMouseUp = () => {
      isDraggingRef.current = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, []);

  // 2. Model Controls
  const handleLoadModel = async () => {
    setLoadingModel(true);
    const modelNameDisplay = MODEL_NAMES[selectedModel] || selectedModel;
    addLog(`System: Requesting ${modelNameDisplay} load into VRAM...`);
    try {
      const res = await fetch('http://127.0.0.1:5555/load', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model_name: selectedModel })
      });
      const data = await res.json();
      if (data.success) {
        setModelLoaded(true);
        addLog(`System: ${modelNameDisplay} loaded successfully.`);
      } else {
        addLog(`System Error: ${data.error}`);
      }
    } catch (err) {
      addLog(`System Error: Failed to connect to server - ${err.message}`);
    } finally {
      setLoadingModel(false);
    }
  };

  const handleUnloadModel = async () => {
    setUnloadingModel(true);
    addLog('System: Requesting model unload to free VRAM...');
    try {
      const res = await fetch('http://127.0.0.1:5555/unload', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setModelLoaded(false);
        addLog('System: Model unloaded. GPU VRAM cleared.');
      } else {
        addLog(`System Error: ${data.error}`);
      }
    } catch (err) {
      addLog(`System Error: ${err.message}`);
    } finally {
      setUnloadingModel(false);
    }
  };

  const handleCancelGeneration = async () => {
    cancelledRef.current = true;
    setCancelling(true);
    addLog('System: Cancelling current generation...');
    if (fetchCtrlRef.current) {
      try { fetchCtrlRef.current.abort(); } catch (e) {}
    }
    try {
      const res = await fetch('http://127.0.0.1:5555/cancel', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        addLog('System: Generation cancelled. Model remains loaded.');
      } else {
        addLog(`System Error: ${data.error}`);
      }
    } catch (err) {
      addLog(`System: Cancel signal sent (${err.message || 'server busy'}).`);
    }
    setCancelling(false);
    setGenerating(false);
    setGenerationProgress(0);
    setCurrentBlockIndex(-1);
  };

  const handleReset = async () => {
    const msg = generating
      ? 'Reset will cancel the running generation, unload all models and restart this window. Continue?'
      : 'Reset will unload all models and restart this window fresh. Continue?';
    if (!window.confirm(msg)) return;

    setResetting(true);
    cancelledRef.current = true;
    addLog('System: Resetting voice clone engine (cancel + unload + restart)...');
    if (fetchCtrlRef.current) {
      try { fetchCtrlRef.current.abort(); } catch (e) {}
    }
    try {
      const res = await fetch('http://127.0.0.1:5555/reset', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        addLog('System: Engine reset. All models unloaded.');
      } else {
        addLog(`System Error: ${data.error}`);
      }
    } catch (err) {
      addLog(`System: Reset signal sent (${err.message || 'server busy'}).`);
    }
    if (window.electronAPI && window.electronAPI.restartVoiceCloneWindow) {
      window.electronAPI.restartVoiceCloneWindow();
    } else {
      window.location.reload();
    }
  };

  const handleModelChange = async (e) => {
    const val = e.target.value;
    setSelectedModel(val);
    applyModelDefaults(val);
    
    if (modelLoaded) {
      setLoadingModel(true);
      const modelNameDisplay = MODEL_NAMES[val] || val;
      addLog(`System: Hot-swapping model to ${modelNameDisplay}...`);
      try {
        const res = await fetch('http://127.0.0.1:5555/load', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model_name: val })
        });
        const data = await res.json();
        if (data.success) {
          addLog(`System: ${modelNameDisplay} loaded successfully.`);
        } else {
          addLog(`System Error: ${data.error}`);
          setModelLoaded(false);
        }
      } catch (err) {
        addLog(`System Error: ${err.message}`);
      } finally {
        setLoadingModel(false);
      }
    }
  };

  // 3. File dialog for custom reference audio
  const handleSelectAudioFile = async (charId) => {
    if (!window.electronAPI) return;
    const files = await window.electronAPI.openFileDialog({
      filters: [{ name: 'Audio Files', extensions: ['wav', 'mp3', 'ogg'] }]
    });
    if (files && files.length > 0) {
      const filePath = files[0];
      setVoiceConfigs(prev => ({
        ...prev,
        [charId]: {
          ...prev[charId],
          type: 'custom',
          refPath: filePath
        }
      }));
    }
  };

  // 4. Save Preset
  const handleSaveAsPreset = async (charId, charName) => {
    const config = voiceConfigs[charId];
    if (!config || !config.refPath || !config.refText) {
      alert('Please provide reference audio and reference transcript text first.');
      return;
    }
    const presetName = prompt(`Enter a name for this voice preset:`, charName);
    if (!presetName) return;

    const preset = {
      name: presetName,
      refPath: config.refPath,
      refText: config.refText
    };

    if (window.electronAPI && window.electronAPI.saveVoicePreset) {
      const res = await window.electronAPI.saveVoicePreset(preset);
      if (res.success) {
        // Refresh preset list
        const presetList = await window.electronAPI.loadVoicePresets();
        setPresets(presetList || []);
        
        // Switch voiceConfig to this preset
        setVoiceConfigs(prev => ({
          ...prev,
          [charId]: {
            ...prev[charId],
            type: 'preset',
            presetName: preset.name
          }
        }));
        alert(`Preset "${preset.name}" saved successfully!`);
      } else {
        alert(`Failed to save preset: ${res.error}`);
      }
    }
  };

  // 5. Play Reference Audio (Safely loaded as Blob URL to prevent file:/// scheme load crashes)
  const togglePlayAudio = async (filePath) => {
    if (playingAudio === filePath) {
      audioRef.current.pause();
      setPlayingAudio(null);
      if (playingBlobUrl) {
        URL.revokeObjectURL(playingBlobUrl);
        setPlayingBlobUrl(null);
      }
    } else {
      try {
        let audioUrl = '';
        if (window.electronAPI) {
          const fileBuffer = await window.electronAPI.readFileBuffer(filePath);
          if (fileBuffer && !fileBuffer.error) {
            const arrayBuffer = new ArrayBuffer(fileBuffer.byteLength);
            new Uint8Array(arrayBuffer).set(fileBuffer);
            const blob = new Blob([arrayBuffer], { type: 'audio/wav' });
            audioUrl = URL.createObjectURL(blob);
            setPlayingBlobUrl(audioUrl);
          } else {
            console.error("Failed to read file buffer for preview:", fileBuffer?.error);
            audioUrl = `file:///${filePath.replace(/\\/g, '/')}`;
          }
        } else {
          audioUrl = `file:///${filePath.replace(/\\/g, '/')}`;
        }
        audioRef.current.src = audioUrl;
        audioRef.current.play();
        setPlayingAudio(filePath);
        audioRef.current.onended = () => {
          setPlayingAudio(null);
          if (audioUrl.startsWith('blob:')) {
            URL.revokeObjectURL(audioUrl);
            setPlayingBlobUrl(null);
          }
        };
      } catch (err) {
        console.error("Audio playback error:", err);
      }
    }
  };

  const handleApplyResult = async () => {
    if (!generatedResult || !generatedResult.dialogueBlocks) return;

    if (redoBlockId && (!redoClipId || !redoTrackId)) {
      addLog("Fatal Error: Invalid redo payload (missing clip/track ids). Discard and re-generate.");
      return;
    }
    
    addLog("Media Library: Sending generated audio clips to Media Library...");
    try {
      if (window.electronAPI && window.electronAPI.applyTimelineVoices) {
        let voices;
        if (generatedResult.merged) {
          const mergedBlock = generatedResult.dialogueBlocks.find(b => !!b.wavPath);
          if (!mergedBlock) {
            addLog("Fatal Error: No generated audio path available. Discard and re-generate.");
            return;
          }
          // Single continuous voiceover: one clip covering the full narration,
          // anchored at the start of the first script block.
          const anchorBlock = mergedBlock;
          voices = [{
            audioPath: mergedBlock.wavPath,
            characterName: mergedBlock.characterName,
            blockId: null, // free-standing on the audio track, not tied to one line
            characterId: mergedBlock.characterId,
            duration: mergedBlock.duration,
            startTime: anchorBlock && anchorBlock.startTime != null ? anchorBlock.startTime : 0,
            mergedVoiceover: true,
            index: 0,
            words: mergedBlock.words || [],
          }];
        } else {
          voices = generatedResult.dialogueBlocks
            .filter(block => !!block.wavPath)
            .map((block, idx) => ({
              audioPath: block.wavPath,
              characterName: block.characterName,
              blockId: block.id,
              characterId: block.characterId,
              duration: block.duration,
              index: idx,
              words: block.words || [],
            }));
        }

        if (voices.length === 0) {
          addLog("Fatal Error: No generated audio paths available. Discard and re-generate.");
          return;
        }

        const syncRes = await window.electronAPI.applyTimelineVoices({
          voices,
          voiceConfigs,
          isRedo: !!redoBlockId,
          redoBlockId,
          redoClipId,
          redoTrackId
        });
        
        if (syncRes.success) {
          addLog("Success: All generated audio files added to Media Library! You can close this window.");
          if (redoBlockId) {
            setTimeout(() => {
              window.close();
            }, 1000);
          }
        } else {
          throw new Error(`Failed to import voices: ${syncRes.error}`);
        }
      } else {
        addLog("Warning: Development mode - skipped import (Electron context missing).");
      }
    } catch (err) {
      addLog(`Fatal Error during apply: ${err.message}`);
    }
  };

  const handleDiscardResult = () => {
    if (audioRef.current) {
      audioRef.current.pause();
    }
    setPlayingAudio(null);
    if (playingBlobUrl) {
      URL.revokeObjectURL(playingBlobUrl);
      setPlayingBlobUrl(null);
    }
    setGeneratedResult(null);
    setGenerationProgress(0);
    addLog("System: Discarded generated voiceover. Ready to re-generate.");
  };

  // 6. Handle Config Changes
  const handleConfigTypeChange = (charId, type) => {
    let refPath = '';
    let refText = '';
    let presetName = '';

    if (type === 'default' && defaultVoices.length > 0) {
      const char = characters.find(c => c.id === charId);
      const charName = char ? char.name.toLowerCase() : '';
      const match = defaultVoices.find(v => charName.includes(v.name.toLowerCase()) || v.name.toLowerCase().includes(charName)) || defaultVoices[0];
      refPath = match.path;
      refText = match.transcript;
      presetName = match.name;
    } else if (type === 'preset' && presets.length > 0) {
      refPath = presets[0].refPath;
      refText = presets[0].refText;
      presetName = presets[0].name;
    }

    setVoiceConfigs(prev => ({
      ...prev,
      [charId]: {
        type,
        refPath,
        refText,
        presetName
      }
    }));
  };

  const handleSelectPreset = (charId, presetName) => {
    const preset = presets.find(p => p.name === presetName);
    if (preset) {
      setVoiceConfigs(prev => ({
        ...prev,
        [charId]: {
          ...prev[charId],
          refPath: preset.refPath,
          refText: preset.refText,
          presetName: preset.name
        }
      }));
    }
  };

  const handleSelectDefaultVoice = (charId, voiceName) => {
    const voice = defaultVoices.find(v => v.name === voiceName);
    if (voice) {
      setVoiceConfigs(prev => ({
        ...prev,
        [charId]: {
          ...prev[charId],
          refPath: voice.path,
          refText: voice.transcript,
          presetName: voice.name
        }
      }));
    }
  };

  const handleTranscriptChange = (charId, text) => {
    setVoiceConfigs(prev => ({
      ...prev,
      [charId]: {
        ...prev[charId],
        refText: text
      }
    }));
  };

  // 7. Generation Loop
  const addLog = (msg) => {
    const timeStr = new Date().toLocaleTimeString();
    setGenLogs(prev => [`[${timeStr}] ${msg}`, ...prev]);
  };

  const handleDownloadModel = async (modelName) => {
    try {
      addLog(`System: Starting download for ${MODEL_NAMES[modelName] || modelName}...`);
      setDownloadingState({ downloading: true, model_name: modelName, progress: 0, error: null });
      
      const res = await fetch('http://127.0.0.1:5555/download_model', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model_name: modelName })
      });
      
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to start download");
      }
    } catch (err) {
      addLog(`Error: ${err.message}`);
      setDownloadingState({ downloading: false, model_name: null, progress: 0, error: err.message });
    }
  };

  const handleUninstallModel = async (modelName) => {
    try {
      addLog(`System: Uninstalling ${MODEL_NAMES[modelName] || modelName}...`);
      const res = await fetch('http://127.0.0.1:5555/uninstall_model', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model_name: modelName })
      });
      if (res.ok) {
        addLog(`System: ${MODEL_NAMES[modelName] || modelName} uninstalled successfully.`);
        setModelLoaded(false);
        fetchModelInstalledStatus();
      } else {
        const data = await res.json();
        throw new Error(data.error || "Failed to uninstall model");
      }
    } catch (err) {
      addLog(`Error: ${err.message}`);
    }
    setShowUninstallConfirm(null);
  };

  const handleGenerateVoiceover = async () => {
    if (dialogueBlocks.length === 0) {
      alert("No dialogue script parsed. Write a script in the main editor first.");
      return;
    }
    
    // Auto-fix any unassigned default voices using defaultVoices fallback
    let currentConfigs = { ...voiceConfigs };
    if (defaultVoices && defaultVoices.length > 0) {
      let updated = false;
      characters.forEach(char => {
        const config = currentConfigs[char.id];
        if (!config || !config.refPath || !config.refText) {
          const charName = char.name ? char.name.toLowerCase() : '';
          const match = defaultVoices.find(v => charName && (charName.includes(v.name.toLowerCase()) || v.name.toLowerCase().includes(charName))) || defaultVoices[0];
          if (match) {
            currentConfigs[char.id] = {
              type: 'default',
              refPath: match.path,
              refText: (config && config.refText) || match.transcript,
              presetName: match.name
            };
            updated = true;
          }
        }
      });
      if (updated) {
        setVoiceConfigs(currentConfigs);
      }
    }

    // Validate that every character has a voice configuration
    const missing = [];
    characters.forEach(char => {
      const config = currentConfigs[char.id];
      if (!config || !config.refPath || !config.refText) {
        missing.push(char.name);
      }
    });

    if (missing.length > 0) {
      alert(`Missing voice references for: ${missing.join(', ')}. Please assign a voice clip before starting.`);
      return;
    }

    setGenerating(true);
    setGenLogs([]);
    cancelledRef.current = false;
    addLog("Start: Setting up voice synthesis pipeline...");

    try {
      // 1. Force load model into VRAM. If the requested model cannot be
      // loaded (not installed, missing engine, ...) but the server already
      // has a model in VRAM, keep going with the loaded model instead of
      // failing the whole voiceover run.
      const modelNameDisplay = MODEL_NAMES[selectedModel] || selectedModel;
      let effectiveModel = selectedModel;
      addLog(`System: Requesting GPU VRAM allocation for ${modelNameDisplay}...`);
      const loadRes = await fetch('http://127.0.0.1:5555/load', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model_name: selectedModel })
      });
      const loadData = await loadRes.json();
      if (!loadData.success) {
        try {
          const stRes = await fetch('http://127.0.0.1:5555/status');
          const stData = await stRes.json();
          if (stData.model_loaded && stData.model_type) {
            effectiveModel = stData.model_type;
            setSelectedModel(stData.model_type);
            addLog(`Warning: ${modelNameDisplay} load failed (${loadData.error}). Using already-loaded ${MODEL_NAMES[effectiveModel] || effectiveModel} instead.`);
          } else {
            throw new Error(`Failed to load model ${modelNameDisplay}: ${loadData.error}`);
          }
        } catch (statusErr) {
          if (statusErr.message && statusErr.message.startsWith('Failed to load model')) {
            throw statusErr;
          }
          throw new Error(`Failed to load model ${modelNameDisplay}: ${loadData.error}`);
        }
      } else {
        setModelLoaded(true);
        addLog(`System: ${modelNameDisplay} is active in GPU VRAM.`);
      }

      const projectPath = window.electronAPI ? await window.electronAPI.getProjectPath() : '.';
      const projectPathNormalized = projectPath.replace(/\\/g, '/');
      const timestamp = Math.floor(Date.now() / 1000);
      const voicesDir = `${projectPathNormalized}/dist/voices/generation_${timestamp}`;
      const sanitizeFilename = (name) => name.replace(/[^a-zA-Z0-9_-]/g, '_');

      const updatedBlocks = JSON.parse(JSON.stringify(dialogueBlocks)); // deep clone

      // Single Voiceover Mode (longform): the WHOLE script box text is read in
      // one go and synthesized as ONE continuous audio file instead of one
      // track per timeline block. Only blocks whose text comes from the
      // script box are counted — longform fallback blocks (scriptMatched ===
      // false) hold image filenames as text and are always excluded.
      const isLongform = dialogueBlocks.some(b => b.imageId || b.imageName);
      const scriptBlocks = dialogueBlocks.filter(b => b.scriptMatched !== false && (b.text || '').trim());
      const useSingleVoiceover = !redoBlockId && isLongform && scriptBlocks.length > 0;

      if (useSingleVoiceover) {
        const mergedText = buildMergedScriptText();

        const firstBlock = scriptBlocks[0];
        const config = voiceConfigs[firstBlock.characterId] || Object.values(voiceConfigs).find(c => c && c.refPath) || Object.values(voiceConfigs)[0];
        if (!config || !config.refPath) {
          throw new Error(`No reference audio file assigned for '${firstBlock.characterName || 'Narrator'}'. Please select a voice source.`);
        }

        const charName = sanitizeFilename(firstBlock.characterName || 'character');
        const savePath = `${voicesDir}/voiceover_single_${charName}.wav`;

        const skippedCount = dialogueBlocks.length - scriptBlocks.length;
        addLog(`Single Voiceover: merged ${scriptBlocks.length} lines into one continuous track (${mergedText.length} chars)${skippedCount > 0 ? ` — ${skippedCount} image placeholder line(s) excluded` : ''}.`);

        const bodyPayload = {
          model_name: effectiveModel,
          text: mergedText,
          language: 'English',
          ref_audio: config.refPath,
          ref_text: config.refText || '',
          save_path: savePath
        };

        if (temperature !== undefined && temperature !== null) {
          bodyPayload.temperature = temperature;
        }
        if (effectiveModel === 'luxtts' && speed !== undefined && speed !== null) {
          bodyPayload.speed = speed;
        }
        if (effectiveModel === 's2pro') {
          bodyPayload.model_name = 's2pro';
          bodyPayload.top_p = topP;
          bodyPayload.top_k = topK;
          bodyPayload.max_tokens = maxTokens;
          bodyPayload.gpu_layers = gpuLayers;
          bodyPayload.codec_cpu = codecCpu;
          bodyPayload.s2_backend = s2Backend;
        }

        let response;
        try {
          fetchCtrlRef.current = new AbortController();
          response = await fetch('http://127.0.0.1:5555/clone', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(bodyPayload),
            signal: fetchCtrlRef.current.signal
          });
        } catch (err) {
          if (cancelledRef.current) {
            addLog('System: Generation cancelled by user.');
          } else {
            throw err;
          }
        } finally {
          fetchCtrlRef.current = null;
        }

        if (response) {
          const data = await response.json();
          if (data.cancelled) {
            addLog('System: Cancelled while generating the single voiceover. No clips generated.');
          } else if (!data.success) {
            throw new Error(`Failed generating single voiceover clip: ${data.error}`);
          } else {
            const runDevice = data.device_used || data.s2_backend_used || 'unknown';
            addLog(`Speech Generation [1/1]: Continuous voiceover done — ran on ${runDevice}${data.s2_backend_used ? ` (s2 backend: ${data.s2_backend_used})` : ''}.`);

            updatedBlocks.forEach(block => {
              if (block.id === firstBlock.id) {
                block.wavPath = data.wav_path;
                block.duration = data.duration;
                block.words = data.words || [];
              } else {
                block.wavPath = null;
                block.duration = null;
                block.words = [];
              }
            });
          }
        }
      } else {
      // 2. Loop blocks sequentially
      for (let i = 0; i < dialogueBlocks.length; i++) {
        setCurrentBlockIndex(i);
        const block = dialogueBlocks[i];
        const config = voiceConfigs[block.characterId] || Object.values(voiceConfigs).find(c => c && c.refPath) || Object.values(voiceConfigs)[0];
        if (!config || !config.refPath) {
          throw new Error(`No reference audio file assigned for '${block.characterName || 'Narrator'}'. Please select a voice source.`);
        }

        const charName = sanitizeFilename(block.characterName || 'character');
        const savePath = `${voicesDir}/voice_${i + 1}_${charName}.wav`;

        const lineText = (block.text || '').trim();
        if (!lineText || block.scriptMatched === false) {
          addLog(`System: Skipping line ${i + 1} — no script text to synthesize (${block.imageName || block.characterName || 'empty line'}).`);
          continue;
        }

        addLog(`Speech Generation [${i + 1}/${dialogueBlocks.length}]: Synthesizing '${block.characterName || 'Narrator'}' line...`);

        const bodyPayload = {
          model_name: effectiveModel,
          text: lineText,
          language: 'English',
          ref_audio: config.refPath,
          ref_text: config.refText || '',
          save_path: savePath
        };

        if (temperature !== undefined && temperature !== null) {
          bodyPayload.temperature = temperature;
        }
        if (effectiveModel === 'luxtts' && speed !== undefined && speed !== null) {
          bodyPayload.speed = speed;
        }
        if (effectiveModel === 's2pro') {
          bodyPayload.model_name = 's2pro';
          bodyPayload.top_p = topP;
          bodyPayload.top_k = topK;
          bodyPayload.max_tokens = maxTokens;
          bodyPayload.gpu_layers = gpuLayers;
          bodyPayload.codec_cpu = codecCpu;
          bodyPayload.s2_backend = s2Backend;
        }

        let response;
        try {
          fetchCtrlRef.current = new AbortController();
          response = await fetch('http://127.0.0.1:5555/clone', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(bodyPayload),
            signal: fetchCtrlRef.current.signal
          });
        } catch (err) {
          if (cancelledRef.current) {
            addLog('System: Generation cancelled by user.');
            break;
          }
          throw err;
        } finally {
          fetchCtrlRef.current = null;
        }

        const data = await response.json();
        if (data.cancelled) {
          addLog(`System: Cancelled while generating line ${i + 1} (${block.characterName || 'Narrator'}). No further clips generated.`);
          break;
        }
        if (!data.success) {
          throw new Error(`Failed generating clip for line ${i + 1} (${block.characterName}): ${data.error}`);
        }

        const runDevice = data.device_used || data.s2_backend_used || 'unknown';
        addLog(`Speech Generation [${i + 1}/${dialogueBlocks.length}]: Line '${block.characterName || 'Narrator'}' done — ran on ${runDevice}${data.s2_backend_used ? ` (s2 backend: ${data.s2_backend_used})` : ''}.`);

        updatedBlocks[i].wavPath = data.wav_path;
        updatedBlocks[i].duration = data.duration; // Update block with actual speaking duration
        updatedBlocks[i].words = data.words || [];

        setGenerationProgress(((i + 1) / dialogueBlocks.length) * 100);
      }
      } // end per-line mode

      if (cancelledRef.current) {
        addLog("System: Generation cancelled. Incomplete run discarded — adjust settings and re-generate.");
        setGenerationProgress(0);
      } else {
        setGenerationProgress(100);
        addLog(useSingleVoiceover
          ? "Success: Single continuous voiceover generated! Preview it above, then click Accept to import it into the Media Library."
          : "Success: Audio files generated successfully! You can preview individual lines in the list above, then click Accept to import them into the Media Library.");
        setGeneratedResult({
          dialogueBlocks: updatedBlocks,
          merged: useSingleVoiceover,
        });

        // 3. Conditionally unload model from VRAM depending on user preference
        if (autoUnload) {
          addLog("GPU: Auto-unload is ON — freeing VRAM...");
          await handleUnloadModel();
        } else {
          addLog("GPU: Auto-unload is OFF — model stays loaded in VRAM for re-use.");
        }
      }

    } catch (err) {
      addLog(`Fatal Error: ${err.message}`);
      setGenerationProgress(0);
    } finally {
      setGenerating(false);
      setCurrentBlockIndex(-1);
    }
  };

  // Single Voiceover Mode detection (longform): the script order preview shows
  // the WHOLE script as ONE line, and generation synthesizes a single audio
  // file. Only blocks whose text comes from the script box count — longform
  // fallback blocks (scriptMatched === false) hold image filenames and are
  // never narrated.
  const isLongformProject = dialogueBlocks.some(b => b.imageId || b.imageName);
  const scriptOnlyBlocks = dialogueBlocks.filter(b => b.scriptMatched !== false && (b.text || '').trim());
  const mergedPreviewActive = !redoBlockId && isLongformProject && scriptOnlyBlocks.length > 0;

  // The single line to narrate: always prefer the EXACT script box content
  // (that is the only text the AI may read), with "**Speaker:**" headers
  // stripped so headers never get spoken. Falls back to stitching the
  // script-matched block texts together when no script box content exists.
  const buildMergedScriptText = () => {
    const rawFull = (projectScriptText || '').trim();
    if (rawFull) {
      const stripped = rawFull
        .replace(/^\s*\*\*\s*[^*]+?(?::\*\*|\*\*:)\s*/gm, '')
        .replace(/\s*\n\s*/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (stripped) {
        return /[.?!…]$/.test(stripped) ? stripped : stripped + '.';
      }
    }
    return scriptOnlyBlocks
      .map(b => (b.text || '').trim())
      .filter(Boolean)
      .map(t => (/[.?!…]$/.test(t) ? t : t + '.'))
      .join(' ');
  };

  const mergedScriptText = mergedPreviewActive ? buildMergedScriptText() : '';

  return (
    <div className="clone-container">
      <style>{`
        .clone-container {
          display: flex;
          flex-direction: column;
          height: 100vh;
          background: var(--bg-primary, #060609);
          color: var(--text-primary, #e3e3e8);
          font-family: var(--font-sans, 'Outfit', 'Inter', sans-serif);
          padding: 16px;
          box-sizing: border-box;
          overflow: hidden;
        }

        .header {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          border-bottom: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.08));
          padding-bottom: 10px;
          margin-bottom: 16px;
        }

        .header__title {
          font-size: 20px;
          font-weight: 700;
          color: var(--accent-primary, #00e5ff);
          margin: 0;
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .status-indicator {
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          display: inline-block;
        }

        .dot--green { background: #00e676; box-shadow: 0 0 8px #00e676; }
        .dot--yellow { background: #ffd740; box-shadow: 0 0 8px #ffd740; }
        .dot--red { background: #ff4081; box-shadow: 0 0 8px #ff4081; }

        .btn {
          background: var(--accent-primary, #7c4dff);
          color: white;
          border: none;
          padding: 6px 12px;
          border-radius: var(--radius-sm, 4px);
          cursor: pointer;
          font-size: 12px;
          font-weight: 600;
          transition: all 0.2s ease;
        }

        .btn:hover {
          background: var(--accent-primary-hover, #651fff);
        }

        .btn--secondary {
          background: var(--bg-elevated, rgba(255, 255, 255, 0.08));
          color: var(--text-secondary, #e3e3e8);
        }

        .btn--secondary:hover {
          background: var(--bg-hover, rgba(255, 255, 255, 0.15));
        }

        .btn--accent {
          background: var(--accent-secondary, #00e5ff);
          color: var(--bg-primary, #060609);
        }

        .btn--accent:hover {
          background: var(--accent-primary-hover, #00b0ff);
        }

        .btn--danger {
          background: #ff5252;
          color: white;
        }

        .btn--danger:hover {
          background: #ff1744;
        }

        .btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .main-layout {
          display: flex;
          flex: 1;
          gap: 0;
          min-height: 0;
        }

        .left-panel {
          display: flex;
          flex-direction: column;
          gap: 12px;
          overflow-y: auto;
          padding-right: 12px;
          min-width: 0;
        }

        .resizer-bar {
          width: 6px;
          flex-shrink: 0;
          cursor: col-resize;
          background: transparent;
          position: relative;
          margin: 0 4px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .resizer-bar::after {
          content: '';
          display: block;
          width: 2px;
          height: 60px;
          background: var(--border-default, rgba(255, 255, 255, 0.12));
          border-radius: 2px;
          transition: background 0.2s;
        }

        .resizer-bar:hover::after {
          background: var(--accent-primary, #00e5ff);
        }

        .right-panel {
          display: flex;
          flex-direction: column;
          gap: 6px;
          background: var(--bg-secondary, rgba(255, 255, 255, 0.02));
          border: 1px solid var(--border-default, rgba(255, 255, 255, 0.04));
          border-radius: var(--radius-md, 8px);
          padding: 8px;
          min-height: 0;
          min-width: 0;
          overflow: hidden;
        }

        .card {
          background: var(--bg-secondary, rgba(255, 255, 255, 0.02));
          border: 1px solid var(--border-default, rgba(255, 255, 255, 0.05));
          border-radius: var(--radius-md, 8px);
          padding: 16px;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .card__header {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .card__title {
          font-size: 14px;
          font-weight: 700;
          color: var(--text-primary, #fff);
          margin: 0;
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .form-row {
          display: flex;
          align-items: center;
          gap: 10px;
          font-size: 13px;
        }

        .form-control {
          background: var(--bg-primary, #0f0f15);
          border: 1px solid var(--border-strong, rgba(255, 255, 255, 0.1));
          color: var(--text-primary, #fff);
          border-radius: var(--radius-sm, 4px);
          padding: 6px 10px;
          font-size: 13px;
          flex: 1;
        }

        .form-control:focus {
          border-color: var(--accent-primary, #00e5ff);
          outline: none;
        }

        .textarea-control {
          min-height: 80px;
          height: 120px;
          resize: vertical;
        }

        .input-number {
          width: 70px;
          flex: none;
        }

        .logs-container {
          background: var(--bg-primary, #020204);
          border: 1px solid var(--border-default, rgba(255, 255, 255, 0.08));
          border-radius: var(--radius-sm, 6px);
          padding: 8px;
          flex: 1;
          overflow-y: auto;
          font-family: 'Consolas', 'Courier New', monospace;
          font-size: 11px;
          color: var(--text-secondary, #a0a0b0);
          display: flex;
          flex-direction: column;
          user-select: text;
          -webkit-user-select: text;
        }

        .log-entry {
          margin-bottom: 4px;
          line-height: 1.4;
        }

        .log-entry--error {
          color: #ff5252;
          font-weight: 600;
        }

        .log-entry--success {
          color: #00e676;
          font-weight: 600;
        }

        .log-entry--loading {
          color: #00b0ff;
        }

        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }

        @keyframes pulse-glow {
          0% { border-color: #00e5ff; box-shadow: 0 0 6px rgba(0, 229, 255, 0.4); }
          50% { border-color: #7c4dff; box-shadow: 0 0 16px rgba(124, 77, 255, 0.7); }
          100% { border-color: #00e5ff; box-shadow: 0 0 6px rgba(0, 229, 255, 0.4); }
        }

        .spinner-sm {
          width: 12px;
          height: 12px;
          border: 2px solid rgba(255, 255, 255, 0.2);
          border-top-color: #00e5ff;
          border-radius: 50%;
          display: inline-block;
          animation: spin 0.8s linear infinite;
        }

        .script-item--generating {
          border: 1px solid #00e5ff !important;
          background: rgba(0, 229, 255, 0.1) !important;
          animation: pulse-glow 1.2s infinite;
        }

        .progress-section {
          display: flex;
          flex-direction: column;
          gap: 8px;
          margin-top: 12px;
        }

        .progress-header {
          display: flex;
          justify-content: space-between;
          font-size: 13px;
          font-weight: 600;
        }

        .bar-outer {
          height: 8px;
          background: var(--border-default, rgba(255, 255, 255, 0.05));
          border-radius: 4px;
          overflow: hidden;
        }

        .bar-inner {
          height: 100%;
          background: linear-gradient(90deg, var(--accent-primary), var(--accent-secondary, #00e5ff));
          border-radius: 4px;
          transition: width 0.3s ease;
        }

        .script-preview {
          list-style: none;
          padding: 0;
          margin: 0;
          overflow-y: auto;
          flex: 1;
          min-height: 80px;
        }

        .script-item {
          padding: 8px 10px;
          border-radius: var(--radius-sm, 4px);
          margin-bottom: 6px;
          font-size: 12px;
          line-height: 1.4;
          background: var(--bg-secondary, rgba(255, 255, 255, 0.01));
          border-left: 3px solid var(--border-strong, rgba(255, 255, 255, 0.1));
        }

        .script-item--active {
          background: var(--accent-primary-glow, rgba(124, 77, 255, 0.08));
          border-left-color: var(--accent-primary, #7c4dff);
        }

        .script-item__char {
          font-weight: 700;
          margin-right: 6px;
        }

        .play-btn {
          width: 24px;
          height: 24px;
          border-radius: 50%;
          background: var(--bg-elevated, rgba(255, 255, 255, 0.08));
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          border: none;
          color: white;
        }

        .play-btn--active {
          background: var(--accent-secondary, #00e5ff);
          color: var(--bg-primary, #060609);
        }
      `}</style>

      {/* Header */}
      <div className="header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
          <h1 className="header__title">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
            Voice Clone & TTS Engine
          </h1>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <button className="btn btn--danger" onClick={handleCancelGeneration} disabled={!generating || cancelling} title="Cancel the current voice generation at any point">
              {cancelling ? 'Cancelling...' : '⏹ Cancel Generation'}
            </button>
            <button className="btn btn--secondary" onClick={handleReset} disabled={resetting} title="Cancel generation, unload all models and restart this window fresh">
              {'↻ Reset'}
            </button>
            <button className="btn btn--secondary" onClick={() => window.close()}>Close Window</button>
          </div>
        </div>

        {/* Compact Integrated Status Row */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px', color: '#a0a0b0', flexWrap: 'wrap', gap: '8px', width: '100%', marginTop: '4px' }}>
          <div className="status-indicator">
            <span className={`dot ${serverOnline ? 'dot--green' : 'dot--red'}`} style={{ width: 6, height: 6 }}></span>
            <span>TTS Service: <strong>{serverStatus}</strong></span>
          </div>
          
          {serverOnline && (
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <span>
                GPU: <strong style={{ color: '#00e5ff' }}>{gpuName}</strong>
                {vramTotal != null && (
                  <span style={{ color: '#a0a0b0', fontSize: '10px', marginLeft: 4 }}>({vramTotal.toFixed(1)} GB VRAM)</span>
                )}
              </span>
              
              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <span>Model:</span>
                <select
                  value={selectedModel}
                  onChange={handleModelChange}
                  disabled={loadingModel || generating || unloadingModel || downloadingState.downloading}
                  style={{
                    background: '#1a1a24',
                    color: '#ffffff',
                    border: '1px solid var(--border-default)',
                    borderRadius: '4px',
                    padding: '2px 6px',
                    fontSize: '11px',
                    cursor: 'pointer',
                    outline: 'none',
                    fontFamily: 'inherit'
                  }}
                >
                  <option value="luxtts">LuxTTS 1.7B Distilled (~1 GB VRAM)</option>
                  <option value="qwen3tts_0.6b">Qwen3-TTS 0.6B Base (~3 GB VRAM)</option>
                  <option value="qwen3tts_1.7b">Qwen3-TTS 1.7B Base (~6 GB VRAM)</option>
                  <option value="s2pro">S2 Pro 5B Q4_K_M (3.6 GB file · ~7 GB VRAM full offload)</option>
                  {(modelsList.length > 0 ? modelsList.filter(m => m.id !== 'luxtts' && m.id !== 'qwen3tts_0.6b' && m.id !== 'qwen3tts_1.7b' && m.id !== 's2pro') : []).map(m => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                {(() => {
                  const selInfo = modelsList.find(m => m.id === selectedModel) || {};
                  const selInstalled = !!modelInstalled[selectedModel] || !!selInfo.installed;
                  const selHfCached = !!selInfo.hf_cached;
                  const statusText = selInstalled ? 'Installed' : (selHfCached ? 'In HF Cache' : 'Not Installed');
                  const statusColor = selInstalled ? 'var(--accent-success, #00e676)' : (selHfCached ? '#00b0ff' : 'var(--accent-warning, #ffab40)');
                  return (
                  <>
                <span style={{
                  fontSize: '9px',
                  padding: '1px 4px',
                  borderRadius: '3px',
                  fontWeight: '600',
                  background: selInstalled || selHfCached ? 'rgba(0, 176, 255, 0.1)' : 'rgba(255, 171, 64, 0.1)',
                  color: statusColor,
                  border: `1px solid ${statusColor}33`,
                  display: 'inline-flex',
                  alignItems: 'center'
                }}>
                  {statusText}
                </span>

                {selInstalled ? (
                  <button
                    onClick={() => setShowUninstallConfirm(selectedModel)}
                    title="Uninstall model from this PC"
                    disabled={loadingModel || unloadingModel || generating}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#ff5252',
                      cursor: 'pointer',
                      padding: '2px',
                      borderRadius: '4px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      outline: 'none'
                    }}
                  >
                    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="3 6 5 6 21 6"></polyline>
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                    </svg>
                  </button>
                ) : (
                  downloadingState.downloading && downloadingState.model_name === selectedModel ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <div style={{ position: 'relative', width: 14, height: 14, display: 'flex', alignItems: 'center' }}>
                        <svg width="14" height="14" viewBox="0 0 20 20">
                          <circle cx="10" cy="10" r="8" fill="none" stroke="#2a2a3a" strokeWidth="3" />
                          <circle
                            cx="10"
                            cy="10"
                            r="8"
                            fill="none"
                            stroke="var(--accent-primary, #7c4dff)"
                            strokeWidth="3"
                            strokeDasharray={2 * Math.PI * 8}
                            strokeDashoffset={2 * Math.PI * 8 * (1 - downloadingState.progress / 100)}
                            strokeLinecap="round"
                            transform="rotate(-90 10 10)"
                          />
                        </svg>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => handleDownloadModel(selectedModel)}
                      title="Download model to this PC"
                      disabled={downloadingState.downloading}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: 'var(--accent-primary, #7c4dff)',
                        cursor: 'pointer',
                        padding: '2px',
                        borderRadius: '4px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        outline: 'none'
                      }}
                    >
                      <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                        <polyline points="7 10 12 15 17 10"></polyline>
                      </svg>
                    </button>
                  )
                )}
                  </>
                  );
                })()}
              </div>

              <div className="status-indicator">
                <span className={`dot ${modelLoaded ? 'dot--green' : 'dot--yellow'}`} style={{ width: 6, height: 6 }}></span>
                <span>VRAM: <strong>{modelLoaded ? 'Loaded' : 'Free'}</strong></span>
              </div>

              <label
                title="When ON, the model is unloaded from GPU VRAM after generation finishes. When OFF, it stays loaded for faster re-generation."
                style={{
                  display: 'flex', alignItems: 'center', gap: 4, fontSize: '11px',
                  cursor: 'pointer', color: autoUnload ? '#ffd740' : '#a0a0b0',
                  userSelect: 'none'
                }}
              >
                <input
                  type="checkbox"
                  checked={autoUnload}
                  onChange={e => setAutoUnload(e.target.checked)}
                  style={{ accentColor: '#ffd740' }}
                />
                Auto-Unload
              </label>

              {modelLoaded ? (
                <button className="btn btn--secondary" style={{ padding: '2px 6px', fontSize: '10px' }} onClick={handleUnloadModel} disabled={unloadingModel || generating}>
                  {unloadingModel ? 'Release...' : 'Release VRAM'}
                </button>
              ) : (
                <button 
                  className="btn btn--accent" 
                  style={{ padding: '2px 6px', fontSize: '10px' }}
                  onClick={handleLoadModel} 
                  disabled={loadingModel || generating || (!modelInstalled[selectedModel] && !((modelsList.find(m => m.id === selectedModel) || {}).hf_cached)) || downloadingState.downloading}
                  title={(!modelInstalled[selectedModel] && !((modelsList.find(m => m.id === selectedModel) || {}).hf_cached)) ? "Please download the model first" : "Load model into VRAM"}
                >
                  {loadingModel ? 'Loading...' : 'Preload Model'}
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Layout */}
      <div className="main-layout" ref={mainLayoutRef}>
        
        {/* Left Config Panel */}
        <div className="left-panel" style={{ width: `${splitPercent}%`, flexShrink: 0 }}>
          {characters.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-secondary)' }}>
              No characters found in active script. Set up a dialogue in the main workspace first.
            </div>
          ) : (
            characters.map(char => {
              const config = voiceConfigs[char.id] || { type: 'default', refPath: '', refText: '', presetName: '' };
              return (
                <div key={char.id} className="card" style={{ borderLeft: `4px solid ${char.color}` }}>
                  <div className="card__header">
                    <h3 className="card__title">
                      <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: char.color }} />
                      {char.name}
                    </h3>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className="btn btn--secondary" style={{ padding: '3px 8px', fontSize: '11px' }} onClick={() => handleSaveAsPreset(char.id, char.name)} disabled={generating}>
                        Save Preset
                      </button>
                    </div>
                  </div>

                  <div className="form-row">
                    <span style={{ width: 85, color: '#a0a0b0' }}>Voice Source:</span>
                    <select
                      className="form-control"
                      value={config.type}
                      onChange={(e) => handleConfigTypeChange(char.id, e.target.value)}
                      disabled={generating}
                    >
                      <option value="default">Default Library Voice</option>
                      <option value="preset" disabled={presets.length === 0}>Saved Preset Voice</option>
                      <option value="custom">Custom Voice Clip (.wav)</option>
                    </select>
                  </div>

                  {/* Config options based on type */}
                  {config.type === 'default' && (
                    <div className="form-row">
                      <span style={{ width: 85, color: '#a0a0b0' }}>Library Select:</span>
                      <select
                        className="form-control"
                        value={config.presetName}
                        onChange={(e) => handleSelectDefaultVoice(char.id, e.target.value)}
                        disabled={generating}
                      >
                        {defaultVoices.map(v => (
                          <option key={v.name} value={v.name}>{v.name}</option>
                        ))}
                      </select>
                    </div>
                  )}

                  {config.type === 'preset' && (
                    <div className="form-row">
                      <span style={{ width: 85, color: '#a0a0b0' }}>Preset Select:</span>
                      <select
                        className="form-control"
                        value={config.presetName}
                        onChange={(e) => handleSelectPreset(char.id, e.target.value)}
                        disabled={generating}
                      >
                        {presets.map(p => (
                          <option key={p.name} value={p.name}>{p.name}</option>
                        ))}
                      </select>
                    </div>
                  )}

                  {config.type === 'custom' && (
                    <div className="form-row">
                      <span style={{ width: 85, color: '#a0a0b0' }}>File Path:</span>
                      <input
                        type="text"
                        className="form-control"
                        value={config.refPath}
                        readOnly
                        placeholder="Click choose file..."
                        disabled={generating}
                      />
                      <button className="btn btn--secondary" onClick={() => handleSelectAudioFile(char.id)} disabled={generating}>
                        Browse
                      </button>
                    </div>
                  )}

                  {/* Reference audio playback preview */}
                  {config.refPath && (
                    <div className="form-row">
                      <span style={{ width: 85, color: '#a0a0b0' }}>Preview Reference:</span>
                      <button
                        className={`play-btn ${playingAudio === config.refPath ? 'play-btn--active' : ''}`}
                        onClick={() => togglePlayAudio(config.refPath)}
                      >
                        {playingAudio === config.refPath ? '■' : '▶'}
                      </button>
                      <span style={{ fontSize: '11px', color: '#a0a0b0', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', flex: 1 }}>
                        {config.refPath.split(/[\\/]/).pop()}
                      </span>
                    </div>
                  )}

                  {/* Reference transcript text - always editable */}
                  <div className="form-row" style={{ alignItems: 'flex-start' }}>
                    <span style={{ width: 85, color: '#a0a0b0', marginTop: 6 }}>Reference Text:</span>
                    <textarea
                      className="form-control textarea-control"
                      value={config.refText || ''}
                      onChange={(e) => handleTranscriptChange(char.id, e.target.value)}
                      placeholder="Type exactly what is spoken in the reference voice clip..."
                      disabled={generating}
                    />
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Draggable Resizer */}
        <div className="resizer-bar" onMouseDown={handleResizerMouseDown} title="Drag to resize panels" />

        {/* Right Output & Progress Panel */}
        <div className="right-panel" style={{ flex: 1, height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 className="card__title" style={{ color: '#fff' }}>Audio & Captions Sync</h3>
          </div>

          <div className="form-row">
            <span>Clip Pause:</span>
            <input
              type="number"
              className="form-control input-number"
              value={pauseDuration}
              onChange={(e) => setPauseDuration(parseFloat(e.target.value) || 0)}
              step="0.1"
              min="0"
              disabled={generating}
            />
            <span style={{ fontSize: '11px', color: '#a0a0b0' }}>seconds added between lines</span>
          </div>

          {/* Model-specific Parameters */}
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            marginTop: 2,
            padding: 8,
            background: 'var(--bg-primary, #0f0f15)',
            border: '1px solid var(--border-strong, rgba(255, 255, 255, 0.08))',
            borderRadius: '6px'
          }}>
            <span style={{ fontSize: '12px', fontWeight: 'bold', color: '#ffffff', display: 'flex', alignItems: 'center', gap: 6 }}>
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
              Model Settings ({MODEL_NAMES[selectedModel] || selectedModel})
            </span>

            {/* Temperature parameter */}
            <div className="form-row" style={{ justifyContent: 'space-between' }}>
              <span style={{ color: '#a0a0b0', minWidth: 80 }}>Temperature:</span>
              <input
                type="range"
                min="0.0"
                max="2.0"
                step="0.05"
                value={temperature}
                onChange={(e) => setTemperature(parseFloat(e.target.value) === 0 ? 0.0 : (parseFloat(e.target.value) || 0.0))}
                style={{ flex: 1, accentColor: 'var(--accent-primary, #7c4dff)', cursor: 'pointer' }}
                disabled={generating}
              />
              <span style={{ fontSize: '11px', color: '#a0a0b0', minWidth: '45px', textAlign: 'right' }}>
                {temperature === 0 ? 'Greedy' : temperature.toFixed(2)}
              </span>
              <input
                type="number"
                className="form-control input-number"
                min="0.0"
                max="2.0"
                step="0.05"
                value={temperature}
                onChange={(e) => {
                  let val = parseFloat(e.target.value);
                  if (isNaN(val)) return;
                  val = Math.max(0.0, Math.min(2.0, val));
                  setTemperature(val);
                }}
                style={{ width: '60px', padding: '4px 6px', textAlign: 'center' }}
                disabled={generating}
              />
            </div>

            {/* Speed parameter (compatible with LuxTTS only) */}
            {selectedModel === 'luxtts' && (
              <div className="form-row" style={{ justifyContent: 'space-between' }}>
                <span style={{ color: '#a0a0b0', minWidth: 80 }}>Speed:</span>
                <input
                  type="range"
                  min="0.5"
                  max="2.0"
                  step="0.1"
                  value={speed}
                  onChange={(e) => setSpeed(parseFloat(e.target.value) || 1.0)}
                  style={{ flex: 1, accentColor: 'var(--accent-primary, #7c4dff)', cursor: 'pointer' }}
                  disabled={generating}
                />
                <input
                  type="number"
                  className="form-control input-number"
                  min="0.5"
                  max="2.0"
                  step="0.1"
                  value={speed}
                  onChange={(e) => {
                    let val = parseFloat(e.target.value);
                    if (isNaN(val)) return;
                    val = Math.max(0.5, Math.min(2.0, val));
                    setSpeed(val);
                  }}
                  style={{ width: '60px', padding: '4px 6px', textAlign: 'center' }}
                  disabled={generating}
                />
              </div>
            )}

            {/* S2 Pro engine parameters (s2.cpp CLI) */}
            {selectedModel === 's2pro' && (
              <>
                <div className="form-row" style={{ justifyContent: 'space-between' }}>
                  <span style={{ color: '#a0a0b0', minWidth: 80 }}>Top-P:</span>
                  <input
                    type="range"
                    min="0.0"
                    max="1.0"
                    step="0.05"
                    value={topP}
                    onChange={(e) => setTopP(parseFloat(e.target.value) || 0.8)}
                    style={{ flex: 1, accentColor: 'var(--accent-primary, #7c4dff)', cursor: 'pointer' }}
                    disabled={generating}
                  />
                  <input
                    type="number"
                    className="form-control input-number"
                    min="0.0"
                    max="1.0"
                    step="0.05"
                    value={topP}
                    onChange={(e) => {
                      let val = parseFloat(e.target.value);
                      if (isNaN(val)) return;
                      val = Math.max(0.0, Math.min(1.0, val));
                      setTopP(val);
                    }}
                    style={{ width: '60px', padding: '4px 6px', textAlign: 'center' }}
                    disabled={generating}
                  />
                </div>

                <div className="form-row" style={{ justifyContent: 'space-between' }}>
                  <span style={{ color: '#a0a0b0', minWidth: 80 }}>Top-K:</span>
                  <input
                    type="range"
                    min="1"
                    max="100"
                    step="1"
                    value={topK}
                    onChange={(e) => setTopK(parseInt(e.target.value, 10) || 30)}
                    style={{ flex: 1, accentColor: 'var(--accent-primary, #7c4dff)', cursor: 'pointer' }}
                    disabled={generating}
                  />
                  <input
                    type="number"
                    className="form-control input-number"
                    min="1"
                    max="100"
                    step="1"
                    value={topK}
                    onChange={(e) => {
                      let val = parseInt(e.target.value, 10);
                      if (isNaN(val)) return;
                      val = Math.max(1, Math.min(100, val));
                      setTopK(val);
                    }}
                    style={{ width: '60px', padding: '4px 6px', textAlign: 'center' }}
                    disabled={generating}
                  />
                </div>

                <div className="form-row" style={{ justifyContent: 'space-between' }}>
                  <span style={{ color: '#a0a0b0', minWidth: 80 }}>Max Tokens:</span>
                  <input
                    type="number"
                    className="form-control input-number"
                    min="64"
                    max="2048"
                    step="64"
                    value={maxTokens}
                    onChange={(e) => {
                      let val = parseInt(e.target.value, 10);
                      if (isNaN(val)) return;
                      val = Math.max(64, Math.min(2048, val));
                      setMaxTokens(val);
                    }}
                    style={{ width: '110px', padding: '4px 6px', textAlign: 'center' }}
                    disabled={generating}
                  />
                </div>

                <div className="form-row" style={{ justifyContent: 'space-between' }}>
                  <span style={{ color: '#a0a0b0', minWidth: 80 }}>GPU Layers:</span>
                  <input
                    type="number"
                    className="form-control input-number"
                    min="-1"
                    max="36"
                    step="1"
                    value={gpuLayers}
                    onChange={(e) => {
                      let val = parseInt(e.target.value, 10);
                      if (isNaN(val)) return;
                      val = Math.max(-1, Math.min(36, val));
                      setGpuLayers(val);
                    }}
                    style={{ width: '110px', padding: '4px 6px', textAlign: 'center' }}
                    disabled={generating}
                  />
                  <span style={{ fontSize: '11px', color: '#a0a0b0' }}>(-1 = auto, 0 = CPU)</span>
                </div>

                <div className="form-row" style={{ justifyContent: 'space-between' }}>
                  <span style={{ color: '#a0a0b0', minWidth: 80 }}>Backend:</span>
                  <select
                    className="form-control"
                    value={s2Backend}
                    onChange={(e) => setS2Backend(e.target.value)}
                    disabled={generating}
                    style={{ width: '150px', flex: 'none' }}
                  >
                    <option value="auto">Auto (CUDA if present)</option>
                    <option value="cuda">CUDA (NVIDIA)</option>
                    <option value="vulkan">Vulkan (AMD/Intel)</option>
                    <option value="cpu">CPU only</option>
                  </select>
                </div>

                {s2Caps && !s2Caps.cuda && !s2Caps.vulkan && (
                  <div style={{ fontSize: '10px', color: '#ffab40', lineHeight: 1.5, padding: '5px 8px', background: 'rgba(255, 171, 64, 0.08)', border: '1px solid rgba(255, 171, 64, 0.25)', borderRadius: '4px' }}>
                    ⚠ This s2 engine build has no GPU support (no CUDA/Vulkan compiled in). "Auto" will run on CPU + system RAM. Use LuxTTS / Qwen3-TTS for GPU generation, or rebuild s2.cpp with a GPU backend.
                  </div>
                )}
                {s2Caps && (s2Caps.cuda || s2Caps.vulkan) && (
                  <div style={{ fontSize: '10px', color: '#00e676', lineHeight: 1.5, padding: '5px 8px', background: 'rgba(0, 230, 118, 0.08)', border: '1px solid rgba(0, 230, 118, 0.25)', borderRadius: '4px' }}>
                    ✓ GPU backend detected: {s2Caps.cuda ? 'CUDA' : 'Vulkan'}. "Auto" will use the GPU.
                  </div>
                )}

                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '12px', color: codecCpu ? '#ffd740' : '#a0a0b0', cursor: 'pointer', userSelect: 'none' }}>
                  <input
                    type="checkbox"
                    checked={codecCpu}
                    onChange={e => setCodecCpu(e.target.checked)}
                    style={{ accentColor: '#ffd740' }}
                    disabled={generating}
                  />
                  Keep audio codec on CPU (saves VRAM)
                </label>

                <div style={{ fontSize: '10px', color: '#808090', lineHeight: 1.5, padding: '6px 8px', background: 'rgba(255,255,255,0.03)', borderRadius: '4px' }}>
                  <strong style={{ color: '#ffd740' }}>VRAM guide (Q4_K_M):</strong> full offload ≈ 7.2 GB · 6-7 GB VRAM → GPU Layers 18 + Codec CPU · &lt;6 GB → GPU Layers ≤10 + Codec CPU. Engine: s2.cpp (github.com/rodrigomatta/s2.cpp) — place s2.exe in models/s2pro/ or s2.cpp/build/. Research/non-commercial license (Fish Audio).
                </div>
              </>
            )}
          </div>

          {/* Script sequence list */}
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '6px 0 4px' }}>
              <h4 style={{ fontSize: '12px', margin: 0, color: '#a0a0b0' }}>Script Order Preview</h4>
              {generating && currentBlockIndex >= 0 && (
                <span style={{ fontSize: '10px', background: 'rgba(0, 229, 255, 0.15)', color: '#00e5ff', border: '1px solid #00e5ff55', padding: '1px 6px', borderRadius: '4px', fontWeight: 'bold' }}>
                  🎙️ Synthesizing Line {currentBlockIndex + 1}/{dialogueBlocks.length}
                </span>
              )}
            </div>
            <div className="script-preview">
              {mergedPreviewActive ? (() => {
                const mergedBlock = generatedResult?.dialogueBlocks?.find(b => !!b.wavPath);
                const wavPath = mergedBlock?.wavPath;
                return (
                  <div
                    className="script-item script-item--active"
                    style={{ display: 'flex', alignItems: 'center', gap: '8px', borderLeftColor: '#00e5ff', background: 'rgba(0, 229, 255, 0.06)' }}
                  >
                    {generating ? (
                      <span className="spinner-sm" style={{ marginRight: 2 }} />
                    ) : wavPath ? (
                      <button
                        className={`play-btn ${playingAudio === wavPath ? 'play-btn--active' : ''}`}
                        style={{ flexShrink: 0, marginRight: '4px' }}
                        onClick={() => togglePlayAudio(wavPath)}
                      >
                        {playingAudio === wavPath ? '■' : '▶'}
                      </button>
                    ) : null}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <span className="script-item__char" style={{ color: '#00e5ff' }}>Full Script — reads whole script as one audio ({scriptOnlyBlocks.length} lines merged):</span>
                      <div
                        style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}
                        title={mergedScriptText}
                      >
                        {mergedScriptText}
                      </div>
                    </div>
                    {wavPath ? (
                      <span style={{ fontSize: '9px', color: '#00e5ffcc', flexShrink: 0 }}>
                        single audio · {mergedBlock?.duration != null ? mergedBlock.duration.toFixed(1) + 's' : ''}
                      </span>
                    ) : (
                      <span style={{ fontSize: '9px', color: '#00e5ff88', flexShrink: 0 }}>generates 1 audio file</span>
                    )}
                  </div>
                );
              })() : dialogueBlocks.map((block, idx) => {
                const genBlock = generatedResult?.dialogueBlocks?.find(b => b.id === block.id);
                const wavPath = genBlock?.wavPath;
                const isSynthesizing = generating && idx === currentBlockIndex;
                return (
                  <div
                    key={block.id}
                    className={`script-item ${idx === currentBlockIndex ? 'script-item--active' : ''} ${isSynthesizing ? 'script-item--generating' : ''}`}
                    style={{ display: 'flex', alignItems: 'center', gap: '8px', position: 'relative' }}
                  >
                    {isSynthesizing && (
                      <span className="spinner-sm" style={{ marginRight: 2 }} />
                    )}
                    {wavPath && !isSynthesizing && (
                      <button
                        className={`play-btn ${playingAudio === wavPath ? 'play-btn--active' : ''}`}
                        style={{ flexShrink: 0, marginRight: '4px' }}
                        onClick={() => togglePlayAudio(wavPath)}
                      >
                        {playingAudio === wavPath ? '■' : '▶'}
                      </button>
                    )}
                    <div style={{ flex: 1 }}>
                      <span className="script-item__char" style={{ color: block.color }}>{block.characterName || 'Narrator'}:</span>
                      <span>{(block.text || '').trim() || (block.imageName ? block.imageName.replace(/\.[^.]+$/, '') : '(no text)')}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Progress Section */}
          <div className="progress-section">
            <div className="progress-header">
              <span>{generating ? 'Synthesizing voice tracks...' : 'Pipeline Ready'}</span>
              <span>{Math.round(generationProgress)}%</span>
            </div>
            <div className="bar-outer">
              <div className="bar-inner" style={{ width: `${generationProgress}%` }} />
            </div>
          </div>

          {/* Action / Preview / Apply Buttons */}
          {generatedResult ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '8px' }}>
              <button
                className="btn btn--secondary"
                style={{ width: '100%', padding: '10px', fontWeight: 'bold', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                onClick={handleDiscardResult}
                disabled={generating}
              >
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0 }}><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                Discard Generated Clips
              </button>
              <button
                className="btn btn--success"
                style={{ width: '100%', padding: '12px', fontSize: '14px', fontWeight: 'bold', background: '#00e676', color: '#060609', border: 'none', borderRadius: '4px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                onClick={handleApplyResult}
              >
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ flexShrink: 0 }}><polyline points="20 6 9 17 4 12"/></svg>
                {redoBlockId ? 'Apply Selected Clip' : 'Accept & Add to Media Library'}
              </button>
            </div>
          ) : (
            <button
              className="btn btn--accent"
              style={{ width: '100%', padding: '12px', fontSize: '14px', fontWeight: 'bold', marginBottom: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
              onClick={handleGenerateVoiceover}
              disabled={generating || !serverOnline}
            >
              {generating ? (
                <>
                  <span className="spinner-sm" />
                  Running AI Voiceover...
                </>
              ) : (
                <>
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ flexShrink: 0 }}><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/></svg>
                  Generate Voiceover
                </>
              )}
            </button>
          )}

          {/* System Operations Log (Enlarged - fills remaining space) */}
          <div style={{ display: 'flex', flexDirection: 'column', flex: '1 1 auto', minHeight: '240px', marginTop: '4px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
              <span style={{ fontSize: '11px', color: '#a0a0b0', fontWeight: '600' }}>Operations Log</span>
              {genLogs.length > 0 && (
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    onClick={handleCopyLogs}
                    style={{ background: 'none', border: 'none', color: logCopied ? '#00e676' : '#666677', fontSize: '10px', cursor: 'pointer', padding: '0 4px' }}
                  >
                    {logCopied ? 'Copied!' : 'Copy Log'}
                  </button>
                  <button
                    onClick={() => setGenLogs([])}
                    style={{ background: 'none', border: 'none', color: '#666677', fontSize: '10px', cursor: 'pointer', padding: '0 4px' }}
                  >
                    Clear Log
                  </button>
                </div>
              )}
            </div>
            <div className="logs-container" ref={logsEndRef}>
              {genLogs.length === 0 ? (
                <div style={{ color: '#444455', fontStyle: 'italic', padding: '4px' }}>No active processes logged yet.</div>
              ) : (
                genLogs.map((log, idx) => {
                  const isErr = log.includes('Error') || log.includes('Failed') || log.includes('missing');
                  const isSucc = log.includes('Success') || log.includes('completed');
                  const isLoad = log.includes('Loading') || log.includes('Requesting');
                  return (
                    <div
                      key={idx}
                      className={`log-entry ${isErr ? 'log-entry--error' : isSucc ? 'log-entry--success' : isLoad ? 'log-entry--loading' : ''}`}
                    >
                      {log}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

      </div>

      {/* Uninstall Confirmation Modal */}
      {showUninstallConfirm && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.7)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 10000
        }}>
          <div style={{
            background: '#1a1a24',
            border: '1px solid var(--border-strong, #3e3e3e)',
            borderRadius: '6px',
            padding: '20px',
            width: '320px',
            boxShadow: 'var(--shadow-lg)',
            display: 'flex',
            flexDirection: 'column',
            gap: 16
          }}>
            <h3 style={{ margin: 0, fontSize: '15px', color: '#ffffff' }}>Confirm Uninstallation</h3>
            <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-secondary)', lineHeight: '1.4' }}>
              Are you sure you want to uninstall the <strong>{MODEL_NAMES[showUninstallConfirm] || showUninstallConfirm}</strong> model from this device? This will free up local disk space.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button 
                className="btn btn--secondary" 
                onClick={() => setShowUninstallConfirm(null)}
                style={{ padding: '6px 12px', fontSize: '12px' }}
              >
                Cancel
              </button>
              <button 
                className="btn" 
                onClick={() => handleUninstallModel(showUninstallConfirm)}
                style={{ background: '#ff5252', color: '#ffffff', padding: '6px 12px', fontSize: '12px' }}
              >
                Uninstall
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
