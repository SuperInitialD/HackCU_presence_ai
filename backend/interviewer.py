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


def _default_checklist(interview_type: str = "behavioral") -> dict:
    behavioral = {"introduction": False, "experience": False, "star_scenario": False, "skills_strengths": False}
    technical  = {"concepts": False, "problem_solving": False, "project_dive": False, "role_specific": False}
    if interview_type == "technical_verbal":
        return {"behavioral": {k: True for k in behavioral}, "technical": technical}
    if interview_type == "behavioral":
        return {"behavioral": behavioral, "technical": {k: True for k in technical}}
    # full — both active
    return {"behavioral": behavioral, "technical": technical}


def _build_system_prompt(
    company: str,
    jd: str,
    resume_text: str,
    github_url: str = "",
    linkedin_url: str = "",
    interview_type: str = "behavioral",
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

    # Pre-compute conditionals — Python 3.11 f-strings cannot use same quote type inside {}
    company_name    = company.strip() if company.strip() else "a software engineering role"
    resume_display  = resume_display
    jd_display      = jd_display

    if interview_type == "behavioral":
        mode_instruction = "BEHAVIORAL-ONLY: Cover only the 4 behavioral sections. Mark all technical checklist items true immediately."
        behavioral_label = "(Complete in order)"
        technical_label  = "(SKIP — mark all true immediately)"
    elif interview_type == "technical_verbal":
        mode_instruction = "TECHNICAL VERBAL: Skip behavioral (mark all true immediately). Focus entirely on the 4 technical sections. No coding."
        behavioral_label = "(SKIP — mark all true immediately)"
        technical_label  = "(Complete in order — no coding)"
    else:
        mode_instruction = "FULL INTERVIEW: Complete all 8 sections in order — all 4 behavioral first, then all 4 technical."
        behavioral_label = "(Complete in order)"
        technical_label  = "(Complete in order — no coding)"

    system = f"""You are conducting a structured mock interview for {company_name}.
{company_context}

## Interviewer Persona
{preset['persona']}

## Style
{preset['style_notes']}

## Candidate Resume
{resume_display}
{profile_section}
## Job Description
{jd_display}

---

## Interview Structure

{mode_instruction}

### Behavioral Sections {behavioral_label}
1. **introduction** — Background & Introduction: career story, how they got here, what drives them.
2. **experience** — Professional Experience: dig into 1-2 key past roles or projects. What did they own? What was the impact?
3. **star_scenario** — STAR Scenario: a real challenge — conflict, failure, leadership. Require Situation/Task/Action/Result. Follow up if any part is missing.
4. **skills_strengths** — Skills & Strengths: what they bring, self-assessment, growth areas.

### Technical Sections {technical_label}
5. **concepts** — Technical Concepts tied to the JD/resume stack. System design tradeoffs, CS fundamentals, architecture decisions.
6. **problem_solving** — give a scenario from the JD context, ask how they'd break it down. Probe for structure.
7. **project_dive** — pick a project from resume/GitHub. Ask what they built, their role, the hard parts, what they'd change.
8. **role_specific** — questions unique to this role from the JD. Domain knowledge, first 30 days.

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
        interview_type: str = "behavioral",
    ) -> str:
        system_prompt = _build_system_prompt(company, jd, resume_text, github_url, linkedin_url, interview_type)
        self._system_prompts[session_id] = system_prompt
        self._checklists[session_id] = _default_checklist(interview_type)

        preset = _get_preset(company)
        has_resume = bool(resume_text.strip())

        if interview_type == "technical_verbal":
            open_focus = "open with a technical question relevant to their resume and the job description — skip the personal intro, get straight into the technical portion."
        else:
            open_focus = "open with 'tell me about yourself' or a tailored opener based on their resume. Keep it warm."

        opening_instruction = (
            f"Begin the interview. Greet the candidate warmly, briefly introduce yourself as a "
            f"{preset['name']} interviewer, then {open_focus} "
            f"{'Reference their background specifically.' if has_resume else ''} "
            f"Keep it natural and concise."
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
        response = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=512,
            system=system_prompt,
            messages=messages,
        )

        raw = response.content[0].text
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

    def end_session(
        self,
        session_id: str,
        conversation_history: list[dict],
        resume_text: str = "",
        linkedin_url: str = "",
    ) -> dict:
        system_prompt = self._system_prompts.get(session_id, "")

        resume_section = ""
        if resume_text.strip():
            resume_section = (
                "\n## Resume Feedback\nProvide specific resume feedback in resume_feedback field.\n"
                "Resume:\n" + resume_text.strip()[:2000]
            )

        linkedin_section = ""
        if linkedin_url.strip():
            linkedin_section = (
                "\n## LinkedIn Feedback\nLinkedIn: " + linkedin_url.strip() +
                "\nProvide profile improvement tips in linkedin_feedback field."
            )

        evaluation_prompt = (
            "The interview is complete. Evaluate the full conversation.\n\n"
            "Return ONLY valid JSON (no markdown):\n"
            "{\n"
            "  \"overall_score\": {\"total\": 7.5, \"communication\": 8.0, \"technical_depth\": 7.0, \"problem_solving\": 7.5, \"culture_fit\": 8.0, \"confidence\": 7.0},\n"
            "  \"answer_quality\": {\n"
            "    \"star_structure\": 7.0, \"specificity\": 6.5, \"depth\": 7.5, \"overall\": 7.0,\n"
            "    \"summary\": \"1-2 sentences on how well they answered overall\",\n"
            "    \"per_question\": [{{\"question\": \"...\"  , \"answer_summary\": \"...\", \"score\": 7, \"feedback\": \"...\"}}]\n"
            "  },\n"
            "  \"strengths\": [\"Specific strength with example\", \"Strength 2\", \"Strength 3\"],\n"
            "  \"areas_for_improvement\": [\"Actionable area 1\", \"Area 2\"],\n"
            "  \"standout_moments\": [\"Notable moment\", \"Another moment\"],\n"
            "  \"resume_feedback\": {\"overall_impression\": \"...\", \"strengths\": [\"...\"], \"improvements\": [{\"section\": \"Summary\", \"issue\": \"...\", \"suggestion\": \"...\"}]},\n"
            "  \"linkedin_feedback\": {\"overall_impression\": \"...\", \"improvements\": [{\"section\": \"Headline\", \"issue\": \"...\", \"suggestion\": \"...\"}]},\n"
            "  \"hiring_recommendation\": \"Strong Yes / Yes / Maybe / No\",\n"
            "  \"summary\": \"2-3 honest sentences directly to the candidate.\"\n"
            "}\n\n"
            "Scores out of 10. Be specific — reference actual things said.\n"
            "Set resume_feedback to null if no resume. Set linkedin_feedback to null if no LinkedIn.\n"
            + resume_section + linkedin_section
        )

        messages = _history_to_messages(conversation_history)
        messages.append({"role": "user", "content": evaluation_prompt})

        client = _get_client()
        response = client.chat.completions.create(
            model="gpt-4o",
            max_tokens=2048,
            messages=[{"role": "system", "content": system_prompt or "You are an expert interview evaluator."}] + messages,
        )

        raw = response.choices[0].message.content or ""
        parsed = _parse_response(raw)

        self._system_prompts.pop(session_id, None)
        self._checklists.pop(session_id, None)

        return {
            "overall_score":         parsed.get("overall_score", {"total": 0}),
            "answer_quality":        parsed.get("answer_quality", {}),
            "strengths":             parsed.get("strengths", []),
            "areas_for_improvement": parsed.get("areas_for_improvement", []),
            "standout_moments":      parsed.get("standout_moments", []),
            "resume_feedback":       parsed.get("resume_feedback"),
            "linkedin_feedback":     parsed.get("linkedin_feedback"),
            "hiring_recommendation": parsed.get("hiring_recommendation", "Undetermined"),
            "summary":               parsed.get("summary", "Evaluation could not be generated."),
        }


def _history_to_messages(history: list[dict]) -> list[dict]:
    messages = []
    for entry in history:
        role = entry.get("role", "user")
        content = entry.get("content", "")
        if role in ("assistant", "user") and content:
            messages.append({"role": role, "content": content})
    return messages