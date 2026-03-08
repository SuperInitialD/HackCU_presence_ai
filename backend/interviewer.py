import os
import json
import re
from openai import OpenAI
from company_presets import COMPANY_PRESETS

_client = None


def _get_client() -> OpenAI:
    global _client
    if _client is None:
        _client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
    return _client


def _get_preset(company: str) -> dict:
    key = company.lower().strip()
    return COMPANY_PRESETS.get(key, COMPANY_PRESETS["generic"])


def _default_checklist() -> dict:
    return {
        "behavioral": {
            "introduction":   False,  # background, career story, tell me about yourself
            "experience":     False,  # past roles, key responsibilities, professional history
            "star_scenario":  False,  # STAR method — conflict, failure, leadership moment
            "skills_strengths": False, # what they bring, self-assessment, growth areas
        },
        "technical": {
            "concepts":        False, # technical concepts relevant to JD (no coding)
            "problem_solving": False, # how they approach & break down technical problems
            "project_dive":    False, # deep dive on a specific past technical project
            "role_specific":   False, # role-specific knowledge from JD requirements
        },
    }


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

    company_context = ""
    if not known and company.strip():
        company_context = f"\nThe candidate is targeting: **{company}**. Tailor all questions accordingly."

    profile_section = ""
    if github_url or linkedin_url:
        profile_section = "\n## Candidate Profiles (for context — reference naturally)\n"
        if github_url:
            profile_section += f"- GitHub: {github_url}\n"
        if linkedin_url:
            profile_section += f"- LinkedIn: {linkedin_url}\n"

    system = f"""You are conducting a structured mock interview for {company if company.strip() else 'a software engineering role'}.
{company_context}

## Interviewer Persona
{preset['persona']}

## Style
{preset['style_notes']}

## Candidate Resume
{resume_text.strip() if resume_text.strip() else "No resume provided — ask the candidate to walk you through their background."}
{profile_section}
## Job Description
{jd.strip() if jd.strip() else "No job description provided — conduct a general software engineering interview."}

---

## Interview Structure

You MUST work through these 8 sub-sections in order, completing each before advancing.
**Do not skip sections. Do not blend behavioral and technical — finish all 4 behavioral items first, then do technical.**

### Part 1 — Behavioral (complete in order)
1. **introduction** — Background & Introduction: career story, how they got here, what drives them. Reference resume specifics.
2. **experience** — Professional Experience: dig into 1-2 key past roles or projects. What did they own? What was the impact? Push for specifics.
3. **star_scenario** — STAR Scenario: ask about a real challenge — conflict with a teammate, a time they failed, a leadership moment. Require Situation/Task/Action/Result structure. Follow up if any part is missing.
4. **skills_strengths** — Skills & Strengths: what technical and soft skills do they bring? What are they actively improving? Be candid — ask for self-critique.

### Part 2 — Technical (no coding — conceptual and verbal only)
5. **concepts** — Technical Concepts: 2-3 technical questions directly tied to the JD and resume stack (e.g. system design tradeoffs, CS fundamentals, architecture decisions). No code.
6. **problem_solving** — Problem-Solving Approach: give them a scenario (from the JD context) and ask how they'd break it down. Probe for structure and depth.
7. **project_dive** — Project Deep-Dive: pick a project from their resume or GitHub. Ask what they built, their role, the hard parts, what they'd do differently.
8. **role_specific** — Role-Specific Knowledge: 1-2 questions unique to this role/company from the JD. What do they know about the domain? What would they do in the first 30 days?

---

## Conversation Rules
1. Ask ONE question at a time. Never stack questions.
2. Natural, concise, conversational — this is spoken, not written.
3. Ask follow-ups if an answer is vague, incomplete, or missing specifics. Follow-ups do NOT advance to the next section — stay until you have genuine signal.
4. Reference resume, GitHub, LinkedIn naturally. Don't read from them robotically.
5. No coaching during the interview.
6. No coding questions. Conceptual only.

## Ending
When all 8 sub-sections are marked true: close naturally and warmly. Something like "That wraps things up — it was great getting to know you. You'll hear back soon." Then set end_interview=true.

---

## Response Format
ALWAYS return ONLY valid JSON, no markdown, no extra text:
{{
  "message": "your spoken response / next question",
  "follow_up": true/false,
  "feedback_hint": "1-sentence internal note not shown to candidate",
  "checklist": {{
    "behavioral": {{
      "introduction": true/false,
      "experience": true/false,
      "star_scenario": true/false,
      "skills_strengths": true/false
    }},
    "technical": {{
      "concepts": true/false,
      "problem_solving": true/false,
      "project_dive": true/false,
      "role_specific": true/false
    }}
  }},
  "end_interview": false
}}

Rules for checklist:
- Mark a sub-section true only when you have genuine signal — not just because the candidate said something.
- Items can only flip from false → true, never back.
- Set end_interview=true ONLY in the final goodbye message.
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
        "checklist": _default_checklist(),
        "end_interview": False,
    }


def _merge_checklist(current: dict, updates: dict) -> dict:
    """Merge checklist updates — items can only flip true, never false."""
    for section in ("behavioral", "technical"):
        if section in updates and isinstance(updates[section], dict):
            for key in current.get(section, {}):
                if updates[section].get(key):
                    current[section][key] = True
    return current


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
        has_resume = bool(resume_text.strip())

        opening_instruction = (
            f"Begin the interview. Greet the candidate warmly, briefly introduce yourself as a "
            f"{preset['name']} interviewer, then open with the Introduction section — typically "
            f"'tell me about yourself' or a tailored opener based on their resume. "
            f"{'Reference their background specifically.' if has_resume else ''} "
            f"Keep it natural and concise."
        )

        client = _get_client()
        response = client.chat.completions.create(
            model="gpt-4o",
            max_tokens=512,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": opening_instruction},
            ],
        )

        raw = response.choices[0].message.content or ""
        parsed = _parse_response(raw)

        if "checklist" in parsed:
            _merge_checklist(self._checklists[session_id], parsed["checklist"])

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

        if metrics:
            hints = []
            if metrics.get("eye_contact", 1) < 0.4:
                hints.append("candidate appears less engaged — consider a more direct question")
            if metrics.get("stress_score", 0) > 0.7:
                hints.append("candidate seems stressed — ease in with a bridging question")
            if hints:
                messages.append({
                    "role": "user",
                    "content": f"[SYSTEM CONTEXT — not from candidate: {', '.join(hints)}]"
                })

        client = _get_client()
        response = client.chat.completions.create(
            model="gpt-4o",
            max_tokens=512,
            messages=[{"role": "system", "content": system_prompt}] + messages,
        )

        raw = response.choices[0].message.content or ""
        parsed = _parse_response(raw)

        if "checklist" in parsed:
            _merge_checklist(self._checklists[session_id], parsed["checklist"])

        current_checklist = json.loads(json.dumps(self._checklists.get(session_id, _default_checklist())))

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

        evaluation_prompt = """Interview complete. Evaluate the full conversation and return ONLY valid JSON:
{
  "overall_score": {"total": 7.5, "communication": 8.0, "technical_depth": 7.0, "problem_solving": 7.5, "culture_fit": 8.0, "confidence": 7.0},
  "strengths": ["Specific strength with example", "Strength 2", "Strength 3"],
  "areas_for_improvement": ["Specific actionable area 1", "Area 2"],
  "standout_moments": ["Notable moment 1", "Notable moment 2"],
  "hiring_recommendation": "Strong Yes / Yes / Maybe / No",
  "summary": "2-3 honest sentences directly to the candidate referencing specific things they said."
}
Scores out of 10. Be honest and specific."""

        messages = _history_to_messages(conversation_history)
        messages.append({"role": "user", "content": evaluation_prompt})

        client = _get_client()
        response = client.chat.completions.create(
            model="gpt-4o",
            max_tokens=1024,
            messages=[{"role": "system", "content": system_prompt or "You are an expert interview evaluator."}] + messages,
        )

        raw = response.choices[0].message.content or ""
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


def _history_to_messages(history: list[dict]) -> list[dict]:
    messages = []
    for entry in history:
        role = entry.get("role", "user")
        content = entry.get("content", "")
        if role in ("assistant", "user") and content:
            messages.append({"role": role, "content": content})
    return messages
