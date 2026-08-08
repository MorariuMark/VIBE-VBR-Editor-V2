import { getAnimatedTransform, getActiveBlocks, getInterpolatedKeyframeTransform } from './animationEngine';

export function alignWords(scriptWords, whisperWords) {
  if (!scriptWords || scriptWords.length === 0) return [];
  if (!whisperWords || whisperWords.length === 0) {
    return scriptWords.map(w => ({ text: w, start: 0, end: 0 }));
  }

  const n = scriptWords.length;
  const m = whisperWords.length;

  const dp = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));
  const parent = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));

  for (let i = 0; i <= n; i++) {
    dp[i][0] = i * 2;
    parent[i][0] = 2; // insert script word
  }
  for (let j = 0; j <= m; j++) {
    dp[0][j] = j * 2;
    parent[0][j] = 1; // delete whisper word
  }

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const w1 = scriptWords[i - 1].toLowerCase().replace(/[^\w]/g, '');
      const w2 = String(whisperWords[j - 1].text ?? whisperWords[j - 1].word ?? '').toLowerCase().replace(/[^\w]/g, '');
      
      const matchCost = (w1 === w2) ? 0 : 1;

      const costMatch = dp[i - 1][j - 1] + matchCost;
      const costDeleteWhisper = dp[i][j - 1] + 2;
      const costInsertScript = dp[i - 1][j] + 2;

      let minCost = costMatch;
      let op = 0; // match or substitute

      if (costDeleteWhisper < minCost) {
        minCost = costDeleteWhisper;
        op = 1;
      }
      if (costInsertScript < minCost) {
        minCost = costInsertScript;
        op = 2;
      }

      dp[i][j] = minCost;
      parent[i][j] = op;
    }
  }

  const aligned = [];
  let i = n;
  let j = m;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && parent[i][j] === 0) {
      aligned.push({
        text: scriptWords[i - 1],
        start: whisperWords[j - 1].start,
        end: whisperWords[j - 1].end,
      });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || parent[i][j] === 1)) {
      j--;
    } else {
      aligned.push({
        text: scriptWords[i - 1],
        start: -1,
        end: -1,
      });
      i--;
    }
  }

  aligned.reverse();

  // Interpolate missing timestamps
  for (let k = 0; k < aligned.length; k++) {
    if (aligned[k].start === -1) {
      let prevEnd = 0;
      for (let prev = k - 1; prev >= 0; prev--) {
        if (aligned[prev].end !== -1) {
          prevEnd = aligned[prev].end;
          break;
        }
      }

      let nextStart = 0;
      for (let next = k + 1; next < aligned.length; next++) {
        if (aligned[next].start !== -1) {
          nextStart = aligned[next].start;
          break;
        }
      }

      if (nextStart > prevEnd) {
        aligned[k].start = prevEnd;
        aligned[k].end = prevEnd + (nextStart - prevEnd) / 2;
      } else {
        aligned[k].start = prevEnd;
        aligned[k].end = prevEnd + 0.3;
      }
    }
  }

  return aligned;
}

export function getCaptionActiveWordInfo(text, startTime, duration, currentTime, wordsPerLine = 3, blockWords = null) {
  const elapsed = currentTime - startTime;
  
  const scriptWords = text.split(/\s+/).filter(w => w.length > 0);
  if (scriptWords.length === 0) return { text: '', activeWordIndex: -1 };

  if (blockWords && blockWords.length > 0) {
    const alignedWords = alignWords(scriptWords, blockWords);
    let activeWordIndex = -1;
    
    // Find active word based on timing relative to block start
    for (let i = 0; i < alignedWords.length; i++) {
      const w = alignedWords[i];
      if (elapsed >= w.start && elapsed <= w.end) {
        activeWordIndex = i;
        break;
      }
    }
    
    // Fallback: if in a gap, find the last word that has ended
    if (activeWordIndex === -1) {
      for (let i = 0; i < alignedWords.length; i++) {
        const w = alignedWords[i];
        if (elapsed >= w.end) {
          activeWordIndex = i;
        } else {
          break;
        }
      }
    }
    
    // Default to the first word if we somehow didn't match anything
    if (activeWordIndex === -1) {
      activeWordIndex = 0;
    }
    
    const chunks = [];
    for (let i = 0; i < alignedWords.length; i += wordsPerLine) {
      chunks.push(alignedWords.slice(i, i + wordsPerLine));
    }
    
    const chunkIndex = Math.floor(activeWordIndex / wordsPerLine);
    const activeChunkIndex = Math.max(0, Math.min(chunks.length - 1, chunkIndex));
    const activeChunk = chunks[activeChunkIndex] || [];
    
    const activeWordIndexInChunk = activeWordIndex - (activeChunkIndex * wordsPerLine);
    
    return {
      text: activeChunk.map(w => w.text).join(' '),
      activeWordIndex: activeWordIndexInChunk,
    };
  } else {
    // Linear fallback
    const chunks = [];
    for (let i = 0; i < scriptWords.length; i += wordsPerLine) {
      chunks.push(scriptWords.slice(i, i + wordsPerLine));
    }
    
    const numChunks = chunks.length;
    const chunkDuration = duration / numChunks;
    const chunkIndex = Math.floor(elapsed / chunkDuration);
    const activeChunkIndex = Math.max(0, Math.min(numChunks - 1, chunkIndex));
    const activeChunk = chunks[activeChunkIndex] || [];
    
    const elapsedWithinChunk = elapsed - activeChunkIndex * chunkDuration;
    const wordDuration = chunkDuration / Math.max(1, activeChunk.length);
    const wordIndexInChunk = Math.floor(elapsedWithinChunk / wordDuration);
    const activeWordIndexInChunk = Math.max(0, Math.min(activeChunk.length - 1, wordIndexInChunk));
    
    return {
      text: activeChunk.join(' '),
      activeWordIndex: activeWordIndexInChunk,
    };
  }
}

