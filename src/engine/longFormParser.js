/**
 * Long-form video automation parser.
 *
 * Builds a full timeline (dialogue blocks + image clips) from a raw script
 * text and an ordered list of images. Each image is matched to the script
 * with the naming convention ("<start phrase> ___ <end phrase>.png"),
 * and becomes one dialogue block covering exactly the spoken words of its
 * span. Images that cannot be matched are appended sequentially as 5s clips.
 */

import { parseScript, estimateDialogueDuration } from './scriptParser';
import { matchImageToScriptDetailed, tokenize } from '../utils/scriptImageMatcher';
import { uid } from '../utils/fileHelpers';

const DEFAULT_CLIP_DURATION = 5;
const MIN_CLIP_DURATION = 0.5;

// Mirrors the corpus used by the image matcher, but keeps the original-case
// words so block text can be sliced without losing capitalization.
function buildCorpus(blocks) {
  const corpus = [];
  blocks.forEach(block => {
    const tokens = tokenize(block.text);
    const originals = String(block.text || '').split(/\s+/).filter(Boolean);
    tokens.forEach((text, idx) => {
      corpus.push({
        text,
        original: originals[idx] || text,
        block,
        wordIndexInBlock: idx,
        blockWordCount: tokens.length,
      });
    });
  });
  return corpus;
}

// Same timing model as scriptImageMatcher.wordTime: TTS word times when
// available, otherwise a uniform estimate across the source block.
function wordTime(entry, useEnd) {
  const { block, wordIndexInBlock, blockWordCount } = entry;
  const words = block.words;
  if (words && words.length > wordIndexInBlock && words[wordIndexInBlock]) {
    const w = words[wordIndexInBlock];
    return block.startTime + (useEnd ? (w.end ?? w.start) : (w.start ?? 0));
  }
  const frac = wordIndexInBlock / Math.max(1, blockWordCount);
  const fracEnd = (wordIndexInBlock + 1) / Math.max(1, blockWordCount);
  return block.startTime + (useEnd ? fracEnd : frac) * block.duration;
}

/**
 * @param {string} scriptText Raw script text with **Name:** headers
 * @param {Array} images Media items: [{ id, name, path, dataUrl }]
 * @returns {{ blocks: Array, characters: Array, clips: Array }}
 */
export function buildLongFormTimeline(scriptText, images) {
  const parsed = parseScript(scriptText || '');
  let srcBlocks = parsed.blocks || [];
  let characters = parsed.characters || [];

  if (!images || !images.length) {
    return { blocks: [], characters, clips: [] };
  }

  // Scripts without **Name:** headers (plain narration) are treated as one
  // implicit Narrator section; the image naming convention then slices it.
  if (!srcBlocks.length && (scriptText || '').trim()) {
    const narratorText = scriptText.trim();
    srcBlocks = [{
      id: 'block_narrator',
      characterId: 'char_narrator',
      characterName: 'Narrator',
      text: narratorText,
      startTime: 0,
      duration: estimateDialogueDuration(narratorText),
    }];
    characters = [{ id: 'char_narrator', name: 'Narrator', color: '#ffd21e' }];
  }

  if (!srcBlocks.length) {
    return { blocks: [], characters, clips: [] };
  }

  if (!characters.length) {
    characters = [{ id: 'char_narrator', name: 'Narrator', color: '#ffd21e' }];
  }
  const narratorId = characters[0].id;

  const corpus = buildCorpus(srcBlocks);
  if (corpus.length === 0) return { blocks: [], characters, clips: [] };

  // 1. Match every image to the script (naming convention) and measure its
  //    script span. Unmatched images become 5s fallback segments.
  const segments = images.map((image, idx) => {
    const match = matchImageToScriptDetailed(image.name, srcBlocks);
    if (match) {
      const startTime = match.startTime;
      const duration = Math.max(match.endTime - startTime, MIN_CLIP_DURATION);
      const slice = corpus.slice(match.startPos, match.endPos + 1);
      return {
        image,
        blockId: `block_img_${idx}`,
        match,
        duration,
        text: slice.map(e => e.original).join(' ').trim() || image.name.replace(/\.[^.]+$/, ''),
        characterId: slice.length ? (slice[0].block.characterId || narratorId) : narratorId,
        words: slice.map(e => ({
          text: e.text,
          start: Math.max(0, wordTime(e, false) - startTime),
          end: Math.max(0.05, wordTime(e, true) - startTime),
        })),
        scriptMatched: true,
        endMatched: !!match.endMatched,
      };
    }
    return {
      image,
      blockId: `block_img_${idx}`,
      match: null,
      duration: DEFAULT_CLIP_DURATION,
      text: '',
      characterId: narratorId,
      words: [],
      scriptMatched: false,
      endMatched: false,
    };
  });

  // 2. Chain the segments continuously: first image starts at 0, every next
  //    image starts exactly where the previous one ends. No blank gaps.
  const blocks = [];
  const clips = [];
  let cursor = 0;
  segments.forEach(seg => {
    const startTime = cursor;
    const duration = seg.duration;
    blocks.push({
      id: seg.blockId,
      characterId: seg.characterId,
      text: seg.text,
      startTime,
      duration,
      words: seg.words,
      animation: {},
      imageId: seg.image.id,
      imageName: seg.image.name,
      scriptMatched: seg.scriptMatched,
      endMatched: seg.endMatched,
    });
    clips.push({
      id: `clip_img_${Date.now()}_${uid()}`,
      name: seg.image.name,
      startTime,
      duration,
      color: '#444466',
      path: seg.image.path,
      dataUrl: seg.image.dataUrl,
      type: 'image',
      blockId: seg.blockId,
      mediaId: seg.image.id,
    });
    cursor += duration;
  });

  return { blocks, characters, clips };
}
