/**
 * bgmSynth.js — Offline BGM synthesizer (OfflineAudioContext → WAV ArrayBuffer)
 * Không cần file mp3 bên ngoài. Render offline, không phát ra loa.
 */

const BGM_TRACKS = [
  { id: 'epic-cinematic',    bpm: 85,  beatDur: 0.705, mood: ['epic','cinematic','grand','powerful'],
    chords: [[146.83,220,293.66,370],[164.81,246.94,329.63,392],[130.81,196,261.63,329.63],[110,164.81,220,261.63]] },
  { id: 'lofi-chill',        bpm: 72,  beatDur: 0.833, mood: ['lofi','calm','emotional','inspiring','relax'],
    chords: [[174.61,220,261.63,329.63],[146.83,174.61,220,261.63],[130.81,164.81,196,246.94],[110,130.81,164.81,196]] },
  { id: 'cyber-synthwave',   bpm: 115, beatDur: 0.521, mood: ['corporate','tech','mysterious','electronic'],
    chords: [[130.81,196,246.94,329.63],[110,164.81,220,261.63],[98,146.83,196,246.94],[87.31,130.81,174.61,220]] },
  { id: 'dramatic-suspense', bpm: 90,  beatDur: 0.666, mood: ['dramatic','suspense','dark','tension'],
    chords: [[110,130.81,164.81,220],[103.83,123.47,155.56,207.65],[98,123.47,146.83,196],[92.5,116.54,138.59,185]] },
  { id: 'upbeat-energy',     bpm: 128, beatDur: 0.468, mood: ['upbeat','energetic','fun','viral'],
    chords: [[196,246.94,293.66,370],[164.81,220,261.63,329.63],[130.81,164.81,196,246.94],[146.83,196,246.94,293.66]] },
];

export function moodToTrack(mood = 'cinematic') {
  const m = mood.toLowerCase();
  return BGM_TRACKS.find(t => t.mood.some(k => m.includes(k))) || BGM_TRACKS[0];
}

export { BGM_TRACKS };

/**
 * Render BGM track offline → returns WAV ArrayBuffer
 * @param {string} trackId  — BGM track id hoặc mood string
 * @param {number} durationSec — độ dài cần render (giây)
 * @param {number} masterVol — volume 0..1 (default 0.35)
 */
export async function synthesizeBgmToWav(trackId, durationSec = 30, masterVol = 0.35) {
  const track = BGM_TRACKS.find(t => t.id === trackId) || moodToTrack(trackId);
  const SR = 44100;
  const totalSec = durationSec + 1; // +1s để fade out
  const ctx = new OfflineAudioContext(2, Math.ceil(SR * totalSec), SR);

  const masterGain = ctx.createGain();
  masterGain.gain.setValueAtTime(masterVol, 0);
  // Fade out cuối
  masterGain.gain.setValueAtTime(masterVol, durationSec - 1.5);
  masterGain.gain.linearRampToValueAtTime(0, durationSec);
  masterGain.connect(ctx.destination);

  const { chords, beatDur } = track;

  const scheduleChord = (freqs, startTime) => {
    freqs.forEach(freq => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, startTime);
      g.gain.setValueAtTime(0.01, startTime);
      g.gain.linearRampToValueAtTime(0.045, startTime + 1.2);
      g.gain.linearRampToValueAtTime(0.0001, Math.min(startTime + beatDur * 4, totalSec));
      osc.connect(g); g.connect(masterGain);
      osc.start(startTime);
      osc.stop(Math.min(startTime + beatDur * 4 + 0.1, totalSec));
    });
  };

  const scheduleArp = (freq, startTime) => {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, startTime);
    g.gain.setValueAtTime(0.05, startTime);
    g.gain.exponentialRampToValueAtTime(0.0001, startTime + beatDur * 0.8);
    osc.connect(g); g.connect(masterGain);
    osc.start(startTime);
    osc.stop(Math.min(startTime + beatDur * 0.8, totalSec));
  };

  const scheduleKick = (startTime) => {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(80, startTime);
    osc.frequency.exponentialRampToValueAtTime(40, startTime + 0.15);
    g.gain.setValueAtTime(0.25, startTime);
    g.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.3);
    osc.connect(g); g.connect(masterGain);
    osc.start(startTime);
    osc.stop(Math.min(startTime + 0.31, totalSec));
  };

  // Schedule initial chord pad
  scheduleChord(chords[0], 0.05);

  let step = 0;
  let t = beatDur; // start after initial chord
  while (t < durationSec) {
    const chordIdx = Math.floor(step / 4) % chords.length;
    const chord = chords[chordIdx];
    const arpFreq = chord[step % chord.length] * 2;
    scheduleArp(arpFreq, t);

    if (step % 4 === 0) {
      scheduleKick(t);
      const nextChordIdx = (Math.floor((step + 4) / 4)) % chords.length;
      scheduleChord(chords[nextChordIdx], t);
    }
    step++;
    t += beatDur;
  }

  const renderedBuffer = await ctx.startRendering();
  return audioBufferToWav(renderedBuffer);
}

/** AudioBuffer → WAV ArrayBuffer (PCM 16-bit stereo) */
function audioBufferToWav(buffer) {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const numSamples = buffer.length;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * bitsPerSample / 8;
  const blockAlign = numChannels * bitsPerSample / 8;
  const dataSize = numSamples * blockAlign;

  const ab = new ArrayBuffer(44 + dataSize);
  const view = new DataView(ab);

  const writeStr = (offset, str) => { for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i)); };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const channelData = buffer.getChannelData(ch < buffer.numberOfChannels ? ch : 0);
      const sample = Math.max(-1, Math.min(1, channelData[i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
      offset += 2;
    }
  }
  return ab;
}
