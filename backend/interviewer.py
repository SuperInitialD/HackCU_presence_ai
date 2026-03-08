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


ALL_BEHAVIORAL = ["introduction", "experience", "star_scenario", "skills_strengths"]
ALL_TECHNICAL  = ["concepts", "problem_solving", "project_dive", "role_specific"]

def _default_checklist(interview_type: str = "behavioral", selected_sections: list | None = None) -> dict:
    behavioral_keys = ALL_BEHAVIORAL
    technical_keys  = ALL_TECHNICAL

    # Determine which top-level sections are in scope for this interview type
    if interview_type == "technical_verbal":
        in_scope = set(technical_keys)
    elif interview_type == "behavioral":
        in_scope = set(behavioral_keys)
    else:  # full
        in_scope = set(behavioral_keys + technical_keys)

    # If caller specified a subset, restrict further
    if selected_sections is not None:
        selected = set(selected_sections)
    else:
        selected = in_scope  # default: all in-scope items selected

    def val(k: str) -> bool:
        # True = already done/skip; False = needs to be covered
        return not (k in in_scope and k in selected)

    return {
        "behavioral": {k: val(k) for k in behavioral_keys},
        "technical":  {k: val(k) for k in technical_keys},
    }


def _build_system_prompt(
    company: str,
    jd: str,
    resume_text: str,
    github_url: str = "",
    linkedin_url: str = "",
    interview_type: str = "behavioral",
    selected_sections: list | None = None,
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
    resume_display  = resume_text.strip() if resume_text.strip() else "No resume provided — ask the candidate to walk you through their background."
    jd_display      = jd.strip() if jd.strip() else "No job description provided — conduct a general software engineering interview."

    # Determine which sections are actually active (selected by user)
    if selected_sections is not None:
        selected_set = set(selected_sections)
    else:
        if interview_type == "technical_verbal":
            selected_set = set(ALL_TECHNICAL)
        elif interview_type == "behavioral":
            selected_set = set(ALL_BEHAVIORAL)
        else:
            selected_set = set(ALL_BEHAVIORAL + ALL_TECHNICAL)

    active_behavioral = [k for k in ALL_BEHAVIORAL if k in selected_set]
    active_technical  = [k for k in ALL_TECHNICAL  if k in selected_set]

    if interview_type == "behavioral":
        mode_instruction = "BEHAVIORAL-ONLY: Cover only the selected behavioral sections. Mark all technical checklist items true immediately."
        technical_label  = "(SKIP — mark all true immediately)"
        behavioral_label = "(Complete in order)" if active_behavioral else "(ALL SKIPPED — mark all true)"
    elif interview_type == "technical_verbal":
        mode_instruction = "TECHNICAL VERBAL: Skip behavioral (mark all true immediately). Focus only on the selected technical sections. No coding."
        behavioral_label = "(SKIP — mark all true immediately)"
        technical_label  = "(Complete in order — no coding)" if active_technical else "(ALL SKIPPED — mark all true)"
    else:
        mode_instruction = "FULL INTERVIEW: Complete selected sections in order — behavioral first, then technical."
        behavioral_label = "(Complete in order)" if active_behavioral else "(ALL SKIPPED — mark all true)"
        technical_label  = "(Complete in order — no coding)" if active_technical else "(ALL SKIPPED — mark all true)"

    # Human-readable section names for the prompt
    SECTION_NAMES = {
        "introduction":     "Introduction / Background",
        "experience":       "Professional Experience",
        "star_scenario":    "STAR Scenario",
        "skills_strengths": "Skills & Strengths",
        "concepts":         "Technical Concepts",
        "problem_solving":  "Problem Solving",
        "project_dive":     "Project Deep-Dive",
        "role_specific":    "Role-Specific Knowledge",
    }
    active_b_names = [SECTION_NAMES[k] for k in active_behavioral]
    active_t_names = [SECTION_NAMES[k] for k in active_technical]
    focus_note = ""
    if selected_sections is not None:
        skipped_b = [SECTION_NAMES[k] for k in ALL_BEHAVIORAL if k not in selected_set]
        skipped_t = [SECTION_NAMES[k] for k in ALL_TECHNICAL  if k not in selected_set]
        skipped = skipped_b + skipped_t
        if skipped:
            focus_note = "The candidate chose to SKIP these sections — mark them true immediately and do NOT ask about them: " + ", ".join(skipped) + "."

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
{focus_note}

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
1. ONE question per turn. Never stack.
2. **Keep every response under 3 sentences.** Spoken, not written. No bullet lists.
3. If the candidate's answer is clearly wrong or missing the point, briefly give the correct framing in 1 sentence, then move on. Don't dwell.
4. Follow-ups only if the answer was genuinely vague or incomplete — max 1 follow-up per section.
5. Reference resume/GitHub/LinkedIn naturally, not robotically.
6. No coding questions. Conceptual only.
7. Move fast. Don't over-explain. Trust the candidate to follow.

## Ending
When ALL active sub-sections are marked true: immediately say a short goodbye (1 sentence). Set end_interview=true. Do not ask another question.

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
        selected_sections: list | None = None,
    ) -> str:
        system_prompt = _build_system_prompt(company, jd, resume_text, github_url, linkedin_url, interview_type, selected_sections)
        self._system_prompts[session_id] = system_prompt
        self._checklists[session_id] = _default_checklist(interview_type, selected_sections)

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
            "    \"inflection\": 7.0, \"clarity\": 7.5, \"conciseness\": 6.5,\n"
            "    \"summary\": \"1-2 sentences on how well they answered overall\",\n"
            "    \"per_question\": [{\"question\": \"...\", \"answer_summary\": \"...\", \"score\": 7, \"feedback\": \"...\"}]\n"
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
            "Speech quality scores (infer from text — how they likely sounded):\n"
            "  inflection: vocal variety and engagement (monotone vs expressive)\n"
            "  clarity: clear, organized communication; no rambling\n"
            "  conciseness: got to the point without excessive filler or over-explanation\n"
            "Set resume_feedback to null if no resume. Set linkedin_feedback to null if no LinkedIn.\n"
            + resume_section + linkedin_section
        )

        messages = _history_to_messages(conversation_history)
        messages.append({"role": "user", "content": evaluation_prompt})

        client = _get_client()
        response = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=2048,
            system=system_prompt or "You are an expert interview evaluator.",
            messages=messages,
        )

        raw = response.content[0].text
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