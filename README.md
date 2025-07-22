# Viral Pilot Backend

Node.js backend to analyze viral potential of videos.

## Features
- Upload video
- Transcribe audio using OpenAI Whisper API
- Analyze transcript and return virality score + tips

## Setup
1. `npm install`
2. Add `.env` file with your OpenAI API key
3. `npm start`

## API
POST `/api/analyze`
- Body: `FormData` with `video` file
- Response: `{ transcript, analysis }`
