import os
import uuid
import io
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv
import sys

# Load .env from both locations (backend/ takes priority via override=True)
_env_root  = Path(__file__).resolve().parent.parent / ".env"
_env_local = Path(__file__).resolve().parent / ".env"
load_dotenv(_env_root, override=False)   # load project root first (lower priority)
load_dotenv(_env_local, override=True)   # backend/.env always wins

# Validate critical keys at startup so failure is obvious
_missing = [k for k in ("ANTHROPIC_API_KEY",) if not os.environ.get(k)]
if _missing:
    print(f"ERROR: Missing required env vars: {', '.join(_missing)}", file=sys.stderr)
    print(f"  Looked for .env at:\n    {_env_local}\n    {_env_root}", file=sys.stderr)
    print(f"  Make sure backend/.env contains: ANTHROPIC_API_KEY=sk-ant-...", file=sys.stderr)

from fastapi import FastAPI, HTTPException, UploadFile, File, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import groq
from openai import OpenAI
import logging

from interviewer import AIInterviewer
import coding as coding_module
from resume_parser import parse_pdf, extract_key_info
from jd_fetcher import fetch_from_url
from company_presets import COMPANY_PRESETS


# ──────────────────────────────────────────────
# App setup
# ──────────────────────────────────────────────

app = FastAPI(title="Presence AI Backend", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ──────────────────────────────────────────────
# Global state
# ──────────────────────────────────────────────

# In-memory sessions: session_id → session data
SESSIONS: dict[str, dict] = {}

# Single shared interviewer instance (holds system prompts per session)
interviewer = AIInterviewer()

# Groq client for Whisper transcription
groq_client = groq.Groq(api_key=os.environ.get("GROQ_API_KEY", ""))


# ──────────────────────────────────────────────
# Pydantic models
# ──────────────────────────────────────────────

class StartSessionRequest(BaseModel):
    company: Optional[str] = ""
    job_description: Optional[str] = ""
    resume_text: Optional[str] = ""
    github_url: Optional[str] = ""
    linkedin_url: Optional[str] = ""
    interview_type: Optional[str] = "behavioral"  # behavioral | technical_verbal | full
    selected_sections: Optional[list] = None  # e.g. ["introduction","experience","concepts"] — None means all


class MetricsModel(BaseModel):
    eye_contact: float = 0.5
    stress_score: float = 0.3


class RespondRequest(BaseModel):
    answer: str
    metrics: Optional[MetricsModel] = None
    # flat aliases sent by frontend
    eye_contact: Optional[float] = None
    stress: Optional[float] = None
    confidence: Optional[float] = None


# ──────────────────────────────────────────────
# Routes
# ──────────────────────────────────────────────

@app.get("/")
def root():
    return {"status": "ok", "service": "Presence AI Backend"}


@app.post("/api/session/start")
async def start_session(body: StartSessionRequest):
    """
    Start a new interview session.
    Returns session_id and the interviewer's opening message.
    """
    session_id = str(uuid.uuid4())

    company_raw = (body.company or "").strip()
    company_key = company_raw.lower()
    if company_key not in COMPANY_PRESETS:
        company_key = company_raw or "generic"

    interview_type = body.interview_type or "behavioral"

    try:
        opening_message = interviewer.start_session(
            session_id=session_id,
            company=company_key,
            jd=body.job_description or "",
            resume_text=body.resume_text or "",
            github_url=body.github_url or "",
            linkedin_url=body.linkedin_url or "",
            interview_type=interview_type,
            selected_sections=body.selected_sections,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to start session: {str(e)}")

    SESSIONS[session_id] = {
        "session_id": session_id,
        "company": company_key,
        "job_description": body.job_description or "",
        "resume_text": body.resume_text or "",
        "github_url": body.github_url or "",
        "linkedin_url": body.linkedin_url or "",
        "interview_type": interview_type,
        "selected_sections": body.selected_sections,
        "conversation_history": [
            {"role": "assistant", "content": opening_message}
        ],
        "question_count": 1,
        "active": True,
    }

    preset = COMPANY_PRESETS.get(company_key, COMPANY_PRESETS["generic"])
    interviewer_name = preset.get("interviewer_name", "AI Interviewer")

    return {
        "session_id": session_id,
        "opening_message": opening_message,
        "first_question": opening_message,
        "interviewer_name": interviewer_name,
    }


@app.post("/api/session/{session_id}/respond")
async def respond_to_session(session_id: str, body: RespondRequest):
    """
    Send a candidate's answer and receive the next interviewer message.
    """
    session = SESSIONS.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail=f"Session {session_id} not found")
    if not session.get("active"):
        raise HTTPException(status_code=400, detail="Session has already ended")

    # Append candidate answer to history
    session["conversation_history"].append({
        "role": "user",
        "content": body.answer,
    })

    # Accept both nested metrics object and flat fields from frontend
    metrics_dict = None
    if body.metrics:
        metrics_dict = {
            "eye_contact": body.metrics.eye_contact,
            "stress_score": body.metrics.stress_score,
        }
    elif body.eye_contact is not None or body.stress is not None:
        metrics_dict = {
            "eye_contact": body.eye_contact if body.eye_contact is not None else 0.5,
            "stress_score": body.stress if body.stress is not None else 0.3,
        }

    try:
        result = interviewer.get_response(
            session_id=session_id,
            answer=body.answer,
            conversation_history=session["conversation_history"],
            metrics=metrics_dict,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get response: {str(e)}")

    # Append interviewer response to history
    session["conversation_history"].append({
        "role": "assistant",
        "content": result["message"],
    })
    session["question_count"] += 1

    is_complete = result.get("end_interview", False)

    return {
        "message": result["message"],
        "next_question": result["message"],
        "follow_up": result["follow_up"],
        "question_number": result["question_number"],
        "feedback_hint": result["feedback_hint"],
        "checklist": result.get("checklist", {}),
        "is_complete": is_complete,
        "score": None,
    }


@app.post("/api/session/{session_id}/end")
async def end_session(session_id: str):
    """
    End a session and return the transcript + final evaluation scores.
    """
    session = SESSIONS.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail=f"Session {session_id} not found")

    if not session.get("active"):
        # Already ended — return cached result if available
        if "final_result" in session:
            return session["final_result"]
        raise HTTPException(status_code=400, detail="Session already ended and no result cached")

    session["active"] = False

    try:
        evaluation = interviewer.end_session(
            session_id=session_id,
            conversation_history=session["conversation_history"],
            resume_text=session.get("resume_text", ""),
            linkedin_url=session.get("linkedin_url", ""),
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate evaluation: {str(e)}")

    # Build clean transcript for the response
    transcript = []
    for i, entry in enumerate(session["conversation_history"]):
        transcript.append({
            "index": i,
            "role": entry["role"],
            "content": entry["content"],
        })

    result = {
        "transcript": transcript,
        "overall_score": evaluation.get("overall_score", evaluation),
        "answer_quality": evaluation.get("answer_quality", {}),
        "strengths": evaluation.get("strengths", []),
        "areas_for_improvement": evaluation.get("areas_for_improvement", []),
        "standout_moments": evaluation.get("standout_moments", []),
        "resume_feedback": evaluation.get("resume_feedback"),
        "linkedin_feedback": evaluation.get("linkedin_feedback"),
        "hiring_recommendation": evaluation.get("hiring_recommendation", ""),
        "summary": evaluation.get("summary", ""),
    }

    session["final_result"] = result
    return result


@app.post("/api/transcribe")
async def transcribe_audio(file: UploadFile = File(None), audio: UploadFile = File(None)):
    """
    Transcribe an uploaded audio file using Groq Whisper.
    Accepts common audio formats: mp3, mp4, wav, m4a, ogg, webm, flac.
    """
    upload = file or audio
    if not upload:
        raise HTTPException(status_code=400, detail="No audio file provided (use field 'file' or 'audio')")
    audio_bytes = await upload.read()
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="Empty audio file")

    filename = upload.filename or "audio.webm"
    content_type = upload.content_type or "audio/webm"

    try:
        transcription = groq_client.audio.transcriptions.create(
            model="whisper-large-v3",
            file=(filename, io.BytesIO(audio_bytes), content_type),
            response_format="text",
        )
    except Exception as e:
        logger = logging.getLogger(__name__)
        # Log the error with traceback and some context for debugging
        logger.exception("Transcription failed for file=%s content_type=%s", filename, content_type)
        raise HTTPException(status_code=500, detail=f"Transcription failed: {str(e)}")

    # Groq returns a string when response_format="text"
    text = transcription if isinstance(transcription, str) else transcription.text
    return {"text": text.strip()}


class TTSRequest(BaseModel):
    text: str
    voice: str = "nova"   # nova | shimmer | alloy | echo | fable | onyx
    speed: float = 1.2    # 0.25–4.0; default slightly faster than normal


@app.post("/api/tts")
async def text_to_speech(body: TTSRequest):
    """
    Convert text to speech using OpenAI TTS.
    Returns MP3 audio bytes.
    Voices: nova (warm female), shimmer (expressive female), alloy (neutral),
            echo (male), fable (British male), onyx (deep male)
    """
    if not body.text.strip():
        raise HTTPException(status_code=400, detail="Text is required")

    valid_voices = {"nova", "shimmer", "alloy", "echo", "fable", "onyx"}
    voice = body.voice if body.voice in valid_voices else "nova"

    try:
        speed = max(0.5, min(4.0, body.speed))  # clamp to safe range
        oai = OpenAI(api_key=os.environ.get("OPENAI_API_KEY", ""))
        response = oai.audio.speech.create(
            model="tts-1",
            voice=voice,  # type: ignore
            input=body.text.strip(),
            response_format="mp3",
            speed=speed,
        )
        audio_bytes = response.content
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"TTS failed: {str(e)}")

    return StreamingResponse(
        io.BytesIO(audio_bytes),
        media_type="audio/mpeg",
        headers={"Content-Disposition": "inline; filename=speech.mp3"},
    )


