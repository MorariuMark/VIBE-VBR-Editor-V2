import React, { useRef, useState, useCallback, useEffect, useMemo } from 'react';
import { useProject } from '../store/ProjectContext';
import { formatTime, uid } from '../utils/fileHelpers';
import HoverMenuItem from './HoverMenuItem';

/**
 * Multi-track Timeline Panel
 * Features: tracks, clips, playhead, zoom, drag/resize clips, ruler
 */
export default function Timeline() {
  const { state, actions } = useProject();
  const tracksContainerRef = useRef(null);
  const playheadRef = useRef(null);
  const [draggingClip, setDraggingClip] = useState(null);
  const [resizingClip, setResizingClip] = useState(null);
  const [draggingTrackId, setDraggingTrackId] = useState(null);
  const [dragOverTrackId, setDragOverTrackId] = useState(null);
  const [clipContextMenu, setClipContextMenu] = useState(null); // { x, y, clip, trackId }
  const [trackContextMenu, setTrackContextMenu] = useState(null); // { x, y, track }
  
  // Latest-state refs so the global drag listeners never read stale closures
  const stateRef = useRef(state);
  const dragOverTrackIdRef = useRef(null);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  useEffect(() => {
    dragOverTrackIdRef.current = dragOverTrackId;
  }, [dragOverTrackId]);
  const setDragOver = (id) => {
    dragOverTrackIdRef.current = id;
    setDragOverTrackId(id);
  };
  
  const { tracks, pixelsPerSecond, currentTime, totalDuration, isPlaying } = state;
  
  const trackHeaderWidth = 160;
  const timelineWidth = totalDuration * pixelsPerSecond;

  useEffect(() => {
    const closeMenus = () => {
      setClipContextMenu(null);
      setTrackContextMenu(null);
    };
    window.addEventListener('click', closeMenus);
    return () => window.removeEventListener('click', closeMenus);
  }, []);

  // Smooth direct-DOM playhead animation loop
  useEffect(() => {
    if (!isPlaying) return;
    const playhead = playheadRef.current;
    if (!playhead) return;

    const playStart = performance.now() - currentTime * 1000;
    let animId;

    const update = () => {
      const elapsed = (performance.now() - playStart) / 1000;
      const x = elapsed * pixelsPerSecond + trackHeaderWidth;
      playhead.style.left = `${x}px`;
      animId = requestAnimationFrame(update);
    };

    animId = requestAnimationFrame(update);
    return () => cancelAnimationFrame(animId);
  }, [isPlaying, currentTime, pixelsPerSecond, trackHeaderWidth]);

  const handleDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };

  const handleDropOnTrack = (e, track) => {
    e.preventDefault();
    try {
      const dataStr = e.dataTransfer.getData('application/json');
      if (!dataStr) return;
      const dragData = JSON.parse(dataStr);
      const item = state.mediaItems.find(m => m.id === dragData.id) || dragData;

      // Compute drop X and startTime
      const contentEl = e.currentTarget.querySelector('.timeline-track__content');
      let startTime = 0;
      if (contentEl) {
        const contentRect = contentEl.getBoundingClientRect();
        const dropX = e.clientX - contentRect.left;
        startTime = Math.max(0, dropX / pixelsPerSecond);
      }

      // Check media type mismatches first
      const isVideoOrImage = item.type === 'video' || item.type === 'image';
      if ((track.type === 'video' || track.type === 'broll' || track.type === 'window') && !isVideoOrImage) {
        actions.addToast('Mismatched media type. Drag a video/image file here.', 'warning');
        return;
      }
      if (track.type === 'audio' && item.type !== 'audio') {
        actions.addToast('Mismatched media type. Drag an audio file here.', 'warning');
        return;
      }
      if (track.type === 'character' && item.type !== 'image') {
        actions.addToast('Mismatched media type. Drag an image/PNG file here.', 'warning');
        return;
      }

      if (track.type === 'character') {
        actions.assignCharacterAsset(track.characterId, item);
        actions.addToast(`Assigned "${item.name}" to character ${track.name}`, 'success');
        return;
      }

      // Clamping logic to prevent overlapping with existing clips
      const trackClips = track.clips || [];
      const preceding = trackClips.filter(c => c.startTime <= startTime);
      const succeeding = trackClips.filter(c => c.startTime > startTime);
      
      const prevLimit = preceding.length > 0 
        ? Math.max(...preceding.map(c => c.startTime + c.duration))
        : 0;
      const nextLimit = succeeding.length > 0
        ? Math.min(...succeeding.map(c => c.startTime))
        : state.totalDuration;

      let adjustedStartTime = Math.max(startTime, prevLimit);
      let adjustedDuration = item.duration || 5;

      if (adjustedStartTime + adjustedDuration > nextLimit) {
        adjustedDuration = nextLimit - adjustedStartTime;
      }

      if (adjustedDuration < 0.1) {
        actions.addToast('No empty space available at drop location.', 'warning');
        return;
      }

      const newClip = {
        id: `clip_${Date.now()}_${uid()}`,
        name: item.name,
        startTime: adjustedStartTime,
        duration: adjustedDuration,
        color: track.color || (track.type === 'video' ? '#444466' : track.type === 'audio' ? '#00e5ff' : track.type === 'broll' ? '#ffb74d' : '#ec4899'),
        path: item.path,
        dataUrl: item.dataUrl,
        type: item.type,
        isVector: item.isVector || item.name.endsWith('.svg') || (item.dataUrl && item.dataUrl.includes('image/svg+xml')),
      };

      actions.addClipToTrack(track.id, newClip);
      actions.addToast(`Added "${item.name}" to ${track.name}`, 'success');

    } catch (err) {
      console.error(err);
    }
  };

  // ─── Ruler ticks ───
  const rulerTicks = useMemo(() => {
    const ticks = [];
    let interval = 1;
    if (pixelsPerSecond < 20) interval = 5;
    else if (pixelsPerSecond < 40) interval = 2;
    else if (pixelsPerSecond > 100) interval = 0.5;

    for (let t = 0; t <= totalDuration; t += interval) {
      const x = t * pixelsPerSecond;
      const isMajor = Math.abs(t) % (interval * 2) < 1e-6;
      ticks.push(
        <div
          key={t}
          className="timeline-ruler__tick"
          style={{ left: `${x}px` }}
        >
          <span className="timeline-ruler__tick-label">
            {formatTime(t)}
          </span>
          <div
            className="timeline-ruler__tick-line"
            style={{ height: isMajor ? '8px' : '4px' }}
          />
        </div>
      );
    }
    return ticks;
  }, [pixelsPerSecond, totalDuration]);

  // ─── Playhead position ───
  const playheadX = currentTime * pixelsPerSecond + trackHeaderWidth;

  const [isScrubbing, setIsScrubbing] = useState(false);

  // ─── Click / Drag on ruler to seek playhead ───
  const handleRulerPointerDown = (e) => {
    e.preventDefault();
    setIsScrubbing(true);
    e.currentTarget.setPointerCapture(e.pointerId);
    
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left - trackHeaderWidth;
    const time = Math.max(0, x / pixelsPerSecond);
    actions.setCurrentTime(time);
  };

  const handleRulerPointerMove = (e) => {
    if (!isScrubbing) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left - trackHeaderWidth;
    const time = Math.max(0, x / pixelsPerSecond);
    actions.setCurrentTime(time);
  };

  const handleRulerPointerUp = (e) => {
    if (isScrubbing) {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch (err) {}
      setIsScrubbing(false);
    }
  };

  // ─── Clip dragging ───
  const handleClipMouseDown = (e, clip, trackId) => {
    if (e.target.classList.contains('timeline-clip__handle')) return;
    e.stopPropagation();
    
    const rect = e.currentTarget.parentElement.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickedTime = clickX / pixelsPerSecond;

    if (state.activeTool === 'cut') {
      if (clickedTime > clip.startTime && clickedTime < clip.startTime + clip.duration) {
        actions.splitClip(trackId, clip.id, clickedTime);
        actions.addToast('Clip split successfully', 'success');
      }
      return;
    }

    actions.startDragHistory();
    actions.selectClip(clip.id);
    
    setDraggingClip({
      clipId: clip.id,
      trackId,
      startX: e.clientX,
      origStartTime: clip.startTime,
      containerLeft: rect.left,
    });
  };

  // ─── Clip resizing ───
  const handleResizeMouseDown = (e, clip, trackId, side) => {
    e.stopPropagation();
    actions.startDragHistory();
    
    setResizingClip({
      clipId: clip.id,
      trackId,
      side,
      startX: e.clientX,
      origStartTime: clip.startTime,
      origDuration: clip.duration,
    });
  };

  // ─── Global mouse move/up ───
  useEffect(() => {
    const handleMouseMove = (e) => {
      const s = stateRef.current;
      if (draggingClip) {
        const dx = e.clientX - draggingClip.startX;
        const dt = dx / pixelsPerSecond;
        const newStartTime = Math.max(0, draggingClip.origStartTime + dt);
        
        const clipTrack = s.tracks.find(t => t.id === draggingClip.trackId);
        if (clipTrack && clipTrack.type === 'character') {
          const blockId = draggingClip.clipId.replace('presence_', '');
          const block = s.dialogueBlocks.find(b => b.id === blockId);
          const isLocked = block ? !block.unlocked : true;
          if (isLocked) {
            actions.updateBlockTiming(blockId, newStartTime, undefined);
          } else {
            actions.updateClipTiming(draggingClip.trackId, draggingClip.clipId, newStartTime, undefined);
          }
        } else if (clipTrack && clipTrack.type === 'captions') {
          const blockId = draggingClip.clipId.replace('caption_', '');
          actions.updateBlockTiming(blockId, newStartTime, undefined);
        } else {
          const clip = clipTrack?.clips.find(c => c.id === draggingClip.clipId);
          if (clip && clip.blockId) {
            actions.updateBlockTiming(clip.blockId, newStartTime, undefined);
          } else {
            actions.updateClipTiming(draggingClip.trackId, draggingClip.clipId, newStartTime, undefined);
          }
        }

        if (clipTrack) {
          const hoverEl = document.elementFromPoint(e.clientX, e.clientY);
          const trackRow = hoverEl?.closest('.timeline-track');
          if (trackRow) {
            const targetTrackId = trackRow.getAttribute('data-track-id');
            if (targetTrackId) {
              const targetTrack = s.tracks.find(t => t.id === targetTrackId);
              if (targetTrack && targetTrack.type === clipTrack.type) {
                setDragOver(targetTrackId);
              } else {
                setDragOver(null);
              }
            } else {
              setDragOver(null);
            }
          } else {
            setDragOver(null);
          }
        }
      }
      
      if (resizingClip) {
        const dx = e.clientX - resizingClip.startX;
        const dt = dx / pixelsPerSecond;
        
        const clipTrack = s.tracks.find(t => t.id === resizingClip.trackId);
        if (clipTrack && clipTrack.type === 'character') {
          const blockId = resizingClip.clipId.replace('presence_', '');
          const block = s.dialogueBlocks.find(b => b.id === blockId);
          const isLocked = block ? !block.unlocked : true;
          if (isLocked) {
            if (resizingClip.side === 'right') {
              const newDuration = Math.max(0.2, resizingClip.origDuration + dt);
              actions.updateBlockTiming(blockId, undefined, newDuration);
            } else if (resizingClip.side === 'left') {
              const newStartTime = Math.max(0, resizingClip.origStartTime + dt);
              const newDuration = Math.max(0.2, resizingClip.origDuration - dt);
              actions.updateBlockTiming(blockId, newStartTime, newDuration);
            }
          } else {
            if (resizingClip.side === 'right') {
              const newDuration = Math.max(0.2, resizingClip.origDuration + dt);
              actions.updateClipTiming(resizingClip.trackId, resizingClip.clipId, undefined, newDuration);
            } else if (resizingClip.side === 'left') {
              const newStartTime = Math.max(0, resizingClip.origStartTime + dt);
              const newDuration = Math.max(0.2, resizingClip.origDuration - dt);
              actions.updateClipTiming(resizingClip.trackId, resizingClip.clipId, newStartTime, newDuration);
            }
          }
        } else if (clipTrack && clipTrack.type === 'captions') {
          const blockId = resizingClip.clipId.replace('caption_', '');
          if (resizingClip.side === 'right') {
            const newDuration = Math.max(0.2, resizingClip.origDuration + dt);
            actions.updateBlockTiming(blockId, undefined, newDuration);
          } else if (resizingClip.side === 'left') {
            const newStartTime = Math.max(0, resizingClip.origStartTime + dt);
            const newDuration = Math.max(0.2, resizingClip.origDuration - dt);
            actions.updateBlockTiming(blockId, newStartTime, newDuration);
          }
        } else {
          const clip = clipTrack?.clips.find(c => c.id === resizingClip.clipId);
          if (clip && clip.blockId) {
            if (resizingClip.side === 'right') {
              const newDuration = Math.max(0.2, resizingClip.origDuration + dt);
              actions.updateBlockTiming(clip.blockId, undefined, newDuration);
            } else if (resizingClip.side === 'left') {
              const newStartTime = Math.max(0, resizingClip.origStartTime + dt);
              const newDuration = Math.max(0.2, resizingClip.origDuration - dt);
              actions.updateBlockTiming(clip.blockId, newStartTime, newDuration);
            }
          } else {
            if (resizingClip.side === 'right') {
              const newDuration = Math.max(0.2, resizingClip.origDuration + dt);
              actions.updateClipTiming(resizingClip.trackId, resizingClip.clipId, undefined, newDuration);
            } else if (resizingClip.side === 'left') {
              const newStartTime = Math.max(0, resizingClip.origStartTime + dt);
              const newDuration = Math.max(0.2, resizingClip.origDuration - dt);
              actions.updateClipTiming(resizingClip.trackId, resizingClip.clipId, newStartTime, newDuration);
            }
          }
        }
      }
    };

    const handleMouseUp = () => {
      const dropTarget = dragOverTrackIdRef.current;
      if (draggingClip && dropTarget && dropTarget !== draggingClip.trackId) {
        actions.moveClipToTrack(draggingClip.clipId, draggingClip.trackId, dropTarget);
      }
      setDraggingClip(null);
      setResizingClip(null);
      setDragOver(null);
      actions.endDragHistory();
    };

    if (draggingClip || resizingClip) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [draggingClip, resizingClip, pixelsPerSecond]);

  // A clip is "dialogue" when it lives on a real character track; the id
  // prefixes are unreliable (track_broll_1 / track_window_slideshow also
  // start with 'track_').
  const isCharacterTrack = (trackId) => {
    const track = state.tracks.find(t => t.id === trackId);
    return !!(track && track.type === 'character');
  };

  const handleClipContextMenu = (e, clip, trackId) => {
    e.preventDefault();
    e.stopPropagation();
    
    // Estimate menu height as ~140px, width as 150px
    const menuHeight = 140;
    const menuWidth = 150;
    let y = e.clientY;
    let x = e.clientX;
    
    if (y + menuHeight > window.innerHeight) {
      y = window.innerHeight - menuHeight - 10;
    }
    if (x + menuWidth > window.innerWidth) {
      x = window.innerWidth - menuWidth - 10;
    }

    setClipContextMenu({
      x,
      y,
      clip,
      trackId
    });
  };

  const handleTrackHeaderContextMenu = (e, track) => {
    if (track.id === 'track_captions') return;
    e.preventDefault();
    e.stopPropagation();
    if (track.type !== 'character') {
      // Estimate menu height as ~100px, width as 150px
      const menuHeight = 100;
      const menuWidth = 150;
      let y = e.clientY;
      let x = e.clientX;
      
      if (y + menuHeight > window.innerHeight) {
        y = window.innerHeight - menuHeight - 10;
      }
      if (x + menuWidth > window.innerWidth) {
        x = window.innerWidth - menuWidth - 10;
      }

      setTrackContextMenu({
        x,
        y,
        track
      });
    }
  };

  const handleDeleteClip = () => {
    if (!clipContextMenu) return;
    const { clip, trackId } = clipContextMenu;
    
    if (isCharacterTrack(trackId) || trackId === 'track_captions') {
      const blockId = clip.id.replace(/^(presence_|caption_)/, '');
      const updatedBlocks = state.dialogueBlocks.filter(b => b.id !== blockId);
      actions.setBlocks(updatedBlocks);
      actions.addToast(`Deleted dialogue block`, 'success');
    } else {
      actions.removeClipFromTrack(trackId, clip.id);
      actions.addToast(`Deleted clip "${clip.name}"`, 'success');
    }
    setClipContextMenu(null);
  };

  const handleRenameClip = () => {
    if (!clipContextMenu) return;
    const { clip, trackId } = clipContextMenu;
    const newName = prompt("Enter new name for the clip:", clip.name);
    if (newName && newName.trim()) {
      if (isCharacterTrack(trackId)) {
        const blockId = clip.id.startsWith('presence_') ? clip.id.replace('presence_', '') : clip.id;
        actions.updateBlock(blockId, { text: newName });
      } else {
        actions.updateClipProperties(trackId, clip.id, { name: newName });
      }
    }
    setClipContextMenu(null);
  };

  const handleDeleteTrack = () => {
    if (!trackContextMenu) return;
    const { track } = trackContextMenu;
    if (confirm(`Are you sure you want to delete track "${track.name}"?`)) {
      actions.removeTrack(track.id);
      actions.addToast(`Deleted track "${track.name}"`, 'success');
    }
    setTrackContextMenu(null);
  };

  const handleRenameTrack = () => {
    if (!trackContextMenu) return;
    const { track } = trackContextMenu;
    const newName = prompt("Enter new name for track:", track.name);
    if (newName && newName.trim()) {
      actions.updateTrackProperties(track.id, { name: newName.trim() });
      actions.addToast(`Renamed track!`, 'success');
    }
    setTrackContextMenu(null);
  };

  const handleExtractAudio = () => {
    if (!clipContextMenu) return;
    const { clip, trackId } = clipContextMenu;
    actions.extractAudio(trackId, clip.id);
    actions.addToast('Extracted audio from video clip onto separate track', 'success');
    setClipContextMenu(null);
  };

  const handleAddSpecificTrackAbove = (track) => {
    setTrackContextMenu(null);
    const typeLabel = track.type.charAt(0).toUpperCase() + track.type.slice(1);
    actions.addTrack(track.type, `New ${typeLabel} Track`, track.id);
    actions.addToast(`Added new ${track.type} track above ${track.name}`, 'success');
  };

  const handleRedoVoiceLine = async () => {
    if (!clipContextMenu) return;
    const { clip, trackId } = clipContextMenu;
    setClipContextMenu(null);

    const blockId = clip.blockId || (isCharacterTrack(trackId) ? clip.id.replace('presence_', '') : null);
    if (!blockId) return;

    const block = state.dialogueBlocks.find(b => b.id === blockId);
    if (!block) {
      actions.addToast("Could not find dialogue block to redo.", "warning");
      return;
    }

    if (window.electronAPI?.setActiveProjectState && window.electronAPI?.openVoiceCloneWindow) {
      actions.addToast(`Opening Voice Clone to redo line for ${block.characterName}...`, "info");
      await window.electronAPI.setActiveProjectState({
        characters: state.characters,
        dialogueBlocks: state.dialogueBlocks,
        voiceConfigs: state.voiceConfigs,
        redoBlockId: block.id,
        redoClipId: clip.id,
        redoTrackId: trackId
      });
      window.electronAPI.openVoiceCloneWindow();
    } else {
      actions.addToast("Voice Cloning requires the desktop Electron environment.", "warning");
    }
  };

  const handleToggleClipLock = (blockId, isLocked) => {
    setClipContextMenu(null);
    actions.setClipLock(blockId, !isLocked);
    actions.addToast(isLocked ? 'Unlinked presence and captions clips' : 'Synchronized presence and captions clips', 'info');
  };

  // Find selected clip and its track
  let selectedClip = null;
  let selectedClipTrack = null;
  for (const track of tracks) {
    const found = track.clips.find(c => c.id === state.selectedClipId);
    if (found) {
      selectedClip = found;
      selectedClipTrack = track;
      break;
    }
  }

  const handleSplitSelectedClip = () => {
    if (!selectedClip || !selectedClipTrack) return;
    if (currentTime > selectedClip.startTime && currentTime < selectedClip.startTime + selectedClip.duration) {
      actions.splitClip(selectedClipTrack.id, selectedClip.id, currentTime);
      actions.addToast('Clip split successfully', 'success');
    } else {
      actions.addToast('Place the playhead inside the selected clip to split it.', 'warning');
    }
  };

  const handleCutSelectedClip = () => {
    if (!selectedClip || !selectedClipTrack) return;
    actions.removeClipFromTrack(selectedClipTrack.id, selectedClip.id);
    actions.selectClip(null);
    actions.addToast('Clip removed', 'info');
  };

  const handleAddVideoTrack = () => {
    actions.addTrack('video', 'Video Track');
    actions.addToast(`Added video track`, 'success');
  };

  const handleAddAudioTrack = () => {
    actions.addTrack('audio', 'Audio Track');
    actions.addToast(`Added audio track`, 'success');
  };

  const handleAddBrollTrack = () => {
    actions.addTrack('broll', 'PIP Overlay Track');
    actions.addToast(`Added PIP Overlay Track (B-Roll)`, 'success');
  };

  const handleTrackHeaderDragStart = (e, track) => {
    e.stopPropagation();

    e.dataTransfer.setData('text/plain', track.id);
    e.dataTransfer.effectAllowed = 'move';
    setDraggingTrackId(track.id);
  };

  const handleTrackHeaderDragOver = (e, targetTrack) => {
    if (!draggingTrackId) return;
    e.preventDefault();
    e.stopPropagation();
    setDragOverTrackId(targetTrack.id);
  };

  const handleTrackHeaderDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverTrackId(null);
  };

  const handleTrackHeaderDrop = (e, targetTrack) => {
    e.preventDefault();
    e.stopPropagation();
    if (!draggingTrackId || draggingTrackId === targetTrack.id) {
      setDraggingTrackId(null);
      setDragOverTrackId(null);
      return;
    }

    const draggedIndex = tracks.findIndex(t => t.id === draggingTrackId);
    const targetIndex = tracks.findIndex(t => t.id === targetTrack.id);

    if (draggedIndex !== -1 && targetIndex !== -1) {
      const newTracks = [...tracks];
      const [removed] = newTracks.splice(draggedIndex, 1);
      newTracks.splice(targetIndex, 0, removed);
      actions.setTracks(newTracks);
      actions.addToast(`Reordered layers`, 'success');
    }

    setDraggingTrackId(null);
    setDragOverTrackId(null);
  };

  const handleTrackHeaderDragEnd = () => {
    setDraggingTrackId(null);
    setDragOverTrackId(null);
  };

  // ─── Click on track content to seek ───
  const handleTrackClick = (e) => {
    if (e.target.classList.contains('timeline-clip') || e.target.closest('.timeline-clip')) return;
    const trackContent = e.target.closest('.timeline-track__content');
    if (!trackContent) return;
    const rect = trackContent.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const time = Math.max(0, x / pixelsPerSecond);
    actions.setCurrentTime(time);
  };

  return (
    <div className="timeline-panel">
      {/* Timeline Toolbar */}
      <div className="timeline-toolbar">
        <div className="toolbar__group" style={{ borderLeft: 'none', display: 'flex', alignItems: 'center', gap: 6 }}>
          <button
            onClick={() => {
              if (confirm('Are you sure you want to reset all splits, cuts, and layer ordering on the timeline? This will restore clips to their original sequence.')) {
                actions.resetTimeline();
                actions.addToast('Timeline reset successfully', 'success');
              }
            }}
            title="Reset all splits, cuts, and layer order (Undoable)"
            style={{
              height: 22,
              padding: '0 8px',
              fontSize: '10px',
              fontWeight: 'bold',
              borderRadius: 4,
              color: '#ffffff',
              background: 'rgba(255, 64, 129, 0.8)',
              border: 'none',
              marginRight: 10,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
              transition: 'background 0.15s'
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255, 64, 129, 1)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255, 64, 129, 0.8)'; }}
          >
            <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="3"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>
            Reset Timeline
          </button>
          <span style={{ fontSize: '10px', color: 'var(--text-secondary)', marginRight: 2 }}>Select:</span>
          <button
            className={`toolbar__btn ${state.activeTool === 'select' ? 'toolbar__btn--active' : ''}`}
            onClick={() => actions.setActiveTool('select')}
            title="Selection Tool (V)"
            style={{ height: 24, fontSize: 'var(--text-xs)', borderRadius: 4 }}
          >
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 4 }}><path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/></svg>
            Select (V)
          </button>
        </div>

        <div className="toolbar__group" style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 12, borderLeft: '1px solid var(--border-subtle)', paddingLeft: 12 }}>
          <span style={{ fontSize: '10px', color: 'var(--text-secondary)', marginRight: 2 }}>Split:</span>
          <button
            className={`toolbar__btn ${state.activeTool === 'cut' ? 'toolbar__btn--active' : ''}`}
            onClick={() => actions.setActiveTool('cut')}
            title="Razor Blade Tool (C) - click to split clip"
            style={{ height: 24, fontSize: 'var(--text-xs)', borderRadius: 4 }}
          >
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 4 }}><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/></svg>
            Razor Blade (C)
          </button>

          <button
            className="toolbar__btn"
            onClick={handleSplitSelectedClip}
            title="Split selected clip at playhead"
            disabled={!state.selectedClipId}
            style={{ height: 24, fontSize: 'var(--text-xs)', borderRadius: 4, opacity: state.selectedClipId ? 1 : 0.5, cursor: state.selectedClipId ? 'pointer' : 'not-allowed' }}
          >
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 4 }}><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="14" y2="12"/><line x1="4" y1="18" x2="18" y2="18"/><path d="M16 12l4-4-4-4"/></svg>
            Split Playhead
          </button>
        </div>

        {/* Action buttons for selected clip */}
        {state.selectedClipId && selectedClip && selectedClipTrack && (
          <>
            <div className="toolbar__group" style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 12, borderLeft: '1px solid var(--border-subtle)', paddingLeft: 12 }}>
              <button
                className="toolbar__btn"
                onClick={handleCutSelectedClip}
                title="Delete selected clip"
                style={{ height: 24, fontSize: 'var(--text-xs)', color: 'var(--accent-danger)', borderRadius: 4 }}
              >
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 4 }}><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
                Delete
              </button>
            </div>

              {/* Speed Control */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 12, borderLeft: '1px solid var(--border-subtle)', paddingLeft: 12 }}>
                <span style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>Speed:</span>
                <input
                  type="number"
                  step="0.1"
                  min="0.1"
                  max="4.0"
                  style={{ width: 42, height: 18, background: 'var(--surface-2)', border: '1px solid var(--border-subtle)', borderRadius: 3, color: 'var(--text-primary)', fontSize: '10px', padding: '0 2px' }}
                  value={selectedClip.speed ?? 1.0}
                  onChange={(e) => {
                    const val = Math.max(0.1, Math.min(4.0, parseFloat(e.target.value) || 1.0));
                    actions.updateClipProperties(selectedClipTrack.id, selectedClip.id, { speed: val });
                  }}
                />
                <span style={{ fontSize: '9px', color: 'var(--text-disabled)' }}>x</span>
              </div>

              {/* Volume Control (only for tracks that support sound: audio & video) */}
              {(selectedClipTrack.type === 'audio' || selectedClipTrack.type === 'video') && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 12 }}>
                  <span style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>Vol:</span>
                  <input
                    type="range"
                    min="0"
                    max="1.5"
                    step="0.05"
                    style={{ width: 50, height: 4, accentColor: 'var(--accent-primary)', cursor: 'pointer' }}
                    value={selectedClip.volume ?? 1.0}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value);
                      actions.updateClipProperties(selectedClipTrack.id, selectedClip.id, { volume: val });
                    }}
                  />
                  <span style={{ fontSize: '9px', color: 'var(--text-secondary)', minWidth: 24 }}>
                    {Math.round((selectedClip.volume ?? 1.0) * 100)}%
                  </span>
                </div>
              )}

              {/* Fade transitions controls for all clip types */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 12 }}>
                <span style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>Fade In:</span>
                <input
                  type="number"
                  min="0"
                  max="10"
                  step="0.1"
                  style={{ width: 42, height: 18, background: 'var(--surface-2)', border: '1px solid var(--border-subtle)', borderRadius: 3, color: 'var(--text-primary)', fontSize: '10px', padding: '0 2px' }}
                  value={selectedClip.fadeInDuration ?? 0}
                  onChange={(e) => {
                    const val = Math.max(0, Math.min(10, parseFloat(e.target.value) || 0));
                    actions.updateClipProperties(selectedClipTrack.id, selectedClip.id, { fadeInDuration: val });
                  }}
                />
                <span style={{ fontSize: '9px', color: 'var(--text-disabled)' }}>s</span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 12 }}>
                <span style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>Fade Out:</span>
                <input
                  type="number"
                  min="0"
                  max="10"
                  step="0.1"
                  style={{ width: 42, height: 18, background: 'var(--surface-2)', border: '1px solid var(--border-subtle)', borderRadius: 3, color: 'var(--text-primary)', fontSize: '10px', padding: '0 2px' }}
                  value={selectedClip.fadeOutDuration ?? 0}
                  onChange={(e) => {
                    const val = Math.max(0, Math.min(10, parseFloat(e.target.value) || 0));
                    actions.updateClipProperties(selectedClipTrack.id, selectedClip.id, { fadeOutDuration: val });
                  }}
                />
                <span style={{ fontSize: '9px', color: 'var(--text-disabled)' }}>s</span>
              </div>
            </>
          )}

        <div className="toolbar__group">
          <button
            className="toolbar__btn"
            onClick={() => actions.setPlaying(!isPlaying)}
            style={{ height: 24, fontSize: 'var(--text-xs)' }}
          >
            {isPlaying ? (
              <>
                <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" style={{ marginRight: 4 }}><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
                Pause
              </>
            ) : (
              <>
                <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" style={{ marginRight: 4 }}><path d="M8 5v14l11-7z"/></svg>
                Play
              </>
            )}
          </button>
        </div>

        <div className="toolbar__group">
          <button
            className="toolbar__btn"
            onClick={handleAddVideoTrack}
            style={{ height: 24, fontSize: 'var(--text-xs)' }}
          >
            + Video Track
          </button>
          <button
            className="toolbar__btn"
            onClick={handleAddAudioTrack}
            style={{ height: 24, fontSize: 'var(--text-xs)' }}
          >
            + Audio Track
          </button>
          <button
            className="toolbar__btn"
            onClick={handleAddBrollTrack}
            style={{ height: 24, fontSize: 'var(--text-xs)' }}
          >
            + PIP Track
          </button>
        </div>

        <div className="timeline-zoom">
          <span style={{ fontSize: '10px', color: 'var(--text-disabled)' }}>−</span>
          <input
            type="range"
            className="timeline-zoom__slider"
            min="10"
            max="200"
            value={pixelsPerSecond}
            onChange={(e) => actions.setPixelsPerSecond(Number(e.target.value))}
          />
          <span style={{ fontSize: '10px', color: 'var(--text-disabled)' }}>+</span>
          <span style={{ fontSize: '10px', color: 'var(--text-tertiary)', marginLeft: 4, fontFamily: 'var(--font-mono)' }}>
            {pixelsPerSecond}px/s
          </span>
        </div>
      </div>

      {/* Ruler */}
      <div
        className="timeline-ruler"
        onPointerDown={handleRulerPointerDown}
        onPointerMove={handleRulerPointerMove}
        onPointerUp={handleRulerPointerUp}
        style={{ cursor: 'ew-resize', touchAction: 'none' }}
      >
        <div style={{ width: `${trackHeaderWidth}px`, minWidth: `${trackHeaderWidth}px`, background: 'var(--surface-1)', borderRight: '1px solid var(--border-subtle)' }} />
        <div className="timeline-ruler__labels" style={{ width: `${timelineWidth}px` }}>
          {rulerTicks}
        </div>
      </div>
      {/* Tracks */}
      <div
        className="timeline-tracks-container"
        ref={tracksContainerRef}
        onClick={handleTrackClick}
        style={{ overflow: 'auto', paddingBottom: '120px' }}
      >
        <div style={{ position: 'relative', width: 'fit-content', minWidth: '100%', minHeight: '100%' }}>
          {/* Playhead */}
          <div
            ref={playheadRef}
            className="timeline-playhead"
            style={{ left: `${playheadX}px` }}
          />

          {tracks.map(track => (
            <div
              key={track.id}
              data-track-id={track.id}
              className={`timeline-track ${track.type === 'audio' ? 'timeline-track--audio' : ''} ${dragOverTrackId === track.id ? 'timeline-track--dragover' : ''}`}
              onDragOver={(e) => {
                if (draggingTrackId) {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  setDragOverTrackId(track.id);
                } else {
                  handleDragOver(e);
                }
              }}
              onDragLeave={() => {
                if (draggingTrackId) {
                  setDragOverTrackId(null);
                }
              }}
              onDrop={(e) => {
                if (draggingTrackId) {
                  handleTrackHeaderDrop(e, track);
                } else {
                  handleDropOnTrack(e, track);
                }
              }}
            >
              {/* Track Header */}
              <div
                className={`timeline-track__header ${draggingTrackId === track.id ? 'timeline-track__header--dragging' : ''} ${dragOverTrackId === track.id ? 'timeline-track__header--dragover' : ''}`}
                draggable
                onDragStart={(e) => handleTrackHeaderDragStart(e, track)}
                onDragOver={(e) => handleTrackHeaderDragOver(e, track)}
                onDragLeave={handleTrackHeaderDragLeave}
                onDrop={(e) => handleTrackHeaderDrop(e, track)}
                onDragEnd={handleTrackHeaderDragEnd}
                onContextMenu={(e) => handleTrackHeaderContextMenu(e, track)}
              >
                <div
                  className="timeline-track__header-color"
                  style={{ background: track.color }}
                />
                <span className="timeline-track__header-name">{track.name}</span>
                <span className="timeline-track__header-icon" title="Drag header to reorder layer hierarchy" style={{ cursor: 'grab' }}>
                  <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M20 9H4v2h16V9zM4 15h16v-2H4v2z"/></svg>
                </span>
              </div>

              {/* Track Content */}
              <div
                className="timeline-track__content"
                style={{
                  '--pixels-per-second': pixelsPerSecond,
                  minWidth: timelineWidth,
                }}
              >
                {track.type === 'audio' && state.audioFile && (
                  <div className="audio-waveform" style={{ width: `${timelineWidth}px` }}>
                    <AudioWaveformCanvas
                      audioBuffer={state.audioBuffer}
                      width={timelineWidth}
                      height={52}
                      color={track.color}
                    />
                  </div>
                )}

                {track.clips.map(clip => (
                  <div
                    key={clip.id}
                    className={`timeline-clip ${state.selectedClipId === clip.id ? 'timeline-clip--selected' : ''}`}
                    style={{
                      left: `${clip.startTime * pixelsPerSecond}px`,
                      width: `${Math.max(20, clip.duration * pixelsPerSecond)}px`,
                      background: clip.isExtracted
                        ? `repeating-linear-gradient(45deg, rgba(255,255,255,0.08) 0px, rgba(255,255,255,0.08) 6px, transparent 6px, transparent 12px), linear-gradient(135deg, ${clip.color}dd, ${clip.color}aa)`
                        : track.type === 'captions'
                        ? `repeating-linear-gradient(45deg, rgba(255,255,255,0.12) 0px, rgba(255,255,255,0.12) 6px, transparent 6px, transparent 12px), linear-gradient(135deg, ${clip.color}dd, ${clip.color}aa)`
                        : `linear-gradient(135deg, ${clip.color}cc, ${clip.color}88)`,
                      cursor: state.activeTool === 'cut' ? 'crosshair' : 'grab',
                    }}
                    onMouseDown={(e) => handleClipMouseDown(e, clip, track.id)}
                    onContextMenu={(e) => handleClipContextMenu(e, clip, track.id)}
                  >
                    <div
                      className="timeline-clip__handle timeline-clip__handle--left"
                      onMouseDown={(e) => handleResizeMouseDown(e, clip, track.id, 'left')}
                    />
                    <span className="timeline-clip__label">{clip.name}</span>
                    <div
                      className="timeline-clip__handle timeline-clip__handle--right"
                      onMouseDown={(e) => handleResizeMouseDown(e, clip, track.id, 'right')}
                    />
                  </div>
                ))}

                {/* Rhombus Keyframe markers on the track row */}
                {track.type === 'character' && (() => {
                  const char = state.characters.find(c => c.id === track.characterId);
                  if (char && char.keyframingEnabled && char.keyframes) {
                    return char.keyframes.map((kf, kfIdx) => {
                      const leftPos = kf.time * pixelsPerSecond;
                      const isSelected = state.selectedKeyframeIndex === kfIdx && state.selectedElementId === char.id;
                      return (
                        <div
                          key={kfIdx}
                          className="timeline-keyframe-marker"
                          style={{
                            position: 'absolute',
                            left: `${leftPos}px`,
                            top: '50%',
                            transform: 'translate(-50%, -50%) rotate(45deg)',
                            width: 11,
                            height: 11,
                            backgroundColor: isSelected ? '#ff4081' : '#ffffff',
                            border: `2px solid ${isSelected ? '#ffffff' : 'var(--accent-primary)'}`,
                            zIndex: 10,
                            cursor: 'pointer',
                            pointerEvents: 'auto',
                            boxShadow: '0 0 6px rgba(0,0,0,0.8)',
                          }}
                          title={`Keyframe at ${kf.time}s`}
                          onMouseDown={(e) => {
                            e.stopPropagation();
                            actions.selectElement(char.id);
                            actions.selectKeyframe(kfIdx);
                            actions.setCurrentTime(kf.time);
                          }}
                        />
                      );
                    });
                  }
                  return null;
                })()}
              </div>
            </div>
          ))}

          {/* Empty state */}
          {tracks.length === 0 && (
            <div style={{
              padding: '40px', textAlign: 'center',
              color: 'var(--text-disabled)', fontSize: 'var(--text-sm)',
            }}>
              Parse a script to generate timeline tracks
            </div>
          )}
        </div>
      </div>

      {clipContextMenu && (
        <div
          style={{
            position: 'fixed',
            top: clipContextMenu.y,
            left: clipContextMenu.x,
            background: '#151520',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            boxShadow: '0 8px 16px rgba(0,0,0,0.6)',
            borderRadius: 6,
            zIndex: 10000,
            padding: '4px 0',
            minWidth: 120,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {(clipContextMenu.clip.blockId || (isCharacterTrack(clipContextMenu.trackId) && clipContextMenu.clip.id.startsWith('presence_'))) && (
            <HoverMenuItem text="Redo Voice Line" onClick={handleRedoVoiceLine} />
          )}
          {(() => {
            const { clip, trackId } = clipContextMenu;
            let blockId = null;
            if (clip.blockId) {
              blockId = clip.blockId;
            } else if (clip.id && clip.id.startsWith('presence_')) {
              blockId = clip.id.replace('presence_', '');
            } else if (trackId === 'track_captions') {
              blockId = clip.id.replace('caption_', '');
            } else if (isCharacterTrack(trackId) && clip.id && clip.id.startsWith('presence_')) {
              blockId = clip.id.replace('presence_', '');
            }
            if (!blockId) return null;
            const block = state.dialogueBlocks.find(b => b.id === blockId);
            if (!block) return null;
            const isLocked = !block.unlocked;
            return (
              <HoverMenuItem 
                text={isLocked ? "🔓 Unlock Timeline Sync" : "🔒 Lock Timeline Sync"} 
                onClick={() => handleToggleClipLock(blockId, isLocked)} 
              />
            );
          })()}
          {(() => {
            const clipTrack = state.tracks.find(t => t.id === clipContextMenu.trackId);
            if (!clipTrack) return null;
            const isVideoTrackOrOverlay = clipTrack.type === 'video' || clipTrack.type === 'broll' || clipTrack.type === 'window';
            const isExtractAudioVisible = isVideoTrackOrOverlay && clipContextMenu.clip.type === 'video';
            const otherTracks = state.tracks.filter(t => t.type === clipTrack.type && t.id !== clipTrack.id);
            return (
              <>
                {isExtractAudioVisible && (
                  <HoverMenuItem text="🔊 Extract Audio" onClick={handleExtractAudio} />
                )}
                {otherTracks.map(t => (
                  <HoverMenuItem 
                    key={t.id}
                    text={`Move to ${t.name}`} 
                    onClick={() => {
                      actions.moveClipToTrack(clipContextMenu.clip.id, clipContextMenu.trackId, t.id);
                      actions.addToast(`Moved clip to ${t.name}`, 'success');
                      setClipContextMenu(null);
                    }} 
                  />
                ))}
              </>
            );
          })()}
          <HoverMenuItem text="Rename Clip..." onClick={handleRenameClip} />
          <HoverMenuItem text="Delete Clip" color="#ff4081" onClick={handleDeleteClip} />
        </div>
      )}

      {trackContextMenu && (
        <div
          style={{
            position: 'fixed',
            top: trackContextMenu.y,
            left: trackContextMenu.x,
            background: '#151520',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            boxShadow: '0 8px 16px rgba(0,0,0,0.6)',
            borderRadius: 6,
            zIndex: 10000,
            padding: '4px 0',
            minWidth: 120,
          }}
          onClick={(e) => e.stopPropagation()}
        >
           <HoverMenuItem 
            text={`New ${trackContextMenu.track.type.charAt(0).toUpperCase() + trackContextMenu.track.type.slice(1)} Track Above`} 
            onClick={() => handleAddSpecificTrackAbove(trackContextMenu.track)} 
          />
          {trackContextMenu.track.type === 'video' && (
            <HoverMenuItem 
              text={state.windowSlideshowEnabled ? "Disable Window Slideshow" : "Enable Window Slideshow"} 
              onClick={() => {
                actions.setWindowSlideshowEnabled(!state.windowSlideshowEnabled);
                setTrackContextMenu(null);
                actions.addToast(!state.windowSlideshowEnabled ? "Enabled Window Slideshow track" : "Disabled Window Slideshow track", "success");
              }} 
            />
          )}
          <HoverMenuItem text="Rename Track..." onClick={handleRenameTrack} />
          <HoverMenuItem text="Delete Track" color="#ff4081" onClick={handleDeleteTrack} />
        </div>
      )}
    </div>
  );
}

