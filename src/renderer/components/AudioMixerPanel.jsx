/**
 * AudioMixerPanel — BGM + SFX synthesizer panel cho Fluxy preview
 * Tổng hợp âm thanh 100% bằng Web Audio API, không cần file mp3/wav.
 */
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Music2, Zap, Volume2, VolumeX, Square, Play, ChevronDown, ChevronUp } from 'lucide-react';

// ─── BGM Track Definitions ────────────────────────────────────────────────────
const BGM_TRACKS = [
  { id: 'epic-cinematic', name: 'Epic Cinematic', mood: 'epic', bpm: 85,
    badge: '🎼 85 BPM', desc: 'Giao hưởng hùng tráng — TVC & Trailer',
    color: 'amber', chords: [[146.83,220,293.66,370],[164.81,246.94,329.63,392],[130.81,196,261.63,329.63],[110,164.81,220,261.63]], beatDur: 0.705 },
  { id: 'lofi-chill', name: 'Lo-Fi Chill', mood: 'lofi', bpm: 72,
    badge: '🎹 72 BPM', desc: 'Rhodes êm dịu — Thuyết minh & Tóm tắt',
    color: 'blue', chords: [[174.61,220,261.63,329.63],[146.83,174.61,220,261.63],[130.81,164.81,196,246.94],[110,130.81,164.81,196]], beatDur: 0.833 },
  { id: 'cyber-synthwave', name: 'Cyberpunk Synth', mood: 'cyber', bpm: 115,
    badge: '⚡ 115 BPM', desc: 'Synthwave neon — Công nghệ & Sci-Fi',
    color: 'cyan', chords: [[130.81,196,246.94,329.63],[110,164.81,220,261.63],[98,146.83,196,246.94],[87.31,130.81,174.61,220]], beatDur: 0.521 },
  { id: 'dramatic-suspense', name: 'Dramatic Suspense', mood: 'dramatic', bpm: 90,
    badge: '🎭 90 BPM', desc: 'Nhịp kịch tính — Phim tài liệu & Trinh thám',
    color: 'red', chords: [[110,130.81,164.81,220],[103.83,123.47,155.56,207.65],[98,123.47,146.83,196],[92.5,116.54,138.59,185]], beatDur: 0.666 },
  { id: 'upbeat-energy', name: 'Viral Upbeat', mood: 'upbeat', bpm: 128,
    badge: '🔥 128 BPM', desc: 'Năng lượng dồn dập — TikTok & Shorts',
    color: 'violet', chords: [[196,246.94,293.66,370],[164.81,220,261.63,329.63],[130.81,164.81,196,246.94],[146.83,196,246.94,293.66]], beatDur: 0.468 },
];

const SFX_LIST = [
  { id: 'whoosh',      label: 'Whoosh',     icon: '💨', desc: 'Chuyển cảnh' },
  { id: 'impact-bass', label: 'Bass Drop',  icon: '💥', desc: 'Drop kịch tính' },
  { id: 'riser',       label: 'Riser',      icon: '🚀', desc: 'Tăng căng thẳng' },
  { id: 'ambient',     label: 'Ambient',    icon: '🌊', desc: 'Tiếng nền nhẹ' },
];

const COLOR_MAP = {
  amber:  { bg: 'bg-amber-500/20',  border: 'border-amber-500/60',  text: 'text-amber-300',  ring: 'ring-amber-500/40' },
  blue:   { bg: 'bg-blue-500/20',   border: 'border-blue-500/60',   text: 'text-blue-300',   ring: 'ring-blue-500/40' },
  cyan:   { bg: 'bg-cyan-500/20',   border: 'border-cyan-500/60',   text: 'text-cyan-300',   ring: 'ring-cyan-500/40' },
  red:    { bg: 'bg-red-500/20',    border: 'border-red-500/60',    text: 'text-red-300',    ring: 'ring-red-500/40' },
  violet: { bg: 'bg-violet-500/20', border: 'border-violet-500/60', text: 'text-violet-300', ring: 'ring-violet-500/40' },
};

