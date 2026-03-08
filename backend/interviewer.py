import os
import json
import re
import anthropic
from company_presets import COMPANY_PRESETS

_client = None


def _get_client() -> anthropic.Anthropic:
    global _client
    if _client is None:
        _client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    return _client


def _get_preset(company: str) -> dict:
    key = company.lower().strip()
    return COMPANY_PRESETS.get(key, COMPANY_PRESETS["generic"])


def _build_system_prompt(
    company: str,
    jd: str,
    resume_text: str,
    github_url: str = "",
    linkedin_url: str = "",
) -> str:
    preset_key = company.lower().strip()
    known = preset_key in COMPANY_PRESETS
    preset = _get_preset(company)

    focus_areas_str = "\n".join(f"- {f}" for f in preset["focus_areas"])
    sample_q_str = "\n".join(f"- {q}" for q in preset["sample_questions"][:4])

    company_context = ""
    if not known and company.strip():
        company_context = f"The candidate is targeting: {company}. Adapt your interview style accordingly."

    profile_section = ""
    if github_url or linkedin_url:
        profile_section = "## Candidate's Online Profiles\n"
        if github_url:
            profile_section += f"- GitHub: {github_url}\n"
        if linkedin_url:
            profile_section += f"- LinkedIn: {linkedin_url}\n"
        profile_section += "Reference these when relevant — ask about notable projects, contributions, or career history shown there.\n"

    system = f"""You are conducting a real-time mock behavioral interview for {company if company.strip() else 'a software engineering role'}.

## Your Interviewer Persona
{preset['persona']}

## Interview Style Notes
{preset['style_notes']}
{company_context}

## Key Focus Areas
{focus_areas_str}

## Sample Question Types (adapt freely, never read verbatim)
{sample_q_str}

## Candidate's Resume
{resume_text if resume_text.strip() else "No resume provided — ask the candidate to briefly introduce themselves."}

{profile_section}
## Job Description
{jd if jd.strip() else "No specific job description — conduct a general software engineering interview."}

## Conversation Rules
1. Ask ONE question at a time. Never stack questions.
2. Be concise and conversational — spoken interview, not an essay.
3. React naturally before transitioning: brief acknowledgment, then next question.
4. Ask follow-ups when answers are vague or incomplete — don't move on until you have real signal.
5. Never coach during the interview — save feedback for the evaluation.
6. Reference the resume, GitHub, or LinkedIn naturally when relevant.

## Coverage Checklist
You must gather clear signal on ALL FOUR areas before ending:
1. **resume** — candidate's background, past roles, key experiences from their resume
2. **profile** — their GitHub projects, LinkedIn history, or online work (if provided; otherwise skip this)
3. **technical** — a technical or role-specific challenge, problem-solving approach
4. **behavioral** — at least one behavioral scenario (conflict, failure, leadership, collaboration)

Track your progress internally. Only set end_interview=true when you have genuine signal on all required areas (skip "profile" if no GitHub/LinkedIn was provided).

When ending: close naturally — "This wraps up our time today. Thank you so much for chatting with me — you'll hear back soon." Do NOT abruptly end or announce you're checking a box.

## Response Format
ALWAYS respond with valid JSON in EXACTLY this format (no markdown, no extra text):
{{
  "message": "your conversational response / next question",
  "follow_up": true/false,
  "feedback_hint": "1-sentence internal note NOT shown to candidate",
  "checklist": {{
    "resume": true/false,
    "profile": true/false,
    "technical": true/false,
    "behavioral": true/false
  }},
  "end_interview": false
}}

Set end_interview=true only in the FINAL message (the goodbye). Once set, do not send more questions.
"""
    return system


def _parse_response(raw: str) -> dict:
    clean = re.sub(r"```(?:json)?\s*", "", raw).strip().strip("`")
    try:
        return json.loads(clean)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", clean, re.DOTALL)
        if match:
            try:
                return json.loads(match.group(0))
            except json.JSONDecodeError:
                pass
    return {
        "message": raw.strip(),
        "follow_up": False,
        "feedback_hint": "",
        "checklist": {"resume": False, "profile": False, "technical": False, "behavioral": False},
        "end_interview": False,
    }


def _default_checklist() -> dict:
    return {"resume": False, "profile": False, "technical": False, "behavioral": False}


