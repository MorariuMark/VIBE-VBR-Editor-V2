/**
 * Caption ↔ image sync engine (long-form).
 *
 * After a voiceover is applied, its caption word stream (Whisper-style
 * [{text,start,end}]) is the ground truth for when every word is actually
 * spoken. Image blocks are named "<index> <whole phrase from the script>.png"
 * and each image must stay on screen exactly while ITS phrase is being
 * spoken. This engine:
 *
 *   1. Verifies the captions against the image names: the whole script
 *      corpus is DP-aligned against the caption stream (tolerating ASR
 *      errors, mispronunciations and skipped words).
 *   2. Anchors every image phrase in the script (fuzzy, strictly ordered by
 *      its numeric index) and slices the timeline so an image covers
 *      [its phrase start, the next image's phrase start).
 *   3. Re-derives block startTime/duration/words from the caption
 *      timestamps, so image switching and caption highlighting are exact.
 *
 * The captions displayed are the words the STT model actually heard, not
 * the script text: every matched block's text/words come from the caption
 * stream, so on-screen captions always match the spoken voiceover.
 *
 * Guardrails: phrases that cannot be matched get a fixed 5s fallback in
 * numeric order; no caption words → blocks untouched; timings are clamped
 * forward-only so images never overlap or rewind; every block keeps a
 * minimum duration.
 */

import { tokenize, matchPhrase, buildIndex, wordsSimilar } from '../utils/scriptImageMatcher';
import { alignWords } from './renderEngine';
import { extractImageNumber, stripImageNumber } from './longFormParser';

const MIN_CLIP_DURATION = 0.5;
const FALLBACK_DURATION = 5;

/**
 * @param {Array} blocks Dialogue blocks (script order; image blocks carry
 *   imageName/imageId). Blocks without an image are left untouched.
 * @param {Array} mergedWords Caption stream [{text,start,end}] for the whole
 *   continuous narration (times relative to the narration audio start).
 * @param {number} [anchorTime] Timeline time where the narration audio starts.
 * @returns {Array} New blocks (same input reference when nothing changes).
 */