export function getCaptionTextForTime(text, startTime, duration, currentTime, wordsPerLine = 3, blockWords = null) {
  const info = getCaptionActiveWordInfo(text, startTime, duration, currentTime, wordsPerLine, blockWords);
  return info ? info.text : '';
}

export function calculateClipOpacity(clip, time) {
  if (!clip) return 1.0;
  const fadeIn = clip.fadeInDuration ?? 0;
  const fadeOut = clip.fadeOutDuration ?? 0;
  
  if (time >= clip.startTime && time <= clip.startTime + clip.duration) {
    if (fadeIn > 0 && time < clip.startTime + fadeIn) {
      return Math.max(0, Math.min(1, (time - clip.startTime) / fadeIn));
    }
    if (fadeOut > 0 && time > clip.startTime + clip.duration - fadeOut) {
      return Math.max(0, Math.min(1, (clip.startTime + clip.duration - time) / fadeOut));
    }
    return 1.0;
  }
  return 0.0;
}

export function drawFrame(ctx, { state, time, width, height, loadedImages, videoElement, backgroundFrame, drawHandles, transparentBackground, transformMode, activeAxis }) {
  const scaleFactor = width / state.canvasWidth;
  const activeBlocks = getActiveBlocks(state.dialogueBlocks, time);

  // 2a. Draw solid dark background color or clear for transparency
  if (transparentBackground) {
    ctx.clearRect(0, 0, width, height);
  } else {
    ctx.fillStyle = '#0a0a0f';
    ctx.fillRect(0, 0, width, height);
  }

  // Sort tracks for rendering order (bottom-most visual layer to top-most visual layer)
  const renderOrderTracks = [];
  
  // 1. Video tracks first (background layer)
  state.tracks.forEach(t => {
    if (t.type === 'video') renderOrderTracks.push(t);
  });
  // 2. Character tracks second (middle layer)
  state.tracks.forEach(t => {
    if (t.type === 'character') renderOrderTracks.push(t);
  });
  // 3. B-Roll and Window overlay tracks third (above characters)
  state.tracks.forEach(t => {
    if (t.type === 'broll' || t.type === 'window') renderOrderTracks.push(t);
  });
  // 4. Captions track last (very top)
  state.tracks.forEach(t => {
    if (t.type === 'captions') renderOrderTracks.push(t);
  });

  renderOrderTracks.forEach(track => {
    if (track.type === 'video') {
      if (transparentBackground) return;
      const activeClip = track.clips.find(clip => time >= clip.startTime && time < clip.startTime + clip.duration);
      if (!activeClip) return;

      ctx.save();
      ctx.globalAlpha = calculateClipOpacity(activeClip, time);

      if (activeClip.type === 'video') {
        // Pre-rendered background cache frame (ImageBitmap) wins over the
        // live <video> element for the background clip only.
        if (activeClip.id === 'clip_bg' && backgroundFrame && backgroundFrame.close) {
          const canvasRatio = width / height;
          const frameRatio = backgroundFrame.width / backgroundFrame.height || canvasRatio;

          let sx = 0, sy = 0, sw = backgroundFrame.width, sh = backgroundFrame.height;
          if (frameRatio > canvasRatio) {
            sw = sh * canvasRatio;
            sx = (backgroundFrame.width - sw) / 2;
          } else {
            sh = sw / canvasRatio;
            sy = (backgroundFrame.height - sh) / 2;
          }

          try {
            ctx.drawImage(backgroundFrame, sx, sy, sw, sh, 0, 0, width, height);
          } catch (e) {
            ctx.drawImage(backgroundFrame, 0, 0, width, height);
          }
        } else {
          const v = (videoElement && videoElement[activeClip.id]) || 
                    (activeClip.id === 'clip_bg' && videoElement instanceof HTMLVideoElement ? videoElement : null);
          if (v && v.readyState >= 2) {
            const canvasRatio = width / height;
            const videoRatio = v.videoWidth / v.videoHeight || (state.canvasWidth / state.canvasHeight);
            
            let sx = 0, sy = 0, sw = v.videoWidth, sh = v.videoHeight;
            if (videoRatio > canvasRatio) {
              sw = sh * canvasRatio;
              sx = (v.videoWidth - sw) / 2;
            } else {
              sh = sw / canvasRatio;
              sy = (v.videoHeight - sh) / 2;
            }
            
            try {
              ctx.drawImage(v, sx, sy, sw, sh, 0, 0, width, height);
            } catch (e) {
              ctx.drawImage(v, 0, 0, width, height);
            }
          }
        }
      } else if (activeClip.type === 'image') {
        const img = loadedImages[activeClip.id];
        if (img) {
          const canvasRatio = width / height;
          const imgRatio = img.width / img.height || (state.canvasWidth / state.canvasHeight);
          
          let sx = 0, sy = 0, sw = img.width, sh = img.height;
          if (imgRatio > canvasRatio) {
            sw = sh * canvasRatio;
            sx = (img.width - sw) / 2;
          } else {
            sh = sw / canvasRatio;
            sy = (img.height - sh) / 2;
          }
          ctx.drawImage(img, sx, sy, sw, sh, 0, 0, width, height);
        }
      }
      ctx.restore();
    } else if (track.type === 'window') {
      const activeClip = track.clips.find(clip => time >= clip.startTime && time < clip.startTime + clip.duration);
      if (activeClip) {
        const transform = state.characterTransforms[track.id] || {
          x: state.canvasWidth * 0.5,
          y: state.canvasHeight * 0.2,
          scale: 0.9,
          rotation: 0,
          rotateX: 0,
          rotateY: 0,
          skewX: 0,
          skewY: 0,
          flipX: 1,
          flipY: 1
        };

        let mediaRatio = 16/9;
        if (activeClip.type === 'video') {
          const v = (videoElement && videoElement[activeClip.id]) || 
                    (activeClip.id === 'clip_bg' && videoElement instanceof HTMLVideoElement ? videoElement : null);
          if (v && v.videoWidth) {
            mediaRatio = v.videoWidth / v.videoHeight;
          }
        } else if (activeClip.type === 'image') {
          const img = loadedImages[activeClip.id];
          if (img && img.width) {
            mediaRatio = img.width / img.height;
          }
        }

        const drawW = 640 * transform.scale * scaleFactor;
        const drawH = (640 / mediaRatio) * transform.scale * scaleFactor;
        const cx = transform.x * scaleFactor;
        const cy = transform.y * scaleFactor;
        const drawX = -drawW / 2;
        const drawY = -drawH / 2;

        ctx.save();
        ctx.globalAlpha = calculateClipOpacity(activeClip, time);
        
        ctx.translate(cx, cy);
        ctx.rotate((transform.rotation * Math.PI) / 180);
        
        let scaleX = Math.cos(transform.rotateY * Math.PI / 180) * (transform.flipX ?? 1);
        let scaleY = Math.cos(transform.rotateX * Math.PI / 180) * (transform.flipY ?? 1);
        
        const tanSkewX = Math.tan((transform.skewX ?? 0) * Math.PI / 180);
        const tanSkewY = Math.tan((transform.skewY ?? 0) * Math.PI / 180);
        ctx.transform(scaleX, scaleX * tanSkewY, scaleY * tanSkewX, scaleY, 0, 0);

        ctx.beginPath();
        if (ctx.roundRect) {
          ctx.roundRect(drawX, drawY, drawW, drawH, 12 * scaleFactor);
        } else {
          ctx.rect(drawX, drawY, drawW, drawH);
        }
        ctx.clip();

        if (activeClip.type === 'video') {
          const v = (videoElement && videoElement[activeClip.id]) || 
                    (activeClip.id === 'clip_bg' && videoElement instanceof HTMLVideoElement ? videoElement : null);
          if (v && v.readyState >= 2) {
            try {
              ctx.drawImage(v, 0, 0, v.videoWidth, v.videoHeight, drawX, drawY, drawW, drawH);
            } catch (e) {
              ctx.drawImage(v, drawX, drawY, drawW, drawH);
            }
          }
        } else if (activeClip.type === 'image') {
          const img = loadedImages[activeClip.id];
          if (img) {
            ctx.drawImage(img, 0, 0, img.width, img.height, drawX, drawY, drawW, drawH);
          }
        }

        ctx.restore();

        const hasSelectedClip = track.clips.some(c => c.id === state.selectedClipId);
        if (drawHandles && (state.selectedElementId === track.id || hasSelectedClip)) {
          ctx.save();
          ctx.translate(cx, cy);
          ctx.rotate((transform.rotation * Math.PI) / 180);
          ctx.transform(scaleX, scaleX * tanSkewY, scaleY * tanSkewX, scaleY, 0, 0);

          ctx.strokeStyle = '#ffd740'; // Gold border for slideshow window
          ctx.lineWidth = 3 * scaleFactor;
          ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
          ctx.shadowBlur = 12 * scaleFactor;
          ctx.shadowOffsetX = 0;
          ctx.shadowOffsetY = 4 * scaleFactor;
          ctx.beginPath();
          if (ctx.roundRect) {
            ctx.roundRect(drawX, drawY, drawW, drawH, 12 * scaleFactor);
          } else {
            ctx.rect(drawX, drawY, drawW, drawH);
          }
          ctx.stroke();
          ctx.restore();
        }
      }
    } else if (track.type === 'broll') {
      if (state.brollLayout === 'none') return;
      const activeClip = track.clips.find(clip => time >= clip.startTime && time < clip.startTime + clip.duration);
      if (!activeClip) return;

      const transform = state.characterTransforms[track.id] || {
        x: state.canvasWidth * 0.5,
        y: state.canvasHeight * 0.3,
        scale: 0.8,
        rotation: 0,
        rotateX: 0,
        rotateY: 0,
        skewX: 0,
        skewY: 0,
        flipX: 1,
        flipY: 1
      };

      let drawW = width, drawH = height, drawX = 0, drawY = 0;
      let cx = width * 0.5, cy = height * 0.5;
      let isPip = false;

      let mediaRatio = 16/9;
      if (activeClip.type === 'video') {
        const v = (videoElement && videoElement[activeClip.id]) || 
                  (activeClip.id === 'clip_bg' && videoElement instanceof HTMLVideoElement ? videoElement : null);
        if (v && v.videoWidth) {
          mediaRatio = v.videoWidth / v.videoHeight;
        }
      } else if (activeClip.type === 'image') {
        const img = loadedImages[activeClip.id];
        if (img && img.width) {
          mediaRatio = img.width / img.height;
        }
      }

      if (state.brollLayout === 'split') {
        drawX = 0;
        drawY = 0;
        drawW = width;
        drawH = height * 0.45;
      } else {
        drawW = 640 * transform.scale * scaleFactor;
        drawH = (640 / mediaRatio) * transform.scale * scaleFactor;
        cx = transform.x * scaleFactor;
        cy = transform.y * scaleFactor;
        drawX = -drawW / 2;
        drawY = -drawH / 2;
        isPip = true;
      }

      ctx.save();
      ctx.globalAlpha = calculateClipOpacity(activeClip, time);

      if (state.brollLayout === 'split') {
        ctx.beginPath();
        ctx.rect(drawX, drawY, drawW, drawH);
        ctx.clip();

        if (activeClip.type === 'video') {
          const v = (videoElement && videoElement[activeClip.id]) || 
                    (activeClip.id === 'clip_bg' && videoElement instanceof HTMLVideoElement ? videoElement : null);
          if (v && v.readyState >= 2) {
            const containerRatio = drawW / drawH;
            let targetW = drawW, targetH = drawH, targetX = drawX, targetY = drawY;
            if (mediaRatio > containerRatio) {
              targetH = drawW / mediaRatio;
              targetY = drawY + (drawH - targetH) / 2;
            } else {
              targetW = drawH * mediaRatio;
              targetX = drawX + (drawW - targetW) / 2;
            }
            try {
              ctx.drawImage(v, 0, 0, v.videoWidth, v.videoHeight, targetX, targetY, targetW, targetH);
            } catch (e) {
              ctx.drawImage(v, drawX, drawY, drawW, drawH);
            }
          }
        } else if (activeClip.type === 'image') {
          const img = loadedImages[activeClip.id];
          if (img) {
            const containerRatio = drawW / drawH;
            let targetW = drawW, targetH = drawH, targetX = drawX, targetY = drawY;
            if (mediaRatio > containerRatio) {
              targetH = drawW / mediaRatio;
              targetY = drawY + (drawH - targetH) / 2;
            } else {
              targetW = drawH * mediaRatio;
              targetX = drawX + (drawW - targetW) / 2;
            }
            ctx.drawImage(img, 0, 0, img.width, img.height, targetX, targetY, targetW, targetH);
          }
        }
      } else {
        ctx.translate(cx, cy);
        ctx.rotate((transform.rotation * Math.PI) / 180);
        
        let scaleX = Math.cos(transform.rotateY * Math.PI / 180) * (transform.flipX ?? 1);
        let scaleY = Math.cos(transform.rotateX * Math.PI / 180) * (transform.flipY ?? 1);
        
        const tanSkewX = Math.tan((transform.skewX ?? 0) * Math.PI / 180);
        const tanSkewY = Math.tan((transform.skewY ?? 0) * Math.PI / 180);
        ctx.transform(scaleX, scaleX * tanSkewY, scaleY * tanSkewX, scaleY, 0, 0);

        ctx.beginPath();
        if (ctx.roundRect) {
          ctx.roundRect(drawX, drawY, drawW, drawH, 12 * scaleFactor);
        } else {
          ctx.rect(drawX, drawY, drawW, drawH);
        }
        ctx.clip();

        if (activeClip.type === 'video') {
          const v = (videoElement && videoElement[activeClip.id]) || 
                    (activeClip.id === 'clip_bg' && videoElement instanceof HTMLVideoElement ? videoElement : null);
          if (v && v.readyState >= 2) {
            try {
              ctx.drawImage(v, 0, 0, v.videoWidth, v.videoHeight, drawX, drawY, drawW, drawH);
            } catch (e) {
              ctx.drawImage(v, drawX, drawY, drawW, drawH);
            }
          }
        } else if (activeClip.type === 'image') {
          const img = loadedImages[activeClip.id];
          if (img) {
            ctx.drawImage(img, 0, 0, img.width, img.height, drawX, drawY, drawW, drawH);
          }
        }
      }

      ctx.restore();

      if (state.brollLayout === 'split') {
        ctx.save();
        ctx.strokeStyle = '#ffd21e';
        ctx.lineWidth = 4 * scaleFactor;
        ctx.beginPath();
        ctx.moveTo(0, height * 0.45);
        ctx.lineTo(width, height * 0.45);
        ctx.stroke();
        ctx.restore();
      } else if (isPip) {
        const hasSelectedClip = track.clips.some(c => c.id === state.selectedClipId);
        if (drawHandles && (state.selectedElementId === track.id || hasSelectedClip)) {
          ctx.save();
          ctx.translate(cx, cy);
          ctx.rotate((transform.rotation * Math.PI) / 180);
          
          let scaleX = Math.cos(transform.rotateY * Math.PI / 180) * (transform.flipX ?? 1);
          let scaleY = Math.cos(transform.rotateX * Math.PI / 180) * (transform.flipY ?? 1);
          const tanSkewX = Math.tan((transform.skewX ?? 0) * Math.PI / 180);
          const tanSkewY = Math.tan((transform.skewY ?? 0) * Math.PI / 180);
          ctx.transform(scaleX, scaleX * tanSkewY, scaleY * tanSkewX, scaleY, 0, 0);

          ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
          ctx.lineWidth = 3 * scaleFactor;
          ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
          ctx.shadowBlur = 12 * scaleFactor;
          ctx.shadowOffsetX = 0;
          ctx.shadowOffsetY = 4 * scaleFactor;
          ctx.beginPath();
          if (ctx.roundRect) {
            ctx.roundRect(drawX, drawY, drawW, drawH, 12 * scaleFactor);
          } else {
            ctx.rect(drawX, drawY, drawW, drawH);
          }
          ctx.stroke();
          ctx.restore();
        }
      }
    } else if (track.type === 'character') {
      const charId = track.characterId;
      const char = state.characters.find(c => c.id === charId);
      if (!char) return;

      const block = activeBlocks.find(b => b.characterId === charId);
      if (!block) return;

      const defaultTransform = state.characterTransforms[char.id] || {
        x: state.canvasWidth / 2,
        y: state.canvasHeight * 0.65,
        scale: 1,
        rotation: 0,
      };

      const baseTransform = char.keyframingEnabled && char.keyframes?.length > 0
        ? getInterpolatedKeyframeTransform(char.keyframes, time)
        : defaultTransform;

      const animTransform = getAnimatedTransform(block, baseTransform, time);
      if (!animTransform) return;

      ctx.save();
      ctx.globalAlpha = animTransform.opacity ?? 1;

      const displayX = animTransform.x * scaleFactor;
      const displayY = animTransform.y * scaleFactor;
      const charSize = Math.max(0, 640 * (animTransform.scale || 1) * scaleFactor);

      const charImg = loadedImages[char.id];

      if (charImg) {
        ctx.translate(displayX, displayY);
        ctx.rotate(((animTransform.rotation || 0) * Math.PI) / 180);
        
        // 1. Skew
        const skewXRad = ((animTransform.skewX || 0) * Math.PI) / 180;
        const skewYRad = ((animTransform.skewY || 0) * Math.PI) / 180;
        if (skewXRad !== 0 || skewYRad !== 0) {
          ctx.transform(1, Math.tan(skewYRad), Math.tan(skewXRad), 1, 0, 0);
        }

        // 2. 3D Rotation (simulate scale squash) & Flips
        const rotXRad = ((animTransform.rotateX || 0) * Math.PI) / 180;
        const rotYRad = ((animTransform.rotateY || 0) * Math.PI) / 180;
        ctx.scale(
          Math.cos(rotYRad) * (animTransform.flipX ?? 1),
          Math.cos(rotXRad) * (animTransform.flipY ?? 1)
        );

        ctx.drawImage(charImg, -charSize / 2, -charSize / 2, charSize, charSize);
      } else {
        // Fallback placeholder circle
        ctx.translate(displayX, displayY);
        ctx.rotate(((animTransform.rotation || 0) * Math.PI) / 180);

        // 1. Skew
        const skewXRad = ((animTransform.skewX || 0) * Math.PI) / 180;
        const skewYRad = ((animTransform.skewY || 0) * Math.PI) / 180;
        if (skewXRad !== 0 || skewYRad !== 0) {
          ctx.transform(1, Math.tan(skewYRad), Math.tan(skewXRad), 1, 0, 0);
        }

        // 2. 3D Rotation (simulate scale squash) & Flips
        const rotXRad = ((animTransform.rotateX || 0) * Math.PI) / 180;
        const rotYRad = ((animTransform.rotateY || 0) * Math.PI) / 180;
        ctx.scale(
          Math.cos(rotYRad) * (animTransform.flipX ?? 1),
          Math.cos(rotXRad) * (animTransform.flipY ?? 1)
        );

        ctx.beginPath();
        ctx.arc(0, 0, charSize / 2, 0, Math.PI * 2);
        ctx.fillStyle = char.color + '33';
        ctx.fill();
        ctx.strokeStyle = char.color;
        ctx.lineWidth = 3;
        ctx.stroke();

        ctx.fillStyle = char.color;
        ctx.font = `bold ${charSize * 0.4}px Inter, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(char.name[0]?.toUpperCase() || '?', 0, 0);
      }

      ctx.restore();
    } else if (track.type === 'captions') {
      activeBlocks.forEach(block => {
        const char = state.characters.find(c => c.id === block.characterId);
        if (!char) return;

        const charTransform = state.characterTransforms[char.id] || {
          x: state.canvasWidth / 2,
          y: state.canvasHeight * 0.65,
          scale: 1,
          rotation: 0,
        };
        const baseTransform = char.keyframingEnabled && char.keyframes?.length > 0
          ? getInterpolatedKeyframeTransform(char.keyframes, time)
          : charTransform;

        const animTransform = getAnimatedTransform(block, baseTransform, time);
        if (!animTransform) return;

        ctx.save();
        const captionKey = `caption_${char.id}`;
        const defaultCaptionTransform = {
          x: state.canvasWidth / 2,
          y: state.canvasHeight * 0.85,
          scale: 1,
          rotation: 0,
        };
        const captionTransform = state.characterTransforms[captionKey] || defaultCaptionTransform;

        ctx.globalAlpha = animTransform.opacity ?? 1;

        const displayCx = captionTransform.x * scaleFactor;
        const displayCy = captionTransform.y * scaleFactor;

        // Get text style options
        const style = {
          ...(char.textStyle || {
            fontFamily: 'Impact',
            fontSize: 48,
            color: '#ffffff',
            strokeColor: '#000000',
            strokeWidth: 4,
            shadowColor: 'rgba(0,0,0,0.5)',
            shadowBlur: 10,
            shadowOffsetX: 2,
            shadowOffsetY: 2,
            glowColor: 'rgba(124,77,255,0)',
            glowBlur: 0,
            backgroundColor: 'rgba(0,0,0,0.7)',
            backgroundPadding: 10,
            showBackground: false,
            letterSpacing: 2,
            lineHeight: 1.4,
            wordsPerLine: 3,
            caseMode: 'uppercase',
            enableHighlight: true,
            highlightColor: '#ffd21e',
          }),
          ...(block.textStyle || {})
        };

        const wordsPerLine = style.wordsPerLine ?? 3;
        const activeWordInfo = getCaptionActiveWordInfo(block.text, block.startTime, block.duration, time, wordsPerLine, block.words);
        if (!activeWordInfo || !activeWordInfo.text) {
          ctx.restore();
          return;
        }
        let activeText = activeWordInfo.text;

        // Apply Case Mode
        if (style.caseMode === 'uppercase') {
          activeText = activeText.toUpperCase();
        } else if (style.caseMode === 'lowercase') {
          activeText = activeText.toLowerCase();
        }

        const fontSize = Math.max(10, Math.floor((style.fontSize || 48) * captionTransform.scale * scaleFactor));
        ctx.font = `900 ${fontSize}px ${style.fontFamily || 'Impact, sans-serif'}`;
        ctx.letterSpacing = `${style.letterSpacing ?? 2}px`;

        // Wrap lines if they exceed max width
        const words = activeText.split(' ');
        const lines = [];
        let currentLine = '';
        const maxLineWidth = Math.max(120, state.canvasWidth * 0.75 * captionTransform.scale * scaleFactor);

        words.forEach(word => {
          const testLine = currentLine ? `${currentLine} ${word}` : word;
          if (ctx.measureText(testLine).width > maxLineWidth) {
            if (currentLine) lines.push(currentLine);
            currentLine = word;
          } else {
            currentLine = testLine;
          }
        });
        if (currentLine) lines.push(currentLine);

        const lineHeight = fontSize * (style.lineHeight || 1.4);
        const padding = fontSize * ((style.backgroundPadding ?? 10) / 36);

        let blockWidth = 0;
        lines.forEach(line => {
          const w = ctx.measureText(line).width;
          if (w > blockWidth) blockWidth = w;
        });
        blockWidth = Math.max(50, blockWidth + padding * 2);
        const blockHeight = lines.length * lineHeight + padding * 2;

        const rx = displayCx - blockWidth / 2;
        const ry = displayCy - blockHeight / 2;

        // Backdrop Box
        if (style.showBackground) {
          ctx.fillStyle = style.backgroundColor || 'rgba(0,0,0,0.7)';
          ctx.beginPath();
          ctx.roundRect(rx, ry, blockWidth, blockHeight, 8 * scaleFactor);
          ctx.fill();
        }

        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        let runningWordIdx = 0;
        lines.forEach((line, i) => {
          const lineY = ry + padding + i * lineHeight + lineHeight / 2;

          // Drop Shadow
          if (style.shadowColor && (style.shadowBlur > 0 || style.shadowOffsetX !== 0 || style.shadowOffsetY !== 0)) {
            ctx.save();
            ctx.shadowColor = style.shadowColor;
            ctx.shadowBlur = style.shadowBlur * scaleFactor;
            ctx.shadowOffsetX = style.shadowOffsetX * scaleFactor;
            ctx.shadowOffsetY = style.shadowOffsetY * scaleFactor;
            ctx.fillStyle = style.color || '#ffffff';
            ctx.fillText(line, displayCx, lineY);
            ctx.restore();
          }

          // Glow
          if (style.glowColor && style.glowBlur > 0) {
            ctx.save();
            ctx.shadowColor = style.glowColor;
            ctx.shadowBlur = style.glowBlur * scaleFactor;
            ctx.shadowOffsetX = 0;
            ctx.shadowOffsetY = 0;
            ctx.fillStyle = style.color || '#ffffff';
            ctx.fillText(line, displayCx, lineY);
            ctx.restore();
          }

          // Outline / Stroke
          if (style.strokeColor && style.strokeWidth > 0) {
            ctx.strokeStyle = style.strokeColor;
            ctx.lineWidth = style.strokeWidth * scaleFactor;
            ctx.lineJoin = 'round';
            ctx.strokeText(line, displayCx, lineY);
          }

          // Core Text Fill
          const prevAlign = ctx.textAlign;
          ctx.textAlign = 'left';

          const lineWidth = ctx.measureText(line).width;
          const lineStartX = displayCx - lineWidth / 2;
          const lineWords = line.split(' ');

          lineWords.forEach((word, idx) => {
            const prefix = lineWords.slice(0, idx).join(' ') + (idx > 0 ? ' ' : '');
            let displayPrefix = prefix;
            let displayWord = word;
            if (style.caseMode === 'uppercase') {
              displayPrefix = displayPrefix.toUpperCase();
              displayWord = displayWord.toUpperCase();
            } else if (style.caseMode === 'lowercase') {
              displayPrefix = displayPrefix.toLowerCase();
              displayWord = displayWord.toLowerCase();
            }

            const prefixWidth = ctx.measureText(displayPrefix).width;
            const wordX = lineStartX + prefixWidth;

            const isHighlightEnabled = style.enableHighlight !== false;
            const isActive = isHighlightEnabled && (runningWordIdx === activeWordInfo.activeWordIndex);
            const highlightCol = style.highlightColor || '#ffd21e';

            const scaleBounce = style.scaleBounce === true;
            if (isActive && scaleBounce) {
              ctx.save();
              const wordW = ctx.measureText(displayWord).width;
              const wordCx = wordX + wordW / 2;
              
              ctx.translate(wordCx, lineY);
              ctx.scale(1.18, 1.18); // scale bounce highlight
              
              ctx.fillStyle = highlightCol;
              
              if (style.strokeColor && style.strokeWidth > 0) {
                ctx.strokeStyle = style.strokeColor;
                ctx.lineWidth = style.strokeWidth * scaleFactor;
                ctx.lineJoin = 'round';
                ctx.strokeText(displayWord, -wordW / 2, 0);
              }
              
              ctx.fillText(displayWord, -wordW / 2, 0);
              ctx.restore();
            } else {
              ctx.fillStyle = isActive ? highlightCol : (style.color || '#ffffff');
              ctx.fillText(displayWord, wordX, lineY);
            }

            runningWordIdx++;
          });

          ctx.textAlign = prevAlign;
        });

        ctx.restore();
      });
    }
  });

  if (drawHandles && state.selectedElementId) {
    let cx, cy, w, h;
    const isCaption = state.selectedElementId.startsWith('caption_');
    const isBroll = state.selectedElementId.includes('broll') || state.selectedElementId === 'broll';
    const isWindow = state.selectedElementId.includes('window') || state.selectedElementId === 'window';

    // Draw motion path (After Effects style) for keyframed characters
    const motionChar = isCaption ? null : state.characters.find(c => c.id === state.selectedElementId);
    if (motionChar && motionChar.keyframingEnabled && motionChar.keyframes && motionChar.keyframes.length > 0) {
      ctx.save();
      ctx.strokeStyle = 'rgba(0, 229, 255, 0.45)';
      ctx.lineWidth = 2.5;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      
      const sortedKfs = [...motionChar.keyframes].sort((a, b) => a.time - b.time);
      sortedKfs.forEach((kf, idx) => {
        const kfX = kf.x * scaleFactor;
        const kfY = kf.y * scaleFactor;
        if (idx === 0) {
          ctx.moveTo(kfX, kfY);
        } else {
          ctx.lineTo(kfX, kfY);
        }
      });
      ctx.stroke();
      ctx.setLineDash([]);
      
      // Draw diamond markers for each keyframe
      sortedKfs.forEach((kf) => {
        const kfX = kf.x * scaleFactor;
        const kfY = kf.y * scaleFactor;
        
        ctx.save();
        ctx.translate(kfX, kfY);
        ctx.rotate(45 * Math.PI / 180); // Rotate 45deg to render a diamond
        
        // Highlight active keyframe in hot pink if current playhead is close to its time
        const isActive = Math.abs(time - kf.time) < 0.08;
        
        ctx.fillStyle = isActive ? '#ff4081' : '#00e5ff';
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 1.5;
        
        ctx.fillRect(-5, -5, 10, 10);
        ctx.strokeRect(-5, -5, 10, 10);
        ctx.restore();
      });
      ctx.restore();
    }
    
    if (isBroll || isWindow) {
      const transform = state.characterTransforms[state.selectedElementId] || {
        x: state.canvasWidth * 0.5,
        y: isWindow ? state.canvasHeight * 0.2 : state.canvasHeight * 0.3,
        scale: isWindow ? 0.9 : 0.8,
      };
      
      let mediaRatio = 16/9;
      const track = state.tracks.find(t => t.id === state.selectedElementId);
      if (track) {
        const activeClip = track.clips.find(c => time >= c.startTime && time < c.startTime + c.duration);
        if (activeClip) {
          if (activeClip.type === 'video') {
            const v = (videoElement && videoElement[activeClip.id]);
            if (v && v.videoWidth) {
              mediaRatio = v.videoWidth / v.videoHeight;
            }
          } else if (activeClip.type === 'image') {
            const img = loadedImages[activeClip.id];
            if (img && img.width) {
              mediaRatio = img.width / img.height;
            }
          }
        }
      }

      cx = transform.x * scaleFactor;
      cy = transform.y * scaleFactor;
      w = 640 * transform.scale * scaleFactor;
      h = (640 / mediaRatio) * transform.scale * scaleFactor;
    } else if (isCaption) {
      const charId = state.selectedElementId.replace('caption_', '');
      const block = activeBlocks.find(b => b.characterId === charId);
      const char = state.characters.find(c => c.id === charId);
      if (block && char) {
        const captionTransform = state.characterTransforms[state.selectedElementId] || {
          x: state.canvasWidth / 2,
          y: state.canvasHeight * 0.85,
          scale: 1,
        };
        const displayCx = captionTransform.x * scaleFactor;
        const displayCy = captionTransform.y * scaleFactor;
        
        const style = {
          ...(char.textStyle || {}),
          ...(block.textStyle || {})
        };
        const wordsPerLine = style.wordsPerLine ?? 3;
        let activeText = getCaptionTextForTime(block.text, block.startTime, block.duration, time, wordsPerLine, block.words) || '';
        
        if (style.caseMode === 'uppercase') {
          activeText = activeText.toUpperCase();
        } else if (style.caseMode === 'lowercase') {
          activeText = activeText.toLowerCase();
        }

        const fontSize = Math.max(10, Math.floor((style.fontSize || 48) * captionTransform.scale * scaleFactor));
        ctx.font = `900 ${fontSize}px ${style.fontFamily || 'Impact, sans-serif'}`;
        ctx.letterSpacing = `${style.letterSpacing ?? 2}px`;
        
        const words = activeText.split(' ');
        const lines = [];
        let currentLine = '';
        const maxLineWidth = Math.max(120, state.canvasWidth * 0.75 * captionTransform.scale * scaleFactor);
        words.forEach(word => {
          const testLine = currentLine ? `${currentLine} ${word}` : word;
          if (ctx.measureText(testLine).width > maxLineWidth) {
            if (currentLine) lines.push(currentLine);
            currentLine = word;
          } else {
            currentLine = testLine;
          }
        });
        if (currentLine) lines.push(currentLine);
        const lineHeight = fontSize * (style.lineHeight || 1.4);
        const padding = fontSize * ((style.backgroundPadding ?? 10) / 36);
        let blockWidth = 0;
        lines.forEach(line => {
          const wr = ctx.measureText(line).width;
          if (wr > blockWidth) blockWidth = wr;
        });
        blockWidth = Math.max(50, blockWidth + padding * 2);
        const blockHeight = lines.length * lineHeight + padding * 2;
        
        cx = displayCx;
        cy = displayCy;
        w = blockWidth;
        h = blockHeight;
      }
    } else {
      const char = state.characters.find(c => c.id === state.selectedElementId);
      const block = activeBlocks.find(b => b.characterId === state.selectedElementId);
      if (char && block) {
        const defaultTransform = state.characterTransforms[char.id] || {
          x: state.canvasWidth / 2,
          y: state.canvasHeight * 0.65,
          scale: 1,
          rotation: 0,
        };
        const baseTransform = char.keyframingEnabled && char.keyframes?.length > 0
          ? getInterpolatedKeyframeTransform(char.keyframes, time)
          : defaultTransform;
        const animTransform = getAnimatedTransform(block, baseTransform, time);
        if (animTransform) {
          cx = animTransform.x * scaleFactor;
          cy = animTransform.y * scaleFactor;
          w = 640 * animTransform.scale * scaleFactor;
          h = 640 * animTransform.scale * scaleFactor;
        }
      }
    }
    
    if (cx !== undefined && cy !== undefined && w !== undefined && h !== undefined) {
      // Find rotation for selected element if it is a character or overlay
      let rotation = 0;
      if (!isCaption) {
        if (isBroll || isWindow) {
          const transform = state.characterTransforms[state.selectedElementId];
          if (transform) {
            rotation = transform.rotation || 0;
          }
        } else {
          const char = state.characters.find(c => c.id === state.selectedElementId);
          const block = activeBlocks.find(b => b.characterId === state.selectedElementId);
          if (char && block) {
            const defaultTransform = state.characterTransforms[char.id] || { rotation: 0 };
            const baseTransform = char.keyframingEnabled && char.keyframes?.length > 0
              ? getInterpolatedKeyframeTransform(char.keyframes, time)
              : defaultTransform;
            const animTransform = getAnimatedTransform(block, baseTransform, time);
            if (animTransform) {
              rotation = animTransform.rotation || 0;
            }
          }
        }
      }

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate((rotation * Math.PI) / 180);

      const color = transformMode === 'skew' ? '#ff9100' : '#00e5ff';
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);
      ctx.strokeRect(-w / 2, -h / 2, w, h);
      ctx.setLineDash([]);
      
      if (transformMode === 'rotate3d') {
        // Draw 3D rotation sphere / trackball gizmo
        // 1. Horizontal rotation axis line / ellipse (X-axis, controls vertical tilt rotateX)
        const isXActive = activeAxis === 'X';
        ctx.strokeStyle = isXActive ? '#ffea00' : '#00e676';
        ctx.lineWidth = isXActive ? 3.5 : 1.5;
        ctx.beginPath();
        ctx.ellipse(0, 0, w / 2, Math.max(2, (h / 2) * 0.1), 0, 0, Math.PI * 2);
        ctx.stroke();

        // 2. Vertical rotation axis line / ellipse (Y-axis, controls horizontal tilt rotateY)
        const isYActive = activeAxis === 'Y';
        ctx.strokeStyle = isYActive ? '#ffea00' : '#ff1744';
        ctx.lineWidth = isYActive ? 3.5 : 1.5;
        ctx.beginPath();
        ctx.ellipse(0, 0, Math.max(2, (w / 2) * 0.1), h / 2, 0, 0, Math.PI * 2);
        ctx.stroke();

        // 3. Outer sphere circle
        ctx.strokeStyle = '#00e5ff';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(0, 0, w / 2, 0, Math.PI * 2);
        ctx.stroke();

        // 4. Center crosshair
        ctx.strokeStyle = '#00e5ff';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(-10, 0); ctx.lineTo(10, 0);
        ctx.moveTo(0, -10); ctx.lineTo(0, 10);
        ctx.stroke();

      } else {
        // Draw rotation handle for standard mode
        if (!isCaption && transformMode !== 'skew') {
          ctx.beginPath();
          ctx.moveTo(0, -h / 2);
          ctx.lineTo(0, -h / 2 - 24);
          ctx.strokeStyle = '#00e5ff';
          ctx.lineWidth = 2;
          ctx.stroke();
          
          ctx.fillStyle = '#ff4081'; // hot pink rotation handle
          ctx.strokeStyle = 'white';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(0, -h / 2 - 24, 6, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }

        // Draw corner handles
        const handles = [
          { x: -w / 2, y: -h / 2 },
          { x: w / 2, y: -h / 2 },
          { x: -w / 2, y: h / 2 },
          { x: w / 2, y: h / 2 },
        ];
        handles.forEach(hnd => {
          ctx.fillStyle = 'white';
          ctx.strokeStyle = color;
          ctx.lineWidth = 2;
          ctx.fillRect(hnd.x - 5, hnd.y - 5, 10, 10);
          ctx.strokeRect(hnd.x - 5, hnd.y - 5, 10, 10);
        });
      }
      ctx.restore();
    }
  }
}
