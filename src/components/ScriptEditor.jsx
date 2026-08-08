import React, { useState, useRef, useEffect } from 'react';
import { useProject } from '../store/ProjectContext';
import { detectSilenceSegments, matchBlocksToSegments } from '../engine/scriptParser';
import { getInterpolatedKeyframeTransform } from '../engine/animationEngine';
import { formatTime, readFileAsDataUrl } from '../utils/fileHelpers';

const STYLE_PRESETS = {
  'tiktok-karaoke': {
    fontFamily: 'Impact',
    caseMode: 'uppercase',
    wordsPerLine: 3,
    color: '#ffffff',
    highlightColor: '#ffd21e',
    enableHighlight: true,
    strokeColor: '#000000',
    strokeWidth: 5,
    shadowColor: 'rgba(0,0,0,0.5)',
    shadowBlur: 10,
    shadowOffsetX: 3,
    shadowOffsetY: 3,
    showBackground: false,
    scaleBounce: true,
  },
  'insta-minimalist': {
    fontFamily: 'Inter',
    caseMode: 'none',
    wordsPerLine: 3,
    color: '#ffffff',
    highlightColor: '#b0bec5',
    enableHighlight: true,
    strokeColor: '#000000',
    strokeWidth: 0,
    shadowColor: 'rgba(0,0,0,0)',
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    showBackground: true,
    backgroundColor: 'rgba(0,0,0,0.65)',
    backgroundPadding: 12,
    scaleBounce: false,
  },
  'beast-glow': {
    fontFamily: 'Montserrat',
    caseMode: 'uppercase',
    wordsPerLine: 2,
    color: '#ffffff',
    highlightColor: '#00e676',
    enableHighlight: true,
    strokeColor: '#000000',
    strokeWidth: 6,
    glowColor: 'rgba(0,230,118,0.7)',
    glowBlur: 15,
    shadowColor: 'rgba(0,0,0,0.5)',
    shadowBlur: 8,
    shadowOffsetX: 4,
    shadowOffsetY: 4,
    showBackground: false,
    scaleBounce: true,
  },
  'retro-typewriter': {
    fontFamily: 'Courier New',
    caseMode: 'lowercase',
    wordsPerLine: 4,
    color: '#ffffff',
    enableHighlight: false,
    strokeColor: '#000000',
    strokeWidth: 0,
    shadowColor: 'rgba(0,0,0,0)',
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    showBackground: true,
    backgroundColor: 'rgba(0,0,0,0.85)',
    backgroundPadding: 8,
    scaleBounce: false,
  }
};

/**
 * Script Editor & Inspector Panel
 * Features: Raw Script parsing, Dialogue Blocks list, and an Inspector Tab
 * to configure text styling options and character animations.
 */