class AIInterviewer:
    def __init__(self):
        self._system_prompts: dict[str, str] = {}
        self._checklists: dict[str, dict] = {}

    def start_session(
        self,
        session_id: str,
        company: str,
        jd: str,
        resume_text: str,
        github_url: str = "",
        linkedin_url: str = "",
    ) -> str:
        system_prompt = _build_system_prompt(company, jd, resume_text, github_url, linkedin_url)
        self._system_prompts[session_id] = system_prompt
        self._checklists[session_id] = _default_checklist()

        preset = _get_preset(company)
        has_profile = bool(github_url or linkedin_url)

        opening_instruction = (
            f"Start the interview. Greet the candidate warmly, introduce yourself briefly as a "
            f"{preset['name']} interviewer, and open with a natural first question — typically "
            f"'tell me about yourself' or a specific opener based on their resume. "
            f"{'You have their GitHub/LinkedIn — you may reference it naturally.' if has_profile else ''}"
            f" Keep it concise and human."
        )

        client = _get_client()
        response = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=512,
            system=system_prompt,
            messages=[{"role": "user", "content": opening_instruction}],
        )

        raw = response.content[0].text
        parsed = _parse_response(raw)

        # Update checklist from opening if AI already marked something
        if "checklist" in parsed:
            self._merge_checklist(session_id, parsed["checklist"])

        return parsed.get("message", raw.strip())

    def get_response(
        self,
        session_id: str,
        answer: str,
        conversation_history: list[dict],
        metrics: dict | None = None,
    ) -> dict:
        system_prompt = self._system_prompts.get(session_id)
        if not system_prompt:
            raise ValueError(f"No system prompt for session {session_id}")

        messages = _history_to_messages(conversation_history)
        messages.append({"role": "user", "content": answer})

        # Inject vision metrics as subtle system context
        if metrics:
            hints = []
            if metrics.get("eye_contact", 1) < 0.4:
                hints.append("candidate appears less engaged visually")
            if metrics.get("stress_score", 0) > 0.7:
                hints.append("candidate seems stressed — consider a bridging question")
            if hints:
                messages.append({
                    "role": "user",
                    "content": f"[SYSTEM — not from candidate: {', '.join(hints)}]"
                })

        client = _get_client()
        response = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=512,
            system=system_prompt,
            messages=messages,
        )

        raw = response.content[0].text
        parsed = _parse_response(raw)

        # Merge checklist updates from AI
        if "checklist" in parsed:
            self._merge_checklist(session_id, parsed["checklist"])

        current_checklist = dict(self._checklists.get(session_id, _default_checklist()))

        question_number = sum(
            1 for msg in conversation_history if msg.get("role") == "assistant"
        ) + 1

        return {
            "message": parsed.get("message", raw.strip()),
            "follow_up": parsed.get("follow_up", False),
            "feedback_hint": parsed.get("feedback_hint", ""),
            "question_number": question_number,
            "end_interview": parsed.get("end_interview", False),
            "checklist": current_checklist,
        }

    def end_session(self, session_id: str, conversation_history: list[dict]) -> dict:
        system_prompt = self._system_prompts.get(session_id, "")

        evaluation_prompt = """The interview is complete. Review the full conversation and provide a comprehensive evaluation.

Return ONLY valid JSON in exactly this format:
{
  "overall_score": {
    "total": 7.5,
    "communication": 8.0,
    "technical_depth": 7.0,
    "problem_solving": 7.5,
    "culture_fit": 8.0,
    "confidence": 7.0
  },
  "strengths": ["Specific strength 1 with example", "Specific strength 2", "Specific strength 3"],
  "areas_for_improvement": ["Specific area 1 with actionable advice", "Specific area 2"],
  "standout_moments": ["Notable moment 1", "Notable moment 2"],
  "hiring_recommendation": "Strong Yes / Yes / Maybe / No",
  "summary": "2-3 sentence honest assessment written directly to the candidate."
}

Scores out of 10. Be specific — reference actual things said."""

        messages = _history_to_messages(conversation_history)
        messages.append({"role": "user", "content": evaluation_prompt})

        client = _get_client()
        response = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=1024,
            system=system_prompt or "You are an expert interview evaluator.",
            messages=messages,
        )

        raw = response.content[0].text
        parsed = _parse_response(raw)

        self._system_prompts.pop(session_id, None)
        self._checklists.pop(session_id, None)

        return {
            "overall_score": parsed.get("overall_score", {"total": 0}),
            "strengths": parsed.get("strengths", []),
            "areas_for_improvement": parsed.get("areas_for_improvement", []),
            "standout_moments": parsed.get("standout_moments", []),
            "hiring_recommendation": parsed.get("hiring_recommendation", "Undetermined"),
            "summary": parsed.get("summary", "Evaluation could not be generated."),
        }

    def _merge_checklist(self, session_id: str, updates: dict) -> None:
        """Only allow checklist items to flip true, never back to false."""
        current = self._checklists.setdefault(session_id, _default_checklist())
        for key in ("resume", "profile", "technical", "behavioral"):
            if updates.get(key):
                current[key] = True


def _history_to_messages(history: list[dict]) -> list[dict]:
    messages = []
    for entry in history:
        role = entry.get("role", "user")
        content = entry.get("content", "")
        if role in ("assistant", "user") and content:
            messages.append({"role": role, "content": content})
    return messages
