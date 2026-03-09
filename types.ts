export enum Waveform {
  SINE = 'sine',
  SQUARE = 'square',
  SAWTOOTH = 'sawtooth',
  TRIANGLE = 'triangle',
}

export interface SynthConfig {
  waveform: Waveform;
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  useDelay: boolean;
  delayTime: number;
  feedback: number;
  useReverb: boolean;
  // Visual & Playability
  showPercussion: boolean;
  trackingMode: 'hand' | 'finger';
  // Modular Effects
  vibratoSpeed: number; // Hz
  vibratoDepth: number; // Cents
  distortion: number; // 0-100
  // Sequencer
  tempo: number; // BPM
  quantizeDrums: boolean;
}

// Hand tracking simplified types
export interface Point {
  x: number;
  y: number;
  z?: number;
}

export interface HandLandmark {
  x: number;
  y: number;
}