/**
 * Simple audio waveform visualization on a canvas
 */
function AudioWaveformCanvas({ audioBuffer, width, height, color }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !width || !height) return;
    const ctx = canvas.getContext('2d');
    
    // Browsers cap canvas backing store at ~32767px; long timelines exceed
    // it. Draw at a capped resolution and scale the context instead.
    const MAX_CANVAS_W = 32767;
    const drawW = Math.min(width, MAX_CANVAS_W);
    canvas.width = drawW;
    canvas.height = height;
    ctx.scale(width / drawW, 1);
    ctx.clearRect(0, 0, width, height);

    if (!audioBuffer) {
      // Draw placeholder waveform
      ctx.strokeStyle = color + '44';
      ctx.lineWidth = 1;
      ctx.beginPath();
      const mid = height / 2;
      for (let x = 0; x < drawW; x++) {
        const y = mid + Math.sin(x * 0.05) * (height * 0.3) * Math.sin(x * 0.002);
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      return;
    }

    // Draw actual waveform from audio buffer
    const channelData = audioBuffer.getChannelData(0);
    const samplesPerPixel = Math.floor(channelData.length / drawW);
    const mid = height / 2;

    ctx.fillStyle = color + '66';
    
    for (let x = 0; x < drawW; x++) {
      let min = 1, max = -1;
      const start = x * samplesPerPixel;
      const end = Math.min(start + samplesPerPixel, channelData.length);
      
      for (let i = start; i < end; i += Math.max(1, Math.floor(samplesPerPixel / 50))) {
        const val = channelData[i];
        if (val < min) min = val;
        if (val > max) max = val;
      }
      
      const barTop = mid + min * mid;
      const barHeight = (max - min) * mid;
      ctx.fillRect(x, barTop, 1, Math.max(1, barHeight));
    }
  }, [audioBuffer, width, height, color]);

  return <canvas ref={canvasRef} style={{ width: '100%', height: '100%' }} />;
}
