import React, { useState } from 'react';
import { generateSynthConfig } from '../services/geminiService';
import { SynthConfig } from '../types';
import { Sparkles, Loader2, Wand2 } from 'lucide-react';

interface AIPresetGeneratorProps {
  onConfigGenerated: (config: SynthConfig) => void;
}

const AIPresetGenerator: React.FC<AIPresetGeneratorProps> = ({ onConfigGenerated }) => {
  const [prompt, setPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim()) return;

    setIsGenerating(true);
    setError(null);

    try {
      const config = await generateSynthConfig(prompt);
      onConfigGenerated(config);
    } catch (err) {
      console.error(err);
      setError("Failed to generate preset. Please try again.");
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="w-full max-w-4xl mx-auto mt-6">
       <div className="bg-gradient-to-r from-zinc-900 to-zinc-900 border border-zinc-800 rounded-xl p-6 relative overflow-hidden">
          {/* Decorative background glow */}
          <div className="absolute top-0 right-0 w-64 h-64 bg-cyan-500/5 blur-[100px] rounded-full pointer-events-none"></div>

          <div className="relative z-10">
             <div className="flex items-center gap-2 mb-4">
               <Sparkles className="w-5 h-5 text-yellow-500" />
               <h2 className="text-lg font-bold text-zinc-100">AI Synth Designer</h2>
             </div>
             
             <p className="text-zinc-400 text-sm mb-4">
               Describe a sound or mood, and Gemini will configure the synthesizer for you.
             </p>

             <form onSubmit={handleSubmit} className="flex gap-2">
                <input 
                  type="text"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="e.g., 'Retro sci-fi laser', 'Peaceful underwater', 'Angry robot bees'"
                  className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-4 py-3 text-zinc-200 placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                  disabled={isGenerating}
                />
                <button 
                  type="submit"
                  disabled={isGenerating || !prompt.trim()}
                  className={`px-6 py-3 rounded-lg font-bold flex items-center gap-2 transition-all ${
                    isGenerating 
                      ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed' 
                      : 'bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white shadow-lg shadow-cyan-900/20'
                  }`}
                >
                  {isGenerating ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Designing...
                    </>
                  ) : (
                    <>
                      <Wand2 className="w-4 h-4" />
                      Generate
                    </>
                  )}
                </button>
             </form>

             {error && (
               <p className="mt-2 text-red-400 text-xs">{error}</p>
             )}
          </div>
       </div>
    </div>
  );
};

export default AIPresetGenerator;
