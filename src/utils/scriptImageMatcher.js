// Matches image filenames against script dialogue blocks to compute
// exact on-screen timing from TTS word timings.
//
// Filename format: "<start phrase> ___ <end phrase>.png"
//   - the clip starts when the start phrase begins being spoken
//   - the clip ends when the end phrase finishes being spoken
// Files without a "___" separator use the whole name as the covered text.

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'for', 'with',
  'at', 'by', 'from', 'as', 'is', 'was', 'it', 'this', 'that', 'then', 'so',
  'we', 'you', 'they', 'he', 'she', 'i', 'his', 'her', 'their', 'our', 'my',
  'your', 'its', 'are', 'were', 'be', 'been', 'have', 'has', 'had', 'not',
  'no', 'yes', 'all', 'will', 'would', 'can', 'could', 'should', 'there',
  'what', 'when', 'who', 'how', 'which', 'into', 'over', 'under', 'after',
  'before', 'than', 'too', 'very', 'just', 'also', 'about', 'up', 'out', 'off',
  'down', 'while', 'until', 'because', 'since', 'more', 'most', 'some', 'any',
  'every', 'each', 'other', 'another', 'first', 'last', 'next',
]);

export function tokenize(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
}

export function splitImageNamePhrases(fileName) {
  const base = String(fileName || '').replace(/\.[^.]+$/, '');
  const parts = base.split(/_{3,}|-{3,}/).map(p => p.trim()).filter(Boolean);
  if (parts.length >= 2) {
    return { startPhrase: parts[0], endPhrase: parts[parts.length - 1] };
  }
  return { startPhrase: base, endPhrase: base };
}

export function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    prev = cur;
  }
  return prev[n];
}

const NUMBER_WORDS = {
  one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7',
  eight: '8', nine: '9', ten: '10', eleven: '11', twelve: '12', thirteen: '13',
  fourteen: '14', fifteen: '15', sixteen: '16', seventeen: '17', eighteen: '18',
  nineteen: '19', twenty: '20', thirty: '30', forty: '40', fifty: '50',
  hundred: '100', thousand: '1000', million: '1000000', billion: '1000000000',
};

function numericOf(w) {
  if (/^\d+$/.test(w)) return String(parseInt(w, 10));
  return NUMBER_WORDS[w] || null;
}

function wordsSimilar(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  const na = numericOf(a);
  const nb = numericOf(b);
  if (na !== null && nb !== null && na === nb) return true;
  if (a.length < 3 || b.length < 3) return false;
  if (Math.abs(a.length - b.length) > 2) return false;
  if (a.length >= 5 && b.length >= 5 && (a.startsWith(b.slice(0, 4)) || b.startsWith(a.slice(0, 4)))) return true;
  return levenshtein(a, b) <= (Math.max(a.length, b.length) >= 8 ? 2 : 1);
}

const MAX_GAP = 4; // max unmatched script words allowed between phrase words
const MAX_PHRASE_SKIPS = 2; // max phrase words allowed to be missing from script
const MIN_MATCH_FRACTION = 0.6;

function buildCorpus(blocks) {
  const corpus = [];
  (blocks || []).forEach(block => {
    const tokens = tokenize(block.text);
    tokens.forEach((text, idx) => {
      corpus.push({ text, block, wordIndexInBlock: idx, blockWordCount: tokens.length });
    });
  });
  return corpus;
}

function buildIndex(corpus) {
  const index = {};
  corpus.forEach((entry, pos) => {
    (index[entry.text] = index[entry.text] || []).push(pos);
  });
  return index;
}

// Greedy forward alignment: phrase word `anchorIdx` starts at corpus `pos`.
function alignForward(phrase, corpus, pos, anchorIdx, minPos, maxPos) {
  const positions = new Array(phrase.length).fill(-1);
  let p = pos;
  let i = anchorIdx;
  let phraseSkips = 0;
  while (i < phrase.length && p <= maxPos) {
    if (p >= minPos && wordsSimilar(corpus[p].text, phrase[i])) {
      positions[i] = p;
      i++;
      p++;
      phraseSkips = 0;
      continue;
    }
    let found = -1;
    for (let j = p + 1; j <= Math.min(p + MAX_GAP, maxPos); j++) {
      if (j >= minPos && wordsSimilar(corpus[j].text, phrase[i])) {
        found = j;
        break;
      }
    }
    if (found !== -1) {
      positions[i] = found;
      i++;
      p = found + 1;
    } else if (phraseSkips < MAX_PHRASE_SKIPS) {
      phraseSkips++;
      i++;
    } else {
      break;
    }
  }
  return positions;
}

function scoreAlignment(phrase, positions) {
  let matches = 0;
  let gapPenalty = 0;
  let last = -1;
  for (let i = 0; i < positions.length; i++) {
    const p = positions[i];
    if (p === -1) continue;
    matches++;
    if (last !== -1 && p - last > 1) gapPenalty += Math.min(p - last - 1, 3);
    last = p;
  }
  return { matches, score: matches - gapPenalty * 0.4 };
}

