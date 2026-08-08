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

// ─── Numbered-prefix naming: "1-....png", "2 cat.png", "3_scene.png" ───
// Images whose filenames start with an integer + separator get PRIORITY over
// the keyword naming convention. Their number fixes the order of the images
// and each image stays on screen until the keywords of the next numbered
// image are identified (contiguous, ordered segmentation of the script).
// Filenames without a number prefix fall back to the keyword system.

export function extractImageNumber(name) {
  const base = String(name || '').replace(/\.[^.]+$/, '');
  const m = /^(\d+)(?:$|[\s._-])/.exec(base);
  return m ? parseInt(m[1], 10) : null;
}

export function stripImageNumber(name) {
  return String(name || '')
    .replace(/\.[^.]+$/, '')
    .replace(/^\d+[\s._-]+/, '')
    .trim();
}

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
 * Numbered-mode segmentation (PRIORITY).
 *
 * Every image is named "<number>-<keywords>.<ext>". Images are sorted by
 * their number and each image's keywords are matched against the script with
 * the regular keyword matcher. The image is then anchored at its matched
 * position and its duration runs until the keywords of the NEXT numbered
 * image start. The last image covers the rest of the script. This produces a
 * strictly ordered, gap-free partition of the timeline.
 */
function buildNumberedSegments(images, corpus, srcBlocks, narratorId) {
  const items = images
    .map((image, idx) => ({ image, idx, num: extractImageNumber(image.name) }))
    .sort((a, b) => a.num - b.num);

  // 1. Anchor every image where its keywords appear in the script.
  const anchors = items.map(item => {
    const keywords = stripImageNumber(item.image.name);
    if (!keywords) return null;
    const match = matchImageToScriptDetailed(keywords, srcBlocks);
    if (!match) return null;
    return { startPos: match.startPos, endTime: match.endTime, endMatched: !!match.endMatched };
  });

  // 2. Clamp start positions so the numeric order is never violated.
  let cursorPos = -1;
  anchors.forEach(anchor => {
    if (!anchor) return;
    anchor.startPos = Math.max(anchor.startPos, cursorPos + 1);
    cursorPos = anchor.startPos;
  });

  const lastCorpusIdx = corpus.length - 1;
  const lastBlockEndTime = Math.max(
    ...srcBlocks.map(b => (b.startTime || 0) + (b.duration || 0))
  );

  const segments = [];
  let prevEndTime = 0;

  items.forEach((item, k) => {
    const anchor = anchors[k];

    if (!anchor) {
      // Keywords not found: plain 5s fallback block in numeric order.
      segments.push({
        image: item.image,
        blockId: `block_img_${item.idx}`,
        match: null,
        startTime: prevEndTime,
        duration: DEFAULT_CLIP_DURATION,
        text: '',
        characterId: narratorId,
        words: [],
        scriptMatched: false,
        endMatched: false,
      });
      prevEndTime += DEFAULT_CLIP_DURATION;
      return;
    }

    // Next anchored image defines this image's end ("until the next keywords").
    let nextAnchorIdx = -1;
    for (let j = k + 1; j < items.length; j++) {
      if (anchors[j]) { nextAnchorIdx = j; break; }
    }

    const startPos = anchor.startPos;
    const endPos = nextAnchorIdx === -1 ? lastCorpusIdx : anchors[nextAnchorIdx].startPos - 1;
    const slice = corpus.slice(startPos, endPos + 1);
    if (!slice.length) {
      segments.push({
        image: item.image,
        blockId: `block_img_${item.idx}`,
        match: null,
        startTime: prevEndTime,
        duration: DEFAULT_CLIP_DURATION,
        text: '',
        characterId: narratorId,
        words: [],
        scriptMatched: false,
        endMatched: false,
      });
      prevEndTime += DEFAULT_CLIP_DURATION;
      return;
    }

    const startTime = Math.max(wordTime(corpus[startPos], false), prevEndTime);
    let endTime;
    if (nextAnchorIdx === -1) {
      // Last image: cover through the very end of the script.
      endTime = Math.max(wordTime(corpus[lastCorpusIdx], true), lastBlockEndTime);
    } else {
      endTime = wordTime(corpus[anchors[nextAnchorIdx].startPos], false);
    }
    const duration = Math.max(endTime - startTime, MIN_CLIP_DURATION);

    segments.push({
      image: item.image,
      blockId: `block_img_${item.idx}`,
      match: { startTime, endTime: startTime + duration },
      startTime,
      duration,
      text: slice.map(e => e.original).join(' ').trim() || item.image.name.replace(/\.[^.]+$/, ''),
      characterId: slice.length ? (slice[0].block.characterId || narratorId) : narratorId,
      words: slice.map(e => ({
        text: e.text,
        start: Math.max(0, wordTime(e, false) - startTime),
        end: Math.max(0.05, wordTime(e, true) - startTime),
      })),
      scriptMatched: true,
      endMatched: nextAnchorIdx === -1 ? !!anchor.endMatched : false,
    });
    prevEndTime = startTime + duration;
  });

  return segments;
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

  // 1. PRIORITY: if every image starts with a number prefix ("1-....png"),
  //    use the numbered segmentation (sorted by number, chained until the
  //    next image's keywords). Otherwise fall back to the naming convention.
  const numberedMode = images.length > 0 && images.every(img => extractImageNumber(img.name) !== null);
  let segments;
  if (numberedMode) {
    segments = buildNumberedSegments(images, corpus, srcBlocks, narratorId);
  } else {
    segments = images.map((image, idx) => {
      // Strip a leading number (e.g. "1-cat.png") before keyword matching so
      // a number prefix never pollutes the phrase in fallback mode.
      const match = matchImageToScriptDetailed(stripImageNumber(image.name), srcBlocks);
      if (match) {
        const startTime = match.startTime;
        const duration = Math.max(match.endTime - startTime, MIN_CLIP_DURATION);
        const slice = corpus.slice(match.startPos, match.endPos + 1);
        return {
          image,
          blockId: `block_img_${idx}`,
          match,
          startTime,
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
        startTime: 0,
        duration: DEFAULT_CLIP_DURATION,
        text: '',
        characterId: narratorId,
        words: [],
        scriptMatched: false,
        endMatched: false,
      };
    });
  }

  // 2. Chain the segments continuously: first image starts at 0, every next
  //    image starts exactly where the previous one ends. No blank gaps.
  const blocks = [];
  const clips = [];
  let cursor = 0;
  segments.forEach(seg => {
    const startTime = seg.startTime != null ? seg.startTime : cursor;
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
