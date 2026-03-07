import os
import uuid
import io
from typing import Optional

from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, HTTPException, UploadFile, File, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import groq

from interviewer import AIInterviewer
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
    company: str
    job_description: str
    resume_text: str


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

    # Validate company — default to generic if unknown
    company_key = body.company.lower().strip()
    if company_key not in COMPANY_PRESETS:
        company_key = "generic"

    try:
        opening_message = interviewer.start_session(
            session_id=session_id,
            company=company_key,
            jd=body.job_description,
            resume_text=body.resume_text,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to start session: {str(e)}")

    SESSIONS[session_id] = {
        "session_id": session_id,
        "company": company_key,
        "job_description": body.job_description,
        "resume_text": body.resume_text,
        "conversation_history": [
            {"role": "assistant", "content": opening_message}
        ],
        "question_count": 1,
        "active": True,
    }

    preset = COMPANY_PRESETS.get(company_key, COMPANY_PRESETS["generic"])
    interviewer_name = preset.get("interviewer_name", f"{preset['name']} Interviewer")

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

    question_count = session["question_count"]
    is_complete = question_count >= 8  # wrap after 8 exchanges

    return {
        "message": result["message"],
        "next_question": result["message"],   # frontend alias
        "follow_up": result["follow_up"],
        "question_number": result["question_number"],
        "feedback_hint": result["feedback_hint"],
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
        "overall_score": evaluation,
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
        raise HTTPException(status_code=500, detail=f"Transcription failed: {str(e)}")

    # Groq returns a string when response_format="text"
    text = transcription if isinstance(transcription, str) else transcription.text
    return {"text": text.strip()}


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


@app.get("/api/fetch-jd")
async def fetch_jd(url: str = Query(..., description="URL of the job description page")):
    """
    Fetch and parse a job description from a URL.
    Returns title, company, and description text.
    """
    if not url.startswith(("http://", "https://")):
        raise HTTPException(status_code=400, detail="URL must start with http:// or https://")

    try:
        result = fetch_from_url(url)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch job description: {str(e)}")

    return {
        "title": result.get("title", ""),
        "company": result.get("company", ""),
        "description": result.get("description", ""),
    }


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
# Dev entrypoint
# ──────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
