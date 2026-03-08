# Presence AI

AI-powered mock interview platform built for HackCU 2026.

You show up, pick your interview type, and get put through a realistic interview — voice-first, adaptive, and evaluated on both what you say and how you present yourself.

---

## Interview Modes

**Behavioral** — STAR-format questions on experience, leadership, strengths, and conflict resolution.

**Technical Verbal** — Conceptual and system design questions scoped to your resume and job description. No coding.

**Coding Interview** — Live LeetCode problems in TypeScript. Monaco editor, AI coaching every 5-8 minutes, and a tiered hint system (nudge, approach, full walkthrough).

---

## How It Works

The interview runs as a voice loop:

1. AI asks a question (read aloud via TTS)
2. You answer (recorded via mic, transcribed by Groq Whisper)
3. Transcript sent to Claude, which evaluates your answer, updates an internal coverage checklist, and generates the next question
4. Interview ends when all checklist items are covered or Claude decides it is complete
5. Full evaluation generated on session end

In parallel, your webcam feed is analyzed every 800ms for eye contact, face presence, and confidence via MediaPipe running on the backend.

---

## Scoring

**Presence Score** — computed client-side from webcam and microphone data: eye contact, vocal volume (mic RMS), and confidence. Averaged over the session.

**Interview Performance Score** — set by Claude at session end based on STAR structure, specificity, depth, inflection, clarity, and conciseness.

**Overall Score** — average of the two.

---

## Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, TypeScript, Vite, Tailwind v4, Framer Motion |
| Code editor | Monaco Editor (@monaco-editor/react) |
| Backend | FastAPI, Python, uvicorn |
| AI interviewer | Anthropic Claude (claude-sonnet-4-6) |
| Transcription | Groq Whisper |
| Text-to-speech | OpenAI TTS (tts-1, nova voice) |
| Face analysis | MediaPipe FaceLandmarker (Python, server-side) |
| Resume parsing | pdfplumber |
| JD scraping | Playwright (headless) |
| LeetCode API | LeetCode public GraphQL API |

---

## Running Locally

### Backend

```bash
cd backend
pip install -r requirements.txt
```

Create `backend/.env`:
```
ANTHROPIC_API_KEY=...
OPENAI_API_KEY=...
GROQ_API_KEY=...
```

```bash
python main.py
```

Backend runs on `http://localhost:8000`. Startup will print an error if any required API key is missing.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend runs on `http://localhost:5173`. API calls proxy to port 8000 automatically.

---

## Project Structure

```
backend/
  main.py              - FastAPI app and all routes
  interviewer.py       - AI interview engine (Claude, checklist logic, evaluation)
  vision.py            - MediaPipe face analysis
  coding.py            - LeetCode problem fetching, hints, code analysis
  jd_fetcher.py        - Playwright job description scraper
  resume_parser.py     - PDF resume text extraction
  company_presets.py   - Company interview personas and style notes

frontend/src/
  pages/
    SetupScreen.tsx    - Interview configuration (mode, resume, JD, company)
    InterviewRoom.tsx  - Live interview UI (voice recording, TTS, face metrics)
    ResultsDashboard.tsx - Post-interview results and session recording
    CodingInterview.tsx  - Coding interview (Monaco editor, LeetCode, AI coaching)
  hooks/
    useFaceAnalysis.ts - Webcam frame capture, MediaPipe polling, mic volume
  lib/
    video-recorder.ts  - MediaRecorder wrapper with codec detection
  api/
    client.ts          - Typed fetch wrappers for all backend endpoints
  types/
    index.ts           - Shared TypeScript interfaces
```

---

## Notes

- The backend holds session state in memory. Restarting the server ends all active sessions.
- Video recording is webcam-only. The file is generated client-side and never uploaded.
- LeetCode problem fetching uses the public GraphQL API. No account or auth required.
- All LLM calls (interviewer, evaluator, coding assistant) use Anthropic. OpenAI is used only for TTS.
