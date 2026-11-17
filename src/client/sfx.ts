// Synthesised sound effects (Web Audio): oscillators and one shared noise buffer, so there are no
// audio files. Game view only — the feed splash never loads this. The AudioContext is created
// after the first user gesture (autoplay rules); sounds before that are simply skipped.
import {
  MASTER_VOLUME,
  MUTE_KEY,
  OTHER_CLUE_GAIN,
  acquireVoice,
  clueNotes,
  parseMuted,
  visibilityAction,
} from '../shared/sfx';

/** localStorage may be unavailable in the iframe; a missing preference means sound on. */
const readMuted = (): boolean => {
  try {
    return parseMuted(window.localStorage.getItem(MUTE_KEY));
  } catch {
    return false;
  }
};

const writeMuted = (muted: boolean) => {
  try {
    window.localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
  } catch {
    // Preference just isn't remembered.
  }
};

/** Drag spins fire many digit changes: at most one tick per this long. */
const TICK_GAP_S = 0.035;

type ToneOpts = {
  freq: number;
  endFreq?: number;
  at?: number;
  dur: number;
  gain: number;
  type?: OscillatorType;
};

type NoiseOpts = {
  at?: number;
  dur: number;
  gain: number;
  filter: BiquadFilterType;
  freq: number;
};

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private voices: number[] = [];
  private lastTick = 0;
  private muted = readMuted();

  private disposed = false;

  /** First gesture creates/resumes the context (autoplay policy). */
  private readonly unlock = () => {
    if (this.muted) return;
    this.ensure();
    if (this.ctx) this.removeUnlock();
  };

  constructor() {
    window.addEventListener('pointerdown', this.unlock, true);
    window.addEventListener('keydown', this.unlock, true);
  }

  /** Tab hidden → suspend the context; visible again → resume it unless muted. No context yet: nothing. */
  setVisible(visible: boolean) {
    const ctx = this.ctx;
    if (!ctx || this.disposed) return;
    const action = visibilityAction(visible, this.muted);
    if (action === 'suspend' && ctx.state === 'running')
      void ctx.suspend().catch(() => {});
    else if (action === 'resume' && ctx.state === 'suspended')
      void ctx.resume().catch(() => {});
  }

  /** Releases the gesture listeners and closes the audio context. */
  dispose() {
    this.disposed = true;
    this.removeUnlock();
    const ctx = this.ctx;
    this.ctx = null;
    this.master = null;
    this.noise = null;
    if (ctx && ctx.state !== 'closed') void ctx.close().catch(() => {});
  }

  private removeUnlock() {
    window.removeEventListener('pointerdown', this.unlock, true);
    window.removeEventListener('keydown', this.unlock, true);
  }

  get isMuted(): boolean {
    return this.muted;
  }

  /** Called from the mute button (a gesture), so unmuting may create the context. */
  setMuted(muted: boolean) {
    this.muted = muted;
    writeMuted(muted);
    if (!muted) this.ensure();
    const ctx = this.ctx;
    if (ctx && this.master)
      this.master.gain.setTargetAtTime(
        muted ? 0 : MASTER_VOLUME,
        ctx.currentTime,
        0.02
      );
  }

  /** Dial clicked one notch. */
  tick() {
    const ctx = this.live();
    if (!ctx || ctx.currentTime - this.lastTick < TICK_GAP_S) return;
    this.lastTick = ctx.currentTime;
    this.noiseBurst({ dur: 0.025, gain: 0.5, filter: 'highpass', freq: 3200 });
    this.tone({ freq: 2100, dur: 0.018, gain: 0.06, type: 'square' });
  }

  /** Code sent: a lever pull up. */
  submit() {
    this.tone({
      freq: 330,
      endFreq: 495,
      dur: 0.12,
      gain: 0.25,
      type: 'triangle',
    });
    this.noiseBurst({
      at: 0.1,
      dur: 0.04,
      gain: 0.35,
      filter: 'bandpass',
      freq: 1400,
    });
  }

  /** A clue landed: one rising note per 🟢, softer low ones per 🟡, a falling pair for blank. */
  clue(exact: number, misplaced: number, other: boolean) {
    const scale = other ? OTHER_CLUE_GAIN : 1;
    const blank = exact === 0 && misplaced === 0;
    for (const n of clueNotes(exact, misplaced))
      this.tone({
        freq: n.freq,
        at: n.delayS,
        dur: n.durationS,
        gain: (blank ? 0.22 : 0.28) * scale,
        type: blank ? 'square' : 'triangle',
      });
  }

  /** The drill opened a dial: heavy metal clunk. */
  clunk() {
    this.tone({ freq: 120, endFreq: 50, dur: 0.3, gain: 0.5, type: 'sine' });
    this.noiseBurst({ dur: 0.12, gain: 0.5, filter: 'lowpass', freq: 900 });
    this.noiseBurst({
      at: 0.08,
      dur: 0.05,
      gain: 0.3,
      filter: 'bandpass',
      freq: 2400,
    });
  }

  /** The vault opens: three bolts slide, then a bright chime. */
  open() {
    for (const at of [0, 0.12, 0.24]) {
      this.noiseBurst({
        at,
        dur: 0.06,
        gain: 0.45,
        filter: 'bandpass',
        freq: 1800,
      });
      this.tone({
        freq: 90,
        endFreq: 60,
        at,
        dur: 0.1,
        gain: 0.3,
        type: 'sine',
      });
    }
    [1046.5, 1318.51, 1567.98, 2093].forEach((freq, i) => {
      this.tone({
        freq,
        at: 0.45 + i * 0.09,
        dur: 0.5,
        gain: 0.18,
        type: 'sine',
      });
    });
  }

  /* ---------------- Internals ---------------- */

  private ensure() {
    if (this.disposed) return;
    if (!this.ctx) {
      if (typeof AudioContext === 'undefined') return;
      try {
        const ctx = new AudioContext();
        const master = ctx.createGain();
        master.gain.value = this.muted ? 0 : MASTER_VOLUME;
        master.connect(ctx.destination);
        const buf = ctx.createBuffer(
          1,
          Math.floor(ctx.sampleRate * 0.25),
          ctx.sampleRate
        );
        const data = buf.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
        this.ctx = ctx;
        this.master = master;
        this.noise = buf;
      } catch (error) {
        console.error('[sfx] Web Audio unavailable:', error);
        return;
      }
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => {});
  }

  /** The context, when sound is on and it runs; otherwise null (sound skipped). */
  private live(): AudioContext | null {
    const ctx = this.ctx;
    return !this.muted && ctx && ctx.state === 'running' ? ctx : null;
  }

  private claim(ctx: AudioContext, start: number, dur: number): boolean {
    const next = acquireVoice(
      this.voices,
      ctx.currentTime,
      start - ctx.currentTime + dur
    );
    if (!next) return false;
    this.voices = next;
    return true;
  }

  private envelope(
    ctx: AudioContext,
    start: number,
    dur: number,
    peak: number
  ): GainNode {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), start + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    return g;
  }

  private tone(o: ToneOpts) {
    const ctx = this.live();
    const master = this.master;
    if (!ctx || !master) return;
    const start = ctx.currentTime + (o.at ?? 0);
    if (!this.claim(ctx, start, o.dur)) return;
    const osc = ctx.createOscillator();
    osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(o.freq, start);
    if (o.endFreq !== undefined)
      osc.frequency.exponentialRampToValueAtTime(o.endFreq, start + o.dur);
    const g = this.envelope(ctx, start, o.dur, o.gain);
    osc.connect(g).connect(master);
    osc.start(start);
    osc.stop(start + o.dur + 0.02);
  }

  private noiseBurst(o: NoiseOpts) {
    const ctx = this.live();
    const master = this.master;
    if (!ctx || !master || !this.noise) return;
    const start = ctx.currentTime + (o.at ?? 0);
    if (!this.claim(ctx, start, o.dur)) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = o.filter;
    filter.frequency.value = o.freq;
    const g = this.envelope(ctx, start, o.dur, o.gain);
    src.connect(filter).connect(g).connect(master);
    src.start(start, Math.random() * 0.15);
    src.stop(start + o.dur + 0.02);
  }
}
