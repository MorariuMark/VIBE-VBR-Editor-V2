import React, { useState } from 'react';
import { useProject } from '../store/ProjectContext';

const ASPECTS = [
  { id: '16:9', label: '16:9 (Landscape)', width: 1920, height: 1080 },
  { id: '9:16', label: '9:16 (Portrait)', width: 1080, height: 1920 },
  { id: '1:1', label: '1:1 (Square)', width: 1080, height: 1080 },
  { id: '4:3', label: '4:3 (Classic)', width: 1440, height: 1080 },
  { id: '21:9', label: '21:9 (Cinematic)', width: 2560, height: 1080 },
];

/**
 * Startup preset selection. Shown before the editor is usable.
 * - Short Form: vertical videos, current Family Guy workflow.
 * - Long Form: landscape automation (script + image folder → full timeline).
 * - Custom: aspect ratio, resolution and fps.
 */
export default function StartupModal() {
  const { actions, state } = useProject();
  const [selected, setSelected] = useState('shortform');
  const [customAspect, setCustomAspect] = useState('16:9');
  const [customWidth, setCustomWidth] = useState(1920);
  const [customFps, setCustomFps] = useState(60);

  const aspectMeta = ASPECTS.find(a => a.id === customAspect) || ASPECTS[0];

  const startProject = () => {
    if (selected === 'custom') {
      const height = Math.round((customWidth * aspectMeta.height) / aspectMeta.width / 2) * 2;
      actions.setProjectMode('longform', {
        width: customWidth,
        height,
        fps: customFps,
      });
    } else if (selected === 'longform') {
      actions.setProjectMode('longform', { width: 1920, height: 1080, fps: 60 });
    } else {
      actions.setProjectMode('shortform', { width: 1080, height: 1920, fps: 60 });
    }
  };

  const cardStyle = (id) => ({
    flex: 1,
    minWidth: 0,
    padding: '18px 16px',
    borderRadius: 10,
    border: `1px solid ${selected === id ? 'var(--accent-primary)' : 'var(--border-default)'}`,
    background: selected === id ? 'rgba(255, 214, 30, 0.06)' : 'var(--surface-2)',
    cursor: 'pointer',
    textAlign: 'left',
    transition: 'all 0.15s',
    color: 'var(--text-primary)',
  });

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        background: 'rgba(8, 10, 16, 0.96)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          width: 'min(860px, 92vw)',
          maxHeight: '92vh',
          overflowY: 'auto',
          background: 'var(--surface-1)',
          border: '1px solid var(--border-default)',
          borderRadius: 14,
          padding: '28px 30px',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text-primary)' }}>Start a New Project</div>
          <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>Project: {state.projectName}</div>
        </div>
        <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: 18 }}>
          Choose how you want to build this video.
        </div>

        <div style={{ display: 'flex', gap: 12, marginBottom: 8 }}>
          <button style={cardStyle('shortform')} onClick={() => setSelected('shortform')}>
            <div style={{ fontSize: '14px', fontWeight: 700, marginBottom: 6, color: 'var(--accent-primary)' }}>Short Form</div>
            <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginBottom: 4 }}>9:16 · 1080×1920 · 60fps</div>
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              Vertical clips with the current editor workflow — script blocks, Family Guy presets, voices and animations.
            </div>
          </button>

          <button style={cardStyle('longform')} onClick={() => setSelected('longform')}>
            <div style={{ fontSize: '14px', fontWeight: 700, marginBottom: 6, color: 'var(--accent-primary)' }}>Long Form</div>
            <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginBottom: 4 }}>16:9 · 1920×1080 · 60fps</div>
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              Full-length landscape videos. Paste a script, import an image folder, and build the whole timeline automatically from the naming convention.
            </div>
          </button>

          <button style={cardStyle('custom')} onClick={() => setSelected('custom')}>
            <div style={{ fontSize: '14px', fontWeight: 700, marginBottom: 6, color: 'var(--accent-primary)' }}>Custom</div>
            <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginBottom: 4 }}>Any aspect ratio</div>
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              Pick your own aspect ratio, resolution and frame rate. Uses the long-form builder with your settings.
            </div>
          </button>
        </div>

        {selected === 'custom' && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              marginBottom: 8,
              padding: '12px 14px',
              borderRadius: 10,
              border: '1px solid var(--border-default)',
              background: 'var(--surface-2)',
              flexWrap: 'wrap',
            }}
          >
            <label style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: 4 }}>
              Aspect Ratio
              <select
                value={customAspect}
                onChange={(e) => setCustomAspect(e.target.value)}
                style={{ background: 'var(--surface-1)', border: '1px solid var(--border-default)', color: 'var(--text-primary)', borderRadius: 6, padding: '4px 8px', fontSize: '12px' }}
              >
                {ASPECTS.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}
              </select>
            </label>
            <label style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: 4 }}>
              Width (px)
              <input
                type="number"
                min={320}
                max={7680}
                step={2}
                value={customWidth}
                onChange={(e) => setCustomWidth(Math.max(320, parseInt(e.target.value, 10) || 320))}
                style={{ width: 110, background: 'var(--surface-1)', border: '1px solid var(--border-default)', color: 'var(--text-primary)', borderRadius: 6, padding: '4px 8px', fontSize: '12px' }}
              />
            </label>
            <label style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: 4 }}>
              FPS
              <select
                value={customFps}
                onChange={(e) => setCustomFps(parseInt(e.target.value, 10))}
                style={{ background: 'var(--surface-1)', border: '1px solid var(--border-default)', color: 'var(--text-primary)', borderRadius: 6, padding: '4px 8px', fontSize: '12px' }}
              >
                {[24, 30, 60].map(f => <option key={f} value={f}>{f} fps</option>)}
              </select>
            </label>
            <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginLeft: 'auto' }}>
              {customWidth} × {Math.round((customWidth * aspectMeta.height) / aspectMeta.width / 2) * 2} px
            </div>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 18 }}>
          <button className="btn btn--primary" style={{ padding: '8px 22px' }} onClick={startProject}>
            Create Project
          </button>
        </div>
      </div>
    </div>
  );
}