// Extend alignment bounds: try to attach phrase[0] just before the first matched
// word, and phrase[n-1] just after the last matched word, for precise timing.
function extendBounds(phrase, corpus, positions, minPos, maxPos) {
  const n = phrase.length;
  let firstIdx = -1;
  let lastIdx = -1;
  positions.forEach((p, i) => {
    if (p !== -1) {
      if (firstIdx === -1) firstIdx = i;
      lastIdx = i;
    }
  });
  if (firstIdx === -1) return;

  if (positions[0] === -1) {
    const anchor = positions[firstIdx];
    for (let q = Math.max(minPos, anchor - 8); q < anchor; q++) {
      if (wordsSimilar(corpus[q].text, phrase[0])) {
        positions[0] = q;
        break;
      }
    }
  }
  if (positions[n - 1] === -1) {
    const anchor = positions[lastIdx];
    for (let q = anchor + 1; q <= Math.min(maxPos, anchor + 8); q++) {
      if (wordsSimilar(corpus[q].text, phrase[n - 1])) {
        positions[n - 1] = q;
        break;
      }
    }
  }
}

function matchPhrase(phraseText, corpus, index) {
  const phrase = tokenize(phraseText);
  if (phrase.length === 0) return null;
  const n = phrase.length;
  const maxPos = corpus.length - 1;

  const anchorIdx = phrase.findIndex(w => !STOPWORDS.has(w));
  const anchor = anchorIdx === -1 ? 0 : anchorIdx;
  const candidates = new Set();

  const occ = (index[phrase[anchor]] || []).slice(0, 25);
  occ.forEach(p => candidates.add(p));
  if (anchor !== 0) {
    (index[phrase[0]] || []).slice(0, 10).forEach(p => candidates.add(p));
  }

  const preRequired = Math.max(1, Math.ceil(n * 0.4));
  let best = null;
  for (const start of candidates) {
    const positions = alignForward(phrase, corpus, start, anchor, 0, maxPos);
    const res = scoreAlignment(phrase, positions);
    if (res.matches >= preRequired && (!best || res.score > best.score)) {
      best = { ...res, positions };
    }
  }

  if (!best) return null;
  extendBounds(phrase, corpus, best.positions, 0, maxPos);
  const finalMatches = best.positions.filter(p => p !== -1).length;
  if (finalMatches < Math.max(1, Math.ceil(n * MIN_MATCH_FRACTION))) return null;
  return best;
}

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
 * Match an image filename against the script.
 * Returns { startTime, endTime, startMatched, endMatched, startPos, endPos }
 * (startPos/endPos are global corpus word indices) or null when neither the
 * start phrase nor the whole name can be matched.
 */
export function matchImageToScriptDetailed(fileName, blocks) {
  if (!blocks || blocks.length === 0) return null;
  const { startPhrase, endPhrase } = splitImageNamePhrases(fileName);
  const corpus = buildCorpus(blocks);
  if (corpus.length === 0) return null;
  const index = buildIndex(corpus);

  const startMatch = matchPhrase(startPhrase, corpus, index);
  if (!startMatch) return null;

  const firstPos = startMatch.positions.findIndex(p => p !== -1);
  const startEntry = corpus[startMatch.positions[firstPos]];
  const startTime = wordTime(startEntry, false);
  const startPos = startMatch.positions[firstPos];

  let lastIdx = -1;
  startMatch.positions.forEach((p, i) => { if (p !== -1) lastIdx = i; });

  if (endPhrase && endPhrase !== startPhrase) {
    const endMatch = matchPhrase(endPhrase, corpus, index);
    if (endMatch) {
      let endLastIdx = -1;
      endMatch.positions.forEach((p, i) => { if (p !== -1) endLastIdx = i; });
      if (endLastIdx !== -1) {
        const endPos = endMatch.positions[endLastIdx];
        const t = wordTime(corpus[endPos], true);
        if (t > startTime + 0.15) {
          return {
            startTime, endTime: t,
            startMatched: true, endMatched: true,
            startPos, endPos,
          };
        }
      }
    }
  }

  // Fall back to the end of the matched start phrase region
  const endPos = startMatch.positions[lastIdx];
  let endTime = wordTime(corpus[endPos], true);
  if (endTime <= startTime + 0.15) endTime = startTime + 1;
  return { startTime, endTime, startMatched: true, endMatched: endPhrase === startPhrase, startPos, endPos };
}

/**
 * Match an image filename against the script.
 * Returns { startTime, endTime, startMatched, endMatched } or null when
 * neither the start phrase nor the whole name can be matched.
 */
export function matchImageToScript(fileName, blocks) {
  const m = matchImageToScriptDetailed(fileName, blocks);
  if (!m) return null;
  return {
    startTime: m.startTime,
    endTime: m.endTime,
    startMatched: m.startMatched,
    endMatched: m.endMatched,
  };
}