export default function ScriptEditor({ onMinimize }) {
  const { state, actions } = useProject();
  const [activeTab, setActiveTab] = useState('script'); // 'script' | 'dialogue' | 'animations' | 'inspector' | 'presets'
  const [editingKeyword, setEditingKeyword] = useState(null);
  const [newKeywordName, setNewKeywordName] = useState('');
  const [styleTarget, setStyleTarget] = useState('character'); // 'character' | 'clip'
  const [selectedCharacterId, setSelectedCharacterId] = useState('');
  const [activeProp, setActiveProp] = useState('x'); // 'x' | 'y' | 'scale' | 'rotation' | 'opacity'
  const [draggingKf, setDraggingKf] = useState(null);
  const blocksRef = useRef(null);
  const lastTimeupdateRef = useRef(-1);

  const [customPresets, setCustomPresets] = useState([]);
  const [newPresetName, setNewPresetName] = useState('');
  const [defaultPreset, setDefaultPreset] = useState(null);

  const loadCustomPresets = async () => {
    if (window.electronAPI && window.electronAPI.loadCharacterPresets) {
      const list = await window.electronAPI.loadCharacterPresets();
      setCustomPresets(list || []);
    }
  };

  useEffect(() => {
    const initPresets = async () => {
      if (window.electronAPI) {
        await loadCustomPresets();

        const projectPath = await window.electronAPI.getProjectPath();
        const projectPathNormalized = projectPath.replace(/\\/g, '/');
        setDefaultPreset({
          name: 'Peter & Stewie',
          characters: [
            {
              id: 'char_stewie',
              name: 'Stewie',
              colorIndex: 0,
              assetPath: `${projectPathNormalized}/assets/characters/stewie.png`,
              voice: {
                type: 'default',
                refPath: `${projectPathNormalized}/assets/default_voices/stewie_ref.wav`,
                refText: 'all this time spent keeping people from having sex and now i know how the catholic church feels buzzing',
                presetName: 'stewie'
              }
            },
            {
              id: 'char_peter',
              name: 'Peter',
              colorIndex: 1,
              assetPath: `${projectPathNormalized}/assets/characters/peter.png`,
              voice: {
                type: 'default',
                refPath: `${projectPathNormalized}/assets/default_voices/peter_ref.wav`,
                refText: "I'm gonna stare at his wife's boobs so hide that when they both go into the kitchen together it will be discussed",
                presetName: 'peter'
              }
            }
          ]
        });
      }
    };
    initPresets();
  }, []);

  const handleApplyAnimToAll = (characterId) => {
    const block = state.dialogueBlocks.find(b => b.id === state.selectedClipId);
    if (!block) return;
    const anim = block.animation || {
      entrance: 'slide-up',
      exit: 'slide-down',
      entranceDuration: 0.3,
      exitDuration: 0.3,
      sustain: 'none',
      sustainIntensity: 0.5,
      sustainSpeed: 0.5,
    };
    actions.batchUpdateAnimation(characterId, anim);
    if (characterId) {
      actions.addToast(`Applied animation to all clips of ${block.characterName}`, 'success');
    } else {
      actions.addToast('Applied animation to all clips in project', 'success');
    }
  };

  // Keydown delete keyframe listener
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const activeEl = document.activeElement;
        if (
          activeEl &&
          (activeEl.tagName === 'INPUT' ||
            activeEl.tagName === 'TEXTAREA' ||
            activeEl.tagName === 'BUTTON' ||
            activeEl.tagName === 'SELECT' ||
            activeEl.hasAttribute('contenteditable'))
        ) {
          return;
        }
        // Only handle the keyframe when no timeline clip is selected —
        // otherwise App.jsx's Delete handler deletes the clip and both
        // would fire for one press.
        if (!state.selectedClipId && state.selectedElementId && state.selectedKeyframeIndex !== null) {
          const char = state.characters.find(c => c.id === state.selectedElementId);
          if (char && char.keyframes && char.keyframes[state.selectedKeyframeIndex]) {
            actions.removeCharacterKeyframe(char.id, state.selectedKeyframeIndex);
            actions.selectKeyframe(null);
            actions.addToast('Deleted keyframe', 'info');
          }
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [state.selectedElementId, state.selectedKeyframeIndex, state.characters, state.selectedClipId]);

  // Auto-switch tabs when elements are selected
  useEffect(() => {
    if (state.selectedElementId) {
      setActiveTab('inspector');
    } else if (state.selectedClipId) {
      setActiveTab('animations');
    }
  }, [state.selectedElementId, state.selectedClipId]);

  // Keep a ref to totalDuration to avoid effect re-subscriptions
  const totalDurationRef = useRef(state.totalDuration);
  useEffect(() => {
    totalDurationRef.current = state.totalDuration;
  }, [state.totalDuration]);

  // Direct DOM listeners to handle 60 FPS playhead updates with 0 React renders
  useEffect(() => {
    const onTimeUpdate = (e) => {
      const t = e.detail;

      // Skip duplicate events within the same frame
      if (t === lastTimeupdateRef.current) return;
      lastTimeupdateRef.current = t;

      // 1. Update active dialogue block classes directly in DOM.
      // Block elements are cached on first lookup so the scan is O(1) per frame.
      if (!blocksRef.current) {
        blocksRef.current = Array.from(document.querySelectorAll('.dialogue-block'));
      }
      const blocks = blocksRef.current;
      for (let i = 0; i < blocks.length; i++) {
        const el = blocks[i];
        const start = parseFloat(el.getAttribute('data-start'));
        const duration = parseFloat(el.getAttribute('data-duration'));
        if (!isNaN(start) && !isNaN(duration)) {
          const active = t >= start && t < start + duration;
          const hasActive = el.classList.contains('dialogue-block--active');
          if (active !== hasActive) {
            el.classList.toggle('dialogue-block--active', active);
          }
        }
      }

      // 2. Update animation graph playhead line directly in DOM
      const graphPlayhead = document.querySelector('.graph-playhead-line');
      if (graphPlayhead) {
        const svgWidth = 800;
        const paddingX = 40;
        const totalDuration = totalDurationRef.current || 30;
        const x = paddingX + (t / totalDuration) * (svgWidth - 2 * paddingX);
        graphPlayhead.setAttribute('x1', x);
        graphPlayhead.setAttribute('x2', x);
      }
    };

    window.addEventListener('timeupdate', onTimeUpdate);
    return () => window.removeEventListener('timeupdate', onTimeUpdate);
  }, []);

  // Invalidate the cached block list whenever the dialogue list re-renders
  useEffect(() => {
    blocksRef.current = null;
  }, [state.dialogueBlocks]);

  const handleScriptChange = (e) => {
    actions.setScript(e.target.value);
  };

  const handleParse = () => {
    actions.parseScript(state.scriptText);
    setActiveTab('dialogue');
    actions.addToast('Script parsed successfully!', 'success');
  };

  const handleBlockTimingChange = (blockId, field, value) => {
    const numValue = parseFloat(value);
    if (isNaN(numValue) || numValue < 0) return;
    if (field === 'startTime') {
      actions.updateBlockTiming(blockId, numValue, undefined);
    } else if (field === 'duration') {
      actions.updateBlockTiming(blockId, undefined, numValue);
    }
  };

  const handleAddKeyword = () => {
    if (newKeywordName.trim()) {
      actions.addCharacter(newKeywordName.trim());
      setNewKeywordName('');
      actions.addToast(`Added character: ${newKeywordName.trim()}`, 'success');
    }
  };

  const handleAssignAsset = async (characterId) => {
    if (window.electronAPI) {
      const paths = await window.electronAPI.openFileDialog({
        filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }],
      });
      if (paths && paths.length > 0) {
        const fileData = await window.electronAPI.readFile(paths[0]);
        if (!fileData.error) {
          const asset = {
            name: fileData.name,
            path: fileData.path,
            dataUrl: `data:${fileData.mime};base64,${fileData.data}`,
          };
          actions.assignCharacterAsset(characterId, asset);
          actions.addToast(`Assigned asset to character`, 'success');
        }
      }
    } else {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const dataUrl = await readFileAsDataUrl(file);
        const asset = {
          name: file.name,
          path: file.name,
          dataUrl,
        };
        actions.assignCharacterAsset(characterId, asset);
        actions.addToast(`Assigned ${file.name} to character`, 'success');
      };
      input.click();
    }
  };

  const handleAutoTime = () => {
    if (state.dialogueBlocks.length === 0) return;
    let currentTime = 0;
    const updatedBlocks = state.dialogueBlocks.map(block => {
      const newBlock = { ...block, startTime: currentTime };
      currentTime += block.duration;
      return newBlock;
    });
    actions.setBlocks(updatedBlocks);
    actions.addToast('Auto-timed dialogue blocks', 'success');
  };

  const handleSilenceDetect = async () => {
    if (!state.audioFile) {
      actions.addToast('No audio file loaded', 'error');
      return;
    }

    try {
      const audioCtx = new AudioContext();
      let arrayBuffer;
      if (window.electronAPI && state.audioFile.path) {
        const fileBuffer = await window.electronAPI.readFileBuffer(state.audioFile.path);
        if (fileBuffer && !fileBuffer.error && fileBuffer.byteLength > 0) {
          arrayBuffer = new ArrayBuffer(fileBuffer.byteLength);
          new Uint8Array(arrayBuffer).set(fileBuffer);
        } else {
          throw new Error(fileBuffer?.error || "Failed to read file buffer or buffer is empty");
        }
      } else {
        const response = await fetch(state.audioFile.dataUrl);
        arrayBuffer = await response.arrayBuffer();
      }
      const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
      
      actions.setAudioBuffer(audioBuffer);
      
      const segments = detectSilenceSegments(audioBuffer);
      
      if (segments.length > 0 && state.dialogueBlocks.length > 0) {
        const updatedBlocks = matchBlocksToSegments(state.dialogueBlocks, segments);
        actions.setBlocks(updatedBlocks);
        actions.addToast(`Matched ${Math.min(segments.length, state.dialogueBlocks.length)} segments`, 'success');
      } else {
        actions.addToast('No speech segments detected', 'info');
      }
    } catch (err) {
      actions.addToast(`Audio analysis failed: ${err.message}`, 'error');
    }
  };

  const loadSampleScript = async () => {
    const sample = `**Stewie:** Look, Peter, building a video editor inside Electron is easy if you don't choke the UI thread. You just overlay a fast canvas for the free-transform handles and offload the heavy rendering to a local FFmpeg binary.

**Peter:** Yeah, well, what about the script parsing, smart guy? If I edit a paragraph or change a keyword, the whole timeline array has to recalculate its positions and shift every character animation block.

**Stewie:** It's basic reactive state tracking, you absolute buffoon! When a block's duration changes, you just apply a delta offset to the timestamps of every block that follows it on the timeline. It's junior-year data structures!

**Peter:** Oh yeah? Well I bet you can't even make the characters slide in and out smoothly. Every time I try, they just pop in like a broken PowerPoint.

**Stewie:** That's because you're not using proper easing functions, you philistine! A simple cubic bezier with an overshoot parameter gives you that bouncy entrance that the kids love. And for the exit, a quick ease-in-cubic fades them out before they slide off.

**Peter:** Hehehe... bouncy. Like that time I bounced on that trampoline at Chris's birthday party.`;

    actions.setScript(sample);
    actions.parseScript(sample);
    setActiveTab('dialogue');

    if (window.electronAPI) {
      try {
        const projectPath = await window.electronAPI.getProjectPath();
        const projectPathNormalized = projectPath.replace(/\\/g, '/');

        // Character asset paths
        const stewieImgPath = `${projectPathNormalized}/assets/characters/stewie.png`;
        const peterImgPath = `${projectPathNormalized}/assets/characters/peter.png`;

        // Voice reference audio files paths
        const stewieWavPath = `${projectPathNormalized}/assets/default_voices/stewie_ref.wav`;
        const peterWavPath = `${projectPathNormalized}/assets/default_voices/peter_ref.wav`;

        // Reading files to populate character PNG base64 data URLs
        const [stewieFileData, peterFileData] = await Promise.all([
          window.electronAPI.readFile(stewieImgPath),
          window.electronAPI.readFile(peterImgPath)
        ]);

        if (!stewieFileData.error) {
          const stewieAsset = {
            name: stewieFileData.name,
            path: stewieFileData.path,
            dataUrl: `data:${stewieFileData.mime};base64,${stewieFileData.data}`,
          };
          actions.assignCharacterAsset('char_stewie', stewieAsset);
        } else {
          console.warn("Stewie image file not found:", stewieFileData.error);
        }

        if (!peterFileData.error) {
          const peterAsset = {
            name: peterFileData.name,
            path: peterFileData.path,
            dataUrl: `data:${peterFileData.mime};base64,${peterFileData.data}`,
          };
          actions.assignCharacterAsset('char_peter', peterAsset);
        } else {
          console.warn("Peter image file not found:", peterFileData.error);
        }

        // Voice config references
        const stewieRefText = "all this time spent keeping people from having sex and now i know how the catholic church feels buzzing";
        const peterRefText = "I'm gonna stare at his wife's boobs so hide that when they both go into the kitchen together it will be discussed";

        const defaultVoiceConfigs = {
          char_stewie: {
            type: 'default',
            refPath: stewieWavPath,
            refText: stewieRefText,
            presetName: 'stewie'
          },
          char_peter: {
            type: 'default',
            refPath: peterWavPath,
            refText: peterRefText,
            presetName: 'peter'
          }
        };

        actions.setVoiceConfigs(defaultVoiceConfigs);
        actions.addToast('Sample script loaded with default voices and assets!', 'success');
      } catch (err) {
        console.error('Failed to load default assets and voices:', err);
        actions.addToast(`Sample script loaded, but assets failed: ${err.message}`, 'warning');
      }
    } else {
      actions.addToast('Sample script loaded!', 'success');
    }
  };

  // Helper to retrieve character styles safely
  const getCharacterStyle = (char) => {
    return char?.textStyle || {
      fontFamily: 'Impact',
      fontSize: 48,
      color: '#ffffff',
      strokeColor: '#000000',
      strokeWidth: 4,
      shadowColor: 'rgba(0,0,0,0.5)',
      shadowBlur: 10,
      shadowOffsetX: 2,
      shadowOffsetY: 2,
      glowColor: 'rgba(124, 77, 255, 0)',
      glowBlur: 0,
      backgroundColor: 'rgba(0,0,0,0.7)',
      backgroundPadding: 10,
      showBackground: false,
      letterSpacing: 2,
      lineHeight: 1.4,
      wordsPerLine: 3,
      caseMode: 'uppercase',
    };
  };

  const applyFullStyleTemplate = (charId, templateStyle) => {
    const char = state.characters.find(c => c.id === charId);
    if (!char) return;
    const selectedBlock = state.dialogueBlocks.find(b => b.id === state.selectedClipId);

    if (styleTarget === 'clip' && selectedBlock && selectedBlock.characterId === charId) {
      const blockStyle = selectedBlock.textStyle || {};
      actions.updateBlock(selectedBlock.id, {
        textStyle: { ...blockStyle, ...templateStyle }
      });
    } else {
      // Apply globally to character
      actions.updateCharacterStyle(charId, templateStyle);
      
      // Clear block-level overrides for these style properties
      const keys = Object.keys(templateStyle);
      const updatedBlocks = state.dialogueBlocks.map(b => {
        if (b.characterId === charId && b.textStyle) {
          const nextStyle = { ...b.textStyle };
          keys.forEach(k => delete nextStyle[k]);
          return { ...b, textStyle: nextStyle };
        }
        return b;
      });
      actions.setBlocks(updatedBlocks);
    }
    actions.addToast('Style preset template applied!', 'success');
  };

  const updateStyle = (charId, key, value) => {
    const char = state.characters.find(c => c.id === charId);
    if (!char) return;
    const currentStyle = getCharacterStyle(char);
    const selectedBlock = state.dialogueBlocks.find(b => b.id === state.selectedClipId);

    if (styleTarget === 'clip' && selectedBlock && selectedBlock.characterId === charId) {
      const blockStyle = selectedBlock.textStyle || {};
      actions.updateBlock(selectedBlock.id, {
        textStyle: { ...blockStyle, [key]: value }
      });
    } else {
      // Apply globally to character
      actions.updateCharacterStyle(charId, { ...currentStyle, [key]: value });
      
      // Clear block-level overrides for this style property to ensure consistency
      const updatedBlocks = state.dialogueBlocks.map(b => {
        if (b.characterId === charId && b.textStyle && b.textStyle.hasOwnProperty(key)) {
          const nextStyle = { ...b.textStyle };
          delete nextStyle[key];
          return { ...b, textStyle: nextStyle };
        }
        return b;
      });
      actions.setBlocks(updatedBlocks);
    }
  };

  const renderPngInspector = (selectedChar) => {
    const glowEnabled = selectedChar.pngGlowEnabled ?? false;
    const shadowEnabled = selectedChar.pngShadowEnabled ?? false;

    return (
      <div className="inspector-panel">
        <div className="inspector-header">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" style={{ color: selectedChar.color }}>
            <path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/>
          </svg>
          <span className="inspector-title">PNG Inspector: {selectedChar.name}</span>
        </div>

        <div className="inspector-section">
          <div className="form-row">
            <div className="form-group" style={{ flex: 2 }}>
              <label className="form-label">Character Name</label>
              <input
                type="text"
                className="form-input"
                value={selectedChar.name}
                onChange={(e) => actions.updateCharacter(selectedChar.id, { name: e.target.value })}
              />
            </div>
            <div className="form-group" style={{ flex: 1 }}>
              <label className="form-label">Color Theme</label>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input
                  type="color"
                  className="form-color-picker"
                  value={selectedChar.color}
                  onChange={(e) => actions.updateCharacter(selectedChar.id, { color: e.target.value })}
                />
                <span style={{ fontSize: '10px', fontFamily: 'var(--font-mono)' }}>{selectedChar.color}</span>
              </div>
            </div>
          </div>

          <div className="form-group" style={{ marginTop: 12 }}>
            <label className="form-label">Avatar Asset (Drag image here)</label>
            <div
              className="inspector-avatar-drop"
              onClick={() => handleAssignAsset(selectedChar.id)}
              onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }}
              onDrop={(e) => {
                e.preventDefault();
                try {
                  const dataStr = e.dataTransfer.getData('application/json');
                  if (!dataStr) return;
                  const dragData = JSON.parse(dataStr);
                  const item = state.mediaItems.find(m => m.id === dragData.id) || dragData;
                  if (item.type === 'image') {
                    actions.assignCharacterAsset(selectedChar.id, item);
                    actions.addToast(`Assigned ${item.name}`, 'success');
                  }
                } catch (err) {}
              }}
            >
              {selectedChar.asset ? (
                <>
                  <img src={selectedChar.asset.dataUrl} alt="" className="avatar-preview" />
                  <span className="avatar-label truncate">{selectedChar.asset.name}</span>
                </>
              ) : (
                <span className="avatar-placeholder" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
                  Click or drop PNG asset here
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="inspector-section-title">PNG Outer Glow Effect</div>
        <div className="inspector-section">
          <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginBottom: 8 }}>
            <input
              type="checkbox"
              id="pngGlowEnabled"
              checked={glowEnabled}
              onChange={(e) => actions.updateCharacter(selectedChar.id, { pngGlowEnabled: e.target.checked })}
              style={{ cursor: 'pointer' }}
            />
            <label htmlFor="pngGlowEnabled" className="form-label" style={{ margin: 0, cursor: 'pointer' }}>Enable Outer Glow</label>
          </div>

          {glowEnabled && (
            <>
              <div className="form-group" style={{ marginTop: 8 }}>
                <label className="form-label">Glow Color</label>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input
                    type="color"
                    className="form-color-picker"
                    value={selectedChar.pngGlowColor || '#00e5ff'}
                    onChange={(e) => actions.updateCharacter(selectedChar.id, { pngGlowColor: e.target.value })}
                  />
                  <span style={{ fontSize: '10px', fontFamily: 'var(--font-mono)' }}>{selectedChar.pngGlowColor || '#00e5ff'}</span>
                </div>
              </div>

              <div className="form-row-slider" style={{ marginTop: 8 }}>
                <div className="slider-header">
                  <span>Glow Size / Blur</span>
                  <span>{selectedChar.pngGlowSize ?? 15}px</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="50"
                  value={selectedChar.pngGlowSize ?? 15}
                  onChange={(e) => actions.updateCharacter(selectedChar.id, { pngGlowSize: parseInt(e.target.value) })}
                />
              </div>
            </>
          )}
        </div>

        <div className="inspector-section-title">PNG Drop Shadow Effect</div>
        <div className="inspector-section">
          <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginBottom: 8 }}>
            <input
              type="checkbox"
              id="pngShadowEnabled"
              checked={shadowEnabled}
              onChange={(e) => actions.updateCharacter(selectedChar.id, { pngShadowEnabled: e.target.checked })}
              style={{ cursor: 'pointer' }}
            />
            <label htmlFor="pngShadowEnabled" className="form-label" style={{ margin: 0, cursor: 'pointer' }}>Enable Drop Shadow</label>
          </div>

          {shadowEnabled && (
            <>
              <div className="form-group" style={{ marginTop: 8 }}>
                <label className="form-label">Shadow Color</label>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input
                    type="color"
                    className="form-color-picker"
                    value={selectedChar.pngShadowColor || '#000000'}
                    onChange={(e) => actions.updateCharacter(selectedChar.id, { pngShadowColor: e.target.value })}
                  />
                  <span style={{ fontSize: '10px', fontFamily: 'var(--font-mono)' }}>{selectedChar.pngShadowColor || '#000000'}</span>
                </div>
              </div>

              <div className="form-row-slider" style={{ marginTop: 8 }}>
                <div className="slider-header">
                  <span>Shadow Blur</span>
                  <span>{selectedChar.pngShadowBlur ?? 10}px</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="50"
                  value={selectedChar.pngShadowBlur ?? 10}
                  onChange={(e) => actions.updateCharacter(selectedChar.id, { pngShadowBlur: parseInt(e.target.value) })}
                />
              </div>

              <div className="form-row-slider" style={{ marginTop: 8 }}>
                <div className="slider-header">
                  <span>Offset X</span>
                  <span>{selectedChar.pngShadowOffsetX ?? 5}px</span>
                </div>
                <input
                  type="range"
                  min="-50"
                  max="50"
                  value={selectedChar.pngShadowOffsetX ?? 5}
                  onChange={(e) => actions.updateCharacter(selectedChar.id, { pngShadowOffsetX: parseInt(e.target.value) })}
                />
              </div>

              <div className="form-row-slider" style={{ marginTop: 8 }}>
                <div className="slider-header">
                  <span>Offset Y</span>
                  <span>{selectedChar.pngShadowOffsetY ?? 5}px</span>
                </div>
                <input
                  type="range"
                  min="-50"
                  max="50"
                  value={selectedChar.pngShadowOffsetY ?? 5}
                  onChange={(e) => actions.updateCharacter(selectedChar.id, { pngShadowOffsetY: parseInt(e.target.value) })}
                />
              </div>
            </>
          )}
        </div>

        <div style={{ padding: 12, textAlign: 'center', fontSize: 'var(--text-xs)', color: 'var(--text-disabled)', background: 'var(--surface-2)', borderRadius: 6, margin: 12 }}>
          💡 To edit caption fonts, colors, and layout, select the captions overlay directly in the video preview panel.
        </div>
      </div>
    );
  };

  // Render Inspector Panel based on what is selected
  const renderInspector = () => {
    // 1. Check if Character or Caption is selected
    let selectedChar = null;
    let isCaption = false;

    if (state.selectedElementId) {
      if (state.selectedElementId.startsWith('caption_')) {
        const charId = state.selectedElementId.replace('caption_', '');
        selectedChar = state.characters.find(c => c.id === charId);
        isCaption = true;
      } else {
        selectedChar = state.characters.find(c => c.id === state.selectedElementId);
      }
    }

    if (selectedChar) {
      if (!isCaption) {
        return renderPngInspector(selectedChar);
      }
      const selectedBlock = state.dialogueBlocks.find(b => b.id === state.selectedClipId);
      const style = {
        ...getCharacterStyle(selectedChar),
        ...((selectedBlock && selectedBlock.characterId === selectedChar.id && selectedBlock.textStyle) || {})
      };
      return (
        <div className="inspector-panel">
          <div className="inspector-header">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" style={{ color: selectedChar.color }}>
              <path d="M12 3c-4.97 0-9 4.03-9 9 0 2.12.74 4.07 1.97 5.61L4.35 19.4c-.39.39-.39 1.02 0 1.41.39.39 1.02.39 1.41 0l1.9-1.9C9.13 19.58 10.53 20 12 20c4.97 0 9-4.03 9-9s-4.03-9-9-9zm0 15c-3.31 0-6-2.69-6-6s2.69-6 6-6 6 2.69 6 6-2.69 6-6 6z"/>
            </svg>
            <span className="inspector-title">Caption Styling: {selectedChar.name}</span>
          </div>

          {/* Apply To Selector */}
          <div className="inspector-section" style={{ background: 'var(--accent-primary-glow)', borderColor: 'var(--border-accent)', padding: '10px 12px', gap: 6 }}>
            <label className="form-label" style={{ margin: 0 }}>Apply Style Changes To:</label>
            <div style={{ display: 'flex', gap: '8px 16px', flexWrap: 'wrap' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 'var(--text-xs)', color: 'var(--text-primary)', userSelect: 'none' }}>
                <input
                  type="radio"
                  name="style-target"
                  value="character"
                  checked={styleTarget === 'character'}
                  onChange={() => setStyleTarget('character')}
                  style={{ cursor: 'pointer', width: 12, height: 12, accentColor: 'var(--accent-primary)' }}
                />
                All Character Clips
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 'var(--text-xs)', color: 'var(--text-primary)', userSelect: 'none' }}>
                <input
                  type="radio"
                  name="style-target"
                  value="clip"
                  checked={styleTarget === 'clip'}
                  onChange={() => setStyleTarget('clip')}
                  style={{ cursor: 'pointer', width: 12, height: 12, accentColor: 'var(--accent-primary)' }}
                />
                Selected Clip Only
              </label>
            </div>
          </div>

          <div className="inspector-section">
            <div className="form-row">
              <div className="form-group" style={{ flex: 2 }}>
                <label className="form-label">Character Name</label>
                <input
                  type="text"
                  className="form-input"
                  value={selectedChar.name}
                  onChange={(e) => actions.updateCharacter(selectedChar.id, { name: e.target.value })}
                />
              </div>
              <div className="form-group" style={{ flex: 1 }}>
                <label className="form-label">Color</label>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input
                    type="color"
                    className="form-color-picker"
                    value={selectedChar.color}
                    onChange={(e) => actions.updateCharacter(selectedChar.id, { color: e.target.value })}
                  />
                  <span style={{ fontSize: '10px', fontFamily: 'var(--font-mono)' }}>{selectedChar.color}</span>
                </div>
              </div>
            </div>

            {/* Active Dialogue Text box for editing captions */}
            {(() => {
              const activeBlocks = state.dialogueBlocks.filter(b => b.characterId === selectedChar.id);
              const activeBlock = activeBlocks.find(b => state.currentTime >= b.startTime && state.currentTime <= b.startTime + b.duration);
              if (activeBlock) {
                return (
                  <div className="form-group" style={{ marginTop: 12 }}>
                    <label className="form-label">Active Dialogue Text (Edit Text Box)</label>
                    <textarea
                      className="form-input"
                      style={{ height: 60, resize: 'vertical', fontFamily: 'var(--font-sans)', fontSize: 'var(--text-sm)' }}
                      value={activeBlock.text}
                      onChange={(e) => actions.updateBlock(activeBlock.id, { text: e.target.value })}
                    />
                  </div>
                );
              }
              return null;
            })()}

            <div className="form-group" style={{ marginTop: 12 }}>
              <label className="form-label">Avatar Asset (Drag image here)</label>
              <div
                className="inspector-avatar-drop"
                onClick={() => handleAssignAsset(selectedChar.id)}
                onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }}
                onDrop={(e) => {
                  e.preventDefault();
                  try {
                    const dataStr = e.dataTransfer.getData('application/json');
                    if (!dataStr) return;
                    const dragData = JSON.parse(dataStr);
                    const item = state.mediaItems.find(m => m.id === dragData.id) || dragData;
                    if (item.type === 'image') {
                      actions.assignCharacterAsset(selectedChar.id, item);
                      actions.addToast(`Assigned ${item.name}`, 'success');
                    }
                  } catch (err) {}
                }}
              >
                {selectedChar.asset ? (
                  <>
                    <img src={selectedChar.asset.dataUrl} alt="" className="avatar-preview" />
                    <span className="avatar-label truncate">{selectedChar.asset.name}</span>
                  </>
                ) : (
                  <span className="avatar-placeholder" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
                    Click or drop PNG asset here
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="inspector-section-title">Style Presets</div>
          <div className="inspector-section">
            <div className="form-group">
              <label className="form-label">Caption Templates</label>
              <select
                className="form-select"
                onChange={(e) => {
                  const template = STYLE_PRESETS[e.target.value];
                  if (template) {
                    applyFullStyleTemplate(selectedChar.id, template);
                  }
                  e.target.value = ""; // reset select
                }}
                defaultValue=""
              >
                <option value="" disabled>-- Select Preset Style --</option>
                <option value="tiktok-karaoke">TikTok Karaoke Classic</option>
                <option value="insta-minimalist">Instagram Minimalist</option>
                <option value="beast-glow">MrBeast Green Glow</option>
                <option value="retro-typewriter">Retro Typewriter Box</option>
              </select>
            </div>
          </div>

          <div className="inspector-section-title">Font & Typography</div>
          <div className="inspector-section">
            <div className="form-row">
              <div className="form-group" style={{ flex: 1 }}>
                <label className="form-label">Font Family</label>
                <select
                  className="form-select"
                  value={style.fontFamily}
                  onChange={(e) => updateStyle(selectedChar.id, 'fontFamily', e.target.value)}
                >
                  <option value="Impact">Impact (Meme)</option>
                  <option value="Inter">Inter (Sleek)</option>
                  <option value="Arial">Arial (Standard)</option>
                  <option value="Montserrat">Montserrat (Modern)</option>
                  <option value="Comic Sans MS">Comic Sans (Funny)</option>
                  <option value="Georgia">Georgia (Serif)</option>
                  <option value="Courier New">Courier (Mono)</option>
                </select>
              </div>
              <div className="form-group" style={{ flex: 1 }}>
                <label className="form-label">Case Mode</label>
                <select
                  className="form-select"
                  value={style.caseMode}
                  onChange={(e) => updateStyle(selectedChar.id, 'caseMode', e.target.value)}
                >
                  <option value="none">Normal</option>
                  <option value="uppercase">UPPERCASE</option>
                  <option value="lowercase">lowercase</option>
                </select>
              </div>
            </div>

            <div className="form-row">
              <div className="form-group" style={{ flex: 1 }}>
                <label className="form-label">Words Per Line</label>
                <input
                  type="number"
                  className="form-input"
                  min="1"
                  max="10"
                  value={style.wordsPerLine}
                  onChange={(e) => updateStyle(selectedChar.id, 'wordsPerLine', parseInt(e.target.value) || 3)}
                />
              </div>
              <div className="form-group" style={{ flex: 1 }}>
                <label className="form-label">Text Color</label>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input
                    type="color"
                    className="form-color-picker"
                    value={style.color}
                    onChange={(e) => updateStyle(selectedChar.id, 'color', e.target.value)}
                  />
                  <span style={{ fontSize: '10px', fontFamily: 'var(--font-mono)' }}>{style.color}</span>
                </div>
              </div>
            </div>

            <div className="form-row-slider" style={{ marginTop: 12 }}>
              <div className="slider-header">
                <span>Font Size</span>
                <span>{style.fontSize ?? 36}px</span>
              </div>
              <input
                type="range"
                min="12"
                max="100"
                value={style.fontSize ?? 36}
                onChange={(e) => updateStyle(selectedChar.id, 'fontSize', parseInt(e.target.value))}
              />
            </div>

            <div className="form-row-slider">
              <div className="slider-header">
                <span>Letter Spacing</span>
                <span>{style.letterSpacing}px</span>
              </div>
              <input
                type="range"
                min="-5"
                max="20"
                value={style.letterSpacing}
                onChange={(e) => updateStyle(selectedChar.id, 'letterSpacing', parseInt(e.target.value))}
              />
            </div>

            <div className="form-row-slider">
              <div className="slider-header">
                <span>Line Height</span>
                <span>{style.lineHeight}x</span>
              </div>
              <input
                type="range"
                min="1"
                max="2.5"
                step="0.1"
                value={style.lineHeight}
                onChange={(e) => updateStyle(selectedChar.id, 'lineHeight', parseFloat(e.target.value))}
              />
            </div>
          </div>

          <div className="inspector-section-title">Outline & Glow</div>
          <div className="inspector-section">
            <div className="form-row">
              <div className="form-group" style={{ flex: 1 }}>
                <label className="form-label">Outline Color</label>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input
                    type="color"
                    className="form-color-picker"
                    value={style.strokeColor}
                    onChange={(e) => updateStyle(selectedChar.id, 'strokeColor', e.target.value)}
                  />
                  <span style={{ fontSize: '10px', fontFamily: 'var(--font-mono)' }}>{style.strokeColor}</span>
                </div>
              </div>
              <div className="form-group" style={{ flex: 1 }}>
                <label className="form-label">Glow Color</label>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input
                    type="color"
                    className="form-color-picker"
                    value={style.glowColor}
                    onChange={(e) => updateStyle(selectedChar.id, 'glowColor', e.target.value)}
                  />
                  <span style={{ fontSize: '10px', fontFamily: 'var(--font-mono)' }}>{style.glowColor}</span>
                </div>
              </div>
            </div>

            <div className="form-row-slider">
              <div className="slider-header">
                <span>Outline Thickness</span>
                <span>{style.strokeWidth}px</span>
              </div>
              <input
                type="range"
                min="0"
                max="10"
                value={style.strokeWidth}
                onChange={(e) => updateStyle(selectedChar.id, 'strokeWidth', parseInt(e.target.value))}
              />
            </div>

            <div className="form-row-slider">
              <div className="slider-header">
                <span>Glow Blur Intensity</span>
                <span>{style.glowBlur}px</span>
              </div>
              <input
                type="range"
                min="0"
                max="30"
                value={style.glowBlur}
                onChange={(e) => updateStyle(selectedChar.id, 'glowBlur', parseInt(e.target.value))}
              />
            </div>
          </div>

          <div className="inspector-section-title">Backdrop Box & Drop Shadow</div>
          <div className="inspector-section">
            <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginBottom: 8 }}>
              <input
                type="checkbox"
                id="showBackground"
                checked={style.showBackground}
                onChange={(e) => updateStyle(selectedChar.id, 'showBackground', e.target.checked)}
              />
              <label htmlFor="showBackground" className="form-label" style={{ margin: 0, cursor: 'pointer' }}>Show Backdrop Box</label>
            </div>

            {style.showBackground && (
              <>
                <div className="form-group">
                  <label className="form-label">Backdrop Color</label>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <input
                      type="color"
                      className="form-color-picker"
                      value={style.backgroundColor.slice(0, 7)}
                      onChange={(e) => {
                        const opacity = parseFloat(style.backgroundColor.match(/rgba\(.+,\s*(.+)\)/)?.[1] || '0.7');
                        const r = parseInt(e.target.value.slice(1, 3), 16) || 0;
                        const g = parseInt(e.target.value.slice(3, 5), 16) || 0;
                        const b = parseInt(e.target.value.slice(5, 7), 16) || 0;
                        updateStyle(selectedChar.id, 'backgroundColor', `rgba(${r},${g},${b},${opacity})`);
                      }}
                    />
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.05"
                      style={{ flex: 1 }}
                      value={parseFloat(style.backgroundColor.match(/rgba\(.+,\s*(.+)\)/)?.[1] || '0.7')}
                      onChange={(e) => {
                        const opacity = parseFloat(e.target.value);
                        let hex = style.backgroundColor;
                        if (!hex.startsWith('rgba')) {
                          const r = parseInt(hex.slice(1, 3), 16) || 0;
                          const g = parseInt(hex.slice(3, 5), 16) || 0;
                          const b = parseInt(hex.slice(5, 7), 16) || 0;
                          updateStyle(selectedChar.id, 'backgroundColor', `rgba(${r},${g},${b},${opacity})`);
                        } else {
                          const rgb = hex.match(/rgba\((\d+,\s*\d+,\s*\d+),.+/);
                          if (rgb) {
                            updateStyle(selectedChar.id, 'backgroundColor', `rgba(${rgb[1]},${opacity})`);
                          }
                        }
                      }}
                    />
                  </div>
                </div>

                <div className="form-row-slider">
                  <div className="slider-header">
                    <span>Backdrop Padding</span>
                    <span>{style.backgroundPadding}px</span>
                  </div>
                  <input
                    type="range"
                    min="2"
                    max="30"
                    value={style.backgroundPadding}
                    onChange={(e) => updateStyle(selectedChar.id, 'backgroundPadding', parseInt(e.target.value))}
                  />
                </div>
              </>
            )}

            <div className="form-row">
              <div className="form-group" style={{ flex: 1 }}>
                <label className="form-label">Shadow Color</label>
                <input
                  type="color"
                  className="form-color-picker"
                  value={style.shadowColor.startsWith('#') ? style.shadowColor : '#000000'}
                  onChange={(e) => updateStyle(selectedChar.id, 'shadowColor', e.target.value)}
                />
              </div>
              <div className="form-group" style={{ flex: 1 }}>
                <label className="form-label">Shadow Blur</label>
                <input
                  type="number"
                  className="form-input"
                  value={style.shadowBlur}
                  onChange={(e) => updateStyle(selectedChar.id, 'shadowBlur', parseInt(e.target.value) || 0)}
                />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group" style={{ flex: 1 }}>
                <label className="form-label">Shadow Offset X</label>
                <input
                  type="number"
                  className="form-input"
                  value={style.shadowOffsetX}
                  onChange={(e) => updateStyle(selectedChar.id, 'shadowOffsetX', parseInt(e.target.value) || 0)}
                />
              </div>
              <div className="form-group" style={{ flex: 1 }}>
                <label className="form-label">Shadow Offset Y</label>
                <input
                  type="number"
                  className="form-input"
                  value={style.shadowOffsetY}
                  onChange={(e) => updateStyle(selectedChar.id, 'shadowOffsetY', parseInt(e.target.value) || 0)}
                />
            </div>
          </div>
        </div>

          <div className="inspector-section-title">Word Highlights</div>
          <div className="inspector-section">
            <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginBottom: 8 }}>
              <input
                type="checkbox"
                id="enableHighlight"
                checked={style.enableHighlight !== false}
                onChange={(e) => updateStyle(selectedChar.id, 'enableHighlight', e.target.checked)}
              />
              <label htmlFor="enableHighlight" className="form-label" style={{ margin: 0, cursor: 'pointer' }}>Highlight Active Word</label>
            </div>

            {(style.enableHighlight !== false) && (
              <div className="form-group">
                <label className="form-label">Highlight Color</label>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input
                    type="color"
                    className="form-color-picker"
                    value={style.highlightColor || '#ffd21e'}
                    onChange={(e) => updateStyle(selectedChar.id, 'highlightColor', e.target.value)}
                  />
                  <span style={{ fontSize: '10px', fontFamily: 'var(--font-mono)' }}>{style.highlightColor || '#ffd21e'}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      );
    }

    // 2. Check if Dialogue Block/Clip is selected
    if (state.selectedClipId) {
      const block = state.dialogueBlocks.find(b => b.id === state.selectedClipId);
      if (block) {
        return (
          <div className="inspector-panel">
            <div className="inspector-header">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" style={{ color: block.color }}>
                <path d="M18 4l2 4h-3l-2-4h-2l2 4h-3l-2-4H8l2 4H7L5 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V4h-4zm2 14H4V8h16v10z"/>
              </svg>
              <span className="inspector-title">Clip Timing & Info</span>
            </div>

            <div className="inspector-section">
              <div className="form-group">
                <label className="form-label">Speaker</label>
                <div style={{ color: block.color, fontWeight: 'bold' }}>{block.characterName}</div>
              </div>

              <div className="form-group">
                <label className="form-label">Dialogue Text (Edit Box)</label>
                <textarea
                  className="form-input"
                  style={{ height: 80, resize: 'vertical', fontFamily: 'var(--font-sans)' }}
                  value={block.text}
                  onChange={(e) => actions.updateBlock(block.id, { text: e.target.value })}
                />
              </div>

              <div className="form-row">
                <div className="form-group" style={{ flex: 1 }}>
                  <label className="form-label">Start Time (s)</label>
                  <input
                    type="number"
                    step="0.1"
                    className="form-input"
                    value={block.startTime.toFixed(1)}
                    onChange={(e) => handleBlockTimingChange(block.id, 'startTime', e.target.value)}
                  />
                </div>
                <div className="form-group" style={{ flex: 1 }}>
                  <label className="form-label">Duration (s)</label>
                  <input
                    type="number"
                    step="0.1"
                    className="form-input"
                    value={block.duration.toFixed(1)}
                    onChange={(e) => handleBlockTimingChange(block.id, 'duration', e.target.value)}
                  />
                </div>
              </div>
            </div>
          </div>
        );
      }
    }

    // 3. Fallback / Empty State
    return (
      <div className="empty-state" style={{ height: '80%', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <svg viewBox="0 0 24 24" width="48" height="48" fill="currentColor" style={{ color: 'var(--text-disabled)', margin: '0 auto 16px' }}>
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/>
        </svg>
        <div className="empty-state__title">No Element Selected</div>
        <div className="empty-state__desc" style={{ padding: '0 32px' }}>
          Select a character in the list or click a caption on the Preview Canvas to inspect and style it.
        </div>
      </div>
    );
  };

  const renderAnimations = () => {
    const charId = selectedCharacterId || state.characters[0]?.id;
    const character = state.characters.find(c => c.id === charId);

    if (state.characters.length === 0) {
      return (
        <div className="empty-state" style={{ height: '80%', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <svg viewBox="0 0 24 24" width="48" height="48" fill="currentColor" style={{ color: 'var(--text-disabled)', margin: '0 auto 16px' }}>
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/>
          </svg>
          <div className="empty-state__title">No Characters Found</div>
          <div className="empty-state__desc" style={{ padding: '0 32px' }}>
            Parse a script first in the Script tab to generate characters for animation.
          </div>
        </div>
      );
    }

    if (!character) return null;

    const keyframes = character.keyframes || [];
    const sortedKfs = [...keyframes].sort((a, b) => a.time - b.time);

    const getDefaultValue = (prop) => {
      if (prop === 'scale') return 1;
      if (prop === 'flipX' || prop === 'flipY') return 1;
      if (prop === 'opacity') return 1;
      return 0;
    };

    // Ranges for properties
    let minVal = 0, maxVal = 100;
    let propName = 'Position X';
    let propStep = 1;
    if (activeProp === 'x') { minVal = 0; maxVal = state.canvasWidth; propName = 'Position X'; propStep = 10; }
    else if (activeProp === 'y') { minVal = 0; maxVal = state.canvasHeight; propName = 'Position Y'; propStep = 10; }
    else if (activeProp === 'scale') { minVal = 0.1; maxVal = 3.0; propName = 'Scale'; propStep = 0.05; }
    else if (activeProp === 'rotation') { minVal = -180; maxVal = 180; propName = 'Rotation'; propStep = 5; }
    else if (activeProp === 'opacity') { minVal = 0; maxVal = 1.0; propName = 'Opacity'; propStep = 0.05; }
    else if (activeProp === 'skewX') { minVal = -60; maxVal = 60; propName = 'Skew X'; propStep = 1; }
    else if (activeProp === 'skewY') { minVal = -60; maxVal = 60; propName = 'Skew Y'; propStep = 1; }
    else if (activeProp === 'rotateX') { minVal = -90; maxVal = 90; propName = '3D Rotation X'; propStep = 1; }
    else if (activeProp === 'rotateY') { minVal = -90; maxVal = 90; propName = '3D Rotation Y'; propStep = 1; }
    else if (activeProp === 'flipX') { minVal = -1; maxVal = 1; propName = 'Flip Horizontal'; propStep = 2; }
    else if (activeProp === 'flipY') { minVal = -1; maxVal = 1; propName = 'Flip Vertical'; propStep = 2; }

    const svgWidth = 800;
    const svgHeight = 220;
    const paddingX = 40;
    const paddingY = 30;

    const timeToX = (t) => paddingX + (t / (state.totalDuration || 30)) * (svgWidth - 2 * paddingX);
    const xToTime = (x) => ((x - paddingX) / (svgWidth - 2 * paddingX)) * (state.totalDuration || 30);
    const valToY = (val) => svgHeight - paddingY - ((val - minVal) / (maxVal - minVal)) * (svgHeight - 2 * paddingY);
    const yToVal = (y) => minVal + ((svgHeight - paddingY - y) / (svgHeight - 2 * paddingY)) * (maxVal - minVal);

    // Generate Path points for lines
    const generatePathD = () => {
      if (sortedKfs.length === 0) return '';
      let d = '';
      
      const firstKf = sortedKfs[0];
      const firstVal = firstKf[activeProp] ?? getDefaultValue(activeProp);
      d += `M ${timeToX(0)} ${valToY(firstVal)}`;

      sortedKfs.forEach((kf) => {
        const x = timeToX(kf.time);
        const y = valToY(kf[activeProp] ?? getDefaultValue(activeProp));
        d += ` L ${x} ${y}`;
      });

      const lastKf = sortedKfs[sortedKfs.length - 1];
      const lastVal = lastKf[activeProp] ?? getDefaultValue(activeProp);
      d += ` L ${timeToX(state.totalDuration || 30)} ${valToY(lastVal)}`;
      
      return d;
    };

    const generatePathDForProp = (prop) => {
      if (sortedKfs.length === 0) return '';
      let d = '';
      
      let pMin = minVal, pMax = maxVal;
      if (prop === 'x') { pMin = 0; pMax = state.canvasWidth; }
      else if (prop === 'y') { pMin = 0; pMax = state.canvasHeight; }
      else if (prop === 'scale') { pMin = 0.1; pMax = 3.0; }
      else if (prop === 'rotation') { pMin = -180; pMax = 180; }
      else if (prop === 'opacity') { pMin = 0; pMax = 1.0; }

      const propValToY = (val) => svgHeight - paddingY - ((val - pMin) / (pMax - pMin)) * (svgHeight - 2 * paddingY);

      const firstKf = sortedKfs[0];
      const firstVal = firstKf[prop] ?? getDefaultValue(prop);
      d += `M ${timeToX(0)} ${propValToY(firstVal)}`;

      sortedKfs.forEach((kf) => {
        const x = timeToX(kf.time);
        const y = propValToY(kf[prop] ?? getDefaultValue(prop));
        d += ` L ${x} ${y}`;
      });

      const lastKf = sortedKfs[sortedKfs.length - 1];
      const lastVal = lastKf[prop] ?? getDefaultValue(prop);
      d += ` L ${timeToX(state.totalDuration || 30)} ${propValToY(lastVal)}`;
      
      return d;
    };

    const handleSvgDoubleClick = (e) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * svgWidth;
      const y = ((e.clientY - rect.top) / rect.height) * svgHeight;

      if (x < paddingX || x > svgWidth - paddingX || y < paddingY || y > svgHeight - paddingY) {
        return;
      }

      const clickedTime = Math.max(0, Math.min(state.totalDuration, Number(xToTime(x).toFixed(2))));
      const clickedVal = Math.max(minVal, Math.min(maxVal, Number(yToVal(y).toFixed(2))));

      let baseTransform = state.characterTransforms[character.id] || {
        x: state.canvasWidth / 2,
        y: state.canvasHeight * 0.65,
        scale: 1,
        rotation: 0,
        opacity: 1,
      };

      if (character.keyframes && character.keyframes.length > 0) {
        baseTransform = getInterpolatedKeyframeTransform(character.keyframes, clickedTime);
      }

      const newTransform = {
        ...baseTransform,
        [activeProp]: clickedVal,
      };

      actions.addCharacterKeyframe(character.id, clickedTime, newTransform);
      
      const updatedKeyframes = [...(character.keyframes || [])];
      const existingIdx = updatedKeyframes.findIndex(kf => Math.abs(kf.time - clickedTime) < 0.05);
      if (existingIdx !== -1) {
        actions.selectKeyframe(existingIdx);
      } else {
        updatedKeyframes.push({ time: clickedTime, ...newTransform });
        updatedKeyframes.sort((a, b) => a.time - b.time);
        const newIdx = updatedKeyframes.findIndex(kf => kf.time === clickedTime);
        actions.selectKeyframe(newIdx !== -1 ? newIdx : updatedKeyframes.length - 1);
      }
      
      actions.addToast(`Added keyframe at ${clickedTime.toFixed(1)}s`, 'success');
    };

    const handleAddKeyframeAtPlayhead = () => {
      const currentTransform = state.characterTransforms[character.id] || {
        x: state.canvasWidth / 2,
        y: state.canvasHeight * 0.65,
        scale: 1,
        rotation: 0,
        opacity: 1,
      };
      
      actions.addCharacterKeyframe(character.id, state.currentTime, currentTransform);
      actions.addToast(`Added keyframe at ${state.currentTime.toFixed(1)}s`, 'success');
    };

    const handleJumpPrevKeyframe = () => {
      const prev = [...sortedKfs].reverse().find(kf => kf.time < state.currentTime - 0.05);
      if (prev) {
        actions.setCurrentTime(prev.time);
      }
    };

    const handleJumpNextKeyframe = () => {
      const next = sortedKfs.find(kf => kf.time > state.currentTime + 0.05);
      if (next) {
        actions.setCurrentTime(next.time);
      }
    };

    const handleGraphPointerDown = (e, index, kf) => {
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      setDraggingKf({
        index,
        pointerId: e.pointerId,
      });
      actions.selectKeyframe(index);
    };

    const handleGraphPointerMove = (e) => {
      if (!draggingKf) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * svgWidth;
      const y = ((e.clientY - rect.top) / rect.height) * svgHeight;

      let newTime = Math.max(0, Math.min(state.totalDuration, Number(xToTime(x).toFixed(2))));
      let newVal = Math.max(minVal, Math.min(maxVal, Number(yToVal(y).toFixed(2))));

      actions.updateCharacterKeyframe(character.id, draggingKf.index, {
        time: newTime,
        [activeProp]: newVal,
      });
    };

    const handleGraphPointerUp = (e) => {
      if (draggingKf) {
        try {
          e.currentTarget.releasePointerCapture(draggingKf.pointerId);
        } catch (err) {}
        setDraggingKf(null);
        actions.addToast('Updated keyframe transform', 'success');
      }
    };

    // Find current active block if any (for transitions)
    const block = state.dialogueBlocks.find(b => b.id === state.selectedClipId) || 
                  state.dialogueBlocks.find(b => b.characterId === character.id && state.currentTime >= b.startTime && state.currentTime <= b.startTime + b.duration) ||
                  state.dialogueBlocks.find(b => b.characterId === character.id);

    const anim = (block && block.animation) || {
      entrance: 'slide-up',
      exit: 'slide-down',
      entranceDuration: 0.3,
      exitDuration: 0.3,
      sustain: 'none',
      sustainIntensity: 0.5,
      sustainSpeed: 0.5,
    };

    const handleAnimChange = (key, val) => {
      if (block) {
        actions.updateBlockAnimation(block.id, { [key]: val });
      }
    };

    // Grid data
    const gridLines = [0.25, 0.5, 0.75].map((ratio) => {
      const val = minVal + ratio * (maxVal - minVal);
      const y = valToY(val);
      return { y, label: val.toFixed(activeProp === 'scale' || activeProp === 'opacity' ? 1 : 0) };
    });

    const duration = state.totalDuration || 30;
    const timeStep = duration > 60 ? 10 : 5;
    const verticalGrid = [];
    for (let t = 0; t <= duration; t += timeStep) {
      verticalGrid.push(t);
    }

    return (
      <div className="inspector-panel">
        <div className="inspector-header" style={{ paddingBottom: 8 }}>
          <span className="inspector-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" style={{ color: character.color }}><polygon points="12 2 2 22 22 22"/></svg>
            Character Animation Control
          </span>
        </div>

        {/* Character Selector */}
        <div className="form-group" style={{ marginBottom: 12 }}>
          <label className="form-label">Active Character</label>
          <select
            className="form-select"
            value={charId}
            onChange={(e) => {
              setSelectedCharacterId(e.target.value);
              actions.selectKeyframe(null);
            }}
          >
            {state.characters.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>

        {/* Custom Keyframes Toggle */}
        <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', background: 'var(--surface-1)', padding: '8px 12px', borderRadius: 6, marginBottom: 12, border: '1px solid var(--border-subtle)' }}>
          <input
            type="checkbox"
            id="keyframingEnabled"
            checked={character.keyframingEnabled || false}
            onChange={(e) => {
              actions.toggleCharacterKeyframing(character.id, e.target.checked);
              actions.selectKeyframe(0);
            }}
            style={{ cursor: 'pointer' }}
          />
          <label htmlFor="keyframingEnabled" className="form-label" style={{ margin: 0, cursor: 'pointer', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: 4 }}>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" style={{ color: 'var(--accent-primary)' }}><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/></svg>
            Enable Keyframe Animation
          </label>
        </div>

        {character.keyframingEnabled ? (
          <>
            {/* Property Selector Tabs */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4, background: 'var(--surface-2)', padding: 6, borderRadius: 6, marginBottom: 10, border: '1px solid var(--border-subtle)' }}>
              {[
                { id: 'x', label: 'X' },
                { id: 'y', label: 'Y' },
                { id: 'scale', label: 'Scale' },
                { id: 'rotation', label: 'Rot' },
                { id: 'opacity', label: 'Opac' },
                { id: 'skewX', label: 'Skew X' },
                { id: 'skewY', label: 'Skew Y' },
                { id: 'rotateX', label: '3D X' },
                { id: 'rotateY', label: '3D Y' },
                { id: 'flipX', label: 'Flip H' },
                { id: 'flipY', label: 'Flip V' }
              ].map(prop => (
                <button
                  key={prop.id}
                  style={{
                    padding: '5px 2px',
                    fontSize: '9px',
                    textAlign: 'center',
                    borderRadius: 4,
                    border: '1px solid ' + (activeProp === prop.id ? 'var(--accent-primary)' : 'transparent'),
                    background: activeProp === prop.id ? 'var(--surface-1)' : 'transparent',
                    color: activeProp === prop.id ? 'var(--accent-primary)' : 'var(--text-secondary)',
                    fontWeight: activeProp === prop.id ? 'bold' : 'normal',
                    cursor: 'pointer',
                    minWidth: 0,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    transition: 'all 0.15s ease',
                  }}
                  onClick={() => setActiveProp(prop.id)}
                >
                  {prop.label}
                </button>
              ))}
            </div>

            {/* Keyframe graph navigation toolbar */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <span style={{ fontSize: '11px', fontWeight: 'bold', color: 'var(--text-secondary)' }}>
                {propName} Graph
              </span>
              <div style={{ display: 'flex', gap: 4 }}>
                <button
                  className="btn btn--secondary"
                  style={{
                    padding: '2px 6px',
                    fontSize: '10px',
                    height: 20,
                    color: 'var(--accent-danger, #ff4081)',
                    fontWeight: 'bold',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 2,
                    marginRight: 8
                  }}
                  onClick={() => {
                    if (confirm('Are you sure you want to reset and delete ALL keyframe animation points for this character?')) {
                      actions.resetCharacterKeyframes(character.id);
                      actions.addToast('Cleared all keyframe points', 'info');
                    }
                  }}
                  title="Delete all keyframes for this character"
                >
                  <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
                  Reset Keyframes
                </button>
                <button
                  className="btn btn--secondary"
                  style={{ padding: '2px 6px', fontSize: '10px', height: 20 }}
                  onClick={handleJumpPrevKeyframe}
                  title="Jump to previous keyframe"
                >
                  ◀
                </button>
                <button
                  className="btn btn--secondary"
                  style={{ padding: '2px 6px', fontSize: '10px', height: 20, display: 'flex', alignItems: 'center', gap: 2 }}
                  onClick={handleAddKeyframeAtPlayhead}
                  title="Add Keyframe at current playhead"
                >
                  ◆ +
                </button>
                <button
                  className="btn btn--secondary"
                  style={{ padding: '2px 6px', fontSize: '10px', height: 20 }}
                  onClick={handleJumpNextKeyframe}
                  title="Jump to next keyframe"
                >
                  ▶
                </button>
              </div>
            </div>

            {/* Interactive SVG Keyframe Graph */}
            <div style={{ background: '#0a0a0f', border: '1px solid var(--border-subtle)', borderRadius: 8, overflow: 'hidden', position: 'relative', marginBottom: 6 }}>
              <svg
                width="100%"
                viewBox={`0 0 ${svgWidth} ${svgHeight}`}
                style={{ display: 'block', touchAction: 'none' }}
                onPointerMove={handleGraphPointerMove}
                onPointerUp={handleGraphPointerUp}
                onPointerLeave={handleGraphPointerUp}
                onDoubleClick={handleSvgDoubleClick}
              >
                {/* Horizontal Grid lines */}
                {gridLines.map((line, idx) => (
                  <g key={idx}>
                    <line
                      x1={paddingX}
                      y1={line.y}
                      x2={svgWidth - paddingX}
                      y2={line.y}
                      stroke="rgba(255,255,255,0.06)"
                      strokeDasharray="4,4"
                    />
                    <text
                      x={paddingX - 8}
                      y={line.y}
                      fill="rgba(255,255,255,0.3)"
                      fontSize="9"
                      textAnchor="end"
                      alignmentBaseline="middle"
                    >
                      {line.label}
                    </text>
                  </g>
                ))}

                {/* Vertical Grid lines */}
                {verticalGrid.map((t, idx) => {
                  const x = timeToX(t);
                  return (
                    <g key={idx}>
                      <line
                        x1={x}
                        y1={paddingY}
                        x2={x}
                        y2={svgHeight - paddingY}
                        stroke="rgba(255,255,255,0.04)"
                      />
                      <text
                        x={x}
                        y={svgHeight - paddingY + 14}
                        fill="rgba(255,255,255,0.3)"
                        fontSize="9"
                        textAnchor="middle"
                      >
                        {t}s
                      </text>
                    </g>
                  );
                })}

                {/* Plot line */}
                {generatePathD() && (
                  <path
                    d={generatePathD()}
                    fill="none"
                    stroke={activeProp === 'x' ? '#ff4081' : activeProp === 'y' ? '#00e5ff' : 'var(--accent-primary)'}
                    strokeWidth="2.5"
                  />
                )}

                {/* Plot line for reference prop in 2D position mode */}
                {(activeProp === 'x' || activeProp === 'y') && (
                  <path
                    d={generatePathDForProp(activeProp === 'x' ? 'y' : 'x')}
                    fill="none"
                    stroke={activeProp === 'x' ? 'rgba(0, 229, 255, 0.25)' : 'rgba(255, 64, 129, 0.25)'}
                    strokeWidth="1.5"
                    strokeDasharray="3,3"
                  />
                )}

                {/* Interactive Keyframe diamonds */}
                {sortedKfs.map((kf, idx) => {
                  const cx = timeToX(kf.time);
                  const cy = valToY(kf[activeProp] ?? getDefaultValue(activeProp));
                  const isSelected = state.selectedKeyframeIndex === idx;
                  const size = isSelected ? 9 : 7;
                  return (
                    <rect
                      key={idx}
                      x={cx - size / 2}
                      y={cy - size / 2}
                      width={size}
                      height={size}
                      transform={`rotate(45, ${cx}, ${cy})`}
                      fill={isSelected ? '#ff4081' : '#ffffff'}
                      stroke={activeProp === 'x' ? '#ff4081' : activeProp === 'y' ? '#00e5ff' : 'var(--accent-primary)'}
                      strokeWidth="1.5"
                      style={{ cursor: 'grab' }}
                      onPointerDown={(e) => handleGraphPointerDown(e, idx, kf)}
                    />
                  );
                })}

                {/* Vertical Playhead Indicator */}
                <line
                  className="graph-playhead-line"
                  x1={timeToX(state.currentTime)}
                  y1={paddingY}
                  x2={timeToX(state.currentTime)}
                  y2={svgHeight - paddingY}
                  stroke="#ffd21e"
                  strokeWidth="1.5"
                  opacity="0.8"
                />
              </svg>
            </div>

            <div style={{ fontSize: '10px', color: 'var(--text-disabled)', textAlign: 'center', marginBottom: 12 }}>
              💡 Double-click empty space to put/add a keyframe. Drag points to edit.
            </div>

            {/* Selected Keyframe Inspector Details */}
            {state.selectedKeyframeIndex !== null && sortedKfs[state.selectedKeyframeIndex] ? (
              <div style={{ background: 'var(--surface-1)', padding: 8, borderRadius: 6, border: '1px solid var(--border-subtle)', marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <span style={{ fontSize: '10px', fontWeight: 'bold', color: 'var(--accent-primary)' }}>
                    Keyframe #{state.selectedKeyframeIndex + 1}
                  </span>
                  <button
                    style={{ background: 'transparent', border: 'none', color: '#ff4081', fontSize: '10px', cursor: 'pointer', padding: 0 }}
                    onClick={() => {
                      actions.removeCharacterKeyframe(character.id, state.selectedKeyframeIndex);
                      actions.selectKeyframe(null);
                      actions.addToast('Deleted keyframe', 'info');
                    }}
                  >
                    Delete Keyframe
                  </button>
                </div>
                <div className="form-row">
                  <div className="form-group" style={{ flex: 1 }}>
                    <label className="form-label" style={{ fontSize: '9px' }}>Time (s)</label>
                    <input
                      type="number"
                      step="0.05"
                      min="0"
                      max={state.totalDuration}
                      className="form-input"
                      style={{ height: 22, padding: '2px 4px', fontSize: '11px' }}
                      value={sortedKfs[state.selectedKeyframeIndex].time}
                      onChange={(e) => {
                        const newTime = Math.max(0, Math.min(state.totalDuration, parseFloat(e.target.value) || 0));
                        actions.updateCharacterKeyframe(character.id, state.selectedKeyframeIndex, { time: newTime });
                      }}
                    />
                  </div>
                  <div className="form-group" style={{ flex: 1 }}>
                    <label className="form-label" style={{ fontSize: '9px' }}>{propName}</label>
                    <input
                      type="number"
                      step={propStep / 10}
                      min={minVal}
                      max={maxVal}
                      className="form-input"
                      style={{ height: 22, padding: '2px 4px', fontSize: '11px' }}
                      value={sortedKfs[state.selectedKeyframeIndex][activeProp] ?? getDefaultValue(activeProp)}
                      onChange={(e) => {
                        const val = Math.max(minVal, Math.min(maxVal, parseFloat(e.target.value) || 0));
                        actions.updateCharacterKeyframe(character.id, state.selectedKeyframeIndex, { [activeProp]: val });
                      }}
                    />
                  </div>
                </div>
                <div className="form-row" style={{ marginTop: 4 }}>
                  <div className="form-group" style={{ flex: 1 }}>
                    <label className="form-label" style={{ fontSize: '9px' }}>Interpolation Easing</label>
                    <select
                      className="form-select"
                      style={{ height: 22, padding: '0 4px', fontSize: '10px' }}
                      value={sortedKfs[state.selectedKeyframeIndex].easing || 'linear'}
                      onChange={(e) => {
                        actions.updateCharacterKeyframe(character.id, state.selectedKeyframeIndex, { easing: e.target.value });
                        actions.addToast(`Set easing to ${e.target.value}`, 'info');
                      }}
                    >
                      <option value="linear">Linear (Constant)</option>
                      <option value="smoothSpline">Smooth Spline Curve</option>
                      <option value="easeInQuad">Ease In (Accelerate)</option>
                      <option value="easeOutQuad">Ease Out (Decelerate)</option>
                      <option value="easeInOutQuad">Ease In-Out (Smooth)</option>
                      <option value="easeInCubic">Ease In (Cubic)</option>
                      <option value="easeOutCubic">Ease Out (Cubic)</option>
                      <option value="easeInOutCubic">Ease In-Out (Cubic)</option>
                      <option value="easeInBack">Ease In (Anticipate Back)</option>
                      <option value="easeOutBack">Ease Out (Overshoot Back)</option>
                      <option value="easeOutBounce">Ease Out (Bounce Impact)</option>
                      <option value="hold">Hold (Instant Step)</option>
                    </select>
                  </div>
                </div>
                <div className="form-row-slider" style={{ marginTop: 4 }}>
                  <input
                    type="range"
                    min={minVal}
                    max={maxVal}
                    step={propStep / 10}
                    value={sortedKfs[state.selectedKeyframeIndex][activeProp] ?? getDefaultValue(activeProp)}
                    onChange={(e) => {
                      actions.updateCharacterKeyframe(character.id, state.selectedKeyframeIndex, { [activeProp]: parseFloat(e.target.value) });
                    }}
                  />
                </div>
              </div>
            ) : (
              <div style={{ textAlign: 'center', fontSize: 'var(--text-xs)', color: 'var(--text-disabled)', marginBottom: 12 }}>
                Click a dot on the graph to inspect / modify keyframe properties.
              </div>
            )}
          </>
        ) : null}

        {/* dialogue block animation transitions override */}
        {block ? (
          <>
            <div className="inspector-section-title" style={{ marginTop: 12 }}>Dialogue Block Transitions</div>
            <div className="inspector-section">
              <div className="form-group">
                <label className="form-label">Dialogue Text Override</label>
                <div style={{ fontStyle: 'italic', background: 'var(--surface-1)', padding: 8, borderRadius: 4, fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
                  "{block.text}"
                </div>
              </div>

              <div className="form-group" style={{ marginTop: 8 }}>
                <label className="form-label">Entrance Preset</label>
                <select
                  className="form-select"
                  value={anim.entrance || 'slide-up'}
                  onChange={(e) => handleAnimChange('entrance', e.target.value)}
                >
                  <option value="slide-up">Slide Up</option>
                  <option value="slide-down">Slide Down</option>
                  <option value="slide-left">Slide Left</option>
                  <option value="slide-right">Slide Right</option>
                  <option value="pop">Bouncy Pop</option>
                  <option value="fade">Fade In</option>
                  <option value="zoom-spin">Zoom Spin</option>
                  <option value="bounce">Bounce In</option>
                  <option value="flip">Flip In</option>
                  <option value="slide-rotate">Slide Rotate In</option>
                </select>
              </div>

              <div className="form-row-slider">
                <div className="slider-header">
                  <span>Entrance Duration</span>
                  <span>{anim.entranceDuration ?? 0.3}s</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1.5"
                  step="0.05"
                  value={anim.entranceDuration ?? 0.3}
                  onChange={(e) => handleAnimChange('entranceDuration', parseFloat(e.target.value))}
                />
              </div>

              <div className="form-group" style={{ marginTop: 8 }}>
                <label className="form-label">Exit Preset</label>
                <select
                  className="form-select"
                  value={anim.exit || 'slide-down'}
                  onChange={(e) => handleAnimChange('exit', e.target.value)}
                >
                  <option value="slide-up">Slide Up</option>
                  <option value="slide-down">Slide Down</option>
                  <option value="slide-left">Slide Left</option>
                  <option value="slide-right">Slide Right</option>
                  <option value="pop">Pop Out</option>
                  <option value="fade">Fade Out</option>
                  <option value="zoom-spin">Zoom Spin Out</option>
                  <option value="bounce">Bounce Out</option>
                  <option value="flip">Flip Out</option>
                  <option value="slide-rotate">Slide Rotate Out</option>
                </select>
              </div>

              <div className="form-row-slider">
                <div className="slider-header">
                  <span>Exit Duration</span>
                  <span>{anim.exitDuration ?? 0.3}s</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1.5"
                  step="0.05"
                  value={anim.exitDuration ?? 0.3}
                  onChange={(e) => handleAnimChange('exitDuration', parseFloat(e.target.value))}
                />
              </div>

              <div className="form-group" style={{ marginTop: 8 }}>
                <label className="form-label">Sustain / Idle Preset</label>
                <select
                  className="form-select"
                  value={anim.sustain || 'none'}
                  onChange={(e) => handleAnimChange('sustain', e.target.value)}
                >
                  <option value="none">None</option>
                  <option value="shake">Shake</option>
                  <option value="move-around">Move Around</option>
                  <option value="bounce-idle">Bounce Talk Idle</option>
                  <option value="breath">Pulsing Breath</option>
                  <option value="float">Hover Float</option>
                  <option value="dance">Dance Sway</option>
                </select>
              </div>

              {anim.sustain && anim.sustain !== 'none' && (
                <>
                  <div className="form-row-slider">
                    <div className="slider-header">
                      <span>Intensity</span>
                      <span>{(anim.sustainIntensity ?? 0.5).toFixed(2)}</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="2"
                      step="0.05"
                      value={anim.sustainIntensity ?? 0.5}
                      onChange={(e) => handleAnimChange('sustainIntensity', parseFloat(e.target.value))}
                    />
                  </div>

                  <div className="form-row-slider">
                    <div className="slider-header">
                      <span>Speed</span>
                      <span>{(anim.sustainSpeed ?? 0.5).toFixed(2)}</span>
                    </div>
                    <input
                      type="range"
                      min="0.1"
                      max="3"
                      step="0.05"
                      value={anim.sustainSpeed ?? 0.5}
                      onChange={(e) => handleAnimChange('sustainSpeed', parseFloat(e.target.value))}
                    />
                  </div>
                </>
              )}
            </div>

            <div className="inspector-section-title">Apply Transitions to Others</div>
            <div className="inspector-section" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <button
                className="btn btn--secondary"
                style={{ width: '100%', padding: '4px 6px', fontSize: 'var(--text-xs)', height: 24 }}
                onClick={() => handleApplyAnimToAll(block.characterId)}
              >
                Apply transitions to all of {block.characterName}
              </button>
              <button
                className="btn btn--secondary"
                style={{ width: '100%', padding: '4px 6px', fontSize: 'var(--text-xs)', height: 24 }}
                onClick={() => handleApplyAnimToAll(null)}
              >
                Apply transitions to all project clips
              </button>
            </div>
          </>
        ) : null}
      </div>
    );
  };

  return (
    <div className="script-panel panel">
      {/* Tab headers */}
      <div className="panel__header" style={{ padding: 0 }}>
        <div className="editor-tabs" style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', height: '100%' }}>
            <button
              className={`editor-tab ${activeTab === 'script' ? 'editor-tab--active' : ''}`}
              onClick={() => setActiveTab('script')}
            >
              Script
            </button>
            <button
              className={`editor-tab ${activeTab === 'dialogue' ? 'editor-tab--active' : ''}`}
              onClick={() => setActiveTab('dialogue')}
            >
              Blocks
            </button>
            <button
              className={`editor-tab ${activeTab === 'animations' ? 'editor-tab--active' : ''}`}
              onClick={() => setActiveTab('animations')}
            >
              Animations
            </button>
            <button
              className={`editor-tab ${activeTab === 'inspector' ? 'editor-tab--active' : ''}`}
              onClick={() => setActiveTab('inspector')}
            >
              Inspector
            </button>
            <button
              className={`editor-tab ${activeTab === 'presets' ? 'editor-tab--active' : ''}`}
              onClick={() => setActiveTab('presets')}
            >
              Presets
            </button>
          </div>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingRight: 8, height: '100%' }}>
            {activeTab === 'script' && (
              <button
                className="panel__action-btn"
                onClick={loadSampleScript}
                title="Load Demo Script"
                style={{ fontSize: '11px', width: 'auto', padding: '0 8px', height: 22, border: '1px solid var(--border-default)' }}
              >
                Demo
              </button>
            )}
            {onMinimize && (
              <button
                onClick={onMinimize}
                style={{
                  height: '100%',
                  padding: '0 10px',
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-tertiary)',
                  cursor: 'pointer',
                  fontSize: '11px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all 0.15s'
                }}
                title="Minimize Script Editor"
                onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent-primary)'; e.currentTarget.style.background = 'rgba(255,255,255,0.02)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-tertiary)'; e.currentTarget.style.background = 'none'; }}
              >
                ▶
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="script-panel__content">
        {/* ── Sidebar: Character Keywords (Always visible on left side of script panel) ── */}
        <div className="script-panel__sidebar">
          <div className="keyword-list__title" style={{ padding: '8px 12px 4px' }}>
            Characters
          </div>
          <div className="keyword-list">
            {state.characters.map(char => (
              <div
                key={char.id}
                className={`keyword-item ${state.selectedElementId === char.id ? 'keyword-item--selected' : ''}`}
                onClick={() => actions.selectElement(char.id)}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'copy';
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  try {
                    const dataStr = e.dataTransfer.getData('application/json');
                    if (!dataStr) return;
                    const dragData = JSON.parse(dataStr);
                    const item = state.mediaItems.find(m => m.id === dragData.id) || dragData;
                    if (item.type === 'image') {
                      actions.assignCharacterAsset(char.id, item);
                      actions.addToast(`Assigned "${item.name}" to character ${char.name}`, 'success');
                    } else {
                      actions.addToast('Please drop an image file.', 'warning');
                    }
                  } catch (err) {
                    console.error(err);
                  }
                }}
              >
                <div
                  className="keyword-item__color"
                  style={{ background: char.color }}
                />
                {editingKeyword === char.id ? (
                  <input
                    style={{
                      flex: 1, background: 'var(--surface-2)', border: '1px solid var(--accent-primary)',
                      borderRadius: 4, padding: '2px 6px', color: 'var(--text-primary)',
                      fontSize: 'var(--text-sm)', fontFamily: 'var(--font-sans)',
                    }}
                    defaultValue={char.name}
                    autoFocus
                    onBlur={(e) => {
                      actions.updateCharacter(char.id, { name: e.target.value });
                      setEditingKeyword(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        actions.updateCharacter(char.id, { name: e.target.value });
                        setEditingKeyword(null);
                      }
                    }}
                  />
                ) : (
                  <span
                    className="keyword-item__name"
                    onDoubleClick={() => setEditingKeyword(char.id)}
                  >
                    {char.name}
                  </span>
                )}
                <button
                  style={{
                    width: 20,
                    height: 20,
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--text-disabled)',
                    fontSize: '14px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'color 0.2s',
                  }}
                  onMouseEnter={(e) => e.target.style.color = '#ff4081'}
                  onMouseLeave={(e) => e.target.style.color = 'var(--text-disabled)'}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm(`Are you sure you want to remove character "${char.name}"?`)) {
                      actions.removeCharacter(char.id);
                      actions.addToast(`Removed character: ${char.name}`, 'info');
                    }
                  }}
                  title="Remove Character"
                >
                  &times;
                </button>
                {char.asset ? (
                  <img
                    className="keyword-item__avatar"
                    src={char.asset.dataUrl}
                    alt={char.name}
                    onClick={(e) => { e.stopPropagation(); handleAssignAsset(char.id); }}
                    title="Click to change asset"
                  />
                ) : (
                  <button
                    style={{
                      width: 20, height: 20, background: 'var(--surface-2)',
                      border: '1px dashed var(--border-default)', borderRadius: 4,
                      color: 'var(--text-disabled)', fontSize: '10px', cursor: 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}
                    onClick={(e) => { e.stopPropagation(); handleAssignAsset(char.id); }}
                    title="Assign PNG asset"
                  >
                    +
                  </button>
                )}
              </div>
            ))}
          </div>

          {/* Add keyword */}
          <div style={{ padding: '4px 8px 8px' }}>
            <div style={{ display: 'flex', gap: 4 }}>
              <input
                style={{
                  flex: 1, padding: '4px 8px', background: 'var(--surface-2)',
                  border: '1px solid var(--border-subtle)', borderRadius: 4,
                  color: 'var(--text-primary)', fontSize: 'var(--text-xs)',
                  fontFamily: 'var(--font-sans)',
                }}
                placeholder="New keyword..."
                value={newKeywordName}
                onChange={(e) => setNewKeywordName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleAddKeyword(); }}
              />
              <button
                className="panel__action-btn"
                onClick={handleAddKeyword}
                style={{ fontSize: '14px' }}
              >
                +
              </button>
            </div>
          </div>

          {/* Timing tools */}
          <div style={{ padding: '4px 8px 8px', borderTop: '1px solid var(--border-subtle)' }}>
            <div className="keyword-list__title" style={{ padding: '4px 0' }}>Timing</div>
            <button
              className="keyword-add-btn"
              onClick={handleAutoTime}
              style={{ width: '100%', marginLeft: 0, marginRight: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
            >
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              Auto-Time
            </button>
            <button
              className="keyword-add-btn"
              onClick={handleSilenceDetect}
              style={{ width: '100%', marginLeft: 0, marginRight: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
            >
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
              Detect Silence
            </button>
          </div>
        </div>

        {/* ── Main Tab Area ── */}
        <div className="script-panel__editor">
          {activeTab === 'script' && (
            <>
              <textarea
                className="script-textarea"
                value={state.scriptText}
                onChange={handleScriptChange}
                placeholder={`Paste your script here...\n\nFormat: **Character Name:** Dialogue text\n\nExample:\n**Stewie:** Look, this is how you build it.\n**Peter:** What about the timeline though?`}
                spellCheck={false}
              />
              <div style={{
                padding: '8px 16px', background: 'var(--surface-1)',
                borderTop: '1px solid var(--border-subtle)',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              }}>
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                  {state.scriptText.split(/\s+/).filter(w => w).length} words
                </span>
                <button className="btn btn--primary" onClick={handleParse} style={{ height: 28, fontSize: 'var(--text-xs)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>
                  Parse Script
                </button>
              </div>
            </>
          )}

          {activeTab === 'dialogue' && (
            <div className="dialogue-blocks">
              {state.dialogueBlocks.length === 0 ? (
                <div className="empty-state">
                  <svg viewBox="0 0 24 24" width="48" height="48" fill="currentColor" style={{ color: 'var(--text-disabled)', margin: '0 auto 16px' }}>
                    <path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/>
                  </svg>
                  <div className="empty-state__title">No dialogue parsed</div>
                  <div className="empty-state__desc">
                    Go to the Script tab and paste a script, or click "Demo" to load a sample.
                  </div>
                </div>
              ) : (
                state.dialogueBlocks.map((block, index) => (
                  <div
                    key={block.id}
                    data-start={block.startTime}
                    data-duration={block.duration}
                    className={`dialogue-block ${state.currentTime >= block.startTime && state.currentTime <= block.startTime + block.duration ? 'dialogue-block--active' : ''} ${state.selectedClipId === block.id ? 'dialogue-block--selected' : ''}`}
                    style={{ '--block-color': block.color }}
                    onClick={() => {
                      actions.setCurrentTime(block.startTime);
                      actions.selectClip(block.id);
                    }}
                  >
                    <div className="dialogue-block__character">
                      <span
                        className="dialogue-block__character-dot"
                        style={{ background: block.color }}
                      />
                      <span style={{ color: block.color }}>{block.characterName}</span>
                      <span style={{
                        marginLeft: 'auto', fontSize: 'var(--text-xs)',
                        color: 'var(--text-disabled)', fontFamily: 'var(--font-mono)',
                      }}>
                        #{index + 1}
                      </span>
                    </div>
                    <div className="dialogue-block__text">{block.text}</div>
                    <div className="dialogue-block__timing">
                      <div className="dialogue-block__timing-group">
                        <span>Start:</span>
                        <input
                          type="number"
                          step="0.1"
                          min="0"
                          value={block.startTime.toFixed(1)}
                          onChange={(e) => handleBlockTimingChange(block.id, 'startTime', e.target.value)}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </div>
                      <div className="dialogue-block__timing-group">
                        <span>Dur:</span>
                        <input
                          type="number"
                          step="0.1"
                          min="0.1"
                          value={block.duration.toFixed(1)}
                          onChange={(e) => handleBlockTimingChange(block.id, 'duration', e.target.value)}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </div>
                      <span style={{ marginLeft: 'auto' }}>
                        {formatTime(block.startTime)}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {activeTab === 'animations' && renderAnimations()}
          {activeTab === 'inspector' && renderInspector()}
          {activeTab === 'presets' && renderPresets()}
        </div>
      </div>
    </div>
  );

  function renderPresets() {
    return (
      <div className="inspector-panel" style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: '16px', height: '100%', overflowY: 'auto' }}>
        <div style={{ fontSize: '13px', fontWeight: 'bold', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '6px', color: 'var(--text-primary)' }}>
          Preset Templates
        </div>

        {/* List Presets */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {/* Default Preset */}
          {defaultPreset && (
            <div style={{
              background: 'var(--surface-2)',
              border: '1px solid var(--border-default)',
              borderRadius: '6px',
              padding: '10px 12px',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 'bold', fontSize: '12px', color: 'var(--accent-primary)' }}>
                  {defaultPreset.name} (Built-in)
                </span>
                <button
                  className="btn btn--primary"
                  style={{ padding: '3px 8px', fontSize: '10px', height: '20px', width: 'auto' }}
                  onClick={() => applyPreset(defaultPreset)}
                >
                  Apply
                </button>
              </div>
              <div style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>
                Characters: {defaultPreset.characters.map(c => c.name).join(', ')}
              </div>
            </div>
          )}

          {/* Custom User Presets */}
          {customPresets.map((preset, idx) => (
            <div key={idx} style={{
              background: 'var(--surface-2)',
              border: '1px solid var(--border-default)',
              borderRadius: '6px',
              padding: '10px 12px',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 'bold', fontSize: '12px', color: 'var(--text-primary)' }}>
                  {preset.name}
                </span>
                <div style={{ display: 'flex', gap: '4px' }}>
                  <button
                    className="btn btn--primary"
                    style={{ padding: '3px 8px', fontSize: '10px', height: '20px', width: 'auto' }}
                    onClick={() => applyPreset(preset)}
                  >
                    Apply
                  </button>
                  <button
                    className="btn btn--secondary"
                    style={{ padding: '3px 6px', fontSize: '10px', height: '20px', width: 'auto', color: 'var(--accent-error, #ff5252)' }}
                    onClick={() => handleDeletePreset(preset.name)}
                    title="Delete Preset"
                  >
                    🗑
                  </button>
                </div>
              </div>
              <div style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>
                Characters: {preset.characters.map(c => c.name).join(', ')}
              </div>
            </div>
          ))}
        </div>

        {/* Create Preset Form */}
        <div style={{
          background: 'var(--surface-1)',
          border: '1px solid var(--border-subtle)',
          borderRadius: '6px',
          padding: '12px',
          marginTop: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px'
        }}>
          <div style={{ fontSize: '11px', fontWeight: 'bold', textTransform: 'uppercase', color: 'var(--text-tertiary)' }}>
            Save Current Setup as Preset
          </div>
          {state.characters.length === 0 ? (
            <div style={{ fontSize: '10px', color: 'var(--text-disabled)', fontStyle: 'italic' }}>
              Add characters to your timeline first to save a custom preset.
            </div>
          ) : (
            <>
              <div style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>
                Saves current timeline setup: <strong>{state.characters.map(c => c.name).join(', ')}</strong>.
              </div>
              <input
                type="text"
                placeholder="Enter preset name (e.g. My Preset)"
                value={newPresetName}
                onChange={(e) => setNewPresetName(e.target.value)}
                style={{
                  width: '100%',
                  background: 'var(--surface-2)',
                  border: '1px solid var(--border-default)',
                  borderRadius: '4px',
                  padding: '6px 8px',
                  color: 'var(--text-primary)',
                  fontSize: '11px',
                  outline: 'none'
                }}
              />
              <button
                className="btn btn--secondary"
                style={{ width: '100%', padding: '6px', fontSize: '11px', fontWeight: 'bold' }}
                onClick={handleSavePreset}
              >
                Save Preset
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  async function applyPreset(preset) {
    try {
      actions.addToast(`Applying preset "${preset.name}"...`, 'info');
      const voiceConfigs = { ...(state.voiceConfigs || {}) };

      for (const charInfo of preset.characters) {
        const currentCharacters = state.characters;
        const exists = currentCharacters.some(c => c.id === charInfo.id);
        if (!exists) {
          actions.addCharacter({ name: charInfo.name, id: charInfo.id });
          await new Promise(resolve => setTimeout(resolve, 150));
        }

        if (charInfo.assetPath && window.electronAPI) {
          const fileData = await window.electronAPI.readFile(charInfo.assetPath);
          if (!fileData.error) {
            const asset = {
              name: fileData.name,
              path: fileData.path,
              dataUrl: `data:${fileData.mime};base64,${fileData.data}`,
            };
            actions.assignCharacterAsset(charInfo.id, asset);
          }
        }

        if (charInfo.voice) {
          voiceConfigs[charInfo.id] = {
            type: charInfo.voice.type,
            refPath: charInfo.voice.refPath,
            refText: charInfo.voice.refText,
            presetName: charInfo.voice.presetName || ''
          };
        }
      }

      actions.setVoiceConfigs(voiceConfigs);
      actions.addToast(`Preset "${preset.name}" applied successfully!`, 'success');
    } catch (err) {
      console.error(err);
      actions.addToast(`Failed to apply preset: ${err.message}`, 'error');
    }
  }

  async function handleSavePreset() {
    if (!newPresetName.trim()) {
      actions.addToast('Please enter a preset name', 'warning');
      return;
    }
    const charPreset = {
      name: newPresetName.trim(),
      characters: state.characters.map(c => {
        const config = state.voiceConfigs?.[c.id];
        return {
          id: c.id,
          name: c.name,
          colorIndex: c.colorIndex,
          assetPath: c.asset?.path || null,
          voice: config ? {
            type: config.type,
            refPath: config.refPath,
            refText: config.refText,
            presetName: config.presetName || ''
          } : null
        };
      })
    };
    if (!window.electronAPI || !window.electronAPI.saveCharacterPreset) {
      actions.addToast('Preset saving requires the desktop app', 'error');
      return;
    }
    const res = await window.electronAPI.saveCharacterPreset(charPreset);
    if (res.success) {
      actions.addToast(`Preset "${charPreset.name}" saved successfully!`, 'success');
      setNewPresetName('');
      loadCustomPresets();
    } else {
      actions.addToast(`Failed to save preset: ${res.error}`, 'error');
    }
  }
  async function handleDeletePreset(name) {
    if (!window.electronAPI || !window.electronAPI.deleteCharacterPreset) {
      actions.addToast('Preset deletion requires the desktop app', 'error');
      return;
    }
    if (confirm(`Are you sure you want to delete preset "${name}"?`)) {
      const res = await window.electronAPI.deleteCharacterPreset(name);
      if (res.success) {
        actions.addToast(`Preset "${name}" deleted`, 'success');
        loadCustomPresets();
      } else {
        actions.addToast(`Failed to delete: ${res.error}`, 'error');
      }
    }
  }
}
