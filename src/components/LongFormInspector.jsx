import React, { useState, useEffect } from 'react';
import { useProject } from '../store/ProjectContext';
import { formatTime } from '../utils/fileHelpers';

/**
 * Long-Form Builder (right panel for 'longform' / custom projects).
 * Paste a script, import images into the media library, then build the
 * whole timeline: every image becomes one dialogue block covering exactly
 * the script words its filename spans (naming convention).
 */
export default function LongFormInspector({ onMinimize }) {
  const { state, actions } = useProject();
  const [scriptDraft, setScriptDraft] = useState(state.scriptText || '');

  useEffect(() => {
    setScriptDraft(state.scriptText || '');
  }, [state.scriptText]);

  const images = (state.mediaItems || []).filter(m => m.type === 'image');
  const blocks = state.dialogueBlocks || [];
  const matchedCount = blocks.filter(b => b.scriptMatched).length;
  const unmatchedImages = images.filter(img => !blocks.some(b => b.imageId === img.id));

  const build = () => {
    if (!scriptDraft.trim()) {
      actions.addToast('Paste a script first.', 'warning');
      return;
    }
    if (images.length === 0) {
      actions.addToast('Import an image folder into the Media Library first.', 'warning');
      return;
    }
    actions.buildLongFormTimeline(scriptDraft);
    actions.addToast(`Built timeline from ${images.length} images`, 'success');
  };

  return (
    <div className="script-panel panel">
      <div className="panel__header" style={{ padding: 0 }}>
        <div style={{ display: 'flex', width: '100%', height: '100%', alignItems: 'center' }}>
          <div
            className="editor-tab editor-tab--active"
            style={{ cursor: 'default', flex: 1, justifyContent: 'flex-start', paddingLeft: 14 }}
          >
            Long-Form Builder
          </div>
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
              title="Minimize Panel"
              onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent-primary)'; e.currentTarget.style.background = 'rgba(255,255,255,0.02)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-tertiary)'; e.currentTarget.style.background = 'none'; }}
            >
              ▶
            </button>
          )}
        </div>
      </div>

      <div className="script-panel__content" style={{ padding: 12, overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* Script */}
        <div>
          <div className="inspector-section-title">1. Script</div>
          <textarea
            value={scriptDraft}
            onChange={(e) => setScriptDraft(e.target.value)}
            placeholder={'Paste your script here.\n\n**Stewie:** So, Brian, I heard you got a new job.\n**Brian:** That\u2019s right, Stewie...'}
            style={{
              width: '100%',
              minHeight: 160,
              resize: 'vertical',
              background: 'var(--surface-2)',
              border: '1px solid var(--border-default)',
              borderRadius: 8,
              color: 'var(--text-primary)',
              fontSize: '12px',
              lineHeight: 1.5,
              padding: 10,
              fontFamily: 'inherit',
            }}
          />
          <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: 4, lineHeight: 1.4 }}>
            Add <b>**Name:</b> headers to split speakers (optional — plain narration works too). Image files must follow the naming convention:{' '}
            <b>scene start ___ scene end.png</b>
          </div>
        </div>

        {/* Images */}
        <div>
          <div className="inspector-section-title">2. Images (Media Library)</div>
          <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginBottom: 6 }}>
            Import a whole folder with the <b>Import Folder</b> button in the Media Library, then build below.
          </div>
          {images.length === 0 ? (
            <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', padding: '10px 0' }}>
              No images imported yet.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 220, overflowY: 'auto' }}>
              {images.map(img => {
                const block = blocks.find(b => b.imageId === img.id);
                return (
                  <div
                    key={img.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '4px 6px',
                      borderRadius: 6,
                      background: 'var(--surface-2)',
                      border: '1px solid var(--border-subtle)',
                    }}
                  >
                    {img.dataUrl ? (
                      <img
                        src={img.dataUrl}
                        alt=""
                        style={{ width: 30, height: 30, objectFit: 'cover', borderRadius: 4, flexShrink: 0 }}
                      />
                    ) : (
                      <div style={{ width: 30, height: 30, borderRadius: 4, background: 'var(--surface-1)', flexShrink: 0 }} />
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '11px', color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{img.name}</div>
                      <div style={{ fontSize: '10px', color: block ? 'var(--text-tertiary)' : 'var(--warning, #ffb74d)' }}>
                        {block
                          ? `${formatTime(block.startTime)} – ${formatTime(block.startTime + block.duration)}${block.scriptMatched ? '' : ' · unmatched phrase'}`
                          : 'not on timeline'}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Build */}
        <button
          className="btn btn--primary"
          style={{ width: '100%', padding: '8px 10px', fontSize: '12px' }}
          onClick={build}
          disabled={images.length === 0 || !scriptDraft.trim()}
        >
          Build Timeline
        </button>

        {/* Summary */}
        {blocks.length > 0 && (
          <div>
            <div className="inspector-section-title">3. Result</div>
            <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: 6 }}>
              {blocks.length} blocks · {matchedCount} matched{unmatchedImages.length ? ` · ${unmatchedImages.length} unmatched image${unmatchedImages.length > 1 ? 's' : ''}` : ''} · total {formatTime(state.totalDuration)}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 260, overflowY: 'auto' }}>
              {blocks.map(block => {
                const char = (state.characters || []).find(c => c.id === block.characterId);
                return (
                  <div
                    key={block.id}
                    style={{
                      padding: '5px 8px',
                      borderRadius: 6,
                      background: 'var(--surface-2)',
                      border: `1px solid ${block.scriptMatched ? 'var(--border-subtle)' : 'var(--warning, #ffb74d)'}`,
                    }}
                  >
                    <div style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>
                      {formatTime(block.startTime)} – {formatTime(block.startTime + block.duration)} · {char ? char.name : '—'}
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {block.text ? `"${block.text}"` : block.imageName}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
