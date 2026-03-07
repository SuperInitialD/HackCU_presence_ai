import io
import re
import pdfplumber


def parse_pdf(file_bytes: bytes) -> str:
    """Extract and clean text from PDF bytes."""
    text_parts = []
    with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
        for page in pdf.pages:
            page_text = page.extract_text()
            if page_text:
                text_parts.append(page_text)

    raw_text = "\n".join(text_parts)
    cleaned = _clean_text(raw_text)
    return cleaned


def _clean_text(text: str) -> str:
    """Clean extracted PDF text."""
    # Normalize line endings
    text = text.replace("\r\n", "\n").replace("\r", "\n")

    # Remove excessive whitespace within lines but keep line structure
    lines = text.split("\n")
    cleaned_lines = []
    for line in lines:
        line = re.sub(r"[ \t]+", " ", line).strip()
        cleaned_lines.append(line)

    # Collapse more than 2 consecutive blank lines into 2
    text = "\n".join(cleaned_lines)
    text = re.sub(r"\n{3,}", "\n\n", text)

    # Remove non-printable characters except newlines
    text = re.sub(r"[^\x20-\x7E\n]", " ", text)
    text = re.sub(r"[ \t]+", " ", text)

    return text.strip()


def extract_key_info(text: str) -> dict:
    """
    Extract structured key info from resume text.
    Returns dict with name, skills, experience, education.
    Heuristic-based extraction — good enough for hackathon context.
    """
    result = {
        "name": _extract_name(text),
        "skills": _extract_skills(text),
        "experience": _extract_experience(text),
        "education": _extract_education(text),
        "contact": _extract_contact(text),
    }
    return result


def _extract_name(text: str) -> str:
    """Attempt to extract candidate name (usually first non-empty line)."""
    lines = [l.strip() for l in text.split("\n") if l.strip()]
    if not lines:
        return "Unknown"

    # First line is usually the name if it's short and has no special chars
    first_line = lines[0]
    if len(first_line.split()) <= 5 and not re.search(r"[@|•|/]", first_line):
        return first_line

    return lines[0] if lines else "Unknown"


def _extract_skills(text: str) -> list[str]:
    """Extract skills from common resume sections."""
    skills = []

    # Look for skills section
    skills_pattern = re.compile(
        r"(?:skills?|technical skills?|core competencies|technologies|tools?)[:\s]*\n?(.*?)(?=\n\n|\Z)",
        re.IGNORECASE | re.DOTALL,
    )
    match = skills_pattern.search(text)
    if match:
        skills_block = match.group(1)
        # Split on common delimiters: commas, bullets, newlines, pipes
        raw_skills = re.split(r"[,•|\n·▪➤►]+", skills_block)
        for s in raw_skills:
            s = s.strip().strip("•-–—·")
            if s and 1 < len(s) < 50:
                skills.append(s)

    # Fallback: scan for known tech keywords
    if not skills:
        known_tech = [
            "Python", "Java", "JavaScript", "TypeScript", "C++", "C#", "Go", "Rust",
            "React", "Node.js", "FastAPI", "Django", "Flask", "Spring",
            "AWS", "GCP", "Azure", "Docker", "Kubernetes", "Terraform",
            "SQL", "PostgreSQL", "MySQL", "MongoDB", "Redis", "Elasticsearch",
            "Machine Learning", "Deep Learning", "TensorFlow", "PyTorch",
            "Git", "Linux", "REST", "GraphQL", "Kafka", "Spark",
        ]
        for tech in known_tech:
            if re.search(rf"\b{re.escape(tech)}\b", text, re.IGNORECASE):
                skills.append(tech)

    return list(dict.fromkeys(skills))  # deduplicate preserving order


def _extract_experience(text: str) -> list[dict]:
    """Extract work experience entries."""
    experience = []

    # Find experience section
    exp_pattern = re.compile(
        r"(?:work experience|experience|employment|professional experience)[:\s]*\n(.*?)(?=\n(?:education|projects?|skills?|certifications?|awards?)\b|\Z)",
        re.IGNORECASE | re.DOTALL,
    )
    match = exp_pattern.search(text)
    if not match:
        return experience

    exp_block = match.group(1)

    # Split into individual job entries — heuristic: lines with dates often mark new entries
    date_pattern = re.compile(
        r"(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|January|February|March|April|June|July|August|September|October|November|December)[\w\s,]*\d{4}",
        re.IGNORECASE,
    )

    # Collect lines with context
    lines = exp_block.split("\n")
    current_entry = []
    entries = []

    for line in lines:
        if date_pattern.search(line) and current_entry:
            entries.append("\n".join(current_entry))
            current_entry = [line]
        else:
            current_entry.append(line)
    if current_entry:
        entries.append("\n".join(current_entry))

    for entry in entries:
        entry = entry.strip()
        if not entry:
            continue
        entry_lines = [l.strip() for l in entry.split("\n") if l.strip()]
        if entry_lines:
            experience.append({
                "title": entry_lines[0] if entry_lines else "",
                "description": " ".join(entry_lines[1:4]) if len(entry_lines) > 1 else "",
            })

    return experience[:6]  # cap at 6 entries


def _extract_education(text: str) -> list[dict]:
    """Extract education entries."""
    education = []

    edu_pattern = re.compile(
        r"(?:education|academic background|qualifications)[:\s]*\n(.*?)(?=\n(?:experience|work|projects?|skills?|certifications?)\b|\Z)",
        re.IGNORECASE | re.DOTALL,
    )
    match = edu_pattern.search(text)
    if not match:
        return education

    edu_block = match.group(1)
    lines = [l.strip() for l in edu_block.split("\n") if l.strip()]

    degree_keywords = re.compile(
        r"\b(?:B\.?S\.?|B\.?A\.?|M\.?S\.?|M\.?A\.?|Ph\.?D\.?|Bachelor|Master|Doctor|Associate|MBA)\b",
        re.IGNORECASE,
    )

    for i, line in enumerate(lines):
        if degree_keywords.search(line):
            education.append({
                "degree": line,
                "institution": lines[i + 1] if i + 1 < len(lines) else "",
            })

    return education[:4]


def _extract_contact(text: str) -> dict:
    """Extract email and phone if present."""
    email_match = re.search(r"[\w.+-]+@[\w-]+\.[a-zA-Z]{2,}", text)
    phone_match = re.search(
        r"(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}", text
    )
    linkedin_match = re.search(r"linkedin\.com/in/[\w-]+", text, re.IGNORECASE)

    return {
        "email": email_match.group(0) if email_match else "",
        "phone": phone_match.group(0) if phone_match else "",
        "linkedin": linkedin_match.group(0) if linkedin_match else "",
    }