@app.post("/api/parse-resume")
async def parse_resume(file: UploadFile = File(...)):
    """
    Parse a PDF resume and extract text.
    Returns the raw extracted text.
    """
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported")

    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(status_code=400, detail="Empty file")

    try:
        text = parse_pdf(file_bytes)
        key_info = extract_key_info(text)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to parse PDF: {str(e)}")

    return {
        "text": text,
        "extracted_info": key_info,
    }


# @app.get("/api/fetch-jd")
# async def fetch_jd(url: str = Query(..., description="URL of the job description page")):
#     """
#     Fetch and parse a job description from a URL.
#     Returns title, company, and description text.
#     """
#     if not url.startswith(("http://", "https://")):
#         raise HTTPException(status_code=400, detail="URL must start with http:// or https://")

#     try:
#         result = fetch_from_url(url)
#     except Exception as e:
#         raise HTTPException(status_code=500, detail=f"Failed to fetch job description: {str(e)}")

#     return {
#         "title": result.get("title", ""),
#         "company": result.get("company", ""),
#         "description": result.get("description", ""),
#     }
@app.get("/api/fetch-jd")
async def fetch_jd(url: str = Query(..., description="URL of the job description page")):
    """
    Fetch job description from URL (uses Playwright for JS-heavy pages).
    """
    try:
        # Await the async fetch_from_url coroutine
        result = await fetch_from_url(url)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch job description: {str(e)}")

    return {
        "title": result.get("title", ""),
        "company": result.get("company", ""),
        "description": result.get("description", ""),
    }

