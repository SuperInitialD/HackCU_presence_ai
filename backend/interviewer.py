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


def _build_system_prompt(company: str, jd: str, resume_text: str) -> str:
    preset = _get_preset(company)

    focus_areas_str = "\n".join(f"- {f}" for f in preset["focus_areas"])
    sample_q_str = "\n".join(f"- {q}" for q in preset["sample_questions"][:4])

    system = f"""You are conducting a real-time mock interview for {preset['name']}.

## Your Interviewer Persona
{preset['persona']}

## Interview Style Notes
{preset['style_notes']}

## Key Focus Areas for This Interview
{focus_areas_str}

## Sample Question Types (adapt freely, don't read verbatim)
{sample_q_str}

## Candidate's Resume
{resume_text if resume_text.strip() else "No resume provided — ask the candidate to briefly introduce themselves."}

## Job Description
{jd if jd.strip() else "No specific job description provided — conduct a general interview for a software engineering role."}

## Your Rules
1. Ask ONE question at a time. Never stack multiple questions.
2. Keep your responses concise and conversational — this is a spoken interview, not an essay.
3. React naturally to what the candidate says before transitioning to the next question.
4. Ask follow-up questions when answers are vague, generic, or missing specifics (e.g., "Can you be more specific about what YOU did?" or "What was the measurable outcome?").
5. Vary your question types: behavioral, situational, technical concept, and role-specific.
6. Occasionally acknowledge good answers briefly ("That's a solid approach.") — but don't over-praise.
7. If the candidate asks a clarifying question, answer it concisely and continue.
8. Keep your tone {preset['name']}-appropriate as described in your persona above.
9. After 6-8 exchanges, start wrapping toward a natural close — don't end abruptly.
10. You are NOT to provide coaching during the interview — save that for the end.

## Response Format
Always respond with valid JSON in this exact format:
{{
  "message": "your conversational response / next question here",
  "follow_up": true/false,
  "feedback_hint": "brief internal note on what to watch in next answer (1 sentence, NOT shown to candidate)"
}}"""

    return system


def _parse_response(raw: str) -> dict:
    """Extract JSON from Claude's response, handling markdown code blocks."""
    # Strip markdown code fences if present
    clean = re.sub(r"```(?:json)?\s*", "", raw).strip().strip("`")

    try:
        return json.loads(clean)
    except json.JSONDecodeError:
        # Try to extract JSON object from surrounding text
        match = re.search(r"\{.*\}", clean, re.DOTALL)
        if match:
            try:
                return json.loads(match.group(0))
            except json.JSONDecodeError:
                pass

    # Fallback: return message as plain text
    return {
        "message": raw.strip(),
        "follow_up": False,
        "feedback_hint": "Response parsing failed — check format.",
    }


class AIInterviewer:
    def __init__(self):
        self._system_prompts: dict[str, str] = {}

    def start_session(self, session_id: str, company: str, jd: str, resume_text: str) -> str:
        """
        Initialize a new interview session and return the interviewer's opening message.
        """
        system_prompt = _build_system_prompt(company, jd, resume_text)
        self._system_prompts[session_id] = system_prompt

        preset = _get_preset(company)

        opening_instruction = (
            f"Start the interview naturally. Greet the candidate warmly, "
            f"introduce yourself briefly as a {preset['name']} interviewer, "
            f"and ask your first opening question (usually 'tell me about yourself' or "
            f"a role-specific opener based on their resume). Keep it concise and human."
        )

        client = _get_client()
        response = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=512,
            system=system_prompt,
            messages=[
                {"role": "user", "content": opening_instruction}
            ],
        )

        raw = response.content[0].text
        parsed = _parse_response(raw)
        return parsed.get("message", raw.strip())

    def get_response(
        self,
        session_id: str,
        answer: str,
        conversation_history: list[dict],
        metrics: dict | None = None,
    ) -> dict:
        """
        Given the candidate's answer and conversation history, return the next question.

        Returns:
            dict with keys: message, follow_up, feedback_hint, question_number
        """
        system_prompt = self._system_prompts.get(session_id)
        if not system_prompt:
            raise ValueError(f"No system prompt found for session {session_id}")

        # Build the messages array from conversation history
        messages = _history_to_messages(conversation_history)

        # Add the candidate's latest answer
        messages.append({"role": "user", "content": answer})

        # Inject metrics as context if available (subtle — don't make it robotic)
        if metrics:
            eye = metrics.get("eye_contact", None)
            stress = metrics.get("stress_score", None)
            metric_context = ""
            if eye is not None and eye < 0.4:
                metric_context += " [Note: candidate appears less engaged visually — try a more direct question]"
            if stress is not None and stress > 0.7:
                metric_context += " [Note: candidate seems stressed — consider a bridging/comfort question]"
            if metric_context:
                messages.append({
                    "role": "user",
                    "content": f"[SYSTEM CONTEXT — not from candidate]{metric_context}"
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

        question_number = sum(
            1 for msg in conversation_history if msg.get("role") == "assistant"
        ) + 1

        return {
            "message": parsed.get("message", raw.strip()),
            "follow_up": parsed.get("follow_up", False),
            "feedback_hint": parsed.get("feedback_hint", ""),
            "question_number": question_number,
        }

    def end_session(self, session_id: str, conversation_history: list[dict]) -> dict:
        """
        Generate a comprehensive final evaluation based on the full conversation.

        Returns dict with transcript summary and scores.
        """
        system_prompt = self._system_prompts.get(session_id, "")

        evaluation_prompt = """The interview is now complete. Review the full conversation above and provide a comprehensive evaluation.

Return a JSON object in EXACTLY this format (no markdown, no extra text):
{
  "overall_score": {
    "total": 7.5,
    "communication": 8.0,
    "technical_depth": 7.0,
    "problem_solving": 7.5,
    "culture_fit": 8.0,
    "confidence": 7.0
  },
  "strengths": [
    "Specific strength 1 with example from the interview",
    "Specific strength 2",
    "Specific strength 3"
  ],
  "areas_for_improvement": [
    "Specific area 1 with actionable advice",
    "Specific area 2 with actionable advice"
  ],
  "standout_moments": [
    "Brief description of a moment that stood out positively",
    "Brief description of another notable moment"
  ],
  "hiring_recommendation": "Strong Yes / Yes / Maybe / No",
  "summary": "2-3 sentence overall assessment of the candidate written in second person (to the candidate). Be honest, specific, and constructive."
}

Scores are out of 10. Be honest and specific — reference actual things the candidate said."""

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

        # Ensure expected keys exist
        result = {
            "overall_score": parsed.get("overall_score", {"total": 0}),
            "strengths": parsed.get("strengths", []),
            "areas_for_improvement": parsed.get("areas_for_improvement", []),
            "standout_moments": parsed.get("standout_moments", []),
            "hiring_recommendation": parsed.get("hiring_recommendation", "Undetermined"),
            "summary": parsed.get("summary", "Evaluation could not be generated."),
        }

        # Clean up session prompt from memory
        self._system_prompts.pop(session_id, None)

        return result


def _history_to_messages(history: list[dict]) -> list[dict]:
    """
    Convert stored conversation history to Anthropic messages format.
    History entries: {"role": "assistant"|"user", "content": str}
    """
    messages = []
    for entry in history:
        role = entry.get("role", "user")
        content = entry.get("content", "")
        if role in ("assistant", "user") and content:
            messages.append({"role": role, "content": content})
    return messages