export function syncImageBlocksToCaptions(blocks, mergedWords, anchorTime = null) {
  if (!Array.isArray(blocks) || blocks.length === 0) return blocks;
  if (!Array.isArray(mergedWords) || mergedWords.length === 0) return blocks;

  const imageBlocks = blocks.filter(b => b.imageName);
  if (imageBlocks.length === 0) return blocks;

  // 1. Flat script corpus from the image-name phrases (not the previous
  //    block text, which may already be STT-derived): the phrase is the
  //    stable identity of what each image is supposed to show.
  const corpus = [];
  imageBlocks.forEach((block) => {
    const phrase = stripImageNumber(block.imageName) || block.text || '';
    const tokens = tokenize(phrase);
    const originals = phrase.split(/\s+/).filter(Boolean);
    tokens.forEach((text, idx) => {
      corpus.push({ text, original: originals[idx] || text, blockId: block.id });
    });
  });
  if (corpus.length === 0) return blocks;

  // 2. Verify captions: align every script word to a caption timestamp.
  //    The DP alignment absorbs ASR mispronunciations, insertions and
  //    deletions, so differing words never break the sync.
  const aligned = alignWords(corpus.map(e => e.text), mergedWords);
  if (!aligned || aligned.length !== corpus.length) return blocks;

  // 3. Ordered images (numeric index priority; unnumbered → last, keep order).
  const indexed = imageBlocks.map((block) => ({
    block,
    num: extractImageNumber(block.imageName) ?? Infinity,
    phrase: stripImageNumber(block.imageName) || block.text || '',
  })).sort((a, b) => a.num - b.num);

  const lastCorpusIdx = corpus.length - 1;

  // Map each aligned corpus position to the STT word actually heard there
  // (aligned positions copy the whisper timestamps verbatim, so matching by
  // start time recovers the spoken text — captions come from the voiceover,
  // not the script).
  const sttByStart = new Map();
  mergedWords.forEach((w, idx) => {
    const key = typeof w.start === 'number' ? w.start : `i${idx}`;
    if (!sttByStart.has(key)) sttByStart.set(key, w);
  });
  const sttTextAt = (alignedEntry) => {
    const key = typeof alignedEntry.start === 'number' ? alignedEntry.start : null;
    const w = key != null ? sttByStart.get(key) : undefined;
    return w && typeof w.text === 'string' && w.text.trim() ? w.text.trim() : (alignedEntry.text || '');
  };

  // Guardrail: an image phrase must actually be HEARD in the caption stream.
  // Without this, a phrase that was never spoken still trivially "matches"
  // its own corpus words, and the DP alignment then ties it to unrelated
  // STT timestamps (wrong captions, wrong image switch point).
  const verifyPhrase = (startPos, endPos) => {
    let similar = 0;
    let total = 0;
    for (let p = startPos; p <= Math.min(endPos, lastCorpusIdx); p++) {
      total++;
      const stt = sttTextAt(aligned[p]);
      const sttTok = tokenize(stt)[0] || '';
      const phTok = corpus[p].text || '';
      if (!sttTok || !phTok || wordsSimilar(phTok, sttTok)) similar++;
    }
    return total > 0 && similar / total >= 0.6;
  };

  // 4. Anchor each phrase sequentially: strictly ordered, never backwards.
  //    `startPositions` holds VERIFIED anchors (the phrase was heard); a
  //    phrase that self-matches without being in the caption stream is
  //    rejected there and becomes a fallback. `allAnchors` additionally
  //    records every raw anchor so a verified phrase's span still ends
  //    exactly where the next image's phrase begins.
  const index = buildIndex(corpus);
  const startPositions = new Map(); // blockId -> verified global corpus pos
  const allAnchors = new Map();     // blockId -> raw anchor pos
  let cursor = 0;
  indexed.forEach(item => {
    if (!item.phrase) return;
    const m = matchPhrase(item.phrase, corpus, index, cursor);
    if (!m) return;
    const firstIdx = m.positions.findIndex(p => p !== -1);
    if (firstIdx === -1) return;
    const startPos = m.positions[firstIdx];
    if (startPos < cursor) return;
    allAnchors.set(item.block.id, startPos);
    // The phrase must be present in the caption stream, or the anchor is
    // garbage (self-match of a phrase that was never spoken).
    const phraseLen = tokenize(item.phrase).length;
    if (verifyPhrase(startPos, startPos + phraseLen - 1)) {
      startPositions.set(item.block.id, startPos);
      cursor = startPos + 1;
    }
  });

  // 5. Slice the timeline. Each matched image covers [its phrase start, the
  //    next matched image's phrase start). Unmatched images get a 5s
  //    fallback in numeric order; timings are clamped forward-only so the
  //    chain never overlaps or rewinds.
  const base = anchorTime != null ? anchorTime : (blocks[0].startTime || 0);
  const synced = new Map(); // blockId -> block overrides
  let prevEnd = 0;
  let changed = false;

  indexed.forEach((item, k) => {
    const startPos = startPositions.get(item.block.id);
    if (startPos === undefined) {
      synced.set(item.block.id, {
        startTime: prevEnd,
        duration: FALLBACK_DURATION,
        words: [],
        text: (stripImageNumber(item.block.imageName) || item.block.text || 'Image').trim(),
        scriptMatched: false,
        endMatched: false,
      });
      prevEnd += FALLBACK_DURATION;
      return;
    }

    let nextStartPos = -1;
    for (let j = k + 1; j < indexed.length; j++) {
      const sp = allAnchors.get(indexed[j].block.id);
      if (sp !== undefined) { nextStartPos = sp; break; }
    }
    const endPos = Math.max(startPos, Math.min(nextStartPos === -1 ? lastCorpusIdx : nextStartPos - 1, lastCorpusIdx));
    const slice = corpus.slice(startPos, endPos + 1);
    if (slice.length === 0) {
      synced.set(item.block.id, {
        startTime: prevEnd,
        duration: FALLBACK_DURATION,
        words: [],
        text: (stripImageNumber(item.block.imageName) || item.block.text || 'Image').trim(),
        scriptMatched: false,
        endMatched: false,
      });
      prevEnd += FALLBACK_DURATION;
      return;
    }

    const sliceStart = Math.max(0, aligned[startPos].start);
    const sliceEnd = Math.max(sliceStart + MIN_CLIP_DURATION, aligned[endPos].end);
    const startTime = Math.max(base + sliceStart, prevEnd);
    const duration = Math.max(sliceEnd - sliceStart, MIN_CLIP_DURATION);
    prevEnd = startTime + duration;

    const words = slice.map((e, i) => {
      const a = aligned[startPos + i];
      return {
        text: sttTextAt(a),
        start: Math.max(0, a.start - sliceStart),
        end: Math.max(0.05, a.end - sliceStart),
      };
    });
    const text = words.map(w => w.text).join(' ').trim() || slice.map(e => e.original).join(' ').trim() || item.block.text || 'Image';

    const block = item.block;
    const prevWords = block.words || [];
    const wordsChanged =
      prevWords.length !== words.length ||
      words.some((w, i) => prevWords[i] && (Math.abs(prevWords[i].start - w.start) > 0.01 || Math.abs(prevWords[i].end - w.end) > 0.01));
    if (
      block.startTime !== startTime ||
      block.duration !== duration ||
      block.text !== text ||
      block.scriptMatched !== true ||
      block.endMatched !== (nextStartPos === -1) ||
      wordsChanged
    ) {
      changed = true;
    }

    synced.set(item.block.id, {
      startTime,
      duration,
      words,
      text,
      scriptMatched: true,
      endMatched: nextStartPos === -1,
    });
  });

  if (!changed) {
    // Fallbacks also count as changes when the previous layout differed.
    let fallbackChanged = false;
    indexed.forEach(item => {
      const s = synced.get(item.block.id);
      const b = item.block;
      if (!s) return;
      if (s.scriptMatched === false && (b.scriptMatched !== false || b.duration !== s.duration)) fallbackChanged = true;
    });
    if (!fallbackChanged) return blocks;
  }

  // 6. Rebuild the block list: synced image blocks in place, other blocks
  //    (pure dialogue, no image) untouched.
  return blocks.map((block) => {
    const override = synced.get(block.id);
    if (!override) return block;
    return {
      ...block,
      startTime: override.startTime,
      duration: override.duration,
      words: override.words,
      text: override.text,
      scriptMatched: override.scriptMatched,
      endMatched: override.endMatched,
    };
  });
}