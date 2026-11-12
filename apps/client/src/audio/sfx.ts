import { getSettings } from "../ui/settings";

/**
 * Synthesized audio (SPEC §10.6): oscillators, noise and filters only; no audio files.
 * The context is created on the first user gesture, as browsers require.
 */
/**
 * Mix (M8 audio pass). Peak levels per sound, relative to the SFX bus: impacts lead (capture,
 * launch, stingers), growth sits under them, UI sounds stay subtle. A limiter on the master bus
 * keeps stacked replay frames from clipping.
 */
const LEVEL = {
  squelch: 0.32,
  crunch: 0.45,
  thud: 0.3,
  launch: 0.42,
  starve: 0.16,
  income: 0.07,
  flare: 0.3,
  submit: 0.14,
  stinger: 0.22,
  click: 0.08,
  tick: 0.04,
} as const;

/** The same sound twice within this many ms plays once (a replay frame fires many). */
const DEDUPE_MS = 45;
/** Voices beyond this are dropped rather than stacked into mud. */
const MAX_VOICES = 14;

class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private duck: GainNode | null = null;
  private lastPlayed = new Map<string, number>();
  private voices = 0;
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
    this.duck = ctx.createGain();
    this.sfx.connect(this.master);
    this.ambience.connect(this.duck).connect(this.master);
    // Brick-wall-ish limiter: fast attack, high ratio, just under full scale.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -6;
    limiter.knee.value = 4;
    limiter.ratio.value = 16;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.15;
    this.master.connect(limiter).connect(ctx.destination);
    // Hidden tabs go quiet and stop using the audio thread.
    document.addEventListener("visibilitychange", () => {
      if (!this.ctx) return;
      if (document.hidden) void this.ctx.suspend();
      else void this.ctx.resume();
    });
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

  /** Whether `name` may start now (dedupe and voice cap). */
  private admit(name: string, dur: number): boolean {
    if (!this.ctx || this.ctx.state !== "running") return false;
    const now = performance.now();
    if (now - (this.lastPlayed.get(name) ?? -1e9) < DEDUPE_MS) return false;
    if (this.voices >= MAX_VOICES) return false;
    this.lastPlayed.set(name, now);
    this.voices++;
    setTimeout(() => this.voices--, dur * 1000 + 50);
    return true;
  }

  /** Ducks the ambient pad while a turn replays, so the action reads clearly. */
  setDuck(on: boolean): void {
    const { ctx, duck } = this;
    if (!ctx || !duck) return;
    duck.gain.setTargetAtTime(on ? 0.45 : 1, ctx.currentTime, on ? 0.08 : 0.6);
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
    if (!this.admit("squelch", 0.18)) return;
    this.noiseBurst(0.18, "bandpass", 1400 + Math.random() * 400, 260, LEVEL.squelch, 7);
    this.tone("sine", 320, 120, 0.14, LEVEL.squelch * 0.25);
  }

  /** Crunch on capture. */
  crunch(): void {
    if (!this.admit("crunch", 0.22)) return;
    this.noiseBurst(0.22, "lowpass", 5200, 400, LEVEL.crunch, 0.8);
    this.tone("square", 140, 55, 0.16, LEVEL.crunch * 0.12);
  }

  /** A dull thud when an assault is repelled or paths collide. */
  thud(): void {
    if (!this.admit("thud", 0.25)) return;
    this.tone("sine", 110, 45, 0.25, LEVEL.thud);
    this.noiseBurst(0.08, "lowpass", 900, 200, LEVEL.thud * 0.7);
  }

  /** The deep "thoom" of a spore launch (SPEC §10.6). */
  launch(): void {
    if (!this.admit("launch", 0.6)) return;
    this.tone("sine", 70, 32, 0.6, LEVEL.launch);
    this.tone("triangle", 140, 60, 0.35, LEVEL.launch * 0.25);
    this.noiseBurst(0.35, "lowpass", 600, 120, LEVEL.launch * 0.6);
  }

  /** Starving cells: a dry, falling hiss. */
  starve(): void {
    if (!this.admit("starve", 0.5)) return;
    this.noiseBurst(0.5, "highpass", 3000, 900, LEVEL.starve, 0.7);
  }

  /** Income ticking up: two soft bell partials. */
  income(): void {
    if (!this.admit("income", 0.25)) return;
    this.tone("sine", 1320, 1320, 0.22, LEVEL.income);
    this.tone("sine", 1980, 1980, 0.16, LEVEL.income * 0.5);
  }

  /** Solar flare: a bright rising sweep with a sizzle. */
  flare(): void {
    if (!this.admit("flare", 0.7)) return;
    this.noiseBurst(0.7, "bandpass", 800, 6000, LEVEL.flare, 2);
    this.tone("sawtooth", 220, 880, 0.5, LEVEL.flare * 0.15);
  }

  /** Orders sealed: a firm, low two-step. */
  submit(): void {
    if (!this.admit("submit", 0.2)) return;
    this.tone("triangle", 520, 520, 0.08, LEVEL.submit);
    setTimeout(() => this.tone("triangle", 390, 390, 0.12, LEVEL.submit), 70);
  }

  /** End of game: a rising triad for a win, a falling one otherwise. */
  stinger(won: boolean): void {
    if (!this.admit("stinger", 1.2)) return;
    const notes = won ? [392, 494, 587] : [440, 349, 294];
    notes.forEach((f, i) =>
      setTimeout(() => this.tone("triangle", f, f, 0.5, LEVEL.stinger), i * 140),
    );
  }

  /** UI click and the path-painting tick. */
  click(): void {
    if (!this.admit("click", 0.04)) return;
    this.tone("triangle", 1800, 900, 0.04, LEVEL.click);
  }

  tick(): void {
    if (!this.admit("tick", 0.03)) return;
    this.tone("sine", 900 + Math.random() * 200, 700, 0.03, LEVEL.tick);
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