// ─── Web Audio Synth Engine ───────────────────────────────────────────────────
class AudioEngine {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.bgmIntervalId = null;
    this.bgmNodes = [];
    this.isPlaying = false;
    this.bgmStep = 0;
    this.currentTrack = null;
  }

  _init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.setValueAtTime(0.35, this.ctx.currentTime);
    this.masterGain.connect(this.ctx.destination);
  }

  setVolume(vol) {
    if (!this.masterGain || !this.ctx) return;
    this.masterGain.gain.setValueAtTime(Math.max(0, Math.min(1, vol)), this.ctx.currentTime);
  }

  _playNote(freq, duration, type = 'sine', gain = 0.06) {
    if (!this.ctx || !this.masterGain) return;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
    g.gain.setValueAtTime(gain, this.ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + duration);
    osc.connect(g); g.connect(this.masterGain);
    osc.start(); osc.stop(this.ctx.currentTime + duration);
    this.bgmNodes.push(osc, g);
  }

  _playChord(freqs) {
    if (!this.ctx || !this.masterGain) return;
    freqs.forEach(f => {
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f, this.ctx.currentTime);
      g.gain.setValueAtTime(0.01, this.ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.05, this.ctx.currentTime + 1.2);
      osc.connect(g); g.connect(this.masterGain);
      osc.start();
      this.bgmNodes.push(osc, g);
    });
  }

  startBgm(track) {
    this._init();
    if (!this.ctx) return;
    this.stopBgm();
    this.isPlaying = true;
    this.currentTrack = track;
    this.bgmStep = 0;

    const chords = track.chords;
    const beatDur = track.beatDur;

    // Initial chord pad
    this._playChord(chords[0]);

    this.bgmIntervalId = setInterval(() => {
      if (!this.isPlaying) return;
      const chordIdx = Math.floor(this.bgmStep / 4) % chords.length;
      const chord = chords[chordIdx];
      const arpFreq = chord[this.bgmStep % chord.length] * 2;

      // Arpeggio melody ping
      this._playNote(arpFreq, beatDur * 0.8, 'triangle', 0.05);

      // Bass kick every beat
      if (this.bgmStep % 4 === 0) {
        if (this.ctx) {
          const kickOsc = this.ctx.createOscillator();
          const kickGain = this.ctx.createGain();
          kickOsc.type = 'sine';
          kickOsc.frequency.setValueAtTime(80, this.ctx.currentTime);
          kickOsc.frequency.exponentialRampToValueAtTime(40, this.ctx.currentTime + 0.15);
          kickGain.gain.setValueAtTime(0.25, this.ctx.currentTime);
          kickGain.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + 0.3);
          kickOsc.connect(kickGain); kickGain.connect(this.masterGain);
          kickOsc.start(); kickOsc.stop(this.ctx.currentTime + 0.3);
          this.bgmNodes.push(kickOsc, kickGain);
        }
        // Chord change every 4 beats
        const nextChordIdx = (Math.floor((this.bgmStep + 4) / 4)) % chords.length;
        this._playChord(chords[nextChordIdx]);
      }

      this.bgmStep++;
      // Prune completed nodes
      this.bgmNodes = this.bgmNodes.filter(n => {
        try { return n.context && n.context.state !== 'closed'; } catch { return false; }
      });
    }, beatDur * 1000);
  }

  stopBgm() {
    this.isPlaying = false;
    this.currentTrack = null;
    if (this.bgmIntervalId) { clearInterval(this.bgmIntervalId); this.bgmIntervalId = null; }
    this.bgmNodes.forEach(n => { try { n.stop?.(); n.disconnect?.(); } catch {} });
    this.bgmNodes = [];
  }

  playSfx(type) {
    this._init();
    if (!this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;

    if (type === 'whoosh') {
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(200, now);
      osc.frequency.exponentialRampToValueAtTime(1400, now + 0.15);
      osc.frequency.exponentialRampToValueAtTime(150, now + 0.4);
      g.gain.setValueAtTime(0.01, now);
      g.gain.linearRampToValueAtTime(0.22, now + 0.15);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
      osc.connect(g); g.connect(this.masterGain);
      osc.start(now); osc.stop(now + 0.45);
    } else if (type === 'impact-bass') {
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(120, now);
      osc.frequency.exponentialRampToValueAtTime(45, now + 0.6);
      g.gain.setValueAtTime(0.45, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.8);
      osc.connect(g); g.connect(this.masterGain);
      osc.start(now); osc.stop(now + 0.8);
    } else if (type === 'riser') {
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(90, now);
      osc.frequency.exponentialRampToValueAtTime(800, now + 1.5);
      g.gain.setValueAtTime(0.02, now);
      g.gain.linearRampToValueAtTime(0.18, now + 1.4);
      g.gain.exponentialRampToValueAtTime(0.001, now + 1.6);
      osc.connect(g); g.connect(this.masterGain);
      osc.start(now); osc.stop(now + 1.6);
    } else if (type === 'ambient') {
      // Subtle filtered noise via multiple detuned oscillators
      [65, 97.5, 130].forEach((f, i) => {
        const osc = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(f, now);
        g.gain.setValueAtTime(0, now);
        g.gain.linearRampToValueAtTime(0.08 / (i + 1), now + 0.4);
        g.gain.linearRampToValueAtTime(0, now + 1.5);
        osc.connect(g); g.connect(this.masterGain);
        osc.start(now); osc.stop(now + 1.6);
      });
    }
  }

  destroy() {
    this.stopBgm();
    if (this.ctx && this.ctx.state !== 'closed') {
      this.ctx.close().catch(() => {});
    }
    this.ctx = null;
    this.masterGain = null;
  }
}

