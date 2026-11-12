import { SurfaceType, WorldPhase } from '../types';

const NOTE_FREQ: Record<string, number> = {
  C3: 130.81, D3: 146.83, E3: 164.81, F3: 174.61, G3: 196.00, A3: 220.00, B3: 246.94,
  C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, Fs4: 369.99, G4: 392.00, A4: 440.00, B4: 493.88,
  C5: 523.25, D5: 587.33, E5: 659.25, F5: 698.46, Fs5: 739.99, G5: 783.99, A5: 880.00, B5: 987.77,
  C6: 1046.50, D6: 1174.66, E6: 1318.51, G6: 1567.98,
};

// 32 sixteenth-note steps (2 bars per phrase x 2 = 64 step loop)
const MELODY_SEQ: (string | null)[] = [
  'G5', null, 'E5', null, 'C5', 'D5', 'E5', null,
  'G5', null, 'A5', null, 'Fs5', null, 'D5', null,
  'E5', null, 'G5', null, 'B5', null, 'A5', 'G5',
  'E5', null, 'D5', 'C5', 'D5', null, null, null,

  'G5', null, 'E5', null, 'C5', 'D5', 'E5', 'G5',
  'A5', null, 'B5', null, 'C6', null, 'A5', null,
  'G5', null, 'E5', 'C5', 'D5', null, 'B4', 'G4',
  'C5', null, 'C5', null, 'C5', null, null, null,
];

const ARP_SEQ: string[] = [
  'C4', 'E4', 'G4', 'E4', 'C4', 'E4', 'G4', 'E4',
  'D4', 'Fs4', 'A4', 'Fs4', 'D4', 'Fs4', 'A4', 'Fs4',
  'E4', 'G4', 'B4', 'G4', 'C4', 'E4', 'G4', 'E4',
  'D4', 'G4', 'B4', 'G4', 'G3', 'B3', 'D4', 'Fs4',

  'C4', 'E4', 'G4', 'E4', 'C4', 'E4', 'G4', 'C5',
  'F4', 'A4', 'C5', 'A4', 'F4', 'A4', 'C5', 'A4',
  'E4', 'G4', 'C5', 'G4', 'D4', 'F4', 'B4', 'G4',
  'C4', 'G4', 'E4', 'G4', 'C4', 'E4', 'G4', 'B4',
];

const BASS_SEQ: (string | null)[] = [
  'C3', null, null, null, 'G3', null, null, null,
  'D3', null, null, null, 'A3', null, null, null,
  'E3', null, null, null, 'C3', null, null, null,
  'G3', null, 'G3', null, 'D3', null, 'G3', null,

  'C3', null, null, null, 'E3', null, 'G3', null,
  'F3', null, null, null, 'F3', null, 'A3', null,
  'G3', null, null, null, 'G3', null, 'B3', null,
  'C3', null, 'G3', null, 'C3', null, null, null,
];

