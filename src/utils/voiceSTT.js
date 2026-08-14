/**
 * Voiceover STT helpers: run local Whisper transcription on an applied
 * voiceover clip so captions are always generated from the audio actually
 * on the timeline and properly synced.
 */

export function hasVoiceWords(words) {
  return Array.isArray(words) && words.length > 0;
}

export async function transcribeAudioFile(wavPath) {
  if (!wavPath) return null;
  try {
    const res = await fetch('http://127.0.0.1:5555/transcribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wav_path: wavPath }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || !data.success) return null;
    return { words: data.words || [], duration: data.duration || 0 };
  } catch (err) {
    console.error('STT transcription failed:', err);
    return null;
  }
}