@app.post("/api/analyze-frame")
async def analyze_frame(file: UploadFile = File(...)):
    """Analyze a webcam frame for eye contact, stress, and confidence."""
    image_bytes = await file.read()
    if not image_bytes:
        raise HTTPException(status_code=400, detail="Empty image")
    try:
        from vision import analyze_frame as _analyze
        result = _analyze(image_bytes)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Vision analysis failed: {str(e)}")
    return result


@app.get("/api/companies")
async def get_companies():
    """
    Return list of supported company presets with metadata.
    """
    companies = []
    for key, preset in COMPANY_PRESETS.items():
        companies.append({
            "id": key,
            "name": preset["name"],
            "focus_areas": preset["focus_areas"],
            "style_notes": preset["style_notes"],
            "sample_questions": preset.get("sample_questions", [])[:3],  # first 3 only
        })

    return {"companies": companies}


# ──────────────────────────────────────────────
# Coding Interview Routes
# ──────────────────────────────────────────────

class CodingHintRequest(BaseModel):
    problem: dict
    current_code: str
    hint_level: int = 1

class CodingAnalyzeRequest(BaseModel):
    problem: dict
    current_code: str
    is_periodic: bool = True


@app.get("/api/coding/problem")
async def get_coding_problem(difficulty: str = "medium", slug: Optional[str] = None):
    """Fetch a LeetCode problem. Returns title, description, starter code, hints."""
    try:
        problem = coding_module.fetch_problem(difficulty=difficulty, slug=slug)
        return problem
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch problem: {str(e)}")


@app.post("/api/coding/hint")
async def get_coding_hint(body: CodingHintRequest):
    """Get a hint for the current problem at the requested level (1=nudge, 2=approach, 3=walkthrough)."""
    try:
        hint = coding_module.get_hint(body.problem, body.current_code, body.hint_level)
        return {"hint": hint}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get hint: {str(e)}")


@app.post("/api/coding/analyze")
async def analyze_coding(body: CodingAnalyzeRequest):
    """Analyze current code state. Used for periodic snapshots and on-demand analysis."""
    try:
        result = coding_module.analyze_code(body.problem, body.current_code, body.is_periodic)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to analyze code: {str(e)}")


# ──────────────────────────────────────────────
# Dev entrypoint
# ──────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
