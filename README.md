# Presence AI — HackCU 2026

AI-powered interview prep with real-time body language analysis.

## Features
- 🎤 Voice or text responses (Groq Whisper transcription)
- 👁️ Live face analysis via MediaPipe (eye contact, stress, confidence)
- 🧠 Claude-powered AI interviewer with company-specific personas
- 📄 Resume upload + parsing
- 🔗 Job description from URL or paste
- 🏢 Company presets: Google, Amazon, Meta, Microsoft, Generic
- 📊 Post-interview performance dashboard

## Stack
- **Frontend**: React + TypeScript + Vite + Tailwind + Framer Motion
- **Backend**: FastAPI (Python)
- **AI**: Anthropic Claude claude-sonnet-4-6
- **Speech**: Groq Whisper
- **Vision**: MediaPipe FaceMesh (browser WASM)

## Running Locally

### Backend
```bash
cd backend
pip install -r requirements.txt
cp .env.example .env  # add your API keys
python main.py
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173 — backend runs on http://localhost:8000.
