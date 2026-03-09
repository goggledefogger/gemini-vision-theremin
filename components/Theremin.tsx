import React, { useEffect, useRef, useState, useCallback } from 'react';
import { FilesetResolver, HandLandmarker, DrawingUtils } from '@mediapipe/tasks-vision';
import AudioEngine from '../services/audioEngine';
import { SynthConfig, Waveform } from '../types';
import { MIN_FREQ, MAX_FREQ } from '../constants';

interface ThereminProps {
  config: SynthConfig;
  isPlaying: boolean;
  onTogglePlay: () => void;
  onConfigChange?: (config: SynthConfig) => void;
}

// Particle System Types
interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
}

const lerp = (start: number, end: number, amt: number) => (1 - amt) * start + amt * end;

const Theremin: React.FC<ThereminProps> = ({ config, isPlaying, onTogglePlay, onConfigChange }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioRef = useRef<AudioEngine | null>(null);
  const landmarkerRef = useRef<HandLandmarker | null>(null);
  const requestRef = useRef<number>(0);
  const isPlayingRef = useRef(isPlaying);
  const configRef = useRef(config);

  // Mode State
  const [editMode, setEditMode] = useState(false);
  const editModeRef = useRef(false);
  const editModeOpacityRef = useRef(0); // For fade transition
  
  // Interaction State
  const hoverTimersRef = useRef<{ [key: string]: number }>({});
  // Track which control is active AND which hand (index) owns it
  const activeControlRef = useRef<{ id: string, handIndex: number } | null>(null); 
  const HOVER_THRESHOLD = 500; // ms to trigger a button
  const GRAB_THRESHOLD = 250; // ms to unlock a slider/pad - slightly faster for better feel

  // Throttling config updates to parent
  const lastConfigUpdateRef = useRef<number>(0);

  // Smoothing state
  const targetFreqRef = useRef(0.5);
  const currentFreqRef = useRef(0.5);
  const targetVolRef = useRef(0.0);
  const currentVolRef = useRef(0.0);
  const targetDelayRef = useRef(0.0);
  const currentDelayRef = useRef(0.0);
  const targetFilterRef = useRef(1.0);
  const currentFilterRef = useRef(1.0);

  // Percussion State
  const drumCooldownsRef = useRef<number[]>([0, 0, 0]); // Kick, Snare, Hat
  const particlesRef = useRef<Particle[]>([]);
  // Store dynamic drum positions for collision detection
  const drumPositionsRef = useRef<{x:number, y:number, r:number}[]>([{x:0,y:0,r:0}, {x:0,y:0,r:0}, {x:0,y:0,r:0}]);
  
  // Track last displayed beat for flash effect
  const lastFlashTimesRef = useRef<number[]>([0, 0, 0]);

  // Audio Analysis Data
  const audioDataRef = useRef<Uint8Array>(new Uint8Array(0));
  
  // HUD positions
  const volHandPosRef = useRef<{x:number, y:number} | null>(null);
  const pitchHandPosRef = useRef<{x:number, y:number} | null>(null);

  // UI State for drawing (updated by logic)
  const uiStateRef = useRef<{ [key: string]: { progress: number, active: boolean } }>({});
  // State for the main toggle button (calculated in loop, drawn in drawVisuals)
  const modeSwitchStateRef = useRef<{ progress: number }>({ progress: 0 });

  const [isLoading, setIsLoading] = useState(true);
  const [cameraError, setCameraError] = useState<string | null>(null);

  useEffect(() => {
    audioRef.current = new AudioEngine(config);
    return () => audioRef.current?.stop();
  }, []); 

  useEffect(() => {
    configRef.current = config;
    if (audioRef.current) {
      audioRef.current.setConfig(config);
    }
  }, [config]);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
    if (isPlaying) audioRef.current?.start();
    else audioRef.current?.stop();
  }, [isPlaying]);

  const handleStartClick = async () => {
    if (audioRef.current) {
      await audioRef.current.resumeContext();
      audioRef.current.playTestTone();
    }
    onTogglePlay();
  };

  const setupMediaPipe = useCallback(async () => {
    try {
      const vision = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm");
      landmarkerRef.current = await HandLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: `https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`,
          delegate: "GPU"
        },
        runningMode: "VIDEO",
        numHands: 2
      });
      startCamera();
    } catch (error) {
      console.error(error);
      setCameraError("Failed to load tracking models.");
      setIsLoading(false);
    }
  }, []);

  const startCamera = async () => {
    if (!videoRef.current) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720, facingMode: "user" } });
      videoRef.current.srcObject = stream;
      videoRef.current.addEventListener('loadeddata', predictWebcam);
      setIsLoading(false);
    } catch (err) {
      setCameraError("Camera access denied.");
      setIsLoading(false);
    }
  };

  // --- LOGIC: UPDATE EDIT STATE ---
  // Calculates collisions and updates config, returns "true" if hand is busy with UI
  const updateEditState = (
      handX: number, 
      handY: number, 
      width: number, 
      height: number, 
      handIndex: number,
      uiStateAccumulator: { [key: string]: { progress: number, active: boolean } }
    ): boolean => {
      
      if (!editModeRef.current) return false;
      const c = configRef.current;
      let isBusy = false;

      // Helper to check collision
      const checkZone = (id: string, x: number, y: number, w: number, h: number, isToggle: boolean = false, isGrab: boolean = false): boolean => {
          const timerKey = `${id}_${handIndex}`; // Namespace timer by hand to avoid conflicts
          const hovering = handX > x && handX < x + w && handY > y && handY < y + h;
          
          // Grabbing Logic (Sliders/Pads)
          if (isGrab) {
              const active = activeControlRef.current;
              // Check if THIS hand owns the control
              const isOwner = active && active.id === id && active.handIndex === handIndex;
              const isOwnedByOther = active && active.id === id && active.handIndex !== handIndex;

              if (isOwnedByOther) {
                  // Another hand is busy with this. We ignore it.
                  return false; 
              }

              // Large buffer zone to prevent accidental drops when moving fast
              const buffer = 150; 
              const inBounds = handX > x - buffer && handX < x + w + buffer && handY > y - buffer && handY < y + h + buffer;
              
              if (isOwner) {
                  isBusy = true; // Hand is "holding" this control
                  if (!inBounds) {
                      activeControlRef.current = null; // Drop
                  }
                  uiStateAccumulator[id] = { progress: 0, active: true };
                  return true; // Is interacting
              } 
              
              // Not owned yet. Check Dwell.
              if (hovering) {
                   isBusy = true; // Hand is considering this control
                   const startTime = hoverTimersRef.current[timerKey] || Date.now();
                   hoverTimersRef.current[timerKey] = startTime;
                   const progress = Math.min(1, (Date.now() - startTime) / GRAB_THRESHOLD);
                   
                   const currentAcc = uiStateAccumulator[id] || { progress: 0, active: false };
                   uiStateAccumulator[id] = { progress: Math.max(progress, currentAcc.progress), active: false };
                   
                   if (progress >= 1) {
                       activeControlRef.current = { id, handIndex };
                       delete hoverTimersRef.current[timerKey];
                       audioRef.current?.previewNote();
                   }
                   return true;
              } else {
                   if (hoverTimersRef.current[timerKey]) {
                       delete hoverTimersRef.current[timerKey];
                   }
                   return false;
              }
          }

          // Button Dwell Logic (One-shot)
          if (hovering) {
              isBusy = true;
              const startTime = hoverTimersRef.current[timerKey] || Date.now();
              hoverTimersRef.current[timerKey] = startTime;
              const progress = Math.min(1, (Date.now() - startTime) / HOVER_THRESHOLD);
              
              const currentAcc = uiStateAccumulator[id] || { progress: 0, active: false };
              uiStateAccumulator[id] = { progress: Math.max(progress, currentAcc.progress), active: false };

              if (progress >= 1) {
                  delete hoverTimersRef.current[timerKey];
                  return true; // Triggered!
              }
          } else {
              delete hoverTimersRef.current[timerKey];
          }
          return false;
      };

      // 1. WAVEFORM
      if (checkZone('wf', 40, 80, 200, 80)) {
          const waves = [Waveform.SINE, Waveform.SQUARE, Waveform.SAWTOOTH, Waveform.TRIANGLE];
          const next = waves[(waves.indexOf(c.waveform) + 1) % waves.length];
          updateConfig({ waveform: next });
          audioRef.current?.previewNote();
      }

      // 2. TOGGLES
      const toggleW = 180, toggleH = 60, toggleX = width - toggleW - 40;
      if (checkZone('drum_tog', toggleX, 80, toggleW, toggleH)) {
          updateConfig({ showPercussion: !c.showPercussion });
          audioRef.current?.playTestTone();
      }
      if (checkZone('del_tog', toggleX, 150, toggleW, toggleH)) {
          updateConfig({ useDelay: !c.useDelay });
          audioRef.current?.playTestTone();
      }
      if (checkZone('q_tog', toggleX, 220, toggleW, toggleH)) {
          updateConfig({ quantizeDrums: !c.quantizeDrums });
          audioRef.current?.playTestTone();
      }

      // 3. ENVELOPE PAD
      const padSize = 200, padY = height - padSize - 40, padX = 40;
      if (checkZone('env_pad', padX, padY, padSize, padSize, false, true)) {
           const active = activeControlRef.current;
           if (active && active.id === 'env_pad' && active.handIndex === handIndex) {
               const att = Math.max(0.01, Math.min(2.0, ((handX - padX) / padSize) * 2.0));
               const rel = Math.max(0.1, Math.min(5.0, (1 - (handY - padY) / padSize) * 5.0));
               updateConfig({ attack: att, release: rel });
           }
      }

      // 4. FX PAD
      const fxX = width - padSize - 40;
      if (checkZone('fx_pad', fxX, padY, padSize, padSize, false, true)) {
          const active = activeControlRef.current;
          if (active && active.id === 'fx_pad' && active.handIndex === handIndex) {
              const dist = Math.max(0, Math.min(100, ((handX - fxX) / padSize) * 100));
              const vib = Math.max(0, Math.min(50, (1 - (handY - padY) / padSize) * 50));
              updateConfig({ distortion: dist, vibratoDepth: vib });
          }
      }

      // 5. TEMPO SLIDER
      const sW = 60, sH = 300, sX = width/2 - sW/2, sY = height/2 - sH/2;
      if (checkZone('tempo', sX, sY, sW, sH, false, true)) {
          const active = activeControlRef.current;
          if (active && active.id === 'tempo' && active.handIndex === handIndex) {
              const ratio = Math.max(0, Math.min(1, 1 - (handY - sY) / sH));
              const bpm = Math.floor(60 + ratio * (200 - 60));
              updateConfig({ tempo: bpm });
          }
      }

      return isBusy;
  };

  const updateConfig = (newConf: Partial<SynthConfig>) => {
      const merged = { ...configRef.current, ...newConf };
      // Throttle React updates to prevent main thread blocking
      const now = Date.now();
      if (now - lastConfigUpdateRef.current > 30) {
          if (onConfigChange) onConfigChange(merged);
          lastConfigUpdateRef.current = now;
      }
      configRef.current = merged;
      audioRef.current?.setConfig(merged);
  };

  // Helper for toggle button which is outside the main updateEditState flow but calculated in main loop
  const checkToggleBtn = (handX: number, handY: number, handIndex: number, bx: number, by: number, bw: number, bh: number) => {
      const id = `mode_switch_${handIndex}`;
      const isHovering = handX > bx && handX < bx + bw && handY > by && handY < by + bh;
      
      if (isHovering) {
          const startTime = hoverTimersRef.current[id] || Date.now();
          hoverTimersRef.current[id] = startTime;
          const progress = Math.min(1, (Date.now() - startTime) / HOVER_THRESHOLD);
          if (progress >= 1) {
              delete hoverTimersRef.current[id];
              return { triggered: true, progress };
          }
          return { triggered: false, progress };
      }
      
      delete hoverTimersRef.current[id];
      return { triggered: false, progress: 0 };
  };

  // --- DRAWING FUNCTIONS ---

  const drawHexagon = (ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, color: string, filled: boolean, lineWidth: number = 2) => {
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
          const angle = (Math.PI / 3) * i - (Math.PI / 6);
          const hx = x + radius * Math.cos(angle);
          const hy = y + radius * Math.sin(angle);
          if (i === 0) ctx.moveTo(hx, hy);
          else ctx.lineTo(hx, hy);
      }
      ctx.closePath();
      if (filled) { ctx.fillStyle = color; ctx.fill(); }
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      ctx.stroke();
  };

  const spawnParticles = (x: number, y: number, color: string) => {
      for(let i=0; i<15; i++) {
          particlesRef.current.push({
              x, y,
              vx: (Math.random() - 0.5) * 10,
              vy: (Math.random() - 0.5) * 10,
              life: 1.0,
              color
          });
      }
  };

  const drawParticles = (ctx: CanvasRenderingContext2D) => {
      for(let i = particlesRef.current.length - 1; i >= 0; i--) {
          const p = particlesRef.current[i];
          p.x += p.vx;
          p.y += p.vy;
          p.life -= 0.05;
          if(p.life <= 0) {
              particlesRef.current.splice(i, 1);
          } else {
              ctx.globalAlpha = p.life;
              ctx.fillStyle = p.color;
              ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fill();
          }
      }
      ctx.globalAlpha = 1;
  };

  const drawGrid = (ctx: CanvasRenderingContext2D, width: number, height: number, beatProgress: number) => {
    const horizon = height * 0.4;
    const centerX = width / 2;
    ctx.save();
    const grad = ctx.createLinearGradient(0, 0, 0, height);
    grad.addColorStop(0, '#09090b');
    grad.addColorStop(0.4, '#09090b');
    grad.addColorStop(1, '#18181b');
    ctx.fillStyle = grad;
    ctx.fillRect(0,0, width, height);

    const opacity = lerp(0.1, 0.05, editModeOpacityRef.current);
    const color = editModeOpacityRef.current > 0.5 ? '217, 70, 239' : '6, 182, 212';
    ctx.strokeStyle = `rgba(${color}, ${opacity})`; 
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = -10; i <= 10; i++) {
        const x = centerX + i * 100;
        ctx.moveTo(centerX, horizon); ctx.lineTo(x * 3, height);
    }
    const gridSize = 50;
    const offset = (beatProgress * gridSize) % gridSize;
    for (let i = 0; i < 20; i++) {
        const y = horizon + (i * gridSize * (i/10)) + offset;
        if (y > height) continue;
        ctx.moveTo(0, y); ctx.lineTo(width, y);
    }
    ctx.stroke();
    ctx.restore();
  };

  const drawEditInterface = (ctx: CanvasRenderingContext2D, width: number, height: number) => {
      const c = configRef.current;
      const opacity = editModeOpacityRef.current;
      if (opacity <= 0.01) return;

      const ui = uiStateRef.current; // Get merged state

      ctx.save();
      ctx.globalAlpha = opacity;

      // Panel Background with glass effect
      const grad = ctx.createLinearGradient(0, 0, width, height);
      grad.addColorStop(0, 'rgba(20, 20, 20, 0.7)');
      grad.addColorStop(1, 'rgba(10, 10, 15, 0.8)');
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.roundRect(10, 10, width - 20, height - 20, 20); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.1)'; ctx.stroke();

      const drawBox = (x:number, y:number, w:number, h:number, label:string, val:string, id:string, isActiveState: boolean) => {
          const state = ui[id] || { progress: 0, active: false };
          const active = state.active || isActiveState;
          
          ctx.fillStyle = active ? 'rgba(217, 70, 239, 0.2)' : 'rgba(255,255,255,0.05)';
          if (state.progress > 0) ctx.fillStyle = `rgba(217, 70, 239, ${0.1 + state.progress * 0.3})`;
          
          ctx.strokeStyle = active ? '#d946ef' : 'rgba(255,255,255,0.2)';
          ctx.lineWidth = active ? 2 : 1;
          
          // Glow if active
          if (active) { ctx.shadowBlur = 15; ctx.shadowColor = '#d946ef'; }
          else ctx.shadowBlur = 0;

          ctx.beginPath(); ctx.roundRect(x, y, w, h, 8); ctx.fill(); ctx.stroke();
          ctx.shadowBlur = 0;

          if (state.progress > 0 && state.progress < 1) {
              ctx.beginPath(); ctx.rect(x, y + h - 4, w * state.progress, 4);
              ctx.fillStyle = '#d946ef'; ctx.fill();
          }

          ctx.fillStyle = '#fff'; ctx.font = '12px monospace'; ctx.textAlign = 'left';
          ctx.fillText(label, x + 10, y + 20);
          ctx.font = 'bold 16px monospace'; ctx.fillStyle = active ? '#d946ef' : '#ccc';
          ctx.fillText(val, x + 10, y + 45);
      };

      // 1. Controls
      drawBox(40, 80, 200, 80, 'OSCILLATOR', c.waveform.toUpperCase(), 'wf', false);
      const tX = width - 220;
      drawBox(tX, 80, 180, 60, 'PERCUSSION', c.showPercussion ? 'ON' : 'OFF', 'drum_tog', c.showPercussion);
      drawBox(tX, 150, 180, 60, 'DELAY FX', c.useDelay ? 'ON' : 'OFF', 'del_tog', c.useDelay);
      drawBox(tX, 220, 180, 60, 'QUANTIZE', c.quantizeDrums ? 'ON' : 'OFF', 'q_tog', c.quantizeDrums);

      // 2. Pads
      const padSize = 200, padY = height - padSize - 40;
      
      // Envelope
      const envState = ui['env_pad'] || { progress: 0, active: false };
      const envActive = activeControlRef.current?.id === 'env_pad';
      ctx.save(); ctx.translate(40, padY);
      ctx.fillStyle = envActive ? 'rgba(217, 70, 239, 0.2)' : 'rgba(0,0,0,0.5)';
      ctx.strokeStyle = envActive ? '#d946ef' : '#555'; ctx.lineWidth = envActive ? 3 : 1;
      if(envActive) { ctx.shadowBlur = 20; ctx.shadowColor = '#d946ef'; }
      ctx.strokeRect(0,0, padSize, padSize); ctx.fillRect(0,0, padSize, padSize);
      ctx.shadowBlur = 0;
      if (envState.progress > 0 && !envActive) {
          ctx.beginPath(); ctx.arc(padSize/2, padSize/2, 30, 0, Math.PI*2*envState.progress);
          ctx.strokeStyle = '#d946ef'; ctx.lineWidth = 4; ctx.stroke();
      }
      ctx.fillStyle = '#fff'; ctx.fillText(envActive ? 'LOCKED: DRAG TO EDIT' : 'HOLD TO EDIT', 5, -10);
      const ex = (c.attack/2.0)*padSize, ey = padSize - (c.release/5.0)*padSize;
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(ex, ey, envActive?8:4, 0, Math.PI*2); ctx.fill();
      
      // Draw curve
      if (envActive) {
          ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1; ctx.beginPath();
          ctx.moveTo(0, padSize); ctx.lineTo(ex, 0); ctx.lineTo(Math.min(padSize, ex + 50), padSize * 0.4); ctx.lineTo(padSize, padSize);
          ctx.stroke();
      }
      ctx.restore();

      // FX
      const fxState = ui['fx_pad'] || { progress: 0, active: false };
      const fxActive = activeControlRef.current?.id === 'fx_pad';
      ctx.save(); ctx.translate(width - padSize - 40, padY);
      ctx.fillStyle = fxActive ? 'rgba(245, 158, 11, 0.2)' : 'rgba(0,0,0,0.5)';
      ctx.strokeStyle = fxActive ? '#f59e0b' : '#555'; ctx.lineWidth = fxActive ? 3 : 1;
      if(fxActive) { ctx.shadowBlur = 20; ctx.shadowColor = '#f59e0b'; }
      ctx.strokeRect(0,0, padSize, padSize); ctx.fillRect(0,0, padSize, padSize);
      ctx.shadowBlur = 0;
      if (fxState.progress > 0 && !fxActive) {
          ctx.beginPath(); ctx.arc(padSize/2, padSize/2, 30, 0, Math.PI*2*fxState.progress);
          ctx.strokeStyle = '#f59e0b'; ctx.lineWidth = 4; ctx.stroke();
      }
      ctx.fillStyle = '#fff'; ctx.fillText(fxActive ? 'LOCKED: DRAG TO EDIT' : 'HOLD TO EDIT', 5, -10);
      const dx = (c.distortion/100)*padSize, vy = padSize - (c.vibratoDepth/50)*padSize;
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(dx, vy, fxActive?8:4, 0, Math.PI*2); ctx.fill();
      ctx.restore();

      // Slider
      const sW = 60, sH = 300, sX = width/2 - sW/2, sY = height/2 - sH/2;
      const tState = ui['tempo'] || { progress: 0, active: false };
      const tActive = activeControlRef.current?.id === 'tempo';
      ctx.fillStyle = tActive ? 'rgba(6, 182, 212, 0.2)' : 'rgba(255,255,255,0.1)';
      ctx.strokeStyle = tActive ? '#06b6d4' : 'transparent'; ctx.lineWidth = 2;
      if(tActive) { ctx.shadowBlur = 20; ctx.shadowColor = '#06b6d4'; }
      ctx.beginPath(); ctx.roundRect(sX, sY, sW, sH, 30); ctx.fill(); ctx.stroke();
      ctx.shadowBlur = 0;
      if (tState.progress > 0 && !tActive) {
          ctx.beginPath(); ctx.arc(width/2, sY + sH/2, 40, 0, Math.PI*2*tState.progress);
          ctx.strokeStyle = '#06b6d4'; ctx.lineWidth = 4; ctx.stroke();
      }
      const ty = sY + sH - ((c.tempo-60)/(200-60))*sH;
      ctx.fillStyle = tActive ? '#fff' : '#06b6d4'; ctx.beginPath(); ctx.arc(width/2, ty, tActive?22:18, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = '12px monospace'; ctx.textAlign = 'center'; ctx.fillText(`${c.tempo} BPM`, width/2, sY - 15);
      ctx.restore();
  };

  const drawDrumZones = (ctx: CanvasRenderingContext2D, width: number, height: number, beatProgress: number, drumStates: { activeLoops: boolean[], lastTriggers: number[] }) => {
      if (!configRef.current.showPercussion || editModeOpacityRef.current > 0.8) return;
      
      const time = Date.now() / 1000;
      const zones = ['KICK', 'SNARE', 'HI-HAT'];
      const colors = ['#f43f5e', '#f59e0b', '#10b981'];
      const pulse = Math.max(0, 1 - (beatProgress * 5)); 
      const baseRadius = 35;

      zones.forEach((name, i) => {
          // Movement Logic
          const t = time * (0.3 + i * 0.1);
          const xRange = width * 0.7; 
          const yRange = height * 0.7;
          const ox = Math.sin(t + i * 2) * (xRange / 2);
          const oy = Math.cos(t * 1.3 + i) * (yRange / 2);
          const x = width/2 + ox; 
          const y = height/2 + oy;
          drumPositionsRef.current[i] = { x, y, r: baseRadius * 1.5 }; // Update for collision
          
          const isActive = drumStates.activeLoops[i];
          const lastTrigger = drumStates.lastTriggers[i];
          
          // Flash Detection (If triggered in the last 100ms)
          const nowAudio = audioRef.current ? audioRef.current['ctx']?.currentTime || 0 : 0;
          const isFlashing = (nowAudio - lastTrigger) < 0.1 && (nowAudio - lastTrigger) >= 0;

          if (isFlashing && lastFlashTimesRef.current[i] !== lastTrigger) {
              // Trigger particles on audio flash
              spawnParticles(x, y, colors[i]);
              lastFlashTimesRef.current[i] = lastTrigger;
          }

          ctx.save();
          // Active Loop Halo
          if (isActive) {
              ctx.strokeStyle = colors[i];
              ctx.lineWidth = 2;
              ctx.beginPath();
              ctx.arc(x, y, baseRadius * 1.8, time * 5, time * 5 + Math.PI * 1.5);
              ctx.stroke();
          }

          const radius = isFlashing ? baseRadius * 1.3 : baseRadius + (pulse * 5);
          ctx.shadowBlur = isFlashing ? 50 : (isActive ? 20 : (pulse * 15)); 
          ctx.shadowColor = colors[i];
          
          drawHexagon(ctx, x, y, radius, colors[i], isFlashing || isActive, 2);
          
          if (!isActive && !isFlashing) { 
              ctx.beginPath(); ctx.arc(x, y, radius * 0.6, time+i, time+i+Math.PI); ctx.stroke(); 
          }
          
          ctx.fillStyle = '#fff'; ctx.shadowBlur = 0; ctx.font = 'bold 12px monospace'; ctx.textAlign = 'center'; 
          ctx.fillText(name, x, y + 5);
          if (isActive) {
              ctx.font = '9px monospace'; ctx.fillText('LOOPING', x, y + 18);
          }
          ctx.restore();
      });
  };

  const drawSmartGuides = (ctx: CanvasRenderingContext2D, x: number, y: number, color: string, t: string, b: string, l: string, r: string) => {
      ctx.save(); ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 1.5;
      const size = 50;
      ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.stroke();
      ctx.font = '10px monospace'; ctx.textAlign = 'center';
      const arrow = (x1:number, y1:number, x2:number, y2:number) => { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); };
      arrow(x, y-10, x, y-size); ctx.fillText(t, x, y - size - 5);
      arrow(x, y+10, x, y+size); ctx.fillText(b, x, y + size + 12);
      arrow(x-10, y, x-size, y); ctx.textAlign = 'right'; ctx.fillText(l, x - size - 5, y + 3);
      arrow(x+10, y, x+size, y); ctx.textAlign = 'left'; ctx.fillText(r, x + size + 5, y + 3);
      ctx.restore();
  };

  const drawVisuals = (ctx: CanvasRenderingContext2D, width: number, height: number, volHandDetected: boolean, pitchHandDetected: boolean, handCursors: {x:number, y:number}[]) => {
    const centerX = width / 2;
    const beatProgress = audioRef.current ? audioRef.current.getBeatProgress() : 0;
    const drumStates = audioRef.current ? audioRef.current.getDrumStates() : { activeLoops: [false,false,false], lastTriggers: [0,0,0] };

    // Background
    drawGrid(ctx, width, height, beatProgress);

    // Edit Mode Layer
    drawEditInterface(ctx, width, height);

    // Play Mode Layer (Fade out when editing)
    if (editModeOpacityRef.current < 1) {
        ctx.save();
        ctx.globalAlpha = 1 - editModeOpacityRef.current;
        
        drawDrumZones(ctx, width, height, beatProgress, drumStates);
        drawParticles(ctx);
        
        if (volHandDetected) {
            const grad = ctx.createRadialGradient(0, height, 0, 0, height, width/1.5);
            grad.addColorStop(0, `rgba(217, 70, 239, 0.2)`); grad.addColorStop(1, 'transparent');
            ctx.fillStyle = grad; ctx.fillRect(0, 0, centerX, height);
            if(volHandPosRef.current) drawSmartGuides(ctx, volHandPosRef.current.x, volHandPosRef.current.y, '#d946ef', 'MAX VOL', 'MIN VOL', 'MAX DELAY', 'DRY');
        }
        if (pitchHandDetected) {
            const grad = ctx.createRadialGradient(width, height, 0, width, height, width/1.5);
            grad.addColorStop(0, `rgba(6, 182, 212, 0.2)`); grad.addColorStop(1, 'transparent');
            ctx.fillStyle = grad; ctx.fillRect(centerX, 0, centerX, height);
            if(pitchHandPosRef.current) drawSmartGuides(ctx, pitchHandPosRef.current.x, pitchHandPosRef.current.y, '#06b6d4', 'BRIGHT', 'MUFFLED', 'LOW PITCH', 'HIGH PITCH');
        }
        
        // Signal Cable
        if (volHandPosRef.current && pitchHandPosRef.current) {
            const p1 = volHandPosRef.current, p2 = pitchHandPosRef.current;
            ctx.strokeStyle = `rgba(255, 255, 255, ${0.2+currentVolRef.current*0.8})`;
            ctx.lineWidth = 3; ctx.shadowBlur = 10; ctx.shadowColor = '#06b6d4';
            ctx.beginPath(); ctx.moveTo(p1.x, p1.y);
            ctx.quadraticCurveTo((p1.x+p2.x)/2, (p1.y+p2.y)/2 + 200, p2.x, p2.y);
            ctx.stroke();
        }
        ctx.restore();
    }

    // Toggle Button (Always on top)
    const btnW = 140, btnH = 40;
    const btnX = width - btnW - 30; 
    const btnY = (height / 2) - (btnH / 2);

    // Use state accumulated from the loop
    const modeState = modeSwitchStateRef.current;
    
    ctx.fillStyle = editModeRef.current ? 'rgba(217, 70, 239, 0.8)' : 'rgba(6, 182, 212, 0.8)';
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.roundRect(btnX, btnY, btnW, btnH, 20); ctx.fill(); ctx.stroke();
    if (modeState.progress > 0) {
       ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.roundRect(btnX, btnY, btnW * modeState.progress, btnH, 20); ctx.fill();
    }
    
    ctx.fillStyle = modeState.progress > 0.5 ? '#000' : '#fff'; ctx.font = 'bold 14px monospace'; ctx.textAlign = 'center';
    ctx.fillText(editModeRef.current ? 'CLOSE EDIT' : 'OPEN CONTROLS', btnX + btnW/2, btnY + 25);

    // Cursors
    handCursors.forEach(cursor => {
        ctx.fillStyle = editModeRef.current ? '#d946ef' : '#fff';
        ctx.shadowBlur = 10; ctx.shadowColor = ctx.fillStyle;
        ctx.beginPath(); ctx.arc(cursor.x, cursor.y, 8, 0, Math.PI*2); ctx.fill();
    });
  };

  // --- MAIN LOOP ---

  const predictWebcam = () => {
    if (!videoRef.current || !canvasRef.current || !landmarkerRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (canvas.width !== videoRef.current.videoWidth) {
        canvas.width = videoRef.current.videoWidth;
        canvas.height = videoRef.current.videoHeight;
    }

    const result = landmarkerRef.current.detectForVideo(videoRef.current, performance.now());
    if (audioRef.current) audioDataRef.current = audioRef.current.getAudioData();

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    editModeOpacityRef.current = lerp(editModeOpacityRef.current, editModeRef.current ? 1.0 : 0.0, 0.1);

    let pitchHandFound = false;
    let volHandFound = false;
    const handCursors: {x:number, y:number}[] = [];

    // Reset UI State Accumulator for this frame
    const uiStateAccumulator: { [key: string]: { progress: number, active: boolean } } = {};
    let maxModeSwitchProgress = 0;
    let modeSwitchTriggered = false;

    if (result.landmarks) {
      const drawingUtils = new DrawingUtils(ctx);
      
      // Process Hands
      result.landmarks.forEach((landmarks, index) => {
        let trackX, trackY;
        // Simple visualization
        ctx.save(); ctx.scale(-1, 1); ctx.translate(-canvas.width, 0);
        if (configRef.current.trackingMode === 'finger') {
            trackX = landmarks[8].x; trackY = landmarks[8].y;
            drawingUtils.drawConnectors(landmarks, HandLandmarker.HAND_CONNECTIONS, { color: "rgba(255,255,255,0.1)", lineWidth: 1 });
        } else {
            trackX = landmarks.reduce((acc, l) => acc + l.x, 0) / landmarks.length;
            trackY = landmarks.reduce((acc, l) => acc + l.y, 0) / landmarks.length;
            drawingUtils.drawConnectors(landmarks, HandLandmarker.HAND_CONNECTIONS, { color: "rgba(255,255,255,0.2)", lineWidth: 1 });
        }
        ctx.restore();

        const mirroredX = (1 - trackX) * canvas.width;
        const screenY = trackY * canvas.height;
        handCursors.push({x: mirroredX, y: screenY});

        // 1. CHECK UI INTERACTION
        let isHandBusy = false;
        
        // Mode Switch Button Logic (Check for ALL hands)
        const btnW = 140, btnH = 40;
        const btnX = canvas.width - btnW - 30; 
        const btnY = (canvas.height / 2) - (btnH / 2);
        
        const modeState = checkToggleBtn(mirroredX, screenY, index, btnX, btnY, btnW, btnH);
        if (modeState.progress > maxModeSwitchProgress) maxModeSwitchProgress = modeState.progress;
        if (modeState.triggered) modeSwitchTriggered = true;

        if (editModeRef.current) {
            // Pass the accumulator to merge states from all hands
            const uiBusy = updateEditState(mirroredX, screenY, canvas.width, canvas.height, index, uiStateAccumulator);
            isHandBusy = isHandBusy || uiBusy;
        }

        // 2. IF NOT BUSY, PLAY INSTRUMENT
        // Logic check: if interacting with mode switch, we are also busy
        if (modeState.progress > 0) isHandBusy = true;

        if (!isHandBusy) {
            // Percussion (Loop Toggling)
            if (configRef.current.showPercussion && !editModeRef.current) { 
                drumPositionsRef.current.forEach((pos, idx) => {
                    if (Math.hypot(mirroredX - pos.x, screenY - pos.y) < pos.r) {
                        const now = Date.now();
                        // Longer cooldown for loop toggling to prevent flickering on/off
                        if (now - drumCooldownsRef.current[idx] > 500) {
                             audioRef.current?.toggleLoop(idx);
                             drumCooldownsRef.current[idx] = now;
                        }
                    }
                });
            }

            // Synth
            if (trackX > 0.5) {
                volHandFound = true;
                volHandPosRef.current = { x: mirroredX, y: screenY };
                targetVolRef.current = Math.max(0, Math.min(1, 1 - trackY));
                targetDelayRef.current = Math.max(0, Math.min(1, 1 - (mirroredX / (canvas.width/2))));
            } else {
                pitchHandFound = true;
                pitchHandPosRef.current = { x: mirroredX, y: screenY };
                targetFreqRef.current = Math.max(0, Math.min(1, (mirroredX - canvas.width/2) / (canvas.width/2)));
                targetFilterRef.current = Math.max(0, Math.min(1, 1 - trackY));
            }
        }
      });
    }

    // Commit the accumulated UI state to the ref for rendering
    uiStateRef.current = uiStateAccumulator;
    modeSwitchStateRef.current = { progress: maxModeSwitchProgress };

    if (modeSwitchTriggered) {
        setEditMode(!editModeRef.current);
        editModeRef.current = !editModeRef.current;
        // Reset state when toggling
        activeControlRef.current = null;
        uiStateRef.current = {};
    }

    if (!volHandFound) volHandPosRef.current = null;
    if (!pitchHandFound) pitchHandPosRef.current = null;

    // Smooth Update
    if (!volHandFound) targetVolRef.current = 0; 
    const smooth = 0.15;
    currentFreqRef.current = lerp(currentFreqRef.current, targetFreqRef.current, smooth);
    currentVolRef.current = lerp(currentVolRef.current, targetVolRef.current, smooth);
    currentDelayRef.current = lerp(currentDelayRef.current, targetDelayRef.current, smooth);
    currentFilterRef.current = lerp(currentFilterRef.current, targetFilterRef.current, smooth);

    if (audioRef.current && isPlayingRef.current) {
        audioRef.current.updateParams(currentFreqRef.current, currentVolRef.current, currentDelayRef.current, currentFilterRef.current);
    }

    drawVisuals(ctx, canvas.width, canvas.height, volHandFound, pitchHandFound, handCursors);
    requestRef.current = requestAnimationFrame(predictWebcam);
  };

  useEffect(() => { setupMediaPipe(); return () => { if (requestRef.current) cancelAnimationFrame(requestRef.current); }; }, [setupMediaPipe]);

  return (
    <div className="relative w-full max-w-4xl mx-auto aspect-video bg-zinc-900 rounded-xl overflow-hidden shadow-2xl border border-zinc-800 ring-1 ring-white/10 group">
      {isLoading && <div className="absolute inset-0 flex items-center justify-center z-50 bg-black/80"><div className="text-cyan-400 font-mono animate-pulse">INITIALIZING VISION SYSTEM...</div></div>}
      {cameraError && <div className="absolute inset-0 flex items-center justify-center z-50 bg-red-950/80 text-red-200">{cameraError}</div>}
      <video ref={videoRef} className="absolute inset-0 w-full h-full object-cover scale-x-[-1] opacity-30 mix-blend-screen" autoPlay playsInline muted />
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full object-cover z-10" />
      {!isPlaying && !isLoading && !cameraError && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm z-40">
          <button onClick={handleStartClick} className="px-10 py-5 bg-gradient-to-r from-cyan-600 to-blue-600 text-white font-bold tracking-widest rounded shadow-2xl border border-cyan-400/30 hover:scale-105 transition-transform">INITIALIZE SYSTEM</button>
        </div>
      )}
    </div>
  );
};

export default Theremin;