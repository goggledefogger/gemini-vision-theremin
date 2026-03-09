# Gemini Vision Theremin

A web-based Theremin that uses your webcam to detect hand movements and maps them to frequency and volume using the WebAudio API. It also features an AI preset generator powered by Gemini! 

**Deployed Version:** [https://theremin.roytown.net/](https://theremin.roytown.net/)

## Features

- **Webcam Hand Tracking**: Uses MediaPipe to detect your hands in real-time.
- **WebAudio Synthesizer**: Maps hand position to pitch and volume.
- **AI Presets**: Describe a sound you want (e.g., "spooky 80s sci-fi") and Gemini will generate a custom synthesizer preset for you.

## Run Locally

**Prerequisites:** Node.js

1. Clone this repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Set the `GEMINI_API_KEY` in `.env.local` to your Google Gemini API key:
   ```env
   GEMINI_API_KEY=your_api_key_here
   ```
4. Run the app:
   ```bash
   npm run dev
   ```

## Tech Stack

- React + TypeScript
- Vite
- Google AI JavaScript SDK (`@google/genai`)
- MediaPipe Vision Tasks
- Tailwind CSS

## Concept

Webcam detects hands -> Maps to Frequency/Volume -> WebAudio Oscillator. Add Gemini to generate the initial Synth configuration.