// Singleton engine — shared across all panel instances on the page
let _sharedEngine = null;
const getEngine = () => {
  if (!_sharedEngine) _sharedEngine = new AudioEngine();
  return _sharedEngine;
};

// ─── Component ────────────────────────────────────────────────────────────────
export default function AudioMixerPanel({ collapsed = false }) {
  const [expanded, setExpanded] = useState(!collapsed);
  const [activeBgm, setActiveBgm] = useState(null);   // track id or null
  const [volume, setVolume] = useState(0.35);
  const [sfxFired, setSfxFired] = useState(null);     // sfx id briefly highlighted
  const engineRef = useRef(null);

  useEffect(() => {
    engineRef.current = getEngine();
    return () => {
      // Only destroy if this component is the last user — for now just stop BGM
      engineRef.current?.stopBgm();
    };
  }, []);

  const handleBgmClick = useCallback((track) => {
    const eng = engineRef.current;
    if (!eng) return;
    if (activeBgm === track.id) {
      eng.stopBgm();
      setActiveBgm(null);
    } else {
      eng.startBgm(track);
      setActiveBgm(track.id);
    }
  }, [activeBgm]);

  const handleStop = useCallback(() => {
    engineRef.current?.stopBgm();
    setActiveBgm(null);
  }, []);

  const handleSfx = useCallback((sfxId) => {
    engineRef.current?.playSfx(sfxId);
    setSfxFired(sfxId);
    setTimeout(() => setSfxFired(null), 600);
  }, []);

  const handleVolume = useCallback((e) => {
    const v = parseFloat(e.target.value);
    setVolume(v);
    engineRef.current?.setVolume(v);
  }, []);

  return (
    <div className="bg-[#0b1120] border border-slate-800 rounded-xl overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-slate-800/40 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Music2 size={13} className={activeBgm ? 'text-violet-400 animate-pulse' : 'text-slate-500'} />
          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Audio Mixer</span>
          {activeBgm && (
            <span className="text-[9px] bg-violet-500/20 text-violet-300 border border-violet-500/30 px-1.5 py-0.5 rounded-full font-bold">
              ▶ {BGM_TRACKS.find(t => t.id === activeBgm)?.name}
            </span>
          )}
        </div>
        {expanded ? <ChevronUp size={13} className="text-slate-600" /> : <ChevronDown size={13} className="text-slate-600" />}
      </button>

      {expanded && (
        <div className="px-4 pb-4 flex flex-col gap-3">
          {/* Volume + Stop row */}
          <div className="flex items-center gap-3">
            <VolumeX size={12} className="text-slate-600 shrink-0" />
            <input
              type="range" min={0} max={1} step={0.01} value={volume}
              onChange={handleVolume}
              className="flex-1 h-1.5 accent-violet-500 cursor-pointer"
            />
            <Volume2 size={12} className="text-slate-500 shrink-0" />
            <span className="text-[10px] text-slate-500 w-8 text-right tabular-nums">
              {Math.round(volume * 100)}%
            </span>
            {activeBgm && (
              <button
                onClick={handleStop}
                className="flex items-center gap-1 text-[10px] px-2 py-1 bg-red-900/20 hover:bg-red-900/40 border border-red-800/40 text-red-400 rounded-lg transition-colors shrink-0"
              >
                <Square size={9} fill="currentColor" /> Dừng
              </button>
            )}
          </div>

          {/* BGM Tracks */}
          <div>
            <p className="text-[9px] font-bold text-slate-600 uppercase tracking-wider mb-2">
              Nhạc nền — BGM
            </p>
            <div className="flex flex-col gap-1.5">
              {BGM_TRACKS.map(track => {
                const c = COLOR_MAP[track.color];
                const isActive = activeBgm === track.id;
                return (
                  <button
                    key={track.id}
                    onClick={() => handleBgmClick(track)}
                    className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border text-left transition-all ${
                      isActive
                        ? `${c.bg} ${c.border} ring-1 ${c.ring}`
                        : 'bg-slate-800/40 border-slate-700/50 hover:border-slate-600 hover:bg-slate-800'
                    }`}
                  >
                    {/* Play indicator */}
                    <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${isActive ? `${c.bg} ${c.border} border` : 'bg-slate-700 border-0'}`}>
                      {isActive
                        ? <span className="text-[8px] animate-pulse">▶</span>
                        : <Play size={8} className="text-slate-500 ml-0.5" />
                      }
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className={`text-[11px] font-bold ${isActive ? c.text : 'text-slate-300'}`}>
                          {track.name}
                        </span>
                        <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold shrink-0 ${isActive ? `${c.bg} ${c.text}` : 'bg-slate-700 text-slate-500'}`}>
                          {track.badge}
                        </span>
                      </div>
                      <p className="text-[10px] text-slate-600 truncate">{track.desc}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* SFX */}
          <div>
            <p className="text-[9px] font-bold text-slate-600 uppercase tracking-wider mb-2 flex items-center gap-1">
              <Zap size={9} /> Hiệu ứng âm thanh — SFX
            </p>
            <div className="grid grid-cols-4 gap-1.5">
              {SFX_LIST.map(sfx => {
                const fired = sfxFired === sfx.id;
                return (
                  <button
                    key={sfx.id}
                    onClick={() => handleSfx(sfx.id)}
                    className={`flex flex-col items-center gap-1 px-2 py-2.5 rounded-lg border transition-all active:scale-95 ${
                      fired
                        ? 'bg-yellow-500/20 border-yellow-500/60 scale-95'
                        : 'bg-slate-800/60 border-slate-700/50 hover:border-slate-500 hover:bg-slate-700/60'
                    }`}
                  >
                    <span className="text-lg leading-none">{sfx.icon}</span>
                    <span className={`text-[9px] font-bold ${fired ? 'text-yellow-300' : 'text-slate-400'}`}>{sfx.label}</span>
                    <span className="text-[8px] text-slate-600">{sfx.desc}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
