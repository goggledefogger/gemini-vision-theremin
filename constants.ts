import { SynthConfig, Waveform } from './types';

export const INITIAL_SYNTH_CONFIG: SynthConfig = {
  waveform: Waveform.SAWTOOTH, // Sawtooth sounds better with filters
  attack: 0.1,
  decay: 0.1,
  sustain: 0.6,
  release: 0.3,
  useDelay: true,
  delayTime: 0.3,
  feedback: 0.4,
  useReverb: false,
  showPercussion: true,
  trackingMode: 'hand', 
  // Modular Defaults
  vibratoSpeed: 5,
  vibratoDepth: 0,
  distortion: 0,
  // Sequencer Defaults
  tempo: 120,
  quantizeDrums: true,
};

// Map frequencies for a playable range 
// Widened range: C2 (65.41Hz) to C6 (1046.50Hz) for 4 octaves of expression
export const MIN_FREQ = 65.41;
export const MAX_FREQ = 1046.50;

// MIDI constants
export const MIN_MIDI_NOTE = 36; // C2
export const MAX_MIDI_NOTE = 84; // C6

// Sequencer Patterns (1 = Hit, 0 = Rest) - 16 steps (1 bar)
export const DRUM_PATTERNS = {
  // Classic 4-on-the-floor
  KICK:  [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 
  // Standard Backbeat
  SNARE: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
  // Driving 8ths with some syncopation
  HAT:   [1, 0, 1, 0, 1, 0, 1, 1, 1, 0, 1, 0, 1, 0, 1, 1],
};