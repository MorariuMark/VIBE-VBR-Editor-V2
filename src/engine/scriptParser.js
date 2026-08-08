/**
 * Script Parser Engine
 * 
 * Parses formatted scripts looking for **Character:** patterns,
 * extracts dialogue blocks, and manages keyword detection.
 */

// Track color palette for character assignment
const TRACK_COLORS = [
  '#7c4dff', '#00e5ff', '#ff4081', '#ffab40',
  '#00e676', '#ff6e40', '#448aff', '#69f0ae',
  '#ea80fc', '#ffd740', '#84ffff', '#ff80ab',
];

export const DEFAULT_TEXT_STYLE = {
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
  caseMode: 'uppercase', // default uppercase for typical brain rot style
  enableHighlight: true,
  highlightColor: '#ffd21e',
};

/**
 * Parse a script string into dialogue blocks.
 * Looks for patterns like **Character Name:** followed by dialogue text.
 * 
 * @param {string} scriptText - The raw script text
 * @returns {{ blocks: DialogueBlock[], characters: Character[] }}
 */
export function parseScript(scriptText) {
  if (!scriptText || !scriptText.trim()) {
    return { blocks: [], characters: [] };
  }

  // Match **Name:** or **Name**: patterns (colon inside or after the stars)
  const headerRegex = /\*\*([^*]+?)(?::\*\*|\*\*:)\s*/g;
  const headerMatches = [];
  let match;
  while ((match = headerRegex.exec(scriptText)) !== null) {
    headerMatches.push({ name: match[1].trim(), index: match.index, end: headerRegex.lastIndex });
  }

  const blocks = [];
  const characterMap = new Map();
  let colorIndex = 0;

  for (let i = 0; i < headerMatches.length; i++) {
    const header = headerMatches[i];
    const dialogueStart = header.end;
    const dialogueEnd = i + 1 < headerMatches.length ? headerMatches[i + 1].index : scriptText.length;
    const dialogueText = scriptText.substring(dialogueStart, dialogueEnd).trim();

    if (!dialogueText) continue;

    // Track unique characters
    if (!characterMap.has(header.name.toLowerCase())) {
      characterMap.set(header.name.toLowerCase(), {
        id: `char_${header.name.toLowerCase().replace(/\s+/g, '_')}`,
        name: header.name,
        color: TRACK_COLORS[colorIndex % TRACK_COLORS.length],
        asset: null, // PNG asset path
        colorIndex: colorIndex,
        textStyle: { ...DEFAULT_TEXT_STYLE },
      });
      colorIndex++;
    }

    const character = characterMap.get(header.name.toLowerCase());

    blocks.push({
      id: `block_${blocks.length}`,
      characterId: character.id,
      characterName: character.name,
      text: dialogueText,
      color: character.color,
      // Timing (to be assigned during audio sync)
      startTime: 0,
      duration: estimateDialogueDuration(dialogueText),
      // Animation settings
      animation: {
        entrance: 'slide-up',
        exit: 'slide-down',
        entranceDuration: 0.3,
        exitDuration: 0.3,
        sustain: 'none',
        sustainIntensity: 0.5,
        sustainSpeed: 0.5,
      },
    });
  }

  // If no bold format found, try simple "Name:" format
  if (blocks.length === 0) {
    const simpleRegex = /^([A-Z][A-Za-z0-9 \-']+?):\s*([\s\S]*?)(?=^[A-Z][A-Za-z0-9 \-']+?:|$)/gm;
    while ((match = simpleRegex.exec(scriptText)) !== null) {
      const characterName = match[1].trim();
      const dialogueText = match[2].trim();

      if (!dialogueText) continue;

      if (!characterMap.has(characterName.toLowerCase())) {
        characterMap.set(characterName.toLowerCase(), {
          id: `char_${characterName.toLowerCase().replace(/\s+/g, '_')}`,
          name: characterName,
          color: TRACK_COLORS[colorIndex % TRACK_COLORS.length],
          asset: null,
          colorIndex: colorIndex,
          textStyle: { ...DEFAULT_TEXT_STYLE },
        });
        colorIndex++;
      }

      const character = characterMap.get(characterName.toLowerCase());
      blocks.push({
        id: `block_${blocks.length}`,
        characterId: character.id,
        characterName: character.name,
        text: dialogueText,
        color: character.color,
        startTime: 0,
        duration: estimateDialogueDuration(dialogueText),
        animation: {
          entrance: 'slide-up',
          exit: 'slide-down',
          entranceDuration: 0.3,
          exitDuration: 0.3,
          sustain: 'none',
          sustainIntensity: 0.5,
          sustainSpeed: 0.5,
        },
      });
    }
  }

  // Auto-calculate sequential timing
  let currentTime = 0;
  for (const block of blocks) {
    block.startTime = currentTime;
    currentTime += block.duration;
  }

  const characters = Array.from(characterMap.values());

  return { blocks, characters };
}

