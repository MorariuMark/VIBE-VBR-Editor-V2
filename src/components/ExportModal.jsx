import React, { useState, useRef, useEffect } from 'react';
import { useProject } from '../store/ProjectContext';
import { EXPORT_PRESETS, generateFFmpegCommand } from '../engine/exportEngine';
import { drawFrame } from '../engine/renderEngine';

/**
 * Export Modal — configure and trigger video export via FFmpeg
 */
export default function ExportModal() {
  const { state, actions } = useProject();
  const [selectedPreset, setSelectedPreset] = useState('tiktok-vertical');
  const [renderMethod, setRenderMethod] = useState('canvas');
  const cancelExportRef = useRef(false);
  const presetTouchedRef = useRef(false);

  // Default the preset from the project aspect when the modal opens, unless
  // the user already picked one.
  useEffect(() => {
    if (state.showExportModal && !presetTouchedRef.current) {
      const w = state.exportSettings.width || 1920;
      const h = state.exportSettings.height || 1080;
      setSelectedPreset(h >= w ? 'tiktok-vertical' : 'youtube-landscape');
    }
  }, [state.showExportModal, state.exportSettings.width, state.exportSettings.height]);

  const [supportedCodecs, setSupportedCodecs] = useState({
    h264_nvenc: false,
    h264_amf: false,
    h264_qsv: false,
  });

  // Query FFmpeg capabilities to auto-detect supported GPU codecs
  useEffect(() => {
    if (state.showExportModal && window.electronAPI && window.electronAPI.detectGpuCodecs) {
      window.electronAPI.detectGpuCodecs().then((codecs) => {
        setSupportedCodecs(codecs || { h264_nvenc: false, h264_amf: false, h264_qsv: false });
        
        // Auto fallback if currently selected codec is not supported by the system
        const currentCodec = state.exportSettings.codec || 'libx264';
        if (currentCodec !== 'libx264' && codecs && !codecs[currentCodec]) {
          actions.setExportSettings({ codec: 'libx264' });
          actions.addToast(`GPU codec "${currentCodec}" is unsupported on this system. Falling back to CPU standard encoding.`, 'warning');
        }
      });
    }
  }, [state.showExportModal, state.exportSettings.codec]);

  const handleCancelExport = async () => {
    cancelExportRef.current = true;
    if (window.electronAPI && window.electronAPI.killExport) {
      await window.electronAPI.killExport();
    }
    actions.setExporting(false);
    actions.addToast('Export cancelled', 'warning');
  };

  if (!state.showExportModal) return null;

  const handlePresetChange = (presetId) => {
    presetTouchedRef.current = true;
    setSelectedPreset(presetId);
    const preset = EXPORT_PRESETS[presetId];
    if (preset) {
      actions.setExportSettings({
        width: preset.width,
        height: preset.height,
        fps: preset.fps,
        codec: preset.codec,
        crf: preset.crf,
      });
    }
  };

  const handleExport = async () => {
    if (!state.backgroundVideo && state.dialogueBlocks.length === 0) {
      actions.addToast('Nothing to export! Add a background video or parse a script.', 'error');
      return;
    }

    cancelExportRef.current = false;
    actions.setExporting(true);
    actions.setExportProgress(0);

    let tempAudioOutput = '';
    try {
      let outputPath;
      
      if (window.electronAPI) {
        outputPath = await window.electronAPI.saveFileDialog({
          defaultPath: `brainrot_${Date.now()}.mp4`,
        });
        
        if (!outputPath) {
          actions.setExporting(false);
          return;
        }

        // Gather and mix all timeline audio clips
        const audioClips = [];
        state.tracks.forEach(track => {
          if (track.type === 'audio') {
            track.clips.forEach(clip => {
              if (clip.path) {
                audioClips.push({
                  path: clip.path,
                  startTime: clip.startTime,
                  duration: clip.duration
                });
              }
            });
          }
        });

        let finalAudioPath = '';
        if (audioClips.length > 0) {
          if (window.electronAPI.mixAudioClips) {
            const projectPath = await window.electronAPI.getProjectPath();
            tempAudioOutput = `${projectPath.replace(/\\/g, '/')}/dist/temp_mix_${Date.now()}.wav`;
            actions.addToast('Mixing audio tracks...', 'info');
            const mixRes = await window.electronAPI.mixAudioClips({
              clips: audioClips,
              outputPath: tempAudioOutput
            });
            if (mixRes.success) {
              finalAudioPath = tempAudioOutput;
            } else {
              console.error("FFmpeg mixing failed, using first audio clip:", mixRes.error);
              finalAudioPath = audioClips[0].path;
            }
          } else {
            finalAudioPath = audioClips[0].path;
          }
        }

        if (renderMethod === 'native') {
          // Listen to native export progress (dedupe: clear any prior listener)
          if (window.electronAPI.removeExportProgress) {
            window.electronAPI.removeExportProgress();
          }
          window.electronAPI.onExportProgress((progressData) => {
            if (progressData && typeof progressData.percent === 'number') {
              actions.setExportProgress(progressData.percent);
            }
          });

          // Build character assets map
          const characterAssetsMap = {};
          state.characters.forEach((char) => {
            if (char.asset && char.asset.path) {
              characterAssetsMap[char.id] = char.asset.path;
            }
          });

          const ffmpegConfig = {
            backgroundVideo: state.backgroundVideo?.path || '',
            blocks: state.dialogueBlocks,
            characterAssets: characterAssetsMap,
            characterTransforms: state.characterTransforms,
            audioPath: finalAudioPath,
            outputPath,
            settings: state.exportSettings,
          };

          const ffmpegCmd = generateFFmpegCommand(ffmpegConfig);
          console.log('[ExportModal] Native FFmpeg arguments:', ffmpegCmd.args);

          const result = await window.electronAPI.exportVideo({
            args: ffmpegCmd.args,
            outputPath,
            totalDuration: state.totalDuration,
          });

          if (result.success) {
            actions.addToast('Export complete!', 'success');
          } else {
            actions.addToast(`Export failed: ${result.error?.substring(0, 120)}`, 'error');
          }
          actions.setExporting(false);
          return;
        }

        // Preload character images
        const loadedImages = {};
        for (const char of state.characters) {
          if (char.asset && char.asset.dataUrl) {
            await new Promise((resolve) => {
              const img = new Image();
              img.src = char.asset.dataUrl;
              img.onload = () => {
                loadedImages[char.id] = img;
                resolve();
              };
              img.onerror = () => resolve();
            });
          }
        }

        // Preload timeline image clips (video, broll, & window tracks)
        for (const track of state.tracks) {
          if (track.type === 'video' || track.type === 'broll' || track.type === 'window') {
            for (const clip of track.clips) {
              if (clip.type === 'image' && clip.dataUrl) {
                await new Promise((resolve) => {
                  const img = new Image();
                  img.src = clip.dataUrl;
                  img.onload = () => {
                    loadedImages[clip.id] = img;
                    resolve();
                  };
                  img.onerror = () => resolve();
                });
              }
            }
          }
        }

        // Preload per-clip video elements for video/broll/window tracks so
        // drawFrame can render them during export (mirrors the preview)
        const videoElements = {};
        const videoClipsWithEls = [];
        for (const track of state.tracks) {
          if (track.type !== 'video' && track.type !== 'broll' && track.type !== 'window') continue;
          for (const clip of track.clips) {
            if (clip.type !== 'video' || videoElements[clip.id]) continue;
            const el = document.createElement('video');
            el.muted = true;
            el.playsInline = true;
            el.src = clip.dataUrl || `file:///${clip.path.replace(/\\/g, '/')}`;
            videoElements[clip.id] = el;
            videoClipsWithEls.push({ clip, el });
          }
        }
        await Promise.all(videoClipsWithEls.map(({ el }) => new Promise((resolve) => {
          el.onloadedmetadata = () => resolve();
          el.onerror = () => resolve();
          el.load();
        })));

        // Setup temporary video element for background (only for slow CPU Canvas render)
        let tempVideo = null;
        if (renderMethod === 'canvas-cpu' && state.backgroundVideo) {
          tempVideo = document.createElement('video');
          tempVideo.muted = true;
          const videoUrl = window.electronAPI && state.backgroundVideo.path
            ? `file:///${state.backgroundVideo.path.replace(/\\/g, '/')}`
            : state.backgroundVideo.dataUrl;
          tempVideo.src = videoUrl;
          await new Promise((resolve) => {
            tempVideo.onloadedmetadata = () => resolve();
            tempVideo.onerror = () => resolve();
            tempVideo.load();
          });
          videoElements.clip_bg = tempVideo;
        }

        // Setup hidden export canvas
        const exportCanvas = document.createElement('canvas');
        exportCanvas.width = state.exportSettings.width;
        exportCanvas.height = state.exportSettings.height;
        const exportCtx = exportCanvas.getContext('2d');

        const fps = state.exportSettings.fps;
        const totalFrames = Math.ceil(state.totalDuration * fps);

        // Helper to seek video frame-by-frame (only for slow CPU Canvas render)
        const seekVideo = (video, time) => {
          return new Promise((resolve) => {
            let resolved = false;
            const done = () => {
              if (resolved) return;
              resolved = true;
              video.removeEventListener('seeked', onSeeked);
              clearTimeout(timeout);
              resolve();
            };
            const onSeeked = () => done();
            video.addEventListener('seeked', onSeeked);
            const timeout = setTimeout(done, 800); // 800ms fallback timeout
            video.currentTime = time;
          });
        };

        // Start the frame-by-frame export process in main process
        const exportPromise = window.electronAPI.startFrameExport({
          settings: state.exportSettings,
          audioPath: finalAudioPath,
          backgroundVideoPath: renderMethod === 'canvas' ? (state.backgroundVideo?.path || '') : '',
          totalDuration: state.totalDuration,
          outputPath,
        });

        // Loop and stream frames using an async pipelined approach to maximize concurrency
        let aborted = false;
        const activePromises = [];
        const maxInFlight = 8; // Process up to 8 frames concurrently

        for (let i = 0; i < totalFrames; i++) {
          if (cancelExportRef.current) {
            aborted = true;
            break;
          }
          const time = i / fps;
          
          if (tempVideo && renderMethod === 'canvas-cpu') {
            const vDur = tempVideo.duration || state.totalDuration || 1;
            await seekVideo(tempVideo, time % vDur);
          }

          // Seek any overlay/background video clips active at this time
          for (const { clip, el } of videoClipsWithEls) {
            if (time >= clip.startTime && time < clip.startTime + clip.duration) {
              const vDur = el.duration || clip.duration || 1;
              await seekVideo(el, (time - clip.startTime) % vDur);
            }
          }

          // Draw pixel-perfect frame
          drawFrame(exportCtx, {
            state,
            time,
            width: exportCanvas.width,
            height: exportCanvas.height,
            loadedImages,
            videoElement: videoElements,
            drawHandles: false,
            transparentBackground: renderMethod === 'canvas',
          });

          // Extract frame buffer
          const imgData = exportCtx.getImageData(0, 0, exportCanvas.width, exportCanvas.height).data;
          
          // Stream frame to FFmpeg in background
          const sendPromise = window.electronAPI.sendFrame(imgData);
          activePromises.push(sendPromise);

          // Maintain the pipelining window size
          if (activePromises.length >= maxInFlight) {
            const success = await activePromises.shift();
            if (!success) {
              console.error("FFmpeg frame streaming failed!");
              throw new Error("FFmpeg frame write failed. The export process may have closed unexpectedly.");
            }
          }

          // Update progress (throttled: the slider only needs ~10 updates/sec)
          if (i % 6 === 0 || i === totalFrames - 1) {
            actions.setExportProgress((i / totalFrames) * 95); // 95% is frame processing
          }
        }

        // Wait for all remaining background frame writes to complete
        if (!aborted) {
          const results = await Promise.all(activePromises);
          if (results.some(r => !r)) {
            throw new Error("FFmpeg final frame write failed.");
          }
        }

        if (aborted) {
          actions.setExporting(false);
          return;
        }

        // Finalize export
        await window.electronAPI.endFrameExport();
        actions.setExportProgress(98);

        const result = await exportPromise;
        actions.setExportProgress(100);

        if (result.success) {
          actions.addToast('Export complete!', 'success');
        } else {
          actions.addToast(`Export failed: ${result.error?.substring(0, 100)}`, 'error');
        }
      } else {
        // Browser fallback
        actions.addToast('Export requires the Electron desktop app with local FFmpeg.', 'info');
        for (let i = 0; i <= 100; i += 5) {
          await new Promise(r => setTimeout(r, 100));
          actions.setExportProgress(i);
        }
        actions.addToast('Export simulation complete! (Use desktop app for real export)', 'success');
      }
    } catch (err) {
      actions.addToast(`Export error: ${err.message}`, 'error');
    } finally {
      actions.setExporting(false);
      if (window.electronAPI && window.electronAPI.removeExportProgress) {
        window.electronAPI.removeExportProgress();
      }
      if (tempAudioOutput && window.electronAPI && window.electronAPI.deleteFile) {
        await window.electronAPI.deleteFile(tempAudioOutput);
      }
    }
  };

  return (
    <div className="modal-overlay" onClick={() => !state.isExporting && actions.setShowExportModal(false)}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <h2 className="modal__title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="7" x2="7" y2="7"/><line x1="2" y1="17" x2="7" y2="17"/><line x1="17" y1="17" x2="22" y2="17"/><line x1="17" y1="7" x2="22" y2="7"/></svg>
            Export Video
          </h2>
          {!state.isExporting && (
            <button className="modal__close" onClick={() => actions.setShowExportModal(false)}>
              ✕
            </button>
          )}
        </div>

        <div className="modal__body">
          {/* Preset selector */}
          <div className="form-group">
            <label className="form-label">Format Preset</label>
            <select
              className="form-select"
              value={selectedPreset}
              onChange={(e) => handlePresetChange(e.target.value)}
              disabled={state.isExporting}
            >
              {Object.entries(EXPORT_PRESETS).map(([id, preset]) => (
                <option key={id} value={id}>{preset.name}</option>
              ))}
            </select>
          </div>

          {/* Resolution */}
          <div style={{ display: 'flex', gap: 12 }}>
            <div className="form-group" style={{ flex: 1 }}>
              <label className="form-label">Width</label>
              <input
                type="number"
                className="form-input"
                value={state.exportSettings.width}
                onChange={(e) => actions.setExportSettings({ width: parseInt(e.target.value) })}
                disabled={state.isExporting}
              />
            </div>
            <div className="form-group" style={{ flex: 1 }}>
              <label className="form-label">Height</label>
              <input
                type="number"
                className="form-input"
                value={state.exportSettings.height}
                onChange={(e) => actions.setExportSettings({ height: parseInt(e.target.value) })}
                disabled={state.isExporting}
              />
            </div>
          </div>

          {/* FPS & Quality */}
          <div style={{ display: 'flex', gap: 12 }}>
            <div className="form-group" style={{ flex: 1 }}>
              <label className="form-label">FPS</label>
              <select
                className="form-select"
                value={state.exportSettings.fps}
                onChange={(e) => actions.setExportSettings({ fps: parseInt(e.target.value) })}
                disabled={state.isExporting}
              >
                <option value={24}>24 fps</option>
                <option value={30}>30 fps</option>
                <option value={60}>60 fps</option>
              </select>
            </div>
            <div className="form-group" style={{ flex: 1 }}>
              <label className="form-label">Quality (CRF)</label>
              <input
                type="range"
                min="0"
                max="51"
                value={state.exportSettings.crf}
                onChange={(e) => actions.setExportSettings({ crf: parseInt(e.target.value) })}
                disabled={state.isExporting}
                style={{ width: '100%', marginTop: 8 }}
              />
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                {state.exportSettings.crf} ({state.exportSettings.crf < 18 ? 'High' : state.exportSettings.crf < 28 ? 'Medium' : 'Low'} quality)
              </span>
            </div>
          </div>

          {/* Video Encoder / GPU Accel */}
          <div className="form-group">
            <label className="form-label">Video Encoder (GPU Accel)</label>
            <select
              className="form-select"
              value={state.exportSettings.codec || 'libx264'}
              onChange={(e) => actions.setExportSettings({ codec: e.target.value })}
              disabled={state.isExporting}
            >
              <option value="libx264">CPU (Standard - libx264)</option>
              <option value="h264_nvenc" disabled={!supportedCodecs.h264_nvenc}>
                NVIDIA NVENC (GPU - h264_nvenc){!supportedCodecs.h264_nvenc ? ' - Unsupported' : ''}
              </option>
              <option value="h264_amf" disabled={!supportedCodecs.h264_amf}>
                AMD AMF (GPU - h264_amf){!supportedCodecs.h264_amf ? ' - Unsupported' : ''}
              </option>
              <option value="h264_qsv" disabled={!supportedCodecs.h264_qsv}>
                Intel QSV (GPU - h264_qsv){!supportedCodecs.h264_qsv ? ' - Unsupported' : ''}
              </option>
            </select>
          </div>

          {/* Render Method */}
          <div className="form-group">
            <label className="form-label">Render Method</label>
            <select
              className="form-select"
              value={renderMethod}
              onChange={(e) => setRenderMethod(e.target.value)}
              disabled={state.isExporting}
            >
              <option value="canvas">GPU Accelerated Canvas (Fast - Preserves all animations & effects)</option>
              <option value="canvas-cpu">CPU Standard Canvas (Slow, Legacy frame seeker)</option>
              <option value="native">Native FFmpeg (Ultra Fast - No Canvas, static overlays)</option>
            </select>
          </div>

          {/* Helpful Render Tips */}
          <div style={{
            marginTop: 12, padding: 12, background: 'var(--surface-2, rgba(255,255,255,0.03))',
            borderRadius: 'var(--radius-md, 6px)', fontSize: 'var(--text-xs, 12px)',
            color: 'var(--text-secondary, #b3b3b3)', borderLeft: '3px solid var(--accent-primary, #00e5ff)',
            lineHeight: '1.4'
          }}>
            {renderMethod === 'canvas' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0 }}><path d="M19 11v6a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-6m3 0V9a4 4 0 0 1 8 0v2M12 2v2M12 20v2M4 12H2M22 12h-2"/></svg>
                <span><strong>GPU Canvas:</strong> Renders transparent frames and overlays them in FFmpeg. Fast GPU execution that **preserves all character animations and text glows**!</span>
              </div>
            )}
            {renderMethod === 'canvas-cpu' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0 }}><path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 1 1 7.072 0l-.548.73A1 1 0 0 0 14 18h-4a1 1 0 0 0-.74-.37l-.597-.73z"/></svg>
                <span><strong>CPU Canvas:</strong> Seeks background video frame-by-frame. Export at <strong>30 FPS</strong> instead of 60 FPS to cut render time and memory usage in half!</span>
              </div>
            )}
            {renderMethod === 'native' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0 }}><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
                <span><strong>Native Mode:</strong> Pure FFmpeg execution. High rendering speed, but skips canvas-specific entry/exit transitions and rich text effects.</span>
              </div>
            )}
          </div>

          {/* Progress */}
          {state.isExporting && (
            <div style={{ marginTop: 16 }}>
              <div style={{
                display: 'flex', justifyContent: 'space-between',
                marginBottom: 8, fontSize: 'var(--text-sm)', color: 'var(--text-secondary)',
              }}>
                <span>Exporting...</span>
                <span>{Math.round(state.exportProgress)}%</span>
              </div>
              <div className="progress-bar">
                <div
                  className="progress-bar__fill"
                  style={{ width: `${state.exportProgress}%` }}
                />
              </div>
            </div>
          )}

          {/* Info */}
          <div style={{
            marginTop: 16, padding: 12, background: 'var(--surface-2)',
            borderRadius: 'var(--radius-md)', fontSize: 'var(--text-xs)',
            color: 'var(--text-tertiary)', lineHeight: 1.5,
          }}>
            <strong style={{ color: 'var(--text-secondary)' }}>Export Info:</strong><br />
            Duration: {state.totalDuration.toFixed(1)}s &middot; 
            Blocks: {state.dialogueBlocks.length} &middot; 
            Characters: {state.characters.length}
            {!state.backgroundVideo && (
              <div style={{ color: 'var(--accent-warning)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ flexShrink: 0 }}><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                <span>No background video set</span>
              </div>
            )}
          </div>
        </div>

        <div className="modal__footer">
          {state.isExporting ? (
            <button
              className="btn btn--danger"
              onClick={handleCancelExport}
              style={{ width: '100%' }}
            >
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ marginRight: 4, display: 'inline-block', verticalAlign: 'middle' }}><circle cx="12" cy="12" r="10"/><rect x="9" y="9" width="6" height="6"/></svg>
              Cancel Render
            </button>
          ) : (
            <>
              <button
                className="btn btn--secondary"
                onClick={() => actions.setShowExportModal(false)}
              >
                Cancel
              </button>
              <button
                className="btn btn--primary"
                onClick={handleExport}
              >
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 4, display: 'inline-block', verticalAlign: 'middle' }}><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                Export
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
