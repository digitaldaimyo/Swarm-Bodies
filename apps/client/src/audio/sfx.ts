import { getSettings } from "../ui/settings";

/**
 * Synthesized audio (SPEC §10.6): oscillators, noise and filters only; no audio files.
 * The context is created on the first user gesture, as browsers require.
 */
class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfx: GainNode | null = null;
  private ambience: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private pad: { nodes: AudioScheduledSourceNode[]; filter: BiquadFilterNode } | null = null;

  /** Call from a user gesture handler. Safe to call repeatedly. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.sfx = ctx.createGain();
    this.ambience = ctx.createGain();
    this.sfx.connect(this.master);
    this.ambience.connect(this.master);
    this.master.connect(ctx.destination);
    const len = ctx.sampleRate;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.applyLevels();
  }

  applyLevels(): void {
    const s = getSettings();
    if (!this.ctx || !this.master || !this.sfx || !this.ambience) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(s.master, t, 0.05);
    this.sfx.gain.setTargetAtTime(s.sfx, t, 0.05);
    this.ambience.gain.setTargetAtTime(s.ambience * 0.5, t, 0.2);
  }

  private noiseBurst(
    dur: number,
    filterType: BiquadFilterType,
    freq: number,
    endFreq: number,
    gain: number,
    q = 1,
  ): void {
    const { ctx, sfx, noise } = this;
    if (!ctx || !sfx || !noise) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const f = ctx.createBiquadFilter();
    f.type = filterType;
    f.Q.value = q;
    f.frequency.setValueAtTime(freq, t);
    f.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(sfx);
    src.start(t, Math.random() * 0.5, dur + 0.05);
  }

  private tone(type: OscillatorType, from: number, to: number, dur: number, gain: number): void {
    const { ctx, sfx } = this;
    if (!ctx || !sfx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(from, t);
    o.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(sfx);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  /** Wet squelch on growth: a resonant band sweep over noise plus a soft pitch drop. */
  squelch(): void {
    this.noiseBurst(0.18, "bandpass", 1400 + Math.random() * 400, 260, 0.5, 7);
    this.tone("sine", 320, 120, 0.14, 0.12);
  }

  /** Crunch on capture. */
  crunch(): void {
    this.noiseBurst(0.22, "lowpass", 5200, 400, 0.7, 0.8);
    this.tone("square", 140, 55, 0.16, 0.08);
  }

  /** A dull thud when an assault is repelled or paths collide. */
  thud(): void {
    this.tone("sine", 110, 45, 0.25, 0.35);
    this.noiseBurst(0.08, "lowpass", 900, 200, 0.25);
  }

  /** The deep "thoom" of a spore launch (SPEC §10.6). */
  launch(): void {
    this.tone("sine", 70, 32, 0.6, 0.5);
    this.tone("triangle", 140, 60, 0.35, 0.12);
    this.noiseBurst(0.35, "lowpass", 600, 120, 0.3);
  }

  /** UI click and the path-painting tick. */
  click(): void {
    this.tone("triangle", 1800, 900, 0.04, 0.12);
  }

  tick(): void {
    this.tone("sine", 900 + Math.random() * 200, 700, 0.03, 0.06);
  }

  /** Soft ambient pad. `intensity` 0–1 tracks the game phase (early → late). */
  setPad(on: boolean, intensity = 0): void {
    const { ctx, ambience } = this;
    if (!ctx || !ambience) return;
    if (!on) {
      this.pad?.nodes.forEach((n) => n.stop(ctx.currentTime + 0.5));
      this.pad = null;
      return;
    }
    if (!this.pad) {
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 500;
      const g = ctx.createGain();
      g.gain.value = 0.08;
      filter.connect(g).connect(ambience);
      const nodes: AudioScheduledSourceNode[] = [];
      for (const [f, d] of [
        [110, -7],
        [164.8, 5],
        [220, 3],
      ] as const) {
        const o = ctx.createOscillator();
        o.type = "sawtooth";
        o.frequency.value = f;
        o.detune.value = d;
        o.connect(filter);
        o.start();
        nodes.push(o);
      }
      const lfo = ctx.createOscillator();
      const lfoGain = ctx.createGain();
      lfo.frequency.value = 0.07;
      lfoGain.gain.value = 180;
      lfo.connect(lfoGain).connect(filter.frequency);
      lfo.start();
      nodes.push(lfo);
      this.pad = { nodes, filter };
    }
    this.pad.filter.frequency.setTargetAtTime(380 + intensity * 900, ctx.currentTime, 2);
  }
}

export const audio = new AudioEngine();
