import React, { useState, useEffect, useCallback } from 'react';
import { useProject } from '../store/ProjectContext';
import { getMediaType, readFileAsDataUrl, uid } from '../utils/fileHelpers';
import HoverMenuItem from './HoverMenuItem';

const getVideoDuration = (dataUrl) => {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.src = dataUrl;
    video.onloadedmetadata = () => {
      resolve(video.duration);
    };
    video.onerror = () => {
      resolve(0);
    };
  });
};

const getAudioDuration = (dataUrl) => {
  return new Promise((resolve) => {
    const audio = new Audio();
    audio.preload = 'metadata';
    audio.src = dataUrl;
    audio.onloadedmetadata = () => {
      resolve(audio.duration);
    };
    audio.onerror = () => {
      resolve(5); // fallback default
    };
  });
};

/**
 * Media Library Panel - holds imported video clips, character PNGs, and audio
 * and a standard global Media Preset Library
 */
export default function MediaLibrary({ onMinimize }) {  const { state, actions, dispatch } = useProject();
  const [activeTab, setActiveTab] = useState('all');
  const [optimizing, setOptimizing] = useState({});
  const [contextMenu, setContextMenu] = useState(null); // { x, y, item }

  // Toggle mode state: 'project' or 'preset'
  const [viewMode, setViewMode] = useState('project');

  // Media Preset Library state
  const [presetTab, setPresetTab] = useState('video'); // video, image, audio, voice
  const [presetItems, setPresetItems] = useState([]);
  const [presetContextMenu, setPresetContextMenu] = useState(null); // { x, y, item }

  // Load preset library items from disk
  const loadPresets = useCallback(async () => {
    if (window.electronAPI && window.electronAPI.loadMediaPresets) {
      try {
        const loaded = await window.electronAPI.loadMediaPresets();
        setPresetItems(loaded);
      } catch (err) {
        console.error('Failed to load presets:', err);
      }
    }
  }, []);

  useEffect(() => {
    loadPresets();
  }, [loadPresets]);

  useEffect(() => {
    const closeMenus = () => {
      setContextMenu(null);
      setPresetContextMenu(null);
    };
    window.addEventListener('click', closeMenus);
    return () => window.removeEventListener('click', closeMenus);
  }, []);

  const tabs = [
    { id: 'all', label: 'All' },
    { id: 'video', label: 'Video' },
    { id: 'image', label: 'Images' },
    { id: 'audio', label: 'Audio' },
  ];

  const presetTabs = [
    { id: 'video', label: 'Background videos' },
    { id: 'image', label: 'Photos' },
    { id: 'audio', label: 'Audio' },
    { id: 'voice', label: 'Voices' },
  ];

  const filteredMedia = activeTab === 'all'
    ? state.mediaItems
    : state.mediaItems.filter(m => m.type === activeTab);

  const filteredPresets = presetItems.filter(p => p.type === presetTab);

  const handleImport = async () => {
    if (window.electronAPI) {
      const paths = await window.electronAPI.openFileDialog();
      if (paths && paths.length > 0) {
        for (const filePath of paths) {
          const fileData = await window.electronAPI.getFileInfo(filePath);
          if (fileData.error) continue;
          const ext = fileData.ext;
          const type = getMediaType(ext);
          const dataUrl = `file:///${fileData.path.replace(/\\/g, '/')}`;
          let duration = undefined;
          if (type === 'video') {
            duration = await getVideoDuration(dataUrl);
          } else if (type === 'audio') {
            duration = await getAudioDuration(dataUrl);
          }
          const item = {
            id: `media_${Date.now()}_${uid()}`,
            name: fileData.name,
            path: fileData.path,
            ext,
            dataUrl,
            type,
            duration,
          };
          actions.addMedia(item);
          actions.addToast(`Imported: ${fileData.name}`, 'success');
        }
      }
    } else {
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      input.accept = 'video/*,audio/*,image/*';
      input.onchange = async (e) => {
        for (const file of e.target.files) {
          const dataUrl = await readFileAsDataUrl(file);
          const ext = '.' + file.name.split('.').pop().toLowerCase();
          const type = getMediaType(ext);
          let duration = undefined;
          if (type === 'video') {
            duration = await getVideoDuration(dataUrl);
          } else if (type === 'audio') {
            duration = await getAudioDuration(dataUrl);
          }
          const item = {
            id: `media_${Date.now()}_${uid()}`,
            name: file.name,
            path: file.name,
            ext,
            dataUrl,
            type,
            duration,
          };
          actions.addMedia(item);
          actions.addToast(`Imported: ${file.name}`, 'success');
        }
      };
      input.click();
    }
  };

  const handleApplyAllImages = () => {
    const items = (state.mediaItems || []).filter(m => m.type === 'image');
    if (items.length === 0) {
      actions.addToast('No images in the media library yet.', 'warning');
      return;
    }
    actions.applyImagesToTimeline(items);
    actions.addToast(`Applied ${items.length} images to the timeline in order`, 'success');
  };

  const handleImportFolder = async () => {
    if (window.electronAPI && window.electronAPI.openFolderDialog) {
      const res = await window.electronAPI.openFolderDialog();
      if (!res || res.canceled) return;
      if (res.error) {
        actions.addToast(`Failed to read folder: ${res.error}`, 'error');
        return;
      }
      if (!res.files || res.files.length === 0) {
        actions.addToast('No images found in the selected folder.', 'warning');
        return;
      }

      const items = res.files.map(f => ({
        id: `media_${Date.now()}_${uid()}`,
        name: f.name,
        path: f.path,
        ext: f.ext,
        dataUrl: `file:///${f.path.replace(/\\/g, '/')}`,
        type: 'image',
      }));

      actions.importImageFolder(items);
      actions.addToast(`Imported ${items.length} images to the media library`, 'success');
    } else {
      const input = document.createElement('input');
      input.type = 'file';
      input.webkitdirectory = true;
      input.onchange = async (e) => {
        const files = Array.from(e.target.files)
          .filter(f => getMediaType('.' + f.name.split('.').pop().toLowerCase()) === 'image')
          .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

        if (files.length === 0) {
          actions.addToast('No images found in the selected folder.', 'warning');
          return;
        }

        const items = [];
        for (const file of files) {
          const dataUrl = await readFileAsDataUrl(file);
          items.push({
            id: `media_${Date.now()}_${uid()}`,
            name: file.name,
            path: file.name,
            ext: '.' + file.name.split('.').pop().toLowerCase(),
            dataUrl,
            type: 'image',
          });
        }

        actions.importImageFolder(items);
        actions.addToast(`Imported ${items.length} images to the media library`, 'success');
      };
      input.click();
    }
  };

  const handleOptimizeVideo = async (item) => {
    if (!window.electronAPI) {
      actions.addToast('Optimization requires the desktop app.', 'error');
      return;
    }

    setOptimizing(prev => ({ ...prev, [item.id]: 0 }));
    actions.addToast(`Optimizing "${item.name}" for instant seek...`, 'info');

    try {
      // Get video duration
      let duration = item.duration;
      if (!duration) {
        duration = await getVideoDuration(item.dataUrl);
      }

      // Setup progress listener
      if (window.electronAPI?.onOptimizeProgress) {
        window.electronAPI.onOptimizeProgress((data) => {
          if (data && data.filePath === item.path && typeof data.percent === 'number') {
            setOptimizing(prev => ({ ...prev, [item.id]: data.percent }));
          }
        });
      }

      // Call optimizeVideo IPC
      if (!window.electronAPI?.optimizeVideo) {
        actions.addToast('Video optimization is not available in this environment.', 'warning');
        return;
      }

      const result = await window.electronAPI.optimizeVideo({
        filePath: item.path,
        duration: duration || 0
      });

      if (result && result.success) {
        // Add the optimized item to the media library using its local path URL directly
        const optimizedItem = {
          id: `media_${Date.now()}_${uid()}`,
          name: `${item.name.split('.')[0]}_optimized.mp4`,
          path: result.outputPath,
          ext: '.mp4',
          dataUrl: `file:///${result.outputPath.replace(/\\/g, '/')}`,
          type: 'video',
          duration: duration
        };

        actions.addMedia(optimizedItem);
        actions.addToast(`Optimization complete! Created "${optimizedItem.name}"`, 'success');
      } else {
        actions.addToast(`Optimization failed: ${result?.error?.substring(0, 100) || 'Unknown error'}`, 'error');
      }
    } catch (err) {
      actions.addToast(`Optimization error: ${err.message}`, 'error');
    } finally {
      if (window.electronAPI?.removeOptimizeProgress) {
        window.electronAPI.removeOptimizeProgress();
      }
      setOptimizing(prev => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
    }
  };

  const handleDragStart = (e, item) => {
    e.dataTransfer.setData('application/json', JSON.stringify({ id: item.id }));
    e.dataTransfer.effectAllowed = 'copy';
  };

  const handleSetAsBackground = (item) => {
    actions.setBackgroundVideo(item);
    actions.addToast(`Set "${item.name}" as background`, 'success');
  };

  const handleSetAsAudio = (item) => {
    actions.setAudio(item);
    actions.addToast(`Set "${item.name}" as dialogue audio`, 'success');
  };

  const handleAssignToCharacter = (item) => {
    const charId = state.characters.length > 0 ? state.characters[0].id : null;
    if (charId) {
      actions.assignCharacterAsset(charId, item);
      actions.addToast(`Assigned "${item.name}" to ${state.characters[0].name}`, 'success');
    }
  };

  const handleExportItem = async (item) => {
    setContextMenu(null);
    if (!window.electronAPI) {
      actions.addToast("Export requires the desktop app.", "error");
      return;
    }
    
    const defaultPath = item.name;
    const dest = await window.electronAPI.saveFileDialog({
      defaultPath,
      filters: [{ name: item.type === 'audio' ? 'Audio File' : item.type === 'video' ? 'Video File' : 'Image File', extensions: [item.ext.replace('.', '')] }]
    });
    
    if (dest) {
      actions.addToast(`Exporting to ${dest}...`, "info");
      const res = await window.electronAPI.copyFile(item.path, dest);
      if (res.success) {
        actions.addToast("Export successful!", "success");
      } else {
        actions.addToast(`Export failed: ${res.error}`, "error");
      }
    }
  };

  const handleRenameItem = (item) => {
    setContextMenu(null);
    const newName = prompt("Rename media item:", item.name);
    if (newName && newName.trim()) {
      actions.renameMedia(item.id, newName.trim());
      actions.addToast("Renamed media item!", "success");
    }
  };

  const handleDeleteItem = (item) => {
    setContextMenu(null);
    if (confirm(`Are you sure you want to delete "${item.name}" from library?`)) {
      actions.removeMedia(item.id);
      actions.addToast("Removed media item!", "success");
    }
  };

  const resolveBlockForVoice = (item) => {
    let block = state.dialogueBlocks.find(b => b.id === item.blockId);
    if (!block && item.name) {
      const match = item.name.match(/voice_(\d+)_/);
      if (match) {
        const idx = parseInt(match[1]) - 1;
        if (idx >= 0 && idx < state.dialogueBlocks.length) {
          block = state.dialogueBlocks[idx];
        }
      }
    }
    return block;
  };

  const handleAutoApplyVoice = (item) => {
    if (item.mergedVoiceover) {
      // Single continuous voiceover: one free-standing clip on the audio
      // track anchored at the first dialogue block, spanning the narration.
      const firstBlock = state.dialogueBlocks[0];
      actions.applyVoices([{
        startTime: firstBlock ? firstBlock.startTime : (item.startTime != null ? item.startTime : 0),
        duration: item.duration || 3.0,
        words: item.words || [],
        name: item.name,
        path: item.path,
        dataUrl: item.dataUrl,
      }]);
      actions.addToast(`Applied continuous voiceover clip to the timeline!`, "success");
      return;
    }

    const block = resolveBlockForVoice(item);
    if (!block) {
      actions.addToast("Could not find matching dialogue block for this voice clone.", "warning");
      return;
    }

    actions.applyVoices([{
      blockId: block.id,
      duration: item.duration || 3.0,
      words: item.words || [],
      name: item.name,
      path: item.path,
      dataUrl: item.dataUrl,
    }]);

    actions.addToast(`Applied voice to dialogue line of ${block.characterName}!`, "success");
  };

  const handleApplyAllVoices = () => {
    const voiceItems = state.mediaItems.filter(item => item.isVoiceClone);
    const voicesToApply = [];
    
    voiceItems.forEach(item => {
      const block = resolveBlockForVoice(item);
      if (item.mergedVoiceover) {
        const firstBlock = state.dialogueBlocks[0];
        voicesToApply.push({
          startTime: firstBlock ? firstBlock.startTime : (item.startTime != null ? item.startTime : 0),
          duration: item.duration || 3.0,
          words: item.words || [],
          name: item.name,
          path: item.path,
          dataUrl: item.dataUrl,
        });
      } else if (block) {
        voicesToApply.push({
          blockId: block.id,
          duration: item.duration || 3.0,
          words: item.words || [],
          name: item.name,
          path: item.path,
          dataUrl: item.dataUrl,
        });
      }
    });

    if (voicesToApply.length === 0) {
      actions.addToast("No matching script dialogue lines found to apply these voice clips to.", "warning");
      return;
    }

    actions.applyVoices(voicesToApply);
    actions.addToast(`Applied all ${voicesToApply.length} voice clips to the timeline!`, "success");
  };

  const handleRemoveAllTimelineVoices = () => {
    if (confirm("Are you sure you want to remove all voice clips from the timeline and restore default estimated durations?")) {
      actions.removeAllVoicesFromTimeline();
      actions.addToast("Removed all voice clips from timeline.", "success");
    }
  };

  const handleDeleteAllVoiceClips = () => {
    if (confirm("Are you sure you want to permanently delete all generated voice clips from the media library? This will also remove them from the timeline.")) {
      actions.removeAllVoicesFromTimeline();
      actions.deleteAllVoiceClipsFromLibrary();
      actions.addToast("Deleted all generated voice clips from library.", "success");
    }
  };

  // ─── Media Preset Library Handlers ───

  const handleSaveToPresets = async (item) => {
    if (!window.electronAPI) {
      actions.addToast('Saving presets requires the desktop app.', 'error');
      return;
    }

    let presetType = item.type; // video, image, audio
    if (item.type === 'audio' && item.isVoiceClone) {
      presetType = 'voice';
    }

    actions.addToast(`Saving "${item.name}" to preset library...`, 'info');
    try {
      const res = await window.electronAPI.saveMediaPreset({
        filePath: item.path,
        name: item.name,
        type: presetType,
        duration: item.duration
      });

      if (res.success) {
        actions.addToast(`Successfully saved "${item.name}" to presets!`, 'success');
        loadPresets();
      } else {
        actions.addToast(`Failed to save preset: ${res.error}`, 'error');
      }
    } catch (err) {
      actions.addToast(`Error saving preset: ${err.message}`, 'error');
    }
  };

  const handleImportPreset = async () => {
    if (!window.electronAPI) {
      actions.addToast('Preset import requires the desktop app.', 'error');
      return;
    }

    const paths = await window.electronAPI.openFileDialog();
    if (paths && paths.length > 0) {
      let importedCount = 0;
      for (const filePath of paths) {
        const fileData = await window.electronAPI.getFileInfo(filePath);
        if (fileData.error) continue;

        const ext = fileData.ext;
        const type = getMediaType(ext); // video, image, audio
        let presetType = type;
        if (type === 'audio' && presetTab === 'voice') {
          presetType = 'voice';
        } else if (type === 'image' && presetTab === 'image') {
          presetType = 'image';
        } else if (type === 'video' && presetTab === 'video') {
          presetType = 'video';
        } else {
          // Fallback to active tab type
          presetType = presetTab;
        }

        let duration = undefined;
        const dataUrl = `file:///${fileData.path.replace(/\\/g, '/')}`;
        if (presetType === 'video') {
          duration = await getVideoDuration(dataUrl);
        } else if (presetType === 'audio' || presetType === 'voice') {
          duration = await getAudioDuration(dataUrl);
        }

        actions.addToast(`Importing "${fileData.name}" as preset...`, 'info');
        const res = await window.electronAPI.saveMediaPreset({
          filePath: fileData.path,
          name: fileData.name,
          type: presetType,
          duration: duration
        });

        if (res.success) {
          importedCount++;
        } else {
          actions.addToast(`Failed to import "${fileData.name}": ${res.error}`, 'error');
        }
      }

      if (importedCount > 0) {
        actions.addToast(`Imported ${importedCount} preset files successfully!`, 'success');
        loadPresets();
      }
    }
  };

  const handleDeletePreset = async (presetItem) => {
    setPresetContextMenu(null);
    if (confirm(`Are you sure you want to permanently delete preset "${presetItem.name}"?`)) {
      try {
        const res = await window.electronAPI.deleteMediaPreset(presetItem.id);
        if (res.success) {
          actions.addToast(`Deleted preset "${presetItem.name}"`, 'success');
          loadPresets();
        } else {
          actions.addToast(`Failed to delete preset: ${res.error}`, 'error');
        }
      } catch (err) {
        actions.addToast(`Error deleting preset: ${err.message}`, 'error');
      }
    }
  };

  // Helper to ensure a preset is in the project media items so it can be referenced/played
  const ensurePresetInProjectMedia = (presetItem) => {
    const existing = state.mediaItems.find(m => m.path === presetItem.path);
    if (existing) return existing;

    const newItem = {
      id: `media_${Date.now()}_${uid()}`,
      name: presetItem.name,
      path: presetItem.path,
      ext: presetItem.ext,
      dataUrl: presetItem.dataUrl,
      type: presetItem.type === 'voice' ? 'audio' : presetItem.type,
      duration: presetItem.duration,
      isVoiceClone: presetItem.type === 'voice'
    };

    actions.addMedia(newItem);
    return newItem;
  };

  const handlePresetDragStart = (e, presetItem) => {
    const projectItem = ensurePresetInProjectMedia(presetItem);
    e.dataTransfer.setData('application/json', JSON.stringify({ id: projectItem.id }));
    e.dataTransfer.effectAllowed = 'copy';
  };

  const handleApplyPresetItem = (presetItem) => {
    if (presetItem.type === 'video') {
      const projectItem = ensurePresetInProjectMedia(presetItem);
      handleSetAsBackground(projectItem);
    } else if (presetItem.type === 'image') {
      const projectItem = ensurePresetInProjectMedia(presetItem);
      handleAssignToCharacter(projectItem);
    } else if (presetItem.type === 'audio') {
      const projectItem = ensurePresetInProjectMedia(presetItem);
      handleSetAsAudio(projectItem);
    } else if (presetItem.type === 'voice') {
      const projectItem = ensurePresetInProjectMedia(presetItem);
      handleAutoApplyVoice(projectItem);
    }
  };

  return (
    <div className="media-library panel" style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 0 }}>
      
      {/* ── TOP LEVEL VIEW MODE TOGGLE ── */}
      <div className="media-library-modes">
        <div style={{ display: 'flex', flex: 1 }}>
          <button
            className={`media-library-mode-btn ${viewMode === 'project' ? 'media-library-mode-btn--active' : ''}`}
            onClick={() => setViewMode('project')}
          >
            Project Media
          </button>
          <button
            className={`media-library-mode-btn ${viewMode === 'preset' ? 'media-library-mode-btn--active' : ''}`}
            onClick={() => setViewMode('preset')}
          >
            Preset Media
          </button>
        </div>
        {onMinimize && (
          <button
            onClick={onMinimize}
            className="media-tab"
            style={{
              flex: 'none',
              width: 32,
              height: 32,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginRight: 4,
              color: 'var(--text-tertiary)',
              borderRadius: 'var(--radius-sm)',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              transition: 'all 0.15s'
            }}
            title="Minimize Media Panel"
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent-primary)'; e.currentTarget.style.background = 'var(--bg-hover)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-tertiary)'; e.currentTarget.style.background = 'none'; }}
          >
            ◀
          </button>
        )}
      </div>

      {/* ── VIEW MODE 1: PROJECT MEDIA ── */}
      {viewMode === 'project' && (
        <div className="media-section">
          <div className="media-section__header">
            <span className="media-section__title">Project Media</span>
            <div className="panel__actions">
              <button className="panel__action-btn" onClick={handleImport} title="Import Files" style={{ width: 22, height: 22, fontSize: 13, fontWeight: 'bold' }}>
                +
              </button>
              <button
                className="panel__action-btn"
                onClick={handleImportFolder}
                title="Import Folder of Images (adds to Media Library)"
                style={{ width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
              </button>
              {state.mediaItems.some(m => m.type === 'image') && (
                <button
                  className="panel__action-btn"
                  onClick={handleApplyAllImages}
                  title="Apply All Images to Timeline (in order)"
                  style={{ width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>
                </button>
              )}
            </div>
          </div>

          {/* Voice actions sub-bar, positioned underneath project media title row to adapt to narrow screens */}
          {(activeTab === 'audio' || activeTab === 'all') && state.mediaItems.some(m => m.isVoiceClone) && (
            <div className="media-voice-actions-bar">
              <button 
                className="panel__action-btn panel__action-btn--apply-all" 
                onClick={handleApplyAllVoices}
                title="Apply all voice clips to dialogue tracks"
              >
                <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ marginRight: 4 }}><path d="M16 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8l-5-5z"/><polyline points="14 3 14 8 19 8"/></svg>
                Apply All
              </button>
              <button 
                className="panel__action-btn panel__action-btn--remove-all" 
                onClick={handleRemoveAllTimelineVoices}
                title="Remove all voice clips from timeline"
              >
                Remove All
              </button>
              <button 
                className="panel__action-btn panel__action-btn--delete-all" 
                onClick={handleDeleteAllVoiceClips}
                title="Delete all voice clips from media library"
              >
                Delete All
              </button>
            </div>
          )}

          <div className="media-tabs" style={{ display: 'flex', alignItems: 'center' }}>
            <div style={{ display: 'flex', gap: 'var(--sp-1)', flex: 1, paddingRight: '8px' }}>
              {tabs.map(tab => (
                <button
                  key={tab.id}
                  className={`media-tab ${activeTab === tab.id ? 'media-tab--active' : ''}`}
                  onClick={() => setActiveTab(tab.id)}
                  style={{ flex: 1 }}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          <div className="panel__body">
            {filteredMedia.length === 0 ? (
              <div className="media-drop-zone" onClick={handleImport}>
                <span className="media-drop-zone__icon">
                  <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.5 }}><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
                </span>
                <span className="media-drop-zone__text">Import media files</span>
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-disabled)' }}>
                  Video, Images, Audio
                </span>
              </div>
            ) : (
              <div className="media-grid">
                {filteredMedia.map(item => (
                  <div
                    key={item.id}
                    className={`media-item ${item.type === 'image' ? 'media-item--character' : ''}`}
                    draggable
                    onDragStart={(e) => handleDragStart(e, item)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setContextMenu({
                        x: e.clientX,
                        y: e.clientY,
                        item
                      });
                    }}
                  >
                    <div
                      className="media-item__preset-save-btn"
                      onClick={(e) => { e.stopPropagation(); handleSaveToPresets(item); }}
                      title="Save to Preset Library"
                    >
                      Save
                    </div>

                    {item.type === 'video' && (
                      <>
                        <video className="media-item__thumb" src={item.dataUrl} muted />
                        <div className="media-item__label">{item.name}</div>
                        
                        {optimizing[item.id] !== undefined ? (
                          <div
                            style={{
                              position: 'absolute', bottom: 4, left: 4, right: 4,
                              background: 'rgba(0,0,0,0.85)', borderRadius: 4,
                              padding: '3px 4px', fontSize: '9px', color: '#00e5ff',
                              textAlign: 'center', zIndex: 10
                            }}
                          >
                            Optimizing... {optimizing[item.id]}%
                          </div>
                        ) : (
                          !item.name.toLowerCase().includes('_optimized') && (
                            <button
                              style={{
                                position: 'absolute', bottom: 4, left: 4,
                                background: 'rgba(0,184,212,0.85)', border: 'none',
                                borderRadius: 4, padding: '3px 6px', fontSize: '10px',
                                color: 'white', cursor: 'pointer', fontWeight: 'bold',
                                zIndex: 10, display: 'flex', alignItems: 'center', gap: 2
                              }}
                              onClick={(e) => { e.stopPropagation(); handleOptimizeVideo(item); }}
                              title="Optimize seek speed"
                            >
                              <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ marginRight: 2 }}><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
                              Optimize
                            </button>
                          )
                        )}

                        <div
                          style={{
                            position: 'absolute', top: 4, right: 4,
                            background: 'rgba(0,0,0,0.6)', borderRadius: 4,
                            padding: '2px 6px', fontSize: '10px', cursor: 'pointer',
                            color: '#00e5ff',
                            zIndex: 10
                          }}
                          onClick={(e) => { e.stopPropagation(); handleSetAsBackground(item); }}
                          title="Set as background"
                        >
                          BG
                        </div>
                      </>
                    )}
                    {item.type === 'image' && (
                      <>
                        <img className="media-item__thumb" src={item.dataUrl} alt={item.name} />
                        <div className="media-item__label">{item.name}</div>
                      </>
                    )}
                    {item.type === 'audio' && (
                      <>
                        <div className="media-item__icon">
                          <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
                        </div>
                        <div className="media-item__label">{item.name}</div>
                        
                        {item.isVoiceClone && (
                          <button
                            style={{
                              position: 'absolute', bottom: 4, right: 4,
                              background: '#7c4dff', border: 'none',
                              borderRadius: 4, padding: '3px 6px', fontSize: '10px',
                              color: 'white', cursor: 'pointer', fontWeight: 'bold',
                              zIndex: 10, display: 'flex', alignItems: 'center', gap: 2
                            }}
                            onClick={(e) => { e.stopPropagation(); handleAutoApplyVoice(item); }}
                            title="Auto-apply to dialogue track"
                          >
                            <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ marginRight: 2 }}><polyline points="20 6 9 17 4 12"/></svg>
                            Apply
                          </button>
                        )}

                        <div
                          style={{
                            position: 'absolute', top: 4, right: 4,
                            background: 'rgba(0,0,0,0.6)', borderRadius: 4,
                            padding: '3px 6px', fontSize: '10px', cursor: 'pointer',
                            color: '#00e5ff',
                            display: 'flex', alignItems: 'center', justifyContent: 'center'
                          }}
                          onClick={(e) => { e.stopPropagation(); handleSetAsAudio(item); }}
                          title="Set as dialogue audio"
                        >
                          <svg viewBox="0 0 24 24" width="10" height="10" fill="currentColor"><path d="M12 3v18l-5-5H3V8h4l5-5z"/></svg>
                        </div>
                      </>
                    )}
                  </div>
                ))}
                <div className="media-drop-zone" onClick={handleImport} style={{ gridColumn: 'span 2', minHeight: 60 }}>
                  <span className="media-drop-zone__icon" style={{ fontSize: '1.2rem' }}>+</span>
                  <span className="media-drop-zone__text" style={{ fontSize: 'var(--text-xs)' }}>Add more</span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── VIEW MODE 2: PRESET MEDIA ── */}
      {viewMode === 'preset' && (
        <div className="media-section">
          <div className="media-section__header">
            <span className="media-section__title">Media Presets</span>
            <div className="panel__actions">
              <button className="panel__action-btn" onClick={handleImportPreset} title="Import Direct Preset" style={{ width: 22, height: 22, fontSize: 13, fontWeight: 'bold' }}>
                +
              </button>
            </div>
          </div>

          <div className="media-tabs" style={{ display: 'flex', alignItems: 'center' }}>
            <div style={{ display: 'flex', gap: '2px', flex: 1, overflowX: 'auto', paddingRight: '8px' }}>
              {presetTabs.map(tab => (
                <button
                  key={tab.id}
                  className={`media-tab ${presetTab === tab.id ? 'media-tab--active' : ''}`}
                  onClick={() => setPresetTab(tab.id)}
                  style={{ flex: 1, fontSize: '10px', minWidth: '70px', padding: '4px 6px' }}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          <div className="panel__body">
            {filteredPresets.length === 0 ? (
              <div className="media-drop-zone" onClick={handleImportPreset}>
                <span className="media-drop-zone__icon">
                  <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.4 }}><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
                </span>
                <span className="media-drop-zone__text" style={{ fontSize: 'var(--text-xs)' }}>No presets loaded</span>
                <span style={{ fontSize: '9px', color: 'var(--text-disabled)' }}>
                  Click + to import direct presets
                </span>
              </div>
            ) : (
              <div className="media-grid">
                {filteredPresets.map(preset => (
                  <div
                    key={preset.id}
                    className={`media-item ${preset.type === 'image' ? 'media-item--character' : ''}`}
                    draggable
                    onDragStart={(e) => handlePresetDragStart(e, preset)}
                    onDoubleClick={() => handleApplyPresetItem(preset)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setPresetContextMenu({
                        x: e.clientX,
                        y: e.clientY,
                        item: preset
                      });
                    }}
                  >
                    {preset.type === 'video' && (
                      <>
                        <video className="media-item__thumb" src={preset.dataUrl} muted />
                        <div className="media-item__label">{preset.name}</div>
                        <div
                          style={{
                            position: 'absolute', top: 4, right: 4,
                            background: 'rgba(0,0,0,0.6)', borderRadius: 4,
                            padding: '2px 6px', fontSize: '10px', cursor: 'pointer',
                            color: '#00e5ff',
                            zIndex: 10
                          }}
                          onClick={(e) => { e.stopPropagation(); handleApplyPresetItem(preset); }}
                          title="Apply background video"
                        >
                          BG
                        </div>
                      </>
                    )}
                    {preset.type === 'image' && (
                      <>
                        <img className="media-item__thumb" src={preset.dataUrl} alt={preset.name} />
                        <div className="media-item__label">{preset.name}</div>
                        <div
                          style={{
                            position: 'absolute', top: 4, right: 4,
                            background: 'rgba(0,0,0,0.6)', borderRadius: 4,
                            padding: '2px 6px', fontSize: '9px', cursor: 'pointer',
                            color: '#00e5ff',
                            zIndex: 10
                          }}
                          onClick={(e) => { e.stopPropagation(); handleApplyPresetItem(preset); }}
                          title="Assign to character"
                        >
                          Asset
                        </div>
                      </>
                    )}
                    {preset.type === 'audio' && (
                      <>
                        <div className="media-item__icon">
                          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
                        </div>
                        <div className="media-item__label">{preset.name}</div>
                        <div
                          style={{
                            position: 'absolute', top: 4, right: 4,
                            background: 'rgba(0,0,0,0.6)', borderRadius: 4,
                            padding: '3px 6px', fontSize: '9px', cursor: 'pointer',
                            color: '#00e5ff',
                            display: 'flex', alignItems: 'center', justifyContent: 'center'
                          }}
                          onClick={(e) => { e.stopPropagation(); handleApplyPresetItem(preset); }}
                          title="Set as dialogue audio"
                        >
                          Audio
                        </div>
                      </>
                    )}
                    {preset.type === 'voice' && (
                      <>
                        <div className="media-item__icon">
                          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
                        </div>
                        <div className="media-item__label">{preset.name}</div>
                        <button
                          style={{
                            position: 'absolute', bottom: 4, right: 4,
                            background: '#7c4dff', border: 'none',
                            borderRadius: 4, padding: '3px 6px', fontSize: '9px',
                            color: 'white', cursor: 'pointer', fontWeight: 'bold',
                            zIndex: 10, display: 'flex', alignItems: 'center', gap: 2
                          }}
                          onClick={(e) => { e.stopPropagation(); handleApplyPresetItem(preset); }}
                          title="Apply voice to dialogue track"
                        >
                          Apply
                        </button>
                      </>
                    )}
                  </div>
                ))}
                <div className="media-drop-zone" onClick={handleImportPreset} style={{ gridColumn: 'span 2', minHeight: 60 }}>
                  <span className="media-drop-zone__icon" style={{ fontSize: '1.1rem' }}>+</span>
                  <span className="media-drop-zone__text" style={{ fontSize: '9px' }}>Add preset</span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── PROJECT CONTEXT MENU ── */}
      {contextMenu && (
        <div
          style={{
            position: 'fixed',
            top: contextMenu.y,
            left: contextMenu.x,
            background: '#151520',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            boxShadow: '0 8px 16px rgba(0,0,0,0.6)',
            borderRadius: 6,
            zIndex: 10000,
            padding: '4px 0',
            minWidth: 150,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <HoverMenuItem text="Save to Preset Library" onClick={() => handleSaveToPresets(contextMenu.item)} color="#ffb300" />
          <HoverMenuItem text="Export File..." onClick={() => handleExportItem(contextMenu.item)} />
          <HoverMenuItem text="Rename..." onClick={() => handleRenameItem(contextMenu.item)} />
          <HoverMenuItem text="Delete" color="#ff4081" onClick={() => handleDeleteItem(contextMenu.item)} />
        </div>
      )}

      {/* ── PRESET CONTEXT MENU ── */}
      {presetContextMenu && (
        <div
          style={{
            position: 'fixed',
            top: presetContextMenu.y,
            left: presetContextMenu.x,
            background: '#151520',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            boxShadow: '0 8px 16px rgba(0,0,0,0.6)',
            borderRadius: 6,
            zIndex: 10000,
            padding: '4px 0',
            minWidth: 150,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <HoverMenuItem text="Apply / Use" onClick={() => { handleApplyPresetItem(presetContextMenu.item); setPresetContextMenu(null); }} />
          <HoverMenuItem text="Delete Preset" color="#ff4081" onClick={() => handleDeletePreset(presetContextMenu.item)} />
        </div>
      )}

    </div>
  );
}
