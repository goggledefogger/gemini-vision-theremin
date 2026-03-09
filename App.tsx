import React, { useState } from 'react';
import Theremin from './components/Theremin';
import Controls from './components/Controls';
import AIPresetGenerator from './components/AIPresetGenerator';
import { INITIAL_SYNTH_CONFIG } from './constants';
import { SynthConfig } from './types';
import { Music4 } from 'lucide-react';

const App: React.FC = () => {
  const [synthConfig, setSynthConfig] = useState<SynthConfig>(INITIAL_SYNTH_CONFIG);
  const [isPlaying, setIsPlaying] = useState(false);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 selection:bg-cyan-500/30">
      <header className="border-b border-zinc-800 bg-zinc-900/50 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-lg flex items-center justify-center shadow-lg shadow-cyan-500/20">
              <Music4 className="text-white w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">Gemini Vision Theremin</h1>
              <p className="text-xs text-zinc-400 font-mono">POWERED BY GOOGLE GENAI & MEDIAPIPE</p>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
             <div className="hidden md:flex items-center gap-2 text-xs font-mono text-zinc-500 border border-zinc-800 rounded-full px-3 py-1">
                <span className={`w-2 h-2 rounded-full ${isPlaying ? 'bg-green-500 animate-pulse' : 'bg-zinc-600'}`}></span>
                {isPlaying ? 'AUDIO ACTIVE' : 'READY'}
             </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8 pb-24">
        
        {/* Top Section: Camera & Instrument */}
        <Theremin 
          config={synthConfig}
          isPlaying={isPlaying}
          onTogglePlay={() => setIsPlaying(!isPlaying)}
          onConfigChange={setSynthConfig}
        />

        {/* Middle Section: AI Generation */}
        <AIPresetGenerator 
          onConfigGenerated={(newConfig) => {
            setSynthConfig(newConfig);
          }}
        />

        {/* Bottom Section: Manual Controls */}
        <Controls 
          config={synthConfig} 
          onConfigChange={setSynthConfig} 
        />

      </main>

      <footer className="border-t border-zinc-900 bg-black py-8 mt-12">
         <div className="max-w-7xl mx-auto px-4 text-center">
            <p className="text-zinc-600 text-sm">
               Concept: Webcam detects hands -> Maps to Frequency/Volume -> WebAudio Oscillator.
            </p>
            <p className="text-zinc-700 text-xs mt-2 font-mono">
               Latent Space Instruments © {new Date().getFullYear()}
            </p>
         </div>
      </footer>
    </div>
  );
};

export default App;