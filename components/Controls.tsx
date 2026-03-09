import React from 'react';
import { SynthConfig, Waveform } from '../types';
import { Sliders, Activity, Zap, Mic2, Fingerprint, Drum, Waves, Gauge } from 'lucide-react';

interface ControlsProps {
  config: SynthConfig;
  onConfigChange: (newConfig: SynthConfig) => void;
}

const Controls: React.FC<ControlsProps> = ({ config, onConfigChange }) => {
  
  const handleChange = (key: keyof SynthConfig, value: any) => {
    onConfigChange({ ...config, [key]: value });
  };

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 w-full max-w-4xl mx-auto mt-6 shadow-xl">
      <div className="flex items-center gap-2 mb-6 border-b border-zinc-800 pb-4">
        <Sliders className="w-5 h-5 text-cyan-500" />
        <h2 className="text-lg font-bold text-zinc-100">Synth & Sequencer Control</h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
        
        {/* Playability & Percussion */}
        <div className="space-y-4">
           <label className="text-xs font-mono text-zinc-400 uppercase tracking-wider flex items-center gap-2">
             <Fingerprint className="w-3 h-3" /> Playability
           </label>
           
           <div className="flex flex-col gap-3">
             <div className="bg-zinc-800 p-2 rounded space-y-2">
                <div className="flex items-center justify-between">
                    <span className="text-xs text-zinc-300 flex items-center gap-2">
                        <Drum className="w-3 h-3" /> Percussion
                    </span>
                    <input 
                      type="checkbox"
                      checked={config.showPercussion}
                      onChange={(e) => handleChange('showPercussion', e.target.checked)}
                      className="w-4 h-4 rounded border-zinc-600 accent-cyan-500"
                    />
                </div>
                {config.showPercussion && (
                   <div className="flex items-center justify-between pl-2 border-l-2 border-zinc-700">
                        <span className="text-[10px] text-zinc-400">Quantize (Tempo)</span>
                        <input 
                          type="checkbox"
                          checked={config.quantizeDrums}
                          onChange={(e) => handleChange('quantizeDrums', e.target.checked)}
                          className="w-3 h-3 rounded border-zinc-600 accent-cyan-500"
                        />
                   </div>
                )}
             </div>

             {config.showPercussion && (
                <div className="bg-zinc-800 p-2 rounded">
                   <div className="flex justify-between text-xs text-zinc-500 mb-1">
                      <span>Tempo</span>
                      <span>{config.tempo} BPM</span>
                   </div>
                   <input 
                      type="range" min="60" max="200" step="1"
                      value={config.tempo}
                      onChange={(e) => handleChange('tempo', parseInt(e.target.value))}
                      className="w-full h-1 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-cyan-500"
                    />
                </div>
             )}
             
             <div className="flex flex-col gap-1 bg-zinc-800 p-2 rounded">
                 <span className="text-xs text-zinc-400 mb-1">Tracking Mode</span>
                 <div className="flex gap-1">
                     <button 
                        onClick={() => handleChange('trackingMode', 'hand')}
                        className={`flex-1 text-xs py-1 rounded ${config.trackingMode === 'hand' ? 'bg-cyan-700 text-white' : 'bg-zinc-700 text-zinc-400'}`}
                     >
                        HAND
                     </button>
                     <button 
                        onClick={() => handleChange('trackingMode', 'finger')}
                        className={`flex-1 text-xs py-1 rounded ${config.trackingMode === 'finger' ? 'bg-cyan-700 text-white' : 'bg-zinc-700 text-zinc-400'}`}
                     >
                        FINGER
                     </button>
                 </div>
             </div>
           </div>
        </div>

        {/* Oscillator & Modular FX */}
        <div className="space-y-4">
          <label className="text-xs font-mono text-zinc-400 uppercase tracking-wider flex items-center gap-2">
            <Activity className="w-3 h-3" /> Modular Core
          </label>
          <div className="grid grid-cols-2 gap-2 mb-3">
            {Object.values(Waveform).map((wave) => (
              <button
                key={wave}
                onClick={() => handleChange('waveform', wave)}
                className={`px-3 py-2 text-[10px] uppercase rounded border transition-all ${
                  config.waveform === wave
                    ? 'bg-cyan-900/50 border-cyan-500 text-cyan-300'
                    : 'bg-zinc-800 border-zinc-700 text-zinc-400'
                }`}
              >
                {wave}
              </button>
            ))}
          </div>

          {/* Distortion */}
          <div>
            <div className="flex justify-between text-xs text-zinc-500 mb-1">
              <span className="flex items-center gap-1"><Zap className="w-3 h-3"/> Drive</span>
              <span>{config.distortion}%</span>
            </div>
            <input 
              type="range" min="0" max="100"
              value={config.distortion}
              onChange={(e) => handleChange('distortion', parseInt(e.target.value))}
              className="w-full h-1 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-orange-500"
            />
          </div>

          {/* Vibrato */}
          <div>
            <div className="flex justify-between text-xs text-zinc-500 mb-1">
              <span className="flex items-center gap-1"><Waves className="w-3 h-3"/> Vibrato</span>
              <span>{config.vibratoDepth > 0 ? 'ON' : 'OFF'}</span>
            </div>
            <div className="flex gap-1">
                <input 
                  type="range" min="0" max="50"
                  value={config.vibratoDepth}
                  onChange={(e) => handleChange('vibratoDepth', parseInt(e.target.value))}
                  className="flex-1 h-1 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-pink-500"
                />
            </div>
          </div>
        </div>

        {/* Envelope Section */}
        <div className="space-y-4">
          <label className="text-xs font-mono text-zinc-400 uppercase tracking-wider flex items-center gap-2">
            <Gauge className="w-3 h-3" /> Envelope (ADSR)
          </label>
          <div className="space-y-3">
             <div>
                <div className="flex justify-between text-xs text-zinc-500 mb-1">
                  <span>Attack</span>
                  <span>{config.attack}s</span>
                </div>
                <input 
                  type="range" min="0.01" max="2" step="0.01"
                  value={config.attack}
                  onChange={(e) => handleChange('attack', parseFloat(e.target.value))}
                  className="w-full h-1 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-cyan-500"
                />
             </div>
             <div>
                <div className="flex justify-between text-xs text-zinc-500 mb-1">
                  <span>Release</span>
                  <span>{config.release}s</span>
                </div>
                <input 
                  type="range" min="0.1" max="5" step="0.1"
                  value={config.release}
                  onChange={(e) => handleChange('release', parseFloat(e.target.value))}
                  className="w-full h-1 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-cyan-500"
                />
             </div>
          </div>
        </div>

        {/* Delay FX Section */}
        <div className="space-y-4">
          <label className="text-xs font-mono text-zinc-400 uppercase tracking-wider flex items-center gap-2">
            <Mic2 className="w-3 h-3" /> Delay FX
          </label>
          <div className="flex items-center gap-2 mb-2">
            <input 
              type="checkbox"
              checked={config.useDelay}
              onChange={(e) => handleChange('useDelay', e.target.checked)}
              className="w-4 h-4 rounded border-zinc-600 text-cyan-600 bg-zinc-800"
            />
            <span className="text-sm text-zinc-300">Enable Delay</span>
          </div>
          <div className={`space-y-3 transition-opacity ${config.useDelay ? 'opacity-100' : 'opacity-40 pointer-events-none'}`}>
             <div>
                <div className="flex justify-between text-xs text-zinc-500 mb-1">
                  <span>Time</span>
                  <span>{config.delayTime}s</span>
                </div>
                <input 
                  type="range" min="0" max="1" step="0.05"
                  value={config.delayTime}
                  onChange={(e) => handleChange('delayTime', parseFloat(e.target.value))}
                  className="w-full h-1 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-purple-500"
                />
             </div>
             <div>
                <div className="flex justify-between text-xs text-zinc-500 mb-1">
                  <span>Feedback</span>
                  <span>{Math.round(config.feedback * 100)}%</span>
                </div>
                <input 
                  type="range" min="0" max="0.9" step="0.05"
                  value={config.feedback}
                  onChange={(e) => handleChange('feedback', parseFloat(e.target.value))}
                  className="w-full h-1 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-purple-500"
                />
             </div>
          </div>
        </div>

      </div>
    </div>
  );
};

export default Controls;