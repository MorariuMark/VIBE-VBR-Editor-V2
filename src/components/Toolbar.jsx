import React from 'react';
import { useProject } from '../store/ProjectContext';
import { getMediaType, readFileAsDataUrl, uid } from '../utils/fileHelpers';

/**
 * Main toolbar with editing tools and action buttons
 */
export default function Toolbar({ onToggleConsole, isConsoleOpen }) {
  const { state, actions } = useProject();
  const { activeTool } = state;

  const [theme, setTheme] = React.useState(() => {
    return localStorage.getItem('theme') || 'default';
  });

  React.useEffect(() => {
    document.body.classList.remove('theme-blue', 'theme-red');
    if (theme === 'blue') {
      document.body.classList.add('theme-blue');
    } else if (theme === 'red') {
      document.body.classList.add('theme-red');
    }
    localStorage.setItem('theme', theme);
  }, [theme]);

  const handleThemeToggle = () => {
    const themes = ['default', 'blue', 'red'];
    setTheme(prev => {
      const currentIndex = themes.indexOf(prev);
      const nextIndex = (currentIndex + 1) % themes.length;
      return themes[nextIndex];
    });
  };

  const tools = [
    { id: 'select', label: 'Select', shortcut: 'V' },
  ];

  const renderToolIcon = (toolId) => {
    switch (toolId) {
      case 'select':
        return <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/></svg>;
      default:
        return null;
    }
  };

  // Handle keyboard shortcuts
  React.useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      switch (e.key.toLowerCase()) {
        case 'v': actions.setActiveTool('select'); break;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleImport = async () => {
    if (window.electronAPI) {
      const paths = await window.electronAPI.openFileDialog();
      if (paths && paths.length > 0) {
        for (const filePath of paths) {
          const fileData = await window.electronAPI.getFileInfo(filePath);
          if (fileData.error) {
            actions.addToast(`Failed to import: ${fileData.error}`, 'error');
            continue;
          }
          const ext = fileData.ext;
          const type = getMediaType(ext);
          const item = {
            id: `media_${Date.now()}_${uid()}`,
            name: fileData.name,
            path: fileData.path,
            ext,
            dataUrl: `file:///${fileData.path.replace(/\\/g, '/')}`,
            type,
          };
          actions.addMedia(item);
          
          // Auto-assign based on type
          if (item.type === 'audio' && !state.audioFile) {
            actions.setAudio(item);
          } else if (item.type === 'video' && !state.backgroundVideo) {
            actions.setBackgroundVideo(item);
          }
          
          actions.addToast(`Imported: ${fileData.name}`, 'success');
        }
      }
    } else {
      // Browser fallback: file input
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      input.accept = 'video/*,audio/*,image/*';
      input.onchange = async (e) => {
        for (const file of e.target.files) {
          const dataUrl = await readFileAsDataUrl(file);
          const item = {
            id: `media_${Date.now()}_${uid()}`,
            name: file.name,
            path: file.name,
            ext: '.' + file.name.split('.').pop().toLowerCase(),
            dataUrl,
            type: getMediaType('.' + file.name.split('.').pop().toLowerCase()),
          };
          actions.addMedia(item);
          
          if (item.type === 'audio' && !state.audioFile) {
            actions.setAudio(item);
          } else if (item.type === 'video' && !state.backgroundVideo) {
            actions.setBackgroundVideo(item);
          }
          
          actions.addToast(`Imported: ${file.name}`, 'success');
        }
      };
      input.click();
    }
  };

  const handleVoiceCloneOpen = async () => {
    if (window.electronAPI && window.electronAPI.setActiveProjectState) {
      await window.electronAPI.setActiveProjectState({
        characters: state.characters,
        dialogueBlocks: state.dialogueBlocks,
        voiceConfigs: state.voiceConfigs
      });
      window.electronAPI.openVoiceCloneWindow();
    } else {
      actions.addToast("Voice Cloning requires the desktop Electron environment.", "warning");
    }
  };

  const [showHistory, setShowHistory] = React.useState(false);
  const historyRef = React.useRef(null);

  React.useEffect(() => {
    const handleClickOutside = (e) => {
      if (historyRef.current && !historyRef.current.contains(e.target)) {
        setShowHistory(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSettingsOpen = async () => {
    if (window.electronAPI && window.electronAPI.setActiveSettingsState) {
      await window.electronAPI.setActiveSettingsState({
        canvasWidth: state.canvasWidth,
        canvasHeight: state.canvasHeight,
        fps: state.exportSettings?.fps || 60,
        brollLayout: state.brollLayout || 'none',
        brollX: state.brollX !== undefined ? state.brollX : 50,
        brollY: state.brollY !== undefined ? state.brollY : 20,
        brollWidth: state.brollWidth !== undefined ? state.brollWidth : 80,
        brollHeight: state.brollHeight !== undefined ? state.brollHeight : 25,
        brollAspectRatio: state.brollAspectRatio || 'custom',
      });
      window.electronAPI.openSettingsWindow();
    } else {
      alert("Settings window is only available in the desktop application.");
    }
  };

  const renderHistoryDropdown = () => {
    const { past = [], future = [] } = state.history || {};
    const currentLabel = state.lastActionLabel || 'Open Project';

    const items = [
      ...past.map((p, idx) => ({ label: p.lastActionLabel || 'Action', active: false, index: idx })),
      { label: currentLabel, active: true, index: past.length },
      ...future.map((f, idx) => ({ label: f.lastActionLabel || 'Action', active: false, index: past.length + 1 + idx, isFuture: true }))
    ];

    return (
      <div style={{
        position: 'absolute',
        top: 'calc(100% + 4px)',
        left: 0,
        background: 'var(--surface-1, #0f0f15)',
        border: '1px solid var(--border-default, rgba(255,255,255,0.08))',
        borderRadius: '6px',
        padding: '6px 0',
        minWidth: '200px',
        maxWidth: '300px',
        maxHeight: '300px',
        overflowY: 'auto',
        zIndex: 1000,
        boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
      }}>
        <div style={{ padding: '4px 12px 6px', fontSize: '11px', fontWeight: 'bold', color: 'var(--text-disabled)', borderBottom: '1px solid var(--border-subtle)', marginBottom: '4px' }}>
          Modification History
        </div>
        {items.map((item) => (
          <div
            key={item.index}
            style={{
              padding: '6px 12px',
              fontSize: '12px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: item.active ? 'var(--accent-primary-glow, rgba(124, 77, 255, 0.2))' : 'transparent',
              color: item.active ? 'var(--accent-primary, #00e5ff)' : (item.isFuture ? 'var(--text-disabled, rgba(255,255,255,0.35))' : 'var(--text-primary, #fff)'),
              borderLeft: item.active ? '3px solid var(--accent-primary, #00e5ff)' : '3px solid transparent',
              transition: 'background 0.15s',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover, rgba(255,255,255,0.05))'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = item.active ? 'var(--accent-primary-glow, rgba(124, 77, 255, 0.2))' : 'transparent'; }}
            onClick={() => {
              actions.jumpToHistoryState(item.index);
              actions.addToast(`Reverted to: ${item.label}`, 'info');
              setShowHistory(false);
            }}
          >
            <span style={{ opacity: item.isFuture ? 0.5 : 1 }}>{item.label}</span>
            {item.active && (
              <span style={{ fontSize: '10px', color: 'var(--accent-primary)', fontWeight: 'bold' }}>Active</span>
            )}
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="toolbar">
      <div className="toolbar__group">
        <button
          className="toolbar__btn"
          onClick={() => {
            actions.resetProject();
            actions.addToast('Started a new project — choose a preset', 'info');
          }}
          title="New Project (choose a new preset)"
        >
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 4 }}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>
          New
        </button>
        <button
          className="toolbar__btn"
          onClick={handleSettingsOpen}
          title="Project Settings"
        >
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 4 }}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
          Settings
        </button>
      </div>

      <div className="toolbar__group">
        {tools.map(tool => (
          <button
            key={tool.id}
            className={`toolbar__btn ${activeTool === tool.id ? 'toolbar__btn--active' : ''}`}
            onClick={() => actions.setActiveTool(tool.id)}
            title={`${tool.label} (${tool.shortcut})`}
          >
            <span>{renderToolIcon(tool.id)}</span>
            <span>{tool.label}</span>
          </button>
        ))}
      </div>

      <div className="toolbar__group">
        <button className="toolbar__btn" onClick={handleImport} title="Import Media">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 4 }}><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
          Import
        </button>
        <button className="toolbar__btn" onClick={handleVoiceCloneOpen} title="AI Voice Clone & TTS">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 4 }}><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/></svg>
          Voice Clone
        </button>
        <button
          className="toolbar__btn"
          onClick={() => {
            if (window.electronAPI && window.electronAPI.openGraphicsCreatorWindow) {
              window.electronAPI.openGraphicsCreatorWindow();
            } else {
              window.open('#/graphics-creator', '_blank', 'width=1280,height=850');
            }
          }}
          title="Vector Graphics Studio (Illustrator & SVG Console)"
        >
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 4 }}><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
          Vector Studio
        </button>
      </div>

      <div className="toolbar__spacer" />

      <div className="toolbar__group" style={{ position: 'relative' }} ref={historyRef}>
        <button
          className={`toolbar__btn ${showHistory ? 'toolbar__btn--active' : ''}`}
          onClick={() => setShowHistory(!showHistory)}
          title="Action History (Photoshop Style)"
        >
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 4 }}><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><polyline points="3 3 3 8 8 8"/><line x1="12" y1="7" x2="12" y2="12"/><line x1="12" y1="12" x2="16" y2="14"/></svg>
          History
        </button>
        {showHistory && renderHistoryDropdown()}
      </div>

      <div className="toolbar__group">
        <button
          className={`toolbar__btn ${isConsoleOpen ? 'toolbar__btn--active' : ''}`}
          onClick={onToggleConsole}
          title="Toggle VBS Console (Ctrl+`)"
        >
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 4 }}>
            <polyline points="4 17 10 11 4 5" />
            <line x1="12" y1="19" x2="20" y2="19" />
          </svg>
          Console
        </button>
      </div>

      <div className="toolbar__group">
        <button
          className="toolbar__btn"
          onClick={handleThemeToggle}
          title="Switch Theme (Default / Blue / Red)"
        >
          <span>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 4 }}><path d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 14.7255 3.09032 17.1962 4.85857 19C4.85857 19 4.47715 16 7 16C9.52285 16 10 18.5 10 20C10 21 11.5 22 12 22Z"/><circle cx="7.5" cy="10.5" r="1.5" fill="currentColor"/><circle cx="11.5" cy="7.5" r="1.5" fill="currentColor"/><circle cx="16.5" cy="9.5" r="1.5" fill="currentColor"/><circle cx="15.5" cy="14.5" r="1.5" fill="currentColor"/></svg>
          </span>
          <span style={{ textTransform: 'capitalize' }}>Theme: {theme}</span>
        </button>
      </div>

      <div className="toolbar__group">
        <button
          className="toolbar__btn toolbar__btn--accent"
          onClick={() => actions.setShowExportModal(true)}
          title="Export Video"
        >
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 4 }}><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="7" x2="7" y2="7"/><line x1="2" y1="17" x2="7" y2="17"/><line x1="17" y1="17" x2="22" y2="17"/><line x1="17" y1="7" x2="22" y2="7"/></svg>
          Export
        </button>
      </div>
    </div>
  );
}