export class SoundEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private musicMaster: GainNode | null = null;
  private solBus: GainNode | null = null;
  private lunaBus: GainNode | null = null;
  private sfxBus: GainNode | null = null;

  private muted = true;
  private forceSilent =
    typeof window !== 'undefined' &&
    (navigator.webdriver === true || new URLSearchParams(window.location.search).get('muted') === '1');
  private musicPlaying = false;
  private currentPhase: WorldPhase = 'sol';
  private stepIndex = 0;
  private nextNoteTime = 0;
  private schedulerTimer: number | null = null;
  private noiseBuffer: AudioBuffer | null = null;

  public init(): void {
    if (this.forceSilent || this.muted) {
      return;
    }
    if (this.ctx) {
      if (this.ctx.state === 'suspended') {
        this.ctx.resume();
      }
      return;
    }

    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new AudioCtx();

    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = this.muted || this.forceSilent ? 0 : 0.72;
    this.masterGain.connect(this.ctx.destination);

    this.musicMaster = this.ctx.createGain();
    this.musicMaster.gain.value = 0.34;
    this.musicMaster.connect(this.masterGain);

    this.solBus = this.ctx.createGain();
    this.solBus.gain.value = 1.0;
    this.solBus.connect(this.musicMaster);

    this.lunaBus = this.ctx.createGain();
    this.lunaBus.gain.value = 0.0;
    this.lunaBus.connect(this.musicMaster);

    this.sfxBus = this.ctx.createGain();
    this.sfxBus.gain.value = 0.85;
    this.sfxBus.connect(this.masterGain);

    // Pre-build white noise buffer for percussion / splashes / footsteps
    const len = this.ctx.sampleRate * 0.5;
    this.noiseBuffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) {
      data[i] = Math.random() * 2 - 1;
    }
  }

  public startMusic(): void {
    this.init();
    if (!this.ctx || this.musicPlaying) return;
    this.musicPlaying = true;
    this.stepIndex = 0;
    this.nextNoteTime = this.ctx.currentTime + 0.08;
    this.schedulerTimer = window.setInterval(() => this.scheduleMusic(), 40);
  }

  public stopMusic(): void {
    this.musicPlaying = false;
    if (this.schedulerTimer !== null) {
      clearInterval(this.schedulerTimer);
      this.schedulerTimer = null;
    }
  }

  public toggleMute(): boolean {
    if (this.forceSilent) {
      this.muted = true;
      return true;
    }
    this.muted = !this.muted;
    if (!this.muted) {
      this.init();
      if (!this.musicPlaying) {
        this.startMusic();
      }
    }
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(this.muted ? 0 : 0.72, this.ctx.currentTime, 0.04);
    }
    return this.muted;
  }

  public isMuted(): boolean {
    return this.muted;
  }

  public duckMusic(durationSec: number): void {
    if (!this.ctx || !this.musicMaster) return;
    const now = this.ctx.currentTime;
    this.musicMaster.gain.cancelScheduledValues(now);
    this.musicMaster.gain.setTargetAtTime(0.04, now, 0.04);
    this.musicMaster.gain.setTargetAtTime(0.34, now + durationSec, 0.25);
  }

  public setPhase(phase: WorldPhase, playSfx = true): void {
    this.init();
    this.currentPhase = phase;
    if (this.ctx && this.solBus && this.lunaBus) {
      const now = this.ctx.currentTime;
      this.solBus.gain.cancelScheduledValues(now);
      this.lunaBus.gain.cancelScheduledValues(now);
      this.solBus.gain.setTargetAtTime(phase === 'sol' ? 1.0 : 0.0, now, 0.09);
      this.lunaBus.gain.setTargetAtTime(phase === 'luna' ? 1.0 : 0.0, now, 0.09);
    }
    if (playSfx) {
      this.playPhaseShiftSfx(phase);
    }
  }

  private scheduleMusic(): void {
    if (!this.ctx || !this.musicPlaying || !this.solBus || !this.lunaBus) return;
    const stepDur = 60 / 132 / 4; // 132 BPM sixteenth notes

    while (this.nextNoteTime < this.ctx.currentTime + 0.14) {
      const idx = this.stepIndex % 64;
      const t = this.nextNoteTime;

      const mel = MELODY_SEQ[idx];
      const arp = ARP_SEQ[idx];
      const bass = BASS_SEQ[idx];

      // --- SOL CHANNEL (N64 Brass + Marimba + Bouncy Bass + Crisp Drums) ---
      if (mel && NOTE_FREQ[mel]) {
        this.synthBrassNote(NOTE_FREQ[mel], t, stepDur * 1.75, 0.20, this.solBus);
      }
      if (arp && NOTE_FREQ[arp]) {
        this.synthMarimbaNote(NOTE_FREQ[arp], t, stepDur * 0.9, 0.11, this.solBus);
      }
      if (bass && NOTE_FREQ[bass]) {
        this.synthTone(NOTE_FREQ[bass], 'triangle', t, stepDur * 2.5, 0.24, this.solBus);
      }
      if (idx % 4 === 0) {
        this.synthKick(t, 0.18, this.solBus);
      } else if (idx % 4 === 2) {
        this.synthHiHat(t, 0.06, this.solBus);
      }
      if (idx % 8 === 4) {
        this.synthSnare(t, 0.10, this.solBus);
      }

      // --- LUNA CHANNEL (Astral Celesta + Dream Pad + Deep Sub + Clock Tick) ---
      if (mel && NOTE_FREQ[mel]) {
        this.synthCelestaNote(NOTE_FREQ[mel], t, stepDur * 2.8, 0.19, this.lunaBus);
      }
      if (arp && NOTE_FREQ[arp]) {
        this.synthCelestaNote(NOTE_FREQ[arp] * 2, t, stepDur * 1.5, 0.06, this.lunaBus);
      }
      if (bass && NOTE_FREQ[bass]) {
        this.synthTone(NOTE_FREQ[bass], 'sine', t, stepDur * 3.6, 0.26, this.lunaBus);
      }
      if (idx % 2 === 0) {
        // Mechanical pocket-watch tick in Luna!
        const tickFreq = idx % 4 === 0 ? 2400 : 1850;
        this.synthTone(tickFreq, 'sine', t, 0.025, 0.045, this.lunaBus);
      }

      this.nextNoteTime += stepDur;
      this.stepIndex++;
    }
  }

  private synthBrassNote(freq: number, time: number, dur: number, vol: number, dest: AudioNode): void {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const filter = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(freq * 0.992, time);
    osc.frequency.exponentialRampToValueAtTime(freq, time + 0.025);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(900, time);
    filter.frequency.exponentialRampToValueAtTime(2600, time + 0.04);
    filter.frequency.exponentialRampToValueAtTime(1400, time + dur);

    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(vol, time + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + dur);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(dest);
    osc.start(time);
    osc.stop(time + dur + 0.02);
  }

  private synthMarimbaNote(freq: number, time: number, dur: number, vol: number, dest: AudioNode): void {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, time);
    gain.gain.setValueAtTime(vol, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    osc.connect(gain);
    gain.connect(dest);
    osc.start(time);
    osc.stop(time + dur + 0.01);
  }

  private synthCelestaNote(freq: number, time: number, dur: number, vol: number, dest: AudioNode): void {
    if (!this.ctx) return;
    const osc1 = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc1.type = 'sine';
    osc2.type = 'triangle';
    osc1.frequency.setValueAtTime(freq, time);
    osc2.frequency.setValueAtTime(freq * 2.002, time);

    const g2 = this.ctx.createGain();
    g2.gain.value = 0.28;

    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(vol, time + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + dur);

    osc1.connect(gain);
    osc2.connect(g2);
    g2.connect(gain);
    gain.connect(dest);

    osc1.start(time);
    osc2.start(time);
    osc1.stop(time + dur + 0.02);
    osc2.stop(time + dur + 0.02);
  }

  private synthTone(
    freq: number,
    type: OscillatorType,
    time: number,
    dur: number,
    vol: number,
    dest: AudioNode
  ): void {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, time);
    gain.gain.setValueAtTime(vol, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    osc.connect(gain);
    gain.connect(dest);
    osc.start(time);
    osc.stop(time + dur + 0.02);
  }

  private synthKick(time: number, vol: number, dest: AudioNode): void {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(125, time);
    osc.frequency.exponentialRampToValueAtTime(42, time + 0.09);
    gain.gain.setValueAtTime(vol, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.11);
    osc.connect(gain);
    gain.connect(dest);
    osc.start(time);
    osc.stop(time + 0.12);
  }

  private synthSnare(time: number, vol: number, dest: AudioNode): void {
    if (!this.ctx || !this.noiseBuffer) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1800;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(vol, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.09);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(dest);
    src.start(time);
    src.stop(time + 0.1);
  }

  private synthHiHat(time: number, vol: number, dest: AudioNode): void {
    if (!this.ctx || !this.noiseBuffer) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 6500;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(vol, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.04);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(dest);
    src.start(time);
    src.stop(time + 0.05);
  }

  // ==================== GAMEPLAY SFX ====================

  private playPhaseShiftSfx(toPhase: WorldPhase): void {
    if (!this.ctx || !this.sfxBus) return;
    const t = this.ctx.currentTime;

    // Crisp pocket-watch gear click
    this.synthTone(toPhase === 'luna' ? 1950 : 1450, 'square', t, 0.03, 0.18, this.sfxBus);

    // Harmonic sweep chord
    const notes = toPhase === 'luna' ? [523.25, 659.25, 987.77, 1318.51] : [392.0, 587.33, 783.99, 1174.66];
    notes.forEach((f, i) => {
      this.synthCelestaNote(f, t + i * 0.028, 0.34, 0.16, this.sfxBus!);
    });
  }

  public playJump(
    kind: 'jump1' | 'jump2' | 'jump3' | 'sideflip' | 'backflip' | 'longjump' | 'wallkick' | 'rollout'
  ): void {
    this.init();
    if (!this.ctx || !this.sfxBus) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    let fStart = 240;
    let fEnd = 520;
    let dur = 0.15;
    let type: OscillatorType = 'triangle';

    switch (kind) {
      case 'jump1':
        fStart = 230;
        fEnd = 490;
        dur = 0.14;
        break;
      case 'jump2':
        fStart = 310;
        fEnd = 680;
        dur = 0.16;
        break;
      case 'jump3':
        fStart = 390;
        fEnd = 980;
        dur = 0.24;
        type = 'sawtooth';
        // Sparkle arpeggio on triple jump!
        [659.25, 783.99, 1046.5, 1318.51].forEach((f, idx) => {
          this.synthCelestaNote(f, t + 0.04 + idx * 0.035, 0.22, 0.15, this.sfxBus!);
        });
        break;
      case 'sideflip':
        fStart = 350;
        fEnd = 860;
        dur = 0.21;
        this.synthCelestaNote(880, t + 0.05, 0.18, 0.14, this.sfxBus);
        break;
      case 'backflip':
        fStart = 280;
        fEnd = 920;
        dur = 0.23;
        break;
      case 'longjump':
        fStart = 200;
        fEnd = 640;
        dur = 0.22;
        type = 'sawtooth';
        break;
      case 'wallkick':
        this.synthSnare(t, 0.22, this.sfxBus);
        fStart = 360;
        fEnd = 820;
        dur = 0.15;
        break;
      case 'rollout':
        fStart = 290;
        fEnd = 590;
        dur = 0.13;
        break;
    }

    osc.type = type;
    osc.frequency.setValueAtTime(fStart, t);
    osc.frequency.exponentialRampToValueAtTime(fEnd, t + dur);

    gain.gain.setValueAtTime(0.24, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    osc.connect(gain);
    gain.connect(this.sfxBus);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  public playDive(): void {
    this.init();
    if (!this.ctx || !this.sfxBus) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(460, t);
    osc.frequency.exponentialRampToValueAtTime(190, t + 0.16);
    gain.gain.setValueAtTime(0.2, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.17);
    osc.connect(gain);
    gain.connect(this.sfxBus);
    osc.start(t);
    osc.stop(t + 0.18);
  }

  public playGroundPoundStart(): void {
    this.init();
    if (!this.ctx || !this.sfxBus) return;
    const t = this.ctx.currentTime;
    this.synthTone(520, 'triangle', t, 0.08, 0.2, this.sfxBus);
    this.synthTone(740, 'triangle', t + 0.06, 0.09, 0.2, this.sfxBus);
  }

  public playGroundPoundImpact(): void {
    this.init();
    if (!this.ctx || !this.sfxBus) return;
    const t = this.ctx.currentTime;
    this.synthKick(t, 0.55, this.sfxBus);
    this.synthSnare(t, 0.28, this.sfxBus);
    this.synthTone(92, 'sawtooth', t, 0.22, 0.3, this.sfxBus);
  }

  public playStep(surface: SurfaceType): void {
    if (!this.ctx || !this.sfxBus || !this.noiseBuffer) return;
    const t = this.ctx.currentTime;
    if (surface === 'ice' || surface === 'astral') {
      this.synthTone(surface === 'ice' ? 1700 + Math.random() * 300 : 1250 + Math.random() * 250, 'sine', t, 0.04, 0.07, this.sfxBus);
      return;
    }
    if (surface === 'brass') {
      this.synthTone(420 + Math.random() * 80, 'triangle', t, 0.045, 0.09, this.sfxBus);
      return;
    }
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = surface === 'grass' ? 1400 : surface === 'wood' ? 850 : 2100;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.065, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxBus);
    src.start(t);
    src.stop(t + 0.05);
  }

  public playCoin(): void {
    this.init();
    if (!this.ctx || !this.sfxBus) return;
    const t = this.ctx.currentTime;
    // Classic B5 -> E6 two-tone coin chime!
    this.synthTone(987.77, 'square', t, 0.075, 0.14, this.sfxBus);
    this.synthTone(1318.51, 'square', t + 0.07, 0.28, 0.16, this.sfxBus);
  }

  public playRedCoin(collectedCount: number): void {
    this.init();
    if (!this.ctx || !this.sfxBus) return;
    const t = this.ctx.currentTime;
    const semitoneBoost = Math.pow(2, (collectedCount - 1) / 12);
    const f1 = 783.99 * semitoneBoost;
    const f2 = 1174.66 * semitoneBoost;
    this.synthCelestaNote(f1, t, 0.12, 0.25, this.sfxBus);
    this.synthCelestaNote(f2, t + 0.075, 0.38, 0.28, this.sfxBus);
  }

  public playRing(index: number): void {
    this.init();
    if (!this.ctx || !this.sfxBus) return;
    const t = this.ctx.currentTime;
    const mult = Math.pow(2, (index - 1) / 12);
    this.synthCelestaNote(659.25 * mult, t, 0.18, 0.22, this.sfxBus);
    this.synthCelestaNote(987.77 * mult, t + 0.05, 0.30, 0.24, this.sfxBus);
  }

  public playSwitchPress(): void {
    this.init();
    if (!this.ctx || !this.sfxBus) return;
    const t = this.ctx.currentTime;
    this.synthTone(330, 'square', t, 0.07, 0.22, this.sfxBus);
    this.synthTone(660, 'square', t + 0.07, 0.16, 0.22, this.sfxBus);
  }

  public playTick(urgent = false): void {
    if (!this.ctx || !this.sfxBus) return;
    const t = this.ctx.currentTime;
    this.synthTone(urgent ? 1320 : 880, 'square', t, 0.035, 0.11, this.sfxBus);
  }

  public playBounce(): void {
    this.init();
    if (!this.ctx || !this.sfxBus) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(190, t);
    osc.frequency.exponentialRampToValueAtTime(780, t + 0.24);
    gain.gain.setValueAtTime(0.32, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.26);
    osc.connect(gain);
    gain.connect(this.sfxBus);
    osc.start(t);
    osc.stop(t + 0.27);
  }

  public playEnemyDefeat(): void {
    this.init();
    if (!this.ctx || !this.sfxBus) return;
    const t = this.ctx.currentTime;
    this.synthKick(t, 0.35, this.sfxBus);
    this.synthTone(340, 'triangle', t, 0.08, 0.22, this.sfxBus);
    this.synthTone(580, 'triangle', t + 0.07, 0.14, 0.24, this.sfxBus);
  }

  public playHurt(): void {
    this.init();
    if (!this.ctx || !this.sfxBus) return;
    const t = this.ctx.currentTime;
    this.synthTone(310, 'sawtooth', t, 0.11, 0.26, this.sfxBus);
    this.synthTone(195, 'sawtooth', t + 0.09, 0.22, 0.28, this.sfxBus);
  }

  public playBossSlam(): void {
    this.init();
    if (!this.ctx || !this.sfxBus) return;
    const t = this.ctx.currentTime;
    this.synthKick(t, 0.65, this.sfxBus);
    this.synthSnare(t, 0.36, this.sfxBus);
    this.synthTone(68, 'sawtooth', t, 0.38, 0.35, this.sfxBus);
  }

  public playBossHit(): void {
    this.init();
    if (!this.ctx || !this.sfxBus) return;
    const t = this.ctx.currentTime;
    this.synthKick(t, 0.6, this.sfxBus);
    [440, 554.37, 659.25, 880].forEach((f, idx) => {
      this.synthBrassNote(f, t + idx * 0.055, 0.24, 0.28, this.sfxBus!);
    });
  }

  public playEchoSpawn(): void {
    this.init();
    if (!this.ctx || !this.sfxBus) return;
    const t = this.ctx.currentTime;
    [587.33, 880, 1174.66].forEach((f, i) => {
      this.synthCelestaNote(f, t + i * 0.04, 0.32, 0.2, this.sfxBus!);
    });
  }

  public playCameraClick(): void {
    this.init();
    if (!this.ctx || !this.sfxBus) return;
    const t = this.ctx.currentTime;
    this.synthTone(1150, 'triangle', t, 0.04, 0.14, this.sfxBus);
    this.synthTone(1520, 'triangle', t + 0.035, 0.05, 0.14, this.sfxBus);
  }

  public playPaintingEnter(): void {
    this.init();
    if (!this.ctx || !this.sfxBus) return;
    const t = this.ctx.currentTime;
    // Liquid ripple bloops + shimmering entry chord!
    const freqs = [320, 460, 390, 620, 540, 840, 1080];
    freqs.forEach((f, i) => {
      this.synthCelestaNote(f, t + i * 0.055, 0.28, 0.22, this.sfxBus!);
    });
  }

  public playStarAppear(): void {
    this.init();
    if (!this.ctx || !this.sfxBus) return;
    this.duckMusic(1.5);
    const t = this.ctx.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.5, 1318.51, 1567.98];
    notes.forEach((f, i) => {
      this.synthCelestaNote(f, t + i * 0.09, 0.5, 0.26, this.sfxBus!);
    });
  }

  public playStarGet(): void {
    this.init();
    if (!this.ctx || !this.sfxBus) return;
    this.duckMusic(2.6);
    const t = this.ctx.currentTime;
    // Iconic triumphant N64 fanfare phrase!
    const fanfare: [number, number, number][] = [
      [523.25, 0.0, 0.14],
      [659.25, 0.13, 0.14],
      [783.99, 0.26, 0.14],
      [1046.50, 0.40, 0.26],
      [783.99, 0.68, 0.16],
      [1046.50, 0.86, 0.75],
    ];
    for (const [freq, offset, dur] of fanfare) {
      this.synthBrassNote(freq, t + offset, dur, 0.30, this.sfxBus);
      this.synthCelestaNote(freq * 2, t + offset, dur * 1.2, 0.16, this.sfxBus);
    }
    // Harmony chord on final note
    this.synthBrassNote(523.25, t + 0.86, 0.75, 0.20, this.sfxBus);
    this.synthBrassNote(659.25, t + 0.86, 0.75, 0.20, this.sfxBus);
  }
}
