/**
 * Export Engine
 * 
 * Generates FFmpeg commands to composite the final video
 * from background videos, character PNGs with animations, and audio.
 */

import { alignWords } from './renderEngine';

/**
 * Generate FFmpeg filter complex for character overlay animations.
 * 
 * @param {Object} config
 * @param {string} config.backgroundVideo - Path to background video
 * @param {Array} config.blocks - Dialogue blocks with timing
 * @param {Object} config.characterAssets - Map of characterId -> asset path
 * @param {Object} config.characterTransforms - Map of characterId -> { x, y, scale }
 * @param {string} config.audioPath - Path to audio file
 * @param {string} config.outputPath - Path for output file
 * @param {Object} config.settings - Export settings { width, height, fps, codec }
 * @returns {{ args: string[] }}
 */
export function generateFFmpegCommand(config) {
  const {
    backgroundVideo,
    blocks = [],
    characterAssets = {},
    characterTransforms = {},
    audioPath,
    outputPath,
    settings = {},
  } = config;

  const width = settings.width || 1080;
  const height = settings.height || 1920;
  const fps = settings.fps || 60;
  const codec = settings.codec || 'libx264';
  const crf = settings.crf || 18;

  const args = [];
  const inputs = [];
  const filterParts = [];

  // Background setup (Input 0 if video path provided)
  if (backgroundVideo) {
    args.push('-i', backgroundVideo);
    inputs.push('bg');
    filterParts.push(
      `[0:v]scale=${width}:${height}:force_original_aspect_ratio=increase,` +
      `crop=${width}:${height},setsar=1[bg]`
    );
  } else {
    // Generate solid black/dark theme background
    const lastBlock = blocks[blocks.length - 1];
    const duration = lastBlock ? Math.max(30, (lastBlock.startTime || 0) + (lastBlock.duration || 0) + 2) : 30;
    filterParts.push(
      `color=c=0x0a0a0f:s=${width}x${height}:d=${duration}[bg]`
    );
  }

  // Add character image inputs
  const usedCharacters = new Map();
  blocks.forEach((block) => {
    if (block && block.characterId && !usedCharacters.has(block.characterId) && characterAssets[block.characterId]) {
      const inputIndex = inputs.length; // Index in the inputs array
      args.push('-i', characterAssets[block.characterId]);
      usedCharacters.set(block.characterId, inputIndex);
      inputs.push(`char_${block.characterId}`);
    }
  });

  // Build overlay chain
  let currentBase = 'bg';
  let overlayIndex = 0;

  blocks.forEach((block) => {
    if (!block || !block.characterId) return;
    const inputIndex = usedCharacters.get(block.characterId);
    if (inputIndex === undefined) return;

    const transform = characterTransforms[block.characterId] || { x: width / 2, y: height * 0.65, scale: 1 };
    const startTime = block.startTime || 0;
    const endTime = (block.startTime || 0) + (block.duration || 0);
    const outputLabel = `ov${overlayIndex}`;

    // Scale the character PNG (640 logical pixels base)
    const charScale = Math.round(640 * (transform.scale || 1));

    // Calculate overlay position (center the character)
    const overlayX = Math.round((transform.x || width / 2) - charScale / 2);
    const overlayY = Math.round((transform.y || height * 0.65) - charScale / 2);

    const scaledLabel = `scaled${overlayIndex}`;
    
    filterParts.push(
      `[${inputIndex}:v]scale=${charScale}:${charScale}:flags=lanczos,` +
      `format=rgba[${scaledLabel}]`
    );

    // Overlay with enable/disable based on timing
    filterParts.push(
      `[${currentBase}][${scaledLabel}]overlay=x=${overlayX}:y=${overlayY}:` +
      `enable='between(t,${startTime.toFixed(2)},${endTime.toFixed(2)})'` +
      `[${outputLabel}]`
    );

    currentBase = outputLabel;
    overlayIndex++;
  });

  // ── Subtitles / Captions (top layer) ──
  blocks.forEach((block) => {
    if (!block || !block.text) return;
    const scriptWords = block.text.split(/\s+/).filter(w => w.length > 0);
    if (scriptWords.length === 0) return;

    const wordsPerLine = Math.max(1, parseInt(block.textStyle?.wordsPerLine ?? 3, 10) || 3);

    const chunks = [];
    if (block.words && block.words.length > 0) {
      // Word-accurate chunking: same alignment as the preview so the exported
      // captions stay in sync with the voiceover. Text always comes from the
      // script, never from the transcription.
      const alignedWords = alignWords(scriptWords, block.words);
      for (let i = 0; i < alignedWords.length; i += wordsPerLine) {
        const chunkWords = alignedWords.slice(i, i + wordsPerLine);
        const chunkStart = block.startTime + Math.max(0, chunkWords[0].start ?? 0);
        const chunkEnd = block.startTime + Math.max(
          Math.max(0, chunkWords[0].start ?? 0) + 0.12,
          chunkWords[chunkWords.length - 1].end ?? 0
        );
        if (chunkEnd <= chunkStart) continue;
        chunks.push({
          text: chunkWords.map(w => w.text).join(' '),
          start: chunkStart,
          end: chunkEnd,
        });
      }
    } else {
      // No voiceover timings yet: uniform split of the estimated duration.
      const numChunks = Math.ceil(scriptWords.length / wordsPerLine);
      const blockDuration = Math.max(0.1, block.duration || 0);
      const chunkDuration = blockDuration / numChunks;
      for (let i = 0; i < scriptWords.length; i += wordsPerLine) {
        const chunkIndex = i / wordsPerLine;
        chunks.push({
          text: scriptWords.slice(i, i + wordsPerLine).join(' '),
          start: (block.startTime || 0) + chunkIndex * chunkDuration,
          end: (block.startTime || 0) + (chunkIndex + 1) * chunkDuration,
        });
      }
    }

    chunks.forEach((chunk) => {
      const escapedText = escapeFFmpegText(chunk.text);
      const captionKey = `caption_${block.characterId}`;
      const transform = characterTransforms[captionKey] || {
        x: width / 2,
        y: height * 0.85,
        scale: 1
      };
      
      const fontSize = Math.round(36 * (transform.scale || 1));
      const outputLabel = `txt${overlayIndex}`;
      
      filterParts.push(
        `[${currentBase}]drawtext=text='${escapedText}':x=${transform.x}-tw/2:y=${transform.y}-th/2:` +
        `fontsize=${fontSize}:fontcolor=white:box=1:boxcolor=black@0.7:boxborderw=${Math.round(fontSize * 0.6)}:` +
        `enable='between(t,${chunk.start.toFixed(2)},${chunk.end.toFixed(2)})'[${outputLabel}]`
      );
      
      currentBase = outputLabel;
      overlayIndex++;
    });
  });

  // Audio input
  if (audioPath) {
    args.push('-i', audioPath);
  }

  // Build the full filter complex
  const filterComplex = filterParts.join(';\n');
  
  // Construct final args
  const finalArgs = [
    '-y', // Overwrite
    ...args,
    '-filter_complex', filterComplex,
    '-map', `[${currentBase}]`,
  ];

  if (audioPath) {
    const audioIndex = inputs.length; // The audio is the last input
    finalArgs.push('-map', `${audioIndex}:a`);
  } else if (backgroundVideo) {
    finalArgs.push('-map', '0:a?');
  }

  // Calculate script duration (add a 1.5s cushion to prevent cutoff of the last word)
  const lastBlock = blocks[blocks.length - 1];
  const scriptDuration = lastBlock ? ((lastBlock.startTime || 0) + (lastBlock.duration || 0) + 1.5) : 30;

  finalArgs.push(
    '-c:v', codec,
    '-preset', 'medium',
    '-crf', String(crf),
    '-r', String(fps),
    '-s', `${width}x${height}`,
    '-c:a', 'aac',
    '-b:a', '192k',
    '-t', scriptDuration.toFixed(2), // Limit video duration to script length
    '-shortest',
    outputPath
  );

  return { args: finalArgs };
}

function escapeFFmpegText(text) {
  if (!text) return '';
  return text
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "'\\''")
    .replace(/:/g, '\\:')
    .replace(/%/g, '\\%')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/;/g, '\\;')
    .replace(/=/g, '\\=')
    .replace(/\n/g, ' ');
}


/**
 * Export settings presets
 */
export const EXPORT_PRESETS = {
  'tiktok-vertical': {
    name: 'TikTok / Reels (Vertical)',
    width: 1080,
    height: 1920,
    fps: 60,
    codec: 'libx264',
    crf: 18,
  },
  'youtube-shorts': {
    name: 'YouTube Shorts',
    width: 1080,
    height: 1920,
    fps: 60,
    codec: 'libx264',
    crf: 18,
  },
  'youtube-landscape': {
    name: 'YouTube (Landscape)',
    width: 1920,
    height: 1080,
    fps: 60,
    codec: 'libx264',
    crf: 18,
  },
  'instagram-square': {
    name: 'Instagram (Square)',
    width: 1080,
    height: 1080,
    fps: 30,
    codec: 'libx264',
    crf: 18,
  },
};