/**
 * Estimate the spoken duration of a dialogue line based on word count.
 * Average speaking rate is about 150 words per minute.
 */
export function estimateDialogueDuration(text) {
  const wordCount = text.split(/\s+/).filter(w => w.length > 0).length;
  const wordsPerSecond = 2.5; // ~150 WPM
  const baseDuration = wordCount / wordsPerSecond;
  // Add a small pause between lines
  return Math.max(1, Math.round(baseDuration * 10) / 10) + 0.3;
}

/**
 * Detect silence segments in audio data to assist with timing assignment.
 * Returns an array of { start, end } objects representing speech segments.
 */
export function detectSilenceSegments(audioBuffer, threshold = 0.02, minSilenceDuration = 0.3) {
  const channelData = audioBuffer.getChannelData(0);
  const sampleRate = audioBuffer.sampleRate;
  const segments = [];
  
  let inSpeech = false;
  let speechStart = 0;
  let silenceStart = 0;
  
  // Use a window of ~20ms for RMS calculation
  const windowSize = Math.floor(sampleRate * 0.02);
  
  for (let i = 0; i < channelData.length; i += windowSize) {
    // Calculate RMS for this window
    let sum = 0;
    const end = Math.min(i + windowSize, channelData.length);
    for (let j = i; j < end; j++) {
      sum += channelData[j] * channelData[j];
    }
    const rms = Math.sqrt(sum / (end - i));
    const time = i / sampleRate;
    
    if (rms > threshold) {
      if (!inSpeech) {
        inSpeech = true;
        speechStart = time;
      }
    } else {
      if (inSpeech) {
        silenceStart = time;
        inSpeech = false;
      }
      // If we've been silent long enough, mark the segment
      if (!inSpeech && silenceStart > 0 && (time - silenceStart) >= minSilenceDuration) {
        if (speechStart < silenceStart) {
          segments.push({
            start: speechStart,
            end: silenceStart,
            duration: silenceStart - speechStart,
          });
          silenceStart = 0;
        }
      }
    }
  }
  
  // Handle final segment
  if (inSpeech) {
    segments.push({
      start: speechStart,
      end: channelData.length / sampleRate,
      duration: (channelData.length / sampleRate) - speechStart,
    });
  }
  
  return segments;
}

/**
 * Auto-match dialogue blocks to detected audio segments.
 * Simple sequential mapping.
 */
export function matchBlocksToSegments(blocks, segments) {
  const updatedBlocks = blocks.map((block, i) => {
    if (i < segments.length) {
      return {
        ...block,
        startTime: segments[i].start,
        duration: segments[i].duration,
      };
    }
    return block;
  });
  return updatedBlocks;
}

/**
 * Recalculate block positions after a change.
 * When a block's duration or start time changes, apply delta offset to all subsequent blocks.
 */
export function recalculateTimings(blocks, changedIndex, oldBlock) {
  const updatedBlocks = [...blocks];
  
  if (changedIndex < 0 || changedIndex >= updatedBlocks.length) return updatedBlocks;
  
  if (!oldBlock) {
    for (let i = changedIndex + 1; i < updatedBlocks.length; i++) {
      const prevBlock = updatedBlocks[i - 1];
      updatedBlocks[i] = {
        ...updatedBlocks[i],
        startTime: prevBlock.startTime + prevBlock.duration,
      };
    }
    return updatedBlocks;
  }

  const oldEndTime = oldBlock.startTime + oldBlock.duration;
  const currentBlock = updatedBlocks[changedIndex];
  const newEndTime = currentBlock.startTime + currentBlock.duration;
  const delta = newEndTime - oldEndTime;

  if (delta !== 0) {
    for (let i = changedIndex + 1; i < updatedBlocks.length; i++) {
      updatedBlocks[i] = {
        ...updatedBlocks[i],
        startTime: updatedBlocks[i].startTime + delta,
      };
    }
  }
  
  return updatedBlocks;
}

export function addCustomCharacter(existingCharacters, nameOrObj) {
  const colorIndex = existingCharacters.length;
  const isObj = nameOrObj && typeof nameOrObj === 'object';
  const name = isObj ? nameOrObj.name : nameOrObj;
  const id = isObj && nameOrObj.id ? nameOrObj.id : `char_${name.toLowerCase().replace(/\s+/g, '_')}_${Date.now()}`;
  return {
    id: id,
    name: name,
    color: TRACK_COLORS[colorIndex % TRACK_COLORS.length],
    asset: null,
    colorIndex: colorIndex,
    textStyle: { ...DEFAULT_TEXT_STYLE },
  };
}
