import { SynthConfig, Waveform } from '../types';
import { MIN_FREQ, MAX_FREQ, DRUM_PATTERNS } from '../constants';

class AudioEngine {
  private ctx: AudioContext | null = null;
  
  // Synth Nodes
  private osc: OscillatorNode | null = null;
  private osc2: OscillatorNode | null = null;
  private vibratoOsc: OscillatorNode | null = null;
  private vibratoGain: GainNode | null = null;
  private distortionNode: WaveShaperNode | null = null;
  private gainNode: GainNode | null = null;
  private filterNode: BiquadFilterNode | null = null;
  private masterGain: GainNode | null = null;
  private delayNode: DelayNode | null = null;
  private feedbackGain: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  
  // Percussion Resources
  private noiseBuffer: AudioBuffer | null = null;
  
  // Sequencer State
  private isPlaying: boolean = false;
  private config: SynthConfig;
  private activeLoops: boolean[] = [false, false, false]; // Kick, Snare, Hat
  private nextNoteTime: number = 0;
  private current16thNote: number = 0;
  private scheduleAheadTime: number = 0.1; // Seconds
  private lookahead: number = 25.0; // Milliseconds
  private timerID: number | null = null;
  
  // Visualization Sync
  private lastDrumTriggers: number[] = [0, 0, 0]; // Timestamp of last actual sound

  // Analysis Data
  private dataArray: Uint8Array | null = null;

  constructor(config: SynthConfig) {
    this.config = config;
  }

  public init() {
    if (this.ctx) return;
    
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    this.ctx = new AudioContextClass();
    
    // Master Gain
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 0.4; 
    this.masterGain.connect(this.ctx.destination);

    // Analyser
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 256; 
    this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
    this.masterGain.connect(this.analyser);

    // Distortion (WaveShaper)
    this.distortionNode = this.ctx.createWaveShaper();
    this.distortionNode.curve = this.makeDistortionCurve(0);
    this.distortionNode.oversample = '4x';

    // Delay Effect
    this.delayNode = this.ctx.createDelay();
    this.feedbackGain = this.ctx.createGain();
    
    this.delayNode.delayTime.value = this.config.delayTime;
    this.feedbackGain.gain.value = this.config.feedback;

    // Routing Chain: Master <- Delay <- Feedback
    this.delayNode.connect(this.feedbackGain);
    this.feedbackGain.connect(this.delayNode);
    this.delayNode.connect(this.masterGain);

    // Generate White Noise Buffer for Drums
    this.createNoiseBuffer();
  }

  // Create a sigmoid distortion curve
  private makeDistortionCurve(amount: number) {
    const k = typeof amount === 'number' ? amount : 50;
    const n_samples = 44100;
    const curve = new Float32Array(n_samples);
    const deg = Math.PI / 180;
    
    // If amount is 0, return linear curve (clean)
    if (amount === 0 || isNaN(amount)) {
        for (let i = 0; i < n_samples; ++i) {
            curve[i] = (i * 2) / n_samples - 1;
        }
        return curve;
    }

    for (let i = 0; i < n_samples; ++i) {
      const x = (i * 2) / n_samples - 1;
      curve[i] = (3 + k) * x * 20 * deg / (Math.PI + k * Math.abs(x));
    }
    return curve;
  }

