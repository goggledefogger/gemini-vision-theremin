import { GoogleGenAI, Type } from "@google/genai";
import { SynthConfig, Waveform } from '../types';

export const generateSynthConfig = async (description: string): Promise<SynthConfig> => {
  if (!process.env.API_KEY) {
    throw new Error("API Key not found");
  }

  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: `Generate a synthesizer configuration based on this description: "${description}".
    
    Think about how a ${description} would sound.
    - 'Spooky' might use a Sine or Triangle wave with lots of reverb/delay.
    - '8-bit' would be Square wave with no reverb.
    - 'Aggressive' might be Sawtooth.
    
    Return a JSON object.`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          waveform: {
            type: Type.STRING,
            enum: [Waveform.SINE, Waveform.SQUARE, Waveform.SAWTOOTH, Waveform.TRIANGLE],
            description: "The shape of the oscillator waveform."
          },
          attack: { type: Type.NUMBER, description: "Attack time in seconds (0.01 to 2.0)" },
          decay: { type: Type.NUMBER, description: "Decay time in seconds (0.01 to 2.0)" },
          sustain: { type: Type.NUMBER, description: "Sustain level (0.0 to 1.0)" },
          release: { type: Type.NUMBER, description: "Release time in seconds (0.01 to 5.0)" },
          useDelay: { type: Type.BOOLEAN, description: "Whether to enable delay effect" },
          delayTime: { type: Type.NUMBER, description: "Delay time in seconds (0.0 to 1.0)" },
          feedback: { type: Type.NUMBER, description: "Delay feedback amount (0.0 to 0.9)" },
          useReverb: { type: Type.BOOLEAN, description: "Whether to enable reverb" },
        },
        required: ["waveform", "attack", "decay", "sustain", "release", "useDelay", "delayTime", "feedback", "useReverb"],
      },
    },
  });

  if (response.text) {
    return JSON.parse(response.text) as SynthConfig;
  }
  
  throw new Error("Failed to generate configuration");
};