  private createNoiseBuffer() {
    if (!this.ctx) return;
    const bufferSize = this.ctx.sampleRate * 2; // 2 seconds of noise
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
    }
    this.noiseBuffer = buffer;
  }

  public async resumeContext() {
    if (!this.ctx) this.init();
    if (this.ctx?.state === 'suspended') {
      try {
        await this.ctx.resume();
        console.log("AudioContext resumed.");
      } catch (e) {
        console.error("Failed to resume AudioContext", e);
      }
    }
  }

  public start() {
    if (!this.ctx) this.init();
    this.resumeContext();
    
    if (this.isPlaying || !this.ctx || !this.masterGain || !this.distortionNode) return;

    this.stop(); // Clean start

    const now = this.ctx.currentTime;
    this.nextNoteTime = now; // Start sequencer immediately

    // 1. Oscillators
    this.osc = this.ctx.createOscillator();
    this.osc.type = this.config.waveform;
    this.osc.frequency.setValueAtTime(440, now); 

    this.osc2 = this.ctx.createOscillator();
    this.osc2.type = this.config.waveform;
    this.osc2.frequency.setValueAtTime(440, now);
    this.osc2.detune.value = 8; // Slight detune for thickness

    // 2. LFO (Vibrato)
    this.vibratoOsc = this.ctx.createOscillator();
    this.vibratoOsc.frequency.value = this.config.vibratoSpeed;
    this.vibratoGain = this.ctx.createGain();
    this.vibratoGain.gain.value = this.config.vibratoDepth;
    
    this.vibratoOsc.connect(this.vibratoGain);
    // Connect LFO to detune of both oscillators
    this.vibratoGain.connect(this.osc.detune);
    this.vibratoGain.connect(this.osc2.detune);
    this.vibratoOsc.start(now);

    // 3. Filter
    this.filterNode = this.ctx.createBiquadFilter();
    this.filterNode.type = 'lowpass';
    this.filterNode.frequency.setValueAtTime(2000, now);
    this.filterNode.Q.value = 4;

    // 4. Envelope (VCA)
    this.gainNode = this.ctx.createGain();
    this.gainNode.gain.setValueAtTime(0, now); 

    // ROUTING GRAPH: Osc -> Filter -> Distortion -> Gain -> Master
    this.osc.connect(this.filterNode);
    this.osc2.connect(this.filterNode);
    
    this.filterNode.connect(this.distortionNode);
    this.distortionNode.connect(this.gainNode);
    
    this.gainNode.connect(this.masterGain);

    // Delay Send
    if (this.delayNode && this.feedbackGain) {
      this.gainNode.connect(this.delayNode);
    }

    this.osc.start(now);
    this.osc2.start(now);
    
    this.isPlaying = true;
    
    // Start Sequencer Loop
    this.scheduler();
  }

  public stop() {
    if (!this.isPlaying) return;
    
    // Stop Sequencer
    if (this.timerID) {
        clearTimeout(this.timerID);
        this.timerID = null;
    }

    const now = this.ctx?.currentTime || 0;
    
    if (this.gainNode) {
        this.gainNode.gain.cancelScheduledValues(now);
        this.gainNode.gain.setTargetAtTime(0, now, 0.1);
    }
    
    const stopTime = now + 0.2;

    if (this.osc) {
        this.osc.stop(stopTime);
        this.osc = null;
    }
    if (this.osc2) {
        this.osc2.stop(stopTime);
        this.osc2 = null;
    }
    if (this.vibratoOsc) {
        this.vibratoOsc.stop(stopTime);
        this.vibratoOsc = null;
    }
    
    this.isPlaying = false;
  }

  public updateParams(frequencyRatio: number, volumeRatio: number, delayRatio: number = 0, filterRatio: number = 1) {
    if (!this.ctx || !this.osc || !this.osc2 || !this.gainNode) return;

    const safeFreqRatio = isNaN(frequencyRatio) ? 0.5 : frequencyRatio;
    const safeVolRatio = isNaN(volumeRatio) ? 0 : volumeRatio;

    const now = this.ctx.currentTime;

    // PITCH
    const frequency = MIN_FREQ * Math.pow(MAX_FREQ / MIN_FREQ, safeFreqRatio);
    if(this.osc.frequency) this.osc.frequency.setTargetAtTime(frequency, now, 0.05);
    if(this.osc2.frequency) this.osc2.frequency.setTargetAtTime(frequency, now, 0.05);
    
    // VOLUME (Quadratic curve)
    const curvedVolume = Math.pow(safeVolRatio, 2);
    if(this.gainNode.gain) this.gainNode.gain.setTargetAtTime(curvedVolume, now, 0.05);

    // FILTER (EQ)
    if (this.filterNode) {
        const minFilter = 50;   
        const maxFilter = 15000;
        const cutoff = minFilter * Math.pow(maxFilter / minFilter, filterRatio);
        this.filterNode.frequency.setTargetAtTime(cutoff, now, 0.1);
    }

    // DELAY FEEDBACK
    if (this.feedbackGain) {
        if (this.config.useDelay) {
            const feedbackVal = delayRatio * 0.9; 
            this.feedbackGain.gain.setTargetAtTime(feedbackVal, now, 0.1);
        } else {
            this.feedbackGain.gain.setTargetAtTime(0, now, 0.1);
        }
    }
  }

  // --- SEQUENCER & DRUMS ---

  private nextNote() {
      const secondsPerBeat = 60.0 / this.config.tempo;
      // Advance by a 16th note
      this.nextNoteTime += 0.25 * secondsPerBeat;
      this.current16thNote++;
      if (this.current16thNote === 16) {
          this.current16thNote = 0;
      }
  }

  private scheduleNote(beatNumber: number, time: number) {
      if (!this.ctx) return;

      // Check Active Loops and Pattern
      if (this.activeLoops[0] && DRUM_PATTERNS.KICK[beatNumber]) {
          this.playDrumSound('kick', time);
          this.lastDrumTriggers[0] = time; // For Visuals
      }
      if (this.activeLoops[1] && DRUM_PATTERNS.SNARE[beatNumber]) {
          this.playDrumSound('snare', time);
          this.lastDrumTriggers[1] = time;
      }
      if (this.activeLoops[2] && DRUM_PATTERNS.HAT[beatNumber]) {
          this.playDrumSound('hat', time);
          this.lastDrumTriggers[2] = time;
      }
  }

  private scheduler = () => {
      if (!this.isPlaying || !this.ctx) return;
      
      // Lookahead: Schedule notes that will play in the near future
      while (this.nextNoteTime < this.ctx.currentTime + this.scheduleAheadTime) {
          this.scheduleNote(this.current16thNote, this.nextNoteTime);
          this.nextNote();
      }
      
      this.timerID = window.setTimeout(this.scheduler, this.lookahead);
  }

  public toggleLoop(index: number) {
      if (index >= 0 && index < 3) {
          this.activeLoops[index] = !this.activeLoops[index];
          console.log(`Loop ${index} toggled: ${this.activeLoops[index]}`);
          // If we just turned it on, play a one-shot immediately for feedback
          // Ensure ctx exists before accessing currentTime to prevent crash
          if (this.activeLoops[index] && this.ctx) {
             this.playDrumSound(index === 0 ? 'kick' : index === 1 ? 'snare' : 'hat', this.ctx.currentTime);
          }
      }
  }

  public getDrumStates() {
      return {
          activeLoops: [...this.activeLoops],
          lastTriggers: [...this.lastDrumTriggers]
      };
  }

  private playDrumSound(type: 'kick' | 'snare' | 'hat', time: number) {
    if (!this.ctx || !this.masterGain) return;

    const drumGain = this.ctx.createGain();
    drumGain.connect(this.masterGain);

    if (type === 'kick') {
        const osc = this.ctx.createOscillator();
        osc.frequency.setValueAtTime(180, time);
        osc.frequency.exponentialRampToValueAtTime(0.01, time + 0.4);
        
        drumGain.gain.setValueAtTime(1.0, time);
        drumGain.gain.exponentialRampToValueAtTime(0.001, time + 0.4);
        
        osc.connect(drumGain);
        osc.start(time);
        osc.stop(time + 0.4);
    } else if (type === 'snare') {
        // Noise
        if (this.noiseBuffer) {
            const source = this.ctx.createBufferSource();
            source.buffer = this.noiseBuffer;
            const filter = this.ctx.createBiquadFilter();
            filter.type = 'bandpass';
            filter.frequency.value = 1500;
            source.connect(filter);
            filter.connect(drumGain);
            source.start(time);
            source.stop(time + 0.2);
        }
        // Body (Tone)
        const osc = this.ctx.createOscillator();
        osc.frequency.setValueAtTime(250, time);
        osc.frequency.exponentialRampToValueAtTime(100, time + 0.1);
        const oscGain = this.ctx.createGain();
        oscGain.gain.setValueAtTime(0.4, time);
        oscGain.gain.exponentialRampToValueAtTime(0.01, time + 0.15);
        osc.connect(oscGain);
        oscGain.connect(this.masterGain);
        osc.start(time);
        osc.stop(time + 0.15);
        
        // Envelope
        drumGain.gain.setValueAtTime(0.7, time);
        drumGain.gain.exponentialRampToValueAtTime(0.01, time + 0.2);

    } else if (type === 'hat') {
        if (this.noiseBuffer) {
            const source = this.ctx.createBufferSource();
            source.buffer = this.noiseBuffer;
            const filter = this.ctx.createBiquadFilter();
            filter.type = 'highpass';
            filter.frequency.value = 6000;
            
            source.connect(filter);
            filter.connect(drumGain);
            
            drumGain.gain.setValueAtTime(0.3, time);
            drumGain.gain.exponentialRampToValueAtTime(0.001, time + 0.08);
            
            source.start(time);
            source.stop(time + 0.08);
        }
    }
  }

  public getBeatProgress(): number {
      if (!this.ctx) return 0;
      const secondsPerBeat = 60.0 / this.config.tempo;
      const now = this.ctx.currentTime;
      return (now % secondsPerBeat) / secondsPerBeat;
  }

  public getAudioData(): Uint8Array {
      if (!this.analyser || !this.dataArray) return new Uint8Array(0);
      this.analyser.getByteFrequencyData(this.dataArray);
      return this.dataArray;
  }

  public setConfig(newConfig: SynthConfig) {
    const oldDistortion = this.config.distortion;
    this.config = newConfig;
    const now = this.ctx?.currentTime || 0;

    if (this.osc) this.osc.type = newConfig.waveform;
    if (this.osc2) this.osc2.type = newConfig.waveform;

    if (this.delayNode) {
      this.delayNode.delayTime.setTargetAtTime(newConfig.delayTime, now, 0.1);
    }
    
    // Update Vibrato
    if (this.vibratoOsc && this.vibratoGain) {
        this.vibratoOsc.frequency.setTargetAtTime(newConfig.vibratoSpeed, now, 0.1);
        this.vibratoGain.gain.setTargetAtTime(newConfig.vibratoDepth, now, 0.1);
    }

    // Update Distortion
    if (this.distortionNode && oldDistortion !== newConfig.distortion) {
        this.distortionNode.curve = this.makeDistortionCurve(newConfig.distortion);
    }
  }

  public previewNote() {
      if (!this.ctx || !this.masterGain) return;
      
      const now = this.ctx.currentTime;
      
      // Temporary Osc for preview
      const osc = this.ctx.createOscillator();
      osc.type = this.config.waveform; // Use current waveform
      osc.frequency.value = 330; // E4
      
      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(now);
      osc.stop(now + 0.25);
  }
  
  public playTestTone() {
      if (!this.ctx || !this.masterGain) this.init();
      this.resumeContext().then(() => {
          if (!this.ctx || !this.masterGain) return;
          const osc = this.ctx.createOscillator();
          const gain = this.ctx.createGain();
          osc.connect(gain);
          gain.connect(this.masterGain!);
          gain.gain.setValueAtTime(0.5, this.ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.3);
          osc.start();
          osc.stop(this.ctx.currentTime + 0.3);
      });
  }
}

export default AudioEngine;